// SPEC.md §10 — every IPC channel name and payload type.
//
// Invariant I3: commands are `ipcRenderer.invoke`, agent output is
// `webContents.send`. There is no HTTP server, no SSE and no listening port,
// so this file is the entire surface between the two processes.

import type {
  Anchor,
  AnchorState,
  AnchorSummary,
  DocumentRef,
  Message,
  OpenedDocument,
  ReferenceGraph,
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
} as const;

// ── Request and response payloads ───────────────────────────────

export interface ThreadCreateRequest {
  documentId: string;
  anchor: Anchor;
  note: string;
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

export interface AnchorRestateRequest {
  threadId: string;
  anchorState: AnchorState;
}

export interface ApplyReadyEvent {
  applyRunId: string;
  threadId: string;
  diff: string;
  files: string[];
}

export interface CostEvent {
  documentId: string;
  totalUsd: number;
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
  threadList(documentId: string): Promise<ThreadWithMessages[]>;
  threadCreate(request: ThreadCreateRequest): Promise<Thread>;
  threadAsk(threadId: string): Promise<void>;
  threadReply(request: ThreadReplyRequest): Promise<void>;
  threadResolve(request: ThreadResolveRequest): Promise<Thread>;
  threadSynthesise(request: ThreadSynthesiseRequest): Promise<Thread>;
  threadApply(threadId: string): Promise<string>;
  applyConfirm(request: ApplyConfirmRequest): Promise<ApplyConfirmResponse>;
  anchorRestate(request: AnchorRestateRequest): Promise<void>;

  onStreamStep(listener: (message: Message) => void): () => void;
  onStreamCost(listener: (event: CostEvent) => void): () => void;
  onApplyReady(listener: (event: ApplyReadyEvent) => void): () => void;
}
