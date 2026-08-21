PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS document (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('file','url')),
  value         TEXT NOT NULL,
  title         TEXT,
  content_hash  TEXT,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS thread (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('anchored','synthesis')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved')),
  anchor_json   TEXT,
  -- Further anchors for the same comment, as a JSON array. NULL and '[]' both
  -- mean the ordinary one-target comment.
  extra_anchors_json TEXT,
  anchor_state  TEXT CHECK (anchor_state IN ('ok','moved','orphaned')),
  note          TEXT NOT NULL,
  -- Spec 06 §5.4 — the reviewer's ink, as fractions of the union box of this
  -- comment's targets. A column and not a field inside anchor_json, because a
  -- stroke is not a property of any one anchor: it is drawn across all of them,
  -- and storing it on target 0 would make the ink a possession of whichever
  -- block happened to sort first. NULL for every comment that was not drawn.
  stroke_json   TEXT,
  session_id    TEXT,
  profile       TEXT NOT NULL DEFAULT 'read'
                  CHECK (profile IN ('read','write')),
  model         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_thread_doc
  ON thread(document_id, status);

-- Spec 05 §5.2 — one row per place a comment is about, in panel order.
--
-- This is what lets one comment span documents: the target carries its own
-- document_id, which `thread.anchor_json` never could. Those older columns are
-- left in place and stop being read — dropping a column rewrites the table, and
-- a half-finished rewrite of somebody's comments is not worth the tidiness.
CREATE TABLE IF NOT EXISTS thread_target (
  thread_id     TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  document_id   TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  anchor_json   TEXT NOT NULL,
  -- NULL means "that document has not been open, so nobody looked". It is not
  -- orphaned, and §5.7 must never count it as one.
  anchor_state  TEXT CHECK (anchor_state IN ('ok','moved','orphaned')),
  PRIMARY KEY (thread_id, position)
);

-- What makes the explorer's counts and the workspace-wide list cheap (§5.2).
CREATE INDEX IF NOT EXISTS idx_target_document ON thread_target(document_id);

CREATE TABLE IF NOT EXISTS message (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  kind            TEXT NOT NULL,
  content         TEXT,
  tool_name       TEXT,
  tool_input_json TEXT,
  is_error        INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL,
  duration_ms     INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_seq
  ON message(thread_id, seq);

CREATE TABLE IF NOT EXISTS thread_ref (
  thread_id      TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  ref_thread_id  TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, ref_thread_id)
);

CREATE TABLE IF NOT EXISTS apply_run (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  status       TEXT NOT NULL
                 CHECK (status IN ('pending','applied','rejected','failed')),
  diff         TEXT,
  files_json   TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- Full-text search over comments and transcripts.
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  content,
  content='message',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS message_fts_ai AFTER INSERT ON message BEGIN
  INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS message_fts_ad AFTER DELETE ON message BEGIN
  INSERT INTO message_fts(message_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS message_fts_au AFTER UPDATE ON message BEGIN
  INSERT INTO message_fts(message_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- ═══ Spec 07 — the fact graph ════════════════════════════════════════════
--
-- Two groups of tables, and the difference between them is the whole of §6.1:
--
--   §6.3, below, is a CACHE. Every row is derived from document text and can be
--   rebuilt by running the pipeline again. It may be dropped at any time, by any
--   code, without asking — losing it costs compute time and nothing else.
--
--   §6.4, further down, is BOOKKEEPING. It holds the two things a rebuild must
--   not destroy: what the user decided, and what the build already did. It is
--   never dropped.
--
-- Getting that backwards is the one mistake in spec 07 that would lose real
-- work, so the two groups are kept visibly apart rather than interleaved.

-- ── §6.3 The graph tables — the cache ───────────────────────────────────

CREATE TABLE IF NOT EXISTS fact_subject (
  id             TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  label          TEXT NOT NULL,
  topic_id       INTEGER,
  topic_name     TEXT
);

CREATE TABLE IF NOT EXISTS fact_claim (
  id         TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES fact_subject(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  modality   TEXT NOT NULL
               CHECK (modality IN ('decided','proposed','rejected','observed')),
  stated_at  TEXT,
  valid_from TEXT NOT NULL,
  -- NULL means live. §3.4 — a superseding claim does not delete the old one, it
  -- closes the old one's window, so "what did these documents claim in March?"
  -- stays answerable.
  valid_to   TEXT
);

CREATE TABLE IF NOT EXISTS fact_evidence (
  id            TEXT PRIMARY KEY,
  claim_id      TEXT NOT NULL REFERENCES fact_claim(id) ON DELETE CASCADE,
  document_path TEXT NOT NULL,
  chunk_index   INTEGER NOT NULL,
  quote         TEXT NOT NULL,
  -- A serialised Anchor (spec 01 §6). Stored here, never resolved here:
  -- invariant I1 puts resolution in the renderer, on the live DOM.
  anchor        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fact_edge (
  from_claim TEXT NOT NULL REFERENCES fact_claim(id) ON DELETE CASCADE,
  to_claim   TEXT NOT NULL REFERENCES fact_claim(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('contradicts','refines','supersedes')),
  -- §6.3 rule 2 — `contradicts` is symmetric and is written once, from the lower
  -- claim id to the higher one, so the pair cannot be stored twice.
  PRIMARY KEY (from_claim, to_claim, kind)
);

CREATE TABLE IF NOT EXISTS fact_co_occurrence (
  -- §6.3 rule 3 — each pair once, `subject_a` the lower id. Read as an
  -- undirected graph by §4.6, and by nothing else.
  subject_a TEXT NOT NULL REFERENCES fact_subject(id) ON DELETE CASCADE,
  subject_b TEXT NOT NULL REFERENCES fact_subject(id) ON DELETE CASCADE,
  count     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (subject_a, subject_b)
);

CREATE INDEX IF NOT EXISTS fact_claim_subject  ON fact_claim(subject_id, valid_to);
CREATE INDEX IF NOT EXISTS fact_evidence_claim ON fact_evidence(claim_id);
CREATE INDEX IF NOT EXISTS fact_evidence_doc   ON fact_evidence(document_path);
CREATE INDEX IF NOT EXISTS fact_subject_root   ON fact_subject(workspace_root);

-- ── §6.4 The bookkeeping tables — never dropped ─────────────────────────

-- One row per document the pipeline has seen. Drives the incremental skip of
-- §4.1, which is what makes a second build over an unchanged folder free.
CREATE TABLE IF NOT EXISTS fact_document (
  workspace_root TEXT NOT NULL,
  path           TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  extracted_at   TEXT NOT NULL,
  chunk_count    INTEGER NOT NULL,
  -- How many of this document's chunks are already stored. Equal to
  -- `chunk_count` once it is finished; lower means a build stopped part-way
  -- through it.
  --
  -- Resume is per document and not per build, because `fact_run.cursor` counts
  -- chunks across *every* document in the run — and stage 0 hands a resumed
  -- build a shorter list, since the documents that did finish are now skipped.
  -- A global cursor of 812 against that shorter list does not mean what it said,
  -- and would skip work that was never done. §4.7
  chunks_done    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_root, path)
);

-- One row per build. Makes a build resumable and cancellable (§4.7), and is what
-- lets the Facts tab reattach to one after REX has been quit and reopened.
CREATE TABLE IF NOT EXISTS fact_run (
  id             TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  stage          TEXT NOT NULL,
  cursor         INTEGER NOT NULL DEFAULT 0,
  -- How many items the current stage is counting. A column and not a number held
  -- in the writer's memory, because the writer is a *different process* from the
  -- reader (§10.1): main answering `facts:status` for an interrupted build has
  -- no access to anything the worker only remembered, and would have to report
  -- "stopped at 812 of 812".
  total          INTEGER NOT NULL DEFAULT 0,
  alias_extract  TEXT NOT NULL,
  alias_judge    TEXT NOT NULL,
  state          TEXT NOT NULL
                   CHECK (state IN ('running','done','cancelled','failed')),
  -- §7.4 — what the build did not cover. Never omitted, even when zero: a report
  -- that leaves these out reads as "everything was covered" when it was not.
  dropped_quotes INTEGER NOT NULL DEFAULT 0,
  failed_chunks  INTEGER NOT NULL DEFAULT 0,
  subjects_merged INTEGER NOT NULL DEFAULT 0,
  claims_merged  INTEGER NOT NULL DEFAULT 0
);

-- The user's verdict on a finding. Survives every graph rebuild, which is the
-- whole reason it is keyed the way it is.
CREATE TABLE IF NOT EXISTS fact_verdict (
  -- A SHA-256 of the two claims' normalised quotes and their document paths,
  -- sorted. Deliberately NOT a claim id: claim ids are regenerated on every
  -- rebuild, and a verdict keyed to one would be lost — but §11 rule 3 requires
  -- a dismissed finding to stay dismissed.
  finding_key TEXT PRIMARY KEY,
  verdict     TEXT NOT NULL CHECK (verdict IN ('confirmed','dismissed')),
  note        TEXT,
  decided_at  TEXT NOT NULL
);

-- Links a finding to the comment thread it produced (spec 05 §5), so a resolved
-- thread can mark its finding resolved.
CREATE TABLE IF NOT EXISTS fact_finding_thread (
  finding_key TEXT NOT NULL,
  thread_id   TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_key, thread_id)
);
