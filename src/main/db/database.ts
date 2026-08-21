// SPEC.md §9 — the database lives at ~/.rex/rex.db, outside every repository,
// so it can never be committed by accident.
//
// Invariant I2: this module is reachable only from the main process.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "./location.ts";
import schema from "./schema.sql?raw";

export type Db = Database.Database;

let handle: Db | null = null;

/** Opens (and on first use creates) the database, applying §9's schema. */
export function openDatabase(): Db {
  if (handle) return handle;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  // WAL and foreign keys are in schema.sql, but journal_mode is a per-database
  // property and foreign_keys a per-connection one, so the latter is set here
  // too — a connection that skipped it would silently accept orphan rows.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  addMissingColumns(db);

  handle = db;
  return db;
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
