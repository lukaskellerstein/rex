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
  anchor_state  TEXT CHECK (anchor_state IN ('ok','moved','orphaned')),
  note          TEXT NOT NULL,
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
