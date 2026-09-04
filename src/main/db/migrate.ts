// Spec 05 §5.2 — the migration that moves data, which spec 04's did not.
//
// Its own module rather than part of `database.ts` for one reason: `database.ts`
// imports `schema.sql?raw`, which is a Vite import that plain `node` cannot
// load. Milestone 15 requires a test that runs this against a real database and
// then runs it again, so the function has to sit somewhere `node --test` can
// reach. Nothing here touches Electron either.

import type Database from "better-sqlite3";
import type { Anchor } from "../../shared/types.ts";

type Db = Database.Database;

interface LegacyThread {
  id: string;
  document_id: string;
  anchor_json: string;
  extra_anchors_json: string | null;
  anchor_state: string | null;
}

/**
 * Every thread that still keeps its anchors in the old columns gets
 * `thread_target` rows: the primary anchor at position 0, each extra after it,
 * all carrying the thread's own document and its single stored state.
 *
 * Idempotent by construction — a thread that already has targets is skipped, so
 * running this on every open costs one indexed query and changes nothing.
 * `INSERT OR IGNORE` is the second belt: a half-written thread from a crash
 * mid-transaction cannot end up with a duplicate position.
 */
export function migrateThreadTargets(db: Db): number {
  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(thread)")
    .all()
    .map((row) => row.name);
  // A database created after this migration landed never had the old columns,
  // so there is nothing to read and nothing to move.
  if (!columns.includes("anchor_json")) return 0;

  const legacy = db
    .prepare<[], LegacyThread>(
      `SELECT t.id, t.document_id, t.anchor_json,
              ${columns.includes("extra_anchors_json") ? "t.extra_anchors_json" : "NULL AS extra_anchors_json"},
              t.anchor_state
         FROM thread t
        WHERE t.anchor_json IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM thread_target x WHERE x.thread_id = t.id)`,
    )
    .all();

  if (legacy.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO thread_target
       (thread_id, position, document_id, anchor_json, anchor_state)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const move = db.transaction((rows: LegacyThread[]): void => {
    for (const row of rows) {
      for (const [position, anchor] of anchorsOf(row).entries()) {
        insert.run(row.id, position, row.document_id, JSON.stringify(anchor), row.anchor_state);
      }
    }
  });
  move(legacy);

  return legacy.length;
}

/**
 * `thread.stroke_json`, dropped — the pen no longer keeps what it drew.
 *
 * The drawing is a gesture that names places, and once it has named them the
 * places are the comment. Keeping the ink put a red circle over the prose it
 * was drawn around and told the agent nothing the targets did not already say,
 * so the column that carried it goes with it. Reported on 2026-08-26.
 *
 * This is the one migration that removes data, and it removes only the ink:
 * every comment, every target and every message is untouched. Idempotent the
 * same way the others are — it asks the table what it already has.
 *
 * Returns true when it dropped the column. Running it twice returns false the
 * second time.
 */
export function migrateThreadStroke(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(thread)")
    .all()
    .some((row) => row.name === "stroke_json");
  if (!present) return false;
  db.exec("ALTER TABLE thread DROP COLUMN stroke_json");
  return true;
}

/**
 * Spec 14 §6.2 — `thread.title`, `thread.group_id` and `thread.position`.
 *
 * Idempotent the same way the two above are: it asks the table what it already
 * has. Returns the number of comments whose `position` it filled, so a caller
 * can say whether anything happened; a second run returns 0.
 *
 * **The order must not change.** `position` is filled from the `created_at`
 * rank, which is the order `listThreads` used before this spec — so a reviewer
 * who upgrades sees the list they closed, in the order they closed it. An
 * upgrade that reshuffles somebody's comments has broken the feature it is
 * shipping.
 *
 * `title` and `group_id` are left NULL. Nothing is invented: NULL title means
 * "named by the note" (§3.1) and NULL group means the top level.
 */
export function migrateCommentOrder(db: Db): number {
  const columns = (): string[] =>
    db
      .prepare<[], { name: string }>("PRAGMA table_info(thread)")
      .all()
      .map((row) => row.name);

  const present = new Set(columns());
  if (!present.has("title")) db.exec("ALTER TABLE thread ADD COLUMN title TEXT");
  if (!present.has("group_id")) {
    // No default and no NOT NULL: SQLite refuses ADD COLUMN with a REFERENCES
    // clause unless the default is NULL, and NULL is the meaning wanted anyway.
    db.exec(
      "ALTER TABLE thread ADD COLUMN group_id TEXT REFERENCES comment_group(id) ON DELETE SET NULL",
    );
  }
  const hadPosition = present.has("position");
  if (!hadPosition) {
    db.exec("ALTER TABLE thread ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
  }

  // Here rather than in schema.sql, which runs before every migration: on a
  // database made before this spec the column does not exist when that file is
  // executed, and an index naming it would throw.
  db.exec("CREATE INDEX IF NOT EXISTS idx_thread_group ON thread(group_id, position)");

  // A fresh database has the column from schema.sql and no rows, so there is
  // nothing to rank. An existing one has every row at the default 0.
  if (hadPosition) return 0;

  const rows = db
    .prepare<[], { id: string }>("SELECT id FROM thread ORDER BY created_at, id")
    .all();
  if (rows.length === 0) return 0;

  const update = db.prepare("UPDATE thread SET position = ? WHERE id = ?");
  const rank = db.transaction((ordered: Array<{ id: string }>): void => {
    for (const [position, row] of ordered.entries()) update.run(position, row.id);
  });
  rank(rows);

  return rows.length;
}

/**
 * `thread.is_note` — a comment saved without being sent to any agent.
 *
 * Its own guarded `ALTER TABLE`, and idempotent the same way the others are.
 * Returns true when it added the column.
 *
 * 0 is right for every row written before it existed: every comment REX could
 * make until now was sent the moment it was created.
 */
export function migrateNoteFlag(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(thread)")
    .all()
    .some((row) => row.name === "is_note");
  if (present) return false;
  db.exec("ALTER TABLE thread ADD COLUMN is_note INTEGER NOT NULL DEFAULT 0");
  return true;
}

/**
 * `message.mode` — which mode the reviewer sent a message in.
 *
 * Guarded and idempotent the same way the others are. **NULL is the honest
 * value for every row written before it existed**, and the card is written to
 * read it that way: an old user message says `YOU ASKED` because that is what
 * the card always claimed, not because anyone checked. Backfilling a guess
 * would put a confident `YOU NOTED` on a message nobody recorded.
 *
 * No CHECK constraint here, unlike `schema.sql`. SQLite cannot add one with
 * `ALTER TABLE`, and the writer is the only thing that fills the column.
 */
export function migrateMessageMode(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(message)")
    .all()
    .some((row) => row.name === "mode");
  if (present) return false;
  db.exec("ALTER TABLE message ADD COLUMN mode TEXT");
  return true;
}

/**
 * Spec 25 §5.2 — `message.model`, the model a row came from.
 *
 * Guarded and idempotent like the others. NULL for every existing row is the
 * value §5 defines: until this spec no send named a model, so nobody recorded
 * one. It is not "the default" and nothing may draw it as one.
 */
export function migrateMessageModel(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(message)")
    .all()
    .some((row) => row.name === "model");
  if (present) return false;
  db.exec("ALTER TABLE message ADD COLUMN model TEXT");
  return true;
}

/**
 * Spec 31 §5 — `message.style`, the output style a row ran under.
 *
 * Guarded and idempotent like the others, and NULL for every existing row for
 * the same reason `model` was: until spec 31 no send named a style, so nobody
 * recorded one.
 */
export function migrateMessageStyle(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(message)")
    .all()
    .some((row) => row.name === "style");
  if (present) return false;
  db.exec("ALTER TABLE message ADD COLUMN style TEXT");
  return true;
}

/**
 * Spec 31 §2.1 — `thread.style`, the style this chat is having.
 *
 * NULL is the CLI's own default, which is what every comment made before spec
 * 31 was answered under. Unlike `message.style` this column is *read*: it is
 * what the composer is painted from when a comment is reopened, which is the
 * whole of what "remembered for the whole chat" means.
 */
export function migrateThreadStyle(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(thread)")
    .all()
    .some((row) => row.name === "style");
  if (present) return false;
  db.exec("ALTER TABLE thread ADD COLUMN style TEXT");
  return true;
}

/**
 * `message.denied` — the gate refused this call, as opposed to the tool failing.
 *
 * The two were one flag until now, and every reader guessed the same wrong way:
 * a `grep` that exited 1 was drawn as a refusal in the trace, counted as one in
 * the step strip, and printed under DENIED in the debug report. Measured on
 * 2026-09-01, thread `f5e79775`: two shell errors, no gate involvement, both
 * reported as denials.
 *
 * **The old rows are backfilled, and that is the point of this migration.** A
 * refusal also writes a `Denied <tool>: <reason>` note (`ipc.ts`), so the notes
 * name every denial an old thread contains and the result carries the same
 * reason verbatim. `instr` rather than LIKE: a reason is REX's own prose and may
 * hold `%` or `_`, which LIKE would read as wildcards.
 *
 * The SDK's own refusal is the second source, and it has no note because REX's
 * gate never saw it. Measured against the live database on 2026-09-01: 13 rows
 * from the notes and 1 from the SDK's sentence, out of 24 errored results.
 *
 * ALTER and backfill in one transaction, so a crash between them cannot leave a
 * database that has the column, will never fill it, and reports every historical
 * refusal as a failure.
 */
export function migrateMessageDenied(db: Db): number {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(message)")
    .all()
    .some((row) => row.name === "denied");
  if (present) return 0;

  let marked = 0;
  db.transaction(() => {
    db.exec("ALTER TABLE message ADD COLUMN denied INTEGER NOT NULL DEFAULT 0");
    marked = db
      .prepare(
        `UPDATE message SET denied = 1
          WHERE kind = 'tool_result'
            AND is_error = 1
            AND content IS NOT NULL
            AND content <> ''
            AND (
                  EXISTS (
                    SELECT 1 FROM message note
                     WHERE note.thread_id = message.thread_id
                       AND note.role = 'system'
                       AND note.content LIKE 'Denied %'
                       AND instr(note.content, message.content) > 0
                  )
                  -- The SDK's own refusal, which leaves no note because REX's
                  -- gate never saw it. SDK_REFUSAL in runner.ts is the same
                  -- rule on the live path.
                  OR content LIKE 'Permission to use % has been denied.'
                )`,
      )
      .run().changes;
  })();
  return marked;
}

/**
 * Spec 24 §5.2 — `thread_target.message_id`, the user message that added a
 * place to a comment that already existed.
 *
 * Guarded and idempotent the same way the others are. **NULL is the honest
 * value for every row written before it existed**: until spec 24 a comment's
 * places were all fixed at `thread:create`, so every one of them is a place
 * "the comment was created with", which is exactly what NULL means.
 */
export function migrateTargetMessage(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(thread_target)")
    .all()
    .some((row) => row.name === "message_id");
  if (present) return false;
  db.exec("ALTER TABLE thread_target ADD COLUMN message_id TEXT");
  return true;
}

/**
 * Spec 30 §7.1 — `thread.status` gains the `draft` and `note` lanes.
 *
 * **The first migration here that rebuilds a table**, because SQLite cannot
 * widen a CHECK any other way: the constraint is part of the table's definition,
 * and `schema.sql` is `CREATE TABLE IF NOT EXISTS`, so a database that already
 * exists keeps the two-lane check and refuses every new value. Everything above
 * adds or drops a column, which `ALTER TABLE` does on its own.
 *
 * **The new definition is not written out here.** It is read from
 * `sqlite_master` and its status CHECK rewritten in place, for two reasons: this
 * runs after four guarded `ALTER TABLE`s and cannot know which of them a given
 * database has been through, and a copy of the table written out here would be a
 * second schema in the tree, free to drift from `schema.sql`.
 *
 * Spec 30 §7.2 — the rebuild carries `is_note = 1` into the `note` lane, and
 * **only from `open`**. A note that was resolved stays resolved: spec 18 §2's
 * rule that `resolved` is terminal is older than spec 30 and outranks it.
 *
 * There is deliberately no `PRAGMA foreign_key_check` at the end. Every row is
 * copied with its `id` intact, so no reference can be broken by this; a check
 * here would only surface damage that predates it, and failing the open over
 * somebody else's stray row is worse than the stray row.
 *
 * Idempotent: a definition that already names `draft` is left alone, and so is
 * one with no status CHECK to widen — the hand-built tables in
 * `test/migrate.spec.ts` are that shape, and they accept the new values
 * already. Returns true when it rebuilt the table.
 */
export function migrateThreadLanes(db: Db): boolean {
  const table = db
    .prepare<[], { sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'thread'",
    )
    .get();
  const sql = table?.sql;
  if (!sql || sql.includes("'draft'")) return false;

  // `status` right after the paren is what keeps this off the other three CHECKs
  // on this table — kind, anchor_state and profile.
  const widened = sql.replace(
    /CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i,
    "CHECK (status IN ('draft','note','open','resolved'))",
  );
  if (widened === sql) return false;

  // sqlite_master drops `IF NOT EXISTS` when it stores a definition, but the
  // pattern allows for it rather than relying on that.
  const create = widened.replace(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?thread"?/i,
    "CREATE TABLE thread_rebuilt",
  );

  const names = db
    .prepare<[], { name: string }>("PRAGMA table_info(thread)")
    .all()
    .map((row) => row.name);
  const columns = names.map((name) => `"${name}"`).join(", ");

  // Dropping a table drops its indexes with it, so they are remembered before
  // the drop and replayed after the rename.
  const indexes = db
    .prepare<[], { sql: string }>(
      `SELECT sql FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'thread' AND sql IS NOT NULL`,
    )
    .all()
    .map((row) => row.sql);

  // `PRAGMA foreign_keys` cannot change inside a transaction, so it is turned
  // off around one rather than in it. thread_target, message and thread_ref all
  // say `REFERENCES thread(id)`; while the constraint is off their rows survive
  // the drop, and the rename puts the rebuilt table back under the name they
  // point at.
  const enforcing = db.pragma("foreign_keys", { simple: true }) === 1;
  if (enforcing) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(create);
      db.exec(`INSERT INTO thread_rebuilt (${columns}) SELECT ${columns} FROM thread`);
      db.exec("DROP TABLE thread");
      db.exec("ALTER TABLE thread_rebuilt RENAME TO thread");
      for (const index of indexes) db.exec(index);
      if (names.includes("is_note")) {
        db.exec("UPDATE thread SET status = 'note' WHERE is_note = 1 AND status = 'open'");
      }
    })();
  } finally {
    if (enforcing) db.pragma("foreign_keys = ON");
  }
  return true;
}

// ── Spec 43 — gateways, sessions and the record ─────────────────
//
// Four steps, in this order, because `PRAGMA foreign_keys` is ON: `agent_gateway`
// and its `Original` row exist before anything references them.
//
// Every step is idempotent and additive, the way the eleven above are. A
// database made after this spec sees a no-op; one made before it is filled in
// once. **With only `Original` configured, REX behaves exactly as it did before
// spec 43**, and `test/gateways.spec.ts` asserts that property.

/** §2.5 — the row that cannot be edited or deleted, and its id. */
export const ORIGINAL_GATEWAY_ID = "rex-original";
export const ORIGINAL_GATEWAY_NAME = "Original";

/** Spec 42 §5.1's four SDK names, so specs 44 to 46 add rows and no migration. */
const EVERY_SDK = ["claude-agent", "codex", "opencode", "deep-agents"] as const;

function hasTable(db: Db, name: string): boolean {
  return (
    db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== undefined
  );
}

function hasColumn(db: Db, table: string, column: string): boolean {
  return db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

/**
 * Spec 43 §12 — the two gateway tables, and the one row REX starts with.
 *
 * `schema.sql` creates the tables too, on a fresh database. This creates them
 * again for a database made before this spec, where that file's
 * `CREATE TABLE IF NOT EXISTS` ran long ago against a different definition and
 * will not add a table it did not have — the two are the same statements on
 * purpose, and running both is a no-op on either kind of file.
 *
 * `Original` is inserted here and not in `schema.sql` because it is data, and
 * because `thread_session` and `gateway_route` reference it. Returns true when
 * it created the row.
 */
export function migrateGateways(db: Db): boolean {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_gateway (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL
                    CHECK (kind IN ('original','litellm','envoy','custom')),
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gateway_route (
      gateway_id      TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
      sdk             TEXT NOT NULL
                        CHECK (sdk IN ('claude-agent','codex','opencode','deep-agents')),
      base_url        TEXT,
      auth            TEXT NOT NULL
                        CHECK (auth IN ('inherit','none','environment')),
      credential_env  TEXT,
      models          TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (gateway_id, sdk),
      CHECK (
        (auth = 'environment' AND credential_env IS NOT NULL) OR
        (auth <> 'environment' AND credential_env IS NULL)
      ),
      CHECK (auth <> 'none' OR base_url IS NOT NULL)
    );
  `);

  const already = db
    .prepare<[string], { id: string }>("SELECT id FROM agent_gateway WHERE id = ?")
    .get(ORIGINAL_GATEWAY_ID);
  if (already) return false;

  const at = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO agent_gateway (id, name, kind, created_at) VALUES (?, ?, 'original', ?)",
    ).run(ORIGINAL_GATEWAY_ID, ORIGINAL_GATEWAY_NAME, at);
    const route = db.prepare(
      `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
       VALUES (?, ?, NULL, 'inherit', NULL, '')`,
    );
    // A route for every SDK, with no URL on any of them: each uses its own
    // official endpoint and the credential the reviewer already has installed.
    for (const sdk of EVERY_SDK) route.run(ORIGINAL_GATEWAY_ID, sdk);
  })();
  return true;
}

/**
 * Spec 43 §12 — `thread.session_id` becomes a `thread_session` row.
 *
 * Keyed `(thread_id, 'claude-agent', 'rex-original')` with a null `base_url`,
 * because that is what every session in an existing database actually is: the
 * Claude SDK, on the reviewer's own subscription, at the SDK's own endpoint.
 *
 * **`thread.session_id` is retired in place, not dropped.** Dropping a column
 * rewrites the table, exactly as `thread.model` and `thread.anchor_json` are
 * left. It stops being read; nothing else about it changes.
 *
 * Returns the number of sessions it moved. A second run returns 0, because
 * `INSERT OR IGNORE` and the `NOT EXISTS` both refuse a row that is there.
 */
export function migrateThreadSessions(db: Db): number {
  if (!hasTable(db, "thread_session")) return 0;
  if (!hasColumn(db, "thread", "session_id")) return 0;

  const legacy = db
    .prepare<[string, string], { id: string; session_id: string }>(
      `SELECT t.id, t.session_id
         FROM thread t
        WHERE t.session_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM thread_session s
                 WHERE s.thread_id = t.id AND s.sdk = ? AND s.gateway_id = ?
              )`,
    )
    .all("claude-agent", ORIGINAL_GATEWAY_ID);
  if (legacy.length === 0) return 0;

  const at = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO thread_session (thread_id, sdk, gateway_id, base_url, session_id, created_at)
     VALUES (?, 'claude-agent', ?, NULL, ?, ?)`,
  );
  db.transaction((rows: Array<{ id: string; session_id: string }>): void => {
    for (const row of rows) insert.run(row.id, ORIGINAL_GATEWAY_ID, row.session_id, at);
  })(legacy);

  return legacy.length;
}

/**
 * Spec 43 §5.3 — `message.sdk`, `message.gateway_name` and `message.base_url`.
 *
 * Guarded and idempotent like the others. **Every existing message is
 * backfilled**, and that is the difference between this and `migrateMessageModel`,
 * which left NULL: nobody recorded a model before spec 25, but every message in
 * an existing database really was produced by the Claude Agent SDK through the
 * `Original` gateway. Writing that down is a fact, not a guess.
 *
 * A NULL `base_url` stays NULL for the same reason it always will: `Original`
 * has no URL, and that is the honest record of "the SDK's own endpoint".
 *
 * The three ALTERs and the backfill are one transaction, so a crash between
 * them cannot leave a database that has the columns, will never fill them, and
 * reports every historical answer as having come from nowhere.
 *
 * Returns the number of rows it stamped.
 */
export function migrateMessageRoute(db: Db): number {
  if (hasColumn(db, "message", "sdk")) return 0;

  let stamped = 0;
  db.transaction(() => {
    // No CHECK constraints here, unlike `schema.sql`. SQLite cannot add one
    // with ALTER TABLE, and the writer is the only thing that fills them.
    db.exec("ALTER TABLE message ADD COLUMN sdk TEXT");
    db.exec("ALTER TABLE message ADD COLUMN gateway_name TEXT");
    db.exec("ALTER TABLE message ADD COLUMN base_url TEXT");
    // Only rows that a run produced or a send started. A NOTE recorded no model
    // because it ran nothing, and it names no agent and no gateway either —
    // §5.4, and NULL is the honest record of that.
    stamped = db
      .prepare(
        `UPDATE message
            SET sdk = 'claude-agent', gateway_name = ?
          WHERE mode IS NULL OR mode <> 'note'`,
      )
      .run(ORIGINAL_GATEWAY_NAME).changes;
  })();
  return stamped;
}

/**
 * The primary anchor, then the extras.
 *
 * Both columns are parsed defensively. They were written by an earlier build and
 * a value that will not parse is a row this must not throw on — the alternative
 * is an app that refuses to open at all because one comment is malformed.
 */
function anchorsOf(row: LegacyThread): Anchor[] {
  const primary = parse<Anchor>(row.anchor_json);
  if (!primary) return [];
  const extras = row.extra_anchors_json ? (parse<Anchor[]>(row.extra_anchors_json) ?? []) : [];
  return [primary, ...extras];
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
