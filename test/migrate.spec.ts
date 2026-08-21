// Spec 06 §5.4 and §10 milestone 7 — the guarded `ALTER TABLE`, run twice.
//
// A migration is the one piece of code whose second run matters as much as its
// first: it executes on every open, against a database that already holds
// somebody's comments. `schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so a
// column added to the file reaches a fresh database and no existing one — this
// is what closes that gap, and the test is that closing it twice is the same as
// closing it once.
//
// Against a real SQLite file, not a mock: the thing being asserted is what
// SQLite does with `PRAGMA table_info` and `ALTER TABLE`.
//
// Run: npm run test:migrate

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { migrateThreadStroke } from "../src/main/db/migrate.ts";

const work = mkdtempSync(join(tmpdir(), "rex-migrate-"));
after(() => rmSync(work, { recursive: true, force: true }));

/** A `thread` table as it stood before spec 06 — no `stroke_json`. */
function openPreSpec06(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             document_id TEXT NOT NULL,
             kind        TEXT NOT NULL,
             status      TEXT NOT NULL DEFAULT 'open',
             note        TEXT NOT NULL,
             created_at  TEXT NOT NULL,
             updated_at  TEXT NOT NULL
           )`);
  return db;
}

const columns = (db: Database.Database): string[] =>
  db
    .prepare<[], { name: string }>("PRAGMA table_info(thread)")
    .all()
    .map((row) => row.name);

test("it adds stroke_json to a database that predates the pen", () => {
  const db = openPreSpec06("before.db");
  assert.equal(columns(db).includes("stroke_json"), false);

  assert.equal(migrateThreadStroke(db), true);
  assert.equal(columns(db).includes("stroke_json"), true);
  db.close();
});

test("running it twice changes nothing the second time", () => {
  const db = openPreSpec06("twice.db");
  migrateThreadStroke(db);
  const afterFirst = columns(db);

  // The second run is the one that happens on every subsequent open, forever.
  assert.equal(migrateThreadStroke(db), false);
  assert.deepEqual(columns(db), afterFirst);
  // And exactly one such column, rather than a second silently appended.
  assert.equal(afterFirst.filter((name) => name === "stroke_json").length, 1);
  db.close();
});

test("existing rows survive it, and read as not drawn", () => {
  const db = openPreSpec06("rows.db");
  db.prepare(
    "INSERT INTO thread (id, document_id, kind, status, note, created_at, updated_at) VALUES (?, ?, 'anchored', 'open', ?, ?, ?)",
  ).run("t1", "d1", "Does this still hold?", "2026-08-21", "2026-08-21");

  migrateThreadStroke(db);

  const row = db
    .prepare<[], { note: string; stroke_json: string | null }>(
      "SELECT note, stroke_json FROM thread WHERE id = 't1'",
    )
    .get();
  assert.equal(row?.note, "Does this still hold?");
  // NULL has a meaning — "this comment was not drawn" — which is what every row
  // written before the column existed in fact was.
  assert.equal(row?.stroke_json, null);
  db.close();
});

test("a database created with the column already there is left alone", () => {
  const db = new Database(join(work, "fresh.db"));
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             note        TEXT NOT NULL,
             stroke_json TEXT
           )`);
  assert.equal(migrateThreadStroke(db), false);
  assert.equal(columns(db).includes("stroke_json"), true);
  db.close();
});
