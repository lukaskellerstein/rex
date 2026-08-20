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
import type { DocumentSurface, DraftAnchor, ResolvedThread } from "./anchoring.ts";
import { CommentCard } from "./CommentCard.tsx";
import { DiffDialog } from "./DiffDialog.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { Explorer } from "./Explorer.tsx";
import { GraphView } from "./GraphView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Splitter } from "./Splitter.tsx";

/** SPEC.md §8.8 point 4 — confirm before a fan-out larger than this. */
const FAN_OUT_CONFIRM = 10;
/** A rough per-comment figure, only ever shown as an estimate. */
const ESTIMATED_USD_PER_ASK = 0.05;

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [threads, setThreads] = useState<ThreadWithMessages[]>([]);
  const [resolved, setResolved] = useState<ResolvedThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const [cost, setCost] = useState(0);
  const [pendingApply, setPendingApply] = useState<ApplyReadyEvent | null>(null);
  const [busyThreads, setBusyThreads] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
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

  const surfaceRef = useRef<DocumentSurface | null>(null);
  const docRef = useRef<OpenedDocument | null>(null);
  const threadsRef = useRef<ThreadWithMessages[]>([]);
  /** Resolves the promise §8.7 step 6 is waiting on, once the sweep is done. */
  const sweepWaiter = useRef<((summary: AnchorSummary) => void) | null>(null);

  docRef.current = doc;
  threadsRef.current = threads;

  const stateById = useMemo(() => {
    const map = new Map<string, AnchorState>();
    for (const entry of resolved) map.set(entry.threadId, entry.state);
    return map;
  }, [resolved]);

  // ── Resolution sweep (§6.5, §6.6) ───────────────────────────

  const sweep = useCallback(async (): Promise<AnchorSummary> => {
    const surface = surfaceRef.current;
    const summary: AnchorSummary = { ok: 0, moved: 0, orphaned: 0, total: 0 };
    if (!surface) return summary;

    const entries = await surface.resolve(
      threadsRef.current,
      docRef.current?.contentChanged ?? false,
    );
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

  const openDocument = useCallback(async (ref: DocumentRef): Promise<void> => {
    if (ref.kind === "file") setSelectedPath(ref.value);
    const opened = await window.rex.docOpen(ref);
    const list = await window.rex.threadList(opened.documentId);
    surfaceRef.current = null;
    setActiveId(null);
    setDraft(null);
    setResolved([]);
    setThreads(list);
    setDoc(opened);
  }, []);

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
    () =>
      guard(async () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        await openDocument({ kind: "url", value: trimmed });
        setUrl("");
      }),
    [guard, openDocument, url],
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

  const showGraph = useCallback(
    () =>
      guard(async () => {
        setCentre("graph");
        if (workspace) setGraph(await window.rex.workspaceGraph(workspace));
      }),
    [guard, workspace],
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

  const onSelectionChanged = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    setDraft(await surface.anchorFromSelection());
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
      await refreshThreads();
      await sweep();
      setActiveId(thread.id);
      await withBusy(thread.id, () => window.rex.threadAsk(thread.id));
    },
    [draft, refreshThreads, sweep, withBusy],
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

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  return (
    <div className="rex-app">
      <header className="rex-bar">
        <button type="button" className="rex-button" onClick={pick}>
          Open file…
        </button>
        <button type="button" className="rex-button" onClick={pickFolder}>
          Open folder…
        </button>
        <input
          className="rex-url"
          placeholder="…or a URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void openUrl();
          }}
        />
        <span className="rex-title">{doc?.title ?? doc?.ref.value ?? "No document open"}</span>
        {doc?.contentChanged ? (
          <span className="rex-badge rex-badge-moved">file changed</span>
        ) : null}
        <span className="rex-spacer" />
        {workspace ? (
          <div className="rex-toggle">
            <button
              type="button"
              className={`rex-chip ${centre === "document" ? "rex-chip-on" : ""}`}
              onClick={() => {
                setCentre("document");
                void sweep();
              }}
            >
              Document
            </button>
            <button
              type="button"
              className={`rex-chip ${centre === "graph" ? "rex-chip-on" : ""}`}
              onClick={showGraph}
            >
              Graph
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="rex-button"
          onClick={askAll}
          disabled={!doc || threads.every((thread) => thread.messages.length > 0)}
        >
          Ask all
        </button>
        <span className="rex-cost" title="Running total for this document">
          ${cost.toFixed(4)}
        </span>
      </header>

      {notice ? (
        <div className="rex-notice">
          <span>{notice}</span>
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
              min={160}
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
              draft={draft}
              onSurfaceReady={onSurfaceReady}
              onSelectionChanged={onSelectionChanged}
              onSelectMarker={setActiveId}
              onCreateComment={createComment}
              onCancelDraft={() => setDraft(null)}
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
            min={240}
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
              anchorState={stateById.get(active.id) ?? active.anchorState}
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
          onDecide={(accept) =>
            void guard(async () => {
              const target = pendingApply;
              setPendingApply(null);
              const response = await window.rex.applyConfirm({
                applyRunId: target.applyRunId,
                accept,
              });
              const { ok, moved, orphaned, total } = response.reanchored;
              setNotice(
                `Re-anchored ${total} thread(s): ${ok} ok, ${moved} moved, ${orphaned} newly orphaned.`,
              );
              await refreshThreads();
            })
          }
        />
      ) : null}
    </div>
  );
}
