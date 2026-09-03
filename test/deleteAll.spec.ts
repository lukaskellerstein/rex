// Delete all comments — the one command that empties the panel.
//
// It is tested on its own, and against the real `schema.sql`, because the risk
// it carries is not "does it delete". It is "does it delete EXACTLY what the
// panel drew". `thread:list` and `thread:delete-all` share one CTE for that
// reason, and every test here is an assertion about that sharing: the same
// request in, the same set out, and nothing outside it touched.
//
// The other half is the cascade. A comment is five tables, and a delete that
// leaves four of them behind is a leak nobody sees until the database is read
// by something else.
//
// Run: npm run test:delete-all

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createGroup, listGroups } from "../src/main/db/groups.ts";
import {
  appendMessage,
  createThread,
  deleteThreadsInScope,
  listThreads,
  upsertDocument,
} from "../src/main/db/queries.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

const ALPHA = "/w/alpha";
const BETA = "/w/beta";

function database(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = ON");
  return db;
}

/** A document at a real-looking path, so the root prefix test means something. */
function document(db: Database.Database, path: string): string {
  return upsertDocument(db, { kind: "file", value: path }, null, null).record.id;
}

function comment(db: Database.Database, documentId: string, note: string): string {
  return createThread(db, {
    kind: "anchored",
    targets: [
      {
        documentId,
        anchor: {
          quote: { exact: note, prefix: "", suffix: "" },
          position: null,
          element: null,
          region: null,
          source: null,
        },
      },
    ],
    note,
    profile: "read",
  }).id;
}

const countIn = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test("what it deletes is exactly what the list drew", () => {
  const db = database();
  const guide = document(db, join(ALPHA, "guide.md"));
  const other = document(db, join(BETA, "notes.md"));
  comment(db, guide, "Is this still true?");
  comment(db, guide, "Say who this is for.");
  comment(db, other, "A comment in another workspace.");

  const request = { root: ALPHA, documentId: null };
  assert.equal(listThreads(db, request).length, 2);
  assert.equal(deleteThreadsInScope(db, request), 2);
  assert.equal(listThreads(db, request).length, 0);

  // The other workspace is untouched. This is the whole point of scoping the
  // delete through the list's own CTE rather than by "delete from thread".
  assert.equal(listThreads(db, { root: BETA, documentId: null }).length, 1);
  db.close();
});

test("a sibling root with the same prefix is not in the workspace", () => {
  const db = database();
  const inside = document(db, join(ALPHA, "guide.md"));
  // `/w/alpha-old` is not inside `/w/alpha`, and the trailing separator in the
  // CTE is the only thing that says so.
  const beside = document(db, "/w/alpha-old/guide.md");
  comment(db, inside, "Inside.");
  comment(db, beside, "Beside.");

  assert.equal(deleteThreadsInScope(db, { root: ALPHA, documentId: null }), 1);
  assert.equal(listThreads(db, { root: "/w/alpha-old", documentId: null }).length, 1);
  db.close();
});

test("the open document's comments go even when it sits outside the root", () => {
  const db = database();
  const outside = document(db, "/elsewhere/readme.md");
  comment(db, outside, "Opened by path, not through the tree.");

  // The list includes it by id for exactly this case, so the delete must too —
  // a comment the panel is showing and the command will not take is worse than
  // no command.
  const request = { root: ALPHA, documentId: outside };
  assert.equal(listThreads(db, request).length, 1);
  assert.equal(deleteThreadsInScope(db, request), 1);
  assert.equal(countIn(db, "thread"), 0);
  db.close();
});

test("the conversation and the anchors go with the comment", () => {
  const db = database();
  const guide = document(db, join(ALPHA, "guide.md"));
  const threadId = comment(db, guide, "Is this still true?");
  appendMessage(db, threadId, {
    role: "assistant",
    kind: "text",
    content: "No — §4 was rewritten in June.",
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });
  assert.equal(countIn(db, "message"), 1);
  assert.equal(countIn(db, "thread_target"), 1);

  deleteThreadsInScope(db, { root: ALPHA, documentId: null });

  assert.equal(countIn(db, "message"), 0);
  assert.equal(countIn(db, "thread_target"), 0);
  // The document itself is not a comment and stays: it is what the next
  // comment on this file will anchor to.
  assert.equal(countIn(db, "document"), 1);
  db.close();
});

test("a synthesis comment goes with the comments it was about", () => {
  const db = database();
  const guide = document(db, join(ALPHA, "guide.md"));
  const first = comment(db, guide, "Is this still true?");
  const second = comment(db, guide, "Say who this is for.");
  createThread(db, {
    kind: "synthesis",
    targets: [],
    documentId: guide,
    note: "What do these two have in common?",
    profile: "read",
    refThreadIds: [first, second],
  });

  // It has no anchor of its own, so it is in scope only through what it
  // references — and leaving it behind would leave a comment about two
  // comments that no longer exist.
  assert.equal(deleteThreadsInScope(db, { root: ALPHA, documentId: null }), 3);
  assert.equal(countIn(db, "thread_ref"), 0);
  db.close();
});

test("folders survive, empty", () => {
  const db = database();
  const guide = document(db, join(ALPHA, "guide.md"));
  const group = createGroup(db, { root: ALPHA, parentId: null, name: "Blocking" });
  const threadId = comment(db, guide, "Is this still true?");
  db.prepare("UPDATE thread SET group_id = ? WHERE id = ?").run(group.id, threadId);

  deleteThreadsInScope(db, { root: ALPHA, documentId: null });

  // `group:delete` never destroys a comment; this is that rule read the other
  // way round. The reviewer's arrangement is not a comment.
  assert.equal(listGroups(db, ALPHA).length, 1);
  assert.equal(listGroups(db, ALPHA)[0]?.name, "Blocking");
  db.close();
});

test("an empty workspace deletes nothing and says so", () => {
  const db = database();
  document(db, join(ALPHA, "guide.md"));
  assert.equal(deleteThreadsInScope(db, { root: ALPHA, documentId: null }), 0);
  db.close();
});

test("with no root, only the named document's comments go", () => {
  const db = database();
  const guide = document(db, join(ALPHA, "guide.md"));
  const other = document(db, join(ALPHA, "notes.md"));
  comment(db, guide, "Is this still true?");
  comment(db, other, "A comment on the other file.");

  // Main widens a null root to the document's own directory before this is
  // reached (`scopeOf`), so the narrow case here is the store's own contract:
  // no root means no prefix, and the id is the whole scope.
  assert.equal(deleteThreadsInScope(db, { root: null, documentId: guide }), 1);
  assert.equal(listThreads(db, { root: ALPHA, documentId: null }).length, 1);
  db.close();
});
