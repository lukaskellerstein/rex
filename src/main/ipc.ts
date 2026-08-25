// SPEC.md §10 — channel registration, and the thread service behind it.
//
// Invariant I3: every command is `ipcRenderer.invoke`, every piece of agent
// output is `webContents.send`. Nothing here listens on anything.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { app, type BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  type AnchorRestateRequest,
  type ApplyConfirmRequest,
  COMMAND,
  EVENT,
  type InitialTarget,
  type RenderResultRequest,
  type ThreadCreateRequest,
  type ThreadListRequest,
  type ThreadReplyRequest,
  type ThreadApplyRequest,
  type ThreadResolveRequest,
  type ThreadSynthesiseRequest,
  type WorkspaceExcludeRequest,
} from "../shared/channels.ts";
import type {
  AnchorSummary,
  DocumentRef,
  Message,
  OpenedDocument,
  ReferenceGraph,
  Thread,
  ThreadWithMessages,
  ViewState,
  WorkspaceRef,
  WorkspaceTree,
} from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { askPrompt, synthesisPrompt } from "./agent/prompts.ts";
import { runAgent } from "./agent/runner.ts";
import { renderTranscript, replayPrompt, sessionExists } from "./agent/transcript.ts";
import { type ApplyContext, confirmApply, startApply } from "./apply.ts";
import type { CdpStatus } from "./cdp.ts";
import type { Db } from "./db/database.ts";
import {
  appendMessage,
  createThread,
  deleteThread,
  documentCostUsd,
  getDocument,
  getThread,
  listMessages,
  listThreads,
  type MessageDraft,
  setTargetState,
  setThreadSession,
  setThreadStatus,
  toggleWorkspaceRule,
  upsertDocument,
} from "./db/queries.ts";
import { appReport, debugReport } from "./debug.ts";
import { porcelainStatus, repositoryRoot } from "./git.ts";
// Aliased: `registerIpc` has its own `record`, which appends a message row.
import { entries, lineCount, logFile, record as logLine } from "./log.ts";
import { allowDirectory, baseHrefFor } from "./protocol.ts";
import { isPptxPath } from "./render/formats.ts";
import { renderDocument } from "./render/index.ts";
import { ensureSidecar } from "./render/pptx.ts";
import { agentCwd, documentsOf, SCRATCH_DIR, withDetail } from "./threads.ts";
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
    // Spec 11 §6.4.2 — a `.pptx` is a marker like any other, so the design
    // plugins load for a deck review and a Markdown review pays nothing.
    const document = getDocument(db, thread.documentId);
    const documentPath = document?.ref.value ?? null;

    const result = await agents.run(() =>
      runAgent({
        cwd,
        profile: "read",
        prompt,
        sessionId,
        resume,
        model: thread.model,
        documentPath,
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

  handle(COMMAND.docOpen, async (_event, ref: DocumentRef): Promise<OpenedDocument> => {
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
  handle(COMMAND.threadList, (_event, request: ThreadListRequest): ThreadWithMessages[] => {
    const document = request.documentId ? getDocument(db, request.documentId) : null;
    const root = request.root ?? (document ? dirname(document.ref.value) : null);
    return listThreads(db, { root, documentId: request.documentId }).map((thread) =>
      withDetail(db, thread),
    );
  });

  handle(COMMAND.threadCreate, (_event, request: ThreadCreateRequest): Thread => {
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

  handle(COMMAND.threadAsk, async (_event, threadId: string): Promise<void> => {
    const thread = getThread(db, threadId);
    if (!thread) throw new Error(`No such thread: ${threadId}`);

    const document = getDocument(db, thread.documentId);
    const documentPath = document?.ref.value ?? "";
    const root = document ? repositoryRoot(documentPath) : dirname(documentPath);

    // Spec 05 §5.5 — every target's document, so the prompt can group them.
    // Spec 11 §6.2 — a deck is named by its text sidecar instead of by the zip.
    const documentPaths = new Map<string, string>();
    for (const record of documentsOf(db, thread)) {
      documentPaths.set(record.id, await readablePath(record.ref));
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

  handle(COMMAND.threadReply, async (_event, request: ThreadReplyRequest): Promise<void> => {
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
  handle(COMMAND.threadApply, (_event, request: ThreadApplyRequest) => {
    recordUserText(request.threadId, request.note);
    return startApply(applyContext, request.threadId, request.note);
  });

  handle(COMMAND.applyConfirm, (_event, request: ApplyConfirmRequest) =>
    confirmApply(applyContext, request.applyRunId, request.accept),
  );

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
