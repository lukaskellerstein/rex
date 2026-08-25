// The shell: opens a document, keeps threads and their resolutions in step,
// owns the surface the anchor resolver runs against, and holds the selection
// panel's items (spec 05 §3.5).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyReadyEvent } from "../../shared/channels.ts";
import { outOfReviewScope, worstState } from "../../shared/targets.ts";
import type {
  Anchor,
  AnchorState,
  AnchorSummary,
  DocumentRef,
  Message,
  OpenedDocument,
  ReferenceGraph,
  StrokeRef,
  ThreadWithMessages,
  ViewState,
  WorkspaceRef,
  WorkspaceTree,
} from "../../shared/types.ts";
import { createDocumentAnchor } from "../anchor/create.ts";
import type { Stroke } from "../anchor/lasso.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import { ApplyResult } from "./ApplyResult.tsx";
import type { Mode } from "./mode.ts";
import {
  type DocumentSurface,
  NO_KEPT_SCOPE,
  type ResolvedThread,
  type Selected,
} from "./anchoring.ts";
import { CommentCard } from "./CommentCard.tsx";
import { DiffDialog } from "./DiffDialog.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { Explorer } from "./Explorer.tsx";
import { GraphView } from "./GraphView.tsx";
import { tokenClass } from "./Gutter.tsx";
import { rescaleRect, strokeRefFrom, unionOfRects } from "./ink.ts";
import { Lightbox } from "./Lightbox.tsx";
import { drawDiagramPng, posterFramePng } from "./mermaid.ts";
import { PEN_WIDTH } from "./PenLayer.tsx";
import type { PreviewFigure } from "./preview.ts";
import { SelectionPanel } from "./SelectionPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { type SidebarTab, SidebarTabs } from "./SidebarTabs.tsx";
import { Splitter } from "./Splitter.tsx";
import {
  addSelectionItem,
  moveSelectionItem,
  newSelectionItem,
  type SelectionItem,
} from "./selection.ts";
import { TopBar } from "./TopBar.tsx";
import { TraceSheet } from "./TraceSheet.tsx";

/** What the middle of the window is showing. */
type Centre = "document" | "graph";

/** SPEC.md §8.8 point 4 — confirm before a fan-out larger than this. */
const FAN_OUT_CONFIRM = 10;
/** A rough per-comment figure, only ever shown as an estimate. */
const ESTIMATED_USD_PER_ASK = 0.05;
/** How long ⌥ must be held before it means "pick", not "I am typing ⌥-something". */
const ALT_PICK_DELAY = 250;

/**
 * How far the document can be zoomed, and by how much per notch.
 *
 * The zoom is the *document's*, not REX's: it scales what is under review and
 * leaves the bar, the explorer and the cards alone. That is why it is CSS
 * `zoom` inside the frame rather than Electron's `setZoomFactor`, which would
 * scale the whole window and make the comment cards grow with the prose.
 */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.1;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Two boxes, or two absences, that are the same box. */
function same(a: ScopeRect | null, b: ScopeRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Spec 05 §3.5 — the file name. Never the whole path. */
function nameOf(ref: DocumentRef): string {
  return ref.value.split("/").pop() ?? ref.value;
}

interface ApplyOutcome {
  summary: AnchorSummary;
  files: string[];
  newlyOrphaned: ThreadWithMessages[];
}

const NO_SUMMARY: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [threads, setThreads] = useState<ThreadWithMessages[]>([]);
  const [resolved, setResolved] = useState<ResolvedThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cost, setCost] = useState(0);
  const [pendingApply, setPendingApply] = useState<ApplyReadyEvent | null>(null);
  const [applyOutcome, setApplyOutcome] = useState<ApplyOutcome | null>(null);
  const [busyThreads, setBusyThreads] = useState<string[]>([]);
  /**
   * Spec 12 §3.3 — the mode each thread's next send will run in.
   *
   * Renderer state, keyed by thread id, defaulting to ASK. It is deliberately
   * NOT persisted, and the argument is one-way: the state that survives a
   * restart should be the safe one. A thread reopened tomorrow opens on ASK,
   * which can only cost a click; the opposite mistake costs a diff the reviewer
   * was not expecting.
   *
   * `threads.profile` is not the place for it either. That column records what
   * the CONVERSATION ran under, and a thread whose row said `write` would run
   * every later question through the write profile.
   */
  const [modeByThread, setModeByThread] = useState<Record<string, Mode>>({});
  /** §3.2 — the mode a comment that does not exist yet will be created in. */
  const [selectionMode, setSelectionMode] = useState<Mode>("ask");

  /** §3.3 — ASK unless this thread has been switched. */
  const modeOf = (threadId: string): Mode => modeByThread[threadId] ?? "ask";

  const setMode = (threadId: string, mode: Mode): void =>
    setModeByThread((current) => ({ ...current, [threadId]: mode }));

  const [notice, setNotice] = useState<string | null>(null);
  // Spec 02: the workspace is a view of a folder, independent of which
  // document is open, so switching documents never disturbs it.
  const [workspace, setWorkspace] = useState<WorkspaceRef | null>(null);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [graph, setGraph] = useState<ReferenceGraph | null>(null);
  const [centre, setCentre] = useState<Centre>("document");
  /**
   * One notion of "selected", shared by the explorer and the graph. It follows
   * the open document, but a graph node that cannot be opened — an external or
   * missing file — can be selected without opening anything.
   */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(272);
  const [commentsWidth, setCommentsWidth] = useState(384);
  /**
   * Spec 10 §3.5 — whether the tree lists the folders REX skips on its own.
   *
   * A view state and not a stored one: it is how you go and find `node_modules`
   * once, not a way of working. The reviewer's own exclusions are not governed
   * by it — they are always drawn — and the rules themselves are in the
   * database.
   */
  const [showSkipped, setShowSkipped] = useState(false);
  /** Spec 10 §2 — the figure being read at a real size, if any. */
  const [preview, setPreview] = useState<PreviewFigure | null>(null);

  // design/selection — pick mode and the region drag it can hand off to.
  const [picking, setPicking] = useState(false);
  const [pickScopes, setPickScopes] = useState<PickScope[] | null>(null);
  const [pickActive, setPickActive] = useState(0);
  const [arming, setArming] = useState(false);
  /** Spec 06 §5.1 — the pen, a mode like pick and off by default. */
  const [penning, setPenning] = useState(false);
  /** The document's own zoom. 1 is 100%. */
  const [zoom, setZoom] = useState(1);

  // ── The selection panel (spec 05 §3) ────────────────────────
  //
  // It is the reviewer's, not the document's: opening another document, or the
  // graph, leaves it exactly as it was. That is what makes a question about two
  // documents possible at all. It is session-only and never written to the
  // database — a half-built selection restored three days later is a puzzle.
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [selectionNote, setSelectionNote] = useState("");
  /** Spec 08 §3.1 — which job the sidebar is doing. */
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("comments");
  /** Spec 08 §6 — the comment whose trace is covering the document pane. */
  const [traceId, setTraceId] = useState<string | null>(null);
  /** Spec 08 §7.2 — which of the open comment's places is being pointed at. */
  const [hoveredPlace, setHoveredPlace] = useState<number | null>(null);
  /**
   * Spec 06 §5.4 — the ink for the comment being built, already in the form it
   * will be stored in: fractions of the union box of the panel's places.
   *
   * It belongs to the panel, not to any one row, which is the whole reason it
   * is not a field on `SelectionItem`.
   */
  const [selectionStroke, setSelectionStroke] = useState<StrokeRef | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  /** §6.4 — a saved comment shows its ink when its row is hovered, too. */
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  /** The chain rebuilt from the expanded row's anchor — §4.1. */
  const [rowScopes, setRowScopes] = useState<PickScope[] | null>(null);
  const [rowActive, setRowActive] = useState(0);
  /** Spec 05 §5.6.1 — what a pending Apply changed in the document on screen. */
  const [changeBoxes, setChangeBoxes] = useState<ScopeRect[]>([]);

  /**
   * Spec 08 §3.1 — the tab follows what the reviewer is doing, in both
   * directions. Picking a first place is starting to select, so the Selection
   * tab comes forward; Ask empties the panel, so the tabs go with it and the
   * answer is where the reviewer is already looking.
   *
   * Only on the *edges*. Switching tabs by hand while a selection stands must
   * not be undone on the next render, which is what a plain `length > 0` test
   * would do.
   */
  const hadSelection = useRef(false);
  useEffect(() => {
    const has = selection.length > 0;
    if (has !== hadSelection.current) setSidebarTab(has ? "selection" : "comments");
    hadSelection.current = has;
  }, [selection.length]);

  /**
   * Spec 08 §3.1 — entering pick or the pen is starting to select, so the tab
   * that shows a selection comes forward with the mode.
   *
   * The edge rule above is not enough on its own. It fires when the panel goes
   * from empty to holding something, so a *second* place picked while the
   * reviewer is reading the Comments tab lands in a tab they cannot see, and
   * the pick reads as having done nothing. Hooking the mode rather than the
   * place also puts the panel in front before the first click, which is where
   * the reviewer needs it: the row appears under a heading they are already
   * looking at.
   */
  useEffect(() => {
    if (picking || penning) setSidebarTab("selection");
  }, [picking, penning]);

  const surfaceRef = useRef<DocumentSurface | null>(null);
  const docRef = useRef<OpenedDocument | null>(null);
  const threadsRef = useRef<ThreadWithMessages[]>([]);
  const workspaceRef = useRef<WorkspaceRef | null>(null);
  const pendingApplyRef = useRef<ApplyReadyEvent | null>(null);
  /**
   * Which comments were already orphaned when this Apply began.
   *
   * Taken the moment the agent finishes, *before* the document is re-rendered
   * for review — by the time OK is pressed the sweep that draws the outlines has
   * already restated everything, so a set taken then would contain the orphans
   * this Apply just created and report "0 newly lost" about a change that lost
   * two. Measured on 2026-08-21 against the two-file fixture.
   */
  const orphansBeforeApply = useRef<Set<string>>(new Set());
  /** The sweep's own result, readable before React has re-rendered with it. */
  const resolvedRef = useRef<ResolvedThread[]>([]);
  /** Resolves the promise §8.7 step 6 is waiting on, once the sweep is done. */
  const sweepWaiter = useRef<((summary: AnchorSummary) => void) | null>(null);
  /**
   * A panel row clicked while its document was closed. The scroll cannot happen
   * until that document has loaded and handed up a surface, so it waits here.
   */
  const scrollWhenReady = useRef<SelectionItem | null>(null);
  /**
   * Spec 08 §7.3 — a place row's jump asks for a plain anchor in a document
   * that is not open yet.
   *
   * Its own ref rather than reusing `scrollWhenReady`, which carries a
   * `SelectionItem`: a stored place is not a selection, and manufacturing one
   * would put a row in the panel that the reviewer never built.
   */
  const anchorWhenReady = useRef<{ path: string; anchor: Anchor } | null>(null);
  /**
   * The anchor the expanded row had when it was expanded.
   *
   * Widening re-anchors the row (§4.1), so its own anchor moves under the chips.
   * Rebuilding the chain from the *moved* anchor would drop every scope narrower
   * than the one just chosen, and the reviewer could widen but never come back.
   */
  const expandedBase = useRef<SelectionItem | null>(null);
  /** Read by the sweep, which re-measures every row's box (§6). */
  const selectionRef = useRef<SelectionItem[]>([]);
  /** Read by the sweep, which paints the open comment's passages violet (§6). */
  const activeIdRef = useRef<string | null>(null);
  /**
   * Read through refs rather than closed over, so the pick callbacks keep one
   * identity for the life of the app — DocumentView's tier 1 effect depends on
   * that, and a new identity there rewrites the iframe's `srcdoc`.
   */
  const pickActiveRef = useRef(0);
  /** The chain on screen, for the click that lands where no element is. */
  const pickScopesRef = useRef<PickScope[] | null>(null);
  const zoomRef = useRef(1);
  /**
   * Whether the chosen scope was chosen **by hand** — ↑ ↓ or a crumb — rather
   * than by the last probe. Only a deliberate choice is carried across a
   * pointer move; see `keptIndex`, which explains what a PDF page did to the
   * old rule.
   */
  const pickChosenByHand = useRef(false);

  /**
   * Spec 13 §4.2 — the four view fields the debug report needs, and the shell
   * element it reaches the document frame through.
   *
   * Refs and not the render's own values: `copyDebug` is registered once, as a
   * key binding, and a callback that captured state would report whatever was
   * true when it was made.
   */
  const centreRef = useRef<Centre>("document");
  const sidebarTabRef = useRef<SidebarTab>("comments");
  const traceIdRef = useRef<string | null>(null);
  const noticeRef = useRef<string | null>(null);
  const appRef = useRef<HTMLDivElement>(null);

  docRef.current = doc;
  threadsRef.current = threads;
  workspaceRef.current = workspace;
  pendingApplyRef.current = pendingApply;
  selectionRef.current = selection;
  activeIdRef.current = activeId;
  pickActiveRef.current = pickActive;
  pickScopesRef.current = pickScopes;
  zoomRef.current = zoom;
  centreRef.current = centre;
  sidebarTabRef.current = sidebarTab;
  traceIdRef.current = traceId;
  noticeRef.current = notice;

  /**
   * Each thread's targets' states, in target order — the stored one, or the
   * fresher answer this sweep found for the targets it could check (§5.4).
   *
   * The sweep wins where it has an answer: `threads` is only refetched when
   * something else forces it, so its stored states are the older of the two.
   */
  const targetStatesById = useMemo(() => {
    const sweptBy = new Map(resolved.map((entry) => [entry.threadId, entry]));
    const map = new Map<string, Array<AnchorState | null>>();
    for (const thread of threads) {
      const swept = sweptBy.get(thread.id);
      map.set(
        thread.id,
        thread.targets.map(
          (target, position) =>
            swept?.checked.find((check) => check.position === position)?.state ?? target.state,
        ),
      );
    }
    return map;
  }, [threads, resolved]);

  /**
   * A thread's own state is the worst of its targets', ignoring the ones nobody
   * has looked at (§5.4). Null when nobody has looked at any of them.
   */
  const stateById = useMemo(() => {
    const map = new Map<string, AnchorState | null>();
    for (const [threadId, states] of targetStatesById) map.set(threadId, worstState(states));
    return map;
  }, [targetStatesById]);

  /** What a quoteless anchor turned out to point at — `Table · 3 × 4`. */
  const labelById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const entry of resolved) map.set(entry.threadId, entry.label);
    return map;
  }, [resolved]);

  /**
   * The same two facts per PLACE rather than per thread: what it is, and which
   * line it is on now. Only the sweep can answer either — both are read off the
   * live DOM — so a place in a document that is not open has neither, and the
   * card falls back to what its stored anchor says.
   */
  const targetPlacesById = useMemo(() => {
    const sweptBy = new Map(resolved.map((entry) => [entry.threadId, entry]));
    const map = new Map<string, Array<{ label: string | null; line: number | null }>>();
    for (const thread of threads) {
      const swept = sweptBy.get(thread.id);
      map.set(
        thread.id,
        thread.targets.map((_, position) => {
          const check = swept?.checked.find((entry) => entry.position === position);
          return { label: check?.label ?? null, line: check?.line ?? null };
        }),
      );
    }
    return map;
  }, [threads, resolved]);

  const numbers = useMemo(
    () => new Map(threads.map((thread, position) => [thread.id, position + 1])),
    [threads],
  );

  // ── Resolution sweep (§6.5, §6.6) ───────────────────────────

  /**
   * Spec 05 §6 — every selected place, measured against the document as it is
   * now rather than as it was when it was clicked.
   *
   * Part of the sweep and not an effect of its own, because it answers the same
   * question the sweep does — where is this anchor? — and every reason to run
   * one is a reason to run the other. Rows in another document are left alone:
   * their box is still true of the document they belong to.
   */
  const remeasureSelection = useCallback(async (openDocumentId: string): Promise<void> => {
    const surface = surfaceRef.current;
    const items = selectionRef.current;
    const here = items.filter((item) => item.documentId === openDocumentId);
    if (!surface || here.length === 0) return;

    const rects = await surface.rectsForAnchors(
      here.map((item) => ({ anchor: item.anchor, kind: item.kind })),
    );
    const measured = new Map(here.map((item, position) => [item.id, rects[position] ?? null]));

    setSelection((current) => {
      let moved = false;
      const next = current.map((item) => {
        if (!measured.has(item.id)) return item;
        const rect = measured.get(item.id) ?? null;
        if (same(item.rect, rect) && item.zoom === zoomRef.current) return item;
        moved = true;
        return { ...item, rect, zoom: zoomRef.current };
      });
      // The same list back when nothing moved: this runs on every sweep, and a
      // fresh array each time would re-render the panel and the outlines for
      // nothing.
      return moved ? next : current;
    });
  }, []);

  const sweep = useCallback(async (): Promise<AnchorSummary> => {
    const surface = surfaceRef.current;
    const current = docRef.current;
    const summary: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };
    if (!surface || !current) return summary;

    const entries = await surface.resolve(
      threadsRef.current,
      current.contentChanged,
      current.documentId,
      activeIdRef.current,
    );
    resolvedRef.current = entries;
    setResolved(entries);
    await remeasureSelection(current.documentId);

    // Invariant I1 — main stores anchor states but cannot compute them. One call
    // per *target* the sweep could check: §5.4 forbids restating the others,
    // whose documents were never on screen.
    await Promise.all(
      entries.flatMap((entry) =>
        entry.checked.map((check) =>
          window.rex.anchorRestate({
            threadId: entry.threadId,
            position: check.position,
            anchorState: check.state,
          }),
        ),
      ),
    );

    // §5.8 — the summary counts checked targets, not threads. It is a report on
    // what this sweep just did, and it could only do one document's worth.
    for (const entry of entries) {
      for (const check of entry.checked) {
        summary[check.state]++;
        summary.total++;
      }
    }
    return summary;
  }, [remeasureSelection]);

  /** §5.6.1 — the boxes for a pending Apply, in whichever document is open. */
  const refreshChangeBoxes = useCallback(async (): Promise<void> => {
    const surface = surfaceRef.current;
    const current = docRef.current;
    const pending = pendingApplyRef.current;
    if (!surface || !current || !pending) {
      setChangeBoxes([]);
      return;
    }
    const path = current.ref.value;
    const ranges = pending.regions
      .filter((region) => region.file === path)
      .map((region) => ({ from: region.from, to: region.to }));
    setChangeBoxes(ranges.length > 0 ? await surface.boxesForLines(ranges) : []);
  }, []);

  /**
   * A resize re-resolves, because an outline is geometry.
   *
   * An anchor on a whole element or a region of one is stored as fractions and
   * drawn as a box in document pixels, and only `sweep()` turns one into the
   * other. Without this the stored anchor stays perfectly correct while the box
   * on screen keeps the size it had at the old width — measured on 2026-08-21
   * on a PDF, where narrowing the window left a region outline 1.23× the width
   * of the page it was cut from. It matters most for a PDF, whose pages scale
   * with the pane instead of reflowing, but it is wrong for every format.
   *
   * DocumentView watches the pane rather than the window, because a splitter
   * drag and the explorer opening both resize the pane without resizing the
   * window — see `Props.onPaneResized`.
   */
  const onPaneResized = useCallback((): void => {
    void sweep();
    void refreshChangeBoxes();
  }, [sweep, refreshChangeBoxes]);

  /**
   * A zoom is geometry, exactly as a resize is, so it re-resolves for the same
   * reason (see the resize effect above). Skipped before there is a surface:
   * this fires once on mount, and sweeping then would clear the list the load
   * is about to fill.
   */
  const onZoomApplied = useCallback((): void => {
    if (!surfaceRef.current) return;
    void sweep();
    void refreshChangeBoxes();
  }, [sweep, refreshChangeBoxes]);

  /**
   * §6 — opening a comment recolours its passages, and closing it puts them
   * back.
   *
   * A repaint and not a sweep: the sweep resolves every thread and writes each
   * checked target's state back to the database, and opening a card changes no
   * state at all. The surface still holds the ranges the last sweep found.
   */
  useEffect(() => {
    surfaceRef.current?.repaintActive(activeId);
  }, [activeId]);

  /**
   * Leaving pick mode forgets a deliberate widening.
   *
   * Here rather than only in `leavePick`, because three routes turn pick mode
   * off without going through it: the `P` key, the ⌥ keyup, and the toolbar
   * toggle. A widening remembered across a visit the reviewer had ended would
   * choose their next place for them.
   */
  useEffect(() => {
    if (!picking) pickChosenByHand.current = false;
  }, [picking]);

  const onSurfaceReady = useCallback(
    async (surface: DocumentSurface): Promise<void> => {
      surfaceRef.current = surface;
      const summary = await sweep();
      await refreshChangeBoxes();

      // §3.3 — a row clicked while its document was closed asked to be scrolled
      // to, and this is the first moment there is a DOM to scroll.
      const waiting = scrollWhenReady.current;
      if (waiting && waiting.documentId === docRef.current?.documentId) {
        scrollWhenReady.current = null;
        surface.scrollToAnchor(waiting.anchor);
        const probe = await surface.scopesForAnchor(waiting.anchor, waiting.kind);
        setRowScopes(probe?.scopes ?? null);
        setRowActive(probe?.active ?? 0);
      }

      // Spec 07 §8.1 — the same moment, for a finding's Open.
      const jump = anchorWhenReady.current;
      if (jump && docRef.current?.ref.value === jump.path) {
        anchorWhenReady.current = null;
        surface.scrollToAnchor(jump.anchor);
      }

      const waiter = sweepWaiter.current;
      if (waiter) {
        sweepWaiter.current = null;
        waiter(summary);
      }
    },
    [sweep, refreshChangeBoxes],
  );

  // ── Opening documents ───────────────────────────────────────

  const zoomBy = useCallback((factor: number): void => {
    setZoom((current) => clampZoom(current * factor));
  }, []);

  const resetZoom = useCallback((): void => setZoom(1), []);

  /** Spec 06 §5.1 — `esc`, and every route that leaves a mode behind. */
  const leavePen = useCallback((): void => setPenning(false), []);

  const leavePick = useCallback((): void => {
    setPicking(false);
    setArming(false);
    setPickScopes(null);
    setPickActive(0);
    pickChosenByHand.current = false;
  }, []);

  /** What `thread:list` is scoped to — the workspace, or this document's folder. */
  const listRequest = useCallback(
    (documentId: string | null) => ({
      root: workspaceRef.current?.root ?? null,
      documentId,
    }),
    [],
  );

  const openDocument = useCallback(
    async (ref: DocumentRef): Promise<void> => {
      setSelectedPath(ref.value);
      const opened = await window.rex.docOpen(ref);
      const list = await window.rex.threadList(listRequest(opened.documentId));
      surfaceRef.current = null;
      setActiveId(null);
      setResolved([]);
      resolvedRef.current = [];
      // §3.3 — the panel survives. Only the chain belongs to the old DOM, and a
      // chain holds live elements that are about to stop existing.
      setRowScopes(null);
      leavePick();
      leavePen();
      setThreads(list);
      setDoc(opened);
    },
    [leavePen, leavePick, listRequest],
  );

  const guard = useCallback(async (task: () => Promise<void>): Promise<void> => {
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  /**
   * Spec 13 §4 — what the overlay knows about itself, measured at the click.
   *
   * `frameChildren` is read here rather than tracked, because the case it
   * exists for is the frame never coming up at all: an empty `<body>` beside a
   * non-zero `documentBytes` is that failure stated. It stays nullable — a
   * frame that has not loaded has no `contentDocument` to count, which is
   * "not measurable", never "empty".
   */
  const viewState = useCallback((): ViewState => {
    const open = docRef.current;
    const list = threadsRef.current;
    const frame = appRef.current?.querySelector<HTMLIFrameElement>("iframe") ?? null;
    const box = frame?.getBoundingClientRect() ?? null;
    let frameChildren: number | null = null;
    try {
      frameChildren = frame?.contentDocument?.body?.childElementCount ?? null;
    } catch {
      frameChildren = null;
    }

    return {
      window: { width: window.innerWidth, height: window.innerHeight },
      workspaceRoot: workspaceRef.current?.root ?? null,
      document: open
        ? {
            documentId: open.documentId,
            value: open.ref.value,
            kind: open.ref.kind,
            title: open.title,
            presentation: open.presentation.kind,
            documentBytes: open.presentation.kind === "html" ? open.presentation.html.length : null,
            contentChanged: open.contentChanged,
            surfaceReady: surfaceRef.current !== null,
            frameChildren,
            frameWidth: box ? Math.round(box.width) : null,
            frameHeight: box ? Math.round(box.height) : null,
          }
        : null,
      centre: centreRef.current,
      sidebarTab: sidebarTabRef.current,
      zoom: zoomRef.current,
      threads: list.length,
      unanswered: list.filter((thread) => thread.messages.length === 0).length,
      activeThreadId: activeIdRef.current,
      traceOpen: traceIdRef.current !== null,
      selectionItems: selectionRef.current.length,
      notice: noticeRef.current,
    };
  }, []);

  const copyDebug = useCallback(
    () =>
      guard(async () => {
        await window.rex.debugSnapshot(viewState());
        setNotice("Debug report copied — paste it to Claude Code.");
      }),
    [guard, viewState],
  );

  const pick = useCallback(
    () =>
      guard(async () => {
        const ref = await window.rex.docPick();
        if (ref) await openDocument(ref);
      }),
    [guard, openDocument],
  );

  const refreshThreads = useCallback(async (): Promise<ThreadWithMessages[]> => {
    const current = docRef.current;
    if (!current) return [];
    const list = await window.rex.threadList(listRequest(current.documentId));
    setThreads(list);
    threadsRef.current = list;
    return list;
  }, [listRequest]);

  // ── Workspace (spec 02) ─────────────────────────────────────

  const openWorkspace = useCallback(
    (ref: WorkspaceRef) =>
      guard(async () => {
        setWorkspace(ref);
        workspaceRef.current = ref;
        setGraph(null);
        setTree(await window.rex.workspaceTree(ref, showSkipped));
      }),
    [guard, showSkipped],
  );

  /** Re-scans the tree so comment counts follow what just happened. */
  const refreshTree = useCallback(
    () =>
      guard(async () => {
        if (workspace) setTree(await window.rex.workspaceTree(workspace, showSkipped));
      }),
    [guard, showSkipped, workspace],
  );

  /**
   * Spec 10 §3.4 — one path in or out of the review.
   *
   * The tree is re-scanned rather than patched: the rule main writes depends on
   * the rule already there, so what a path ends up as is main's answer to give.
   * A renderer that predicted it would be right until the first time it was not.
   */
  const setExcluded = useCallback(
    (path: string, exclude: boolean) =>
      guard(async () => {
        const current = workspaceRef.current;
        if (!current) return;
        await window.rex.workspaceExclude({ root: current.root, path, exclude });
        setTree(await window.rex.workspaceTree(current, showSkipped));
        // The graph is a view of the same scan, so it is now stale. Dropping it
        // makes the next visit rebuild; rebuilding it here would pay for a
        // reference walk nobody has asked to look at.
        setGraph(null);
      }),
    [guard, showSkipped],
  );

  const toggleShowSkipped = useCallback(
    () =>
      guard(async () => {
        const next = !showSkipped;
        setShowSkipped(next);
        const current = workspaceRef.current;
        if (current) setTree(await window.rex.workspaceTree(current, next));
      }),
    [guard, showSkipped],
  );

  const pickFolder = useCallback(
    () =>
      guard(async () => {
        const ref = await window.rex.workspacePick();
        if (ref) await openWorkspace(ref);
      }),
    [guard, openWorkspace],
  );

  const showCentre = useCallback(
    (which: Centre) =>
      guard(async () => {
        setCentre(which);
        if (which === "document") {
          await sweep();
          return;
        }
        leavePick();
        leavePen();
        if (which === "graph" && workspace) {
          setGraph(await window.rex.workspaceGraph(workspace));
        }
      }),
    [guard, leavePen, leavePick, sweep, workspace],
  );

  // ── §8.7 step 6 — main drives the post-Apply sweep through here ──

  useEffect(() => {
    window.__rexReanchor = async (changedDocumentIds: string[]): Promise<AnchorSummary> => {
      const current = docRef.current;
      if (!current) return NO_SUMMARY;

      const list = await window.rex.threadList(listRequest(current.documentId));
      threadsRef.current = list;
      setThreads(list);

      // Nothing on screen changed, so there is nothing to re-render; the sweep
      // still runs, because the thread list it resolves against just moved.
      if (!changedDocumentIds.includes(current.documentId)) return await sweep();

      // The file changed underneath, so re-render it before re-resolving.
      const reopened = await window.rex.docOpen(current.ref);
      const waited = new Promise<AnchorSummary>((done) => {
        sweepWaiter.current = done;
      });
      surfaceRef.current = null;
      setDoc(reopened);
      return waited;
    };
    return () => {
      window.__rexReanchor = undefined;
    };
  }, [listRequest, sweep]);

  // `rex <path>` — open what the command line named, once. A directory is a
  // workspace, a file is a single document (spec 02 §7).
  useEffect(() => {
    void (async () => {
      const target = await window.rex.docInitial();
      if (!target) return;
      if (target.kind === "workspace") await openWorkspace(target.ref);
      else await guard(() => openDocument(target.ref));
    })();
  }, [guard, openDocument, openWorkspace]);

  // ── Streams from main ───────────────────────────────────────

  useEffect(() => {
    const offStep = window.rex.onStreamStep((message: Message) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === message.threadId
            ? { ...thread, messages: [...thread.messages, message] }
            : thread,
        ),
      );
    });
    const offCost = window.rex.onStreamCost((event) => setCost(event.totalUsd));

    // Spec 11 §7.4.2 and §7.4.5 — main holds the deck and can draw neither a
    // Mermaid diagram nor a video's poster frame: one needs a live layout to
    // measure text with, the other needs a decoder and a canvas. Both are here.
    // So main asks, and this answers with a PNG.
    const offRender = window.rex.onRenderRequest((request) => {
      const draw = async (): Promise<{ png: Uint8Array; durationSeconds?: number }> =>
        request.kind === "poster"
          ? await posterFramePng(request.source)
          : { png: await drawDiagramPng(request.source) };

      void draw()
        .then((drawn) =>
          window.rex.renderResult({
            id: request.id,
            pngBase64: btoa(String.fromCharCode(...drawn.png)),
            error: null,
            ...(drawn.durationSeconds === undefined
              ? {}
              : { durationSeconds: drawn.durationSeconds }),
          }),
        )
        .catch((error: unknown) =>
          // The Apply run fails with this sentence rather than inserting an
          // empty box, because a picture nobody can read is worse than a
          // refusal a reviewer can act on.
          window.rex.renderResult({
            id: request.id,
            pngBase64: null,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    });

    // §5.6.1 — the agent has written to disk and is waiting. The document on
    // screen is re-rendered if it is one of the files that changed, so the
    // reviewer reads the new text rather than the text it replaced.
    const offApply = window.rex.onApplyReady((event) => {
      setPendingApply(event);
      pendingApplyRef.current = event;
      // Before anything is re-rendered or re-swept — see the ref's own note.
      orphansBeforeApply.current = new Set(
        resolvedRef.current.filter((e) => e.state === "orphaned").map((e) => e.threadId),
      );
      const current = docRef.current;
      const path = current?.ref.value ?? null;
      if (!current || !path || !event.files.includes(path)) {
        void refreshChangeBoxes();
        return;
      }
      void guard(async () => {
        const reopened = await window.rex.docOpen(current.ref);
        surfaceRef.current = null;
        setDoc(reopened);
      });
    });

    return () => {
      offStep();
      offCost();
      offApply();
      offRender();
    };
  }, [guard, refreshChangeBoxes]);

  // ── Commands ────────────────────────────────────────────────

  /**
   * Read through a ref rather than closed over, so this callback keeps one
   * identity for the life of the app.
   *
   * DocumentView's tier 1 effect depends on it: give it a new identity and the
   * effect re-runs, which rewrites the iframe's `srcdoc` — reloading the
   * document under review, throwing away its scroll position and the scope
   * chain the panel's chips point into. Arming a region did exactly that, so
   * the drag that followed had nothing left to cut from.
   */
  const armingRef = useRef(false);
  armingRef.current = arming;

  /** One `Selected` as the panel stores it. */
  const itemFor = useCallback((next: Selected, current: OpenedDocument): SelectionItem => {
    return newSelectionItem({
      kind: next.scopes[next.active]?.kind ?? "text",
      documentId: current.documentId,
      documentRef: current.ref,
      documentName: nameOf(current.ref),
      anchor: next.anchor,
      label: next.label,
      rect: next.rect,
      zoom: zoomRef.current,
    });
  }, []);

  /** §3.1 — everything selected is added. The three rules live in selection.ts. */
  const addSelected = useCallback(
    (next: Selected): void => {
      const current = docRef.current;
      if (!current) return;
      setSelection((items) => addSelectionItem(items, itemFor(next, current)));
    },
    [itemFor],
  );

  /**
   * Spec 06 §4.3 — a whole file, from the tree, without opening it.
   *
   * `doc:open` is what registers a file and hands back its id, and it is used
   * here for exactly that and nothing else: the pane is left showing whatever
   * the reviewer was reading. Rendering it is the price of a real `documentId`
   * and a real title, and it is the same work opening it would have done.
   *
   * The anchor is `createDocumentAnchor()` — all four layers null. §4.5 calls
   * it the one anchor that cannot move, so it needs no rect, draws no outline
   * (§6.4) and resolves in any document that still opens.
   */
  const selectWholeFile = useCallback(
    (path: string): void => {
      void guard(async () => {
        const ref: DocumentRef = { kind: "file", value: path };
        const opened = await window.rex.docOpen(ref);
        setSelection((items) =>
          addSelectionItem(
            items,
            newSelectionItem({
              kind: "element",
              documentId: opened.documentId,
              documentRef: ref,
              documentName: nameOf(ref),
              anchor: createDocumentAnchor(),
              label: "The whole document",
              rect: null,
              zoom: zoomRef.current,
            }),
          ),
        );
        // The panel is where the row landed, so that is where to look.
        setSidebarTab("selection");
      });
    },
    [guard],
  );

  /**
   * Spec 06 §5.3 and §6.2 — a finished drawing fills the panel.
   *
   * It adds its places the same way a click does, through the same three rules,
   * so everything spec 05 provides comes free: reorder the rows, drop one that
   * was caught by accident, widen one with the chips, add a sixth by clicking.
   * A drawing is a fast way to fill the panel, not a second way to make a
   * comment.
   */
  const finishDrawing = useCallback(
    (strokes: Stroke[]): void => {
      void guard(async () => {
        const surface = surfaceRef.current;
        const current = docRef.current;
        setPenning(false);
        if (!surface || !current) return;

        const found = await surface.targetsFromDrawing(strokes, zoomRef.current);
        if (found.targets.length === 0) return;

        let next = selectionRef.current;
        for (const one of found.targets) next = addSelectionItem(next, itemFor(one, current));
        setSelection(next);
        selectionRef.current = next;

        // §5.4 — fractions of the union box of the comment's targets, taken
        // *after* the drawn places have joined it. Anything else and the ink
        // would be stretched the moment it was first drawn.
        const union = unionOfRects(
          next
            .filter((item) => item.documentId === current.documentId)
            .map((item) =>
              item.rect ? rescaleRect(item.rect, zoomRef.current / item.zoom) : null,
            ),
        );
        setSelectionStroke(union ? strokeRefFrom(found.strokes, union, PEN_WIDTH) : null);
      });
    },
    [guard, itemFor],
  );

  const onSelectionChanged = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface || armingRef.current) return;
    const next = await surface.selectionMade();
    // A click with nothing selected adds nothing — and, unlike the composer it
    // replaces, takes nothing away either (§4, fault 3).
    if (next) addSelected(next);
  }, [addSelected]);

  /**
   * Remove a comment for good. Shared by the card's header and the list's rows,
   * because "delete this comment" must mean exactly one thing wherever it is
   * asked for — including what it tidies up afterwards.
   *
   * The confirm belongs to the caller, next to the control the reviewer
   * pressed; by the time this runs the decision is made.
   */
  const removeThread = useCallback(
    (threadId: string): void => {
      void guard(async () => {
        await window.rex.threadDelete(threadId);
        // Whatever was showing this comment is now showing one that does not
        // exist, and the trace sheet belongs to a single comment.
        setActiveId((current) => (current === threadId ? null : current));
        setTraceId((current) => (current === threadId ? null : current));
        await refreshThreads();
        // The tree carries per-file comment counts, and one of them just moved.
        await refreshTree();
      });
    },
    [guard, refreshThreads, refreshTree],
  );

  const withBusy = useCallback(
    async (threadId: string, task: () => Promise<void>): Promise<void> => {
      setBusyThreads((current) => [...current, threadId]);
      try {
        await task();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyThreads((current) => current.filter((id) => id !== threadId));
        await refreshThreads();
        await refreshTree();
      }
    },
    [refreshThreads, refreshTree],
  );

  /** §3.4 — one thread, every item as a target, in panel order. */
  const askAboutSelection = useCallback((): void => {
    void guard(async () => {
      const items = selection;
      const note = selectionNote.trim();
      if (items.length === 0 || note.length === 0) return;

      const thread = await window.rex.threadCreate({
        targets: items.map((item) => ({ documentId: item.documentId, anchor: item.anchor })),
        note,
        // §5.4 — the ink rides inside the payload that already exists; §10's
        // IPC contract is unchanged.
        stroke: selectionStroke ?? undefined,
      });

      setSelection([]);
      setSelectionNote("");
      setSelectionStroke(null);
      setExpandedItemId(null);
      setRowScopes(null);
      // §3.4 — the panel is empty, so nothing in REX is about that passage any
      // more. The browser's own selection is not the panel's and does not go
      // with it, so it is dropped by hand or the text stays blue in the
      // document with nothing left pointing at it.
      surfaceRef.current?.clearTextSelection();
      leavePick();
      leavePen();

      await refreshThreads();
      await sweep();
      setActiveId(thread.id);

      // Spec 12 §3.2 and §4 — the panel's mode becomes the new thread's mode,
      // and decides which channel this first send reaches. ACT here is the flow
      // §1.3 says was missing: a reviewer who already knows what they want does
      // not have to ask a question first.
      const mode = selectionMode;
      setMode(thread.id, mode);
      await withBusy(thread.id, async () => {
        if (mode === "act") await window.rex.threadApply({ threadId: thread.id, note });
        else await window.rex.threadAsk(thread.id);
      });
    });
  }, [
    guard,
    leavePen,
    leavePick,
    refreshThreads,
    selection,
    selectionMode,
    selectionNote,
    selectionStroke,
    sweep,
    withBusy,
  ]);

  const removeItem = useCallback((id: string): void => {
    setSelection((items) => {
      const next = items.filter((item) => item.id !== id);
      // §3.4 — a note with nothing to attach it to is not a thing REX has a
      // place for, and keeping it invisibly to reappear later is worse.
      if (next.length === 0) {
        setSelectionNote("");
        // Nor is ink with nothing left to be drawn around.
        setSelectionStroke(null);
      }
      return next;
    });
    setExpandedItemId((current) => (current === id ? null : current));
  }, []);

  const clearSelection = useCallback((): void => {
    setSelection([]);
    setSelectionNote("");
    setSelectionStroke(null);
    setExpandedItemId(null);
    setRowScopes(null);
    // The same reason as Ask's — see the note there.
    surfaceRef.current?.clearTextSelection();
  }, []);

  /**
   * Spec 10 §3.3 — the excluded paths, live, for the fan-out below.
   *
   * A ref because `askAll` is on a keyboard binding whose effect must not be
   * torn down and rebuilt every time the tree is re-scanned.
   */
  const excludedRef = useRef<string[]>([]);
  excludedRef.current = tree?.excluded ?? [];

  const askAll = useCallback(async (): Promise<void> => {
    const waiting = threadsRef.current.filter((thread) => thread.messages.length === 0);
    // §3.3 — a comment about nothing but excluded documents is not asked. It
    // stays in the list and can still be asked on its own; what it stops doing
    // is costing money on a fan-out over a folder the reviewer has set aside.
    const excluded = excludedRef.current;
    const unanswered = waiting.filter((thread) => !outOfReviewScope(thread.targetRefs, excluded));
    const skipped = waiting.length - unanswered.length;
    if (unanswered.length === 0) {
      // Saying nothing here would read as "there was nothing to ask", which is
      // the opposite of what happened.
      if (skipped > 0) {
        setNotice(
          `Nothing asked — ${skipped} unanswered comment${skipped === 1 ? " is" : "s are"} about documents excluded from the review.`,
        );
      }
      return;
    }
    if (skipped > 0) {
      setNotice(
        `Skipped ${skipped} comment${skipped === 1 ? "" : "s"} about documents excluded from the review.`,
      );
    }
    if (unanswered.length > FAN_OUT_CONFIRM) {
      // §8.8 point 4 — a deliberate gate before spending money on a fan-out.
      const estimate = (unanswered.length * ESTIMATED_USD_PER_ASK).toFixed(2);
      const proceed = window.confirm(
        `Ask ${unanswered.length} comments? Each is its own session, so the estimate is about $${estimate}.`,
      );
      if (!proceed) return;
    }
    // Main caps real concurrency at five (§8.8 point 2).
    await Promise.all(
      unanswered.map((thread) => withBusy(thread.id, () => window.rex.threadAsk(thread.id))),
    );
  }, [withBusy]);

  // ── Picking (design/selection) ──────────────────────────────

  const probe = useCallback((x: number, y: number) => {
    void (async () => {
      const keep = pickChosenByHand.current ? pickActiveRef.current : NO_KEPT_SCOPE;
      const found = (await surfaceRef.current?.probeAt(x, y, keep)) ?? null;
      if (!found) return;
      setPickScopes(found.scopes);
      // Usually the smallest anchorable element; the surface says otherwise when
      // the reviewer had already widened and that element is still in the chain.
      setPickActive(found.active);
    })();
  }, []);

  /** ↑ ↓ or a crumb. This, and only this, is a deliberate widening. */
  const choosePickScope = useCallback((index: number): void => {
    pickChosenByHand.current = true;
    setPickActive(index);
  }, []);

  const scrollDocument = useCallback((dx: number, dy: number) => {
    surfaceRef.current?.scrollBy(dx, dy);
  }, []);

  /**
   * A click in pick mode adds a place and stays in pick mode.
   *
   * §3.1 — nothing replaces anything and no modifier is involved, so picking a
   * fourth and a fifth costs one click each. `P` or escape leaves.
   */
  const commitScope = useCallback(
    (index: number) => {
      void (async () => {
        const next = await surfaceRef.current?.anchorFromScope(index);
        if (next) addSelected(next);
      })();
    },
    [addSelected],
  );

  /**
   * A click in pick mode: probe where it landed, then commit that.
   *
   * The probe is repeated rather than assumed, because the click is the first
   * moment REX is certain where the reviewer meant. Both of the ways the old
   * "commit whatever the last pointer move found" could come up empty are the
   * same failure to a reviewer — pick mode simply does nothing:
   *
   *   · No pointer move since entering pick mode, so nothing was ever probed.
   *     That is the common case immediately after reading or selecting text,
   *     when the pointer is already resting where the reviewer is looking.
   *   · A chain left null by something else. `selectionMade` used to do exactly
   *     that on any mouse-up that selected nothing.
   *
   * A deliberate widening still survives, by the same `keep` the hover probe
   * uses: `keptIndex` carries the chosen ELEMENT into the new chain.
   */
  const commitAt = useCallback(
    (x: number, y: number) => {
      void (async () => {
        const surface = surfaceRef.current;
        if (!surface) return;
        const keep = pickChosenByHand.current ? pickActiveRef.current : NO_KEPT_SCOPE;
        const found = await surface.probeAt(x, y, keep);
        if (!found) {
          // Nothing anchorable under the point: a margin, or the gap between
          // two blocks. `probe` leaves the outline where it was in exactly this
          // case, so the reviewer is looking at a highlighted table while the
          // click lands on `<body>` — and doing nothing here is what made a
          // wide block feel unselectable. Measured on 2026-08-23: six pixels
          // outside a table on any of its four sides, the outline still read
          // `table` and the click added nothing.
          //
          // The outline is REX's promise about what a click takes, so take it.
          // Where the probe DOES find something the outline is already showing
          // that same thing, so this branch changes nothing about a normal
          // click — it only stops the promise being broken.
          if (!pickScopesRef.current?.length) return;
          const shown = await surface.anchorFromScope(pickActiveRef.current);
          if (shown) addSelected(shown);
          return;
        }
        setPickScopes(found.scopes);
        setPickActive(found.active);
        const next = await surface.anchorFromScope(found.active);
        if (next) addSelected(next);
      })();
    },
    [addSelected],
  );

  // ── The selection panel ─────────────────────────────────────

  /** §3.3 and §4.1 — focus a row: open its document, scroll to it, offer chips. */
  /**
   * Spec 08 §7 — take me to this place.
   *
   * The same two steps a finding's Open takes: scroll if the document is
   * already here, otherwise open it and let `onSurfaceReady` do the scrolling,
   * because there is no DOM to scroll until then.
   */
  const goToPlace = useCallback(
    (thread: ThreadWithMessages, position: number) => {
      const target = thread.targets[position];
      const ref = thread.targetRefs[position];
      if (!target) return;

      void guard(async () => {
        if (docRef.current?.documentId === target.documentId) {
          surfaceRef.current?.scrollToAnchor(target.anchor);
          return;
        }
        // Nothing to open with — the document record is gone. Saying so beats
        // a click that silently does nothing.
        if (!ref) {
          setNotice(`${thread.targetNames[position] ?? "That document"} is no longer in REX.`);
          return;
        }
        setCentre("document");
        anchorWhenReady.current = { path: ref.value, anchor: target.anchor };
        await openDocument(ref);

        // `openDocument` closes the open card, because in general the comment
        // you were reading need not be about the document you just opened. A
        // place jump is the case where it always is — and closing the card
        // takes away the list of places the reviewer is working through.
        setActiveId(thread.id);
      });
    },
    [guard, openDocument],
  );

  const expandRow = useCallback(
    (item: SelectionItem) => {
      void guard(async () => {
        if (docRef.current?.documentId !== item.documentId) {
          setExpandedItemId(item.id);
          expandedBase.current = item;
          scrollWhenReady.current = item;
          await openDocument(item.documentRef);
          return;
        }

        surfaceRef.current?.scrollToAnchor(item.anchor);

        if (expandedItemId === item.id) {
          setExpandedItemId(null);
          setRowScopes(null);
          expandedBase.current = null;
          return;
        }

        setExpandedItemId(item.id);
        expandedBase.current = item;
        const probed = await surfaceRef.current?.scopesForAnchor(item.anchor, item.kind);
        setRowScopes(probed?.scopes ?? null);
        setRowActive(probed?.active ?? 0);
      });
    },
    [expandedItemId, guard, openDocument],
  );

  /**
   * §4.1 — widening a row is exactly re-anchoring it.
   *
   * The chain is rebuilt from the anchor the row had when it was expanded, not
   * from the one it has now: re-anchoring to the table would otherwise drop
   * every scope narrower than the table, and the reviewer could widen once and
   * never come back.
   */
  const changeRowScope = useCallback(
    (index: number) => {
      void guard(async () => {
        const base = expandedBase.current;
        const surface = surfaceRef.current;
        if (!base || !surface) return;

        const next = await surface.anchorFromAnchorScope(base.anchor, base.kind, index);
        if (!next) return;

        setSelection((items) =>
          items.map((item) =>
            item.id === base.id
              ? {
                  ...item,
                  kind: next.scopes[next.active]?.kind ?? item.kind,
                  anchor: next.anchor,
                  label: next.label,
                  rect: next.rect,
                  zoom: zoomRef.current,
                }
              : item,
          ),
        );
        setRowScopes(next.scopes);
        setRowActive(next.active);
        setArming(false);
      });
    },
    [guard],
  );

  const armRegion = useCallback(() => {
    if (!rowScopes) return;
    // The layer has to be up to catch the drag, and it needs the expanded row's
    // own chain so the box is cut from the element the chips point at.
    setPickScopes(rowScopes);
    setPickActive(rowActive);
    setPicking(true);
    setArming(true);
  }, [rowActive, rowScopes]);

  /** A dragged box re-anchors the expanded row, exactly as a chip does. */
  const takeRegion = useCallback(
    (index: number, box: ScopeRect) => {
      void guard(async () => {
        const base = expandedBase.current;
        const next = await surfaceRef.current?.anchorFromRegion(index, box);
        setArming(false);
        setPicking(false);
        if (!next || !base) return;
        setSelection((items) =>
          items.map((item) =>
            item.id === base.id
              ? {
                  ...item,
                  // A region is always cut from an element, whatever the row was
                  // before, and the chain has to be rebuilt through that element.
                  kind: "element",
                  anchor: next.anchor,
                  label: next.label,
                  rect: next.rect,
                  zoom: zoomRef.current,
                }
              : item,
          ),
        );
      });
    },
    [guard],
  );

  // ── Keyboard (design/screens/Main) ──────────────────────────
  //
  // Bare letters, because every one of these is a thing the reviewer does
  // dozens of times in a session and a chord would be slower than the mouse.
  // They are all suppressed while a field has focus — `typing()` — so writing
  // the word "pd" in a comment never switches panes.
  //
  // ⌥ held for a moment is pick mode too: hover never outlines things while you
  // are only reading, and it never competes with dragging a text selection.
  useEffect(() => {
    let altTimer: number | null = null;

    /**
     * `composedPath()[0]`, not `event.target`.
     *
     * REX draws inside a shadow root (§7), and an event that crosses that
     * boundary is retargeted: by the time it reaches `document` the target is
     * the shadow *host*, never the field that has focus. So this test never
     * matched, every bare letter fired its shortcut while the reviewer was
     * typing a comment, and `preventDefault` swallowed the character on the way
     * out. Measured on 2026-08-21: typing "pdga" into the note left the note
     * empty and the app showing the graph.
     */
    const typing = (event: KeyboardEvent): boolean => {
      const node = event.composedPath()[0];
      return (
        node instanceof HTMLElement &&
        (node.tagName === "TEXTAREA" || node.tagName === "INPUT" || node.isContentEditable)
      );
    };

    const canPick = doc !== null && centre === "document";

    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === "Alt" &&
        altTimer === null &&
        !arming &&
        !penning &&
        canPick &&
        !typing(event)
      ) {
        altTimer = window.setTimeout(() => setPicking(true), ALT_PICK_DELAY);
        return;
      }
      // Zoom the document, the way every reader expects: ⌘/ctrl with + − 0.
      // Handled before the modifier guard below, because the modifier is the
      // binding. `=` as well as `+`, so the key does not need ⇧ on a US layout.
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
        else if (event.key === "-" || event.key === "_") zoomBy(1 / ZOOM_STEP);
        else if (event.key === "0") setZoom(1);
        else return;
        event.preventDefault();
        return;
      }

      // ⇧ is a modifier one of these bindings uses, so it is not disqualifying;
      // the rest are.
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event)) return;

      switch (event.key) {
        case "p":
        case "P":
          if (!canPick) return;
          setPenning(false);
          setPicking((on) => !on);
          break;
        case "n":
        case "N":
          // Spec 06 §5.1 — `P` is already pick, and `N` is the free letter in
          // "pen". Both layers swallow the pointer, so only one can be on.
          if (!canPick) return;
          setPicking(false);
          setPenning((on) => !on);
          break;
        case "d":
        case "D":
          void showCentre("document");
          break;
        case "g":
        case "G":
          // The graph is a view of a workspace; without one there is nothing to
          // draw, and the button is not offered either.
          if (!workspace) return;
          void showCentre("graph");
          break;
        case "A":
          // Shift+A only. A bare `a` would fire a fan-out of paid sessions on a
          // keystroke, which §8.8 point 4 already treats as worth confirming.
          if (!event.shiftKey) return;
          void askAll();
          break;
        case "b":
        case "B":
          // Spec 13 §4.1 — the free letter, and the mnemonic one. It writes a
          // string to the clipboard, so unlike ⇧A it needs no shift to be safe.
          void copyDebug();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== "Alt") return;
      if (altTimer !== null) {
        window.clearTimeout(altTimer);
        altTimer = null;
      }
      if (!arming) setPicking(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      if (altTimer !== null) window.clearTimeout(altTimer);
    };
  }, [arming, askAll, centre, copyDebug, doc, penning, showCentre, workspace, zoomBy]);

  // ── Apply (§8.7, spec 05 §5.6.1) ────────────────────────────

  const decideApply = useCallback(
    (accept: boolean) =>
      guard(async () => {
        const target = pendingApply;
        if (!target) return;
        // Cleared first, so the sweep main drives from inside `applyConfirm`
        // does not redraw change outlines over a document that was just undone.
        setPendingApply(null);
        pendingApplyRef.current = null;
        setChangeBoxes([]);

        const before = orphansBeforeApply.current;

        const response = await window.rex.applyConfirm({
          applyRunId: target.applyRunId,
          accept,
        });
        const list = await refreshThreads();

        if (!accept) {
          setNotice("Undone — every file was restored with git checkout.");
          return;
        }

        // §8.7 step 7 — report the sweep, and name what it cost. "1 newly
        // orphaned" is complete; *which one* is what the reviewer needs.
        const newlyOrphaned = resolvedRef.current
          .filter((entry) => entry.state === "orphaned" && !before.has(entry.threadId))
          .map((entry) => list.find((thread) => thread.id === entry.threadId))
          .filter((thread): thread is ThreadWithMessages => thread !== undefined);

        setApplyOutcome({ summary: response.reanchored, files: target.files, newlyOrphaned });
      }),
    [guard, pendingApply, refreshThreads],
  );

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  /**
   * One reply path, two boxes. The comment card has one and the trace sheet has
   * one, and they send the same message to the same thread — so the handler is
   * written once here rather than inlined at each of them, where the two could
   * quietly stop agreeing about what a reply does.
   */
  /**
   * Spec 12 §4 — one gesture, two destinations.
   *
   * The card and the trace sheet both call this, and the mode decides which
   * channel it reaches. That is the whole change: before, the reply box always
   * went to the read profile, so "yes, do that" could not be sent and the
   * reviewer had to find a different button and let the agent infer the
   * instruction from the transcript.
   */
  const replyToActive = (text: string): void => {
    if (!active) return;
    const threadId = active.id;
    if (modeOf(threadId) === "act") {
      void withBusy(threadId, async () => {
        await window.rex.threadApply({ threadId, note: text });
      });
      return;
    }
    void withBusy(threadId, () => window.rex.threadReply({ threadId, text }));
  };

  const unanswered = threads.filter((thread) => thread.messages.length === 0).length;
  const applyTarget = pendingApply
    ? (threads.find((thread) => thread.id === pendingApply.threadId) ?? null)
    : null;

  // §3.3 — the comments column is hidden behind the graph, but never while the
  // panel holds something. Losing sight of a half-built selection because you
  // went to look at the graph is the same fault as losing it to a stray click.
  const sideHidden = centre !== "document" && selection.length === 0;

  return (
    <div className="rex-app" ref={appRef}>
      <TopBar
        doc={doc}
        workspace={workspace}
        centre={centre}
        cost={cost}
        unanswered={unanswered}
        zoom={zoom}
        onResetZoom={resetZoom}
        onCentre={showCentre}
        onAskAll={askAll}
        onOpenFile={pick}
        onOpenFolder={pickFolder}
        onDebug={copyDebug}
      />

      {notice ? (
        <div className="rex-notice">
          <span>{notice}</span>
          <span className="rex-spacer" />
          <button type="button" className="rex-link" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      <div className="rex-body">
        {tree ? (
          <>
            <Explorer
              tree={tree}
              width={explorerWidth}
              activePath={selectedPath}
              showSkipped={showSkipped}
              onOpen={(path) => void guard(() => openDocument({ kind: "file", value: path }))}
              onReload={refreshTree}
              onSelectFile={selectWholeFile}
              onExclude={(path, exclude) => void setExcluded(path, exclude)}
              onToggleSkipped={() => void toggleShowSkipped()}
            />
            <Splitter
              width={explorerWidth}
              min={200}
              max={640}
              direction={1}
              label="the explorer"
              onChange={setExplorerWidth}
            />
          </>
        ) : null}

        <div className="rex-centre">
          {/*
            DocumentView stays mounted behind the graph rather than being
            swapped out: unmounting it would drop the iframe, and with it the
            anchor surface and the highlight registry the resolver just built.
          */}
          {/*
            Spec 08 §6.1 — the trace covers the document pane and nothing else.
            The pane is hidden rather than unmounted, for the same reason it is
            hidden behind the graph: unmounting drops the iframe, and with it
            the anchor surface and the highlight registry the resolver built.
          */}
          <div
            className={`rex-pane${centre === "document" && traceId === null ? "" : " rex-pane-hidden"}`}
          >
            <DocumentView
              doc={doc}
              resolved={resolved}
              threads={threads}
              activeId={activeId}
              selection={selection}
              hoveredItemId={hoveredItemId}
              onHoverItem={setHoveredItemId}
              onRemoveItem={removeItem}
              changeBoxes={changeBoxes}
              picking={picking}
              pickScopes={pickScopes}
              pickActive={pickActive}
              arming={arming}
              penning={penning}
              selectionStroke={selectionStroke}
              hoveredThreadId={hoveredThreadId}
              hoveredPlace={hoveredPlace}
              onTogglePick={() => {
                setPenning(false);
                setPicking((on) => !on);
              }}
              onTogglePen={() => {
                setPicking(false);
                setPenning((on) => !on);
              }}
              onDrawn={finishDrawing}
              onPenCancel={leavePen}
              onSurfaceReady={onSurfaceReady}
              onSelectionChanged={onSelectionChanged}
              onPreview={setPreview}
              onPaneResized={onPaneResized}
              onSelectMarker={setActiveId}
              onScrollBy={scrollDocument}
              zoom={zoom}
              onZoomBy={zoomBy}
              onZoomReset={resetZoom}
              onZoomApplied={onZoomApplied}
              onProbe={probe}
              onPickActive={choosePickScope}
              onPickCommit={commitScope}
              onPickCommitAt={commitAt}
              onPickCancel={leavePick}
              onRegion={takeRegion}
            />
          </div>

          {/*
            Only where the document pane is. The trace covers that pane; over
            the graph it would be covering someone else's. The id survives the
            trip, so coming back brings the sheet back.
          */}
          {centre === "document" && traceId !== null && active !== null ? (
            <TraceSheet
              thread={active}
              number={numbers.get(active.id) ?? 0}
              tokenClass={tokenClass(active.status, stateById.get(active.id) ?? null)}
              busy={busyThreads.includes(active.id)}
              mode={modeOf(active.id)}
              onClose={() => setTraceId(null)}
              onReply={replyToActive}
            />
          ) : null}

          {centre === "graph" ? (
            graph ? (
              <GraphView
                graph={graph}
                selectedPath={selectedPath}
                onSelect={(path) => {
                  // Selecting stays on the graph so the connections it just lit
                  // up remain visible. A document is opened behind it, which is
                  // what syncs the explorer and loads its comments; an external
                  // or missing file is selected and nothing more.
                  setSelectedPath(path);
                  const node = graph.nodes.find((n) => n.id === path);
                  if (node?.kind === "document") {
                    void guard(() => openDocument({ kind: "file", value: path }));
                  }
                }}
                onOpen={(path) => {
                  setCentre("document");
                  void guard(async () => {
                    await openDocument({ kind: "file", value: path });
                  });
                }}
              />
            ) : (
              <p className="rex-meta rex-graph-loading">Reading the workspace…</p>
            )
          ) : null}
        </div>

        {/*
          Hidden rather than unmounted so an in-progress reply survives a look
          at the graph.
        */}
        {sideHidden ? null : (
          <Splitter
            width={commentsWidth}
            min={300}
            max={760}
            direction={-1}
            label="the comments panel"
            onChange={setCommentsWidth}
          />
        )}
        <aside
          className={`rex-side${sideHidden ? " rex-pane-hidden" : ""}`}
          style={{ width: commentsWidth }}
        >
          {/*
            Spec 08 §3.1 — the tab bar is furniture. It is here whatever the
            column holds, and an empty selection dims its tab rather than
            removing the bar.
          */}
          <SidebarTabs
            tab={sidebarTab}
            selectionCount={selection.length}
            commentCount={threads.length}
            onTab={setSidebarTab}
          />

          {sidebarTab === "selection" ? (
            <SelectionPanel
              items={selection}
              note={selectionNote}
              openDocumentId={doc?.documentId ?? null}
              expandedId={expandedItemId}
              scopes={rowScopes}
              scopeActive={rowActive}
              arming={arming}
              hoveredId={hoveredItemId}
              mode={selectionMode}
              onMode={setSelectionMode}
              onNote={setSelectionNote}
              onExpand={expandRow}
              onScope={changeRowScope}
              onArmRegion={armRegion}
              onRemove={removeItem}
              onClear={clearSelection}
              onAsk={askAboutSelection}
              onHover={setHoveredItemId}
              onReorder={(from, to) => setSelection((items) => moveSelectionItem(items, from, to))}
            />
          ) : active ? (
            <CommentCard
              thread={active}
              number={numbers.get(active.id) ?? 0}
              anchorState={stateById.get(active.id) ?? null}
              targetStates={targetStatesById.get(active.id) ?? []}
              targetPlaces={targetPlacesById.get(active.id) ?? []}
              busy={busyThreads.includes(active.id)}
              mode={modeOf(active.id)}
              onMode={(mode) => setMode(active.id, mode)}
              tracing={traceId === active.id}
              openDocumentId={doc?.documentId ?? null}
              hoveredPlace={hoveredPlace}
              onHoverPlace={setHoveredPlace}
              onGoToPlace={(position) => goToPlace(active, position)}
              onShowTrace={() => setTraceId(traceId === active.id ? null : active.id)}
              onBack={() => {
                setActiveId(null);
                // The sheet belongs to one comment, so it goes with it.
                setTraceId(null);
              }}
              onReply={replyToActive}
              onResolve={(resolvedFlag) =>
                void withBusy(active.id, async () => {
                  await window.rex.threadResolve({ threadId: active.id, resolved: resolvedFlag });
                })
              }
              onDelete={() => removeThread(active.id)}
            />
          ) : (
            <Sidebar
              threads={threads}
              stateById={stateById}
              labelById={labelById}
              busyThreads={busyThreads}
              onSelect={setActiveId}
              onHover={setHoveredThreadId}
              onDelete={removeThread}
              onSynthesise={(refThreadIds, note) =>
                void guard(async () => {
                  const current = docRef.current;
                  if (!current) return;
                  const thread = await window.rex.threadSynthesise({
                    documentId: current.documentId,
                    refThreadIds,
                    note,
                  });
                  await refreshThreads();
                  setActiveId(thread.id);
                  await withBusy(thread.id, () => window.rex.threadAsk(thread.id));
                })
              }
            />
          )}
        </aside>
      </div>

      {pendingApply ? (
        <DiffDialog
          event={pendingApply}
          thread={applyTarget}
          number={numbers.get(pendingApply.threadId) ?? 0}
          anchorState={stateById.get(pendingApply.threadId) ?? null}
          outlined={changeBoxes.length}
          openDocumentPath={doc?.ref.value ?? null}
          onOpenFile={(path) => void guard(() => openDocument({ kind: "file", value: path }))}
          onDecide={decideApply}
        />
      ) : null}

      {/*
        Spec 10 §2.3 — over everything, including the two bars above, because it
        is a thing you open, read and dismiss rather than a thing you work
        beside. It takes the keyboard with it: its own capture-phase listener on
        `document` runs before the bindings below and stops them, so no guard is
        needed here and there is only one place that decides.
      */}
      {preview ? <Lightbox figure={preview} onClose={() => setPreview(null)} /> : null}

      {applyOutcome ? (
        <ApplyResult
          summary={applyOutcome.summary}
          files={applyOutcome.files}
          newlyOrphaned={applyOutcome.newlyOrphaned}
          onClose={() => setApplyOutcome(null)}
          onShowOrphans={() => {
            const first = applyOutcome.newlyOrphaned[0];
            setApplyOutcome(null);
            if (first) setActiveId(first.id);
          }}
        />
      ) : null}
    </div>
  );
}
