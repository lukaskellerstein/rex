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
  -- Spec 30 §2 — five lanes. `draft` is a comment with places that has never
  -- been sent and is meant to be; `note` is one the reviewer chose that no agent
  -- would ever see. Both are before `open`; `resolved` stays terminal.
  -- `migrateThreadLanes` widens this CHECK on a database made before spec 30,
  -- which needs a table rebuild — SQLite cannot alter a constraint in place.
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('draft','note','open','resolved')),
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
  -- Spec 30 §7.2 — RETIRED, and read by nothing but its own migration. A note is
  -- a lane in `status` now, so the flag has no second fact to carry. Left in
  -- place because dropping a column rewrites the table, exactly as `model` and
  -- `anchor_json` below and above are left. NOT to be confused with
  -- `message.mode`, which is a different fact — which mode sent ONE message —
  -- and is untouched by spec 30.
  is_note       INTEGER NOT NULL DEFAULT 0,
  -- Spec 14 §4.1 — rank among the comments sharing group_id. Renumbered 0..n-1
  -- inside one transaction on every drop; never a fractional key, which has a
  -- precision cliff and buys nothing at this size.
  position      INTEGER NOT NULL DEFAULT 0,
  session_id    TEXT,
  profile       TEXT NOT NULL DEFAULT 'read'
                  CHECK (profile IN ('read','write')),
  -- Spec 25 §4.3 — RETIRED, and read by nothing. The model is an argument on
  -- each send now, because it is a property of a send and not of a comment: a
  -- field here would be mutable state no send owns, and two runs on one comment
  -- would be each other's model. Left in place because dropping a column
  -- rewrites the table, exactly as anchor_json above is left. The durable
  -- record is message.model.
  model         TEXT,
  -- Spec 31 §2.1 — the output style this chat is having, and the deliberate
  -- opposite of the retired column above. A model is what one SEND is worth and
  -- has a safe default to fall back to; a style is how this CHAT reads, cannot
  -- be unsafe or dear, and was asked for as "remembered for the whole chat".
  -- A chat outlives a restart, so this is a column and not renderer state.
  -- NULL is the CLI's own default.
  style         TEXT,
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
  -- Spec 24 §5.2 — the user message that added this place. NULL for a place
  -- the comment was created with. Plain TEXT with no foreign key: a message and
  -- a target belong to one thread and leave with it, and `migrateTargetMessage`
  -- could not add a constraint by ALTER on an existing database anyway.
  message_id    TEXT,
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
  -- Spec 12 §3.3 — which mode the REVIEWER was in when they sent this, and
  -- NULL for everything they did not send. It is what a message WAS, which
  -- never changes; the mode a thread will send its next message in stays in the
  -- renderer and is deliberately not stored.
  mode            TEXT CHECK (mode IN ('ask','act','note')),
  -- Spec 25 §5 — the model this row came from, as the reviewer picked it. Set
  -- on their send and on everything the run it started produced. NULL for a
  -- NOTE, which runs nothing, and for every row written before this column;
  -- NULL is "nobody recorded it" and is never drawn as "the default".
  model           TEXT,
  -- Spec 31 §5 — the output style this row ran under. `model`'s twin: set on
  -- the send and on everything the run produced, NULL for a NOTE and for every
  -- row written before it. Recorded and not drawn; the debug report reads it.
  style           TEXT,
  -- Spec 43 §5.3 — the rest of the evidence: which agent, through which
  -- gateway, at which URL. With `model` and `style` above, a row records the
  -- whole answer.
  --
  -- **These are COPIES, not foreign keys**, and that is the point. Re-point a
  -- gateway at another host and a `gateway_id` reference would make every
  -- answer it ever produced start claiming the new URL — history rewritten by
  -- an edit nobody thought of as editing history. Four short strings on the row
  -- make that impossible by construction, which is why this spec needs no
  -- gateway revisioning and no retirement.
  --
  -- NULL for a NOTE, which runs nothing, and for every row written before these
  -- columns existed. `base_url` is NULL for `Original`, which is the honest
  -- record of "the SDK's own endpoint" and not a missing value.
  sdk             TEXT,
  gateway_name    TEXT,
  base_url        TEXT,
  content         TEXT,
  tool_name       TEXT,
  tool_input_json TEXT,
  is_error        INTEGER NOT NULL DEFAULT 0,
  -- The GATE refused this call (§8.4), which `is_error` cannot say on its own:
  -- a command that exits non-zero is an error too, and reading the one as the
  -- other made every failed shell line read as a refusal. Only the runner sets
  -- it, from the reason the gate recorded moments earlier.
  denied          INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL,
  duration_ms     INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_seq
  ON message(thread_id, seq);

-- Spec 43 §2.2 — a gateway is a named set of routes, not one URL.
--
-- Two tables, because `routes` is a map and SQLite is not a document store. The
-- base URL is a function of the gateway AND the SDK: each SDK speaks a
-- different wire protocol, and a gateway serves each protocol at a different
-- path — LiteLLM puts Anthropic Messages at its root, Envoy under a prefix.
--
-- These tables are created here AND by `migrateGateways`, and both are needed:
-- this file runs on every open and makes them on a fresh database, and the
-- migration seeds the `Original` row that everything else references.
CREATE TABLE IF NOT EXISTS agent_gateway (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL
                CHECK (kind IN ('original','litellm','envoy','custom')),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_route (
  gateway_id      TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
  -- All four SDK names from spec 42 on, so specs 44 to 46 add rows and no
  -- migration. In spec 43 only `claude-agent` rows are ever run.
  sdk             TEXT NOT NULL
                    CHECK (sdk IN ('claude-agent','codex','opencode','deep-agents')),
  base_url        TEXT,
  auth            TEXT NOT NULL
                    CHECK (auth IN ('inherit','none','environment')),
  -- The NAME of an environment variable. **Never a value** (§2.6 rule 4): no
  -- credential enters SQLite, IPC, a message, the log or a debug report.
  credential_env  TEXT,
  -- Newline-separated, not JSON. It is displayed as typed and never queried by
  -- element, and a text column keeps `sqlite3 ~/.rex/rex.db "select * from
  -- gateway_route"` readable — which is how every gateway problem in §15 was
  -- actually diagnosed.
  models          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (gateway_id, sdk),
  CHECK (
    (auth = 'environment' AND credential_env IS NOT NULL) OR
    (auth <> 'environment' AND credential_env IS NULL)
  ),
  -- §4.5 — "No authentication" needs an explicit URL. In the table, not only in
  -- the validator: a row that cannot run must not be creatable by any route,
  -- and `sqlite3 ~/.rex/rex.db` is a route.
  CHECK (auth <> 'none' OR base_url IS NOT NULL)
);

-- Spec 43 §5.2 — one session per (thread, SDK, gateway).
--
-- **The conversation is REX's, and it lives in `message`.** An SDK session is a
-- cache one harness keeps of part of it, so a thread keeps as many as it needs
-- and losing one costs a replay rather than the thread.
--
-- `base_url` is on the ROW and not merely on the gateway, and that is case 2b:
-- edit a gateway's host and resuming would ask a DIFFERENT server to continue
-- state it has never seen. Comparing the URL the session was really created
-- against is what makes that impossible.
CREATE TABLE IF NOT EXISTS thread_session (
  thread_id   TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  sdk         TEXT NOT NULL,
  gateway_id  TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
  base_url    TEXT,
  session_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (thread_id, sdk, gateway_id)
);

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

-- Spec 25 §6.1 — one fact about REX itself, keyed by name.
--
-- One row today: `model.default`, the model every send uses unless the comment
-- says otherwise. Absent means 'default', the SDK's own first row.
--
-- General on purpose so the next such fact needs no migration, and deliberately
-- NOT a settings system: nothing reads a key that a spec does not name.
CREATE TABLE IF NOT EXISTS setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
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
