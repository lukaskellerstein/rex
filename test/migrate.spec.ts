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
import {
  migrateCommentOrder,
  migrateNoteFlag,
  migrateThreadStroke,
} from "../src/main/db/migrate.ts";

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

// ── Spec 14 §6.2 — the name, the group and the order ────────────
//
// The one thing this migration must not do is reshuffle somebody's comments.
// `position` is filled from the created_at rank, which is the order
// `listThreads` used before spec 14, so a reviewer who upgrades sees the list
// they closed in the order they closed it.

/** A `thread` table as it stood before spec 14 — no title, group or position. */
function openPreSpec14(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             document_id TEXT NOT NULL,
             kind        TEXT NOT NULL,
             status      TEXT NOT NULL DEFAULT 'open',
             note        TEXT NOT NULL,
             created_at  TEXT NOT NULL,
             updated_at  TEXT NOT NULL
           );
           CREATE TABLE comment_group (
             id         TEXT PRIMARY KEY,
             root       TEXT NOT NULL,
             parent_id  TEXT REFERENCES comment_group(id) ON DELETE CASCADE,
             name       TEXT NOT NULL,
             position   INTEGER NOT NULL,
             collapsed  INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL
           )`);
  return db;
}

function addThread(db: Database.Database, id: string, createdAt: string): void {
  db.prepare(
    "INSERT INTO thread (id, document_id, kind, status, note, created_at, updated_at) VALUES (?, 'd1', 'anchored', 'open', ?, ?, ?)",
  ).run(id, `note for ${id}`, createdAt, createdAt);
}

test("it adds the three spec 14 columns", () => {
  const db = openPreSpec14("s14-columns.db");
  assert.equal(migrateCommentOrder(db), 0);
  for (const column of ["title", "group_id", "position"]) {
    assert.equal(columns(db).includes(column), true, `missing ${column}`);
  }
  db.close();
});

test("the order after the upgrade is exactly the order before it", () => {
  const db = openPreSpec14("s14-order.db");
  // Deliberately inserted out of order, so a migration that ranked by rowid
  // rather than by created_at would pass by accident.
  addThread(db, "c", "2026-08-03T10:00:00.000Z");
  addThread(db, "a", "2026-08-01T10:00:00.000Z");
  addThread(db, "b", "2026-08-02T10:00:00.000Z");

  assert.equal(migrateCommentOrder(db), 3);

  const byPosition = db
    .prepare<[], { id: string }>("SELECT id FROM thread ORDER BY position, created_at")
    .all()
    .map((row) => row.id);
  const byClock = db
    .prepare<[], { id: string }>("SELECT id FROM thread ORDER BY created_at")
    .all()
    .map((row) => row.id);

  assert.deepEqual(byPosition, byClock);
  assert.deepEqual(byPosition, ["a", "b", "c"]);
  db.close();
});

test("it invents no name and no group", () => {
  const db = openPreSpec14("s14-nulls.db");
  addThread(db, "a", "2026-08-01T10:00:00.000Z");
  migrateCommentOrder(db);

  const row = db
    .prepare<[], { title: string | null; group_id: string | null; note: string }>(
      "SELECT title, group_id, note FROM thread WHERE id = 'a'",
    )
    .get();
  // NULL title is "named by the note" (§3.1), not "unnamed".
  assert.equal(row?.title, null);
  assert.equal(row?.group_id, null);
  assert.equal(row?.note, "note for a");
  db.close();
});

test("running the spec 14 migration twice changes nothing", () => {
  const db = openPreSpec14("s14-twice.db");
  addThread(db, "a", "2026-08-01T10:00:00.000Z");
  addThread(db, "b", "2026-08-02T10:00:00.000Z");
  migrateCommentOrder(db);

  // Somebody reorders their comments, and then reopens REX. The second run must
  // not undo the drag they just did.
  db.prepare("UPDATE thread SET position = 0 WHERE id = 'b'").run();
  db.prepare("UPDATE thread SET position = 1 WHERE id = 'a'").run();

  assert.equal(migrateCommentOrder(db), 0);
  const order = db
    .prepare<[], { id: string }>("SELECT id FROM thread ORDER BY position")
    .all()
    .map((row) => row.id);
  assert.deepEqual(order, ["b", "a"]);
  assert.equal(columns(db).filter((name) => name === "position").length, 1);
  db.close();
});

test("the walk index the panel needs is created", () => {
  const db = openPreSpec14("s14-index.db");
  migrateCommentOrder(db);
  const indexes = db
    .prepare<[], { name: string }>("PRAGMA index_list(thread)")
    .all()
    .map((row) => row.name);
  assert.equal(indexes.includes("idx_thread_group"), true);
  db.close();
});

test("the note flag is added to a database that predates NOTE mode", () => {
  const db = openPreSpec14("note-flag.db");
  addThread(db, "a", "2026-08-01T10:00:00.000Z");
  assert.equal(columns(db).includes("is_note"), false);

  assert.equal(migrateNoteFlag(db), true);
  assert.equal(columns(db).includes("is_note"), true);
  // 0 is right for every row written before it: every comment REX could make
  // until now was sent the moment it was created.
  const row = db
    .prepare<[], { is_note: number }>("SELECT is_note FROM thread WHERE id = 'a'")
    .get();
  assert.equal(row?.is_note, 0);

  // The second run is the one that happens on every subsequent open, forever.
  assert.equal(migrateNoteFlag(db), false);
  assert.equal(columns(db).filter((name) => name === "is_note").length, 1);
  db.close();
});
