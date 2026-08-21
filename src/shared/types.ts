// The single source of truth for every shape crossing the process boundary.
// SPEC.md §4 — copied verbatim; extend here and nowhere else.

// ── Documents ───────────────────────────────────────────────

export type DocumentRef =
  | { kind: "file"; value: string } // absolute path
  | { kind: "url"; value: string }; // full URL

export interface DocumentRecord {
  id: string;
  ref: DocumentRef;
  title: string | null;
  contentHash: string | null; // sha256 of source bytes; null for url
  lastSeenAt: string; // ISO 8601
}

// ── Anchors ─────────────────────────────────────────────────

export interface TextQuote {
  exact: string;
  prefix: string; // up to 32 chars before
  suffix: string; // up to 32 chars after
}

export interface TextPosition {
  start: number; // offset in normalised document text
  end: number;
}

export interface ElementRef {
  id?: string; // element id attribute, if stable
  css?: string; // fallback CSS path
}

export interface RegionRef {
  x: number;
  y: number; // fractions of the element box, 0..1
  w: number;
  h: number;
  /**
   * What the element held when the box was drawn.
   *
   * A region is geometry, and geometry always resolves: redraw a chart with new
   * data and x/y/w/h still land inside it, onto different content, reporting
   * success. That is the one silent wrong-place failure the rest of §6 is built
   * to avoid, and this field is what closes it — a mismatch on resolve means
   * `orphaned`, with the comment and its quote kept as §6.6 requires.
   *
   * Optional: anchors written before this field existed have none, and are
   * resolved on geometry alone rather than being orphaned wholesale.
   */
  fingerprint?: string;
}

export interface SourceRef {
  file: string; // absolute path
  line: number; // 1-indexed
}

export interface Anchor {
  quote: TextQuote | null; // null for pure element/region anchors
  position: TextPosition | null;
  element: ElementRef | null;
  region: RegionRef | null;
  source: SourceRef | null; // only when REX rendered the document
}

export type AnchorState = "ok" | "moved" | "orphaned";

// ── Threads and messages ────────────────────────────────────

export type ThreadKind = "anchored" | "synthesis";
export type ThreadStatus = "open" | "resolved";
export type Profile = "read" | "write";

export interface Thread {
  id: string;
  documentId: string;
  kind: ThreadKind;
  status: ThreadStatus;
  anchor: Anchor | null; // null for synthesis threads
  /**
   * Further places the same comment is about, when the reviewer shift-clicked
   * more than one element. Empty for the ordinary one-target comment.
   *
   * `anchor` stays the primary one and keeps every meaning it had: it is what
   * Apply writes back through, what the gutter marker sits beside, and what the
   * card quotes. These are additional evidence for the same question — "these
   * three rows disagree with each other" is one comment, not three.
   */
  extraAnchors: Anchor[];
  /** The worst state across `anchor` and `extraAnchors` — §6.6. */
  anchorState: AnchorState | null;
  note: string; // the comment the user typed
  sessionId: string | null;
  profile: Profile;
  model: string | null;
  refThreadIds: string[]; // synthesis threads only
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type MessageRole = "user" | "assistant" | "system";

export type MessageKind =
  | "text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "diff"
  | "error"
  | "completed";

export interface Message {
  id: string;
  threadId: string;
  seq: number;
  role: MessageRole;
  kind: MessageKind;
  content: string | null;
  toolName: string | null;
  toolInput: unknown | null;
  isError: boolean;
  costUsd: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

// ── Apply ───────────────────────────────────────────────────

export type ApplyStatus = "pending" | "applied" | "rejected" | "failed";

export interface ApplyRun {
  id: string;
  threadId: string;
  status: ApplyStatus;
  diff: string | null;
  files: string[];
  createdAt: string;
  completedAt: string | null;
}

// ── Workspace and reference graph ───────────────────────────
// Spec 02 §3. A workspace is a directory of documents; a document is still
// identified by its absolute path, so nothing above this line changes.

export interface WorkspaceRef {
  root: string; // absolute directory path
}

export type TreeEntryKind =
  | "directory"
  | "document" // Markdown or HTML — REX can render it
  | "other"; // present, listed, not openable

export interface CommentCounts {
  open: number;
  resolved: number;
  orphaned: number;
}

export interface TreeEntry {
  name: string;
  path: string; // absolute
  kind: TreeEntryKind;
  children: TreeEntry[]; // empty for files
  /** Present only for a document REX has threads for. */
  comments: CommentCounts | null;
  /** Why this entry cannot be opened. Null for directories and documents. */
  disabledReason: string | null;
}

export interface WorkspaceTree {
  root: string;
  entries: TreeEntry[];
  /** True when the scan hit a limit in spec 02 §4.2 and the tree is incomplete. */
  truncated: boolean;
}

export type GraphNodeKind =
  | "document" // a renderable file inside the workspace
  | "external" // a file that exists outside the workspace
  | "missing"; // a link target that does not exist

export interface GraphNode {
  id: string; // absolute path
  label: string; // path relative to the workspace root
  kind: GraphNodeKind;
  inDegree: number; // distinct documents linking here
  /**
   * Total incoming links, which is not the same number and is the one that
   * finds a hub: in a small corpus where everything cites everything,
   * in-degree saturates and stops discriminating.
   */
  inLinks: number;
  outDegree: number;
  comments: CommentCounts | null;
}

export interface GraphEdge {
  source: string; // GraphNode.id
  target: string;
  count: number; // how many links, not how many targets
  /** Section fragments used, e.g. "phase-3-building-autonomous". */
  fragments: string[];
}

export interface BrokenLink {
  from: string; // absolute path of the linking document
  href: string; // exactly as written in the source
  line: number | null; // 1-indexed, when the format gives it
}

export interface ReferenceGraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  brokenLinks: BrokenLink[];
  /** Links to http(s)/mailto, counted but not drawn (spec 02 §5.3). */
  externalUrlCount: number;
  /**
   * Links to files that exist but are not documents — a PDF, an image. Counted
   * and not drawn: the graph is of how documents reference each other, and an
   * asset is a different relation. Drawing them would also contradict the
   * explorer, which lists such a file as unopenable.
   */
  assetLinkCount: number;
}

// ── Beyond §4 ───────────────────────────────────────────────
// Shapes the IPC contract (§10) names but §4 does not define.

/** A thread plus its transcript, as `thread:list` returns it. */
export interface ThreadWithMessages extends Thread {
  messages: Message[];
}

/** The re-anchor sweep report required after every Apply (§8.7 step 7). */
export interface AnchorSummary {
  ok: number;
  moved: number;
  orphaned: number;
  total: number;
}

/**
 * How the renderer is meant to present this document (spec 03 §9).
 *
 * A discriminated union rather than a nullable `html`. `html === null` used to
 * mean "this is a webview" — an overload that was unambiguous while there were
 * two cases and is ambiguous now there are three. A union makes the renderer's
 * `switch` exhaustive, so `tsc` finds the branch anybody forgets.
 */
export type DocumentPresentation =
  /** Markdown, HTML and DOCX — main rendered it to a string. */
  | { kind: "html"; html: string }
  /**
   * A `rex-doc://` URL; the renderer draws the pages itself (§7).
   *
   * `assetsUrl` is the same scheme over PDF.js's own `pdfjs-dist` directory.
   * It is not optional: a PDF whose fonts are the base-14 set embeds nothing,
   * and without `standardFontDataUrl` the render task hangs rather than
   * failing — measured on 2026-08-21, the page filled white and never drew a
   * glyph. Only main knows where the package sits, and it differs between a
   * checkout and a packaged `app.asar`.
   */
  | { kind: "pdf"; url: string; assetsUrl: string }
  /** Tier 2 — a remote page in a <webview>. */
  | { kind: "url" };

/** What `doc:open` hands the renderer. */
export interface OpenedDocument {
  documentId: string;
  ref: DocumentRef;
  presentation: DocumentPresentation;
  contentHash: string | null;
  title: string | null;
  /** Directory the document's relative assets resolve against. */
  baseDir: string | null;
  /**
   * Preload for the tier 2 `<webview>`. The resolver has to run inside that
   * process (invariant I1) and only main knows where the built file is.
   */
  webviewPreload: string | null;
  /** False for tiers 2 and 3 — no local source file to write back into (§5.2). */
  applyEnabled: boolean;
  /** Shown on hover when applyEnabled is false. */
  applyDisabledReason: string | null;
  /** True when the file changed since the anchors were written (§6.6). */
  contentChanged: boolean;
}
