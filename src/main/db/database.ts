// SPEC.md §9 — the database lives at ~/.rex/rex.db, outside every repository,
// so it can never be committed by accident.
//
// Invariant I2: this module is reachable only from the main process.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { getLoadablePath } from "sqlite-vec";
import { DB_PATH } from "./location.ts";
import { migrateThreadStroke, migrateThreadTargets } from "./migrate.ts";
import schema from "./schema.sql?raw";

export type Db = Database.Database;

let handle: Db | null = null;

/** Opens (and on first use creates) the database, applying §9's schema. */
export function openDatabase(): Db {
  if (handle) return handle;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  configureConnection(db);
  loadVectorExtension(db);
  db.exec(schema);
  addMissingColumns(db);
  // Spec 06 §5.4 — the pen's ink. In `migrate.ts` rather than in the table
  // above, so `node --test` can run it twice and prove the second run changes
  // nothing; `database.ts` imports `schema.sql?raw`, which plain node cannot
  // load.
  migrateThreadStroke(db);
  // Spec 05 §5.2 — anchors move out of `thread` and into `thread_target`. After
  // the columns exist, because it reads them.
  migrateThreadTargets(db);

  handle = db;
  return db;
}

/**
 * The per-connection settings. Applied to **every** handle, including the
 * `utilityProcess`'s (spec 07 §10.1) — which is why it is exported.
 *
 * `journal_mode` and `foreign_keys` are in schema.sql too, but journal_mode is a
 * per-database property and foreign_keys a per-connection one, so the latter is
 * set here as well: a connection that skipped it would silently accept orphan
 * rows.
 */
export function configureConnection(db: Db): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Spec 07 §10.1 — REX became a two-writer application when the fact build
  // moved into a utilityProcess, and this pragma was not set. Without it the
  // two processes meet on a write and one throws SQLITE_BUSY *immediately*
  // rather than waiting — intermittently, under load, which is the worst way to
  // find a bug. WAL already lets readers and the writer pass each other; this
  // covers the moment two writers genuinely collide.
  db.pragma("busy_timeout = 5000");
}

/**
 * Spec 07 §6.2 — `sqlite-vec`, the one new storage dependency, loaded onto the
 * handle the threads already live on. §10.2 puts the load here and the queries
 * in `facts/store.ts`.
 *
 * A loadable extension rather than a native addon, so it needs no
 * `electron-rebuild`: it links against SQLite's own extension ABI, not
 * Electron's. That is a smaller risk than §10.1 assumed.
 *
 * It is allowed to fail. The fact graph is one feature, and §6.1 makes its
 * tables a cache — an Electron build where the `.dylib` cannot be loaded (an
 * unsupported platform, or an `app.asar` that packed it unextracted) must still
 * open documents and answer comments. So this reports rather than throws, and
 * `factsAvailable()` is what the Facts tab asks before offering to build.
 */
let vectorExtension: { loaded: boolean; reason: string | null } = {
  loaded: false,
  reason: "not attempted",
};

export function loadVectorExtension(db: Db): void {
  try {
    db.loadExtension(getLoadablePath());
    vectorExtension = { loaded: true, reason: null };
  } catch (error) {
    vectorExtension = {
      loaded: false,
      reason: error instanceof Error ? error.message : String(error),
    };
    console.warn(
      `[rex] sqlite-vec did not load; the fact graph is unavailable. ${vectorExtension.reason}`,
    );
  }
}

/** Whether spec 07's pipeline can run on this machine, and why not if it cannot. */
export function vectorSearchStatus(): { loaded: boolean; reason: string | null } {
  return vectorExtension;
}

/**
 * Columns added after a database was first created.
 *
 * `schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so a table that already
 * exists is left exactly as it was — a column added to the file reaches a fresh
 * database and no existing one. Every column here must therefore be nullable
 * and have a meaning when absent, because old rows will not have it.
 */
function addMissingColumns(db: Db): void {
  const wanted: ReadonlyArray<{ table: string; column: string; type: string }> = [
    // Multi-target comments. NULL reads as "one target", which is what every
    // row written before this column existed was.
    { table: "thread", column: "extra_anchors_json", type: "TEXT" },
    // Spec 07 §6.4 — how many items the running stage is counting. 0 reads as
    // "this build never reported a total", which is exactly true of a row
    // written before the column existed, and makes the tab say "0 of 0" rather
    // than inventing a denominator.
    { table: "fact_run", column: "total", type: "INTEGER NOT NULL DEFAULT 0" },
    // Spec 07 §4.7 — per-document resume. 0 reads as "start this document from
    // the beginning", which is the only safe reading for a row written before
    // partial progress was recorded at all.
    { table: "fact_document", column: "chunks_done", type: "INTEGER NOT NULL DEFAULT 0" },
  ];

  for (const { table, column, type } of wanted) {
    const present = db
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .some((row) => row.name === column);
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function closeDatabase(): void {
  handle?.close();
  handle = null;
}
