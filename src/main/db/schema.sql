PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS document (
  id            TEXT PRIMARY KEY,
  -- `url` was the second kind until REX stopped opening remote pages. An
  -- existing database keeps the wider CHECK, because `CREATE TABLE IF NOT
  -- EXISTS` never rewrites one — and nothing writes 'url' any more, so the
  -- looser constraint on an old file costs nothing.
  kind          TEXT NOT NULL CHECK (kind IN ('file')),
  value         TEXT NOT NULL,
  title         TEXT,
  content_hash  TEXT,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (kind, value)
);

-- Spec 14 §6.1 — the reviewer's own arrangement of the comment list.
--
-- Not a directory. `root` scopes a group to one workspace (§5.3); `parent_id`
-- nests it; `position` ranks it among its siblings and among them only (§4.1).
-- Nothing inside a group records where the group is, which is what makes moving
-- a group of forty comments one UPDATE of one row (§4.6).
CREATE TABLE IF NOT EXISTS comment_group (
  id          TEXT PRIMARY KEY,
  root        TEXT NOT NULL,
  parent_id   TEXT REFERENCES comment_group(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_root
  ON comment_group(root, parent_id, position);

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
  -- Spec 14 §3.1 — the name the reviewer typed. NULL is not "unnamed", it is
  -- "named by the note": every surface falls back to the note's first line, so
  -- a comment nobody renames reads exactly as it did before this column.
  title         TEXT,
  -- Spec 14 §5 — the group this comment sits in. NULL is the top level, and
  -- ON DELETE SET NULL is the backstop: the delete path promotes a group's
  -- contents to its parent first (§5.4), so this fires only for a row deleted
  -- some other way. A comment is never destroyed by rearranging groups.
  group_id      TEXT REFERENCES comment_group(id) ON DELETE SET NULL,
  -- A comment the reviewer saved and never sent. 1 means NOTE mode made it, so
  -- "Ask all" leaves it alone and the panel draws it in its own colour. Cleared
  -- the moment the comment IS sent — a note that has been asked is not a note
  -- any more, and nothing about it should keep saying so.
  is_note       INTEGER NOT NULL DEFAULT 0,
  -- Spec 14 §4.1 — rank among the comments sharing group_id. Renumbered 0..n-1
  -- inside one transaction on every drop; never a fractional key, which has a
  -- precision cliff and buys nothing at this size.
  position      INTEGER NOT NULL DEFAULT 0,
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

-- Spec 14 §4.4 needs an index on thread(group_id, position), and it is created
-- by `migrateCommentOrder` rather than here. This file runs before every
-- migration, and on a database made before spec 14 the column does not exist
-- yet — an index naming it would throw and take the whole open with it.

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

-- Spec 10 §3.2 — what a reviewer has said is, or is not, part of the review.
--
-- Keyed by workspace root as well as path, so the same folder opened as its own
-- workspace and as part of a larger one can be scoped differently. Nothing here
-- is written into the repository under review: REX writes files there only
-- through Apply's diff gate, and a preference about what to look at is not a
-- change to what is being looked at.
--
-- Two modes, both meaning "override the default for this exact path":
--   exclude  drop it and everything under it (the default is to include)
--   include  keep it (the default, for node_modules and its kind, is to skip)
-- A path with no row here follows the built-in skip list, so the table holds
-- only the reviewer's departures from it and is empty in the ordinary case.
CREATE TABLE IF NOT EXISTS workspace_rule (
  root        TEXT NOT NULL,
  path        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('exclude','include')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (root, path)
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
