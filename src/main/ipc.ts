// SPEC.md §10 — channel registration, and the thread service behind it.
//
// Invariant I3: every command is `ipcRenderer.invoke`, every piece of agent
// output is `webContents.send`. Nothing here listens on anything.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { app, type BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  type AnchorRestateRequest,
  type ApplyConfirmRequest,
  COMMAND,
  EVENT,
  type GroupCreateRequest,
  type GroupDeleteRequest,
  type GroupListRequest,
  type GroupUpdateRequest,
  type InitialTarget,
  type RenderResultRequest,
  type ThreadApplyRequest,
  type ThreadCreateRequest,
  type ThreadDraftSaveRequest,
  type ThreadListRequest,
  type ThreadRenameRequest,
  type ThreadReplyRequest,
  type ThreadResolveRequest,
  type ThreadSynthesiseRequest,
  type WorkActResponse,
  type WorkApproveResponse,
  type WorkspaceDeleteRequest,
  type WorkspaceExcludeRequest,
  type WorkspaceFileResult,
  type WorkspaceRenameRequest,
  type WorkspaceSearchRequest,
} from "../shared/channels.ts";
import type {
  AgentChoices,
  Anchor,
  AnchorSummary,
  CommentGroup,
  CommentMove,
  DocumentRef,
  DocumentVersion,
  Message,
  OpenedDocument,
  PaperView,
  ReferenceGraph,
  SendChoices,
  SendMode,
  TargetDraft,
  Thread,
  ThreadWithMessages,
  ViewState,
  WorkingCopyView,
  WorkspaceRef,
  WorkspaceSearchResult,
  WorkspaceTree,
} from "../shared/types.ts";
import { listCapabilities } from "./agent/capabilities.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import {
  askPrompt,
  documentHeader,
  followUpPrompt,
  type PassagePlace,
  synthesisPrompt,
  withEvents,
} from "./agent/prompts.ts";
import { runAgent } from "./agent/runner.ts";
import { beginRun, endRun, HELD_REASON, isHeld, stopRun } from "./agent/runs.ts";
import {
  eventsSinceLastAnswer,
  renderTranscript,
  replayPrompt,
  sessionExists,
} from "./agent/transcript.ts";
import { type ApplyContext, confirmApply, locatePassage, startApply, viewOf } from "./apply.ts";
import type { CdpStatus } from "./cdp.ts";
import type { Db } from "./db/database.ts";
import { createGroup, deleteGroup, listGroups, moveItem, updateGroup } from "./db/groups.ts";
import {
  appendMessage,
  appendTargets,
  completeApplyRun,
  createThread,
  deleteThread,
  deleteThreadsInScope,
  documentCostUsd,
  getDocument,
  getThread,
  listMessages,
  listThreads,
  listThreadsInDocument,
  type MessageDraft,
  markThreadDraft,
  markThreadNoted,
  markThreadSent,
  renameThread,
  saveDraft,
  setDocumentHash,
  setTargetState,
  setThreadSession,
  setThreadStatus,
  setThreadStyle,
  toggleWorkspaceRule,
  upsertDocument,
} from "./db/queries.ts";
import {
  defaultModel,
  MODEL_DEFAULT_KEY,
  paperView,
  setPaperView,
  setSetting,
} from "./db/settings.ts";
import { appReport, debugReport } from "./debug.ts";
import { porcelainStatus, repositoryRoot } from "./git.ts";
// Aliased: `registerIpc` has its own `record`, which appends a message row.
import { entries, lineCount, logFile, record as logLine } from "./log.ts";
import { allowDirectory, baseHrefFor } from "./protocol.ts";
import { isPptxPath, isTextDocumentPath } from "./render/formats.ts";
import { sha256 } from "./render/html.ts";
import { renderDocument } from "./render/index.ts";
import { ensureSidecar } from "./render/pptx.ts";
import { searchWorkspace } from "./search/index.ts";
import { agentCwd, documentsOf, SCRATCH_DIR, withDetail } from "./threads.ts";
import {
  approveWorkingCopy,
  basePath,
  currentPath,
  discardWorkingCopy,
  ensureWorkingCopy,
  isPending,
  pendingCopies,
  pendingCopy,
  readMeta,
  undoLastRevision,
  type WorkingMeta,
} from "./work.ts";
import { deleteEntry, noteWorkspaceRoot, renameEntry } from "./workspace/files.ts";
import { buildReferenceGraph } from "./workspace/graph.ts";
import { scanWorkspace } from "./workspace/tree.ts";

/**
 * SPEC.md §8.8 point 2 — "Ask all" fans out, and the reference implementation
 * caps nothing. Five at a time.
 */
const MAX_CONCURRENT_AGENTS = 5;

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((release) => this.waiting.push(release));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/**
 * Spec 13 §3.3 — a command that throws says so, and nothing else changes.
 *
 * The error is recorded with its channel name and then rethrown UNCHANGED, so
 * `guard` in `App.tsx` still shows the same notice it always showed. The only
 * thing this adds is that the failure stops being invisible to whoever ran
 * `npm run dev` — `doc:open` refusing a file extension was the line spec 13 §1
 * went looking for and could not find anywhere.
 */
type InvokeHandler = Parameters<typeof ipcMain.handle>[1];

function handle(channel: string, listener: InvokeHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      logLine("error", "ipc", `${channel} — ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  });
}

export function registerIpc(
  db: Db,
  getWindow: () => BrowserWindow | null,
  getCdp: () => CdpStatus,
): void {
  const agents = new Semaphore(MAX_CONCURRENT_AGENTS);

  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload);
  };

  /** One row, one `stream:step`. The database is written as the stream arrives. */
  const record = (threadId: string, draft: MessageDraft): Message => {
    const message = appendMessage(db, threadId, draft);
    send(EVENT.streamStep, message);
    return message;
  };

  const systemNote = (
    threadId: string,
    content: string,
    isError: boolean,
    /**
     * Spec 25 §5 and spec 31 §5 — set when the notice belongs to a run, so it
     * says which model and style produced it. Absent for a notice that is
     * REX's own and had no run behind it.
     */
    choices: SendChoices = { model: null, style: null },
  ): void => {
    record(threadId, {
      role: "system",
      kind: isError ? "error" : "text",
      ...choices,
      content,
      toolName: null,
      toolInput: null,
      isError,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
    });
  };

  /**
   * Invariant I1 — the main process cannot resolve anchors, so the sweep §8.7
   * step 6 demands is run in the renderer and its summary handed back.
   */
  const reanchor = async (changedDocumentIds: string[]): Promise<AnchorSummary> => {
    const window = getWindow();
    if (!window) return { ok: 0, moved: 0, orphaned: 0, total: 0 };
    return (await window.webContents.executeJavaScript(
      `window.__rexReanchor ? window.__rexReanchor(${JSON.stringify(changedDocumentIds)}) : null`,
    )) as AnchorSummary;
  };

  /**
   * `agentCwd` decides it; this is the one caller that also needs it to exist.
   * A repository root exists by virtue of having been found, so the scratch
   * directory is the only one that can be missing.
   */
  const workingDirectory = (thread: Thread): string => {
    const cwd = agentCwd(db, thread);
    if (cwd === SCRATCH_DIR) mkdirSync(cwd, { recursive: true });
    return cwd;
  };

  /**
   * SPEC.md §8.4 backstop — a `read` session that changed a file is a bug in
   * the gate, and has to reach the UI rather than a log line.
   */
  const backstop = (
    threadId: string,
    cwd: string,
    before: string[],
    choices: SendChoices,
  ): void => {
    const after = porcelainStatus(cwd);
    const introduced = after.filter((line) => !before.includes(line));
    if (introduced.length === 0) return;
    systemNote(
      threadId,
      `The read agent changed the repository, which the deny gate should have made impossible (SPEC.md §8.4). Changed: ${introduced.join(", ")}`,
      true,
      choices,
    );
  };

  const runTurn = async (
    thread: Thread,
    prompt: string,
    sessionId: string,
    resume: boolean,
    /**
     * Spec 25 §4.1 and spec 31 §4 — the model and the style this ASK runs
     * under, as the reviewer picked them.
     *
     * Arguments, and never `thread.model` or `thread.style`: both are
     * properties of a SEND, so a field read here would be mutable state no
     * send owns and two runs on one comment would take each other's. The
     * `thread.style` column exists (spec 31 §2.1) but it is memory for the
     * composer, written by the send and never read by it.
     */
    choices: SendChoices,
  ): Promise<void> => {
    const cwd = workingDirectory(thread);
    const before = porcelainStatus(cwd);
    // Spec 11 §6.4.2 — a `.pptx` is a marker like any other, so the design
    // plugins load for a deck review and a Markdown review pays nothing.
    const document = getDocument(db, thread.documentId);
    const documentPath = document?.ref.value ?? null;

    // Spec 17 §2.4 — registered BEFORE the semaphore, so a comment still queued
    // behind the five-agent cap can be stopped before it costs anything.
    // Spec 34 §5.1 — and holding the documents the prompt named, so nobody
    // replaces their copies under it.
    const controller = beginRun(
      thread.id,
      documentsOf(db, thread).map((record) => record.id),
    );
    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await agents.run(() =>
        runAgent({
          cwd,
          profile: "read",
          prompt,
          sessionId,
          resume,
          ...choices,
          documentPath,
          signal: controller.signal,
          // Spec 25 §5 and spec 31 §5 — every block this run produces says
          // which model wrote it and under which style. Stamped here, where
          // both are known, because the runner emits blocks and has no
          // business knowing what the reviewer picked.
          onMessage: (draft) => record(thread.id, { ...draft, ...choices }),
        }),
      );
    } finally {
      endRun(thread.id, controller);
    }

    setThreadSession(db, thread.id, result.sessionId);
    backstop(thread.id, cwd, before, choices);

    for (const denial of result.denials) {
      systemNote(
        thread.id,
        `Denied ${denial.toolName}${denial.subagentId ? ` (subagent ${denial.subagentId})` : ""}: ${denial.reason}`,
        false,
        choices,
      );
    }

    send(EVENT.streamCost, {
      documentId: thread.documentId,
      totalUsd: documentCostUsd(db, thread.documentId),
    });
  };

  /**
   * Spec 12 §3.3 — the reviewer's own message, and the mode they sent it in.
   *
   * The mode is passed rather than looked up because only the caller knows it:
   * it lives in the renderer and each of the four send paths below IS one mode.
   * Recording it is what lets a card say `YOU NOTED` about a note instead of
   * calling every message "asked".
   */
  const recordUserText = (
    threadId: string,
    text: string,
    mode: SendMode,
    /**
     * Spec 25 §5 and spec 31 §5 — what they picked. Both null for a NOTE,
     * which runs nothing and so runs under nothing.
     */
    choices: SendChoices,
  ): Message =>
    record(threadId, {
      role: "user",
      kind: "text",
      mode,
      ...choices,
      content: text,
      toolName: null,
      toolInput: null,
      isError: false,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
    });

  /**
   * Spec 24 §4 — the places a send carries, written before any prompt is
   * built, so `getThread` already returns them to everything downstream.
   *
   * Returns the position of the first new place — what `followUpPrompt` lists
   * from — or the thread's current length when the send carried none, which
   * makes "nothing new" and "list from here" the same number.
   */
  const addPlaces = (
    thread: Thread,
    message: Message,
    targets: TargetDraft[] | undefined,
  ): number => {
    const from = thread.targets.length;
    if (!targets || targets.length === 0) return from;
    // A synthesis thread has no places and does not take any (§3.6). The
    // renderer never offers it the strip; this is the backstop.
    if (thread.kind === "synthesis") {
      throw new Error("A synthesis comment has no places to add to.");
    }
    // §5.3 — a document REX cannot find refuses the whole send, so a comment
    // never half-grows. The transaction in `appendTargets` would refuse it too,
    // as a foreign-key error; this says it in the reviewer's words first.
    for (const target of targets) {
      if (!getDocument(db, target.documentId)) {
        throw new Error("One of the places is in a document REX no longer has. Nothing was sent.");
      }
    }
    appendTargets(db, thread.id, message.id, targets);
    return from;
  };

  // ── Documents ─────────────────────────────────────────────────

  handle(COMMAND.docPick, async (): Promise<DocumentRef | null> => {
    const window = getWindow();
    const result = await (window
      ? dialog.showOpenDialog(window, pickerOptions())
      : dialog.showOpenDialog(pickerOptions()));
    if (result.canceled || result.filePaths.length === 0) return null;
    return { kind: "file", value: result.filePaths[0] };
  });

  handle(COMMAND.docInitial, (): InitialTarget | null => {
    // `rex <path>` — the first argument that exists, skipping the executable,
    // the app path, and every --flag Electron adds. Spec 02 §7: a directory
    // opens as a workspace, a file as a single document.
    const candidates = process.argv.slice(1).filter((argument) => !argument.startsWith("-"));
    for (const candidate of candidates) {
      const absolute = resolve(candidate);
      if (absolute === resolve(process.cwd()) || !existsSync(absolute)) continue;
      const stats = statSync(absolute);
      if (stats.isFile()) return { kind: "document", ref: { kind: "file", value: absolute } };
      if (stats.isDirectory()) return { kind: "workspace", ref: { root: absolute } };
    }
    return null;
  });

  // ── Workspace (spec 02 §7) ────────────────────────────────────

  handle(COMMAND.workspacePick, async (): Promise<WorkspaceRef | null> => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Open a folder",
      properties: ["openDirectory"],
    };
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    if (result.canceled || result.filePaths.length === 0) return null;
    return { root: result.filePaths[0] };
  });

  handle(COMMAND.workspaceTree, (_event, ref: WorkspaceRef, reveal: boolean): WorkspaceTree => {
    // The whole workspace is served over rex-doc://, so a document's siblings
    // and images resolve however deep in the tree they sit.
    allowDirectory(ref.root);
    // Spec 23 §2.2 — and it is now also a folder REX will rename inside. The
    // two facts are the same fact: this is a root the reviewer is looking at.
    noteWorkspaceRoot(ref.root);
    return scanWorkspace(db, ref.root, { reveal });
  });

  // Spec 10 §3.4. The renderer says what the reviewer chose; main works out
  // whether that means writing a rule or deleting one, because the rules are
  // its own and a renderer that guessed would drift from them.
  handle(COMMAND.workspaceExclude, (_event, request: WorkspaceExcludeRequest): void => {
    toggleWorkspaceRule(db, request.root, request.path, request.exclude ? "exclude" : "include");
  });

  handle(
    COMMAND.workspaceGraph,
    (_event, ref: WorkspaceRef): ReferenceGraph =>
      buildReferenceGraph(db, scanWorkspace(db, ref.root)),
  );

  // Spec 23 §2 — the reviewer's own file acts. Every guard is in
  // `workspace/files.ts`; these two lines are the door and nothing else.
  handle(
    COMMAND.workspaceRename,
    (_event, request: WorkspaceRenameRequest): WorkspaceFileResult => renameEntry(db, request),
  );

  handle(
    COMMAND.workspaceDelete,
    (_event, request: WorkspaceDeleteRequest): Promise<WorkspaceFileResult> =>
      // §3 — the system Bin, so the reviewer's own `Put Back` is the undo.
      deleteEntry(request, (path) => shell.trashItem(path)),
  );

  // Spec 28 §4.2 — the renderer names a root and a query; main decides which
  // files that means and what each one says.
  handle(
    COMMAND.workspaceSearch,
    (_event, request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult> =>
      searchWorkspace(db, request.root, request.query),
  );

  handle(
    COMMAND.docOpen,
    async (_event, ref: DocumentRef, version?: DocumentVersion): Promise<OpenedDocument> => {
      // Spec 15 §6.1 — a version, never a path. The renderer displays untrusted
      // content, so it names which of the two it wants and main decides where
      // that is; a path from the renderer would be a file main reads on its say.
      //
      // Spec 34 §4 — pending, not present. A copy that equals the file is not a
      // second version to draw; the file is rendered and `working` is null.
      const meta = pendingCopy(ref.value);
      const wanted: DocumentVersion = meta && version !== "original" ? "current" : "original";
      const rendered = await renderDocument(
        ref,
        wanted === "current" && meta ? currentPath(meta) : undefined,
      );

      // The hash stored and compared is the FILE's, whichever version was drawn.
      // §6.6 uses it to tell `ok` from `moved`, and a working copy's hash here
      // would report the document as changed while it demonstrably had not.
      const onDisk = fileHash(ref.value) ?? rendered.contentHash;
      const { record: document, previousHash } = upsertDocument(db, ref, rendered.title, onDisk);
      if (rendered.baseDir) allowDirectory(rendered.baseDir);

      return {
        documentId: document.id,
        ref,
        presentation: rendered.presentation,
        contentHash: onDisk,
        title: rendered.title,
        baseDir: rendered.baseDir,
        applyEnabled: rendered.applyEnabled,
        applyDisabledReason: rendered.applyDisabledReason,
        // §6.6 — "changed since the comments were written" is what separates
        // `ok` from `moved` for an anchor that still resolves at layer 1.
        contentChanged: previousHash !== null && previousHash !== onDisk,
        version: wanted,
        working: meta ? viewOf(meta, repositoryRoot(meta.path)) : null,
      };
    },
  );

  // ── The working copy (spec 15 §7) ─────────────────────────────

  handle(COMMAND.workList, (): WorkingCopyView[] =>
    // Spec 34 §4 — pending, not present.
    pendingCopies().map((meta) => viewOf(meta, repositoryRoot(meta.path))),
  );

  handle(COMMAND.workApprove, async (_event, documentId: string): Promise<WorkApproveResponse> => {
    // Spec 34 §5.2 — never under a running agent. Approving now would read a
    // half-finished edit into the reviewer's file.
    if (isHeld(documentId)) return { ok: false, reason: HELD_REASON, reanchored: null };
    const meta = readMeta(documentId);
    const result = approveWorkingCopy(documentId);
    if (!result.ok) return { ok: false, reason: result.reason ?? null, reanchored: null };

    // §7.2 — the file changed, so every run that contributed to it is applied
    // and the document is re-hashed before the sweep compares against it.
    if (meta) {
      for (const revision of meta.revisions) completeApplyRun(db, revision.applyRunId, "applied");
      setDocumentHash(db, documentId, fileHash(meta.path) ?? "");
    }
    // Spec 34 §6.1 — said in every open comment on the document.
    noteEvent(documentId, "The reviewer approved the change. The file now holds it.");
    return { ok: true, reason: null, reanchored: await reanchor([documentId]) };
  });

  handle(COMMAND.workDiscard, async (_event, documentId: string): Promise<WorkActResponse> => {
    // Spec 34 §5.2 — never under a running agent: discard writes the reviewer's
    // bytes over the copy the agent is in the middle of editing.
    if (isHeld(documentId)) return { ok: false, reason: HELD_REASON };
    const meta = readMeta(documentId);
    const wasPending = meta !== null && isPending(meta);
    discardWorkingCopy(documentId);
    if (meta) {
      for (const revision of meta.revisions) completeApplyRun(db, revision.applyRunId, "rejected");
    }
    // Spec 34 §6.1 — said in every open comment on the document. Only when
    // there was a change to throw away: a discard of nothing is not an event.
    if (wasPending) {
      // "What the file holds", not "the original": an earlier change may have
      // been approved already, and an agent read "original" as everything
      // reverted (measured in milestone 4).
      noteEvent(
        documentId,
        "The reviewer discarded the change. The document is back to what the file holds.",
      );
    }
    // The file was never touched, so nothing on disk moved — but the document on
    // screen goes back to being the file, and its anchors were resolved against
    // the version that has just gone.
    await reanchor([documentId]);
    return { ok: true, reason: null };
  });

  handle(COMMAND.workUndo, async (_event, documentId: string): Promise<WorkActResponse> => {
    // Spec 34 §5.2 — never under a running agent: it rewinds what the agent is
    // in the middle of.
    if (isHeld(documentId)) return { ok: false, reason: HELD_REASON };
    const before = readMeta(documentId);
    const dropped = before?.revisions.at(-1) ?? null;
    undoLastRevision(documentId);
    if (dropped) {
      completeApplyRun(db, dropped.applyRunId, "rejected");
      // Spec 34 §6.1 — said in every open comment on the document.
      noteEvent(documentId, "The reviewer undid the last run.");
    }
    // Undone all the way back is the reviewer's own bytes again. Spec 34 §3.2 —
    // the copy then equals `base`, so nothing is pending and the panes close;
    // the directory stays, because an agent may hold its path.
    await reanchor([documentId]);
    return { ok: true, reason: null };
  });

  // ── Threads ───────────────────────────────────────────────────

  /**
   * Spec 05 §5.3 — the workspace's comments, not the open document's.
   *
   * With no workspace the scope is the open document's own directory, so a
   * single file opened by path behaves as it did: its siblings' comments are in
   * reach, and nothing else is.
   *
   * `thread:delete-all` resolves the request through this same function, so the
   * fallback cannot apply to the list and not to the delete.
   */
  const scopeOf = (request: ThreadListRequest): ThreadListRequest => {
    const document = request.documentId ? getDocument(db, request.documentId) : null;
    return {
      root: request.root ?? (document ? dirname(document.ref.value) : null),
      documentId: request.documentId,
    };
  };

  handle(COMMAND.threadList, (_event, request: ThreadListRequest): ThreadWithMessages[] =>
    listThreads(db, scopeOf(request)).map((thread) => withDetail(db, thread)),
  );

  handle(COMMAND.threadCreate, (_event, request: ThreadCreateRequest): Thread => {
    // §7, and spec 30 §2.4 — a payload with no target has no document either,
    // and a thread with neither is a comment about nothing. It is what makes
    // "back with no places saves nothing" true without a second rule.
    if (request.targets.length === 0) throw new Error("A comment needs at least one place.");
    return createThread(db, {
      kind: "anchored",
      targets: request.targets,
      note: request.note,
      profile: "read",
      // Spec 30 §2 — the lane it is born in. `open` for the ordinary comment
      // the renderer sends immediately after this call; `draft` for one the
      // reviewer walked away from; `note` for one they saved for themselves.
      status: request.status ?? "open",
      // Spec 30 §3.6 — the name typed in the composer, before the row exists.
      title: request.title ?? null,
    });
  });

  /**
   * Spec 30 §3.2 — the reviewer pressed back with places in the composer.
   *
   * One channel for both halves of that gesture, because they are one write:
   * the places move and the question moves with them. `queries.saveDraft`
   * refuses anything that is not a draft, and refuses an empty place list.
   */
  handle(COMMAND.threadDraftSave, (_event, request: ThreadDraftSaveRequest): Thread => {
    saveDraft(
      db,
      request.threadId,
      request.targets,
      request.note,
      request.status ?? "draft",
      request.title ?? null,
    );
    const thread = getThread(db, request.threadId);
    if (!thread) throw new Error(`No such thread: ${request.threadId}`);
    return thread;
  });

  /**
   * Spec 30 §3.5 — **Turn into a comment**: a note becomes a draft.
   *
   * It refuses anything that is not a note rather than moving it quietly. The
   * button is only ever drawn on a note's card, so a call that arrives about
   * anything else is a bug worth hearing about, not a state to tolerate.
   */
  handle(COMMAND.threadPromote, (_event, threadId: string): Thread => {
    if (!markThreadDraft(db, threadId)) {
      throw new Error("Only a note can be turned into a comment.");
    }
    const thread = getThread(db, threadId);
    if (!thread) throw new Error(`No such thread: ${threadId}`);
    return thread;
  });

  /**
   * What a read prompt needs to name a comment's places: each document's
   * readable path, the repository root, and — while a working copy exists —
   * where a passage's text actually is.
   *
   * Shared by the opening prompt and by a follow-up that adds places (spec 24
   * §6.1), so the two cannot disagree about which version of a document the
   * agent is pointed at.
   */
  const readContext = async (
    thread: Thread,
  ): Promise<{
    documentPaths: Map<string, string>;
    repositoryRoot: string;
    locate?: (documentPath: string, anchor: Anchor) => PassagePlace;
    readAt: Map<string, string>;
  }> => {
    const document = getDocument(db, thread.documentId);
    const documentPath = document?.ref.value ?? "";
    const root = document ? repositoryRoot(documentPath) : dirname(documentPath);

    // Spec 05 §5.5 — every target's document, so the prompt can group them.
    // The reviewer's own paths: they are the NAMES the prompt uses, and spec
    // 34 §7 keeps them that way. Spec 11 §6.2 — a deck is named by its text
    // sidecar instead of by the zip.
    const documentPaths = new Map<string, string>();
    // Spec 34 §4 — and where the agent READS each text document: its working
    // copy, always. ASK is pointed at the copy on its first turn, and that is
    // where the document stays — approve and discard move bytes, never the
    // path, so a resumed session's memory of it is right on every turn (§1.3).
    // `ensureWorkingCopy` makes the copy, or syncs a stale one from the file
    // when nothing is pending (§3.3). Spec 15 §5's reason stands: the copy IS
    // the current version, and asking "is this better?" about a version the
    // agent cannot see would be worse than useless.
    const readAt = new Map<string, string>();
    // Spec 16 §5.4 — and the original beside it while a change is pending, so
    // a comment about a passage the change REMOVED can be named as the
    // original's rather than handed to the agent as a quote it cannot find.
    const originals = new Map<string, string>();
    for (const record of documentsOf(db, thread)) {
      documentPaths.set(record.id, await readablePath(record.ref));
      const meta = copyFor(record.id, record.ref);
      if (!meta) continue;
      readAt.set(record.id, currentPath(meta));
      if (isPending(meta)) originals.set(record.ref.value, basePath(meta));
    }

    // Spec 16 §5.1 — where a passage is NOW, keyed by the reviewer's path
    // because that is what `passageSection` hands over. The line is the copy's,
    // since the copy is what the agent opens (spec 34 §7).
    const copies = new Map<string, string>();
    for (const [id, copy] of readAt) copies.set(documentPaths.get(id) ?? id, copy);

    return {
      documentPaths,
      repositoryRoot: root,
      readAt,
      // Only for documents that have a copy. A deck or a Word file has one
      // version the agent can read, every passage is in it, and there is
      // nothing to say.
      ...(copies.size > 0
        ? {
            locate: (path: string, anchor: Anchor) =>
              locatePassage(copies.get(path) ?? path, originals.get(path) ?? null, anchor),
          }
        : {}),
    };
  };

  /**
   * Spec 34 §6.1 — the reviewer's approve, discard or undo, as a message in
   * every open comment on that document.
   *
   * `open` and not every comment: a draft or a note never had an agent, and a
   * resolved comment is finished (spec 18 §2). The sentence is written for
   * both readers at once — the card, and the agent's transcript — so it names
   * the reviewer rather than saying "you".
   */
  const noteEvent = (documentId: string, content: string): void => {
    for (const thread of listThreadsInDocument(db, documentId)) {
      if (thread.status !== "open") continue;
      record(thread.id, {
        role: "system",
        kind: "event",
        model: null,
        style: null,
        content,
        toolName: null,
        toolInput: null,
        isError: false,
        costUsd: null,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
    }
  };

  handle(
    COMMAND.threadAsk,
    async (_event, threadId: string, model: string | null, style: string | null): Promise<void> => {
      const thread = getThread(db, threadId);
      if (!thread) throw new Error(`No such thread: ${threadId}`);
      // Spec 30 §2.2 — it is being sent, so it leaves `draft` or `note` for
      // `open`. A no-op for a comment that was already sent, and it never
      // touches `resolved`.
      markThreadSent(db, threadId);

      const prompt =
        thread.kind === "synthesis"
          ? synthesisPrompt({
              note: thread.note,
              referenced: thread.refThreadIds
                .map((id) => getThread(db, id))
                .filter((t): t is Thread => t !== null)
                .map((t) => ({ thread: t, messages: listMessages(db, t.id) })),
            })
          : askPrompt({ thread, ...(await readContext(thread)) });

      const choices: SendChoices = { model, style };
      // Spec 31 §4.1 — the chat remembers the style it was sent under.
      setThreadStyle(db, threadId, style);
      recordUserText(threadId, thread.note, "ask", choices);
      await runTurn(thread, prompt, sessionIdFor(threadId), false, choices);
    },
  );

  /**
   * Spec 17 §2.1 — stop this comment's work, all of it.
   *
   * It deliberately does NOT check that the thread exists. A stop is the one
   * command a reviewer presses when something has gone wrong, and refusing it
   * because a row has been deleted underneath would leave an agent running with
   * nothing left to stop it.
   */
  handle(COMMAND.threadStop, (_event, threadId: string): number => stopRun(threadId));

  /**
   * NOTE mode, in an open comment: record what was typed and run nothing.
   *
   * The same `recordUserText` every send already uses, and then it stops — no
   * agent, no session, no cost. It deliberately does NOT clear `is_note`: adding
   * a note to a note leaves it a note, and adding one to an answered comment
   * does not turn that comment back into a note either.
   */
  handle(COMMAND.threadNote, (_event, request: ThreadReplyRequest): void => {
    const thread = getThread(db, request.threadId);
    if (!thread) throw new Error(`No such thread: ${request.threadId}`);
    // Spec 24 §4.3 — a note can point somewhere too. Nothing runs, nothing is
    // spent, and the comment is about one more place.
    //
    // Spec 25 §2.3 — and so no model, and spec 31 §4 — and no style. Both are
    // null from the renderer and would be ignored anyway: NULL here is the
    // honest record of a message that no agent ever saw.
    const message = recordUserText(request.threadId, request.text, "note", {
      model: null,
      style: null,
    });
    addPlaces(thread, message, request.targets);
    // Spec 30 §2.2 — **Save** on a draft is what makes it a note. Only from
    // `draft`: an `open` comment that gets a NOTE message keeps its lane,
    // because spec 24 §4.3's note-on-an-answered-comment has still been sent.
    markThreadNoted(db, request.threadId);
  });

  handle(COMMAND.threadReply, async (_event, request: ThreadReplyRequest): Promise<void> => {
    const thread = getThread(db, request.threadId);
    if (!thread) throw new Error(`No such thread: ${request.threadId}`);
    markThreadSent(db, request.threadId);

    const cwd = workingDirectory(thread);
    const existing = thread.sessionId ?? sessionIdFor(thread.id);
    const choices: SendChoices = { model: request.model, style: request.style };
    setThreadStyle(db, thread.id, request.style);
    const message = recordUserText(thread.id, request.text, "ask", choices);

    // Spec 24 §4.1 — the places first, then the prompt that names them. The
    // thread is re-read so the prompt sees the grown list; with nothing added
    // the prompt is the bare text, as it always was.
    const from = addPlaces(thread, message, request.targets);
    const grown = (request.targets?.length ?? 0) > 0 ? getThread(db, thread.id) : null;
    const prompt = grown
      ? followUpPrompt({ thread: grown, from, text: request.text, ...(await readContext(grown)) })
      : request.text;

    // SPEC.md §8.5 — the SDK's transcript cache can be cleaned at any time.
    // REX keeps the thread; only the SDK's own record was lost.
    if (await sessionExists(cwd, existing)) {
      // Spec 34 §6.2 — a resumed session has its own memory and gets only the
      // reply, so what the reviewer did to the document since the agent last
      // spoke goes in front of it: once, and only when there is something.
      const events = eventsSinceLastAnswer(listMessages(db, thread.id));
      await runTurn(thread, withEvents(events, prompt), existing, true, choices);
      return;
    }

    const transcript = renderTranscript(
      listMessages(db, thread.id).filter((m) => m.content !== request.text),
    );
    // Spec 34 §7 — a replayed session is a fresh one, and is told where the
    // document is once, exactly as the opening ASK prompt says it.
    const header = documentHeader({
      thread: grown ?? thread,
      ...(await readContext(grown ?? thread)),
    });
    await runTurn(thread, replayPrompt(transcript, prompt, header), uuidv4(), false, choices);
  });

  handle(COMMAND.threadResolve, (_event, request: ThreadResolveRequest): Thread => {
    setThreadStatus(db, request.threadId, request.resolved);
    const thread = getThread(db, request.threadId);
    if (!thread) throw new Error(`No such thread: ${request.threadId}`);
    return thread;
  });

  /**
   * §9's cascades do the work; this only has to be honest about what it did.
   *
   * A thread that is mid-run is deleted anyway rather than refused: the agent
   * writes its messages through `getThread`, which now finds nothing, and the
   * reviewer asking for a comment to be gone should not have to wait out a
   * four-minute answer to get it.
   */
  handle(COMMAND.threadDelete, (_event, threadId: string): void => {
    deleteThread(db, threadId);
  });

  /**
   * Every comment in the panel, gone, and the count so the renderer can say so.
   *
   * The reviewer confirmed this at the control they pressed; by the time it
   * reaches main the decision is made, exactly as for one comment. A comment
   * mid-run goes with the rest, for the reason above it.
   */
  handle(COMMAND.threadDeleteAll, (_event, request: ThreadListRequest): number =>
    deleteThreadsInScope(db, scopeOf(request)),
  );

  // ── Spec 14 — the name, the order and the groups ──────────────

  handle(COMMAND.threadRename, (_event, request: ThreadRenameRequest): void => {
    renameThread(db, request.threadId, request.title);
  });

  handle(COMMAND.groupList, (_event, request: GroupListRequest): CommentGroup[] =>
    listGroups(db, request.root),
  );

  handle(
    COMMAND.groupCreate,
    (_event, request: GroupCreateRequest): CommentGroup => createGroup(db, request),
  );

  handle(COMMAND.groupUpdate, (_event, request: GroupUpdateRequest): void => {
    updateGroup(db, request);
  });

  /**
   * Spec 14 §5.4 — everything inside is promoted to this group's own parent
   * first, so the schema's cascade has nothing to take. No comment is destroyed
   * by deleting a group.
   */
  handle(COMMAND.groupDelete, (_event, request: GroupDeleteRequest): void => {
    deleteGroup(db, request.groupId);
  });

  /**
   * Spec 14 §4.2 — the panel sends a gesture; every position is computed here.
   *
   * The refusals are main's and not the panel's: §5.5's cycle makes the tree
   * walk non-terminating, and a panel is not where a rule that can hang the app
   * belongs.
   */
  handle(COMMAND.commentsMove, (_event, request: CommentMove): void => {
    moveItem(db, request);
  });

  handle(
    COMMAND.threadSynthesise,
    (_event, request: ThreadSynthesiseRequest): Thread =>
      createThread(db, {
        // A synthesis comment is about other comments, not about a passage, so
        // it has no targets and carries its document directly.
        documentId: request.documentId,
        kind: "synthesis",
        targets: [],
        note: request.note,
        profile: "read",
        refThreadIds: request.refThreadIds,
      }),
  );

  handle(COMMAND.anchorRestate, (_event, request: AnchorRestateRequest): void => {
    setTargetState(db, request.threadId, request.position, request.anchorState);
  });

  // ── Diagrams (spec 11 §7.4.2) ─────────────────────────────────
  //
  // The one request that flows main → renderer and waits for an answer. Mermaid
  // needs a live DOM to measure text and a canvas to rasterise into, and main
  // has neither; the renderer has both and holds no deck. So main asks.

  /** In-flight drawings, by request id. Nothing survives a window reload. */
  const pendingRenders = new Map<
    string,
    {
      resolve: (drawn: { png: Buffer; durationSeconds: number }) => void;
      reject: (error: Error) => void;
    }
  >();

  handle(COMMAND.renderResult, (_event, request: RenderResultRequest): void => {
    const waiting = pendingRenders.get(request.id);
    if (!waiting) return;
    pendingRenders.delete(request.id);
    if (request.pngBase64) {
      waiting.resolve({
        png: Buffer.from(request.pngBase64, "base64"),
        durationSeconds: request.durationSeconds ?? 0,
      });
    } else {
      waiting.reject(new Error(request.error ?? "the picture did not draw"));
    }
  });

  /** A drawing has to finish, or Apply would wait for a window that closed. */
  const RENDER_TIMEOUT_MS = 20_000;

  const askRenderer = (
    kind: "diagram" | "poster",
    source: string,
  ): Promise<{ png: Buffer; durationSeconds: number }> => {
    const window = getWindow();
    if (!window) {
      return Promise.reject(
        new Error("A Mermaid diagram can only be drawn while REX's window is open."),
      );
    }
    const id = uuidv4();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRenders.delete(id);
        reject(new Error("The picture took too long to draw and the operation was refused."));
      }, RENDER_TIMEOUT_MS);
      pendingRenders.set(id, {
        resolve: (drawn) => {
          clearTimeout(timer);
          resolve(drawn);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      send(EVENT.renderRequest, { id, kind, source });
    });
  };

  const drawDiagram = async (source: string): Promise<Buffer> =>
    (await askRenderer("diagram", source)).png;

  /** §7.4.5 — the poster is read from the video REX has just written to disk. */
  const drawPoster = async (
    videoPath: string,
  ): Promise<{ png: Buffer; durationSeconds: number }> => {
    allowDirectory(dirname(videoPath));
    return askRenderer(
      "poster",
      `${baseHrefFor(dirname(videoPath))}${encodeURIComponent(basename(videoPath))}`,
    );
  };

  // ── Apply ─────────────────────────────────────────────────────

  const applyContext: ApplyContext = {
    db,
    record,
    reanchor,
    resolver: { drawDiagram, drawPoster },
    onApplyReady: (event) => send(EVENT.applyReady, event),
  };

  /**
   * Spec 12 §4.2 — an ACT send, which is the only thing that changes a file.
   *
   * The note is recorded as a user message FIRST, before the agent starts. It
   * is what the reviewer just said, the card and the trace show it while the
   * run is working, and `startApply` takes it back out of the transcript it
   * builds so the instruction is not printed twice.
   */
  handle(COMMAND.threadApply, async (_event, request: ThreadApplyRequest) => {
    const thread = getThread(db, request.threadId);
    if (!thread) throw new Error(`No such thread: ${request.threadId}`);
    markThreadSent(db, request.threadId);
    setThreadStyle(db, request.threadId, request.style);
    const message = recordUserText(request.threadId, request.note, "act", {
      model: request.model,
      style: request.style,
    });
    // Spec 24 §4.2 — the places are rows before `startApply` reads the thread,
    // so their documents join the run with no new code in `apply.ts`. The
    // message id goes along so the passage list can mark them (§6.2).
    addPlaces(thread, message, request.targets);
    // Spec 34 §3.2 — nothing is swept afterwards. A run that changed nothing
    // leaves a copy that equals the file, which is not pending and is drawn
    // nowhere; the directory stays for the next agent that is pointed at it.
    return startApply(applyContext, request.threadId, request.note, request.root, {
      addedWith: message.id,
      model: request.model,
      style: request.style,
    });
  });

  handle(COMMAND.applyConfirm, (_event, request: ApplyConfirmRequest) =>
    confirmApply(applyContext, request.applyRunId, request.accept),
  );

  // ── Models ────────────────────────────────────────────────────

  /**
   * Spec 25 §3 — the models this account can use, and the current default.
   *
   * The probe is cached in `models.ts`, so the first call pays about a second
   * and every later one is free. `SCRATCH_DIR` is the cwd because the list does
   * not depend on one and there may be no document open when the renderer asks.
   */
  handle(COMMAND.modelList, async (): Promise<AgentChoices> => {
    const probe = await listCapabilities(SCRATCH_DIR);
    return {
      models: probe.models,
      chosen: defaultModel(db, probe.models),
      // Spec 31 §2.2 — no `chosen` style. A style belongs to the chat, so
      // there is no app-wide value for the renderer to fall back to.
      styles: probe.styles,
      error: probe.error,
    };
  });

  /**
   * Spec 25 §6 — the app-wide default. Every send uses it unless its comment
   * says otherwise.
   *
   * Stored as given, with no check against the list. §6.2 is where a value that
   * is not offered is handled, and it handles it by falling back on read rather
   * than by refusing on write — a model can come back.
   */
  handle(COMMAND.modelDefault, (_event, value: string): void => {
    setSetting(db, MODEL_DEFAULT_KEY, value);
  });

  /**
   * Spec 27 §4.7 — how the reviewer last had the Markdown page drawn.
   *
   * Read once when the overlay mounts and written on every switch. It reaches
   * no document: both values are how the renderer draws a page it already has,
   * which is why main only ever remembers them.
   */
  handle(COMMAND.paperView, (): PaperView => paperView(db));

  handle(COMMAND.paperViewSet, (_event, view: PaperView): void => {
    setPaperView(db, view);
  });

  // ── Debug ─────────────────────────────────────────────────────

  handle(COMMAND.debugCopy, async (_event, threadId: string): Promise<string> => {
    const report = await debugReport(db, threadId, app.getVersion());
    clipboard.writeText(report);
    return report;
  });

  /**
   * Spec 13 §4 — the app's own report.
   *
   * The clipboard is written here and not in the renderer for the reason §6.2
   * already gave: Electron owns it, and a copy that needs the renderer focused
   * fails in exactly the case where the renderer is the thing that is wrong.
   */
  handle(COMMAND.debugSnapshot, (_event, view: ViewState | null): string => {
    const report = appReport(
      {
        appVersion: app.getVersion(),
        pid: process.pid,
        packaged: app.isPackaged,
        uptimeMs: Math.round(process.uptime() * 1000),
        userDataPath: app.getPath("userData"),
        cdp: getCdp(),
        logPath: logFile(),
        logLines: lineCount(),
      },
      view,
      entries(40),
    );
    clipboard.writeText(report);
    return report;
  });
}

/**
 * The path an agent can actually read this document from.
 *
 * For everything but a deck that is the document itself. Spec 11 §6.1: a
 * `.pptx` is a zip, so `Read` fails on it and the agent answers from the
 * comment alone while appearing to have read the file — the invisible failure
 * §6.2's sidecar exists to close. A deck REX could not parse has no sidecar, so
 * the zip is named and the agent's `Read` fails loudly instead of quietly.
 */
async function readablePath(ref: DocumentRef): Promise<string> {
  if (!isPptxPath(ref.value)) return ref.value;
  return (await ensureSidecar(ref.value)) ?? ref.value;
}

/**
 * Spec 34 §4 — the working copy an ASK agent is pointed at, or null for a
 * document that does not get one.
 *
 * Text documents only — Markdown and HTML. A deck is named by its text sidecar
 * (spec 11 §6.2) and a Word file by itself (spec 19 §4.2); neither is read at
 * a path this spec owns. A file that cannot be read gets no copy either: the
 * agent is handed the path as before, and its own `Read` says what is wrong,
 * where a throw here would fail the whole send with a less useful sentence.
 */
function copyFor(documentId: string, ref: DocumentRef): WorkingMeta | null {
  if (ref.kind !== "file" || !isTextDocumentPath(ref.value)) return null;
  try {
    return ensureWorkingCopy(documentId, ref.value);
  } catch {
    return null;
  }
}

/**
 * The hash of what is on disk, whichever version was drawn.
 *
 * Spec 15 §6.1 — §6.6 compares this to decide `ok` against `moved`, so it has
 * to be the FILE's hash even while the pane is showing a working copy. Storing
 * the copy's would report every anchor as moved the moment a revision landed.
 */
function fileHash(path: string): string | null {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

function pickerOptions(): Electron.OpenDialogOptions {
  return {
    title: "Open a document",
    properties: ["openFile"],
    filters: [
      {
        name: "Documents",
        extensions: ["md", "markdown", "mdown", "mkd", "html", "htm", "pdf", "docx", "pptx"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  };
}
