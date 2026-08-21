// The shell: opens a document, keeps threads and their resolutions in step,
// and owns the surface the anchor resolver runs against.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyReadyEvent } from "../../shared/channels.ts";
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
import type { DocumentSurface, DraftAnchor, ResolvedThread } from "./anchoring.ts";
import { CommentCard } from "./CommentCard.tsx";
import type { ExtraTarget } from "./Composer.tsx";
import { DiffDialog } from "./DiffDialog.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { Explorer } from "./Explorer.tsx";
import { GraphView } from "./GraphView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Splitter } from "./Splitter.tsx";
import { TopBar } from "./TopBar.tsx";

/** SPEC.md §8.8 point 4 — confirm before a fan-out larger than this. */
const FAN_OUT_CONFIRM = 10;
/** A rough per-comment figure, only ever shown as an estimate. */
const ESTIMATED_USD_PER_ASK = 0.05;
/** How long ⌥ must be held before it means "pick", not "I am typing ⌥-something". */
const ALT_PICK_DELAY = 250;
/** A drag-resize fires continuously; re-resolve once it stops. */
const RESIZE_SETTLE_MS = 200;

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

interface ApplyOutcome {
  summary: AnchorSummary;
  files: string[];
  newlyOrphaned: ThreadWithMessages[];
}

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [threads, setThreads] = useState<ThreadWithMessages[]>([]);
  const [resolved, setResolved] = useState<ResolvedThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  /** Bumped only for a *new* draft, so widening a scope keeps what was typed. */
  const [draftKey, setDraftKey] = useState(0);
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
  /** Further places the comment being written is about — shift-click adds one. */
  const [extras, setExtras] = useState<ExtraTarget[]>([]);
  /** True while every click adds a place instead of starting a new comment. */
  const [adding, setAdding] = useState(false);
  /** The document's own zoom. 1 is 100%. */
  const [zoom, setZoom] = useState(1);
  /**
   * The zoom at which the open draft's own rect was measured.
   *
   * A `DraftAnchor` carries a box in document pixels, and zooming moves every
   * document pixel. Without this the outline of what you are writing about
   * drifts off it the moment you zoom in to read.
   */
  const [draftZoom, setDraftZoom] = useState(1);

  const surfaceRef = useRef<DocumentSurface | null>(null);
  const docRef = useRef<OpenedDocument | null>(null);
  const threadsRef = useRef<ThreadWithMessages[]>([]);
  /** The sweep's own result, readable before React has re-rendered with it. */
  const resolvedRef = useRef<ResolvedThread[]>([]);
  /** Resolves the promise §8.7 step 6 is waiting on, once the sweep is done. */
  const sweepWaiter = useRef<((summary: AnchorSummary) => void) | null>(null);

  docRef.current = doc;
  threadsRef.current = threads;

  const stateById = useMemo(() => {
    const map = new Map<string, AnchorState>();
    for (const entry of resolved) map.set(entry.threadId, entry.state);
    return map;
  }, [resolved]);

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

  const sweep = useCallback(async (): Promise<AnchorSummary> => {
    const surface = surfaceRef.current;
    const summary: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };
    if (!surface) return summary;

    const entries = await surface.resolve(
      threadsRef.current,
      docRef.current?.contentChanged ?? false,
    );
    resolvedRef.current = entries;
    setResolved(entries);

    // Invariant I1 — main stores anchor states but cannot compute them.
    await Promise.all(
      entries.map((entry) =>
        window.rex.anchorRestate({ threadId: entry.threadId, anchorState: entry.state }),
      ),
    );

    summary.total = entries.length;
    for (const entry of entries) summary[entry.state]++;
    return summary;
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
   */
  useEffect(() => {
    let timer = 0;
    const onResize = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void sweep(), RESIZE_SETTLE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [sweep]);

  /**
   * A zoom is geometry, exactly as a resize is, so it re-resolves for the same
   * reason (see the resize effect above). Skipped before there is a surface:
   * this fires once on mount, and sweeping then would clear the list the load
   * is about to fill.
   */
  const onZoomApplied = useCallback((): void => {
    if (surfaceRef.current) void sweep();
  }, [sweep]);

  const onSurfaceReady = useCallback(
    async (surface: DocumentSurface): Promise<void> => {
      surfaceRef.current = surface;
      const summary = await sweep();
      const waiter = sweepWaiter.current;
      if (waiter) {
        sweepWaiter.current = null;
        waiter(summary);
      }
    },
    [sweep],
  );

  // ── Opening documents ───────────────────────────────────────

  /**
   * Read through refs rather than closed over, so the pick callbacks keep one
   * identity for the life of the app — DocumentView's tier 1 effect depends on
   * that, and a new identity there rewrites the iframe's `srcdoc`.
   */
  const pickActiveRef = useRef(0);
  const draftRef = useRef<DraftAnchor | null>(null);
  const addingRef = useRef(false);
  const zoomRef = useRef(1);
  pickActiveRef.current = pickActive;
  draftRef.current = draft;
  addingRef.current = adding;
  zoomRef.current = zoom;

  /** Every draft is recorded with the zoom its box was measured at. */
  const showDraft = useCallback((next: DraftAnchor): void => {
    setDraft(next);
    setDraftZoom(zoomRef.current);
  }, []);

  const zoomBy = useCallback((factor: number): void => {
    setZoom((current) => clampZoom(current * factor));
  }, []);

  const resetZoom = useCallback((): void => setZoom(1), []);

  const leavePick = useCallback((): void => {
    setPicking(false);
    setArming(false);
    setAdding(false);
    setPickScopes(null);
    setPickActive(0);
  }, []);

  /** The composer's "+ another place": the next click adds rather than replaces. */
  const addAnother = useCallback((): void => {
    setPicking(true);
    setAdding(true);
  }, []);

  const openDocument = useCallback(
    async (ref: DocumentRef): Promise<void> => {
      if (ref.kind === "file") setSelectedPath(ref.value);
      const opened = await window.rex.docOpen(ref);
      const list = await window.rex.threadList(opened.documentId);
      surfaceRef.current = null;
      setActiveId(null);
      setDraft(null);
      setResolved([]);
      resolvedRef.current = [];
      leavePick();
      setThreads(list);
      setDoc(opened);
    },
    [leavePick],
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
    const list = await window.rex.threadList(current.documentId);
    setThreads(list);
    threadsRef.current = list;
    return list;
  }, []);

  // ── Workspace (spec 02) ─────────────────────────────────────

  const openWorkspace = useCallback(
    (ref: WorkspaceRef) =>
      guard(async () => {
        setWorkspace(ref);
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
    window.__rexReanchor = async (documentId: string): Promise<AnchorSummary> => {
      const current = docRef.current;
      if (!current || current.documentId !== documentId) {
        return { ok: 0, moved: 0, orphaned: 0, total: 0 };
      }
      // The file changed underneath, so re-render it before re-resolving.
      const reopened = await window.rex.docOpen(current.ref);
      const list = await window.rex.threadList(documentId);
      threadsRef.current = list;
      setThreads(list);

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
  }, []);

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
    const offApply = window.rex.onApplyReady((event) => setPendingApply(event));
    return () => {
      offStep();
      offCost();
      offApply();
    };
  }, []);

  // ── Commands ────────────────────────────────────────────────

  /**
   * Read through a ref rather than closed over, so this callback keeps one
   * identity for the life of the app.
   *
   * DocumentView's tier 1 effect depends on it: give it a new identity and the
   * effect re-runs, which rewrites the iframe's `srcdoc` — reloading the
   * document under review, throwing away its scroll position and the scope
   * chain the composer's chips point into. Arming a region did exactly that,
   * so the drag that followed had nothing left to cut from.
   */
  const armingRef = useRef(false);
  armingRef.current = arming;

  const onSelectionChanged = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface || armingRef.current) return;
    const next = await surface.anchorFromSelection();
    if (!next) {
      setDraft(null);
      return;
    }
    showDraft(next);
    setDraftKey((key) => key + 1);
  }, [showDraft]);

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

  const createComment = useCallback(
    async (note: string): Promise<void> => {
      const current = docRef.current;
      if (!current || !draft) return;
      const thread = await window.rex.threadCreate({
        documentId: current.documentId,
        anchor: draft.anchor,
        extraAnchors: extras.map((extra) => extra.anchor),
        note,
      });
      setDraft(null);
      setExtras([]);
      leavePick();
      await refreshThreads();
      await sweep();
      setActiveId(thread.id);
      await withBusy(thread.id, () => window.rex.threadAsk(thread.id));
    },
    [draft, extras, leavePick, refreshThreads, sweep, withBusy],
  );

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
      const found = (await surfaceRef.current?.probeAt(x, y, pickActiveRef.current)) ?? null;
      if (!found) return;
      setPickScopes(found.scopes);
      // Usually the smallest anchorable element; the surface says otherwise when
      // the reviewer had already widened and that element is still in the chain.
      setPickActive(found.active);
    })();
  }, []);

  const scrollDocument = useCallback((dx: number, dy: number) => {
    surfaceRef.current?.scrollBy(dx, dy);
  }, []);

  const commitScope = useCallback(
    (index: number, additive: boolean) => {
      void (async () => {
        const next = await surfaceRef.current?.anchorFromScope(index);
        if (!next) return;

        // One more place for the comment already being written — either from
        // "+ another place", or from a shift-click for anyone who knows it.
        // Pick mode stays on so a fourth and a fifth cost one click each.
        if ((additive || addingRef.current) && draftRef.current) {
          const scope = next.scopes[next.active];
          if (!scope) return;
          setExtras((list) => [
            ...list,
            { anchor: next.anchor, label: scope.title, rect: scope.rect, zoom: zoomRef.current },
          ]);
          return;
        }

        showDraft(next);
        setExtras([]);
        setDraftKey((key) => key + 1);
        setPicking(false);
        setAdding(false);
        setPickScopes(null);
      })();
    },
    [showDraft],
  );

  /** Widening from the composer's chips: the anchor changes, the note stays. */
  const changeScope = useCallback(
    (index: number) => {
      void (async () => {
        const next = await surfaceRef.current?.anchorFromScope(index);
        if (next) showDraft(next);
        setArming(false);
      })();
    },
    [showDraft],
  );

  const armRegion = useCallback(() => {
    if (!draft) return;
    // The layer has to be up to catch the drag, and it needs the draft's own
    // chain so the box is cut from the element the chips are pointing at.
    setPickScopes(draft.scopes);
    setPickActive(draft.active);
    setPicking(true);
    setArming(true);
  }, [draft]);

  const takeRegion = useCallback(
    (index: number, box: ScopeRect) => {
      void (async () => {
        const next = await surfaceRef.current?.anchorFromRegion(index, box);
        setArming(false);
        setPicking(false);
        if (next) showDraft(next);
      })();
    },
    [showDraft],
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

  // ── Apply (§8.7) ────────────────────────────────────────────

  const decideApply = useCallback(
    (accept: boolean) =>
      guard(async () => {
        const target = pendingApply;
        if (!target) return;
        setPendingApply(null);

        const before = new Set(
          resolvedRef.current.filter((e) => e.state === "orphaned").map((e) => e.threadId),
        );

        const response = await window.rex.applyConfirm({
          applyRunId: target.applyRunId,
          accept,
        });
        const list = await refreshThreads();

        if (!accept) {
          setNotice("Rejected — the file was restored with git checkout.");
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
              draftKey={draftKey}
              resolved={resolved}
              threads={threads}
              activeId={activeId}
              draft={draft}
              picking={picking}
              pickScopes={pickScopes}
              pickActive={pickActive}
              arming={arming}
              extras={extras}
              adding={adding}
              onAddAnother={addAnother}
              onSurfaceReady={onSurfaceReady}
              onSelectionChanged={onSelectionChanged}
              onSelectMarker={setActiveId}
              onCreateComment={createComment}
              onCancelDraft={() => {
                setDraft(null);
                setExtras([]);
                leavePick();
              }}
              onRemoveExtra={(position) =>
                setExtras((list) => list.filter((_, at) => at !== position))
              }
              onScrollBy={scrollDocument}
              zoom={zoom}
              draftZoom={draftZoom}
              onZoomBy={zoomBy}
              onZoomReset={resetZoom}
              onZoomApplied={onZoomApplied}
              onScope={changeScope}
              onArmRegion={armRegion}
              onProbe={probe}
              onPickActive={setPickActive}
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
          The comments column is about the open document; the graph is about
          the workspace. Hidden rather than unmounted so an in-progress reply
          survives a look at the graph.
        */}
        {centre === "graph" ? null : (
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
          className={`rex-side${centre === "graph" ? " rex-pane-hidden" : ""}`}
          style={{ width: commentsWidth }}
        >
          {active ? (
            <CommentCard
              thread={active}
              number={numbers.get(active.id) ?? 0}
              anchorState={stateById.get(active.id) ?? active.anchorState}
              label={labelById.get(active.id) ?? null}
              busy={busyThreads.includes(active.id)}
              applyEnabled={doc?.applyEnabled ?? false}
              applyDisabledReason={doc?.applyDisabledReason ?? null}
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
