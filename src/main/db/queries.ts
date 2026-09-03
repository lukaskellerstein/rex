// Typed query functions over §9's schema. Every SQL statement in REX lives
// here; the services above it never see a row shape.

import { v4 as uuidv4 } from "uuid";
import type { ThreadListRequest } from "../../shared/channels.ts";
import { buildCommentTree, walkOrder } from "../../shared/commentTree.ts";
import { movedPath } from "../../shared/paths.ts";
import type {
  Anchor,
  AnchorState,
  AnchorTarget,
  ApplyRun,
  ApplyStatus,
  CommentCounts,
  DocumentRecord,
  DocumentRef,
  Message,
  MessageKind,
  MessageRole,
  Profile,
  SendMode,
  TargetDraft,
  Thread,
  ThreadKind,
  ThreadStatus,
} from "../../shared/types.ts";
import type { Db } from "./database.ts";
import { listGroups, nextThreadPosition } from "./groups.ts";

const now = (): string => new Date().toISOString();

// ── Row shapes ──────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  kind: "file";
  value: string;
  title: string | null;
  content_hash: string | null;
  last_seen_at: string;
}

/**
 * The columns still read. `anchor_json`, `extra_anchors_json` and `anchor_state`
 * are deliberately absent: spec 05 §5.2 retires them into `thread_target` and
 * leaves them in the table, and a row shape that still named them would be an
 * invitation to read one of them again.
 */
interface ThreadRow {
  id: string;
  document_id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  note: string;
  /** Spec 14 §3.1. NULL means "named by the note", which is not the same as unnamed. */
  title: string | null;
  /** Spec 14 §5. NULL is the top level. */
  group_id: string | null;
  /** Spec 14 §4.1. Rank among the comments sharing `group_id`. */
  position: number;
  /** Spec 30 §7.2 — RETIRED. The lane in `status` carries this now. */
  is_note: number;
  /** Spec 06 §5.4. NULL for every comment that was not drawn. */
  session_id: string | null;
  profile: Profile;
  /** Spec 31 §2.1 — the style this chat is having. NULL is the CLI's default. */
  style: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface TargetRow {
  document_id: string;
  anchor_json: string;
  anchor_state: AnchorState | null;
  /** Spec 24 §5.2. NULL for a place the comment was created with. */
  message_id: string | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  seq: number;
  role: MessageRole;
  kind: MessageKind;
  mode: SendMode | null;
  model: string | null;
  style: string | null;
  content: string | null;
  tool_name: string | null;
  tool_input_json: string | null;
  is_error: number;
  denied: number;
  cost_usd: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface ApplyRunRow {
  id: string;
  thread_id: string;
  status: ApplyStatus;
  diff: string | null;
  files_json: string | null;
  created_at: string;
  completed_at: string | null;
}

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    ref: { kind: row.kind, value: row.value },
    title: row.title,
    contentHash: row.content_hash,
    lastSeenAt: row.last_seen_at,
  };
}

function toThread(row: ThreadRow, refThreadIds: string[], targets: AnchorTarget[]): Thread {
  const thread: Thread = {
    id: row.id,
    documentId: row.document_id,
    kind: row.kind,
    status: row.status,
    targets,
    note: row.note,
    title: row.title,
    groupId: row.group_id,
    position: row.position,
    sessionId: row.session_id,
    profile: row.profile,
    style: row.style,
    refThreadIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
  return thread;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    seq: row.seq,
    role: row.role,
    kind: row.kind,
    mode: row.mode,
    model: row.model,
    style: row.style,
    content: row.content,
    toolName: row.tool_name,
    toolInput: row.tool_input_json ? JSON.parse(row.tool_input_json) : null,
    isError: row.is_error !== 0,
    // `?? 0` for the one shape SQLite can hand back that the type cannot say: a
    // row from a database the migration has not reached yet, where the column is
    // absent and the value is `undefined`. Written as `!== 0` alone that reads
    // as true, and EVERY message in the thread comes back denied — the exact
    // lie this column was added to end.
    denied: (row.denied ?? 0) !== 0,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
  };
}

function toApplyRun(row: ApplyRunRow): ApplyRun {
  return {
    id: row.id,
    threadId: row.thread_id,
    status: row.status,
    diff: row.diff,
    files: row.files_json ? (JSON.parse(row.files_json) as string[]) : [],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ── Documents ───────────────────────────────────────────────────

/**
 * Records the document and returns it together with the hash it had *before*
 * this open. §6.6 needs that comparison to tell `ok` from `moved`.
 */
export function upsertDocument(
  db: Db,
  ref: DocumentRef,
  title: string | null,
  contentHash: string | null,
): { record: DocumentRecord; previousHash: string | null } {
  const existing = db
    .prepare<[string, string], DocumentRow>("SELECT * FROM document WHERE kind = ? AND value = ?")
    .get(ref.kind, ref.value);

  const timestamp = now();
  if (existing) {
    db.prepare(
      "UPDATE document SET title = ?, content_hash = ?, last_seen_at = ? WHERE id = ?",
    ).run(title, contentHash, timestamp, existing.id);
    return {
      record: { ...toDocument(existing), title, contentHash, lastSeenAt: timestamp },
      previousHash: existing.content_hash,
    };
  }

  const id = uuidv4();
  db.prepare(
    "INSERT INTO document (id, kind, value, title, content_hash, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, ref.kind, ref.value, title, contentHash, timestamp);
  return {
    record: { id, ref, title, contentHash, lastSeenAt: timestamp },
    previousHash: null,
  };
}

/**
 * Spec 22 §3 step 2 — the row for a path, if REX has seen the file. Never
 * writes: `upsertDocument` overwrites the title, and a file adopted at the end
 * of a run has no title to offer, so asking first is what keeps the one it has.
 */
export function findDocument(db: Db, ref: DocumentRef): DocumentRecord | null {
  const row = db
    .prepare<[string, string], DocumentRow>("SELECT * FROM document WHERE kind = ? AND value = ?")
    .get(ref.kind, ref.value);
  return row ? toDocument(row) : null;
}

export function getDocument(db: Db, documentId: string): DocumentRecord | null {
  const row = db
    .prepare<[string], DocumentRow>("SELECT * FROM document WHERE id = ?")
    .get(documentId);
  return row ? toDocument(row) : null;
}

export function setDocumentHash(db: Db, documentId: string, contentHash: string | null): void {
  db.prepare("UPDATE document SET content_hash = ? WHERE id = ?").run(contentHash, documentId);
}

/**
 * Spec 23 §4.2 — the rows a rename would land on, whether or not a file is
 * there.
 *
 * `document` carries `UNIQUE (kind, value)`, so a row already at the target
 * name makes the update in §4.1 throw — after the disk rename has happened.
 * This is how that is found out first, and it is why the refusal can say how
 * many comments are in the way.
 *
 * Answers for the path itself and for everything under it, so a folder rename
 * is asked the same question as a file one.
 */
export function documentsUnder(db: Db, path: string): DocumentRecord[] {
  return db
    .prepare<[], DocumentRow>("SELECT * FROM document")
    .all()
    .filter((row) => row.value === path || row.value.startsWith(`${path}/`))
    .map(toDocument);
}

/**
 * Spec 23 §4.1 — the document rows follow the file.
 *
 * Every `thread`, `thread_target` and `message` comes with them for free: they
 * key on `document.id`, which a rename never changes. That is the whole reason
 * this is one UPDATE per row rather than a walk of the comments.
 *
 * Matched in TypeScript rather than with `LIKE`: a path can hold `%` and `_`,
 * which `LIKE` reads as wildcards, and the escape clause needed to stop it is a
 * trap for whoever changes this next. The table holds one row per document REX
 * has ever opened, so the scan is nothing.
 *
 * Returns how many rows moved.
 */
export function moveDocumentPaths(db: Db, from: string, to: string): number {
  const update = db.prepare("UPDATE document SET value = ? WHERE id = ?");
  let moved = 0;
  for (const document of documentsUnder(db, from)) {
    const next = movedPath(document.ref.value, from, to);
    if (next === null) continue;
    update.run(next, document.id);
    moved++;
  }
  return moved;
}

/**
 * Spec 23 §4.1 — an exclusion the reviewer wrote is about a file, not a name.
 *
 * Scoped to one root, because that is the table's key: the same folder opened
 * inside two workspaces carries two rules, and renaming it in one of them says
 * nothing about the other.
 */
export function moveWorkspaceRulePaths(db: Db, root: string, from: string, to: string): number {
  const rows = db
    .prepare<[string], { path: string }>("SELECT path FROM workspace_rule WHERE root = ?")
    .all(root);
  const update = db.prepare("UPDATE workspace_rule SET path = ? WHERE root = ? AND path = ?");
  let moved = 0;
  for (const row of rows) {
    const next = movedPath(row.path, from, to);
    if (next === null) continue;
    update.run(next, root, row.path);
    moved++;
  }
  return moved;
}

// ── Threads ─────────────────────────────────────────────────────

function refThreadIds(db: Db, threadId: string): string[] {
  return db
    .prepare<[string], { ref_thread_id: string }>(
      "SELECT ref_thread_id FROM thread_ref WHERE thread_id = ?",
    )
    .all(threadId)
    .map((r) => r.ref_thread_id);
}

/** Spec 05 §5.1 — every place a comment is about, in the order it was built. */
function targetsFor(db: Db, threadId: string): AnchorTarget[] {
  return db
    .prepare<[string], TargetRow>(
      "SELECT document_id, anchor_json, anchor_state, message_id FROM thread_target WHERE thread_id = ? ORDER BY position",
    )
    .all(threadId)
    .map(toTarget);
}

function toTarget(row: TargetRow): AnchorTarget {
  return {
    documentId: row.document_id,
    anchor: JSON.parse(row.anchor_json) as Anchor,
    state: row.anchor_state,
    messageId: row.message_id,
  };
}

/**
 * Spec 24 §4 — more places for a comment that already exists, after the ones
 * it has, each tagged with the user message that brought it.
 *
 * Positions continue from the last one rather than being renumbered: the
 * number is what the reviewer saw on the chip and on the outline, what the
 * prompt names, and what `anchor:restate` addresses. `anchor_state` is NULL
 * for the reason `createThread` gives — nobody has looked yet. One
 * transaction, so a comment never half-grows.
 *
 * Returns the whole list as it now stands, in position order.
 */
export function appendTargets(
  db: Db,
  threadId: string,
  messageId: string,
  targets: readonly TargetDraft[],
): AnchorTarget[] {
  if (targets.length === 0) return targetsFor(db, threadId);

  const append = db.transaction(() => {
    const last = db
      .prepare<[string], { last: number | null }>(
        "SELECT MAX(position) AS last FROM thread_target WHERE thread_id = ?",
      )
      .get(threadId);
    let position = (last?.last ?? -1) + 1;

    const insert = db.prepare(
      `INSERT INTO thread_target (thread_id, position, document_id, anchor_json, anchor_state, message_id)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    for (const entry of targets) {
      insert.run(threadId, position, entry.documentId, JSON.stringify(entry.anchor), messageId);
      position += 1;
    }
    db.prepare("UPDATE thread SET updated_at = ? WHERE id = ?").run(now(), threadId);
  });
  append();

  return targetsFor(db, threadId);
}

function hydrate(db: Db, row: ThreadRow): Thread {
  return toThread(row, refThreadIds(db, row.id), targetsFor(db, row.id));
}

export function createThread(
  db: Db,
  input: {
    kind: ThreadKind;
    /** Panel order. `targets[0]` decides the thread's own document. */
    targets: readonly TargetDraft[];
    /** Only for a synthesis thread, which has no targets to take it from. */
    documentId?: string;
    note: string;
    profile: Profile;
    refThreadIds?: string[];
    /**
     * Spec 30 §2 — the lane it is born in. Defaults to `open`, which is every
     * comment that is created and then sent in one gesture.
     *
     * `draft` is a comment the reviewer walked away from (§3.2) and `note` one
     * they chose to send to nobody. Both replace the `isNote` flag this argument
     * used to be.
     */
    status?: ThreadStatus;
    /**
     * Spec 30 §3.6 — the name typed in the composer. Null, and absent, both
     * mean "named by the note" (spec 14 §3.1), which is what every comment made
     * before the composer had a name box was.
     */
    title?: string | null;
  },
): Thread {
  const documentId = input.targets[0]?.documentId ?? input.documentId;
  if (!documentId) {
    throw new Error("A comment needs at least one target, or a document of its own.");
  }

  const id = uuidv4();
  const timestamp = now();
  // Spec 14 §4.1 — a new comment lands at the end of the top level, which is
  // where `ORDER BY created_at` used to put it. Nothing about making a comment
  // changed; only where the list keeps it is now written down.
  const position = nextThreadPosition(db, null);

  const status: ThreadStatus = input.status ?? "open";
  // Spec 14 §3.1 — an empty name is not a name. NULL is "named by the note",
  // and writing "" instead would give the comment a blank headline everywhere.
  const title = input.title?.trim() ? input.title.trim() : null;

  const insert = db.transaction(() => {
    db.prepare(
      // `model` and `is_note` are not named: spec 25 §4.3 retired the first and
      // spec 30 §7.2 the second. Both are nullable or defaulted, so a row simply
      // does not carry them any more.
      `INSERT INTO thread (id, document_id, kind, status, note, title, group_id, position,
                           session_id, profile, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL)`,
    ).run(
      id,
      documentId,
      input.kind,
      status,
      input.note,
      title,
      position,
      input.profile,
      timestamp,
      timestamp,
    );

    const target = db.prepare(
      `INSERT INTO thread_target (thread_id, position, document_id, anchor_json, anchor_state)
       VALUES (?, ?, ?, ?, NULL)`,
    );
    // NULL, not 'ok'. Spec 05 §5.4 — a state is what the *last sweep* found, and
    // no sweep has run yet. The one that runs immediately after this fills in
    // every target in the open document; the rest stay "nobody looked", which is
    // the truth until their own document is opened.
    for (const [position, entry] of input.targets.entries()) {
      target.run(id, position, entry.documentId, JSON.stringify(entry.anchor));
    }

    for (const ref of input.refThreadIds ?? []) {
      db.prepare("INSERT INTO thread_ref (thread_id, ref_thread_id) VALUES (?, ?)").run(id, ref);
    }
  });
  insert();

  return {
    id,
    documentId,
    kind: input.kind,
    status,
    // Spec 24 §5.1 — `messageId` is null for every place a comment starts with.
    targets: input.targets.map((entry) => ({ ...entry, state: null, messageId: null })),
    note: input.note,
    title,
    groupId: null,
    position,
    sessionId: null,
    profile: input.profile,
    // Spec 31 §7.3 — a new comment starts on the CLI's own default. The first
    // send writes whatever the composer was set to (§4.1).
    style: null,
    refThreadIds: input.refThreadIds ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
  };
}

export function getThread(db: Db, threadId: string): Thread | null {
  const row = db.prepare<[string], ThreadRow>("SELECT * FROM thread WHERE id = ?").get(threadId);
  return row ? hydrate(db, row) : null;
}

/**
 * Spec 05 §5.3 — the comments a `ThreadListRequest` is asking about, as a CTE.
 *
 * A comment about two documents is one row, seen from either of them, which is
 * what a comment about two documents is. The scope is every document under
 * `root`, plus the open one by id — a URL document sits under no directory, and
 * without the id its comments would disappear from the list.
 *
 * `substr` rather than `LIKE`: a path containing `%` or `_` is legal on every
 * filesystem, and escaping them correctly is a trap this does not need to walk
 * into. The trailing separator is what stops `/docs` matching `/docs-old`.
 *
 * IT IS A CONSTANT BECAUSE TWO COMMANDS SHARE IT. `thread:list` draws this set
 * and `thread:delete-all` destroys it, and the second one is only safe while
 * the two cannot disagree. A copied CTE is how "delete all the comments" ends
 * up taking one the panel never showed.
 */
const SCOPE_CTE = `WITH scope AS (
     SELECT id FROM document
      WHERE id = :documentId
         OR (kind = 'file' AND :prefix IS NOT NULL
             AND substr(value, 1, :prefixLength) = :prefix)
   ),
   anchored AS (
     SELECT DISTINCT thread_id AS id FROM thread_target
      WHERE document_id IN (SELECT id FROM scope)
   ),
   included AS (
     SELECT id FROM anchored
     UNION
     -- Every synthesis comment that references one of them, and every
     -- comment with no targets that was written on a document in scope.
     -- A synthesis comment has nothing to anchor, so it can be found only
     -- through what it is about or where it was made.
     SELECT thread_id FROM thread_ref
      WHERE ref_thread_id IN (SELECT id FROM anchored)
     UNION
     SELECT t.id FROM thread t
      WHERE t.document_id IN (SELECT id FROM scope)
        AND NOT EXISTS (SELECT 1 FROM thread_target x WHERE x.thread_id = t.id)
   )`;

/** The three values `SCOPE_CTE` binds, from the request the panel sent. */
interface ScopeParams {
  documentId: string | null;
  prefix: string | null;
  prefixLength: number;
}

function scopeParams(request: ThreadListRequest): ScopeParams {
  const prefix = request.root === null ? null : withSeparator(request.root);
  return {
    documentId: request.documentId,
    prefix,
    prefixLength: prefix?.length ?? 0,
  };
}

/** Spec 05 §5.3 — every comment in the workspace, not one document's. */
export function listThreads(db: Db, request: ThreadListRequest): Thread[] {
  const rows = db
    .prepare<ScopeParams, ThreadRow>(
      `${SCOPE_CTE}
       SELECT * FROM thread WHERE id IN (SELECT id FROM included) ORDER BY position, created_at`,
    )
    .all(scopeParams(request));

  const threads = rows.map((row) => hydrate(db, row));

  // Spec 14 §4.4 — the walk order is main's, not the panel's. The gutter's
  // numbered markers, the card's token and `rex export`'s headings are all
  // `index + 1` over this array, so a panel that sorted its own copy would put
  // `4` on a row whose marker in the margin says `7`.
  const groups = request.root === null ? [] : listGroups(db, request.root);
  return walkOrder(buildCommentTree(groups, threads));
}

/**
 * Every comment with a target in one document — what `rex export` asks for.
 *
 * Plus its synthesis comments, which have no targets to be found by: they are
 * about other comments, and they belong to the document they were written on.
 */
export function listThreadsInDocument(db: Db, documentId: string): Thread[] {
  return db
    .prepare<[string, string], ThreadRow>(
      `SELECT * FROM thread
        WHERE id IN (SELECT thread_id FROM thread_target WHERE document_id = ?)
           OR (document_id = ?
               AND NOT EXISTS (SELECT 1 FROM thread_target x WHERE x.thread_id = thread.id))
        ORDER BY created_at`,
    )
    .all(documentId, documentId)
    .map((row) => hydrate(db, row));
}

function withSeparator(root: string): string {
  return root.endsWith("/") ? root : `${root}/`;
}

/**
 * Spec 14 §3.1 — the name the reviewer typed, or null to go back to the note.
 *
 * An empty string is stored as NULL rather than as `''`. "Delete the name" and
 * "go back to the note" are the same wish, and a `''` in the column would make
 * `commentName` fall back correctly while every `title IS NOT NULL` test in the
 * future got the wrong answer.
 */
export function renameThread(db: Db, threadId: string, title: string | null): void {
  const trimmed = title?.trim();
  db.prepare("UPDATE thread SET title = ?, updated_at = ? WHERE id = ?").run(
    trimmed ? trimmed : null,
    now(),
    threadId,
  );
}

/**
 * Spec 30 §2.2 — the comment has been sent, so it leaves the unsent lanes.
 *
 * Called on every path that reaches an agent — ASK, ACT and the synthesis
 * fan-out. Idempotent, and a no-op for a comment that was already `open` or
 * `resolved`. It was `clearNoteFlag` and cleared `is_note`; the flag is a lane
 * now, so clearing it is a move.
 *
 * **`resolved` is never touched**, which is why the WHERE names the two lanes
 * rather than testing for "not open". Spec 18 §2 — resolved is terminal, and
 * replying to a resolved comment must not quietly reopen it.
 */
export function markThreadSent(db: Db, threadId: string): void {
  db.prepare(
    "UPDATE thread SET status = 'open', updated_at = ? WHERE id = ? AND status IN ('draft','note')",
  ).run(now(), threadId);
}

/**
 * Spec 30 §2.2 — **Save**: the comment is written down and sent to nobody.
 *
 * Only from `draft`. An `open` comment that gets a NOTE message keeps its lane —
 * spec 24 §4.3 lets a reviewer note something on a comment that already has an
 * answer, and that comment has still been sent.
 */
export function markThreadNoted(db: Db, threadId: string): void {
  db.prepare(
    "UPDATE thread SET status = 'note', updated_at = ? WHERE id = ? AND status = 'draft'",
  ).run(now(), threadId);
}

/**
 * Spec 30 §3.5 — **Turn into a comment**: a note becomes a draft.
 *
 * Only from `note`, so the button cannot be replayed onto a comment that has
 * already been sent. Returns whether it moved one.
 */
export function markThreadDraft(db: Db, threadId: string): boolean {
  const done = db
    .prepare("UPDATE thread SET status = 'draft', updated_at = ? WHERE id = ? AND status = 'note'")
    .run(now(), threadId);
  return done.changes > 0;
}

/**
 * Spec 30 §3.2 — a draft's places and its question, replaced wholesale.
 *
 * **Only a draft, and the guard is the point.** Spec 24 §5.2 gave every place a
 * `message_id` naming the user message that added it; a draft has no messages,
 * so all of its places carry NULL and nothing points at them. On a comment that
 * has been sent, deleting the rows would cut a message loose from the places it
 * was about — so this refuses rather than checking whether it happens to be
 * safe this time.
 *
 * The whole thing is one transaction: a draft that lost its places and did not
 * get the new ones would be a comment about nothing, which §2.4 says cannot
 * exist.
 */
export function saveDraft(
  db: Db,
  threadId: string,
  targets: readonly TargetDraft[],
  note: string,
  /** The lane it lands in. `draft` — the default — is what pressing back does. */
  status: ThreadStatus = "draft",
  /** Spec 30 §3.6 — the name from the composer. Null is "named by the note". */
  title: string | null = null,
): void {
  const row = db
    .prepare<[string], { status: ThreadStatus }>("SELECT status FROM thread WHERE id = ?")
    .get(threadId);
  if (!row) throw new Error(`No such thread: ${threadId}`);
  if (row.status !== "draft") throw new Error("Only a draft's places can be replaced.");
  if (targets.length === 0) throw new Error("A comment needs at least one place.");

  const write = db.transaction(() => {
    db.prepare("DELETE FROM thread_target WHERE thread_id = ?").run(threadId);
    const target = db.prepare(
      `INSERT INTO thread_target (thread_id, position, document_id, anchor_json, anchor_state)
       VALUES (?, ?, ?, ?, NULL)`,
    );
    // NULL state, for spec 05 §5.4's reason: a state is what the last sweep
    // found, and these places have not been swept since they moved.
    for (const [position, entry] of targets.entries()) {
      target.run(threadId, position, entry.documentId, JSON.stringify(entry.anchor));
    }
    // `targets[0]` decides the thread's own document, exactly as it does at
    // creation — a draft whose only place moved to another file belongs to that
    // file now.
    db.prepare(
      "UPDATE thread SET document_id = ?, note = ?, title = ?, status = ?, updated_at = ? WHERE id = ?",
    ).run(
      targets[0]?.documentId,
      note,
      // Spec 14 §3.1 — an empty name is not a name, it is NULL.
      title?.trim() ? title.trim() : null,
      status,
      now(),
      threadId,
    );
  });
  write();
}

export function setThreadStatus(db: Db, threadId: string, resolved: boolean): void {
  const timestamp = now();
  db.prepare("UPDATE thread SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(
    resolved ? "resolved" : "open",
    resolved ? timestamp : null,
    timestamp,
    threadId,
  );
}

/**
 * Remove a comment and everything that belonged to it.
 *
 * One statement is the whole implementation: §9's schema declares `ON DELETE
 * CASCADE` from `thread` on every table that references it — `message`,
 * `thread_target`, `thread_ref` and `apply_run` — and
 * `database.ts` sets `foreign_keys = ON` per connection, which is what makes
 * those declarations act rather than merely document. Deleting the rows by hand
 * here would be a second, quieter definition of what a thread is made of, and
 * the two would drift the first time a table is added.
 *
 * `thread_ref` cascades from BOTH sides, so deleting a comment that a synthesis
 * refers to withdraws it from that synthesis rather than orphaning the row.
 */
export function deleteThread(db: Db, threadId: string): void {
  db.prepare("DELETE FROM thread WHERE id = ?").run(threadId);
}

/**
 * Every comment `listThreads` would return, gone, and how many that was.
 *
 * One statement rather than a loop over ids: the set is decided and destroyed
 * inside the same statement, so a comment created while this runs is either
 * wholly in it or wholly outside it. §9's cascades take the messages, the
 * targets and the references with each row.
 *
 * GROUPS SURVIVE, and that is the point of doing it here rather than dropping
 * the rows by root. A folder is the reviewer's own arrangement, not a comment;
 * `group:delete` never destroys a comment, and this is the same rule read the
 * other way round. The folders are left empty for them to remove or refill.
 */
export function deleteThreadsInScope(db: Db, request: ThreadListRequest): number {
  const result = db
    .prepare<ScopeParams>(`${SCOPE_CTE} DELETE FROM thread WHERE id IN (SELECT id FROM included)`)
    .run(scopeParams(request));
  return result.changes;
}

/**
 * Spec 31 §4.1 — the chat remembers what it was last sent under.
 *
 * Written on every send and read only when the composer is painted. It is
 * deliberately NOT what the run reads: spec 25 §4.3's rule holds, and a field
 * read at run time is mutable state no send owns.
 *
 * `updated_at` is left alone. A style is not a change to the comment — nothing
 * about the review moved — and touching it would reorder a list that sorts by
 * it and make a comment look edited when it was not.
 */
export function setThreadStyle(db: Db, threadId: string, style: string | null): void {
  db.prepare("UPDATE thread SET style = ? WHERE id = ?").run(style, threadId);
}

export function setThreadSession(db: Db, threadId: string, sessionId: string): void {
  db.prepare("UPDATE thread SET session_id = ?, updated_at = ? WHERE id = ?").run(
    sessionId,
    now(),
    threadId,
  );
}

/**
 * Spec 05 §5.4 — one target's state, named by its position.
 *
 * Only the renderer can compute it (invariant I1) and only for the document that
 * is open, so this is deliberately per target rather than per thread: writing a
 * thread-wide state here would overwrite what another document's sweep found.
 */
export function setTargetState(
  db: Db,
  threadId: string,
  position: number,
  state: AnchorState,
): void {
  db.prepare("UPDATE thread_target SET anchor_state = ? WHERE thread_id = ? AND position = ?").run(
    state,
    threadId,
    position,
  );
  db.prepare("UPDATE thread SET updated_at = ? WHERE id = ?").run(now(), threadId);
}

// ── Messages ────────────────────────────────────────────────────

/**
 * `mode` is optional here and required on `Message`, which is deliberate.
 *
 * Only a reviewer's own send has one, and almost every draft in the codebase is
 * an answer, a tool call or a notice from REX. Making it optional keeps those
 * sites saying nothing rather than each writing `mode: null` to mean "not
 * mine".
 *
 * Spec 25 §5 — `model` is optional for a different reason. Every draft a run
 * produces has one, but no draft site knows it: the runner emits blocks and the
 * model is the send's, so the one place that knows stamps them all on the way
 * past (`ipc.ts`, `record`). A site that leaves it out is saying "not mine to
 * fill in", and a NOTE is the one send where that is the final answer.
 */
export type MessageDraft = Omit<
  Message,
  "id" | "threadId" | "seq" | "createdAt" | "mode" | "model" | "style" | "denied"
> & {
  mode?: SendMode | null;
  model?: string | null;
  /** Spec 31 §5 — optional for `model`'s reason: one site knows it, none else. */
  style?: string | null;
  /**
   * Optional for the reason `mode` is: one site knows it and the rest do not.
   * The gate is the only thing that can refuse a call, so the runner is the only
   * draft site that ever sets this, and every other one leaving it out is
   * saying "nothing refused this" — which is the truth for a diff, a note, an
   * answer and a tool that simply ran.
   */
  denied?: boolean;
};

/**
 * Appends one row. §9: one row per message, never a JSON blob per thread —
 * the database is the record of the conversation (§8.1), written as the
 * stream arrives rather than at the end.
 */
export function appendMessage(db: Db, threadId: string, draft: MessageDraft): Message {
  const id = uuidv4();
  const createdAt = now();
  const seqRow = db
    .prepare<[string], { next: number }>(
      "SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM message WHERE thread_id = ?",
    )
    .get(threadId);
  const seq = seqRow?.next ?? 0;

  db.prepare(
    `INSERT INTO message (id, thread_id, seq, role, kind, mode, model, style, content, tool_name,
                          tool_input_json, is_error, denied, cost_usd, duration_ms, input_tokens,
                          output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    threadId,
    seq,
    draft.role,
    draft.kind,
    draft.mode ?? null,
    draft.model ?? null,
    draft.style ?? null,
    draft.content,
    draft.toolName,
    draft.toolInput === null || draft.toolInput === undefined
      ? null
      : JSON.stringify(draft.toolInput),
    draft.isError ? 1 : 0,
    draft.denied ? 1 : 0,
    draft.costUsd,
    draft.durationMs,
    draft.inputTokens,
    draft.outputTokens,
    createdAt,
  );

  // `mode`, `model` and `denied` are normalised rather than spread: the draft
  // may leave any of them out, and what went into the row was null or 0, so what
  // comes back has to say the same.
  return {
    ...draft,
    mode: draft.mode ?? null,
    model: draft.model ?? null,
    style: draft.style ?? null,
    denied: draft.denied ?? false,
    id,
    threadId,
    seq,
    createdAt,
  };
}

export function listMessages(db: Db, threadId: string): Message[] {
  return db
    .prepare<[string], MessageRow>("SELECT * FROM message WHERE thread_id = ? ORDER BY seq")
    .all(threadId)
    .map(toMessage);
}

/**
 * Spec 02 §4.3 — comment counts per document, keyed by absolute path.
 *
 * One grouped query for the whole workspace rather than one per file: the
 * explorer asks for this on every tree scan, and a per-file query would make
 * the tree's cost scale with the repository rather than with the comments.
 *
 * A document absent from the map has never been opened in REX, which the tree
 * shows differently from a document with zero comments.
 */
export function commentCountsByDocument(db: Db): Map<string, CommentCounts> {
  const rows = db
    .prepare<[], { value: string; open: number; resolved: number; orphaned: number }>(
      // Spec 05 §5.7 — a document mentioned by a comment written elsewhere is
      // not a document with no comments, so this counts *targets*' documents.
      //
      // The inner query collapses a thread's targets in one document to one row,
      // which is what keeps a comment with three targets in one file from
      // counting three times. NULL is absent from the CASE on purpose: MIN
      // ignores it, so "nobody looked" never becomes orphaned — written as
      // `!= 'ok'` it would have, which is the mistake §5.7 names.
      // Spec 18 §2 — the three are disjoint, and `resolved` is terminal. Written
      // as a bare `best = 2` the orphaned count also caught resolved comments,
      // so one comment was counted twice here and put in the `orphaned` lane by
      // the sidebar — the two surfaces disagreed about the same comment.
      //
      // Spec 32 §4 — TWO things here are the new rule, and both are needed or
      // the tree and the sidebar disagree about one comment again:
      //
      //   1. MIN, not MAX. `MAX(rank) = 2` is "some place is gone"; `MIN(rank)
      //      = 2` is "every place is gone", which is what gone now means.
      //   2. The verdict is over the WHOLE comment, so the subquery is not
      //      restricted to this document. Grouped per document, a comment with a
      //      dead place in `a.md` and a live one in `b.md` was gone for `a.md`
      //      and open for `b.md`. One comment gets one verdict, counted against
      //      every file it names.
      `SELECT value,
              SUM(CASE WHEN status = 'open' AND COALESCE(best, 0) < 2 THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN status = 'open' AND best = 2 THEN 1 ELSE 0 END) AS orphaned
         FROM (
           SELECT d.value AS value, t.id AS id, t.status AS status,
                  (SELECT MIN(CASE a.anchor_state
                                WHEN 'orphaned' THEN 2
                                WHEN 'moved' THEN 1
                                WHEN 'ok' THEN 0
                              END)
                     FROM thread_target a
                    WHERE a.thread_id = t.id) AS best
             FROM thread_target tt
             JOIN thread t ON t.id = tt.thread_id
             JOIN document d ON d.id = tt.document_id
            WHERE d.kind = 'file'
            GROUP BY d.value, t.id, t.status
           UNION ALL
           -- A synthesis comment is about other comments and has no target of
           -- its own, so the join above cannot see it. Counting it against the
           -- document it was written on is where it was counted before, and
           -- dropping it would quietly shrink every count that has one.
           SELECT d.value, t.id, t.status, NULL
             FROM thread t
             JOIN document d ON d.id = t.document_id
            WHERE d.kind = 'file'
              AND NOT EXISTS (SELECT 1 FROM thread_target x WHERE x.thread_id = t.id)
         )
        GROUP BY value`,
    )
    .all();

  return new Map(
    rows.map((row) => [
      row.value,
      { open: row.open, resolved: row.resolved, orphaned: row.orphaned },
    ]),
  );
}

// ── Workspace rules (spec 10 §3.2) ──────────────────────────────

/** What the reviewer has said about one path, when they have said anything. */
export type WorkspaceRuleMode = "exclude" | "include";

/** Every rule for one workspace, keyed by absolute path. Usually empty. */
export function workspaceRules(db: Db, root: string): Map<string, WorkspaceRuleMode> {
  const rows = db
    .prepare<[string], { path: string; mode: WorkspaceRuleMode }>(
      "SELECT path, mode FROM workspace_rule WHERE root = ?",
    )
    .all(root);
  return new Map(rows.map((row) => [row.path, row.mode]));
}

/**
 * Spec 10 §3.4 — the menu is a toggle *against the default*, not a setter.
 *
 * Excluding a path that carries an `include` rule deletes that rule rather than
 * writing an `exclude`, and including an excluded path deletes its `exclude`.
 * Both directions therefore return the path to whatever REX would have done on
 * its own, and the table only ever holds genuine departures from that — so
 * un-excluding `node_modules`, which was skipped by default anyway, leaves no
 * row behind claiming otherwise.
 *
 * Returns the mode now in force, or null when the path is back on the default.
 */
export function toggleWorkspaceRule(
  db: Db,
  root: string,
  path: string,
  wanted: WorkspaceRuleMode,
): WorkspaceRuleMode | null {
  const current = db
    .prepare<[string, string], { mode: WorkspaceRuleMode }>(
      "SELECT mode FROM workspace_rule WHERE root = ? AND path = ?",
    )
    .get(root, path)?.mode;

  if (current !== undefined && current !== wanted) {
    db.prepare("DELETE FROM workspace_rule WHERE root = ? AND path = ?").run(root, path);
    return null;
  }

  // `OR REPLACE` rather than `ON CONFLICT … DO UPDATE`: the upsert form names
  // SQLite's `excluded` pseudo-table, and a line reading `SET mode =
  // excluded.mode` in a file about excluding folders is a trap for whoever reads
  // it next. The row is the reviewer's latest decision either way.
  db.prepare(
    "INSERT OR REPLACE INTO workspace_rule (root, path, mode, created_at) VALUES (?, ?, ?, ?)",
  ).run(root, path, wanted, now());
  return wanted;
}

/** SPEC.md §8.8 point 3 — the running total behind the cost bar. */
export function documentCostUsd(db: Db, documentId: string): number {
  const row = db
    .prepare<[string], { total: number | null }>(
      `SELECT SUM(m.cost_usd) AS total FROM message m
       JOIN thread t ON t.id = m.thread_id
       WHERE t.document_id = ?`,
    )
    .get(documentId);
  return row?.total ?? 0;
}

// ── Apply runs ──────────────────────────────────────────────────

export function createApplyRun(db: Db, threadId: string): ApplyRun {
  const id = uuidv4();
  const createdAt = now();
  db.prepare(
    "INSERT INTO apply_run (id, thread_id, status, diff, files_json, created_at, completed_at) VALUES (?, ?, 'pending', NULL, NULL, ?, NULL)",
  ).run(id, threadId, createdAt);
  return { id, threadId, status: "pending", diff: null, files: [], createdAt, completedAt: null };
}

export function getApplyRun(db: Db, applyRunId: string): ApplyRun | null {
  const row = db
    .prepare<[string], ApplyRunRow>("SELECT * FROM apply_run WHERE id = ?")
    .get(applyRunId);
  return row ? toApplyRun(row) : null;
}

export function setApplyRunDiff(db: Db, applyRunId: string, diff: string, files: string[]): void {
  db.prepare("UPDATE apply_run SET diff = ?, files_json = ? WHERE id = ?").run(
    diff,
    JSON.stringify(files),
    applyRunId,
  );
}

export function completeApplyRun(db: Db, applyRunId: string, status: ApplyStatus): void {
  db.prepare("UPDATE apply_run SET status = ?, completed_at = ? WHERE id = ?").run(
    status,
    now(),
    applyRunId,
  );
}
