// The guarded `ALTER TABLE`, run twice.
//
// A migration is the one piece of code whose second run matters as much as its
// first: it executes on every open, against a database that already holds
// somebody's comments. `schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so a
// column that changed in the file reaches a fresh database and no existing one
// — these are what close that gap, and the test is that closing it twice is the
// same as closing it once.
//
// One of them REMOVES a column (`stroke_json`, 2026-08-26), so it carries the
// extra assertion the others do not need: that the comments are all still
// there afterwards.
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

/** A `thread` table carrying the ink, as it stood while the pen kept it. */
function openWithStroke(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             document_id TEXT NOT NULL,
             kind        TEXT NOT NULL,
             status      TEXT NOT NULL DEFAULT 'open',
             note        TEXT NOT NULL,
             stroke_json TEXT,
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

test("it drops stroke_json from a database that kept the ink", () => {
  const db = openWithStroke("before.db");
  assert.equal(columns(db).includes("stroke_json"), true);

  assert.equal(migrateThreadStroke(db), true);
  assert.equal(columns(db).includes("stroke_json"), false);
  db.close();
});

test("running it twice changes nothing the second time", () => {
  const db = openWithStroke("twice.db");
  migrateThreadStroke(db);
  const afterFirst = columns(db);

  // The second run is the one that happens on every subsequent open, forever.
  assert.equal(migrateThreadStroke(db), false);
  assert.deepEqual(columns(db), afterFirst);
  db.close();
});

test("the comments survive it — only the ink goes", () => {
  const db = openWithStroke("rows.db");
  db.prepare(
    "INSERT INTO thread (id, document_id, kind, status, note, stroke_json, created_at, updated_at) VALUES (?, ?, 'anchored', 'open', ?, ?, ?, ?)",
  ).run(
    "t1",
    "d1",
    "Does this still hold?",
    JSON.stringify({ paths: [[{ x: 0.1, y: 0.2 }]], width: 2.5 }),
    "2026-08-21",
    "2026-08-21",
  );

  migrateThreadStroke(db);

  const row = db.prepare<[], { note: string }>("SELECT note FROM thread WHERE id = 't1'").get();
  assert.equal(row?.note, "Does this still hold?");
  db.close();
});

test("a database that never carried the column is left alone", () => {
  const db = new Database(join(work, "fresh.db"));
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             note        TEXT NOT NULL
           )`);
  assert.equal(migrateThreadStroke(db), false);
  assert.equal(columns(db).includes("stroke_json"), false);
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
