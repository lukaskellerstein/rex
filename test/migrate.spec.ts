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
  migrateMessageDenied,
  migrateNoteFlag,
  migrateThreadLanes,
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

// ── `message.denied` — the one migration that has to READ the old rows ──
//
// Every other column here is added with a default that is right for everything
// written before it. This one is not: `denied = 0` for every old row would say
// that REX's gate never refused anything, and the refusals it did make are in
// the database being upgraded. So the backfill reads them back out of the
// `Denied …` notes the run wrote beside them.

/** A `message` table as it stood before the column, with no `denied`. */
function openPreDenied(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.exec(`CREATE TABLE message (
             id        TEXT PRIMARY KEY,
             thread_id TEXT NOT NULL,
             seq       INTEGER NOT NULL,
             role      TEXT NOT NULL,
             kind      TEXT NOT NULL,
             content   TEXT,
             tool_name TEXT,
             is_error  INTEGER NOT NULL DEFAULT 0
           )`);
  return db;
}

let messageSeq = 0;

function addMessage(
  db: Database.Database,
  threadId: string,
  role: string,
  kind: string,
  content: string,
  isError = false,
): void {
  db.prepare(
    "INSERT INTO message (id, thread_id, seq, role, kind, content, tool_name, is_error) VALUES (?, ?, ?, ?, ?, ?, 'Bash', ?)",
  ).run(`m${messageSeq}`, threadId, messageSeq++, role, kind, content, isError ? 1 : 0);
}

const deniedFlags = (db: Database.Database): number[] =>
  db
    .prepare<[], { denied: number }>(
      "SELECT denied FROM message WHERE kind = 'tool_result' ORDER BY seq",
    )
    .all()
    .map((row) => row.denied);

test("the backfill marks the refusals the notes prove, and nothing else", () => {
  const db = openPreDenied("denied.db");
  const gate = "A read session cannot change any file: 'rm' is not on the allowlist ('rm x').";

  // Three results that all carry is_error, and only the first is a refusal.
  addMessage(db, "t", "user", "tool_result", gate, true);
  addMessage(db, "t", "user", "tool_result", "Exit code 1\n(eval):1: == not found", true);
  addMessage(db, "t", "user", "tool_result", "docs/architecture/components.md:421:manifest");
  addMessage(db, "t", "system", "text", `Denied Bash: ${gate}`);

  assert.equal(migrateMessageDenied(db), 1);
  assert.deepEqual(deniedFlags(db), [1, 0, 0]);

  // The second run is the one that happens on every subsequent open, forever.
  assert.equal(migrateMessageDenied(db), 0);
  assert.deepEqual(deniedFlags(db), [1, 0, 0]);
  db.close();
});

test("a refusal in another comment does not mark this one's failure", () => {
  // The notes and the results are matched inside one thread. Without that, a
  // reason that appears anywhere in the database marks every result that
  // repeats it — and the gate's sentences are fixed prose, so they repeat often.
  const db = openPreDenied("denied-threads.db");
  const gate = "MCP tools are deny-by-default in a read session.";

  addMessage(db, "other", "system", "text", `Denied Bash: ${gate}`);
  addMessage(db, "mine", "user", "tool_result", gate, true);

  assert.equal(migrateMessageDenied(db), 0);
  assert.deepEqual(deniedFlags(db), [0]);
  db.close();
});

test("the SDK's own refusal is a refusal, with no note to prove it", () => {
  // It leaves no `Denied …` note because REX's gate never saw it. The call did
  // not run, so FAILED would be as wrong as DENIED was for a shell error.
  const db = openPreDenied("denied-sdk.db");

  addMessage(
    db,
    "t",
    "user",
    "tool_result",
    "Permission to use Bash with command find . -type f has been denied.",
    true,
  );
  // A search whose OUTPUT quotes that sentence, and which then exited 1. It
  // ran. Only a message that IS the sentence, end to end, is a refusal.
  addMessage(
    db,
    "t",
    "user",
    "tool_result",
    "Exit code 1\nrex.log:41:Permission to use Bash with command find . has been denied.",
    true,
  );

  assert.equal(migrateMessageDenied(db), 1);
  assert.deepEqual(deniedFlags(db), [1, 0]);
  db.close();
});

test("a reason holding a LIKE wildcard is still matched", () => {
  // `instr` and not LIKE. A gate reason is REX's own prose about the reviewer's
  // own command, so `%` and `_` turn up in it — and under LIKE they would be
  // wildcards, which matches the wrong rows rather than none.
  const db = openPreDenied("denied-wildcard.db");
  const gate = "Bash may not redirect ('printf 100%_done > out.txt').";

  addMessage(db, "t", "user", "tool_result", gate, true);
  addMessage(db, "t", "system", "text", `Denied Bash: ${gate}`);

  assert.equal(migrateMessageDenied(db), 1);
  assert.deepEqual(deniedFlags(db), [1]);
  db.close();
});

// ── Spec 30 §7.1 — the `draft` and `note` lanes ─────────────────
//
// The first migration in the tree that REBUILDS a table, so it carries more
// assertions than the guarded `ALTER TABLE`s above. What can go wrong with a
// rebuild is not "did the column arrive" but "did everything else survive it":
// the rows, the child rows that reference them, and the indexes the drop takes
// with the table.

/** A `thread` table with spec 18's two-lane CHECK, and the children that hang off it. */
function openTwoLane(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             document_id TEXT NOT NULL,
             kind        TEXT NOT NULL CHECK (kind IN ('anchored','synthesis')),
             status      TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','resolved')),
             note        TEXT NOT NULL,
             is_note     INTEGER NOT NULL DEFAULT 0,
             position    INTEGER NOT NULL DEFAULT 0,
             profile     TEXT NOT NULL DEFAULT 'read'
                           CHECK (profile IN ('read','write')),
             created_at  TEXT NOT NULL,
             updated_at  TEXT NOT NULL
           );
           CREATE INDEX idx_thread_doc ON thread(document_id, status);
           CREATE TABLE thread_target (
             thread_id   TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
             position    INTEGER NOT NULL,
             anchor_json TEXT NOT NULL,
             PRIMARY KEY (thread_id, position)
           )`);
  const add = db.prepare(
    `INSERT INTO thread (id, document_id, kind, status, note, is_note, created_at, updated_at)
     VALUES (?, 'd1', 'anchored', ?, ?, ?, 't', 't')`,
  );
  add.run("plain", "open", "an ordinary comment", 0);
  add.run("saved", "open", "a note the reviewer kept", 1);
  add.run("done", "resolved", "a note that was dealt with", 1);
  db.prepare(
    "INSERT INTO thread_target (thread_id, position, anchor_json) VALUES (?, 0, '{}')",
  ).run("saved");
  return db;
}

const lane = (db: Database.Database, id: string): string =>
  db.prepare<[string], { status: string }>("SELECT status FROM thread WHERE id = ?").get(id)
    ?.status ?? "missing";

test("it widens the status CHECK, so a draft can be written at all", () => {
  const db = openTwoLane("lanes.db");
  assert.throws(() => db.prepare("UPDATE thread SET status = 'draft' WHERE id = 'plain'").run());

  assert.equal(migrateThreadLanes(db), true);
  db.prepare("UPDATE thread SET status = 'draft' WHERE id = 'plain'").run();
  assert.equal(lane(db, "plain"), "draft");
  db.close();
});

test("an open note moves to the note lane and a resolved one does not", () => {
  // Spec 18 §2 — resolved is terminal, and it is older than spec 30. A note
  // that was dealt with is dealt with; putting it back in an unsent lane would
  // reopen a comment nobody touched.
  const db = openTwoLane("lanes-note.db");
  migrateThreadLanes(db);
  assert.equal(lane(db, "saved"), "note");
  assert.equal(lane(db, "done"), "resolved");
  assert.equal(lane(db, "plain"), "open");
  db.close();
});

test("the rebuild keeps every row, its children and its indexes", () => {
  const db = openTwoLane("lanes-survive.db");
  migrateThreadLanes(db);

  const ids = db
    .prepare<[], { id: string }>("SELECT id FROM thread ORDER BY id")
    .all()
    .map((row) => row.id);
  assert.deepEqual(ids, ["done", "plain", "saved"]);

  // The child row is the one a rebuild can lose: it is dropped and recreated
  // with foreign keys off, so nothing complains if it goes.
  const targets = db
    .prepare<[], { thread_id: string }>("SELECT thread_id FROM thread_target")
    .all();
  assert.deepEqual(targets, [{ thread_id: "saved" }]);

  // Dropping a table drops its indexes with it, so they are replayed by hand.
  const indexes = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'thread' AND sql IS NOT NULL",
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(indexes, ["idx_thread_doc"]);

  // And the cascade still works, which is what proves the child rows found the
  // rebuilt table rather than merely outliving the old one.
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM thread WHERE id = 'saved'").run();
  assert.equal(
    db.prepare<[], { n: number }>("SELECT count(*) AS n FROM thread_target").get()?.n,
    0,
  );
  db.close();
});

test("running the lane migration twice changes nothing the second time", () => {
  const db = openTwoLane("lanes-twice.db");
  assert.equal(migrateThreadLanes(db), true);
  const before = db
    .prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'thread'",
    )
    .get()?.sql;

  assert.equal(migrateThreadLanes(db), false);
  const after = db
    .prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'thread'",
    )
    .get()?.sql;
  assert.equal(after, before);
  db.close();
});

test("a table with no status CHECK is left exactly as it was", () => {
  // Every hand-built fixture in this file is that shape, and so is a database
  // old enough to predate the constraint. It already accepts the new values, so
  // there is nothing to rebuild and nothing to risk.
  const db = openWithStroke("lanes-uncheck.db");
  assert.equal(migrateThreadLanes(db), false);
  db.close();
});
