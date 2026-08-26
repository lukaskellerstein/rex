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
  CommentGroup,
  CommentMove,
  DocumentRef,
  DocumentVersion,
  LineRange,
  Message,
  OpenedDocument,
  PaneMode,
  ReferenceGraph,
  ThreadWithMessages,
  ViewState,
  WorkingCopyView,
  WorkspaceRef,
  WorkspaceTree,
} from "../../shared/types.ts";
import { createDocumentAnchor } from "../anchor/create.ts";
import type { Stroke } from "../anchor/lasso.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import { ApplyResult } from "./ApplyResult.tsx";
import {
  type DocumentSurface,
  type GapSpot,
  mergeResolved,
  NO_KEPT_SCOPE,
  type ResolvedThread,
  type Selected,
} from "./anchoring.ts";
import { CommentCard } from "./CommentCard.tsx";
import { DiffDialog } from "./DiffDialog.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { type ChangeCounts, Explorer } from "./Explorer.tsx";
import { GraphView } from "./GraphView.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { drawDiagramPng, posterFramePng } from "./mermaid.ts";
import type { Mode } from "./mode.ts";
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
import { tokenClass } from "./wash.ts";

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

/**
 * Spec 16 §4.1 — the lines this document's working copy added or altered, which
 * is the set the new-version pane will answer a gesture on.
 *
 * `null` — no working copy — means everything is live, which is Reading mode
 * and every document nobody has changed. A non-null EMPTY list is a different
 * thing and is left empty deliberately: this pane has a change to show and no
 * way to say which blocks it touched (a plain HTML file has no `data-src-line`
 * to go on), so nothing is live and every comment goes on the left.
 *
 * It is the same list spec 15 §6.2 already outlines in green, so the affordance
 * needs no new furniture: what is outlined is what responds.
 */
function liveRangesOf(doc: OpenedDocument | null): LineRange[] | null {
  if (!doc?.working) return null;
  const path = doc.ref.value;
  return doc.working.added
    .filter((region) => region.file === path)
    .map((region) => ({ from: region.from, to: region.to }));
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
  /**
   * Spec 14 §5 — the reviewer's groups for this workspace, flat.
   *
   * The tree is built where it is drawn, from `shared/commentTree.ts`, which is
   * the same function main walks to decide the order `threads` arrives in. Two
   * implementations of one order is the bug §4.4 exists to prevent.
   */
  const [groups, setGroups] = useState<CommentGroup[]>([]);
  /**
   * Spec 16 §5.2 — the MERGED answer: per target the best of the two panes.
   *
   * Everything that asks "what state is this comment in?" reads this, and
   * nothing else may: taking the worst across the two panes would report every
   * comment on unchanged text as orphaned the moment a working copy existed.
   */
  const [resolved, setResolved] = useState<ResolvedThread[]>([]);
  /**
   * §5.2 — and each pane's own sweep, because each pane's lane draws from its
   * own. Where a bar appears is not computed; it is what that sweep found.
   */
  const [paneResolved, setPaneResolved] = useState<{
    original: ResolvedThread[];
    current: ResolvedThread[];
  }>({ original: [], current: [] });
  /** Spec 16 §6.6 — the gaps the `+ Add` affordance can appear in. */
  const [gaps, setGaps] = useState<GapSpot[]>([]);
  /**
   * §6.1 — the gap the pointer is over, if any.
   *
   * A ref rather than state: it is read by a key binding and never drawn, and
   * making it state would re-render the whole shell on every pointer move
   * across a band.
   */
  const offeredGap = useRef<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cost, setCost] = useState(0);
  const [pendingApply, setPendingApply] = useState<ApplyReadyEvent | null>(null);
  const [applyOutcome, setApplyOutcome] = useState<ApplyOutcome | null>(null);
  /**
   * Spec 15 §6.1 — the left-hand pane's document, rendered from the file.
   *
   * A second `OpenedDocument` and not a flag, because the two panes are two
   * renders of two different byte streams. It is null whenever there is nothing
   * to compare — no working copy, or the control is on `New`.
   */
  const [original, setOriginal] = useState<OpenedDocument | null>(null);
  /** §6.1 — which of the two versions is on screen. `Both` once one exists. */
  const [paneMode, setPaneMode] = useState<PaneMode>("both");
  /** §7.1 — every document with a change waiting, for `Approve all`. */
  const [working, setWorking] = useState<WorkingCopyView[]>([]);
  /**
   * Spec 18 §4.3 — the tree's green and red counts, keyed by absolute path.
   *
   * Derived from the working-copy list rather than carried on `TreeEntry`: a
   * block count moves when a run finishes, and the tree is rescanned far less
   * often than that. This way the row is right the moment the change lands.
   */
  const changeCounts = useMemo<ChangeCounts>(
    () =>
      new Map(
        working.map((view) => [
          view.path,
          { added: view.added.length, removed: view.removed.length },
        ]),
      ),
    [working],
  );
  const [busyThreads, setBusyThreads] = useState<string[]>([]);
  /**
   * Spec 17 §3.3 — the threads whose Stop has been pressed and not yet landed.
   *
   * A separate list from `busyThreads` rather than a third state on it, because
   * a stopping thread is still busy: the run has not ended, and everything that
   * is disabled during a run stays disabled. This only changes the word on the
   * spinner and stops the button being pressed twice.
   */
  const [stoppingThreads, setStoppingThreads] = useState<string[]>([]);
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
  /**
   * Spec 16 §4 — which pane the chain above was probed in.
   *
   * A chain holds live elements of one document, and both panes now offer pick
   * mode. Without this the left pane's chain would be drawn over the right
   * pane's prose, at coordinates that mean nothing there.
   */
  const [pickPane, setPickPane] = useState<DocumentVersion>("current");
  const [arming, setArming] = useState(false);
  /** Spec 06 §5.1 — the pen, a mode like pick and off by default. */
  const [penning, setPenning] = useState(false);
  /**
   * Spec 16 §6.6 — Add, a mode like the other two and off by default.
   *
   * It was on whenever the pointer was in a gap, and that is wrong for the same
   * reason pick mode is not: a reviewer moving down a page they are only
   * READING got a rule and a pill thrown across the prose every few lines. An
   * affordance that appears without being asked for is furniture in the way.
   *
   * Held ⇧ arms it, exactly as held ⌥ arms pick.
   */
  const [adding, setAdding] = useState(false);
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
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  /** Hovering a row in the panel lights that comment's passages on the paper. */
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
  /**
   * Spec 16 §4.2 — the original pane's surface.
   *
   * Two live DOMs are resolved against now, both in the renderer, so invariant
   * I1 holds and is exercised harder. Null whenever there is no proposal to
   * compare against, which is every document nobody has changed.
   */
  const originalSurfaceRef = useRef<DocumentSurface | null>(null);
  const docRef = useRef<OpenedDocument | null>(null);
  const threadsRef = useRef<ThreadWithMessages[]>([]);
  const groupsRef = useRef<CommentGroup[]>([]);
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
  /** Which pane the chain on screen belongs to, for the callbacks that commit it. */
  const pickPaneRef = useRef<DocumentVersion>("current");
  /** §4.1 — what the new-version pane answers a gesture on. See `liveRangesOf`. */
  const liveRangesRef = useRef<LineRange[] | null>(null);
  liveRangesRef.current = liveRangesOf(doc);

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
  pickPaneRef.current = pickPane;
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
    const items = selectionRef.current;
    const here = items.filter((item) => item.documentId === openDocumentId);
    if (here.length === 0) return;

    // Spec 16 §4 — each row is measured in the pane it was taken from, and only
    // falls to the other one when its own no longer has it. That is what makes
    // a place survive an approve: the original pane goes, and the row's box is
    // re-found in the one version that is left.
    const measured = new Map<string, { rect: ScopeRect | null; pane: DocumentVersion }>();
    for (const pane of ["current", "original"] as const) {
      const surface = pane === "original" ? originalSurfaceRef.current : surfaceRef.current;
      const wanted = here.filter(
        (item) => !measured.has(item.id) || measured.get(item.id)?.rect === null,
      );
      if (!surface || wanted.length === 0) continue;
      const rects = await surface.rectsForAnchors(
        wanted.map((item) => ({ anchor: item.anchor, kind: item.kind })),
      );
      wanted.forEach((item, position) => {
        const rect = rects[position] ?? null;
        // Its own pane's answer stands even when it is null, unless the other
        // pane can do better — a row that resolves nowhere keeps no box at all.
        if (rect !== null || !measured.has(item.id)) measured.set(item.id, { rect, pane });
      });
    }

    setSelection((current) => {
      let moved = false;
      const next = current.map((item) => {
        const found = measured.get(item.id);
        if (!found) return item;
        if (
          same(item.rect, found.rect) &&
          item.zoom === zoomRef.current &&
          item.pane === found.pane
        )
          return item;
        moved = true;
        return { ...item, rect: found.rect, pane: found.pane, zoom: zoomRef.current };
      });
      // The same list back when nothing moved: this runs on every sweep, and a
      // fresh array each time would re-render the panel and the outlines for
      // nothing.
      return moved ? next : current;
    });
  }, []);

  const sweep = useCallback(async (): Promise<AnchorSummary> => {
    const surface = surfaceRef.current;
    const originalSurface = originalSurfaceRef.current;
    const current = docRef.current;
    const summary: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };
    if (!current || (!surface && !originalSurface)) return summary;

    const inCurrent = surface
      ? await surface.resolve(
          threadsRef.current,
          current.contentChanged,
          current.documentId,
          activeIdRef.current,
        )
      : [];

    // Spec 16 §5.2 — `documentChanged` is ALWAYS false in the original pane.
    // It shows `base`, the file exactly as it was when the working copy was
    // forked, so nothing in it can have moved under an anchor written against
    // it. Passing the document's own `contentChanged` here would report every
    // comment on unchanged text as `moved` the moment any working copy existed.
    const inOriginal = originalSurface
      ? await originalSurface.resolve(
          threadsRef.current,
          false,
          current.documentId,
          activeIdRef.current,
        )
      : [];

    const entries = mergeResolved([inCurrent, inOriginal]);
    resolvedRef.current = entries;
    setResolved(entries);
    setPaneResolved({ current: inCurrent, original: inOriginal });
    setGaps(surface?.gaps() ?? []);
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
    if (!surface || !current || (!pending && !current.working)) {
      setChangeBoxes([]);
      return;
    }
    const path = current.ref.value;
    // Spec 15 §6.2 — the working copy's own added blocks when there is one. It
    // outlives the run that made it, so `pendingApply` is the wrong source the
    // moment a second run lands or the reviewer reopens the document.
    //
    // Spec 16 §4.1 — with a working copy these are also exactly the blocks that
    // answer a gesture here, which is why the outline needs no companion: what
    // is outlined is what responds.
    const ranges =
      liveRangesOf(current) ??
      (pending?.regions ?? [])
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
    // Spec 16 §5.1 — a comment can be about text that only the original has, so
    // opening it has to recolour that pane's passages too.
    originalSurfaceRef.current?.repaintActive(activeId);
  }, [activeId]);

  /**
   * Spec 16 §4.1 — the live set is recomputed whenever the working copy moves:
   * a new revision, an undo, an approve, a discard.
   *
   * A document whose proposal has just been approved or discarded has no
   * working copy any more, so this hands back `null` and the whole pane answers
   * again — which is what Reading mode is.
   *
   * `doc` is the dependency because `doc` is what says the working copy moved;
   * the ranges themselves are read through a ref at call time.
   */
  useEffect(() => {
    surfaceRef.current?.setLiveBlocks(liveRangesRef.current);
  }, [doc]);

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
    async (pane: DocumentVersion, surface: DocumentSurface | null): Promise<void> => {
      if (pane === "original") {
        originalSurfaceRef.current = surface;
        // The left lane has nothing in it until this sweep runs, and a comment
        // on removed text has nowhere at all until then.
        await sweep();
        return;
      }

      surfaceRef.current = surface;
      if (!surface) return;
      // §4.1 — before the first sweep and long before the first gesture: a pane
      // that has not been told what is live would take a comment on anything.
      surface.setLiveBlocks(liveRangesRef.current);
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

  /**
   * Spec 14 §5.3 — the groups of the open workspace, or none.
   *
   * With no workspace there is no root to hang a group on, so the panel shows a
   * flat list and hides the group controls. Emptying the state here is what
   * makes that true rather than leaving the last workspace's groups on screen.
   */
  const refreshGroups = useCallback(async (): Promise<void> => {
    const root = workspaceRef.current?.root ?? null;
    const list = root ? await window.rex.groupList({ root }) : [];
    setGroups(list);
    // A ref as well as state, for the same reason `threadsRef` is one: the debug
    // report (spec 13 §4.2) is assembled inside a callback that must not depend
    // on this render's closure.
    groupsRef.current = list;
  }, []);

  const openDocument = useCallback(
    async (ref: DocumentRef): Promise<void> => {
      setSelectedPath(ref.value);
      const opened = await window.rex.docOpen(ref);
      await refreshGroups();
      const list = await window.rex.threadList(listRequest(opened.documentId));
      surfaceRef.current = null;
      originalSurfaceRef.current = null;
      setActiveId(null);
      setResolved([]);
      setPaneResolved({ original: [], current: [] });
      setGaps([]);
      resolvedRef.current = [];
      // §3.3 — the panel survives. Only the chain belongs to the old DOM, and a
      // chain holds live elements that are about to stop existing.
      setRowScopes(null);
      leavePick();
      leavePen();
      setThreads(list);
      setDoc(opened);
    },
    [leavePen, leavePick, listRequest, refreshGroups],
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
      groups: groupsRef.current.length,
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
    // Both, always. The list arrives in the walk order main computed from these
    // very groups (§4.4); fetching one without the other is how a row ends up
    // drawn under a group that is no longer there.
    await refreshGroups();
    const list = await window.rex.threadList(listRequest(current.documentId));
    setThreads(list);
    threadsRef.current = list;
    return list;
  }, [listRequest, refreshGroups]);

  // ── The name, the order and the groups (spec 14) ────────────
  //
  // Every one of these is the same three steps: send the gesture, then reload
  // the list and the groups together. Nothing is predicted locally — main
  // computes every position (§4.2), and a renderer that guessed one would be
  // right until the first time it was not.

  const renameThread = useCallback(
    (threadId: string, title: string | null) =>
      guard(async () => {
        await window.rex.threadRename({ threadId, title });
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  const createGroup = useCallback(
    async (parentId: string | null, name: string): Promise<string | null> => {
      const root = workspaceRef.current?.root;
      if (!root) return null;
      try {
        const group = await window.rex.groupCreate({ root, parentId, name });
        await refreshThreads();
        return group.id;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [refreshThreads],
  );

  const updateGroup = useCallback(
    (request: { groupId: string; name?: string; collapsed?: boolean }) =>
      guard(async () => {
        await window.rex.groupUpdate(request);
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  const deleteGroup = useCallback(
    (groupId: string) =>
      guard(async () => {
        await window.rex.groupDelete({ groupId });
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  const moveComment = useCallback(
    (move: CommentMove) =>
      guard(async () => {
        await window.rex.commentsMove(move);
        await refreshThreads();
      }),
    [guard, refreshThreads],
  );

  // ── Workspace (spec 02) ─────────────────────────────────────

  const openWorkspace = useCallback(
    (ref: WorkspaceRef) =>
      guard(async () => {
        setWorkspace(ref);
        workspaceRef.current = ref;
        setGraph(null);
        setTree(await window.rex.workspaceTree(ref, showSkipped));
        // Spec 14 §5.3 — groups belong to a root, so they change with it.
        await refreshGroups();
      }),
    [guard, refreshGroups, showSkipped],
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

  // ── Spec 15 §6 and §7 — the working copy ────────────────────

  /** §7.1 — how many documents are waiting, for `Approve all`. */
  const refreshWorking = useCallback(async (): Promise<void> => {
    setWorking(await window.rex.workList());
  }, []);

  useEffect(() => {
    void refreshWorking();
  }, [refreshWorking]);

  /**
   * §6.1 — the left-hand pane follows the right one.
   *
   * Rendered from the file every time the working copy changes, because that is
   * the only moment it can have: `base` and the file agree until somebody edits
   * the file, and §7.3 is what refuses when they stop agreeing.
   */
  useEffect(() => {
    let live = true;
    const wanted = doc?.working && paneMode !== "new" ? doc.ref : null;
    if (!wanted) {
      setOriginal(null);
      return;
    }
    void window.rex
      .docOpen(wanted, "original")
      .then((opened) => {
        if (live) setOriginal(opened);
      })
      .catch(() => {
        if (live) setOriginal(null);
      });
    return () => {
      live = false;
    };
  }, [doc?.working, doc?.ref, paneMode]);

  /** Every route that changes what is on disk ends here: re-render and re-sweep. */
  const reopenDocument = useCallback(async (): Promise<void> => {
    const current = docRef.current;
    if (!current) return;
    const reopened = await window.rex.docOpen(current.ref);
    surfaceRef.current = null;
    setDoc(reopened);
    await refreshWorking();
  }, [refreshWorking]);

  const approveWorking = useCallback(
    (documentId: string) =>
      guard(async () => {
        const answer = await window.rex.workApprove(documentId);
        if (!answer.ok) {
          // §7.3 — the file moved under the copy. Nothing was written, and the
          // reviewer is told in the same sentence why and what to do.
          setNotice(answer.reason);
          await refreshWorking();
          return;
        }
        await reopenDocument();
        const summary = answer.reanchored;
        setNotice(
          summary
            ? `Approved. ${summary.ok} anchor(s) still exact, ${summary.moved} moved, ${summary.orphaned} orphaned.`
            : "Approved.",
        );
      }),
    [guard, refreshWorking, reopenDocument],
  );

  /** §7.1 — every waiting document, in turn, and one report at the end. */
  const approveAllWorking = useCallback(
    () =>
      guard(async () => {
        const all = await window.rex.workList();
        const refused: string[] = [];
        for (const copy of all) {
          const answer = await window.rex.workApprove(copy.documentId);
          if (!answer.ok) refused.push(copy.name);
        }
        await reopenDocument();
        setNotice(
          refused.length === 0
            ? `Approved ${all.length} document(s).`
            : `Approved ${all.length - refused.length} of ${all.length}. ${refused.join(", ")} changed on disk since REX copied ${refused.length === 1 ? "it" : "them"}, so ${refused.length === 1 ? "it was" : "they were"} left alone.`,
        );
      }),
    [guard, reopenDocument],
  );

  const discardWorking = useCallback(
    (documentId: string) =>
      guard(async () => {
        await window.rex.workDiscard(documentId);
        await reopenDocument();
        setNotice("Discarded. Your file was never changed.");
      }),
    [guard, reopenDocument],
  );

  const undoWorking = useCallback(
    (documentId: string) =>
      guard(async () => {
        await window.rex.workUndo(documentId);
        await reopenDocument();
      }),
    [guard, reopenDocument],
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

    // Spec 15 §7.4 — the run is over and its change is in a working copy. The
    // document on screen is re-rendered from that copy if it is one of the ones
    // that changed, so the reviewer reads the new version beside the old.
    const offApply = window.rex.onApplyReady((event) => {
      // §7.4 — a run that produced a working copy has already said everything
      // this bar used to say, in the head of the pane the change is in. Keeping
      // both would put two answers on screen, and the bar's are now wrong: it
      // offers OK and Undo, and neither exists any more.
      //
      // A deck run still has it, because spec 11 §7.7's pipeline is untouched
      // and is still accepted through `apply:confirm`.
      //
      // Spec 17 §3.4 — and a stopped run has said everything too, in the
      // STOPPED block the reviewer's own press produced. "This document was not
      // changed" under it is REX reporting the absence of a result nobody was
      // waiting for any more.
      const notice = event.working.length === 0 && !event.stopped ? event : null;
      setPendingApply(notice);
      pendingApplyRef.current = notice;
      // Before anything is re-rendered or re-swept — see the ref's own note.
      orphansBeforeApply.current = new Set(
        resolvedRef.current.filter((e) => e.state === "orphaned").map((e) => e.threadId),
      );
      // §4.3 — a file the agent wrote that was not its to write, put back. It
      // is never silent: a document nobody commented on is not part of a review.
      if (event.restored.length > 0) {
        setNotice(
          `The agent also changed ${event.restored.join(", ")}. REX put ${
            event.restored.length === 1 ? "it" : "them"
          } back — a change outside this comment's documents cannot be reviewed here.`,
        );
      }
      void refreshWorking();
      const current = docRef.current;
      const path = current?.ref.value ?? null;
      if (!current || !path || !event.files.includes(path)) {
        void refreshChangeBoxes();
        return;
      }
      // Both panes come back, because the reviewer is now comparing.
      setPaneMode("both");
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
  }, [guard, refreshChangeBoxes, refreshWorking]);

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
  const itemFor = useCallback(
    (next: Selected, current: OpenedDocument, pane: DocumentVersion): SelectionItem => {
      return newSelectionItem({
        kind: next.scopes[next.active]?.kind ?? "text",
        documentId: current.documentId,
        // Spec 16 §4 — which pane it was taken from, so its outline is drawn
        // where it was measured and its box is re-found there on every sweep.
        pane,
        documentRef: current.ref,
        documentName: nameOf(current.ref),
        anchor: next.anchor,
        label: next.label,
        rect: next.rect,
        zoom: zoomRef.current,
      });
    },
    [],
  );

  /** §3.1 — everything selected is added. The three rules live in selection.ts. */
  const addSelected = useCallback(
    (next: Selected, pane: DocumentVersion): void => {
      const current = docRef.current;
      if (!current) return;
      setSelection((items) => addSelectionItem(items, itemFor(next, current, pane)));
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
              // The file itself, not a version of it — §4.5 of spec 06 calls
              // this the one anchor that cannot move, and it resolves in
              // whichever pane is on screen.
              pane: "current",
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
   *
   * **The drawing itself is not kept.** It is a gesture, not a record: once it
   * has named the places, the places are the comment and the ink has nothing
   * left to say. Leaving it on the paper covered the prose it was drawn around,
   * and a comment carrying *how* it was selected told the agent nothing the
   * targets did not already say. Reported on 2026-08-26.
   */
  const finishDrawing = useCallback(
    (pane: DocumentVersion, strokes: Stroke[]): void => {
      void guard(async () => {
        const surface = pane === "original" ? originalSurfaceRef.current : surfaceRef.current;
        const current = docRef.current;
        setPenning(false);
        if (!surface || !current) return;

        // Spec 16 §5.5 — in the new version a drawing that crosses one changed
        // block and two unchanged ones makes a comment about the changed one
        // only. The surface filters; nothing here knows the rule.
        const found = await surface.targetsFromDrawing(strokes, zoomRef.current);
        if (found.targets.length === 0) return;

        const added = found.targets.map((one) => itemFor(one, current, pane));

        // Spec 16 §4 — BOTH panes can finish on one keypress: a drawing in each,
        // and `enter` commits both. The two calls land here in the same tick, so
        // a list built from `selectionRef` — which only catches up on the next
        // render — drops whichever pane got here first. Measured on 2026-08-26:
        // the left pane's circle silently ate the right pane's. The updater is
        // the only thing that sees the list as it really is, and the ref is left
        // to the render that follows.
        setSelection((items) => added.reduce(addSelectionItem, items));
      });
    },
    [guard, itemFor],
  );

  const onSelectionChanged = useCallback(
    async (pane: DocumentVersion) => {
      const surface = pane === "original" ? originalSurfaceRef.current : surfaceRef.current;
      if (!surface || armingRef.current) return;
      // Spec 16 §4.1 — in the new version a selection outside every live block
      // returns null and nothing happens: no panel, no notice, no refusal to
      // dismiss. The surface is where that rule lives.
      const next = await surface.selectionMade();
      // A click with nothing selected adds nothing — and, unlike the composer it
      // replaces, takes nothing away either (§4, fault 3).
      if (next) addSelected(next, pane);
    },
    [addSelected],
  );

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
        // Spec 17 §3.3 — the run is over however it ended, so the stopping
        // state goes with the busy one. Leaving it behind would grey out the
        // button on the comment's NEXT run.
        setStoppingThreads((current) => current.filter((id) => id !== threadId));
        await refreshThreads();
        await refreshTree();
      }
    },
    [refreshThreads, refreshTree],
  );

  /**
   * Spec 17 §2.1 — end this comment's running work.
   *
   * `busy` is deliberately not cleared here. The run has not stopped yet — the
   * SDK closes the agent's stdin and gives it about two seconds — and the
   * invoke that started it is still open. It clears where it always did, in
   * `withBusy`'s `finally`, when the run actually ends.
   */
  const stopThread = useCallback(
    (threadId: string): void => {
      setStoppingThreads((current) => [...current, threadId]);
      void guard(async () => {
        const stopped = await window.rex.threadStop(threadId);
        // §3.1 — zero means it finished between the paint and the click. Said
        // out loud, because a button that appears to do nothing reads as broken.
        if (stopped === 0) setNotice("That run had already finished.");
      });
    },
    [guard],
  );

  /** §3.4 — one thread, every item as a target, in panel order. */
  const askAboutSelection = useCallback((): void => {
    void guard(async () => {
      const items = selection;
      const note = selectionNote.trim();
      if (items.length === 0 || note.length === 0) return;

      const mode = selectionMode;
      const thread = await window.rex.threadCreate({
        targets: items.map((item) => ({ documentId: item.documentId, anchor: item.anchor })),
        note,
        // NOTE mode. The flag is stored so the panel and "Ask all" can tell a
        // comment the reviewer chose not to send from one whose send failed.
        isNote: mode === "note",
      });

      setSelection([]);
      setSelectionNote("");
      setExpandedItemId(null);
      setRowScopes(null);
      // §3.4 — the panel is empty, so nothing in REX is about that passage any
      // more. The browser's own selection is not the panel's and does not go
      // with it, so it is dropped by hand or the text stays blue in the
      // document with nothing left pointing at it.
      surfaceRef.current?.clearTextSelection();
      originalSurfaceRef.current?.clearTextSelection();
      leavePick();
      leavePen();

      await refreshThreads();
      await sweep();
      setActiveId(thread.id);

      // Spec 12 §3.2 and §4 — the panel's mode becomes the new thread's mode,
      // and decides which channel this first send reaches. ACT here is the flow
      // §1.3 says was missing: a reviewer who already knows what they want does
      // not have to ask a question first.
      setMode(thread.id, mode);

      // NOTE stops here, and that is the whole feature: the comment is written
      // down, nothing runs, nothing is spent. No `withBusy` either — there is
      // no work to be busy with, and a spinner over an instant save is a lie.
      if (mode === "note") return;

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
    sweep,
    withBusy,
  ]);

  const removeItem = useCallback((id: string): void => {
    setSelection((items) => {
      const next = items.filter((item) => item.id !== id);
      // §3.4 — a note with nothing to attach it to is not a thing REX has a
      // place for, and keeping it invisibly to reappear later is worse.
      if (next.length === 0) setSelectionNote("");
      return next;
    });
    setExpandedItemId((current) => (current === id ? null : current));
  }, []);

  const clearSelection = useCallback((): void => {
    setSelection([]);
    setSelectionNote("");
    setExpandedItemId(null);
    setRowScopes(null);
    // The same reason as Ask's — see the note there. Both panes: the browser's
    // selection belongs to whichever frame it was dragged in.
    surfaceRef.current?.clearTextSelection();
    originalSurfaceRef.current?.clearTextSelection();
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
    // A note is a comment the reviewer chose not to send. "Ask all" is the one
    // command that would send it behind their back, so it is the one command
    // that has to know about the flag.
    const waiting = threadsRef.current.filter(
      (thread) => thread.messages.length === 0 && !thread.isNote,
    );
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

  /** The surface for one pane. Spec 16 §4.2 — there are two of them now. */
  const surfaceFor = useCallback(
    (pane: DocumentVersion): DocumentSurface | null =>
      pane === "original" ? originalSurfaceRef.current : surfaceRef.current,
    [],
  );

  const probe = useCallback(
    (pane: DocumentVersion, x: number, y: number) => {
      void (async () => {
        const keep =
          pickChosenByHand.current && pickPaneRef.current === pane
            ? pickActiveRef.current
            : NO_KEPT_SCOPE;
        // §4.1 — in the new version the probe answers nothing outside the live
        // blocks, so the path bar never offers a scope a click cannot take.
        const found = (await surfaceFor(pane)?.probeAt(x, y, keep)) ?? null;
        if (!found) return;
        setPickPane(pane);
        setPickScopes(found.scopes);
        // Usually the smallest anchorable element; the surface says otherwise when
        // the reviewer had already widened and that element is still in the chain.
        setPickActive(found.active);
      })();
    },
    [surfaceFor],
  );

  /** ↑ ↓ or a crumb. This, and only this, is a deliberate widening. */
  const choosePickScope = useCallback((index: number): void => {
    pickChosenByHand.current = true;
    setPickActive(index);
  }, []);

  const scrollDocument = useCallback(
    (pane: DocumentVersion, dx: number, dy: number) => {
      surfaceFor(pane)?.scrollBy(dx, dy);
    },
    [surfaceFor],
  );

  /**
   * A click in pick mode adds a place and stays in pick mode.
   *
   * §3.1 — nothing replaces anything and no modifier is involved, so picking a
   * fourth and a fifth costs one click each. `P` or escape leaves.
   */
  const commitScope = useCallback(
    (index: number) => {
      void (async () => {
        const pane = pickPaneRef.current;
        const next = await surfaceFor(pane)?.anchorFromScope(index);
        if (next) addSelected(next, pane);
      })();
    },
    [addSelected, surfaceFor],
  );

  /**
   * Spec 16 §6.1 — the gap the reviewer clicked becomes a place in the panel.
   *
   * From there it behaves exactly as any other place: type the note, pick the
   * mode, send. Add names a place; it does not decide what happens there.
   */
  const commitGap = useCallback(
    (index: number) => {
      void (async () => {
        const next = await surfaceRef.current?.anchorFromGap(index);
        if (next) addSelected(next, "current");
      })();
    },
    [addSelected],
  );

  /**
   * Spec 16 §6.1 — `A` adds a place without reaching for the mouse.
   *
   * The gap under the pointer when there is one, because that is what the rule
   * and the pill are already promising; otherwise the gap nearest the middle of
   * what is on screen, which is the honest reading of "here" for a keyboard.
   * The row that appears names its neighbour either way, so a wrong guess is
   * visible before anything is sent.
   */
  const addAtNearestGap = useCallback((): void => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const index = offeredGap.current ?? surface.nearestGap();
    if (index === null) return;
    commitGap(index);
  }, [commitGap]);

  const rememberOfferedGap = useCallback((index: number | null): void => {
    offeredGap.current = index;
  }, []);

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
    (pane: DocumentVersion, x: number, y: number) => {
      void (async () => {
        const surface = surfaceFor(pane);
        if (!surface) return;
        const keep =
          pickChosenByHand.current && pickPaneRef.current === pane
            ? pickActiveRef.current
            : NO_KEPT_SCOPE;
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
          if (!pickScopesRef.current?.length || pickPaneRef.current !== pane) return;
          const shown = await surface.anchorFromScope(pickActiveRef.current);
          if (shown) addSelected(shown, pane);
          return;
        }
        setPickPane(pane);
        setPickScopes(found.scopes);
        setPickActive(found.active);
        const next = await surface.anchorFromScope(found.active);
        if (next) addSelected(next, pane);
      })();
    },
    [addSelected, surfaceFor],
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
          // Spec 16 §5.1 — a place that only the original has is scrolled to
          // there. Both panes are asked; the one that cannot find it does
          // nothing, which is what `scrollToAnchor` already does for an anchor
          // it cannot resolve.
          surfaceRef.current?.scrollToAnchor(target.anchor);
          originalSurfaceRef.current?.scrollToAnchor(target.anchor);
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

        // The row belongs to one pane, and widening it has to act on that
        // pane's DOM — see `SelectionItem.pane`.
        const surface = surfaceFor(item.pane);
        surface?.scrollToAnchor(item.anchor);

        if (expandedItemId === item.id) {
          setExpandedItemId(null);
          setRowScopes(null);
          expandedBase.current = null;
          return;
        }

        setExpandedItemId(item.id);
        expandedBase.current = item;
        const probed = await surface?.scopesForAnchor(item.anchor, item.kind);
        setRowScopes(probed?.scopes ?? null);
        setRowActive(probed?.active ?? 0);
      });
    },
    [expandedItemId, guard, openDocument, surfaceFor],
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
        const surface = base ? surfaceFor(base.pane) : null;
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
    [guard, surfaceFor],
  );

  const armRegion = useCallback(() => {
    if (!rowScopes) return;
    // The layer has to be up to catch the drag, and it needs the expanded row's
    // own chain so the box is cut from the element the chips point at — in the
    // pane that chain came from.
    setPickPane(expandedBase.current?.pane ?? "current");
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
        const next = await surfaceFor(pickPaneRef.current)?.anchorFromRegion(index, box);
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
    [guard, surfaceFor],
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
  //
  // The boolean and not the list: the sweep hands back a new `gaps` array on
  // every scroll, and depending on the array itself would tear both listeners
  // down and put them back each time. What the keyboard needs to know is only
  // whether there is one.
  const hasGaps = gaps.length > 0;
  useEffect(() => {
    let altTimer: number | null = null;
    /** §6.6 — the ⇧ hold that arms Add. Its own timer, its own mode. */
    let shiftTimer: number | null = null;

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

    /*
      Spec 16 §6.4 — Add exists where there is a gap to add at, and nowhere else.

      A gap is measured between two blocks carrying `data-src-line`, which only
      the Markdown renderer stamps. A PDF, a DOCX, a PPTX and a hand-written HTML
      file carry none, so their gap list is empty and every part of Add is dead:
      the strip drew a button that did nothing, ⇧ armed a mode with nothing in it
      and `A` fell through `addAtNearestGap`'s null. Measured on 2026-08-26 on a
      27-slide deck — `[data-src-line]` count 0, `⇧ add` on the strip.

      The gap list is the test rather than the file extension, so nothing here
      has to be kept in step with what each format stamps.
    */
    const canAdd = canPick && hasGaps;

    const onKeyDown = (event: KeyboardEvent): void => {
      /*
        Spec 14 §4.5 — Alt inside the comments panel belongs to the panel.

        Holding Alt arms pick mode, and the keys that move a row are Alt plus an
        arrow. Without this the two collide: reordering three rows in a row
        turns the document into a pick surface behind the reviewer's back. Alt
        is the panel's while the focus is in it, and pick's everywhere else.
      */
      const inCommentList = event
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.classList.contains("rex-side-scroll"));

      if (
        event.key === "Alt" &&
        altTimer === null &&
        !arming &&
        !penning &&
        canPick &&
        !inCommentList &&
        !typing(event)
      ) {
        altTimer = window.setTimeout(() => setPicking(true), ALT_PICK_DELAY);
        return;
      }

      /*
        Spec 16 §6.6 — held ⇧ arms Add, exactly as held ⌥ arms pick.

        The same delay, and for a weaker version of the same reason: ⇧A is a
        binding, so a shifted letter must not flash the rule across the page on
        its way to being typed. `event.key === "Shift"` fires on the modifier
        ALONE, so ⇧A never reaches here — this is the guard for the gap between
        pressing ⇧ and pressing the letter.
      */
      if (
        event.key === "Shift" &&
        shiftTimer === null &&
        !picking &&
        !penning &&
        canAdd &&
        !inCommentList &&
        !typing(event)
      ) {
        shiftTimer = window.setTimeout(() => setAdding(true), ALT_PICK_DELAY);
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
        case "a":
          // Spec 16 §6.1 — Add, from the keyboard. Bare `a`, because it costs
          // nothing: it puts a row in the panel and runs no agent. Its shifted
          // twin below is the one that spends money, which is why that one
          // needs the modifier and this one does not.
          if (!canAdd) return;
          addAtNearestGap();
          break;
        case "A":
          // Shift+A only. A bare `a` would fire a fan-out of paid sessions on a
          // keystroke, which §8.8 point 4 already treats as worth confirming.
          if (!event.shiftKey) return;
          /*
            Spec 16 §6.6 — while Add is armed, ⇧A is Add.

            Holding ⇧ is what arms Add, so ⇧A is the combination a reviewer's
            hand arrives at the moment they can see the rules on the page: hold
            to look, press A to take one. The other meaning of ⇧A opens a paid
            session for every unanswered comment in the workspace, and reaching
            it by accident from inside a mode that costs nothing is the one
            collision on this keyboard worth spending a branch on.
          */
          if (adding) {
            if (canAdd) addAtNearestGap();
            break;
          }
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
      if (event.key === "Shift") {
        if (shiftTimer !== null) {
          window.clearTimeout(shiftTimer);
          shiftTimer = null;
        }
        setAdding(false);
        return;
      }
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
      if (shiftTimer !== null) window.clearTimeout(shiftTimer);
    };
  }, [
    addAtNearestGap,
    adding,
    arming,
    askAll,
    centre,
    copyDebug,
    doc,
    hasGaps,
    penning,
    showCentre,
    workspace,
    zoomBy,
  ]);

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
    const mode = modeOf(threadId);
    if (mode === "act") {
      void withBusy(threadId, async () => {
        await window.rex.threadApply({ threadId, note: text });
      });
      return;
    }
    // NOTE writes the text into the comment and runs nothing. No `withBusy`:
    // there is no turn to wait for, and the notice bar still reports a failure
    // because `guard` is where that lives.
    if (mode === "note") {
      void guard(async () => {
        await window.rex.threadNote({ threadId, text });
        await refreshThreads();
      });
      return;
    }
    void withBusy(threadId, () => window.rex.threadReply({ threadId, text }));
  };

  const unanswered = threads.filter(
    (thread) => thread.messages.length === 0 && !thread.isNote,
  ).length;
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
              changes={changeCounts}
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
              original={original}
              removedLines={doc?.working?.removed ?? []}
              patch={doc?.working?.patch ?? ""}
              workingBar={
                doc?.working
                  ? {
                      view: doc.working,
                      others: working.length - 1,
                      onApprove: () => approveWorking(doc.working?.documentId ?? ""),
                      onApproveAll: approveAllWorking,
                      onUndo: () => undoWorking(doc.working?.documentId ?? ""),
                      onDiscard: () => discardWorking(doc.working?.documentId ?? ""),
                    }
                  : null
              }
              paneMode={paneMode}
              onPaneMode={setPaneMode}
              resolved={paneResolved.current}
              originalResolved={paneResolved.original}
              threads={threads}
              activeId={activeId}
              selection={selection}
              hoveredItemId={hoveredItemId}
              onHoverItem={setHoveredItemId}
              onRemoveItem={removeItem}
              changeBoxes={changeBoxes}
              adding={adding}
              onToggleAdd={() => {
                setPicking(false);
                setPenning(false);
                setAdding((on) => !on);
              }}
              picking={picking}
              pickScopes={pickScopes}
              pickActive={pickActive}
              pickPane={pickPane}
              arming={arming}
              penning={penning}
              hoveredThreadId={hoveredThreadId}
              onHoverThread={setHoveredThreadId}
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
              gaps={gaps}
              onGapOffer={rememberOfferedGap}
              onGapPick={commitGap}
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
              tokenClass={tokenClass(
                active.status,
                stateById.get(active.id) ?? null,
                active.isNote,
              )}
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
              stopping={stoppingThreads.includes(active.id)}
              onStop={() => stopThread(active.id)}
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
              onRename={(title) => void renameThread(active.id, title)}
            />
          ) : (
            <Sidebar
              threads={threads}
              openDocument={doc ? { id: doc.documentId, name: nameOf(doc.ref) } : null}
              stateById={stateById}
              labelById={labelById}
              busyThreads={busyThreads}
              groups={groups}
              root={workspace?.root ?? null}
              onSelect={setActiveId}
              onHover={setHoveredThreadId}
              onDelete={removeThread}
              onRename={renameThread}
              onGroupCreate={createGroup}
              onGroupRename={(groupId, name) => void updateGroup({ groupId, name })}
              onGroupCollapse={(groupId, collapsed) => void updateGroup({ groupId, collapsed })}
              onGroupDelete={deleteGroup}
              onMove={moveComment}
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
