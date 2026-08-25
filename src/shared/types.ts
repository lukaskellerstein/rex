// The single source of truth for every shape crossing the process boundary.
// SPEC.md §4 — copied verbatim; extend here and nowhere else.

// ── Documents ───────────────────────────────────────────────

/**
 * A local file, and nothing else.
 *
 * Still a discriminated union with one member. REX opened a URL in a
 * `<webview>` once and no longer does — the tier is gone, not merely unreachable
 * — but the tag is what the `document` table stores and what a second kind
 * would attach to, so removing the URL did not mean flattening the shape.
 */
export type DocumentRef = { kind: "file"; value: string }; // absolute path

export interface DocumentRecord {
  id: string;
  ref: DocumentRef;
  title: string | null;
  contentHash: string | null; // sha256 of source bytes
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
  /**
   * Spec 11 §5.2 — what the element held when the anchor was written.
   *
   * The same idea as `RegionRef.fingerprint`, and it exists for the same
   * failure in a different place. On a deck an element id is *derived from an
   * index*: `slide-4-shape-3` is the third shape on slide 4, so inserting a
   * shape before it silently re-points every id below. Without a content check
   * the anchor resolves, reports success, and is about a different shape.
   *
   * Optional, and absent on every prose anchor: a Markdown or HTML element ref
   * carries an author's id or a CSS path, neither of which is an index. The
   * resolver only uses the extra layers when this field is present, so nothing
   * about resolving prose changes.
   */
  fingerprint?: string;
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

/**
 * Spec 14 §5.1 — a named container for comments, nested to any depth.
 *
 * Not a directory. The explorer's folders are paths on disk; these exist only
 * in `rex.db`, hold comments from any document under one workspace root, and
 * mean nothing to any agent — §2.1 is why they are called groups and not
 * folders.
 */
export interface CommentGroup {
  id: string;
  /** The workspace root this group belongs to. Spec 14 §5.3. */
  root: string;
  /** Null is the top level. */
  parentId: string | null;
  name: string;
  /** Rank among the groups sharing `parentId`, and among them only (§4.1). */
  position: number;
  collapsed: boolean;
  createdAt: string;
}

/** Spec 14 §4.3 — the two kinds of row a drag can move. */
export type CommentItem = { kind: "thread"; id: string } | { kind: "group"; id: string };

/** Spec 14 §4.2 — one drop, as a gesture rather than as a computed order. */
export interface CommentMove {
  item: CommentItem;
  /** The group it lands in; null is the top level. */
  parentId: string | null;
  /**
   * The sibling it lands after — always of the same kind as `item` (§4.3), and
   * null means first.
   *
   * An id and not an index. The panel is filtered, so the third row on screen
   * can be the ninth comment in its group; an index computed from what the
   * reviewer sees describes a different place than the one they dropped onto.
   */
  after: string | null;
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
  /**
   * Spec 14 §3.1 — the name the reviewer typed, or null.
   *
   * Null is not "unnamed", it is "named by the note": every surface calls
   * `commentName()` in `shared/names.ts`, which falls back to the note's first
   * line. Nothing is ever written here by REX, so a comment made before this
   * column existed reads exactly as it always did.
   */
  title: string | null;
  /** Spec 14 §5 — the group this comment sits in. Null is the top level. */
  groupId: string | null;
  /** Spec 14 §4.1 — rank among the comments sharing `groupId`. */
  position: number;
  /**
   * True for a comment the reviewer saved and never sent — NOTE mode.
   *
   * It is not "has no answer yet": an ASK that failed has no answer either, and
   * the two must not look alike. This says the reviewer *chose* not to send it,
   * which is why "Ask all" skips it and why the panel draws it in its own
   * colour. It goes false the moment the comment is sent, because a note that
   * has been asked is not a note any more.
   */
  isNote: boolean;
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

/**
 * Spec 10 §3 — why an entry is not part of the review, when it is not.
 *
 * `user` is a rule the reviewer wrote and can take back; `default` is REX's own
 * skip list (`node_modules`, `.git`, build output). The tree draws the two the
 * same way, but the menu offers different words for them, and only `user` rules
 * narrow what the workspace-wide commands act on.
 */
export type Exclusion = "user" | "default";

export interface TreeEntry {
  name: string;
  path: string; // absolute
  kind: TreeEntryKind;
  children: TreeEntry[]; // empty for files
  /** Present only for a document REX has threads for. */
  comments: CommentCounts | null;
  /** Why this entry cannot be opened. Null for directories and documents. */
  disabledReason: string | null;
  /**
   * Null for everything in review, which is every entry a scan returns unless
   * it was asked to reveal what it prunes. An excluded directory always arrives
   * with no `children`: its subtree is never walked, which is both the point and
   * what stops revealing `node_modules` from eating the whole entry budget.
   */
  exclusion: Exclusion | null;
}

export interface WorkspaceTree {
  root: string;
  entries: TreeEntry[];
  /** True when the scan hit a limit in spec 02 §4.2 and the tree is incomplete. */
  truncated: boolean;
  /**
   * Spec 10 §3.3 — the absolute path of every subtree a *user* rule prunes,
   * whether or not this scan revealed them.
   *
   * The tree and the graph both come out of the same scan, so neither needs
   * this. The workspace-wide commands do: "Ask all" works from the loaded thread
   * list rather than from the tree, and without these paths it would keep
   * spending money on documents the reviewer has said are not part of the
   * review. Default skips are deliberately absent — those are a scan-cost
   * decision, not a statement about scope.
   */
  excluded: string[];
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
  /**
   * Spec 08 §7.3 — one ref per target, parallel to `targetNames`, so a place
   * row can open the document it names. Null when the document record is gone.
   */
  targetRefs: Array<DocumentRef | null>;
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
 * A discriminated union rather than a nullable `html`, so the renderer's
 * `switch` is exhaustive and `tsc` finds the branch anybody forgets when a
 * format is added.
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
  | { kind: "pdf"; url: string; assetsUrl: string };

/**
 * Spec 15 §6.1 — which version of a document a render is.
 *
 * `original` is the reviewer's file. `current` is the working copy, which is
 * the version that will exist if they approve it — so it is where comments are
 * made and what a second ACT run edits.
 */
export type DocumentVersion = "original" | "current";

/**
 * Spec 15 §6.1 — which of the two panes the reviewer wants on screen.
 *
 * `both` is the default the moment a working copy exists. `new` alone is what
 * they want once they have read the change; `original` alone is how they check
 * what a passage used to say.
 */
export type PaneMode = "original" | "both" | "new";

/**
 * Spec 15 §3 — a document with a change waiting for the reviewer.
 *
 * It is a fact about a *document*, not about a run: the working copy survives
 * the run that made it, which is the whole of §5. Every field here is what the
 * two panes and the top bar need to draw themselves.
 */
export interface WorkingCopyView {
  documentId: string;
  /** The reviewer's file. Absolute. */
  path: string;
  /** The file name, which is what a row shows. */
  name: string;
  /** How many ACT runs are in it. `undo` steps back one. */
  revisions: number;
  addedLines: number;
  removedLines: number;
  /** Blocks the new version added or changed, in ITS line numbers (§6.2). */
  added: ChangedRegion[];
  /** Blocks only the original has, in ITS line numbers (§6.2). */
  removed: ChangedRegion[];
  /** The unified patch, collapsed under the panes (§6.3). */
  patch: string;
  /**
   * §7.3 — set when the file changed on disk since the fork, in the words the
   * reviewer sees. Approval refuses while it is non-null; REX does not merge.
   */
  conflict: string | null;
}

/** What `doc:open` hands the renderer. */
export interface OpenedDocument {
  documentId: string;
  ref: DocumentRef;
  presentation: DocumentPresentation;
  contentHash: string | null;
  title: string | null;
  /** Directory the document's relative assets resolve against. */
  baseDir: string | null;
  /** False for a format with no local source to write back into (§5.2). */
  applyEnabled: boolean;
  /** Shown on hover when applyEnabled is false. */
  applyDisabledReason: string | null;
  /** True when the file changed since the anchors were written (§6.6). */
  contentChanged: boolean;
  /** Spec 15 §6.1 — which version this render is. */
  version: DocumentVersion;
  /** Spec 15 §3 — non-null when this document has a working copy. */
  working: WorkingCopyView | null;
}

/**
 * Spec 13 §4.2 — what the overlay knows about itself, for the debug report.
 *
 * Nothing else can produce it: which tab is open, what the document frame did,
 * and what notice is on screen are facts only the renderer holds. It travels as
 * one argument on `debug:snapshot` and is never stored.
 *
 * No document text, no comment text — §3.4. `documentBytes` is a size, and the
 * note fields are counts.
 */
export interface ViewState {
  /**
   * The window's own size, in CSS pixels.
   *
   * Measured on 2026-08-25 and the reason this field exists: a tiling window
   * manager gave REX an 857px column of a 3440px screen, the two side panels
   * kept their widths, and the document pane collapsed to a 164px strip. The
   * document had rendered — 102 nodes, right title — and was invisible. Nothing
   * else in this report could have said so.
   */
  window: { width: number; height: number };
  workspaceRoot: string | null;
  document: {
    documentId: string;
    /** The document's absolute path — `ref.value`. */
    value: string;
    kind: DocumentRef["kind"];
    title: string | null;
    /** `html` or `pdf`. */
    presentation: DocumentPresentation["kind"];
    /** How much HTML main handed over, when it handed over any. */
    documentBytes: number | null;
    contentChanged: boolean;
    /**
     * Whether the document frame ever came up and registered its surface.
     *
     * `false` beside a non-zero `documentBytes` is spec 13 §1's own bug stated
     * in one line: main rendered the document and the frame never appeared.
     */
    surfaceReady: boolean;
    /** Children of the frame's `<body>`, or `null` when it cannot be reached. */
    frameChildren: number | null;
    /** The document pane's size on screen. A width near zero is the bug above. */
    frameWidth: number | null;
    frameHeight: number | null;
  } | null;
  centre: "document" | "graph";
  sidebarTab: string;
  /** 1 is 100%. */
  zoom: number;
  threads: number;
  /** Spec 14 — groups in this workspace, at every depth. */
  groups: number;
  unanswered: number;
  activeThreadId: string | null;
  traceOpen: boolean;
  /** Rows in the selection panel — a comment being built. */
  selectionItems: number;
  /** The notice bar's text, which is where a failed command already shows up. */
  notice: string | null;
}
