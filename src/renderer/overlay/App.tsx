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

  const leavePick = useCallback((): void => {
    setPicking(false);
    setArming(false);
    setPickScopes(null);
    setPickActive(0);
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
    setDraft(next);
    if (next) setDraftKey((key) => key + 1);
  }, []);

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
        note,
      });
      setDraft(null);
      leavePick();
      await refreshThreads();
      await sweep();
      setActiveId(thread.id);
      await withBusy(thread.id, () => window.rex.threadAsk(thread.id));
    },
    [draft, leavePick, refreshThreads, sweep, withBusy],
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
      const scopes = (await surfaceRef.current?.probeAt(x, y)) ?? null;
      if (!scopes) return;
      setPickScopes(scopes);
      // A fresh probe lands on the smallest anchorable element; the path bar
      // and ↑/↓ widen from there.
      setPickActive(0);
    })();
  }, []);

  const commitScope = useCallback((index: number) => {
    void (async () => {
      const next = await surfaceRef.current?.anchorFromScope(index);
      if (!next) return;
      setDraft(next);
      setDraftKey((key) => key + 1);
      setPicking(false);
      setPickScopes(null);
    })();
  }, []);

  /** Widening from the composer's chips: the anchor changes, the note stays. */
  const changeScope = useCallback((index: number) => {
    void (async () => {
      const next = await surfaceRef.current?.anchorFromScope(index);
      if (next) setDraft(next);
      setArming(false);
    })();
  }, []);

  const armRegion = useCallback(() => {
    if (!draft) return;
    // The layer has to be up to catch the drag, and it needs the draft's own
    // chain so the box is cut from the element the chips are pointing at.
    setPickScopes(draft.scopes);
    setPickActive(draft.active);
    setPicking(true);
    setArming(true);
  }, [draft]);

  const takeRegion = useCallback((index: number, box: ScopeRect) => {
    void (async () => {
      const next = await surfaceRef.current?.anchorFromRegion(index, box);
      setArming(false);
      setPicking(false);
      if (next) setDraft(next);
    })();
  }, []);

  // `E`, or ⌥ held for a moment. Hover never outlines things while you are only
  // reading, and it never competes with dragging a text selection.
  useEffect(() => {
    if (!doc || centre !== "document") return;
    let altTimer: number | null = null;

    const typing = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Alt" && altTimer === null && !arming) {
        altTimer = window.setTimeout(() => setPicking(true), ALT_PICK_DELAY);
        return;
      }
      if (event.key !== "e" && event.key !== "E") return;
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      setPicking((on) => !on);
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
  }, [arming, centre, doc]);

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
              onSurfaceReady={onSurfaceReady}
              onSelectionChanged={onSelectionChanged}
              onSelectMarker={setActiveId}
              onCreateComment={createComment}
              onCancelDraft={() => setDraft(null)}
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
