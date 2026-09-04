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
   * The kind of element the ref names — `h2`, `li`, `table` — as a lowercase
   * tag name. Written since 2026-09-04; absent on every anchor made before,
   * and the resolver checks nothing when it is absent.
   *
   * It exists because the other two fields cannot say it. A stable id makes
   * the CSS path `#faq`, with no tag in it, and the quote of a whole block is
   * the same words whether they sit in a heading or in the table-of-contents
   * entry that points at the heading. Spec 16 §6.3's gap neighbour needs the
   * difference: `resolve.ts` `kindNamed()`.
   */
  tag?: string;
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

/**
 * Spec 16 §6.2 — one side of a gap: the block above it, or the block below.
 *
 * The same quote-and-element pair every other anchor already carries, so a
 * neighbour resolves through the layers `resolve.ts` already has rather than
 * through a mechanism of its own.
 */
export interface GapNeighbour {
  quote: TextQuote | null;
  element: ElementRef | null;
}

/**
 * Spec 16 §6.2 — a place BETWEEN two blocks, rather than one of them.
 *
 * A gap has no text, so it cannot be a quote, and no element, so it cannot be
 * an element ref. It is defined by **both** its neighbours, never one: a gap
 * identified only by "after paragraph 4" moves the moment paragraph 4 is
 * edited, and one identified only by a line number moves the moment anything
 * above it changes.
 */
export interface GapRef {
  /** The block above. Null at the top of the document. */
  after: GapNeighbour | null;
  /** The block below. Null at the end of the document. */
  before: GapNeighbour | null;
  /** Where the gap was in the source, when REX rendered the document (§5.3). */
  line: number | null;
}

/**
 * Spec 29 §4.3 — one part of a Mermaid diagram, named in its source.
 *
 * A node by its id, an edge by its two ends and its ordinal among the edges
 * between those two ends, a subgraph by its id, or a run of the fence's lines
 * the reviewer chose in the source pane. Nothing here is an SVG id: §1.2 of the
 * spec measured those changing between two renders of the same text.
 */
export type DiagramPart =
  | { kind: "node"; id: string }
  | { kind: "edge"; from: string; to: string; ordinal: number }
  | { kind: "subgraph"; id: string }
  /** 1-indexed inside the fence, inclusive. */
  | { kind: "lines"; from: number; to: number };

/**
 * Spec 29 §5.2 — where in a Mermaid fence a comment points.
 *
 * Read before the four layers, exactly as `region`, `extent` and `gap` are, and
 * for the same reason: the thing it names is not on the page as text. The page
 * holds a drawing; this names the text the drawing was made from.
 */
export interface DiagramRef {
  /** `flowchart`, `sequenceDiagram`, … — the first word of the source. */
  type: string;
  part: DiagramPart;
  /** The lines that state the part, 1-indexed inside the fence, inclusive. */
  lines: { from: number; to: number };
  /** Those lines, trimmed and joined with `\n` — the quote that finds the part when the fence moves. */
  text: string;
  /** FNV-1a of the whole fence's source, whitespace-normalised. Equal means untouched. */
  fingerprint: string;
}

/**
 * How much of a block's text an element anchor quotes.
 *
 * An element anchor quotes its opening text and not all of it — a long table
 * would otherwise store a copy of itself in the database on every comment. The
 * quote is a **key that finds the block**, never a statement of how much of it
 * the comment is about.
 *
 * It lives here rather than beside the creator because both sides of the anchor
 * contract need it: the renderer writes the cap, and main has to know that a
 * quote of exactly this length is an opening rather than a whole passage. It
 * told the agent otherwise until 2026-08-26 — a comment on an eight-paragraph
 * block arrived as 320 characters cut mid-word, with nothing saying more
 * existed.
 */
export const ELEMENT_QUOTE_MAX = 320;

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
  /**
   * Spec 16 §6.2 — set only by Add, and read before the four layers exactly as
   * `region` and `extent` are. It rides in the same JSON blob for the same
   * reason: an anchor written before today reads as `undefined`.
   */
  gap?: GapRef;
  /**
   * Spec 29 §5.2 — a part of a Mermaid diagram, read before everything else in
   * `resolveAnchor`. The same JSON blob, the same reason: an anchor written
   * before today reads as `undefined` and resolves exactly as it did.
   */
  diagram?: DiagramRef;
}

export type AnchorState = "ok" | "moved" | "orphaned";

// ── Threads and messages ────────────────────────────────────

export type ThreadKind = "anchored" | "synthesis";

/**
 * Spec 30 §2 — the five lanes a comment can be in, in the order it moves
 * through them.
 *
 * - `draft` — it has places, it has never been sent, and it is meant to be.
 * - `note` — the reviewer chose that no agent would ever see it. Spec 12 §2's
 *   NOTE mode, which was `thread.is_note` until spec 30 §7.2 made it a lane.
 * - `open` — sent. Waiting on the reviewer.
 * - `resolved` — dealt with, and **terminal**: spec 18 §2, nothing that happens
 *   to the document moves a comment out of it.
 *
 * The fifth lane, **gone**, is not a status. It is `draft`, `note` or `open`
 * with EVERY place orphaned (spec 32 §2), and it is computed from the two —
 * spec 18 §2 kept it off this type on purpose, because "the text is gone" is a
 * fact about the document and the other four are facts about the reviewer.
 */
export type ThreadStatus = "draft" | "note" | "open" | "resolved";

/** The lanes that have never been sent, so nothing has run and nothing was spent. */
export const UNSENT_STATUS: readonly ThreadStatus[] = ["draft", "note"];

export type Profile = "read" | "write";

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
  /**
   * Spec 24 §5.1 — the user message this place arrived with, or null for a
   * place the comment was created with.
   *
   * A comment can grow: a reply, a change or a note can carry new places (spec
   * 24 §4). This is what lets the `YOU` turn that brought them show them as
   * chips. Nothing else reads it.
   */
  messageId: string | null;
}

/**
 * Spec 24 §5.3 — a place as the renderer sends it: a document and an anchor,
 * before main has given it a position or a state.
 *
 * Shared by `thread:create` and by the three sends that can add places to an
 * existing comment, so the four cannot drift on what a place is made of.
 */
export interface TargetDraft {
  documentId: string;
  anchor: Anchor;
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
   * Spec 30 §7.2 — `isNote` is GONE, and it is not coming back as a second
   * fact. A comment the reviewer saved and never sent is `status: "note"`, and
   * one they have not finished is `status: "draft"`.
   *
   * The sentence that field carried is still the rule, and it is now §2.1's:
   * *"it is not 'has no answer yet' — an ASK that failed has no answer either,
   * and the two must not look alike."* That is exactly why `draft` and `note`
   * are two lanes and not one.
   */
  sessionId: string | null;
  profile: Profile;
  /**
   * Spec 25 §4.3 — the model is NOT here. It is an argument on each send,
   * because it is a property of a send and not of a comment. The `thread.model`
   * column is retired in place and read by nothing; the durable record is
   * `Message.model`.
   */
  /**
   * Spec 31 §2.1 — the output style IS here, and the contrast with the model
   * above is the whole point.
   *
   * A model is what one SEND is worth, and there is a safe value to fall back
   * to after a restart. A style is how this CHAT reads: it cannot be unsafe or
   * dear, it has no app-wide default to return to (§2.2), and the reviewer
   * asked for it to be *"remembered for the whole chat until I change my mind"*.
   * A chat outlives a restart; renderer state does not.
   *
   * Null is the CLI's own default, which is what every comment starts on and
   * what every run did before spec 31. The send still carries the style
   * explicitly — this is the memory the composer is painted from, never the
   * value main reads at run time (§2.1).
   */
  style: string | null;
  refThreadIds: string[]; // synthesis threads only
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type MessageRole = "user" | "assistant" | "system";

/**
 * Which mode the reviewer was in when they sent a message.
 *
 * Spec 12 §3.3 keeps the *current* mode in the renderer and refuses to persist
 * it, and that is still right: the mode a thread will send its NEXT message in
 * should reset to the safe one after a restart. This is a different fact. It is
 * what a message that has already been sent WAS, and it never changes again —
 * so a card reading its own transcript back can say `YOU NOTED` about a note
 * and `YOU ASKED TO ACT` about a change, instead of calling all three "asked".
 *
 * Null for every message that is not a reviewer send: an answer, a tool call, a
 * notice from REX — and for every user message written before this existed,
 * which is the honest value for "nobody recorded it".
 */
export type SendMode = "ask" | "act" | "note";

export type MessageKind =
  | "text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "diff"
  | "error"
  /**
   * Spec 17 §3.2 — the reviewer ended this run.
   *
   * A lifecycle marker like `completed`, and emphatically not an `error`: a
   * stop is something a person did on purpose. It answers the one question a
   * thread that ends mid-tool-call cannot otherwise answer a week later — did
   * this break, or did I stop it?
   */
  | "stopped"
  | "completed"
  /**
   * Spec 34 §6 — the reviewer approved, discarded or undid a change to this
   * thread's document while no agent was in the room.
   *
   * The fifth lifecycle kind, and like `stopped` it is a person's own act: a
   * fact about the conversation, recorded in it, so that an agent's transcript
   * says why the document it edited no longer holds what it wrote.
   */
  | "event";

export interface Message {
  id: string;
  threadId: string;
  seq: number;
  role: MessageRole;
  kind: MessageKind;
  /** Which mode the reviewer sent this in. Null unless they sent it. */
  mode: SendMode | null;
  /**
   * Spec 25 §5 — the model this row came from, as the reviewer picked it.
   *
   * Set on the reviewer's own send and on every message the run it started
   * produced, so an answer can say which model wrote it. Null for a NOTE, which
   * runs nothing, and for every row written before this column existed — which
   * is the honest value for "nobody recorded it", and must never be drawn as
   * "the default".
   *
   * The requested name, never the wire id the CLI resolves it to (§5.1): the
   * record has to map back to a display name a month later, and `default`
   * resolved to `claude-opus-5[1m]` would record a choice nobody made.
   */
  model: string | null;
  /**
   * Spec 31 §5 — the output style this row ran under, as the reviewer picked it.
   *
   * `message.model`'s neighbour and its twin in every way: set on the send and
   * on everything the run produced, null for a note and for every row written
   * before the column existed. It is recorded and not drawn — the answer's foot
   * has four items already, and "why did this one read like that" is a
   * debugging question, which is where it is answered.
   */
  style: string | null;
  content: string | null;
  toolName: string | null;
  toolInput: unknown | null;
  isError: boolean;
  /**
   * This call was refused rather than run — REX's gate (§8.4) in every case
   * REX makes, and the SDK's own permission layer in the one it does not.
   *
   * Separate from `isError` because the two are different facts and only one of
   * them is about permission. A `grep` that matches nothing exits 1; a `ls` of a
   * missing directory exits 1; neither is a refusal, and drawing them as one
   * says the safety gate fired when it did not. Every refusal sets both flags:
   * a refused call did not succeed either.
   *
   * False for every row written before the column existed EXCEPT the ones the
   * migration could prove, which are the ones whose thread carries the matching
   * `Denied …` note.
   */
  denied: boolean;
  costUsd: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

// ── What the agent can be asked for ─────────────────────────
// Spec 25 §6.3 and spec 31 §3. REX's own shapes, not the SDK's `ModelInfo`:
// `src/shared/` may not import from `main/` (spec 01 §3.1) and the SDK is
// main's dependency, so the three fields the renderer needs are restated here.
// The effort levels and fast-mode flags `ModelInfo` also carries never reach a
// renderer that has no use for them.

/** One row of the picker. `value` is the string `Options.model` takes. */
export interface ModelChoice {
  value: string;
  displayName: string;
  description: string;
}

/**
 * Spec 25 §3 and spec 31 §3.1 — what the CLI offers, from one probe.
 *
 * `chosen` is the app-wide default MODEL with spec 25 §6.2 already applied, so
 * the renderer never has to reason about a stored value that is no longer in
 * `models`. There is no `chosen` style: spec 31 §2.2 gives the style no
 * app-wide default, because the reviewer asked for it to belong to the chat.
 *
 * `styles` are bare names and not `ModelChoice`s, because that is all the CLI
 * has: `available_output_styles` is a list of strings. Inventing a description
 * for each would be REX writing documentation for somebody else's `.md` file.
 *
 * `error` is the sentence explaining a failed probe (spec 25 §3.4), or null.
 */
export interface AgentChoices {
  models: ModelChoice[];
  chosen: string;
  styles: string[];
  error: string | null;
}

/**
 * Spec 31 §4 — the two things a send chooses, carried as one.
 *
 * They travel together through every layer of main: the send records them, the
 * run is stamped with them, and each notice a run produces carries them. Spec
 * 25 threaded the model alone through five signatures; a second parameter
 * beside it in all five would have been the moment to notice they are one
 * thing. Null in either means "REX says nothing, so the CLI decides", which is
 * what every run did before the spec that added it.
 */
export interface SendChoices {
  model: string | null;
  style: string | null;
}

/** The SDK's own first row, and what "REX said nothing" resolves to. */
export const DEFAULT_MODEL = "default";

/**
 * Spec 31 §6 — the CLI's own default style, and what a comment starts on.
 *
 * The same double meaning `DEFAULT_MODEL` carries: REX records it, because the
 * reviewer picked it, and it MEANS "REX says nothing" — so the runner omits the
 * setting rather than sending the word.
 */
export const DEFAULT_STYLE = "default";

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
 * Spec 27 §4 — how REX draws the page it typeset itself.
 *
 * Two switches, both about the reader rather than the file: nothing here is
 * ever written to disk, and neither reaches a document whose styles are the
 * author's (§4.2 — Markdown only).
 *
 * One object rather than two booleans threaded separately, because they travel
 * together everywhere: one strip sets them, both panes read them, and one row
 * each in the `setting` table remembers them (§4.7).
 */
export interface PaperView {
  /** §4.3 — the text fills the pane instead of the 620px measure. */
  wide: boolean;
  /** §4.4 — the dark paper. Never `prefers-color-scheme`; only this flag. */
  dark: boolean;
}

/** §4.7 — narrow and light, until the reviewer says otherwise. */
export const PAPER_VIEW_DEFAULT: PaperView = { wide: false, dark: false };

// ── Find and search (spec 28) ────────────────────────────────

/** Spec 28 §5.5 — the words around a match, from `shared/find.ts`'s `contextOf`. */
export interface SearchContext {
  before: string;
  match: string;
  after: string;
  /** True when `before` does not reach the start of the text. */
  cutBefore: boolean;
  cutAfter: boolean;
}

/** One hit in one file. `ordinal` is its index among the file's matches. */
export interface SearchHit extends SearchContext {
  ordinal: number;
}

export interface SearchFileHits {
  path: string; // absolute
  /** The first `MAX_HITS_PER_FILE` of them, or fewer once the total cap bites. */
  hits: SearchHit[];
  /** Every match in the file, `hits` included. */
  total: number;
}

/** A file that was listed and not searched, and why (§4.2). */
export interface SearchSkipped {
  path: string;
  reason: string;
}

export interface WorkspaceSearchResult {
  /** The query as searched — normalised (§4.3). */
  query: string;
  /** Files with at least one match, in tree order. */
  files: SearchFileHits[];
  skipped: SearchSkipped[];
  /** Documents whose text was read. */
  searched: number;
  /** Every match in every searched file. */
  matches: number;
  /** True when some file's hit rows were cut by the total cap. */
  capped: boolean;
  /** Spec 02 §4.2 — the tree scan stopped early, so some files were not listed. */
  truncated: boolean;
}

/**
 * Spec 28 §4.1.1 — one match's place along the whole document, for the
 * overview ruler. Both are fractions of the document's height.
 */
export interface FindMark {
  top: number;
  height: number;
}

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
  /**
   * Spec 34 §5.2 — set while a run is pointed at this document, in the words
   * the reviewer sees. Approve, discard and undo refuse with it, and the three
   * buttons grey out with it as their title.
   */
  held: string | null;
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
