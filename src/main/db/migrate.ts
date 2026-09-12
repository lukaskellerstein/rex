// Spec 05 §5.2 — the migration that moves data, which spec 04's did not.
//
// Its own module rather than part of `database.ts` for one reason: `database.ts`
// imports `schema.sql?raw`, which is a Vite import that plain `node` cannot
// load. Milestone 15 requires a test that runs this against a real database and
// then runs it again, so the function has to sit somewhere `node --test` can
// reach. Nothing here touches Electron either.

import type Database from "better-sqlite3";
import type { Anchor } from "../../shared/types.ts";
import { getSetting, setSetting } from "./settings.ts";

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
 * Spec 51 §4 — `message.run_id`, the turn a row belongs to.
 *
 * `migrateMessageStyle`'s shape exactly, and NULL for every existing row for the
 * same reason: until this spec no row named a run, so nobody recorded one.
 *
 * Not backfilled, and it could not be. A run is a fact about how rows were
 * produced together, and nothing in an old row records it — a guess from
 * timestamps would group rows that never ran together and would look exactly as
 * confident as the truth. Old rows group under "before turns were recorded".
 *
 * Both this and the `run_id` line in `schema.sql` are needed: the schema runs on
 * every open and makes a fresh database, this fixes an existing one.
 */
export function migrateMessageRunId(db: Db): boolean {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(message)")
    .all()
    .some((row) => row.name === "run_id");
  if (present) return false;
  db.exec("ALTER TABLE message ADD COLUMN run_id TEXT");
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

/**
 * Spec 46 §4.1 — REX's own LiteLLM. A **permanent row**, exactly as `Original` is.
 *
 * It is never created and never deleted by a person; a switch turns its process
 * on and off. Its providers, models and keys are kept either way, and §4.1's
 * whole point is that they are: "it's already the second time that he is
 * enabling it and he already has some configuration — we should not force him
 * to fill it in again." `enabled` is the only column the switch writes.
 */
export const BUILTIN_GATEWAY_ID = "rex-builtin";
export const BUILTIN_GATEWAY_NAME = "Built-in";

/**
 * Spec 46 §4.2 — the port the built-in row is seeded with.
 *
 * A starting point and not a promise: if the port is taken the child walks up,
 * and §4.2.1 rewrites these four rows with the port it really got **before
 * anything can resolve one**. `resolveRoute()` returns `route.baseUrl` as
 * stored, so a stale row here would resolve to a dead address and the failure
 * would look like a broken gateway rather than a moved port.
 */
export const BUILTIN_GATEWAY_PORT = 24334;

/** §7.1 — the variable REX sets in its own process while the child runs. */
export const BUILTIN_GATEWAY_KEY_VAR = "REX_GATEWAY_KEY";

/** Spec 42 §5.1's four SDK names, so specs 44, 47 and 48 add rows and no migration. */
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
      -- 'stored' is spec 46 §7. Written here as well as in schema.sql, because
      -- THIS is the function that creates the table on a database made before
      -- spec 43 — one created in the old shape would need widenRouteAuth to
      -- rebuild it moments later for nothing. No backticks: this string is a
      -- template literal, and one would end it.
      auth            TEXT NOT NULL
                        CHECK (auth IN ('inherit','none','environment','stored')),
      credential_env  TEXT,
      token_cipher    BLOB,
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
 * Spec 46 §4.1 and §15 steps 1, 4 — the switch, and the permanent row it belongs to.
 *
 * Two steps, and both are **additive**. Nothing is deleted here: §15 step 2 —
 * removing every `envoy` and `custom` row — is milestone 3, and doing it early
 * would take away the reviewer's working gateways before their replacement had
 * been proven. The `CHECK` therefore still admits all five kinds.
 *
 * 1. `agent_gateway.enabled`, defaulting to 1 so every existing row keeps
 *    behaving exactly as it did. **Only the built-in row is ever 0.**
 * 2. The `builtin` row, `enabled = 0`, with a route for all four SDKs. Off,
 *    because a switch that is already on the first time a person opens REX
 *    would spend 296 MB and 1.6 seconds on something nobody asked for.
 *
 * Returns true when it created the row.
 */
export function migrateBuiltinGateway(db: Db): boolean {
  if (!hasColumn(db, "agent_gateway", "enabled")) {
    db.exec("ALTER TABLE agent_gateway ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }
  widenGatewayKinds(db);

  const already = db
    .prepare<[string], { id: string }>("SELECT id FROM agent_gateway WHERE id = ?")
    .get(BUILTIN_GATEWAY_ID);
  if (already) return false;

  const at = new Date().toISOString();
  const host = `http://127.0.0.1:${BUILTIN_GATEWAY_PORT}`;
  db.transaction(() => {
    db.prepare(
      "INSERT INTO agent_gateway (id, name, kind, enabled, created_at) VALUES (?, ?, 'builtin', 0, ?)",
    ).run(BUILTIN_GATEWAY_ID, BUILTIN_GATEWAY_NAME, at);
    const route = db.prepare(
      `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
       VALUES (?, ?, ?, 'environment', ?, '')`,
    );
    for (const sdk of EVERY_SDK) {
      // Spec 43 §3's trap, and spec 46 §4.5's answer. The Claude SDK appends
      // `/v1/messages` itself, so its base is the ROOT; the other three address
      // `/v1`. One alias then serves all four, which is why the open problem in
      // spec 45's folder has no instances left once this gateway is the one.
      const base = sdk === "claude-agent" ? host : `${host}/v1`;
      route.run(BUILTIN_GATEWAY_ID, sdk, base, BUILTIN_GATEWAY_KEY_VAR);
    }
  })();
  return true;
}

/**
 * Spec 46 §11 and §15 step 5 — the providers behind the built-in gateway.
 *
 * Two tables and one column, all additive, all idempotent.
 *
 * **`key_cipher` and `token_cipher` are BLOBs and never TEXT**, and that is not
 * a storage detail: a `TEXT` column invites somebody to put a key in it during
 * a debugging session, and §7.1 is that no credential is readable on disk,
 * ever. `safeStorage` hands back a `Buffer`, so the column that holds it is the
 * shape that cannot hold anything else.
 */
export function migrateGatewayProviders(db: Db): boolean {
  const fresh = !hasTable(db, "gateway_provider");
  db.exec(`
    CREATE TABLE IF NOT EXISTS gateway_provider (
      id           TEXT PRIMARY KEY,
      -- A ProviderDescriptor id (§5.2). Not a foreign key: the catalogue is
      -- code, not a table, and a provider REX stops knowing must leave a row
      -- that can be read and removed rather than one that cannot be loaded.
      provider     TEXT NOT NULL,
      label        TEXT NOT NULL,
      -- Null for a provider with a fixed endpoint (OpenAI, OpenRouter, Anthropic).
      base_url     TEXT,
      -- §7 — safeStorage ciphertext. NEVER text.
      key_cipher   BLOB,
      -- When its models were last asked for. §6's rule: a list that silently
      -- ages is how a person concludes their provider is broken when it merely
      -- gained a model.
      listed_at    TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gateway_model (
      provider_id  TEXT NOT NULL REFERENCES gateway_provider(id) ON DELETE CASCADE,
      -- The provider's own id, verbatim. The one field never normalised.
      model        TEXT NOT NULL,
      -- The LiteLLM model_name REX generates. A person never types one (§11).
      alias        TEXT NOT NULL,
      max_input    INTEGER,
      max_output   INTEGER,
      -- 1 yes, 0 no, NULL the provider did not say (§5.5). NULL is a real
      -- answer and must not be read as "no".
      tools        INTEGER,
      PRIMARY KEY (provider_id, model)
    );
  `);

  // §7 — an external gateway's key, beside the row it belongs to. `credential_env`
  // stays, unused by new rows: dropping a column rewrites a table in SQLite and
  // the column is harmless. A row has one or the other, never both.
  if (!hasColumn(db, "gateway_route", "token_cipher")) {
    db.exec("ALTER TABLE gateway_route ADD COLUMN token_cipher BLOB");
  }
  return fresh;
}

/**
 * Spec 46 §15 step 2 and §3.1 — `envoy` and `custom` leave, and are named once.
 *
 * **There is no deprecation period**, because the only person with rows of
 * either kind is the reviewer. Deletion is correct rather than harsh:
 *
 * - A row that cannot run must not be selectable, and a gateway whose product
 *   REX no longer supports cannot run. That rule is already in the schema
 *   (spec 43 §2.2's `CHECK (auth <> 'none' OR base_url IS NOT NULL)`).
 * - **No history is lost.** Spec 43 §2.6 rule 2 copies the SDK, gateway name,
 *   base URL and model onto every message, so an old answer still says which
 *   gateway produced it after that gateway is gone.
 * - `thread_session` rows cascade, so a deleted gateway costs a **replay** on a
 *   thread that used it, never the thread.
 *
 * The names are written into a setting rather than only logged, because §15
 * says the Settings screen shows the note *once* — and a note that only exists
 * in a log is a note nobody reads.
 *
 * Returns the names it deleted, newest configuration first.
 */
export function migrateRetireGatewayKinds(db: Db): string[] {
  if (!hasTable(db, "agent_gateway")) return [];

  const doomed = db
    .prepare<[], { id: string; name: string; kind: string }>(
      "SELECT id, name, kind FROM agent_gateway WHERE kind IN ('envoy','custom')",
    )
    .all();

  if (doomed.length > 0) {
    db.transaction(() => {
      const remove = db.prepare("DELETE FROM agent_gateway WHERE id = ?");
      for (const row of doomed) remove.run(row.id);
      // Remembered so the screen can say it once. Appended rather than
      // replaced: a database migrated in two steps must not lose the first
      // step's names. Guarded, because a note nobody reads must never be the
      // reason a migration that deleted rows fails half-way.
      if (hasTable(db, "setting")) {
        const already = getSetting(db, RETIRED_GATEWAYS_KEY);
        const names = [...(already ? already.split("\n") : []), ...doomed.map((row) => row.name)];
        setSetting(db, RETIRED_GATEWAYS_KEY, [...new Set(names)].join("\n"));
      }
    })();
  }

  narrowGatewayKinds(db);
  widenRouteAuth(db);
  return doomed.map((row) => row.name);
}

/** §15 — the names removed, for the one note the Settings screen shows. */
export const RETIRED_GATEWAYS_KEY = "gateway.retired";

/**
 * Narrow `agent_gateway.kind` to the three §3 leaves.
 *
 * It runs **after** the delete, and it must: SQLite validates a `CHECK` against
 * every row while copying the table, so narrowing first would fail on exactly
 * the rows the step before removes.
 */
function narrowGatewayKinds(db: Db): void {
  const table = db
    .prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_gateway'",
    )
    .get();
  if (!table?.sql.includes("'envoy'")) return;

  // `migrateBuiltinGateway` adds this column, and `database.ts` runs it first.
  // Guarded for the same reason `widenRouteAuth` guards `token_cipher`: a
  // migration must not depend on a sibling having run, because the order in
  // one file is not a guarantee the next person keeps.
  if (!hasColumn(db, "agent_gateway", "enabled")) {
    db.exec("ALTER TABLE agent_gateway ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }

  rebuild(db, () => {
    db.exec(`
      CREATE TABLE agent_gateway_new (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL
                      CHECK (kind IN ('original','builtin','litellm')),
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      );
      INSERT INTO agent_gateway_new (id, name, kind, enabled, created_at)
        SELECT id, name, kind, enabled, created_at FROM agent_gateway;
      DROP TABLE agent_gateway;
      ALTER TABLE agent_gateway_new RENAME TO agent_gateway;
    `);
  });
}

/**
 * Spec 46 §7 — `gateway_route.auth` gains `stored`.
 *
 * The host keeps the value, encrypted by the operating system's keystore, in
 * `token_cipher` on this row. `credential_env` stays for the rows spec 43 wrote
 * and for the built-in gateway, whose key is random per launch and lives in an
 * environment and nowhere else — **a row has one or the other, never both**,
 * and the two CHECKs below are what make that true rather than intended.
 */
function widenRouteAuth(db: Db): void {
  const table = db
    .prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'gateway_route'",
    )
    .get();
  if (!table || table.sql.includes("'stored'")) return;

  // `migrateGatewayProviders` adds this column, and `database.ts` runs it
  // first. **A migration must not depend on a sibling having run** — the order
  // in one file is not a guarantee the next person keeps, and the failure is a
  // rebuild that drops a column it was copying. Caught by a test that called
  // this one on its own.
  if (!hasColumn(db, "gateway_route", "token_cipher")) {
    db.exec("ALTER TABLE gateway_route ADD COLUMN token_cipher BLOB");
  }

  rebuild(db, () => {
    db.exec(`
      CREATE TABLE gateway_route_new (
        gateway_id      TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
        sdk             TEXT NOT NULL
                          CHECK (sdk IN ('claude-agent','codex','opencode','deep-agents')),
        base_url        TEXT,
        auth            TEXT NOT NULL
                          CHECK (auth IN ('inherit','none','environment','stored')),
        credential_env  TEXT,
        token_cipher    BLOB,
        models          TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (gateway_id, sdk),
        CHECK (
          (auth = 'environment' AND credential_env IS NOT NULL) OR
          (auth <> 'environment' AND credential_env IS NULL)
        ),
        CHECK (auth <> 'none' OR base_url IS NOT NULL),
        -- A stored key needs somewhere to send it, and must not also name a
        -- variable: two credentials on one row is one credential too many.
        CHECK (auth <> 'stored' OR base_url IS NOT NULL)
      );
      INSERT INTO gateway_route_new
             (gateway_id, sdk, base_url, auth, credential_env, token_cipher, models)
        SELECT gateway_id, sdk, base_url, auth, credential_env, token_cipher, models
          FROM gateway_route;
      DROP TABLE gateway_route;
      ALTER TABLE gateway_route_new RENAME TO gateway_route;
    `);
  });
}

/**
 * Rebuild a table with foreign keys off, so a `DROP` cascades nothing away.
 *
 * `gateway_route` and `thread_session` both reference `agent_gateway`
 * `ON DELETE CASCADE`. Dropping either table with the pragma on would take
 * every route and every session with it — the migration would report success
 * and leave a database with no gateways at all.
 */
function rebuild(db: Db, work: () => void): void {
  const wasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  if (wasOn) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(work)();
  } finally {
    if (wasOn) db.pragma("foreign_keys = ON");
  }
}

/**
 * Widen `agent_gateway.kind` so a `builtin` row can exist at all.
 *
 * SQLite has no `ALTER TABLE … DROP CONSTRAINT`, so changing a `CHECK` means
 * rebuilding the table. Guarded on the constraint's own text rather than on a
 * column, because there is no column to look at — and the guard is what keeps
 * this idempotent instead of rewriting a table on every open.
 *
 * `PRAGMA foreign_keys` is turned off around the swap. `gateway_route` and
 * `thread_session` both reference this table `ON DELETE CASCADE`, and dropping
 * it with them enforced would cascade away every route and every session — the
 * migration would "succeed" and leave a database with no gateways at all.
 */
function widenGatewayKinds(db: Db): void {
  const table = db
    .prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_gateway'",
    )
    .get();
  if (!table || table.sql.includes("'builtin'")) return;

  const wasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  if (wasOn) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE agent_gateway_new (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          kind        TEXT NOT NULL
                        CHECK (kind IN ('original','builtin','litellm','envoy','custom')),
          enabled     INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL
        );
        INSERT INTO agent_gateway_new (id, name, kind, enabled, created_at)
          SELECT id, name, kind, enabled, created_at FROM agent_gateway;
        DROP TABLE agent_gateway;
        ALTER TABLE agent_gateway_new RENAME TO agent_gateway;
      `);
    })();
  } finally {
    if (wasOn) db.pragma("foreign_keys = ON");
  }
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
