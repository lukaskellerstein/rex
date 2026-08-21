// SPEC.md §10 — every IPC channel name and payload type.
//
// Invariant I3: commands are `ipcRenderer.invoke`, agent output is
// `webContents.send`. There is no HTTP server, no SSE and no listening port,
// so this file is the entire surface between the two processes.

import type {
  Anchor,
  AnchorState,
  AnchorSummary,
  ChangedRegion,
  DocumentRef,
  FactGraph,
  FactRunSummary,
  FactStage,
  Finding,
  FindingFilter,
  Message,
  OpenedDocument,
  ReferenceGraph,
  SkippedDocument,
  StrokeRef,
  Thread,
  ThreadWithMessages,
  WorkspaceRef,
  WorkspaceTree,
} from "./types.ts";

/**
 * What `rex <path>` named. Spec 02 §7 — a directory opens as a workspace, a
 * file as a single document, and the renderer cannot tell which without asking.
 */
export type InitialTarget =
  | { kind: "document"; ref: DocumentRef }
  | { kind: "workspace"; ref: WorkspaceRef };

/** Renderer → main, via `ipcRenderer.invoke`. */
export const COMMAND = {
  /**
   * Not in §10's table. §1 step 1 is "open a document" and nothing in the
   * contract lets the renderer ask for one, so this opens the file dialog in
   * main — where `dialog` lives — and returns what the user chose.
   */
  docPick: "doc:pick",
  /**
   * The document named on the command line (`rex <file>`), if any. Also not in
   * §10 — main parses argv and the renderer has no other way to learn of it.
   */
  docInitial: "doc:initial",
  docOpen: "doc:open",
  /** Spec 02 §7 — the workspace explorer and the reference graph. */
  workspacePick: "workspace:pick",
  workspaceTree: "workspace:tree",
  workspaceGraph: "workspace:graph",
  threadList: "thread:list",
  threadCreate: "thread:create",
  threadAsk: "thread:ask",
  threadReply: "thread:reply",
  threadResolve: "thread:resolve",
  threadSynthesise: "thread:synthesise",
  threadApply: "thread:apply",
  applyConfirm: "apply:confirm",
  anchorRestate: "anchor:restate",
  /** Spec 07 §9 — the fact graph. */
  factsStatus: "facts:status",
  factsBuild: "facts:build",
  factsCancel: "facts:cancel",
  factsFindings: "facts:findings",
  factsGraph: "facts:graph",
  factsVerdict: "facts:verdict",
  factsComment: "facts:comment",
  /**
   * §11 rule 4 — "every claim shows its evidence… a claim the user cannot check
   * is worse than no claim". Its own command rather than a field on `FactNode`,
   * because the lens draws thousands of nodes and would carry every quote in the
   * corpus to render a picture that shows none of them.
   */
  factsEvidence: "facts:evidence",
} as const;

/** Main → renderer, via `webContents.send`. */
export const EVENT = {
  streamStep: "stream:step",
  streamCost: "stream:cost",
  /**
   * Not in §10's table either. §8.7 step 5 requires the user to see a diff
   * before anything is written, and no channel in the contract carries one.
   */
  applyReady: "apply:ready",
  /**
   * Spec 07 §9 — build progress. Fires **at most once per second**: a build runs
   * for hours (§5.3) and one event per chunk would flood the renderer.
   */
  factsProgress: "facts:progress",
} as const;

// ── Request and response payloads ───────────────────────────────

/**
 * Spec 05 §5.3 — every comment in the workspace, not one document's.
 *
 * `root` is the workspace root, or null when a single file was opened by path;
 * main then uses that document's own directory. `documentId` is not a duplicate
 * of it: a tier 2 URL document sits under no directory at all, and without this
 * its comments would vanish the moment the list stopped being per-document.
 */
export interface ThreadListRequest {
  root: string | null;
  documentId: string | null;
}

/** Spec 05 §7 — `targets[0]` decides the thread's own document. Panel order. */
export interface ThreadCreateRequest {
  targets: Array<{ documentId: string; anchor: Anchor }>;
  note: string;
  /**
   * Spec 06 §5.4 — the reviewer's ink, when the places were circled.
   *
   * It rides inside this payload rather than in a channel of its own: §2 leaves
   * §10's IPC contract **unchanged**, because a drawing is not a second way to
   * make a comment. It is a fast way to fill the panel, and the panel already
   * has a way to send what it holds.
   */
  stroke?: StrokeRef;
}

export interface ThreadReplyRequest {
  threadId: string;
  text: string;
}

export interface ThreadResolveRequest {
  threadId: string;
  resolved: boolean;
}

export interface ThreadSynthesiseRequest {
  documentId: string;
  refThreadIds: string[];
  note: string;
}

export interface ApplyConfirmRequest {
  applyRunId: string;
  accept: boolean;
}

export interface ApplyConfirmResponse {
  reanchored: AnchorSummary;
}

/** Spec 05 §5.4 — one target, named by its index in `Thread.targets`. */
export interface AnchorRestateRequest {
  threadId: string;
  position: number;
  anchorState: AnchorState;
}

export interface ApplyReadyEvent {
  applyRunId: string;
  threadId: string;
  diff: string;
  /** Absolute paths of every file the agent changed. */
  files: string[];
  /** Spec 05 §5.6.1 — what to outline, per file. Empty for a file with no
      `data-src-line` stamps, which is the honest answer rather than a guess. */
  regions: ChangedRegion[];
  /** Spec 05 §5.6 — target documents Apply could not edit, and why. */
  skipped: SkippedDocument[];
}

export interface CostEvent {
  documentId: string;
  totalUsd: number;
}

// ── The fact graph (spec 07 §9) ─────────────────────────────

/**
 * Spec 07 §8.5 — which of the five states the Facts tab is in.
 *
 * `unavailable` is a sixth, and it is not a state the spec lists because it did
 * not anticipate the load failing: `sqlite-vec` is a loadable extension, and a
 * platform where it will not load has no fact graph. §6.1 makes that survivable
 * — the tables are a cache — so the tab says so rather than the app refusing to
 * start.
 */
export type FactsState =
  | "unavailable"
  | "never-built"
  | "up-to-date"
  | "stale"
  | "running"
  | "interrupted";

export interface FactsStatusRequest {
  root: string;
}

export interface FactsStatusResponse {
  state: FactsState;
  run: FactRunSummary | null;
  documentCount: number;
  /** Documents added or touched since the last build. Drives the `stale` state. */
  changedCount: number | null;
  /** Why the feature cannot run here. Only set for `unavailable`. */
  reason: string | null;
}

export interface FactsBuildRequest {
  root: string;
  /** §5.4 — omitted means the local-only default, which cannot leave the machine. */
  aliases?: { extract?: string; judge?: string; embed?: string };
  /** §8.5 — continue the interrupted run rather than starting a new one. */
  resumeRunId?: string;
}

export interface FactsFindingsRequest {
  root: string;
  filter: FindingFilter;
}

export interface FactsGraphRequest {
  root: string;
  topicId?: number;
}

export interface FactsVerdictRequest {
  findingKey: string;
  verdict: "confirmed" | "dismissed";
  note?: string;
}

/** §8.4 — a finding becomes a comment about two documents. */
export interface FactsCommentRequest {
  findingKey: string;
}

/** §11 rule 4 — one claim's evidence: every document that states it. */
export interface FactsEvidenceRequest {
  claimId: string;
}

export interface ClaimEvidence {
  documentPath: string;
  quote: string;
  anchor: Anchor;
}

export interface FactsProgressEvent {
  runId: string;
  stage: FactStage;
  done: number;
  total: number;
  message: string;
}

/**
 * The contextBridge surface. `src/preload/index.ts` implements exactly this
 * and nothing more — everything exposed here is reachable by document content.
 */
export interface RexApi {
  docPick(): Promise<DocumentRef | null>;
  docInitial(): Promise<InitialTarget | null>;
  docOpen(ref: DocumentRef): Promise<OpenedDocument>;
  workspacePick(): Promise<WorkspaceRef | null>;
  workspaceTree(ref: WorkspaceRef): Promise<WorkspaceTree>;
  workspaceGraph(ref: WorkspaceRef): Promise<ReferenceGraph>;
  threadList(request: ThreadListRequest): Promise<ThreadWithMessages[]>;
  threadCreate(request: ThreadCreateRequest): Promise<Thread>;
  threadAsk(threadId: string): Promise<void>;
  threadReply(request: ThreadReplyRequest): Promise<void>;
  threadResolve(request: ThreadResolveRequest): Promise<Thread>;
  threadSynthesise(request: ThreadSynthesiseRequest): Promise<Thread>;
  threadApply(threadId: string): Promise<string>;
  applyConfirm(request: ApplyConfirmRequest): Promise<ApplyConfirmResponse>;
  anchorRestate(request: AnchorRestateRequest): Promise<void>;

  /** Spec 07 §9. */
  factsStatus(request: FactsStatusRequest): Promise<FactsStatusResponse>;
  factsBuild(request: FactsBuildRequest): Promise<FactRunSummary>;
  factsCancel(runId: string): Promise<void>;
  factsFindings(request: FactsFindingsRequest): Promise<Finding[]>;
  factsGraph(request: FactsGraphRequest): Promise<FactGraph>;
  factsVerdict(request: FactsVerdictRequest): Promise<void>;
  factsComment(request: FactsCommentRequest): Promise<Thread>;
  factsEvidence(request: FactsEvidenceRequest): Promise<ClaimEvidence[]>;

  onStreamStep(listener: (message: Message) => void): () => void;
  onStreamCost(listener: (event: CostEvent) => void): () => void;
  onApplyReady(listener: (event: ApplyReadyEvent) => void): () => void;
  onFactsProgress(listener: (event: FactsProgressEvent) => void): () => void;
}
