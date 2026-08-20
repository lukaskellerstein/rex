// Typed query functions over §9's schema. Every SQL statement in REX lives
// here; the services above it never see a row shape.

import { v4 as uuidv4 } from "uuid";
import type {
  Anchor,
  AnchorState,
  ApplyRun,
  ApplyStatus,
  CommentCounts,
  DocumentRecord,
  DocumentRef,
  Message,
  MessageKind,
  MessageRole,
  Profile,
  Thread,
  ThreadKind,
  ThreadWithMessages,
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

interface ThreadRow {
  id: string;
  document_id: string;
  kind: ThreadKind;
  status: "open" | "resolved";
  anchor_json: string | null;
  anchor_state: AnchorState | null;
  note: string;
  session_id: string | null;
  profile: Profile;
  model: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
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

function toThread(row: ThreadRow, refThreadIds: string[]): Thread {
  return {
    id: row.id,
    documentId: row.document_id,
    kind: row.kind,
    status: row.status,
    anchor: row.anchor_json ? (JSON.parse(row.anchor_json) as Anchor) : null,
    anchorState: row.anchor_state,
    note: row.note,
    sessionId: row.session_id,
    profile: row.profile,
    model: row.model,
    refThreadIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
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

export function createThread(
  db: Db,
  input: {
    documentId: string;
    kind: ThreadKind;
    anchor: Anchor | null;
    anchorState: AnchorState | null;
    note: string;
    profile: Profile;
    refThreadIds?: string[];
  },
): Thread {
  const id = uuidv4();
  const timestamp = now();

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO thread (id, document_id, kind, status, anchor_json, anchor_state, note,
                           session_id, profile, model, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, NULL, ?, NULL, ?, ?, NULL)`,
    ).run(
      id,
      input.documentId,
      input.kind,
      input.anchor ? JSON.stringify(input.anchor) : null,
      input.anchorState,
      input.note,
      input.profile,
      timestamp,
      timestamp,
    );
    for (const ref of input.refThreadIds ?? []) {
      db.prepare("INSERT INTO thread_ref (thread_id, ref_thread_id) VALUES (?, ?)").run(id, ref);
    }
  });
  insert();

  return {
    id,
    documentId: input.documentId,
    kind: input.kind,
    status: "open",
    anchor: input.anchor,
    anchorState: input.anchorState,
    note: input.note,
    sessionId: null,
    profile: input.profile,
    model: null,
    refThreadIds: input.refThreadIds ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
  };
}

export function getThread(db: Db, threadId: string): Thread | null {
  const row = db.prepare<[string], ThreadRow>("SELECT * FROM thread WHERE id = ?").get(threadId);
  return row ? toThread(row, refThreadIds(db, threadId)) : null;
}

export function listThreads(db: Db, documentId: string): ThreadWithMessages[] {
  const rows = db
    .prepare<[string], ThreadRow>("SELECT * FROM thread WHERE document_id = ? ORDER BY created_at")
    .all(documentId);
  return rows.map((row) => ({
    ...toThread(row, refThreadIds(db, row.id)),
    messages: listMessages(db, row.id),
  }));
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

export function setAnchorState(db: Db, threadId: string, state: AnchorState): void {
  db.prepare("UPDATE thread SET anchor_state = ?, updated_at = ? WHERE id = ?").run(
    state,
    now(),
    threadId,
  );
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
      `SELECT d.value AS value,
              SUM(CASE WHEN t.status = 'open'
                        AND COALESCE(t.anchor_state, '') != 'orphaned' THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN t.anchor_state = 'orphaned' THEN 1 ELSE 0 END) AS orphaned
         FROM document d
         JOIN thread t ON t.document_id = d.id
        WHERE d.kind = 'file'
        GROUP BY d.value`,
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
