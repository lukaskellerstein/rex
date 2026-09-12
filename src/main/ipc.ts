// SPEC.md §10 — channel registration, and the thread service behind it.
//
// Invariant I3: every command is `ipcRenderer.invoke`, every piece of agent
// output is `webContents.send`. Nothing here listens on anything.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { app, type BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { v4 as uuidv4 } from "uuid";
import type {
  AgentGateway,
  AgentSdk,
  DescribeResult,
  ResolvedRoute,
  VerifyResult,
} from "../shared/agent-protocol.ts";
import { CATALOGUE } from "../shared/agent-protocol.ts";
import {
  type AgentGatewayDraft,
  type AnchorRestateRequest,
  type ApplyConfirmRequest,
  type BuiltinState,
  COMMAND,
  EVENT,
  type GatewayDiscovery,
  type GatewayListResponse,
  type GatewayModelsRequest,
  type GatewayProviderDraft,
  type GatewayProviderView,
  type GatewaySecret,
  type GatewayStorageHealth,
  type GatewayTarget,
  type GatewayTestRequest,
  type GatewayTestResult,
  type GatewayTrafficResult,
  type GatewayTrafficSize,
  type GatewayVerifyRequest,
  type GatewayView,
  type GroupCreateRequest,
  type GroupDeleteRequest,
  type GroupListRequest,
  type GroupUpdateRequest,
  type InitialTarget,
  type OpenCodeStatus,
  type ProviderDescriptor,
  type RenderResultRequest,
  type ThreadApplyRequest,
  type ThreadAskRequest,
  type ThreadCreateRequest,
  type ThreadDraftSaveRequest,
  type ThreadListRequest,
  type ThreadRenameRequest,
  type ThreadReplyRequest,
  type ThreadResolveRequest,
  type ThreadSynthesiseRequest,
  type TraceChat,
  type TraceMessageResult,
  type TraceTurnsResult,
  type WorkActResponse,
  type WorkApproveResponse,
  type WorkspaceCreateRequest,
  type WorkspaceCreateResult,
  type WorkspaceDeleteRequest,
  type WorkspaceExcludeRequest,
  type WorkspaceFileResult,
  type WorkspaceMoveRequest,
  type WorkspaceRenameRequest,
  type WorkspaceSearchRequest,
} from "../shared/channels.ts";
import { buildRoutes, validateGateway } from "../shared/gateways.ts";
import type {
  AgentChoices,
  Anchor,
  AnchorSummary,
  CommentGroup,
  CommentMove,
  DocumentRef,
  DocumentVersion,
  LinkResolution,
  Message,
  OpenedDocument,
  PaperView,
  ReferenceGraph,
  SendChoices,
  SendEvidence,
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
import { DEFAULT_MODEL } from "../shared/types.ts";
import {
  forgetProbe,
  listCapabilities,
  nextRunId,
  ORIGINAL_GATEWAY,
  REX_SDK,
  resolveRoute,
  runAgent,
  sessionExists,
  verifyRoute,
} from "./agent/bridge.ts";
import {
  applyOpenCode,
  OPENCODE_EXECUTABLE_KEY,
  openCodeVersion,
  problemWith,
  resolveOpenCode,
} from "./agent/opencode.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import {
  askPrompt,
  documentHeader,
  followUpPrompt,
  type PassagePlace,
  synthesisPrompt,
  withEvents,
} from "./agent/prompts.ts";
import { beginRun, endRun, HELD_REASON, isHeld, stopRun } from "./agent/runs.ts";
import { restartAgentService } from "./agent/service.ts";
import { eventsSinceLastAnswer, renderTranscript, replayPrompt } from "./agent/transcript.ts";
import { type ApplyContext, confirmApply, locatePassage, startApply, viewOf } from "./apply.ts";
import type { CdpStatus } from "./cdp.ts";
import type { Db } from "./db/database.ts";
import {
  BUILTIN_GATEWAY_ID,
  deleteGateway,
  gatewayKeyCipher,
  getGateway,
  getThreadSession,
  hasGatewayKey,
  isEnabled,
  listGateways,
  ORIGINAL_GATEWAY_ID,
  saveGateway,
  setThreadSession as setCombinationSession,
  setEnabled,
} from "./db/gateways.ts";
import { createGroup, deleteGroup, listGroups, moveItem, updateGroup } from "./db/groups.ts";
import { RETIRED_GATEWAYS_KEY } from "./db/migrate.ts";
import {
  getProvider,
  keyCipherOf,
  listConfigured,
  listModels,
  listProviders,
  markListed,
  removeProvider,
  saveProvider,
  setModels,
  setProviderKey,
} from "./db/providers.ts";
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
  listChatTraces,
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
  setThreadStatus,
  setThreadStyle,
  toggleWorkspaceRule,
  upsertDocument,
} from "./db/queries.ts";
import {
  AGENT_GATEWAY_KEY,
  AGENT_MODEL_KEY,
  AGENT_SDK_KEY,
  agentDefaults,
  defaultModel,
  getSetting,
  MODEL_DEFAULT_KEY,
  paperView,
  setPaperView,
  setSetting,
} from "./db/settings.ts";
import { appReport, debugReport } from "./debug.ts";
import { type TrafficAvailability, trafficAvailability } from "./gateway/availability.ts";
import { providerCatalogue } from "./gateway/catalogue.ts";
import { discoverProvider } from "./gateway/discover.ts";
import { remoteModels } from "./gateway/external.ts";
import {
  CAPTURE_BODIES_KEY,
  captureBodies,
  gatewayEnvironment,
  OUTPUT_RESERVE,
  rebuildConfig,
  restartBuiltin,
  startBuiltin,
  stopBuiltin,
} from "./gateway/lifecycle.ts";
import { localGateway } from "./gateway/local.ts";
import { seal, storageHealth, unseal } from "./gateway/secrets.ts";
import {
  clearTraffic,
  exchangeBodies,
  threadTraffic,
  trafficByThread,
  trafficSize,
} from "./gateway/traffic.ts";
import { porcelainStatus, repositoryRoot } from "./git.ts";
import { checkedExternalUrl, resolveForClick } from "./links.ts";
// Aliased: `registerIpc` has its own `record`, which appends a message row.
import { entries, lineCount, logFile, record as logLine } from "./log.ts";
import { allowDirectory, baseHrefFor } from "./protocol.ts";
import { isPptxPath, isTextDocumentPath } from "./render/formats.ts";
import { sha256 } from "./render/html.ts";
import { renderDocument } from "./render/index.ts";
import { ensureSidecar } from "./render/pptx.ts";
import { searchWorkspace } from "./search/index.ts";
import { agentCwd, documentsOf, SCRATCH_DIR, withDetail } from "./threads.ts";
import { chatTrafficReport, turnTrafficReport } from "./trafficReport.ts";
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
import {
  createEntry,
  deleteEntry,
  moveEntry,
  noteWorkspaceRoot,
  renameEntry,
} from "./workspace/files.ts";
import { buildReferenceGraph } from "./workspace/graph.ts";
import { scanWorkspace } from "./workspace/tree.ts";

/**
 * SPEC.md §8.8 point 2 — "Ask all" fans out, and the reference implementation
 * caps nothing. Five at a time.
 */
const MAX_CONCURRENT_AGENTS = 5;

/**
 * Spec 43 §4.5 — how long a Test may take before REX says it did not answer.
 *
 * A minute is generous for what this asks: one word, no tools, no plugins and
 * no system prompt. Measured 2026-09-04 against a 4B model on a local gateway,
 * the whole round trip is about 9 seconds. The number is here to bound a hang,
 * not to judge a slow model — §7's five-to-fifteen minutes is about a real
 * agent turn, and a real turn is stopped by the reviewer, not by a clock.
 */
const GATEWAY_TEST_TIMEOUT_MS = 60_000;

/**
 * The same bound for Verify, and it needs one for a different reason.
 *
 * Verify is two HTTP `GET`s with their own ten-second timeouts, so the network
 * cannot hang it — but it asks over the pipe, and `service.ask` waits forever by
 * design. A child that never answers would leave this dialog spinning with
 * nothing to end it, exactly as the Test did.
 */
const GATEWAY_VERIFY_TIMEOUT_MS = 30_000;

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

// ── Spec 43 — what one send picks, and what it leaves behind ────

/** §5.4 — a NOTE runs nothing, so it ran under nothing. Null in all four. */
const NO_CHOICES: SendChoices = { sdk: null, gatewayId: null, model: null, style: null };

/** The same, for a notice that is REX's own and had no run behind it. */
const NO_EVIDENCE: SendEvidence = { sdk: null, gatewayName: null, baseUrl: null };

/**
 * §5.3 — the five fields every row a run produces carries.
 *
 * One function because they are one fact in five columns, and because a site
 * that spread `...choices` and forgot `...evidence` would write half a record
 * that reads as a complete one. `gatewayId` is deliberately NOT among them: the
 * message keeps copies, and a reference is what would let an edit rewrite
 * history.
 */
function stamp(
  choices: SendChoices,
  evidence: SendEvidence,
  /**
   * Spec 51 §4 — and which TURN, when there is one. A NOTE runs nothing, so it
   * is no turn and passes nothing; a notice REX wrote on its own is the same.
   */
  runId: string | null = null,
): Partial<MessageDraft> {
  return {
    model: choices.model,
    style: choices.style,
    sdk: evidence.sdk,
    gatewayName: evidence.gatewayName,
    baseUrl: evidence.baseUrl,
    runId,
  };
}

/**
 * §11 — a send's gateway id, resolved into a route and the evidence it leaves.
 *
 * **Main re-reads the row and resolves the credential itself.** What the
 * renderer sent is an id, never a URL and never a variable's value: IPC data is
 * never used as executable SDK configuration without a database lookup and
 * validation (§11), and `process.env` is read here, in the one process that
 * holds it (§6.1).
 *
 * A missing gateway falls back to `Original` rather than refusing. §4.0's rule
 * for a setting that names a deleted gateway, applied to a send that was in
 * flight while the sheet deleted one — refusing would lose the reviewer's
 * message to fix a row they can re-pick in one click.
 */
/** The four fields of a send, taken off whatever request carried them. */
function choicesOf(request: SendChoices): SendChoices {
  return {
    sdk: request.sdk ?? REX_SDK,
    gatewayId: request.gatewayId ?? ORIGINAL_GATEWAY_ID,
    model: request.model,
    style: request.style,
  };
}

function routeFor(db: Db, choices: SendChoices): { route: ResolvedRoute; evidence: SendEvidence } {
  const sdk = choices.sdk ?? REX_SDK;
  const gateway = getGateway(db, choices.gatewayId ?? ORIGINAL_GATEWAY_ID) ?? ORIGINAL_GATEWAY;
  // Spec 46 §7 — decrypted here, at the moment the run needs it, and never
  // held. `unseal` answers null for a `rex.db` copied from another machine,
  // and `resolveRoute` then refuses by name rather than sending an empty key.
  const route = resolveRoute(gateway, sdk, process.env, unseal(gatewayKeyCipher(db, gateway.id)));
  return {
    route,
    evidence: { sdk, gatewayName: gateway.name, baseUrl: route.baseUrl },
  };
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

/**
 * Spec 51 §6 defect 1 — tell the renderer the built-in gateway has settled.
 *
 * A module-level binding rather than a return value because the caller that
 * needs it (`index.ts`, starting the gateway at boot) runs beside `registerIpc`
 * rather than inside it, and the window it sends to does not exist yet when
 * either is called. It is a no-op until `registerIpc` has run, which is the
 * honest behaviour: with no window there is nobody to tell.
 */
export let announceGatewaySettled: () => void = () => {};

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
    choices: SendChoices = NO_CHOICES,
    /** Spec 43 §5.3 — and which agent, gateway and URL produced it. */
    evidence: SendEvidence = NO_EVIDENCE,
    /** Spec 51 §4 — and which turn, when the notice belongs to one. */
    runId: string | null = null,
  ): void => {
    record(threadId, {
      ...stamp(choices, evidence, runId),
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
   * Spec 50 §3.2 — the folders the ASK prompt tells the agent to read.
   *
   * `askPrompt` writes `Read it at: <working copy>` (spec 34 §7), and a copy
   * lives under `~/.rex/work/<documentId>/` — outside `cwd`. The prompt has
   * named it since spec 34; this is the same fact said in a form an adapter can
   * act on, rather than only in prose the model has to obey.
   *
   * Directories, not files, because that is what `readable` means and because a
   * copy's directory holds only that copy.
   */
  const readableRoots = (thread: Thread): string[] => {
    const roots = new Set<string>();
    for (const record of documentsOf(db, thread)) {
      const meta = copyFor(record.id, record.ref);
      if (meta) roots.add(dirname(currentPath(meta)));
    }
    return [...roots];
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
    evidence: SendEvidence,
    runId: string,
  ): void => {
    const after = porcelainStatus(cwd);
    const introduced = after.filter((line) => !before.includes(line));
    if (introduced.length === 0) return;
    systemNote(
      threadId,
      `The read agent changed the repository, which the deny gate should have made impossible (SPEC.md §8.4). Changed: ${introduced.join(", ")}`,
      true,
      choices,
      evidence,
      runId,
    );
  };

  /**
   * Spec 43 §5.2 — which session this send continues, and whether it has one.
   *
   * **The conversation is REX's, and it lives in SQLite.** An SDK session is a
   * cache one harness keeps of part of it, so a thread keeps one per (thread,
   * SDK, gateway) and losing any of them costs a replay rather than the thread.
   *
   * The three cases, in the spec's own order:
   *
   *   1. a row exists, its URL still matches, and the adapter still has the
   *      session — resume. The ordinary reply, and it costs nothing extra.
   *   2. a row exists but cannot be used — a fresh session, seeded with the
   *      conversation. Two ways in: **2a** the adapter's cache was cleaned, and
   *      **2b** the gateway was edited and the URL moved, where resuming would
   *      ask a *different server* to continue state it has never seen.
   *   3. no row — a fresh session with this comment's deterministic id.
   *
   * Cases 2 and 3 are the same code path, and it is the one REX already had for
   * a cleaned CLI transcript: "this harness has never seen this conversation"
   * is the same problem with the same answer.
   */
  const planSession = async (
    thread: Thread,
    choices: SendChoices,
    route: ResolvedRoute,
    cwd: string,
  ): Promise<{ sessionId: string; resume: boolean }> => {
    const gatewayId = choices.gatewayId ?? ORIGINAL_GATEWAY_ID;
    const stored = getThreadSession(db, thread.id, route.sdk, gatewayId);
    if (!stored) {
      // Case 3. The deterministic id belongs to a comment's FIRST session, so
      // the debug report can predict it before anything has run
      // (`sessionLines` prints "this is the id the first ask would take").
      //
      // **It is only right once, and REX's own rows cannot tell it when.** A
      // session id is per (thread, SDK, gateway) now, so a second combination
      // needs its own — and the SDK's transcript files outlive REX's rows, so
      // deleting a gateway cascades its sessions away and leaves the files
      // behind. Both were measured on 2026-09-04, and both end the same way:
      // `Error: Session ID … is already in use`, the CLI exits 1, and the whole
      // send is lost before anything reaches a model.
      //
      // So the SDK is asked rather than inferred from. One round trip, on the
      // first send of a combination only, and it is a file lookup rather than a
      // model call.
      const first = sessionIdFor(thread.id);
      const taken = await sessionExists(cwd, first, route);
      return { sessionId: taken ? uuidv4() : first, resume: false };
    }
    // Case 2b. This is why the URL is on the row and not merely on the gateway.
    if ((stored.baseUrl ?? null) !== (route.baseUrl ?? null)) {
      return { sessionId: uuidv4(), resume: false };
    }
    // Case 1, or case 2a when the adapter has lost it.
    if (await sessionExists(cwd, stored.sessionId, route)) {
      return { sessionId: stored.sessionId, resume: true };
    }
    return { sessionId: uuidv4(), resume: false };
  };

  const runTurn = async (
    thread: Thread,
    prompt: string,
    sessionId: string,
    resume: boolean,
    /**
     * Spec 25 §4.1, spec 31 §4 and spec 43 §2.1 — the agent, the gateway, the
     * model and the style this ASK runs under, as the reviewer picked them.
     *
     * Arguments, and never a column on the thread: all four are properties of a
     * SEND, so a field read here would be mutable state no send owns and two
     * runs on one comment would take each other's. The `thread.style` column
     * exists (spec 31 §2.1) but it is memory for the composer, written by the
     * send and never read by it.
     */
    choices: SendChoices,
    /**
     * Spec 51 §4 — this turn's id, minted by the caller because the reviewer's
     * own message is written before this function is reached and belongs to the
     * same turn. It becomes `x-rex-run` on every request the run makes, which is
     * what lets depth 3 join these rows to the traffic log.
     */
    runId: string,
  ): Promise<void> => {
    // §11 — resolved here, from the database and this process's environment,
    // and never from what the renderer sent. A route that cannot be resolved
    // throws before anything is spawned, with the variable's name in it (§9).
    const { route, evidence } = routeFor(db, choices);
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
          // Spec 50 §3.2 — where the prompt just told it to read.
          readable: readableRoots(thread),
          profile: "read",
          prompt,
          sessionId,
          resume,
          // Spec 45 §6 — the gateway groups a month of inference by this.
          threadId: thread.id,
          // Spec 51 §4 — the same string the rows below are stamped with, so
          // `x-rex-run` on the wire and `message.run_id` in SQLite are one id.
          runId,
          route,
          model: choices.model,
          style: choices.style,
          documentPath,
          signal: controller.signal,
          // Spec 25 §5, spec 31 §5 and spec 43 §5.3 — every block this run
          // produces says which agent, gateway, URL, model and style made it.
          // Stamped here, where all five are known, because `bridge.ts` emits
          // blocks and has no business knowing what the reviewer picked.
          onMessage: (draft) => record(thread.id, { ...draft, ...stamp(choices, evidence, runId) }),
        }),
      );
    } finally {
      endRun(thread.id, controller);
    }

    // §5.2 — the session belongs to this (thread, SDK, gateway) triple, and the
    // URL it was really created against goes on the row: case 2b compares them,
    // so a gateway whose host was edited starts fresh rather than asking a
    // different server to continue state it has never seen.
    //
    // **A run that failed records nothing.** It still WROTE a transcript — the
    // SDK's file exists the moment the CLI starts — so recording its id makes
    // `sessionExists` say yes forever, and every later reply resumes the state
    // that just failed. Measured 2026-09-04: one run got a 400 about a
    // malformed thinking block, and the next three replies resumed it and got
    // the identical 400, in 600 ms each, with no way out but deleting the row.
    //
    // Skipping the write costs at most one SDK cache: the conversation is REX's
    // and lives in SQLite, so the next send takes §5.2 case 2 or 3 and replays
    // it. A STOPPED run is not a failure and does record — the reviewer ended a
    // real session and will want to continue it.
    //
    // `thread.session_id` is retired (§12) and is no longer written. It stays in
    // the table because dropping a column rewrites it.
    if (result.error === null) {
      setCombinationSession(db, thread.id, route.sdk, choices.gatewayId ?? ORIGINAL_GATEWAY_ID, {
        sessionId: result.sessionId,
        baseUrl: route.baseUrl,
      });
    }
    backstop(thread.id, cwd, before, choices, evidence, runId);

    for (const denial of result.denials) {
      systemNote(
        thread.id,
        `Denied ${denial.toolName}${denial.subagentId ? ` (subagent ${denial.subagentId})` : ""}: ${denial.reason}`,
        false,
        choices,
        evidence,
        runId,
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
     * Spec 25 §5, spec 31 §5 and spec 43 §5.3 — what they picked, and what
     * answered. All null for a NOTE, which runs nothing and so runs under
     * nothing (§5.4).
     */
    choices: SendChoices,
    evidence: SendEvidence,
    /**
     * Spec 51 §4 — the turn this send OPENS. Null for a NOTE, which runs
     * nothing and so is no turn at all.
     */
    runId: string | null,
  ): Message =>
    record(threadId, {
      ...stamp(choices, evidence, runId),
      role: "user",
      kind: "text",
      mode,
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

  // Spec 23 §2 and spec 39 §4 — the reviewer's own file acts. Every guard is in
  // `workspace/files.ts`; these three lines are the door and nothing else.
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

  // Spec 39 §4 — the third act at the same door, behind the same checks.
  handle(
    COMMAND.workspaceCreate,
    (_event, request: WorkspaceCreateRequest): WorkspaceCreateResult => createEntry(db, request),
  );

  // Spec 40 §4 — the fourth. Every check the tree made is made again in main,
  // per invariant I2 and because the tree can be stale (§2).
  handle(
    COMMAND.workspaceMove,
    (_event, request: WorkspaceMoveRequest): WorkspaceFileResult => moveEntry(db, request),
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

  // ── Links (spec 53) ───────────────────────────────────────────

  handle(
    COMMAND.linkResolve,
    (_event, from: string, href: string): LinkResolution => resolveForClick(from, href),
  );

  handle(COMMAND.linkExternal, async (_event, url: string): Promise<void> => {
    // §4.6 — the check that decides. `resolveForClick` already answered this
    // once, but the renderer sits between the two calls and what it sends back
    // is a string that came out of a document.
    await shell.openExternal(checkedExternalUrl(url));
  });

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

  handle(COMMAND.threadAsk, async (_event, request: ThreadAskRequest): Promise<void> => {
    const { threadId } = request;
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

    const choices = choicesOf(request);
    const { route, evidence } = routeFor(db, choices);
    // Spec 51 §4 — the turn opens HERE, at the reviewer's own message, which is
    // why the id is minted before it is written rather than inside `runAgent`.
    const runId = nextRunId();
    // Spec 31 §4.1 — the chat remembers the style it was sent under.
    setThreadStyle(db, threadId, choices.style);
    recordUserText(threadId, thread.note, "ask", choices, evidence, runId);

    // §5.2 applies to EVERY send, an ASK included. Before this spec an ASK
    // always re-seeded `sessionIdFor(threadId)`; with more than one gateway
    // that id would be seeded twice and the CLI refuses an id it already has.
    const plan = await planSession(thread, choices, route, workingDirectory(thread));
    await runTurn(thread, prompt, plan.sessionId, plan.resume, choices, runId);
  });

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
    // Spec 43 §5.4 — a NOTE starts no SDK and creates no session, so it stores
    // null for every choice. NULL here is the honest record of a message that
    // no agent ever saw.
    // Spec 51 §4 — and no run id either, for the same reason: a NOTE is not a
    // turn, so it belongs to none.
    const message = recordUserText(
      request.threadId,
      request.text,
      "note",
      NO_CHOICES,
      NO_EVIDENCE,
      null,
    );
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
    const choices = choicesOf(request);
    const { route, evidence } = routeFor(db, choices);
    // Spec 51 §4 — one turn, opening at the reply the reviewer just typed.
    const runId = nextRunId();
    setThreadStyle(db, thread.id, choices.style);
    const message = recordUserText(thread.id, request.text, "ask", choices, evidence, runId);

    // Spec 24 §4.1 — the places first, then the prompt that names them. The
    // thread is re-read so the prompt sees the grown list; with nothing added
    // the prompt is the bare text, as it always was.
    const from = addPlaces(thread, message, request.targets);
    const grown = (request.targets?.length ?? 0) > 0 ? getThread(db, thread.id) : null;
    const prompt = grown
      ? followUpPrompt({ thread: grown, from, text: request.text, ...(await readContext(grown)) })
      : request.text;

    // SPEC.md §8.5 and spec 43 §5.2 — one session per (thread, SDK, gateway),
    // and three ways this send can find itself without one: the SDK's cache was
    // cleaned, the gateway's URL moved, or this combination has never run.
    const plan = await planSession(thread, choices, route, cwd);

    if (plan.resume) {
      // Case 1. Spec 34 §6.2 — a resumed session has its own memory and gets
      // only the reply, so what the reviewer did to the document since the
      // agent last spoke goes in front of it: once, and only when there is
      // something.
      const events = eventsSinceLastAnswer(listMessages(db, thread.id));
      await runTurn(thread, withEvents(events, prompt), plan.sessionId, true, choices, runId);
      return;
    }

    // Cases 2 and 3. **Seeding is a decision, not a default** (§5.2): the
    // reviewer was asked on 2026-09-03 whether a newly chosen gateway should be
    // given the conversation so far, and chose to give it. So a switch of
    // gateway never loses the thread — the second model reads what the first
    // one said and answers in the same discussion.
    const transcript = renderTranscript(
      listMessages(db, thread.id).filter((m) => m.content !== request.text),
    );
    // Spec 34 §7 — a replayed session is a fresh one, and is told where the
    // document is once, exactly as the opening ASK prompt says it.
    const header = documentHeader({
      thread: grown ?? thread,
      ...(await readContext(grown ?? thread)),
    });
    await runTurn(
      thread,
      replayPrompt(transcript, prompt, header),
      plan.sessionId,
      false,
      choices,
      runId,
    );
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
    const choices = choicesOf(request);
    // §11 — an ACT run must use the gateway the reviewer picked for it, and it
    // resolves the same way an ASK does. §5.5 is the difference: it reads the
    // three choices and does NOT persist its session.
    const { route, evidence } = routeFor(db, choices);
    // Spec 51 §4 — an Apply is one turn, opening at the reviewer's instruction.
    const runId = nextRunId();
    setThreadStyle(db, request.threadId, choices.style);
    const message = recordUserText(request.threadId, request.note, "act", choices, evidence, runId);
    // Spec 24 §4.2 — the places are rows before `startApply` reads the thread,
    // so their documents join the run with no new code in `apply.ts`. The
    // message id goes along so the passage list can mark them (§6.2).
    addPlaces(thread, message, request.targets);
    // Spec 34 §3.2 — nothing is swept afterwards. A run that changed nothing
    // leaves a copy that equals the file, which is not pending and is drawn
    // nowhere; the directory stays for the next agent that is pointed at it.
    return startApply(applyContext, request.threadId, request.note, request.root, {
      addedWith: message.id,
      route,
      evidence,
      runId,
      model: choices.model,
      style: choices.style,
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
  handle(
    COMMAND.modelList,
    async (_event, gatewayId: string | null, sdk: AgentSdk | null): Promise<AgentChoices> => {
      // Spec 44 §3 — the cascade starts one control further left now, so the
      // list is a function of BOTH the agent and the gateway. A null SDK is
      // every caller that predates the agent control.
      const chosen = sdk ?? REX_SDK;
      const gateway = getGateway(db, gatewayId ?? ORIGINAL_GATEWAY_ID) ?? ORIGINAL_GATEWAY;
      const probe = await listCapabilities(
        SCRATCH_DIR,
        gateway,
        chosen,
        unseal(gatewayKeyCipher(db, gateway.id)),
      );
      // Spec 43 §4.3 — a route's model list is typed by the person who
      // configured it, because a gateway's catalogue is its own business:
      // LiteLLM's aliases are one edit per engine in a YAML file REX has never
      // read, and a probe against the CLI cannot know a new one exists.
      //
      // **A failed probe never removes a configured model.** This reverses spec
      // 25 §3.1's first-party assumption, and only for a non-`Original` route.
      const configured = gateway.routes[chosen]?.models ?? [];
      const models =
        configured.length > 0
          ? configured.map((value) => ({
              value,
              displayName: value,
              description: `A model name ${gateway.name} was configured with.`,
            }))
          : probe.models;
      // Spec 43 §4.3 — a ROUTED gateway with no model list is a route that
      // cannot send, and the picker is where that has to be said. `Default`
      // means "REX says nothing" (spec 25 §5.1), and a gateway routes on the
      // model name, so saying nothing to one makes the SDK send its own
      // first-party default and the gateway answer 404. Measured 2026-09-05 on
      // a Codex route, where the reviewer paid a round trip to be told the
      // address was wrong when it was not.
      const needsModels =
        gateway.id !== ORIGINAL_GATEWAY_ID && gateway.routes[chosen] && models.length === 0;

      return {
        models,
        chosen:
          gateway.id === ORIGINAL_GATEWAY_ID
            ? defaultModel(db, models)
            : // §4.1 — a rebuild that drops the current value picks the route's
              // first model rather than clearing the control. An empty control
              // the reviewer has to notice is worse than a filled one they can
              // change.
              (models[0]?.value ?? DEFAULT_MODEL),
        // Spec 31 §2.2 — no `chosen` style. A style belongs to the chat, so
        // there is no app-wide value for the renderer to fall back to.
        styles: probe.styles,
        error: needsModels
          ? `${gateway.name} has no models listed for this agent, and a gateway routes on the model name. Open Manage gateways, edit ${gateway.name}, and type the models it answers to — otherwise this send asks for no model and the gateway refuses it.`
          : probe.error,
      };
    },
  );

  // `model:default` stood here — spec 25 §6's writer for the app-wide default.
  // Its one caller was the top bar's picker, removed on 2026-09-04, and the key
  // it wrote is still read (§6.2) and still written, by `gateway:default`
  // below. A command nothing can invoke is a door left open on the privileged
  // process, so it goes with the control it existed for.

  // ── Spec 43 — gateways ────────────────────────────────────────

  /**
   * §4.5 — the kinds and their fields, so the sheet can draw itself.
   *
   * The catalogue is inlined into the generated module (spec 42 §17.4), so this
   * needs no round trip and answers even while the child is starting. It is the
   * library's own strings, never a server's: a label a gateway could set would
   * be a remote server writing REX's interface.
   */
  handle(COMMAND.gatewayDescribe, (): DescribeResult => CATALOGUE);

  /**
   * Every gateway, its routes, its capabilities, and what a new comment starts on.
   *
   * §8 — the probes are per (SDK, gateway) and lazy, so this waits only on the
   * ones it has not asked yet, and a slow custom route cannot delay `Original`.
   * They are gathered in parallel for the same reason.
   */
  const gatewayList = async (): Promise<GatewayListResponse> => {
    const gateways = listGateways(db);
    // Spec 44 §3 — every SDK the descriptor lists, not the one constant. The
    // agent control's cascade needs a capability per (agent, gateway) before it
    // can grey a row, and asking lazily per draw would grey the right rows one
    // frame late. `listCapabilities` caches per key, so a second gateway list
    // waits on nothing.
    const built = CATALOGUE.sdks.map((entry) => entry.id);
    const views: GatewayView[] = await Promise.all(
      gateways.map(async (gateway) => ({
        gateway,
        // §8 rule 4 — a boolean, never the value. The renderer displays
        // untrusted document content, so it may learn THAT a key exists and
        // never what it is.
        hasKey: hasGatewayKey(db, gateway.id),
        capabilities: Object.fromEntries(
          await Promise.all(
            built.map(
              async (sdk) =>
                [
                  sdk,
                  await listCapabilities(
                    SCRATCH_DIR,
                    gateway,
                    sdk,
                    unseal(gatewayKeyCipher(db, gateway.id)),
                  ),
                ] as const,
            ),
          ),
        ),
      })),
    );
    const defaults = agentDefaults(
      db,
      gateways.map((gateway) => gateway.id),
    );
    return {
      gateways: views,
      defaults: {
        sdk: defaults.sdk,
        gatewayId: defaults.gatewayId,
        // §4.0 — `Original` starts on spec 25's own stored default, which is a
        // different key and a different lifetime. Any other gateway starts on
        // the one this spec added, and the cascade fills it from the route.
        model:
          defaults.gatewayId === ORIGINAL_GATEWAY_ID
            ? defaultModel(db, (await listCapabilities(SCRATCH_DIR)).models)
            : defaults.model,
        missingGateway: defaults.missingGateway,
      },
    };
  };

  handle(COMMAND.gatewayList, gatewayList);

  /**
   * §4.5 — validate and write one gateway and its routes.
   *
   * The route the sheet previewed is **rebuilt here from the kind and the
   * answers**, never trusted as sent: §11's rule is that IPC data is never used
   * as executable SDK configuration without a lookup and validation, and a URL
   * that arrived over the wire is exactly that. What the renderer may decide is
   * the auth, the credential's NAME and the model list.
   */
  handle(COMMAND.gatewaySave, async (_event, draft: AgentGatewayDraft) => {
    // Spec 46 §7 — sealed here, before anything is written, and the plaintext
    // is never held. The three cases are deliberately distinct: `undefined`
    // leaves the stored key alone (a rename must not blank a credential),
    // `null` removes it, and a string replaces it.
    const cipher =
      draft.key === undefined ? undefined : draft.key === null ? null : seal(draft.key);
    const { key: _key, ...rest } = draft;
    const saved = saveGateway(db, rest, cipher);
    // §8 — the capabilities of a gateway that was just edited are no longer the
    // ones REX has. Asked again on the next draw rather than kept.
    forgetProbe(saved.id);
    return gatewayList();
  });

  handle(COMMAND.gatewayDelete, async (_event, gatewayId: string) => {
    deleteGateway(db, gatewayId);
    forgetProbe(gatewayId);
    return gatewayList();
  });

  /**
   * §2.4 — what the server publishes, checked against what the route needs.
   *
   * It writes nothing and returns no URL. A server that publishes nothing
   * reports "none published", which is a result rather than a failure.
   */
  /**
   * §4.5 — the route a Verify or a Test is about, saved or not.
   *
   * A reviewer presses these BEFORE they trust a row, so neither may require it
   * to be saved first. When the sheet sends its own answers, main rebuilds the
   * route with `buildRoutes` — the same catalogue the preview used — so the URL
   * is still derived here and never taken from the wire, which is §11's rule.
   * The credential is resolved here too, from this process's environment, and
   * the variable's NAME is all that ever crossed.
   */
  const targetRoute = (request: GatewayTarget): ResolvedRoute => {
    if (request.gatewayId) {
      const gateway = getGateway(db, request.gatewayId);
      if (!gateway) throw new Error(`No such gateway: ${request.gatewayId}`);
      return resolveRoute(
        gateway,
        request.sdk,
        process.env,
        unseal(gatewayKeyCipher(db, gateway.id)),
      );
    }
    if (!request.kind) throw new Error("Name a gateway, or the kind and the answers to build one.");
    const problems = validateGateway(request.kind, request.values ?? {});
    if (problems.length > 0) throw new Error(problems[0]?.message ?? "That gateway is not valid.");
    const routes = buildRoutes(request.kind, request.values ?? {});
    const route = routes[request.sdk];
    if (!route) throw new Error(`Those answers give ${request.sdk} no route.`);
    return resolveRoute(
      { id: "draft", name: "This gateway", kind: request.kind, routes } as AgentGateway,
      request.sdk,
      process.env,
      // The sheet's own answer, for a gateway that has not been saved yet.
      // Verify and Test must work before Save, or a person cannot check a
      // gateway without committing to it (§4.5).
      request.values?.key ?? null,
    );
  };

  handle(COMMAND.gatewayVerify, async (_event, request: GatewayVerifyRequest) => {
    const route = targetRoute(request);
    const timeout = new Promise<VerifyResult>((settle) =>
      setTimeout(
        () =>
          settle({
            ok: false,
            baseUrl: route.baseUrl ?? "",
            expected: null,
            document: null,
            published: [],
            status: null,
            note: `The agent library did not answer within ${GATEWAY_VERIFY_TIMEOUT_MS / 1000} seconds.`,
          }),
        GATEWAY_VERIFY_TIMEOUT_MS,
      ),
    );
    return Promise.race([verifyRoute(route), timeout]);
  });

  /**
   * §4.5 — an explicit, read-only one-turn test of one route.
   *
   * The `read` profile, so it cannot write whatever it is pointed at, and one
   * short prompt. The renderer warns that a remote model may charge; by the time
   * it reaches here the reviewer has decided.
   *
   * **The word it asks for is the whole check.** A gateway that refuses the
   * request does not always fail the run: the Claude CLI catches an HTTP error
   * and reports it as the assistant's own words, with `error` null and a
   * `completed` beside it — measured 2026-09-04, where a 400 about the
   * `thinking` field arrived as a perfectly successful turn saying
   * `API Error: 400 …`. Testing `error === null` alone therefore paints a broken
   * gateway green, which is worse than not testing at all.
   *
   * So the answer has to contain the word. It is a one-word instruction to a
   * model that has nothing else to do, and any model too weak to follow it is a
   * model too weak to run an agent.
   */
  handle(
    COMMAND.gatewayTest,
    async (_event, request: GatewayTestRequest): Promise<GatewayTestResult> => {
      const route = targetRoute(request);
      // §6.4 — a gateway has never heard of `claude-opus-5`. With no model named,
      // the CLI sends its own default and the gateway answers about a model
      // nobody chose: measured 2026-09-04, "There's an issue with the selected
      // model (claude-opus-5[1m])", which sends the reader after the wrong
      // thing. REX knows it has nothing to send, so it says that instead of
      // spending a turn to find out.
      if (route.baseUrl && !request.model) {
        return {
          ok: false,
          detail:
            "Type at least one model above. A gateway routes on the model name, and with none " +
            "given the SDK asks for its own default — which this gateway has never heard of.",
          durationMs: 0,
        };
      }

      const said: string[] = [];
      const startedAt = Date.now();

      // §4.5 — a Test must be able to END. `runAgent` deliberately has no
      // timeout, because a real turn's deadline is the reviewer's Stop (§7.2) —
      // and this dialog has no Stop. Measured 2026-09-04: a Test left running
      // past five minutes with nothing on screen but the word "Testing…".
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), GATEWAY_TEST_TIMEOUT_MS);

      let result: Awaited<ReturnType<typeof runAgent>>;
      try {
        result = await runAgent({
          cwd: SCRATCH_DIR,
          profile: "read",
          prompt: "Reply with exactly the word: ready. Say nothing else and use no tools.",
          // A fresh id every time. This is not a conversation and nothing resumes
          // it, so seeding a deterministic one would collide on the second press.
          sessionId: uuidv4(),
          resume: false,
          route,
          model: request.model,
          style: null,
          // **A probe, not a review.** REX's own instructions and its plugins are
          // what a comment needs; here they are pure cost, and on a small local
          // model they are most of the wall clock — the same measurement that
          // produced the deadline above. Empty on both counts, so what is being
          // timed is the route.
          systemPrompt: "",
          plugins: [],
          signal: controller.signal,
          onMessage: (draft) => {
            if (draft.kind === "text" && draft.content) said.push(draft.content);
          },
        });
      } finally {
        clearTimeout(deadline);
      }

      if (controller.signal.aborted) {
        return {
          ok: false,
          detail:
            `No answer in ${GATEWAY_TEST_TIMEOUT_MS / 1000} seconds. The address is reachable or ` +
            "Verify would have said otherwise, so the model is the slow part: a local one that " +
            "has to load can take minutes on its first call. Load it and try again, or pick a " +
            "smaller one.",
          durationMs: Date.now() - startedAt,
        };
      }

      const answer = said.join(" ").trim();
      const ready = /\bready\b/i.test(answer);
      return {
        ok: result.error === null && ready,
        detail:
          result.error ??
          (ready
            ? answer
            : answer === ""
              ? "The gateway answered, and the model said nothing at all."
              : // The answer IS the diagnosis here — an API error the CLI turned
                // into prose, or a model that would not follow one instruction.
                answer),
        durationMs: Date.now() - startedAt,
      };
    },
  );

  /**
   * §4.0 — what a NEW comment starts on.
   *
   * Its own command, and deliberately not a side effect of changing a control:
   * a one-off escalation to `Original` must not silently become the default for
   * every future comment.
   */
  handle(
    COMMAND.gatewayDefault,
    (_event, choice: { sdk: AgentSdk; gatewayId: string; model: string | null }): void => {
      setSetting(db, AGENT_SDK_KEY, choice.sdk);
      setSetting(db, AGENT_GATEWAY_KEY, choice.gatewayId);
      if (choice.model !== null) setSetting(db, AGENT_MODEL_KEY, choice.model);
      // `Original` keeps spec 25's own key too, so the model picker's fallback
      // and this one cannot disagree about what "the default" is there.
      if (choice.gatewayId === ORIGINAL_GATEWAY_ID && choice.model !== null) {
        setSetting(db, MODEL_DEFAULT_KEY, choice.model);
      }
    },
  );

  /**
   * §4.5 — whether a named variable is set. **True or false, never the value.**
   *
   * The one question the renderer may ask about the environment, and this is
   * the whole answer to it: a boolean. §2.6 rule 4 is why there is no second
   * command that returns anything more.
   */
  handle(COMMAND.gatewayHasEnv, (_event, name: string): boolean => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });

  // ── Spec 47 §2.1 — the `opencode` program ─────────────────────
  //
  // A path, not a credential, so unlike every key in this file it does come
  // back to the screen: a reviewer who typed one has to be able to read what
  // REX resolved, and "auto-detect found nothing" and "your path is wrong" are
  // different sentences with different fixes.

  const openCodeStatus = (): OpenCodeStatus => {
    const override = getSetting(db, OPENCODE_EXECUTABLE_KEY) ?? "";
    const found = resolveOpenCode(override);
    const version = found.path ? openCodeVersion(found.path) : null;
    return {
      override,
      path: found.path,
      source: found.source,
      version,
      problem: problemWith(found, override, version),
    };
  };

  handle(COMMAND.openCodeStatus, (): OpenCodeStatus => openCodeStatus());

  handle(COMMAND.openCodeExecutable, (_event, override: string): OpenCodeStatus => {
    setSetting(db, OPENCODE_EXECUTABLE_KEY, (override ?? "").trim());
    // **The library's child already read the old value.** It inherits the
    // variable at spawn, so changing this setting has to reach it, and the only
    // way it can is a restart. Cheap — the child holds no run state between
    // turns — and the alternative is a reviewer fixing a path and being told the
    // old one is still wrong.
    applyOpenCode(() => getSetting(db, OPENCODE_EXECUTABLE_KEY));
    void restartAgentService();
    return openCodeStatus();
  });

  // ── Spec 46 §12 — the built-in gateway ────────────────────────
  //
  // **No handler below returns a secret**, and one takes one. That asymmetry is
  // the rule, not an oversight: the renderer displays untrusted document
  // content (invariant I2), so it must never be able to ask for a key, not even
  // one it just supplied.

  /** The decryptor every gateway call shares. Main-only, by construction. */
  const decrypt = (providerId: string): string | null => unseal(keyCipherOf(db, providerId));

  const builtinState = (): BuiltinState => {
    const live = localGateway().state();
    return {
      enabled: isEnabled(db, BUILTIN_GATEWAY_ID),
      running: live.running,
      // The port it GOT (§4.2). The debug report prints this for the same
      // reason it prints the CDP port it found rather than the one it wanted.
      port: live.port,
      startedAt: live.startedAt,
      down: live.down,
      models: listConfigured(db).length,
      providers: listProviders(db).length,
      // §15 — read here rather than pushed, because the screen is the only
      // thing that can show it and this is the call the screen makes.
      retired: (getSetting(db, RETIRED_GATEWAYS_KEY) ?? "").split("\n").filter(Boolean),
    };
  };

  const providerViews = (): GatewayProviderView[] =>
    listProviders(db).map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      baseUrl: row.baseUrl,
      hasKey: row.hasKey,
      listedAt: row.listedAt,
      models: listModels(db, row.id).map((model) => ({
        model: model.model,
        alias: model.alias,
        maxInput: model.maxInput,
        maxOutput: model.maxOutput,
        tools: model.tools,
      })),
    }));

  handle(COMMAND.gatewayBuiltinState, (): BuiltinState => builtinState());

  /**
   * Spec 51 §6 defect 1 — say when the gateway has settled, without being asked.
   *
   * Registered on the module so `index.ts` can hand it to
   * `startBuiltinIfEnabled`, which runs at boot and finishes about 1.6 seconds
   * later — after the window exists and after Settings may already be drawing
   * "Starting…". The state is read fresh rather than passed in, so what the
   * screen receives is the same object `gateway:builtin:state` would answer.
   */
  announceGatewaySettled = (): void => send(EVENT.gatewaySettled, builtinState());

  /**
   * §15 — the note is shown ONCE.
   *
   * Cleared by the screen after it has drawn it, rather than by the migration
   * that wrote it: the migration cannot know whether anybody was looking, and a
   * sentence about two deleted gateways that nobody ever sees is the same as no
   * sentence at all.
   */
  handle(COMMAND.gatewayRetiredSeen, (): BuiltinState => {
    setSetting(db, RETIRED_GATEWAYS_KEY, "");
    return builtinState();
  });

  /**
   * §4.1 — the switch. **Turning it off deletes nothing.**
   *
   * `setEnabled` writes one column; the child is started or stopped around it.
   * The reviewer's instruction is the whole reason this is two operations and
   * not one: "it's already the second time that he is enabling it and he
   * already has some configuration — we should not force him to fill it in
   * again."
   */
  handle(COMMAND.gatewayBuiltinEnable, async (_event, enabled: boolean): Promise<BuiltinState> => {
    setEnabled(db, BUILTIN_GATEWAY_ID, enabled);
    if (enabled) {
      try {
        await rebuildConfig(db);
        await startBuiltin(db, gatewayEnvironment(db, decrypt));
      } catch (error) {
        // The switch stays ON and the reason is reported. A switch that
        // silently flipped itself back would hide the fault that needs fixing.
        logLine("error", "local-gateway", error instanceof Error ? error.message : String(error));
      }
    } else {
      await stopBuiltin();
    }
    return builtinState();
  });

  /**
   * §5.2 — the six descriptors, so the screen can draw controls it did not write.
   *
   * Read from `local-gateway/catalogue.json`, which is generated from
   * `providers.py` and checked against it by that package's own tests. **Every
   * string in it comes from REX's own source**, never from a provider — which
   * is what stops a remote server writing the host's interface (§14 rule 6).
   */
  handle(COMMAND.gatewayProviderCatalogue, (): ProviderDescriptor[] => providerCatalogue());

  /**
   * §6 — what an external LiteLLM serves, asked of the gateway itself.
   *
   * REX configures no models for one: they are already configured, inside it.
   * The key is decrypted here and never leaves main.
   */
  handle(COMMAND.gatewayRemoteModels, async (_event, gatewayId: string) => {
    const gateway = getGateway(db, gatewayId);
    if (!gateway) return { models: [], error: "That gateway is gone.", needsKey: false };
    return remoteModels(
      gateway.routes["claude-agent"]?.baseUrl ?? null,
      unseal(gatewayKeyCipher(db, gatewayId)),
    );
  });

  handle(COMMAND.gatewayProviderList, (): GatewayProviderView[] => providerViews());

  handle(
    COMMAND.gatewayProviderSave,
    async (_event, draft: GatewayProviderDraft): Promise<GatewayProviderView[]> => {
      saveProvider(db, draft);
      // A provider with no ticked models changes no config, but re-rendering is
      // cheap and keeps `config.yaml` a pure function of the database.
      await restartIfRunning();
      return providerViews();
    },
  );

  handle(
    COMMAND.gatewayProviderRemove,
    async (_event, providerId: string): Promise<GatewayProviderView[]> => {
      // Its models cascade (§11). The key goes with the row, which is the only
      // deletion in this file that removes a credential — and it is the one a
      // person explicitly asked for.
      removeProvider(db, providerId);
      await restartIfRunning();
      return providerViews();
    },
  );

  /**
   * §5.3 — what one provider serves, now.
   *
   * The key is decrypted here and handed to the child in its environment, never
   * as an argument, and never back to the renderer. A failure comes back as
   * `error` rather than as a rejection: the Settings screen draws it, and
   * "could not reach LM Studio at …" is a sentence a person can act on.
   */
  handle(
    COMMAND.gatewayProviderDiscover,
    async (_event, providerId: string): Promise<GatewayDiscovery> => {
      const provider = getProvider(db, providerId);
      if (!provider) {
        return { provider: "", models: [], error: "That provider is no longer configured." };
      }
      const found = await discoverProvider(
        provider.provider,
        provider.baseUrl,
        provider.hasKey ? decrypt(providerId) : null,
      );
      if (!found.error) markListed(db, providerId);
      return found;
    },
  );

  /**
   * The ticked models. §4.3 — this rewrites `config.yaml` and restarts.
   *
   * The window is stored **less the output reserve** (§4.4 rule 3), applied
   * once here by `write-config`, so nothing downstream applies it a second time.
   */
  handle(
    COMMAND.gatewayModelsSave,
    async (_event, request: GatewayModelsRequest): Promise<GatewayProviderView[]> => {
      const provider = getProvider(db, request.providerId);
      if (!provider) throw new Error("That provider is no longer configured.");
      setModels(
        db,
        request.providerId,
        provider.provider,
        request.models.map((model) => ({
          model: model.model,
          maxInput: model.context,
          maxOutput: model.context === null ? null : OUTPUT_RESERVE,
          tools: model.tools,
        })),
      );
      await restartIfRunning();
      return providerViews();
    },
  );

  /**
   * §7 — a key in, and `true` back.
   *
   * `seal` refuses on a machine that cannot encrypt at all, so a plaintext key
   * can never reach the database by this route. The `basic_text` case does not
   * refuse — it is real if weak encryption, the person was warned by
   * `gateway:storage:health` before typing, and refusing would leave them
   * unable to use REX (§7.3).
   */
  handle(COMMAND.gatewaySecretSet, async (_event, secret: GatewaySecret): Promise<boolean> => {
    setProviderKey(db, secret.providerId, seal(secret.value));
    await restartIfRunning();
    return true;
  });

  handle(COMMAND.gatewaySecretClear, async (_event, providerId: string): Promise<boolean> => {
    setProviderKey(db, providerId, null);
    await restartIfRunning();
    return true;
  });

  handle(COMMAND.gatewayStorageHealth, (): GatewayStorageHealth => storageHealth());

  /**
   * §4.6 — this comment's requests and responses.
   *
   * **Only the built-in gateway has a traffic log.** REX writes its config, so
   * REX can install a callback; an existing LiteLLM belongs to somebody else
   * and REX will not ask it to load code. On any other gateway this answers
   * `available: false` with the reason, and the button says so rather than
   * disappearing — a control that vanishes looks like a bug (A16).
   */
  /**
   * Whether this comment can have a traffic log at all, and why not.
   *
   * Spec 55 moved the answer into `gateway/availability.ts`, where the report
   * can ask it too. It takes the rows rather than the thread id for the same
   * reason: the caller that already has them does not read them twice.
   */
  function availabilityOf(threadId: string): TrafficAvailability {
    return trafficAvailability(listMessages(db, threadId));
  }

  handle(COMMAND.gatewayTraffic, (_event, threadId: string): GatewayTrafficResult => {
    const bodies = captureBodies(db);
    const { available, reason } = availabilityOf(threadId);
    if (!available) return { available, reason, rows: [], bodies };
    return { available: true, reason: null, rows: threadTraffic(threadId), bodies };
  });

  /**
   * Spec 51 §5.1 — every chat REX has run, at depth 1.
   *
   * **The join, in one place.** `listChatTraces` is REX's own record — which
   * comment, on which document, with which agent, how many turns and what they
   * cost. `trafficByThread` is what the built-in gateway saw of them. Neither
   * side can draw this screen alone, and putting the merge here rather than in
   * the renderer is invariant I2: the renderer touches neither source.
   */
  handle(COMMAND.traceChats, (): TraceChat[] => {
    const seen = trafficByThread();
    return listChatTraces(db).map((chat) => {
      const totals = seen.get(chat.threadId);
      return {
        ...chat,
        exchanges: totals?.exchanges ?? 0,
        failed: totals?.failed ?? 0,
      };
    });
  });

  /**
   * Spec 51 §5.2 and §5.3 — one chat's exchanges, without their bodies.
   *
   * The renderer already holds this chat's `message` rows and groups them into
   * turns itself (`trace.ts`), so what it is missing is exactly this: what went
   * over the wire. Depth 3 filters the same list to one run rather than asking
   * again — one read serves both depths.
   *
   * Bodiless on purpose. A request body is the whole request since §3, so five
   * hundred rows would be megabytes to draw a list of counts.
   */
  handle(COMMAND.traceTurns, (_event, threadId: string): TraceTurnsResult => {
    const bodies = captureBodies(db);
    // The chat travels with its exchanges. Depth 1 crosses documents, and the
    // renderer holds a `ThreadWithMessages` only for the one that is open — so
    // a chat picked at depth 1 is one it has never loaded.
    const found = getThread(db, threadId);
    const thread = found ? withDetail(db, found) : null;
    // And its document, because depth 3 is the trace SHEET and the sheet covers
    // the document pane. A turn opened for a chat about another document has to
    // open that document first.
    const documentRef = found ? (getDocument(db, found.documentId)?.ref ?? null) : null;
    const { available, reason } = availabilityOf(threadId);
    if (!available) return { thread, documentRef, available, reason, rows: [], bodies };
    return {
      thread,
      documentRef,
      available: true,
      reason: null,
      rows: threadTraffic(threadId, false),
      bodies,
    };
  });

  /**
   * Spec 51 §5.4 — one exchange's request and response, whole.
   *
   * The only channel that ever carries a body, and it carries exactly one. It
   * also resolves an overflow file, which is the whole point of §3.1 rule 3: a
   * body over the limit used to be deleted, and depth 4 could not have drawn it.
   */
  handle(COMMAND.traceMessage, (_event, rowId: string): TraceMessageResult => {
    const found = exchangeBodies(rowId);
    if (!found) {
      return {
        problem:
          "REX could not find that request in the traffic log. The day it was written on may " +
          "have passed out of the 30-day window.",
      };
    }
    return { request: found.request, response: found.response, problem: found.problem };
  });

  /**
   * Spec 55 §3 — the Traffic head's debug button, at depths 2 and 3.
   *
   * Main builds the text and writes the clipboard for §6.2's reason: the
   * database path, the traffic log and the versions are main's, and a renderer
   * copy needs the window focused. The report comes BACK as well, so the button
   * can hang it in its own `title` — it carries the reviewer's own document, and
   * being able to read it first is the difference between copying and
   * disclosing.
   */
  handle(COMMAND.traceCopyChat, (_event, threadId: string): string => {
    const report = chatTrafficReport(db, threadId, app.getVersion());
    clipboard.writeText(report);
    return report;
  });

  /** The same, for one turn. `runId` is null for the rows from before spec 51. */
  handle(COMMAND.traceCopyTurn, (_event, threadId: string, runId: string | null): string => {
    const report = turnTrafficReport(db, threadId, runId, app.getVersion());
    clipboard.writeText(report);
    return report;
  });

  handle(COMMAND.gatewayTrafficSize, (): GatewayTrafficSize => trafficReport());

  handle(COMMAND.gatewayTrafficClear, (): GatewayTrafficSize => {
    clearTraffic();
    return trafficReport();
  });

  /**
   * §8 rule 5 — capture bodies, on or off.
   *
   * It restarts the gateway, because the switch reaches the callback through
   * the child's environment and LiteLLM has no hot reload without a database
   * (§4.3, §17).
   */
  handle(
    COMMAND.gatewayTrafficBodies,
    async (_event, capture: boolean): Promise<GatewayTrafficSize> => {
      setSetting(db, CAPTURE_BODIES_KEY, capture ? "1" : "0");
      await restartIfRunning();
      return trafficReport();
    },
  );

  function trafficReport(): GatewayTrafficSize {
    const size = trafficSize();
    return { bytes: size.bytes, days: size.days, bodies: captureBodies(db) };
  }

  /**
   * §4.3 — a change restarts the child, and the restart waits for in-flight runs.
   *
   * A no-op when the switch is off: the config is still rewritten, so turning
   * the gateway on later starts it against what the person configured while it
   * was stopped.
   */
  async function restartIfRunning(): Promise<void> {
    try {
      await restartBuiltin(db, decrypt, (openRuns) => {
        logLine(
          "info",
          "local-gateway",
          `waiting for ${openRuns} run(s) before restarting the gateway`,
        );
      });
    } catch (error) {
      logLine("error", "local-gateway", error instanceof Error ? error.message : String(error));
    }
  }

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
      db,
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
