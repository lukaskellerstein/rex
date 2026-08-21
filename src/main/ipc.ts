// SPEC.md §10 — channel registration, and the thread service behind it.
//
// Invariant I3: every command is `ipcRenderer.invoke`, every piece of agent
// output is `webContents.send`. Nothing here listens on anything.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  type AnchorRestateRequest,
  type ApplyConfirmRequest,
  COMMAND,
  EVENT,
  type InitialTarget,
  type ThreadCreateRequest,
  type ThreadListRequest,
  type ThreadReplyRequest,
  type ThreadResolveRequest,
  type ThreadSynthesiseRequest,
} from "../shared/channels.ts";
import type {
  AnchorSummary,
  DocumentRef,
  Message,
  OpenedDocument,
  ReferenceGraph,
  Thread,
  ThreadWithMessages,
  WorkspaceRef,
  WorkspaceTree,
} from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { askPrompt, synthesisPrompt } from "./agent/prompts.ts";
import { runAgent } from "./agent/runner.ts";
import { renderTranscript, replayPrompt, sessionExists } from "./agent/transcript.ts";
import { type ApplyContext, confirmApply, startApply } from "./apply.ts";
import type { Db } from "./db/database.ts";
import {
  appendMessage,
  createThread,
  documentCostUsd,
  getDocument,
  getThread,
  listMessages,
  listThreads,
  type MessageDraft,
  setTargetState,
  setThreadSession,
  setThreadStatus,
  upsertDocument,
} from "./db/queries.ts";
import { porcelainStatus, repositoryRoot } from "./git.ts";
import { allowDirectory } from "./protocol.ts";
import { renderDocument } from "./render/index.ts";
import { documentsOf, withDetail } from "./threads.ts";
import { buildReferenceGraph } from "./workspace/graph.ts";
import { scanWorkspace } from "./workspace/tree.ts";

/**
 * SPEC.md §8.8 point 2 — "Ask all" fans out, and the reference implementation
 * caps nothing. Five at a time.
 */
const MAX_CONCURRENT_AGENTS = 5;

/** A document opened from a URL has no repository, so the agent gets an empty one. */
const URL_SCRATCH = join(homedir(), ".rex", "scratch");

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

export function registerIpc(db: Db, getWindow: () => BrowserWindow | null): void {
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

  const systemNote = (threadId: string, content: string, isError: boolean): void => {
    record(threadId, {
      role: "system",
      kind: isError ? "error" : "text",
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

  /** The agent's working directory: the document's repository, or a scratch dir. */
  const workingDirectory = (thread: Thread): string => {
    const document = getDocument(db, thread.documentId);
    if (document?.ref.kind === "file") return repositoryRoot(document.ref.value);
    mkdirSync(URL_SCRATCH, { recursive: true });
    return URL_SCRATCH;
  };

  /**
   * SPEC.md §8.4 backstop — a `read` session that changed a file is a bug in
   * the gate, and has to reach the UI rather than a log line.
   */
  const backstop = (threadId: string, cwd: string, before: string[]): void => {
    const after = porcelainStatus(cwd);
    const introduced = after.filter((line) => !before.includes(line));
    if (introduced.length === 0) return;
    systemNote(
      threadId,
      `The read agent changed the repository, which the deny gate should have made impossible (SPEC.md §8.4). Changed: ${introduced.join(", ")}`,
      true,
    );
  };

  const runTurn = async (
    thread: Thread,
    prompt: string,
    sessionId: string,
    resume: boolean,
  ): Promise<void> => {
    const cwd = workingDirectory(thread);
    const before = porcelainStatus(cwd);

    const result = await agents.run(() =>
      runAgent({
        cwd,
        profile: "read",
        prompt,
        sessionId,
        resume,
        model: thread.model,
        onMessage: (draft) => record(thread.id, draft),
      }),
    );

    setThreadSession(db, thread.id, result.sessionId);
    backstop(thread.id, cwd, before);

    for (const denial of result.denials) {
      systemNote(
        thread.id,
        `Denied ${denial.toolName}${denial.subagentId ? ` (subagent ${denial.subagentId})` : ""}: ${denial.reason}`,
        false,
      );
    }

    send(EVENT.streamCost, {
      documentId: thread.documentId,
      totalUsd: documentCostUsd(db, thread.documentId),
    });
  };

  const recordUserText = (threadId: string, text: string): void => {
    record(threadId, {
      role: "user",
      kind: "text",
      content: text,
      toolName: null,
      toolInput: null,
      isError: false,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
    });
  };

  // ── Documents ─────────────────────────────────────────────────

  ipcMain.handle(COMMAND.docPick, async (): Promise<DocumentRef | null> => {
    const window = getWindow();
    const result = await (window
      ? dialog.showOpenDialog(window, pickerOptions())
      : dialog.showOpenDialog(pickerOptions()));
    if (result.canceled || result.filePaths.length === 0) return null;
    return { kind: "file", value: result.filePaths[0] };
  });

  ipcMain.handle(COMMAND.docInitial, (): InitialTarget | null => {
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

  ipcMain.handle(COMMAND.workspacePick, async (): Promise<WorkspaceRef | null> => {
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

  ipcMain.handle(COMMAND.workspaceTree, (_event, ref: WorkspaceRef): WorkspaceTree => {
    // The whole workspace is served over rex-doc://, so a document's siblings
    // and images resolve however deep in the tree they sit.
    allowDirectory(ref.root);
    return scanWorkspace(db, ref.root);
  });

  ipcMain.handle(
    COMMAND.workspaceGraph,
    (_event, ref: WorkspaceRef): ReferenceGraph =>
      buildReferenceGraph(db, scanWorkspace(db, ref.root)),
  );

  ipcMain.handle(COMMAND.docOpen, async (_event, ref: DocumentRef): Promise<OpenedDocument> => {
    const rendered = await renderDocument(ref);
    const { record: document, previousHash } = upsertDocument(
      db,
      ref,
      rendered.title,
      rendered.contentHash,
    );
    if (rendered.baseDir) allowDirectory(rendered.baseDir);

    return {
      documentId: document.id,
      ref,
      presentation: rendered.presentation,
      contentHash: rendered.contentHash,
      title: rendered.title,
      baseDir: rendered.baseDir,
      webviewPreload: pathToFileURL(join(import.meta.dirname, "..", "preload", "webview.cjs")).href,
      applyEnabled: rendered.applyEnabled,
      applyDisabledReason: rendered.applyDisabledReason,
      // §6.6 — "changed since the comments were written" is what separates
      // `ok` from `moved` for an anchor that still resolves at layer 1.
      contentChanged: previousHash !== null && previousHash !== rendered.contentHash,
    };
  });

  // ── Threads ───────────────────────────────────────────────────

  /**
   * Spec 05 §5.3 — the workspace's comments, not the open document's.
   *
   * With no workspace the scope is the open document's own directory, so a
   * single file opened by path behaves as it did: its siblings' comments are in
   * reach, and nothing else is.
   */
  ipcMain.handle(COMMAND.threadList, (_event, request: ThreadListRequest): ThreadWithMessages[] => {
    const document = request.documentId ? getDocument(db, request.documentId) : null;
    const root =
      request.root ?? (document?.ref.kind === "file" ? dirname(document.ref.value) : null);
    return listThreads(db, { root, documentId: request.documentId }).map((thread) =>
      withDetail(db, thread),
    );
  });

  ipcMain.handle(COMMAND.threadCreate, (_event, request: ThreadCreateRequest): Thread => {
    // §7 — a payload with no target has no document either, and a thread with
    // neither is a comment about nothing.
    if (request.targets.length === 0) throw new Error("A comment needs at least one place.");
    return createThread(db, {
      kind: "anchored",
      targets: request.targets,
      note: request.note,
      profile: "read",
      // Spec 06 §5.4 — the ink, when the places were circled rather than
      // clicked. Absent for every other comment, which is most of them.
      stroke: request.stroke,
    });
  });

  ipcMain.handle(COMMAND.threadAsk, async (_event, threadId: string): Promise<void> => {
    const thread = getThread(db, threadId);
    if (!thread) throw new Error(`No such thread: ${threadId}`);

    const document = getDocument(db, thread.documentId);
    const documentPath =
      document?.ref.kind === "file" ? document.ref.value : (document?.ref.value ?? "");
    const root =
      document?.ref.kind === "file" ? repositoryRoot(documentPath) : dirname(documentPath);

    // Spec 05 §5.5 — every target's document, so the prompt can group them.
    const documentPaths = new Map<string, string>();
    for (const record of documentsOf(db, thread)) {
      documentPaths.set(record.id, record.ref.value);
    }

    const prompt =
      thread.kind === "synthesis"
        ? synthesisPrompt({
            note: thread.note,
            referenced: thread.refThreadIds
              .map((id) => getThread(db, id))
              .filter((t): t is Thread => t !== null)
              .map((t) => ({ thread: t, messages: listMessages(db, t.id) })),
          })
        : askPrompt({ thread, documentPaths, repositoryRoot: root });

    recordUserText(threadId, thread.note);
    await runTurn(thread, prompt, sessionIdFor(threadId), false);
  });

  ipcMain.handle(
    COMMAND.threadReply,
    async (_event, request: ThreadReplyRequest): Promise<void> => {
      const thread = getThread(db, request.threadId);
      if (!thread) throw new Error(`No such thread: ${request.threadId}`);

      const cwd = workingDirectory(thread);
      const existing = thread.sessionId ?? sessionIdFor(thread.id);
      recordUserText(thread.id, request.text);

      // SPEC.md §8.5 — the SDK's transcript cache can be cleaned at any time.
      // REX keeps the thread; only the SDK's own record was lost.
      if (await sessionExists(cwd, existing)) {
        await runTurn(thread, request.text, existing, true);
        return;
      }

      const transcript = renderTranscript(
        listMessages(db, thread.id).filter((m) => m.content !== request.text),
      );
      await runTurn(thread, replayPrompt(transcript, request.text), uuidv4(), false);
    },
  );

  ipcMain.handle(COMMAND.threadResolve, (_event, request: ThreadResolveRequest): Thread => {
    setThreadStatus(db, request.threadId, request.resolved);
    const thread = getThread(db, request.threadId);
    if (!thread) throw new Error(`No such thread: ${request.threadId}`);
    return thread;
  });

  ipcMain.handle(
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

  ipcMain.handle(COMMAND.anchorRestate, (_event, request: AnchorRestateRequest): void => {
    setTargetState(db, request.threadId, request.position, request.anchorState);
  });

  // ── Apply ─────────────────────────────────────────────────────

  const applyContext: ApplyContext = {
    db,
    record,
    reanchor,
    onApplyReady: (event) => send(EVENT.applyReady, event),
  };

  ipcMain.handle(COMMAND.threadApply, (_event, threadId: string) =>
    startApply(applyContext, threadId),
  );

  ipcMain.handle(COMMAND.applyConfirm, (_event, request: ApplyConfirmRequest) =>
    confirmApply(applyContext, request.applyRunId, request.accept),
  );
}

function pickerOptions(): Electron.OpenDialogOptions {
  return {
    title: "Open a document",
    properties: ["openFile"],
    filters: [
      {
        name: "Documents",
        extensions: ["md", "markdown", "mdown", "mkd", "html", "htm", "pdf", "docx"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  };
}
