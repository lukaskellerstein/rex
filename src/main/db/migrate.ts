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
