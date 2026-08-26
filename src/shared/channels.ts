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
  CommentGroup,
  CommentMove,
  DocumentRef,
  DocumentVersion,
  Message,
  OpenedDocument,
  ReferenceGraph,
  SkippedDocument,
  Thread,
  ThreadWithMessages,
  ViewState,
  WorkingCopyView,
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
  /** Spec 10 §3.4 — take a folder or a file out of the review, or put it back. */
  workspaceExclude: "workspace:exclude",
  threadList: "thread:list",
  threadCreate: "thread:create",
  threadAsk: "thread:ask",
  /**
   * Spec 17 §2.1 — end this comment's running work.
   *
   * Its own channel and not a flag on anything: it is the one command that acts
   * on a run rather than on a comment, and it is the only one a reviewer
   * presses while another command of theirs is still in flight.
   */
  threadStop: "thread:stop",
  threadReply: "thread:reply",
  threadResolve: "thread:resolve",
  threadDelete: "thread:delete",
  threadSynthesise: "thread:synthesise",
  threadApply: "thread:apply",
  /**
   * NOTE mode — record what was typed in a comment, and run nothing.
   *
   * Its own channel and not a flag on `thread:reply`: that one always reaches
   * an agent, and a channel that means "send" or "do not send" depending on a
   * boolean is the kind of economy that ends with a paid run nobody asked for.
   */
  threadNote: "thread:note",
  /** Spec 14 §3 — the name on a comment. Null goes back to the note. */
  threadRename: "thread:rename",
  /** Spec 14 §5 — the reviewer's own arrangement of the list. */
  groupList: "group:list",
  groupCreate: "group:create",
  groupUpdate: "group:update",
  groupDelete: "group:delete",
  /**
   * Spec 14 §4.2 — one drop, whatever kind of row was dragged.
   *
   * One channel and not two: the panel has exactly one drag gesture, and its
   * payload differs only in a discriminator. `group:delete` stays separate and
   * always will — it is the one that rearranges other rows, and a channel that
   * deletes should never be reachable by leaving a field off another one.
   */
  commentsMove: "comments:move",
  applyConfirm: "apply:confirm",
  /**
   * Spec 15 §7 — the working copy, and the three things a reviewer does to one.
   *
   * They are separate channels rather than one carrying a verb, for the reason
   * `group:delete` is separate from `group:update`: `work:approve` is the one
   * that writes into the reviewer's own file, and a channel that does that only
   * when a string says so is a channel that does it when the string is wrong.
   */
  workList: "work:list",
  workApprove: "work:approve",
  workDiscard: "work:discard",
  workUndo: "work:undo",
  anchorRestate: "anchor:restate",
  /**
   * Spec 11 §7.4.2 — the renderer's answer to `render:request`.
   *
   * The one place a command flows the "wrong" way round: main asked, and this
   * carries the picture back. It is still `invoke`, so invariant I3 holds — the
   * renderer is the one calling, exactly as it is for every other command.
   */
  renderResult: "render:result",
  /**
   * Spec 08 §6.2 — this run's identifiers, on the clipboard.
   *
   * Not in §10's table. It has to be a command rather than something the
   * renderer assembles, because every field that makes the report worth pasting
   * — the agent's cwd, the SDK's transcript path, the database, the versions —
   * exists only in main. The clipboard is written there too: Electron owns it,
   * and a copy that depends on the renderer being focused fails exactly when a
   * reviewer is trying to report a bug.
   */
  debugCopy: "debug:copy",
  /**
   * Spec 13 §4 — the app's own state, on the clipboard.
   *
   * A separate channel from `debug:copy` rather than a nullable argument on it.
   * That one names a thread and always will; the failure this one is for
   * happens before any thread exists, and a channel that means two things
   * depending on a null is the kind of economy that costs an afternoon later.
   */
  debugSnapshot: "debug:snapshot",
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
   * Spec 11 §7.4.2 and §7.4.5 — main asks the renderer to make a picture.
   *
   * It cannot make either one itself. Mermaid appends a temporary element to a
   * document and measures text with a real layout; a poster frame means
   * decoding a video and reading a pixel out of it. Both need a live DOM and a
   * canvas, and main has neither — the same reason spec 03 §5.8 gives for the
   * document view's own diagrams. Main holds the deck; the renderer holds the
   * engines; this is the sentence between them.
   */
  renderRequest: "render:request",
} as const;

// ── Request and response payloads ───────────────────────────────

/**
 * Spec 05 §5.3 — every comment in the workspace, not one document's.
 *
 * `root` is the workspace root, or null when a single file was opened by path;
 * main then uses that document's own directory. `documentId` is not a duplicate
 * of it: the open document's own comments must be in the list whatever the root
 * turns out to be, and naming it is what guarantees that.
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
   * NOTE mode — save it and send it to nobody.
   *
   * Absent and false both mean the ordinary comment, which is created and then
   * sent by whichever of `thread:ask` or `thread:apply` the mode picked.
   */
  isNote?: boolean;
}

/**
 * Spec 10 §3.4 — one path, one decision.
 *
 * `exclude: false` is "include in review", which both takes an exclusion back
 * and pulls in a folder REX skips by default. Main decides which of the two it
 * is, because only main knows what rule the path currently carries.
 */
export interface WorkspaceExcludeRequest {
  root: string;
  path: string;
  exclude: boolean;
}

export interface ThreadReplyRequest {
  threadId: string;
  text: string;
}

/**
 * Spec 12 §4.2 — an ACT send.
 *
 * `note` is what the reviewer typed with the switch on ACT, and it is the
 * instruction. Before this spec the same channel took a bare `threadId` and the
 * agent inferred what to do from the transcript, which is why Apply could not
 * run until something had been said. Empty is not valid: §4.3.
 */
export interface ThreadApplyRequest {
  threadId: string;
  note: string;
}

/**
 * Spec 14 §3.1 — `title: null` is the reset, and so is an empty string.
 *
 * "Delete the name" and "go back to the note" are the same wish, so the panel is
 * not made to tell them apart.
 */
export interface ThreadRenameRequest {
  threadId: string;
  title: string | null;
}

/** Spec 14 §5.3 — groups belong to a workspace root, so every call names one. */
export interface GroupListRequest {
  root: string;
}

export interface GroupCreateRequest {
  root: string;
  /** Null is the top level. */
  parentId: string | null;
  name: string;
}

/**
 * The name, the collapsed flag, or both.
 *
 * Both fields optional and both on one channel, because both are "a property of
 * this group changed" and neither is worth a round trip of its own.
 */
export interface GroupUpdateRequest {
  groupId: string;
  name?: string;
  collapsed?: boolean;
}

export interface GroupDeleteRequest {
  groupId: string;
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

/**
 * Spec 11 §7.7 — one operation, in the words the preview shows.
 *
 * `git diff` on a `.pptx` prints `Binary files differ`, and spec 01 §8.7
 * step 5 — show the change and wait — is REX's entire safety story for Apply.
 * A binary diff turns that step into a rubber stamp, so this replaces it.
 */
export interface DeckOperationLine {
  op: string;
  /** One line naming the slide and the shape by the name a reviewer knows. */
  summary: string;
  /**
   * What the reviewer must be told before accepting: formatting flattened by a
   * run merge, a font the deck does not carry, a colour outside the palette, a
   * shape that may now overflow.
   */
  flags: string[];
}

/** One affected slide, drawn before and after, as two self-contained pages. */
export interface DeckSlidePreview {
  slide: number;
  before: string | null;
  after: string | null;
  /**
   * The slide box in points, so the preview can scale the picture exactly.
   *
   * It has to come from the deck: a 16:9 deck is 720×405pt and a 4:3 one is
   * 720×540, and a preview that assumed either would letterbox or crop the
   * other one — on the pictures that decide whether an edit is accepted.
   */
  widthPt: number;
  heightPt: number;
}

/**
 * Spec 11 §7.7 — the preview that replaces the diff. Both halves are required.
 *
 * The pictures are what catch the failures the words cannot express: text that
 * overflows its shape, a style that is mechanically right and visually wrong, a
 * picture that does not suit the slide. A words-only summary reads as correct
 * in all three cases.
 */
export interface DeckPreview {
  /** Absolute path of the deck. */
  deck: string;
  operations: DeckOperationLine[];
  slides: DeckSlidePreview[];
  /** §7.8 — structural problems the edit introduced. Empty on every accepted run. */
  problems: string[];
}

/**
 * Spec 15 §7.4 — what a finished ACT run has to say for itself.
 *
 * It is a **notice**, not a gate. Before spec 15 this opened a bar with OK and
 * Undo, and nothing was final until one was pressed — that bar was the whole of
 * spec 01 §8.7 step 5. The two panes are step 5 now, so nothing is waiting on
 * this: the reviewer's file already holds what it held before the run, and it
 * keeps holding it until §7.2 runs.
 */
export interface ApplyReadyEvent {
  applyRunId: string;
  threadId: string;
  diff: string;
  /** Absolute paths of every document whose working copy this run changed. */
  files: string[];
  /** Spec 05 §5.6.1 — what to outline, per file. Empty for a file with no
      `data-src-line` stamps, which is the honest answer rather than a guess. */
  regions: ChangedRegion[];
  /** Spec 05 §5.6 — target documents Apply could not edit, and why. */
  skipped: SkippedDocument[];
  /** Spec 15 §3 — the working copy of each document this run changed. */
  working: WorkingCopyView[];
  /**
   * Spec 15 §4.3 — files the agent wrote that were not its to write, put back.
   *
   * Never empty for a well-behaved run, and never silent for any other kind: a
   * file the reviewer did not comment on is not part of this review.
   */
  restored: string[];
  /**
   * Spec 17 §3.4 — the reviewer stopped this run.
   *
   * It suppresses the notice bar, and nothing else. A run that was stopped has
   * already reported itself in the conversation, in the STOPPED block the
   * reviewer's own press produced; a bar saying *"This document was not
   * changed"* under it is REX answering a question nobody asked.
   *
   * Any working copy the stopped run DID produce is unaffected — it is shown in
   * the two panes exactly as a finished run's is, because a half-written change
   * has to be visible whatever ended the run.
   */
  stopped: boolean;
  /** Spec 11 §7.7 — present when this run edited a deck, and never with a diff. */
  decks?: DeckPreview[];
}

/** Spec 15 §7.2 — approving writes into the reviewer's file, so it can refuse. */
export interface WorkApproveResponse {
  ok: boolean;
  /** §7.3 — why not, in the words the reviewer sees. */
  reason: string | null;
  /** The sweep that follows a write (§8.7 step 6). Null when nothing was written. */
  reanchored: AnchorSummary | null;
}

/** What main is asking the renderer to draw. */
export type RenderRequestKind = "diagram" | "poster";

/** Spec 11 §7.4.2 — main asks; `id` is what pairs the answer with the question. */
export interface RenderRequestEvent {
  id: string;
  kind: RenderRequestKind;
  /**
   * Mermaid source for a diagram; a `rex-doc://` URL for a video whose first
   * frame is wanted. A video is never sent as bytes — a 50 MB clip base64'd
   * across IPC is 67 MB of string for one still picture.
   */
  source: string;
}

export interface RenderResultRequest {
  id: string;
  /** A PNG, base64-encoded, or null when it would not draw. */
  pngBase64: string | null;
  error: string | null;
  /** §7.4.5 — a video's length, so the preview can state it. Seconds. */
  durationSeconds?: number;
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
  /**
   * Spec 15 §6.1 — `version` picks which of the two the render is.
   *
   * A version and never a path: the renderer displays untrusted document
   * content (invariant I2), so it does not get to name a file for main to read.
   * Omitted, or with no working copy, it is the reviewer's own file exactly as
   * before.
   */
  docOpen(ref: DocumentRef, version?: DocumentVersion): Promise<OpenedDocument>;
  workspacePick(): Promise<WorkspaceRef | null>;
  /** `reveal` lists what the scan prunes, so an exclusion can be taken back. */
  workspaceTree(ref: WorkspaceRef, reveal?: boolean): Promise<WorkspaceTree>;
  workspaceGraph(ref: WorkspaceRef): Promise<ReferenceGraph>;
  workspaceExclude(request: WorkspaceExcludeRequest): Promise<void>;
  threadList(request: ThreadListRequest): Promise<ThreadWithMessages[]>;
  threadCreate(request: ThreadCreateRequest): Promise<Thread>;
  threadAsk(threadId: string): Promise<void>;
  /**
   * Spec 17 §3.1 — stops every run this comment has, and says how many.
   *
   * Zero means the run finished between the paint and the click, which is worth
   * a sentence rather than a button that appears to do nothing.
   */
  threadStop(threadId: string): Promise<number>;
  threadReply(request: ThreadReplyRequest): Promise<void>;
  threadResolve(request: ThreadResolveRequest): Promise<Thread>;
  /** Removes the comment and everything that belonged to it. Irreversible. */
  threadDelete(threadId: string): Promise<void>;
  threadSynthesise(request: ThreadSynthesiseRequest): Promise<Thread>;
  threadApply(request: ThreadApplyRequest): Promise<string>;
  /** NOTE mode — saves the text in the thread. No agent, no session, no cost. */
  threadNote(request: ThreadReplyRequest): Promise<void>;
  /** Spec 14 §3 — name a comment, or pass null to go back to the note. */
  threadRename(request: ThreadRenameRequest): Promise<void>;
  /** Spec 14 §5 — every group in one workspace, at every depth, in walk order. */
  groupList(request: GroupListRequest): Promise<CommentGroup[]>;
  groupCreate(request: GroupCreateRequest): Promise<CommentGroup>;
  groupUpdate(request: GroupUpdateRequest): Promise<void>;
  /** Promotes everything inside to the group's own parent, then removes it. */
  groupDelete(request: GroupDeleteRequest): Promise<void>;
  /** Spec 14 §4.2 — one drop: this row, into that parent, after that sibling. */
  commentsMove(request: CommentMove): Promise<void>;
  applyConfirm(request: ApplyConfirmRequest): Promise<ApplyConfirmResponse>;
  /** Spec 15 §7 — every document with a change waiting, newest fork first. */
  workList(): Promise<WorkingCopyView[]>;
  /** Writes the new version over the reviewer's file, or says why it will not. */
  workApprove(documentId: string): Promise<WorkApproveResponse>;
  /** Throws the working copy away. The file was never touched. */
  workDiscard(documentId: string): Promise<void>;
  /** One ACT run back. The revision is kept, so this is a step, not a loss. */
  workUndo(documentId: string): Promise<void>;
  anchorRestate(request: AnchorRestateRequest): Promise<void>;
  /** Puts this thread's debug report on the clipboard and returns it. */
  debugCopy(threadId: string): Promise<string>;
  /** Spec 13 §4 — the same, for the app rather than for one comment. */
  debugSnapshot(view: ViewState): Promise<string>;

  onStreamStep(listener: (message: Message) => void): () => void;
  onStreamCost(listener: (event: CostEvent) => void): () => void;
  onApplyReady(listener: (event: ApplyReadyEvent) => void): () => void;
  /** Spec 11 §7.4.2 — main asks for a picture; the renderer answers. */
  onRenderRequest(listener: (event: RenderRequestEvent) => void): () => void;
  renderResult(request: RenderResultRequest): Promise<void>;
}
