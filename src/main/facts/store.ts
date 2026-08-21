// Spec 07 §6 — every read and write of the §6.3 and §6.4 tables.
//
// BOTH (§10.2): main reads through it to answer `facts:findings` and
// `facts:graph`; the `utilityProcess` writes through it. **No other file may
// issue a query against the fact tables or call `sqlite-vec`** — that is what
// makes §6.5's trigger cheap to act on, because swapping the engine later
// touches this file and nothing else.
//
// The one rule everything here follows is §6.1: the §6.3 tables are a CACHE and
// may be dropped at any time; the §6.4 tables are BOOKKEEPING and are never
// dropped. `dropGraph()` below is the only function that deletes in bulk, and it
// deliberately cannot touch the second group.

import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type {
  Anchor,
  ExtractedClaim,
  FactGraph,
  FactRunState,
  FactRunSummary,
  FactStage,
  Finding,
  FindingFilter,
} from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import { EMBEDDING_DIMENSIONS } from "./gateway.ts";

const now = (): string => new Date().toISOString();

// ── The vector tables (§6.3) ────────────────────────────────

/**
 * Created here rather than in `schema.sql`, because a `vec0` table cannot be
 * declared before `sqlite-vec` is loaded — and §6.1 requires REX to still open
 * documents on a machine where the extension will not load. Putting this DDL in
 * the file every startup executes would turn one unavailable feature into an
 * app that does not start.
 *
 * `distance_metric=cosine` is not a detail: §4.4's thresholds are cosine
 * similarities, and the default metric is L2. Verified on 2026-08-21 against
 * `sqlite-vec` v0.1.9 — with cosine, `similarity = 1 - distance` exactly, and a
 * vector's magnitude stops mattering.
 *
 * `workspace_root` is a partition key so that "the nearest existing subject"
 * (§4.4 step 2) means the nearest *in this workspace*. §13 rules out
 * cross-workspace fact graphs, and without the partition a second workspace's
 * subjects would silently become merge candidates for the first.
 *
 * §12 milestone 2 asks for the scan time to be measured and written down, since
 * `sqlite-vec` brute-forces rather than building an approximate index. On this
 * machine, 768 dimensions, cosine, median of 50 lookups:
 *
 *   1,000 vectors    0.54 ms
 *   10,000 vectors   5.9 ms
 *   68,000 vectors   47 ms      ← the §7.3 ceiling
 *
 * Linear in the row count, as a scan must be. At the ceiling, canonicalization's
 * ~60,000 subject lookups come to about 47 minutes — against §6.2's estimate of
 * "call it 30 minutes", and still noise inside a build whose extraction stage is
 * measured in days. §6.5 is the escape hatch if that ever stops being true, and
 * it is not a graph database.
 */
export function createVectorTables(db: Db): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_subject_vec USING vec0(
      subject_id     TEXT PRIMARY KEY,
      workspace_root TEXT partition key,
      embedding      FLOAT[${EMBEDDING_DIMENSIONS}] distance_metric=cosine
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_claim_vec USING vec0(
      claim_id   TEXT PRIMARY KEY,
      subject_id TEXT partition key,
      embedding  FLOAT[${EMBEDDING_DIMENSIONS}] distance_metric=cosine
    );
  `);
}

/** A vector as `sqlite-vec` stores it: little-endian float32, not JSON. */
function vectorBlob(vector: number[]): Buffer {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`);
  }
  return Buffer.from(new Float32Array(vector).buffer);
}

// ── Documents (§4.1, §6.4) ──────────────────────────────────

export interface DocumentSeen {
  path: string;
  contentHash: string;
  chunkCount: number;
  /** §4.7 — how many of its chunks are stored. Defaults to none. */
  chunksDone?: number;
}

export interface DocumentProgress {
  contentHash: string;
  /** §4.7 — chunks already stored. Below `chunkCount` means part-way through. */
  chunksDone: number;
  chunkCount: number;
}

/** Every document the pipeline has seen, what it hashed to, and how far it got. */
export function documentHashes(db: Db, root: string): Map<string, DocumentProgress> {
  const rows = db
    .prepare<
      [string],
      { path: string; content_hash: string; chunks_done: number; chunk_count: number }
    >(
      "SELECT path, content_hash, chunks_done, chunk_count FROM fact_document WHERE workspace_root = ?",
    )
    .all(root);
  return new Map(
    rows.map((row) => [
      row.path,
      { contentHash: row.content_hash, chunksDone: row.chunks_done, chunkCount: row.chunk_count },
    ]),
  );
}

/**
 * §4.7 — one document's chunks are stored; note how far it got.
 *
 * Written after every chunk, not only at the end, so a build killed in the
 * middle of a 44-chunk document resumes inside it rather than paying for the
 * whole thing again.
 */
export function setDocumentProgress(db: Db, root: string, path: string, chunksDone: number): void {
  db.prepare("UPDATE fact_document SET chunks_done = ? WHERE workspace_root = ? AND path = ?").run(
    chunksDone,
    root,
    path,
  );
}

/** When each document was last extracted — the cheap staleness check (§8.5). */
export function documentExtractedAt(db: Db, root: string): Map<string, number> {
  const rows = db
    .prepare<[string], { path: string; extracted_at: string }>(
      "SELECT path, extracted_at FROM fact_document WHERE workspace_root = ?",
    )
    .all(root);
  return new Map(rows.map((row) => [row.path, Date.parse(row.extracted_at)]));
}

export function recordDocument(db: Db, root: string, seen: DocumentSeen): void {
  db.prepare(
    `INSERT INTO fact_document
       (workspace_root, path, content_hash, extracted_at, chunk_count, chunks_done)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_root, path)
     DO UPDATE SET content_hash = excluded.content_hash,
                   extracted_at = excluded.extracted_at,
                   chunk_count  = excluded.chunk_count,
                   chunks_done  = excluded.chunks_done`,
  ).run(root, seen.path, seen.contentHash, now(), seen.chunkCount, seen.chunksDone ?? 0);
}

/**
 * §4.1 — drop one document's evidence, and any claim whose *last* evidence went
 * with it.
 *
 * The second half is the part that is easy to forget and impossible to see
 * afterwards: a claim with no evidence left is a claim the user cannot check,
 * which §11 rule 4 forbids showing. A subject with no claims goes the same way,
 * or the merge target list fills with subjects nothing points at.
 */
export function forgetDocument(db: Db, root: string, path: string): void {
  const clear = db.transaction(() => {
    db.prepare("DELETE FROM fact_evidence WHERE document_path = ?").run(path);
    db.prepare(
      `DELETE FROM fact_claim
        WHERE id IN (
          SELECT c.id FROM fact_claim c
            JOIN fact_subject s ON s.id = c.subject_id
           WHERE s.workspace_root = ?
             AND NOT EXISTS (SELECT 1 FROM fact_evidence e WHERE e.claim_id = c.id)
        )`,
    ).run(root);
    db.prepare(
      `DELETE FROM fact_subject
        WHERE workspace_root = ?
          AND NOT EXISTS (SELECT 1 FROM fact_claim c WHERE c.subject_id = fact_subject.id)`,
    ).run(root);
    db.prepare("DELETE FROM fact_document WHERE workspace_root = ? AND path = ?").run(root, path);
    // The vector rows are not reached by ON DELETE CASCADE: a vec0 table is
    // virtual and carries no foreign key. Left behind they would be matched as
    // merge candidates for subjects that no longer exist, so a claim would
    // silently join a deleted document's subject.
    db.exec(`
      DELETE FROM fact_subject_vec
       WHERE subject_id NOT IN (SELECT id FROM fact_subject);
      DELETE FROM fact_claim_vec
       WHERE claim_id NOT IN (SELECT id FROM fact_claim);
    `);
  });
  clear();
}

/**
 * §6.1 — the cache, and only the cache. A rebuild from nothing.
 *
 * `fact_verdict` and `fact_finding_thread` are untouched by design: they hold
 * what the user decided, and §11 rule 3 requires a dismissed finding to stay
 * dismissed across exactly this operation.
 */
export function dropGraph(db: Db, root: string): void {
  const drop = db.transaction(() => {
    db.prepare(
      `DELETE FROM fact_evidence
        WHERE claim_id IN (
          SELECT c.id FROM fact_claim c JOIN fact_subject s ON s.id = c.subject_id
           WHERE s.workspace_root = ?)`,
    ).run(root);
    db.prepare(
      `DELETE FROM fact_edge
        WHERE from_claim IN (
          SELECT c.id FROM fact_claim c JOIN fact_subject s ON s.id = c.subject_id
           WHERE s.workspace_root = ?)`,
    ).run(root);
    db.prepare(
      `DELETE FROM fact_claim
        WHERE subject_id IN (SELECT id FROM fact_subject WHERE workspace_root = ?)`,
    ).run(root);
    db.prepare(
      "DELETE FROM fact_co_occurrence WHERE subject_a IN (SELECT id FROM fact_subject WHERE workspace_root = ?)",
    ).run(root);
    db.prepare("DELETE FROM fact_subject WHERE workspace_root = ?").run(root);
    db.prepare("DELETE FROM fact_document WHERE workspace_root = ?").run(root);
    db.exec(`
      DELETE FROM fact_subject_vec WHERE subject_id NOT IN (SELECT id FROM fact_subject);
      DELETE FROM fact_claim_vec   WHERE claim_id   NOT IN (SELECT id FROM fact_claim);
    `);
  });
  drop();
}

// ── Runs (§4.7, §6.4) ───────────────────────────────────────

interface RunRow {
  id: string;
  workspace_root: string;
  started_at: string;
  finished_at: string | null;
  stage: FactStage;
  cursor: number;
  total: number;
  alias_extract: string;
  alias_judge: string;
  state: FactRunState;
  dropped_quotes: number;
  failed_chunks: number;
  subjects_merged: number;
  claims_merged: number;
}

function toSummary(row: RunRow): FactRunSummary {
  return {
    runId: row.id,
    root: row.workspace_root,
    state: row.state,
    stage: row.stage,
    done: row.cursor,
    total: row.total,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    aliasExtract: row.alias_extract,
    aliasJudge: row.alias_judge,
    droppedQuotes: row.dropped_quotes,
    failedChunks: row.failed_chunks,
    subjectsMerged: row.subjects_merged,
    claimsMerged: row.claims_merged,
  };
}

export function createRun(
  db: Db,
  input: { root: string; aliasExtract: string; aliasJudge: string },
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO fact_run (id, workspace_root, started_at, stage, cursor,
                           alias_extract, alias_judge, state)
     VALUES (?, ?, ?, 'scan', 0, ?, ?, 'running')`,
  ).run(id, input.root, now(), input.aliasExtract, input.aliasJudge);
  return id;
}

export function getRun(db: Db, runId: string): FactRunSummary | null {
  const row = db.prepare<[string], RunRow>("SELECT * FROM fact_run WHERE id = ?").get(runId);
  return row ? toSummary(row) : null;
}

/** The build the Facts tab attaches to: the newest for this workspace. §8.5 */
export function latestRun(db: Db, root: string): FactRunSummary | null {
  const row = db
    .prepare<[string], RunRow>(
      "SELECT * FROM fact_run WHERE workspace_root = ? ORDER BY started_at DESC LIMIT 1",
    )
    .get(root);
  return row ? toSummary(row) : null;
}

export function setRunProgress(
  db: Db,
  runId: string,
  stage: FactStage,
  cursor: number,
  total: number,
): void {
  db.prepare("UPDATE fact_run SET stage = ?, cursor = ?, total = ? WHERE id = ?").run(
    stage,
    cursor,
    total,
    runId,
  );
}

/** §7.4 — the counts a build must admit to. Added to, never overwritten. */
export function addRunCounts(
  db: Db,
  runId: string,
  counts: Partial<
    Record<"droppedQuotes" | "failedChunks" | "subjectsMerged" | "claimsMerged", number>
  >,
): void {
  db.prepare(
    `UPDATE fact_run
        SET dropped_quotes  = dropped_quotes  + ?,
            failed_chunks   = failed_chunks   + ?,
            subjects_merged = subjects_merged + ?,
            claims_merged   = claims_merged   + ?
      WHERE id = ?`,
  ).run(
    counts.droppedQuotes ?? 0,
    counts.failedChunks ?? 0,
    counts.subjectsMerged ?? 0,
    counts.claimsMerged ?? 0,
    runId,
  );
}

export function finishRun(db: Db, runId: string, state: FactRunState): void {
  db.prepare("UPDATE fact_run SET state = ?, finished_at = ? WHERE id = ?").run(
    state,
    state === "running" ? null : now(),
    runId,
  );
}

/**
 * §10.1 rule 3 — a build whose process died is `failed` with its cursor left
 * exactly where it was, so the tab offers Resume rather than losing the work.
 *
 * Also run at startup: a row still marked `running` when no build is running is
 * a build that died with the app, and leaving it would make the tab attach to a
 * process that does not exist.
 */
export function failStaleRuns(db: Db): void {
  db.prepare("UPDATE fact_run SET state = 'failed', finished_at = ? WHERE state = 'running'").run(
    now(),
  );
}

// ── Subjects, claims and evidence (§6.3) ────────────────────

export function insertSubject(db: Db, root: string, label: string, embedding: number[]): string {
  const id = uuidv4();
  const write = db.transaction(() => {
    db.prepare("INSERT INTO fact_subject (id, workspace_root, label) VALUES (?, ?, ?)").run(
      id,
      root,
      label,
    );
    db.prepare(
      "INSERT INTO fact_subject_vec (subject_id, workspace_root, embedding) VALUES (?, ?, ?)",
    ).run(id, root, vectorBlob(embedding));
  });
  write();
  return id;
}

export function insertClaim(
  db: Db,
  input: {
    subjectId: string;
    value: string;
    modality: ExtractedClaim["modality"];
    statedAt: string | null;
    embedding: number[];
  },
): string {
  const id = uuidv4();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO fact_claim (id, subject_id, value, modality, stated_at, valid_from, valid_to)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(id, input.subjectId, input.value, input.modality, input.statedAt, now());
    db.prepare("INSERT INTO fact_claim_vec (claim_id, subject_id, embedding) VALUES (?, ?, ?)").run(
      id,
      input.subjectId,
      vectorBlob(input.embedding),
    );
  });
  write();
  return id;
}

export function insertEvidence(
  db: Db,
  input: {
    claimId: string;
    documentPath: string;
    chunkIndex: number;
    quote: string;
    anchor: Anchor;
  },
): void {
  db.prepare(
    `INSERT INTO fact_evidence (id, claim_id, document_path, chunk_index, quote, anchor)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv4(),
    input.claimId,
    input.documentPath,
    input.chunkIndex,
    input.quote,
    JSON.stringify(input.anchor),
  );
}

export interface Nearest {
  id: string;
  /** Cosine similarity, 0..1. §4.4's thresholds are stated in these terms. */
  similarity: number;
}

/**
 * §4.4 step 2 — the nearest existing subject in this workspace.
 *
 * `1 - distance` is a cosine similarity exactly, because the column declares
 * `distance_metric=cosine`. `k = 1` is enough: the caller only ever asks whether
 * the best match clears the threshold.
 */
export function nearestSubject(db: Db, root: string, embedding: number[]): Nearest | null {
  const row = db
    .prepare<[string, Buffer], { subject_id: string; distance: number }>(
      `SELECT subject_id, distance FROM fact_subject_vec
        WHERE workspace_root = ? AND embedding MATCH ? AND k = 1`,
    )
    .get(root, vectorBlob(embedding));
  return row ? { id: row.subject_id, similarity: 1 - row.distance } : null;
}

/** §4.4 step 3 — the nearest existing claim *inside* one subject. */
export function nearestClaim(db: Db, subjectId: string, embedding: number[]): Nearest | null {
  const row = db
    .prepare<[string, Buffer], { claim_id: string; distance: number }>(
      `SELECT claim_id, distance FROM fact_claim_vec
        WHERE subject_id = ? AND embedding MATCH ? AND k = 1`,
    )
    .get(subjectId, vectorBlob(embedding));
  return row ? { id: row.claim_id, similarity: 1 - row.distance } : null;
}

/** §4.4 — a subject pair seen in the same chunk. Feeds Louvain (§4.6). */
export function addCoOccurrence(db: Db, a: string, b: string): void {
  if (a === b) return;
  // §6.3 rule 3 — one row per pair, lower id first, read as undirected.
  const [low, high] = a < b ? [a, b] : [b, a];
  db.prepare(
    `INSERT INTO fact_co_occurrence (subject_a, subject_b, count) VALUES (?, ?, 1)
     ON CONFLICT (subject_a, subject_b) DO UPDATE SET count = count + 1`,
  ).run(low, high);
}

export function coOccurrences(
  db: Db,
  root: string,
): Array<{ a: string; b: string; count: number }> {
  return db
    .prepare<[string], { subject_a: string; subject_b: string; count: number }>(
      `SELECT c.subject_a, c.subject_b, c.count
         FROM fact_co_occurrence c
         JOIN fact_subject s ON s.id = c.subject_a
        WHERE s.workspace_root = ?
        ORDER BY c.subject_a, c.subject_b`,
    )
    .all(root)
    .map((row) => ({ a: row.subject_a, b: row.subject_b, count: row.count }));
}

/** §4.6 — Louvain's answer, written back onto every subject in the community. */
export function setTopic(db: Db, subjectIds: string[], topicId: number, name: string): void {
  const update = db.prepare("UPDATE fact_subject SET topic_id = ?, topic_name = ? WHERE id = ?");
  const write = db.transaction(() => {
    for (const id of subjectIds) update.run(topicId, name, id);
  });
  write();
}

export function subjectLabels(db: Db, root: string): Map<string, string> {
  const rows = db
    .prepare<[string], { id: string; label: string }>(
      "SELECT id, label FROM fact_subject WHERE workspace_root = ?",
    )
    .all(root);
  return new Map(rows.map((row) => [row.id, row.label]));
}

// ── Pairing and judging (§4.5) ──────────────────────────────

export interface CandidateClaim {
  id: string;
  subjectId: string;
  subjectLabel: string;
  value: string;
  modality: ExtractedClaim["modality"];
  statedAt: string | null;
  quote: string;
  documentPath: string;
}

/**
 * §4.5 — the candidate query. Plain SQL, no model, no cost.
 *
 * A group-and-count, not a traversal: it is the only "graph" query the feature
 * makes, and it is the reason §6.2 needs no graph engine. The two filters do
 * most of the work before any model runs — `valid_to IS NULL` drops superseded
 * claims, and the modality filter stops a rejected option contradicting a
 * decision, which §3.2 rule 3 names as the largest single source of false red
 * lines.
 */
export function candidateSubjects(db: Db, root: string): string[] {
  return db
    .prepare<[string], { subject_id: string }>(
      `SELECT c.subject_id
         FROM fact_claim c
         JOIN fact_subject s ON s.id = c.subject_id
        WHERE s.workspace_root = ?
          AND c.valid_to IS NULL
          AND c.modality IN ('decided', 'observed')
        GROUP BY c.subject_id
       HAVING count(*) > 1`,
    )
    .all(root)
    .map((row) => row.subject_id);
}

/**
 * The live, judgeable claims of one subject, each with one representative quote.
 *
 * Ordered by how many documents state the claim, because that is the order
 * `pairs.ts` trims against its cap: a claim three documents state is more worth
 * judging than one that appears once. `c.id` breaks the tie so the order is
 * stable across builds rather than whatever SQLite returns today.
 */
export function claimsOfSubject(db: Db, subjectId: string): CandidateClaim[] {
  return db
    .prepare<[string], CandidateClaim & Record<string, unknown>>(
      `SELECT c.id            AS id,
              c.subject_id    AS subjectId,
              s.label         AS subjectLabel,
              c.value         AS value,
              c.modality      AS modality,
              c.stated_at     AS statedAt,
              min(e.quote)         AS quote,
              min(e.document_path) AS documentPath,
              count(DISTINCT e.document_path) AS documents
         FROM fact_claim c
         JOIN fact_subject s ON s.id = c.subject_id
         JOIN fact_evidence e ON e.claim_id = c.id
        WHERE c.subject_id = ?
          AND c.valid_to IS NULL
          AND c.modality IN ('decided', 'observed')
        GROUP BY c.id
        ORDER BY documents DESC, c.id`,
    )
    .all(subjectId);
}

export function addEdge(
  db: Db,
  from: string,
  to: string,
  kind: "contradicts" | "refines" | "supersedes",
): void {
  // §6.3 rule 2 — `contradicts` is symmetric, so it is stored once from the
  // lower id to the higher one. `refines` and `supersedes` have a direction and
  // are stored exactly as given.
  const [a, b] = kind === "contradicts" && from > to ? [to, from] : [from, to];
  db.prepare("INSERT OR IGNORE INTO fact_edge (from_claim, to_claim, kind) VALUES (?, ?, ?)").run(
    a,
    b,
    kind,
  );
}

/** §3.4 — a superseding claim closes the old claim's window; it never deletes it. */
export function closeClaim(db: Db, claimId: string): void {
  db.prepare("UPDATE fact_claim SET valid_to = ? WHERE id = ? AND valid_to IS NULL").run(
    now(),
    claimId,
  );
}

/** §4.5 — `same`: fold one claim's evidence into another and drop the empty one. */
export function mergeClaims(db: Db, keep: string, drop: string): void {
  if (keep === drop) return;
  const merge = db.transaction(() => {
    db.prepare("UPDATE fact_evidence SET claim_id = ? WHERE claim_id = ?").run(keep, drop);
    db.prepare("DELETE FROM fact_claim WHERE id = ?").run(drop);
    db.prepare("DELETE FROM fact_claim_vec WHERE claim_id = ?").run(drop);
  });
  merge();
}

// ── Findings (§8.1) ─────────────────────────────────────────

/**
 * §6.4 — the key a verdict is stored under.
 *
 * A hash of both quotes and both paths, sorted, and deliberately **not** a claim
 * id: claim ids are regenerated on every rebuild, so a verdict keyed to one
 * would be lost the first time the graph was rebuilt — and §11 rule 3 requires a
 * dismissed finding to stay dismissed.
 *
 * The quotes are normalised first — collapsed whitespace, lower case — so that
 * re-rendering a document, or a model returning the same sentence with different
 * spacing, does not resurrect a dismissal.
 */
export function findingKey(
  a: { quote: string; documentPath: string },
  b: { quote: string; documentPath: string },
): string {
  const normalise = (side: { quote: string; documentPath: string }): string =>
    `${side.documentPath} ${side.quote.replace(/\s+/g, " ").trim().toLowerCase()}`;
  const sides = [normalise(a), normalise(b)].sort();
  return createHash("sha256").update(sides.join("")).digest("hex");
}

interface FindingRow {
  kind: "contradicts" | "supersedes";
  subject: string;
  topic_name: string | null;
  a_id: string;
  a_value: string;
  a_modality: ExtractedClaim["modality"];
  a_stated_at: string | null;
  a_quote: string;
  a_anchor: string;
  a_path: string;
  b_id: string;
  b_value: string;
  b_modality: ExtractedClaim["modality"];
  b_stated_at: string | null;
  b_quote: string;
  b_anchor: string;
  b_path: string;
}

/**
 * §8.1 — the findings list, most-supported first. **The list is the product.**
 *
 * One evidence row per side, chosen by `min(id)` so the same rebuild always
 * shows the same quote; `evidenceCount` is the real number and is what sorts.
 */
export function listFindings(db: Db, root: string, filter: FindingFilter = {}): Finding[] {
  const rows = db
    .prepare<[string], FindingRow>(
      `SELECT e.kind        AS kind,
              s.label       AS subject,
              s.topic_name  AS topic_name,
              ca.id         AS a_id,
              ca.value      AS a_value,
              ca.modality   AS a_modality,
              ca.stated_at  AS a_stated_at,
              ea.quote      AS a_quote,
              ea.anchor     AS a_anchor,
              ea.document_path AS a_path,
              cb.id         AS b_id,
              cb.value      AS b_value,
              cb.modality   AS b_modality,
              cb.stated_at  AS b_stated_at,
              eb.quote      AS b_quote,
              eb.anchor     AS b_anchor,
              eb.document_path AS b_path
         FROM fact_edge e
         JOIN fact_claim   ca ON ca.id = e.from_claim
         JOIN fact_claim   cb ON cb.id = e.to_claim
         JOIN fact_subject s  ON s.id  = ca.subject_id
         JOIN fact_evidence ea
           ON ea.id = (SELECT min(id) FROM fact_evidence WHERE claim_id = ca.id)
         JOIN fact_evidence eb
           ON eb.id = (SELECT min(id) FROM fact_evidence WHERE claim_id = cb.id)
        WHERE s.workspace_root = ?
          AND e.kind IN ('contradicts', 'supersedes')`,
    )
    .all(root);

  const evidenceCount = db.prepare<[string], { n: number }>(
    "SELECT count(DISTINCT document_path) AS n FROM fact_evidence WHERE claim_id = ?",
  );
  const verdictOf = db.prepare<[string], { verdict: "confirmed" | "dismissed" }>(
    "SELECT verdict FROM fact_verdict WHERE finding_key = ?",
  );
  const threadsOf = db.prepare<[string], { thread_id: string }>(
    "SELECT thread_id FROM fact_finding_thread WHERE finding_key = ?",
  );

  const findings: Finding[] = [];
  for (const row of rows) {
    const a = {
      claimId: row.a_id,
      value: row.a_value,
      quote: row.a_quote,
      documentPath: row.a_path,
      anchor: JSON.parse(row.a_anchor) as Anchor,
      modality: row.a_modality,
      statedAt: row.a_stated_at,
      evidenceCount: evidenceCount.get(row.a_id)?.n ?? 1,
    };
    const b = {
      claimId: row.b_id,
      value: row.b_value,
      quote: row.b_quote,
      documentPath: row.b_path,
      anchor: JSON.parse(row.b_anchor) as Anchor,
      modality: row.b_modality,
      statedAt: row.b_stated_at,
      evidenceCount: evidenceCount.get(row.b_id)?.n ?? 1,
    };
    const key = findingKey(a, b);
    const verdict = verdictOf.get(key)?.verdict ?? null;

    if (filter.kind && filter.kind !== row.kind) continue;
    // §8.3 and §9.1 — dismissed findings stay hidden unless asked for.
    if (verdict === "dismissed" && !filter.includeDismissed) continue;

    findings.push({
      key,
      kind: row.kind,
      subject: row.subject,
      topicName: row.topic_name,
      a,
      b,
      verdict,
      threadIds: threadsOf.all(key).map((thread) => thread.thread_id),
    });
  }

  // §8.1 — most-supported first, and §8.3 — confirmed findings sort to the top.
  return findings.sort((x, y) => {
    if ((x.verdict === "confirmed") !== (y.verdict === "confirmed")) {
      return x.verdict === "confirmed" ? -1 : 1;
    }
    return y.a.evidenceCount + y.b.evidenceCount - (x.a.evidenceCount + x.b.evidenceCount);
  });
}

export function setVerdict(
  db: Db,
  key: string,
  verdict: "confirmed" | "dismissed",
  note: string | null,
): void {
  db.prepare(
    `INSERT INTO fact_verdict (finding_key, verdict, note, decided_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (finding_key)
     DO UPDATE SET verdict = excluded.verdict, note = excluded.note,
                   decided_at = excluded.decided_at`,
  ).run(key, verdict, note, now());
}

export function linkFindingThread(db: Db, key: string, threadId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO fact_finding_thread (finding_key, thread_id) VALUES (?, ?)",
  ).run(key, threadId);
}

// ── The graph lens (§8.2) ───────────────────────────────────

/**
 * §8.2 — subjects and claims, with the three drawn edge kinds plus the
 * structural `about`.
 *
 * Deliberately carries no co-occurrence edges: §9.1 says so, and they exist only
 * to feed Louvain (§4.6). Drawing them would make the lens unreadable — at the
 * §7.3 ceiling there are about 150,000 of them.
 */
export function readGraph(db: Db, root: string, topicId?: number): FactGraph {
  const subjects = db
    .prepare<
      [string],
      { id: string; label: string; topic_id: number | null; topic_name: string | null }
    >("SELECT id, label, topic_id, topic_name FROM fact_subject WHERE workspace_root = ?")
    .all(root)
    .filter((row) => topicId === undefined || row.topic_id === topicId);

  const wanted = new Set(subjects.map((subject) => subject.id));

  const claims = db
    .prepare<
      [string],
      {
        id: string;
        subject_id: string;
        value: string;
        valid_to: string | null;
        topic_id: number | null;
        topic_name: string | null;
        evidence: number;
      }
    >(
      `SELECT c.id, c.subject_id, c.value, c.valid_to, s.topic_id, s.topic_name,
              (SELECT count(DISTINCT document_path) FROM fact_evidence WHERE claim_id = c.id)
                AS evidence
         FROM fact_claim c
         JOIN fact_subject s ON s.id = c.subject_id
        WHERE s.workspace_root = ?`,
    )
    .all(root)
    .filter((row) => wanted.has(row.subject_id));

  const claimIds = new Set(claims.map((claim) => claim.id));

  const edges = db
    .prepare<
      [],
      { from_claim: string; to_claim: string; kind: FactGraph["edges"][number]["kind"] }
    >("SELECT from_claim, to_claim, kind FROM fact_edge")
    .all()
    .filter((row) => claimIds.has(row.from_claim) && claimIds.has(row.to_claim))
    .map((row) => ({ source: row.from_claim, target: row.to_claim, kind: row.kind }));

  const topics = new Map<number, { id: number; name: string; subjectCount: number }>();
  for (const subject of subjects) {
    if (subject.topic_id === null) continue;
    const found = topics.get(subject.topic_id);
    if (found) found.subjectCount++;
    else {
      topics.set(subject.topic_id, {
        id: subject.topic_id,
        name: subject.topic_name ?? `Topic ${subject.topic_id}`,
        subjectCount: 1,
      });
    }
  }

  return {
    root,
    nodes: [
      ...subjects.map((subject) => ({
        id: subject.id,
        kind: "subject" as const,
        label: subject.label,
        topicId: subject.topic_id,
        topicName: subject.topic_name,
        evidenceCount: 0,
        live: true,
      })),
      ...claims.map((claim) => ({
        id: claim.id,
        kind: "claim" as const,
        label: claim.value,
        topicId: claim.topic_id,
        topicName: claim.topic_name,
        evidenceCount: claim.evidence,
        live: claim.valid_to === null,
      })),
    ],
    edges: [
      ...claims.map((claim) => ({
        source: claim.id,
        target: claim.subject_id,
        kind: "about" as const,
      })),
      ...edges,
    ],
    topics: [...topics.values()].sort((a, b) => b.subjectCount - a.subjectCount),
  };
}

/** The evidence behind one claim — §11 rule 4's "every claim shows its evidence". */
export function evidenceOfClaim(
  db: Db,
  claimId: string,
): Array<{ documentPath: string; quote: string; anchor: Anchor }> {
  return db
    .prepare<[string], { document_path: string; quote: string; anchor: string }>(
      "SELECT document_path, quote, anchor FROM fact_evidence WHERE claim_id = ? ORDER BY id",
    )
    .all(claimId)
    .map((row) => ({
      documentPath: row.document_path,
      quote: row.quote,
      anchor: JSON.parse(row.anchor) as Anchor,
    }));
}
