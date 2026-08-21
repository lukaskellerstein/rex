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

/**
 * Spec 06 §4.3 — how much of the document an anchor covers.
 *
 * `section` names a *heading* and means everything under it; `document` names
 * nothing inside the file and means all of it. Both are read before the four
 * layers, exactly as `region` is.
 */
export type AnchorExtent = "section" | "document";

export interface Anchor {
  quote: TextQuote | null; // null for pure element/region anchors
  position: TextPosition | null;
  element: ElementRef | null;
  region: RegionRef | null;
  source: SourceRef | null; // only when REX rendered the document
  /**
   * Spec 06 §4.3. Absent — every anchor written before spec 06 — means the
   * anchor covers the thing it names and nothing more.
   *
   * `anchor_json` is a JSON blob (§9), so this needs no migration, no new
   * column and no change to any query: an old row simply reads as `undefined`.
   */
  extent?: AnchorExtent;
}

export type AnchorState = "ok" | "moved" | "orphaned";

// ── Threads and messages ────────────────────────────────────

export type ThreadKind = "anchored" | "synthesis";
export type ThreadStatus = "open" | "resolved";
export type Profile = "read" | "write";

/**
 * Spec 06 §5.4 — the reviewer's own ink, kept so the comment still shows it.
 *
 * It is a record of a gesture, not a measurement. The *targets* are what carry
 * the comment's meaning; this is what makes the gesture recognisable a month
 * later.
 */
export interface StrokeRef {
  /**
   * One entry per stroke; each is an ordered list of points.
   *
   * Fractions of the **union box of the comment's targets**, not pixels and not
   * fractions of any one element. Pixels fail on the first window resize.
   * Fractions of one element fail as soon as the drawing spans more than that
   * element. Fractions of the union box are self-correcting: resolve the
   * targets, take the union of their boxes now, and map these onto it — if the
   * paragraphs reflow, the ink reflows with them, because the ink is defined in
   * terms of them.
   */
  paths: Array<Array<{ x: number; y: number }>>;
  /** Pen width in CSS pixels. Ink does not get thicker when a table does. */
  width: number;
}

/**
 * One place a comment is about. Spec 05 §5.1.
 *
 * A target carries its own document, which is what lets one comment be about a
 * table here and a paragraph in another file. Spec 04's `extraAnchors` could
 * not: a bare `Anchor` has no document, so the pair collapsed into this list.
 */
export interface AnchorTarget {
  documentId: string;
  anchor: Anchor;
  /**
   * The last resolution, or null when this document has not been open since the
   * target was written. Null is **not** orphaned — spec 05 §5.4. An orphan means
   * "the text is gone"; null means "nobody looked".
   */
  state: AnchorState | null;
}

export interface Thread {
  id: string;
  /**
   * Where the comment started: `targets[0]`'s document. Ask's repository root
   * and the cost pill both read it. Apply does not — it edits every document
   * the comment is about (spec 05 §5.6).
   */
  documentId: string;
  kind: ThreadKind;
  status: ThreadStatus;
  /** Every place this comment is about, in the order the panel listed them. */
  targets: AnchorTarget[]; // empty for a synthesis thread
  note: string; // the comment the user typed
  sessionId: string | null;
  profile: Profile;
  model: string | null;
  refThreadIds: string[]; // synthesis threads only
  /**
   * Spec 06 §5.4 — absent for every comment that was not drawn.
   *
   * Its own column rather than a field inside `anchor_json`, because a stroke is
   * not a property of any one anchor: it is drawn across all of them. Storing it
   * on target 0 would make the ink a possession of whichever block happened to
   * sort first, and deleting that one target would take the drawing with it.
   */
  stroke?: StrokeRef;
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

/**
 * A thread plus its transcript, as `thread:list` returns it.
 *
 * The three fields below `messages` are derived in main from the document table
 * and stored nowhere. The comment list is workspace-wide now (spec 05 §5.3), so
 * a row has to be able to say what it is about — and whether Apply can act on it
 * — without a second round trip per row.
 */
export interface ThreadWithMessages extends Thread {
  messages: Message[];
  /** The distinct documents this comment is about, in target order. */
  documentNames: string[];
  /**
   * One document name per target, parallel to `targets`.
   *
   * Not the same list as `documentNames`, which has no repeats: the card lists
   * every place and each place has to say where it is, while the row names the
   * documents once.
   */
  targetNames: string[];
  /** True when at least one target document is a file Apply can edit (§5.6). */
  applyEnabled: boolean;
  /** Shown on hover when `applyEnabled` is false. */
  applyDisabledReason: string | null;
}

/**
 * The re-anchor sweep report required after every Apply (§8.7 step 7).
 *
 * Spec 05 §5.8: these count **checked targets**, not threads. The sweep can only
 * check the document on screen, so this is a report on what it just did.
 */
export interface AnchorSummary {
  ok: number;
  moved: number;
  orphaned: number;
  total: number;
}

/**
 * A run of lines in a file as it is **now**, 1-indexed and inclusive.
 *
 * Spec 05 §5.6.1 — the `+` side of a diff hunk, which is the only side that can
 * be matched against `data-src-line` in the document the reviewer is reading.
 */
export interface LineRange {
  from: number;
  to: number;
}

/** Where an Apply changed a file, per file. Spec 05 §5.6.1. */
export interface ChangedRegion extends LineRange {
  /** Absolute path, so the renderer can test it against the open document. */
  file: string;
}

/** A target document Apply could not edit, and why. Spec 05 §5.6. */
export interface SkippedDocument {
  file: string;
  reason: string;
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
