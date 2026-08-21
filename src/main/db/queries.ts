// Typed query functions over §9's schema. Every SQL statement in REX lives
// here; the services above it never see a row shape.

import { v4 as uuidv4 } from "uuid";
import type { ThreadListRequest } from "../../shared/channels.ts";
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
  StrokeRef,
  Thread,
  ThreadKind,
} from "../../shared/types.ts";
import type { Db } from "./database.ts";

const now = (): string => new Date().toISOString();

// ── Row shapes ──────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  kind: "file" | "url";
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
  status: "open" | "resolved";
  note: string;
  /** Spec 06 §5.4. NULL for every comment that was not drawn. */
  stroke_json: string | null;
  session_id: string | null;
  profile: Profile;
  model: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface TargetRow {
  document_id: string;
  anchor_json: string;
  anchor_state: AnchorState | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  seq: number;
  role: MessageRole;
  kind: MessageKind;
  content: string | null;
  tool_name: string | null;
  tool_input_json: string | null;
  is_error: number;
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
    ref: { kind: row.kind, value: row.value } as DocumentRef,
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
    sessionId: row.session_id,
    profile: row.profile,
    model: row.model,
    refThreadIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
  // Spec 06 §5.4 — absent, not null, for a comment that was not drawn: the
  // field is optional and every consumer tests it for presence.
  const stroke = parseStroke(row.stroke_json);
  if (stroke) thread.stroke = stroke;
  return thread;
}

/**
 * A stroke that will not parse is a row this must not throw on — the
 * alternative is an app that refuses to open a comment because its ink is
 * malformed. The comment and its targets are what carry the meaning; the ink is
 * a record of a gesture, and losing it is survivable.
 */
function parseStroke(json: string | null): StrokeRef | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as StrokeRef;
  } catch {
    return null;
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    seq: row.seq,
    role: row.role,
    kind: row.kind,
    content: row.content,
    toolName: row.tool_name,
    toolInput: row.tool_input_json ? JSON.parse(row.tool_input_json) : null,
    isError: row.is_error !== 0,
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

export function getDocument(db: Db, documentId: string): DocumentRecord | null {
  const row = db
    .prepare<[string], DocumentRow>("SELECT * FROM document WHERE id = ?")
    .get(documentId);
  return row ? toDocument(row) : null;
}

export function setDocumentHash(db: Db, documentId: string, contentHash: string | null): void {
  db.prepare("UPDATE document SET content_hash = ? WHERE id = ?").run(contentHash, documentId);
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
      "SELECT document_id, anchor_json, anchor_state FROM thread_target WHERE thread_id = ? ORDER BY position",
    )
    .all(threadId)
    .map((row) => ({
      documentId: row.document_id,
      anchor: JSON.parse(row.anchor_json) as Anchor,
      state: row.anchor_state,
    }));
}

function hydrate(db: Db, row: ThreadRow): Thread {
  return toThread(row, refThreadIds(db, row.id), targetsFor(db, row.id));
}

export function createThread(
  db: Db,
  input: {
    kind: ThreadKind;
    /** Panel order. `targets[0]` decides the thread's own document. */
    targets: Array<{ documentId: string; anchor: Anchor }>;
    /** Only for a synthesis thread, which has no targets to take it from. */
    documentId?: string;
    note: string;
    profile: Profile;
    refThreadIds?: string[];
    /** Spec 06 §5.4 — the ink, when the places were circled rather than clicked. */
    stroke?: StrokeRef;
  },
): Thread {
  const documentId = input.targets[0]?.documentId ?? input.documentId;
  if (!documentId) {
    throw new Error("A comment needs at least one target, or a document of its own.");
  }

  const id = uuidv4();
  const timestamp = now();

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO thread (id, document_id, kind, status, note, stroke_json,
                           session_id, profile, model, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, 'open', ?, ?, NULL, ?, NULL, ?, ?, NULL)`,
    ).run(
      id,
      documentId,
      input.kind,
      input.note,
      input.stroke ? JSON.stringify(input.stroke) : null,
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
    status: "open",
    targets: input.targets.map((entry) => ({ ...entry, state: null })),
    note: input.note,
    sessionId: null,
    profile: input.profile,
    model: null,
    refThreadIds: input.refThreadIds ?? [],
    ...(input.stroke ? { stroke: input.stroke } : {}),
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
 * Spec 05 §5.3 — every comment in the workspace, not one document's.
 *
 * A comment about two documents is one row, seen from either of them, which is
 * what a comment about two documents is. The scope is every document under
 * `root`, plus the open one by id — a URL document sits under no directory, and
 * without the id its comments would disappear from the list.
 *
 * `substr` rather than `LIKE`: a path containing `%` or `_` is legal on every
 * filesystem, and escaping them correctly is a trap this does not need to walk
 * into. The trailing separator is what stops `/docs` matching `/docs-old`.
 */
export function listThreads(db: Db, request: ThreadListRequest): Thread[] {
  const prefix = request.root === null ? null : withSeparator(request.root);

  const rows = db
    .prepare<
      { documentId: string | null; prefix: string | null; prefixLength: number },
      ThreadRow
    >(`WITH scope AS (
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
         )
         SELECT * FROM thread WHERE id IN (SELECT id FROM included) ORDER BY created_at`)
    .all({
      documentId: request.documentId,
      prefix,
      prefixLength: prefix?.length ?? 0,
    });

  return rows.map((row) => hydrate(db, row));
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

export function setThreadStatus(db: Db, threadId: string, resolved: boolean): void {
  const timestamp = now();
  db.prepare("UPDATE thread SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(
    resolved ? "resolved" : "open",
    resolved ? timestamp : null,
    timestamp,
    threadId,
  );
}

export function setThreadSession(db: Db, threadId: string, sessionId: string): void {
  db.prepare("UPDATE thread SET session_id = ?, updated_at = ? WHERE id = ?").run(
    sessionId,
    now(),
    threadId,
  );
}

export function setThreadModel(db: Db, threadId: string, model: string | null): void {
  db.prepare("UPDATE thread SET model = ?, updated_at = ? WHERE id = ?").run(
    model,
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

export type MessageDraft = Omit<Message, "id" | "threadId" | "seq" | "createdAt">;

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
    `INSERT INTO message (id, thread_id, seq, role, kind, content, tool_name, tool_input_json,
                          is_error, cost_usd, duration_ms, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    threadId,
    seq,
    draft.role,
    draft.kind,
    draft.content,
    draft.toolName,
    draft.toolInput === null || draft.toolInput === undefined
      ? null
      : JSON.stringify(draft.toolInput),
    draft.isError ? 1 : 0,
    draft.costUsd,
    draft.durationMs,
    draft.inputTokens,
    draft.outputTokens,
    createdAt,
  );

  return { ...draft, id, threadId, seq, createdAt };
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
      // The inner query collapses a thread's targets in one document to one row
      // carrying their worst state, which is what keeps a comment with three
      // targets in one file from counting three times. NULL is absent from the
      // CASE on purpose: MAX ignores it, so "nobody looked" never becomes
      // orphaned — written as `!= 'ok'` it would have, which is the mistake §5.7
      // names.
      `SELECT value,
              SUM(CASE WHEN status = 'open' AND COALESCE(worst, 0) < 2 THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN worst = 2 THEN 1 ELSE 0 END) AS orphaned
         FROM (
           SELECT d.value AS value, t.id AS id, t.status AS status,
                  MAX(CASE tt.anchor_state
                        WHEN 'orphaned' THEN 2
                        WHEN 'moved' THEN 1
                        WHEN 'ok' THEN 0
                      END) AS worst
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
