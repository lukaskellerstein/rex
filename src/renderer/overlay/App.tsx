// The shell: opens a document, keeps threads and their resolutions in step,
// owns the surface the anchor resolver runs against, and holds the selection
// panel's items (spec 05 §3.5).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyReadyEvent } from "../../shared/channels.ts";
import { worstState } from "../../shared/targets.ts";
import type {
  AnchorState,
  AnchorSummary,
  DocumentRef,
  Message,
  OpenedDocument,
  ReferenceGraph,
  ThreadWithMessages,
  WorkspaceRef,
  WorkspaceTree,
} from "../../shared/types.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import { ApplyResult } from "./ApplyResult.tsx";
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
import { SelectionPanel } from "./SelectionPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Splitter } from "./Splitter.tsx";
import {
  addSelectionItem,
  moveSelectionItem,
  newSelectionItem,
  type SelectionItem,
} from "./selection.ts";
import { TopBar } from "./TopBar.tsx";

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

/** Spec 05 §3.5 — the file name, or the host for a URL. Never the whole path. */
function nameOf(ref: DocumentRef): string {
  if (ref.kind === "file") return ref.value.split("/").pop() ?? ref.value;
  try {
    return new URL(ref.value).host;
  } catch {
    return ref.value;
  }
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
  const [notice, setNotice] = useState<string | null>(null);
  // Spec 02: the workspace is a view of a folder, independent of which
  // document is open, so switching documents never disturbs it.
  const [workspace, setWorkspace] = useState<WorkspaceRef | null>(null);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [graph, setGraph] = useState<ReferenceGraph | null>(null);
  const [centre, setCentre] = useState<"document" | "graph">("document");
  /**
   * One notion of "selected", shared by the explorer and the graph. It follows
   * the open document, but a graph node that cannot be opened — an external or
   * missing file — can be selected without opening anything.
   */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(272);
  const [commentsWidth, setCommentsWidth] = useState(384);

  // design/selection — pick mode and the region drag it can hand off to.
  const [picking, setPicking] = useState(false);
  const [pickScopes, setPickScopes] = useState<PickScope[] | null>(null);
  const [pickActive, setPickActive] = useState(0);
  const [arming, setArming] = useState(false);
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
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  /** The chain rebuilt from the expanded row's anchor — §4.1. */
  const [rowScopes, setRowScopes] = useState<PickScope[] | null>(null);
  const [rowActive, setRowActive] = useState(0);
  /** Spec 05 §5.6.1 — what a pending Apply changed in the document on screen. */
  const [changeBoxes, setChangeBoxes] = useState<ScopeRect[]>([]);

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
  const zoomRef = useRef(1);
  /**
   * Whether the chosen scope was chosen **by hand** — ↑ ↓ or a crumb — rather
   * than by the last probe. Only a deliberate choice is carried across a
   * pointer move; see `keptIndex`, which explains what a PDF page did to the
   * old rule.
   */
  const pickChosenByHand = useRef(false);

  docRef.current = doc;
  threadsRef.current = threads;
  workspaceRef.current = workspace;
  pendingApplyRef.current = pendingApply;
  selectionRef.current = selection;
  activeIdRef.current = activeId;
  pickActiveRef.current = pickActive;
  zoomRef.current = zoom;

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
    const path = current.ref.kind === "file" ? current.ref.value : null;
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
      if (ref.kind === "file") setSelectedPath(ref.value);
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
      setThreads(list);
      setDoc(opened);
    },
    [leavePick, listRequest],
  );

  const guard = useCallback(async (task: () => Promise<void>): Promise<void> => {
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const pick = useCallback(
    () =>
      guard(async () => {
        const ref = await window.rex.docPick();
        if (ref) await openDocument(ref);
      }),
    [guard, openDocument],
  );

  const openUrl = useCallback(
    (value: string) => guard(() => openDocument({ kind: "url", value })),
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
        setTree(await window.rex.workspaceTree(ref));
      }),
    [guard],
  );

  /** Re-scans the tree so comment counts follow what just happened. */
  const refreshTree = useCallback(
    () =>
      guard(async () => {
        if (workspace) setTree(await window.rex.workspaceTree(workspace));
      }),
    [guard, workspace],
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
    (which: "document" | "graph") =>
      guard(async () => {
        setCentre(which);
        if (which === "document") {
          await sweep();
          return;
        }
        leavePick();
        if (workspace) setGraph(await window.rex.workspaceGraph(workspace));
      }),
    [guard, leavePick, sweep, workspace],
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
      const path = current?.ref.kind === "file" ? current.ref.value : null;
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

  /** §3.1 — everything selected is added. The three rules live in selection.ts. */
  const addSelected = useCallback((next: Selected): void => {
    const current = docRef.current;
    if (!current) return;
    setSelection((items) =>
      addSelectionItem(
        items,
        newSelectionItem({
          kind: next.scopes[next.active]?.kind ?? "text",
          documentId: current.documentId,
          documentRef: current.ref,
          documentName: nameOf(current.ref),
          anchor: next.anchor,
          label: next.label,
          rect: next.rect,
          zoom: zoomRef.current,
        }),
      ),
    );
  }, []);

  const onSelectionChanged = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface || armingRef.current) return;
    const next = await surface.selectionMade();
    // A click with nothing selected adds nothing — and, unlike the composer it
    // replaces, takes nothing away either (§4, fault 3).
    if (next) addSelected(next);
  }, [addSelected]);

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
      leavePick();

      await refreshThreads();
      await sweep();
      setActiveId(thread.id);
      await withBusy(thread.id, () => window.rex.threadAsk(thread.id));
    });
  }, [guard, leavePick, refreshThreads, selection, selectionNote, sweep, withBusy]);

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
    // The same reason as Ask's — see the note there.
    surfaceRef.current?.clearTextSelection();
  }, []);

  const askAll = useCallback(async (): Promise<void> => {
    const unanswered = threadsRef.current.filter((thread) => thread.messages.length === 0);
    if (unanswered.length === 0) return;
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

  // ── The selection panel ─────────────────────────────────────

  /** §3.3 and §4.1 — focus a row: open its document, scroll to it, offer chips. */
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
      if (event.key === "Alt" && altTimer === null && !arming && canPick && !typing(event)) {
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
          setPicking((on) => !on);
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
  }, [arming, askAll, centre, doc, showCentre, workspace, zoomBy]);

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
  const unanswered = threads.filter((thread) => thread.messages.length === 0).length;
  const applyTarget = pendingApply
    ? (threads.find((thread) => thread.id === pendingApply.threadId) ?? null)
    : null;

  // §3.3 — the comments column is hidden behind the graph, but never while the
  // panel holds something. Losing sight of a half-built selection because you
  // went to look at the graph is the same fault as losing it to a stray click.
  const sideHidden = centre === "graph" && selection.length === 0;

  return (
    <div className="rex-app">
      <TopBar
        doc={doc}
        workspace={workspace}
        centre={centre}
        cost={cost}
        unanswered={unanswered}
        picking={picking}
        canPick={doc !== null && centre === "document"}
        zoom={zoom}
        onResetZoom={resetZoom}
        onCentre={showCentre}
        onAskAll={askAll}
        onTogglePick={() => setPicking((on) => !on)}
        onOpenFile={pick}
        onOpenFolder={pickFolder}
        onOpenUrl={openUrl}
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
              onOpen={(path) => void guard(() => openDocument({ kind: "file", value: path }))}
              onReload={refreshTree}
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
          <div className={`rex-pane${centre === "graph" ? " rex-pane-hidden" : ""}`}>
            <DocumentView
              doc={doc}
              resolved={resolved}
              threads={threads}
              activeId={activeId}
              selection={selection}
              hoveredItemId={hoveredItemId}
              onHoverItem={setHoveredItemId}
              changeBoxes={changeBoxes}
              picking={picking}
              pickScopes={pickScopes}
              pickActive={pickActive}
              arming={arming}
              onSurfaceReady={onSurfaceReady}
              onSelectionChanged={onSelectionChanged}
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
              onPickCancel={leavePick}
              onRegion={takeRegion}
            />
          </div>

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
            Spec 05 §3 — the selection panel sits above the comments and appears
            only when something is in it. It stays put while a comment card is
            open: a reviewer can be reading one comment and building the next.
          */}
          {selection.length > 0 ? (
            <SelectionPanel
              items={selection}
              note={selectionNote}
              openDocumentId={doc?.documentId ?? null}
              expandedId={expandedItemId}
              scopes={rowScopes}
              scopeActive={rowActive}
              arming={arming}
              hoveredId={hoveredItemId}
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
          ) : null}

          {active ? (
            <CommentCard
              thread={active}
              number={numbers.get(active.id) ?? 0}
              anchorState={stateById.get(active.id) ?? null}
              label={labelById.get(active.id) ?? null}
              targetStates={targetStatesById.get(active.id) ?? []}
              busy={busyThreads.includes(active.id)}
              onBack={() => setActiveId(null)}
              onReply={(text) =>
                void withBusy(active.id, () =>
                  window.rex.threadReply({ threadId: active.id, text }),
                )
              }
              onResolve={(resolvedFlag) =>
                void withBusy(active.id, async () => {
                  await window.rex.threadResolve({ threadId: active.id, resolved: resolvedFlag });
                })
              }
              onApply={() =>
                void withBusy(active.id, async () => {
                  await window.rex.threadApply(active.id);
                })
              }
            />
          ) : (
            <Sidebar
              threads={threads}
              stateById={stateById}
              labelById={labelById}
              busyThreads={busyThreads}
              onSelect={setActiveId}
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
          openDocumentPath={doc?.ref.kind === "file" ? doc.ref.value : null}
          onOpenFile={(path) => void guard(() => openDocument({ kind: "file", value: path }))}
          onDecide={decideApply}
        />
      ) : null}

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
