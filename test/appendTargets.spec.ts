// Spec 24 §5 — a comment grows: more places, after the ones it has, tagged with
// the message that brought them.
//
// Against the real `schema.sql`, because what is asserted is what SQLite does:
// that positions continue rather than restart, that the tag lands on the right
// rows and only those, and that the migration adds the column once and never
// again. A fake would only prove the fake.
//
// Run: npm run test:append-targets

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { migrateTargetMessage } from "../src/main/db/migrate.ts";
import {
  appendMessage,
  appendTargets,
  commentCountsByDocument,
  createThread,
  getThread,
  upsertDocument,
} from "../src/main/db/queries.ts";
import type { Anchor } from "../src/shared/types.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

function database(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = ON");
  return db;
}

function anchorQuoting(exact: string): Anchor {
  return {
    quote: { exact, prefix: "", suffix: "" },
    position: null,
    element: null,
    region: null,
    source: null,
  };
}

function document(db: Database.Database, path: string): string {
  return upsertDocument(db, { kind: "file", value: path }, null, null).record.id;
}

/** The reviewer's own message, as `recordUserText` writes it. */
function userMessage(db: Database.Database, threadId: string, content: string): string {
  return appendMessage(db, threadId, {
    role: "user",
    kind: "text",
    mode: "ask",
    content,
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  }).id;
}

interface Row {
  position: number;
  document_id: string;
  message_id: string | null;
  anchor_state: string | null;
}

function rows(db: Database.Database, threadId: string): Row[] {
  return db
    .prepare<[string], Row>(
      "SELECT position, document_id, message_id, anchor_state FROM thread_target WHERE thread_id = ? ORDER BY position",
    )
    .all(threadId);
}

test("§5.2 — the places are appended after the ones the comment has, tagged with the message", () => {
  const db = database();
  const first = document(db, "/w/sample-document.md");
  const second = document(db, "/w/shared/components.md");
  const thread = createThread(db, {
    kind: "anchored",
    targets: [
      { documentId: first, anchor: anchorQuoting("one") },
      { documentId: first, anchor: anchorQuoting("two") },
      { documentId: first, anchor: anchorQuoting("three") },
    ],
    note: "Do these agree?",
    profile: "read",
  });
  const message = userMessage(db, thread.id, "Look — 4 says the opposite.");

  const targets = appendTargets(db, thread.id, message, [
    { documentId: second, anchor: anchorQuoting("four") },
    { documentId: second, anchor: anchorQuoting("five") },
  ]);

  assert.equal(targets.length, 5);
  // The opening three keep NULL — they were there before any message.
  assert.deepEqual(
    targets.map((target) => target.messageId),
    [null, null, null, message, message],
  );
  // Positions continue: 4 and 5 are what the chips and the outlines said.
  assert.deepEqual(
    rows(db, thread.id).map((row) => row.position),
    [0, 1, 2, 3, 4],
  );
  // Nobody has looked yet — spec 05 §5.4.
  assert.deepEqual(
    rows(db, thread.id)
      .slice(3)
      .map((row) => row.anchor_state),
    [null, null],
  );
  // `getThread` reads it back the same way, so everything downstream sees the
  // five places without a second query.
  assert.equal(getThread(db, thread.id)?.targets.length, 5);
  assert.equal(getThread(db, thread.id)?.targets[4]?.messageId, message);
  db.close();
});

test("§5.2 — a second append continues from the first, under its own message", () => {
  const db = database();
  const doc = document(db, "/w/a.md");
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: doc, anchor: anchorQuoting("one") }],
    note: "?",
    profile: "read",
  });
  const m1 = userMessage(db, thread.id, "first");
  appendTargets(db, thread.id, m1, [{ documentId: doc, anchor: anchorQuoting("two") }]);
  const m2 = userMessage(db, thread.id, "second");
  appendTargets(db, thread.id, m2, [{ documentId: doc, anchor: anchorQuoting("three") }]);

  assert.deepEqual(
    rows(db, thread.id).map((row) => [row.position, row.message_id]),
    [
      [0, null],
      [1, m1],
      [2, m2],
    ],
  );
  db.close();
});

test("§5.2 — an empty append changes nothing and returns the list as it stands", () => {
  const db = database();
  const doc = document(db, "/w/a.md");
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: doc, anchor: anchorQuoting("one") }],
    note: "?",
    profile: "read",
  });
  const message = userMessage(db, thread.id, "Are you sure?");
  const targets = appendTargets(db, thread.id, message, []);
  assert.equal(targets.length, 1);
  assert.equal(rows(db, thread.id).length, 1);
  db.close();
});

test("§3.4 — the tree's count follows: the new document now has this comment", () => {
  const db = database();
  const first = document(db, "/w/a.md");
  const second = document(db, "/w/b.md");
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: first, anchor: anchorQuoting("one") }],
    note: "?",
    profile: "read",
  });
  // Keyed by path, which is what the tree has.
  assert.equal(commentCountsByDocument(db).get("/w/b.md"), undefined);

  const message = userMessage(db, thread.id, "and this");
  appendTargets(db, thread.id, message, [{ documentId: second, anchor: anchorQuoting("two") }]);

  // Spec 05 §5.7 counts `thread_target` rows by document, so the second file
  // shows the comment without anything else being told.
  assert.equal(commentCountsByDocument(db).get("/w/b.md")?.open, 1);
  db.close();
});

test("§5.2 — a place in a document REX does not have is refused, and nothing half-lands", () => {
  const db = database();
  const doc = document(db, "/w/a.md");
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: doc, anchor: anchorQuoting("one") }],
    note: "?",
    profile: "read",
  });
  const message = userMessage(db, thread.id, "and these");

  // `foreign_keys = ON`, so the second row violates `document_id REFERENCES
  // document(id)` — and the transaction takes the first row with it.
  assert.throws(() =>
    appendTargets(db, thread.id, message, [
      { documentId: doc, anchor: anchorQuoting("two") },
      { documentId: "no-such-document", anchor: anchorQuoting("three") },
    ]),
  );
  assert.equal(rows(db, thread.id).length, 1);
  db.close();
});

// ── The migration ───────────────────────────────────────────────

/** `thread_target` as spec 05 made it, before the column existed. */
function openPreSpec24(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE thread_target (
             thread_id     TEXT NOT NULL,
             position      INTEGER NOT NULL,
             document_id   TEXT NOT NULL,
             anchor_json   TEXT NOT NULL,
             anchor_state  TEXT,
             PRIMARY KEY (thread_id, position)
           )`);
  return db;
}

const columns = (db: Database.Database): string[] =>
  db
    .prepare<[], { name: string }>("PRAGMA table_info(thread_target)")
    .all()
    .map((row) => row.name);

test("§5.2 — the migration adds message_id once, and old rows read NULL", () => {
  const db = openPreSpec24();
  db.prepare(
    "INSERT INTO thread_target (thread_id, position, document_id, anchor_json, anchor_state) VALUES ('t1', 0, 'd1', '{}', NULL)",
  ).run();
  assert.equal(columns(db).includes("message_id"), false);

  assert.equal(migrateTargetMessage(db), true);
  assert.equal(columns(db).includes("message_id"), true);
  // NULL is "the comment was created with it", which is true of every place
  // written before this column existed.
  const row = db
    .prepare<[], { message_id: string | null }>(
      "SELECT message_id FROM thread_target WHERE thread_id = 't1'",
    )
    .get();
  assert.equal(row?.message_id, null);

  // The second run is the one that happens on every subsequent open, forever.
  assert.equal(migrateTargetMessage(db), false);
  assert.equal(columns(db).filter((name) => name === "message_id").length, 1);
  db.close();
});

test("§5.2 — a fresh schema already has the column, so the migration is a no-op there", () => {
  const db = database();
  assert.equal(migrateTargetMessage(db), false);
  db.close();
});
