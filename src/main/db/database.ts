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

  handle = db;
  return db;
}

export function closeDatabase(): void {
  handle?.close();
  handle = null;
}
