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
  Message,
  OpenedDocument,
  ReferenceGraph,
  SkippedDocument,
  StrokeRef,
  Thread,
  ThreadWithMessages,
  ViewState,
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
  threadReply: "thread:reply",
  threadResolve: "thread:resolve",
  threadDelete: "thread:delete",
  threadSynthesise: "thread:synthesise",
  threadApply: "thread:apply",
  applyConfirm: "apply:confirm",
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
   * Spec 06 §5.4 — the reviewer's ink, when the places were circled.
   *
   * It rides inside this payload rather than in a channel of its own: §2 leaves
   * §10's IPC contract **unchanged**, because a drawing is not a second way to
   * make a comment. It is a fast way to fill the panel, and the panel already
   * has a way to send what it holds.
   */
  stroke?: StrokeRef;
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
  /** Spec 11 §7.7 — present when this run edited a deck, and never with a diff. */
  decks?: DeckPreview[];
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
  docOpen(ref: DocumentRef): Promise<OpenedDocument>;
  workspacePick(): Promise<WorkspaceRef | null>;
  /** `reveal` lists what the scan prunes, so an exclusion can be taken back. */
  workspaceTree(ref: WorkspaceRef, reveal?: boolean): Promise<WorkspaceTree>;
  workspaceGraph(ref: WorkspaceRef): Promise<ReferenceGraph>;
  workspaceExclude(request: WorkspaceExcludeRequest): Promise<void>;
  threadList(request: ThreadListRequest): Promise<ThreadWithMessages[]>;
  threadCreate(request: ThreadCreateRequest): Promise<Thread>;
  threadAsk(threadId: string): Promise<void>;
  threadReply(request: ThreadReplyRequest): Promise<void>;
  threadResolve(request: ThreadResolveRequest): Promise<Thread>;
  /** Removes the comment and everything that belonged to it. Irreversible. */
  threadDelete(threadId: string): Promise<void>;
  threadSynthesise(request: ThreadSynthesiseRequest): Promise<Thread>;
  threadApply(request: ThreadApplyRequest): Promise<string>;
  applyConfirm(request: ApplyConfirmRequest): Promise<ApplyConfirmResponse>;
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
