// Spec 14 §9.4 — the name, the tree, the drop rules and the group store.
//
// Two halves, and they meet in the middle. `shared/commentTree.ts` is pure and
// is exercised with plain objects; `main/db/groups.ts` is exercised against a
// real SQLite file, because what is being asserted is what SQLite does with a
// transaction, an `IS NULL` comparison and a foreign key.
//
// The two halves must agree, and one test says so out loud: the panel's drop
// rules and main's refusals are the same rule, so a drop the panel offers is
// never one main throws on.
//
// Run: npm run test:comments

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  moveItem,
  nextThreadPosition,
  updateGroup,
} from "../src/main/db/groups.ts";
import { clearNoteFlag } from "../src/main/db/queries.ts";
import { MODE_LABEL, MODE_PROMISE, MODE_VERB, other } from "../src/renderer/overlay/mode.ts";
import { tokenClass, washClass } from "../src/renderer/overlay/wash.ts";
import {
  buildCommentTree,
  type CommentRow,
  dropMove,
  flattenRows,
  totalsById,
  walkOrder,
  wouldCycle,
} from "../src/shared/commentTree.ts";
import { commentName, noteAddsToName } from "../src/shared/names.ts";
import type { CommentGroup } from "../src/shared/types.ts";

const work = mkdtempSync(join(tmpdir(), "rex-comments-"));
after(() => rmSync(work, { recursive: true, force: true }));

// ── §3.2 — what a comment is called ─────────────────────────────

test("with no title, the name is the note", () => {
  assert.equal(commentName({ title: null, note: "Is this still true?" }), "Is this still true?");
});

test("a title wins, and is trimmed", () => {
  assert.equal(commentName({ title: "  Auth flow  ", note: "Is this still true?" }), "Auth flow");
});

test("an empty or blank title falls back to the note", () => {
  assert.equal(commentName({ title: "", note: "the note" }), "the note");
  assert.equal(commentName({ title: "   ", note: "the note" }), "the note");
});

test("only the note's first non-empty line, with whitespace collapsed", () => {
  assert.equal(
    commentName({ title: null, note: "\n\n  first   line  \nsecond line" }),
    "first line",
  );
});

test("the name is never cut to a length — that is the column's job", () => {
  const long = "x".repeat(400);
  assert.equal(commentName({ title: null, note: long }).length, 400);
});

test("the note is shown under the name only when it says something else", () => {
  // No title: the two would be the same string, so printing both says no more.
  assert.equal(noteAddsToName({ title: null, note: "What is this?" }), false);
  assert.equal(noteAddsToName({ title: "Slide 4 shape", note: "What is this?" }), true);
  // A title that is exactly the note adds nothing either.
  assert.equal(noteAddsToName({ title: "What is this?", note: "What is this?" }), false);
});

test("§1's measured failure: two identical notes become tellable apart", () => {
  const a = { title: null as string | null, note: "What is this?" };
  const b = { title: null as string | null, note: "what is this?" };
  assert.equal(commentName(a).toLowerCase(), commentName(b).toLowerCase());

  a.title = "Orchestrator box, slide 4";
  assert.notEqual(commentName(a), commentName(b));
});

// ── §4.3, §4.4 and §5.2 — the tree and the walk ─────────────────

interface FakeThread {
  id: string;
  groupId: string | null;
  position: number;
}

function group(id: string, parentId: string | null, position: number): CommentGroup {
  return {
    id,
    root: "/w",
    parentId,
    name: id,
    position,
    collapsed: false,
    createdAt: "2026-08-25T00:00:00.000Z",
  };
}

function thread(id: string, groupId: string | null, position: number): FakeThread {
  return { id, groupId, position };
}

test("groups come before comments, and each is in its own order", () => {
  const groups = [group("G2", null, 1), group("G1", null, 0)];
  const threads = [thread("t2", null, 1), thread("t1", null, 0), thread("g1a", "G1", 0)];

  const tree = buildCommentTree(groups, threads);
  assert.deepEqual(
    tree.groups.map((node) => node.group.id),
    ["G1", "G2"],
  );
  assert.deepEqual(
    tree.threads.map((t) => t.id),
    ["t1", "t2"],
  );
  // §4.4 — groups depth-first, then the level's own comments.
  assert.deepEqual(
    walkOrder(tree).map((t) => t.id),
    ["g1a", "t1", "t2"],
  );
});

test("a group's count includes every depth beneath it", () => {
  const groups = [group("G1", null, 0), group("G1a", "G1", 0)];
  const threads = [thread("x", "G1", 0), thread("y", "G1a", 0), thread("z", "G1a", 1)];

  const totals = totalsById(buildCommentTree(groups, threads));
  assert.equal(totals.get("G1"), 3);
  assert.equal(totals.get("G1a"), 2);
});

test("§5.3 — a comment whose group belongs to another root sits at the top", () => {
  // The outer workspace's group is not in this root's list, so the comment that
  // names it is listed ungrouped. Its `groupId` is untouched in the database.
  const tree = buildCommentTree([], [thread("t1", "G-from-another-root", 0)]);
  assert.deepEqual(
    tree.threads.map((t) => t.id),
    ["t1"],
  );
});

test("a cycle in the data does not hang the walk", () => {
  const groups = [group("A", "B", 0), group("B", "A", 0)];
  const tree = buildCommentTree(groups, [thread("t1", null, 0)]);
  // Neither group can be reached from the top, so neither is drawn — and the
  // comment that is reachable still is. What matters is that this returns.
  assert.deepEqual(
    walkOrder(tree).map((t) => t.id),
    ["t1"],
  );
});

test("moving a group moves everything in it, because nothing else records it", () => {
  const groups = [group("G1", null, 0), group("G2", null, 1), group("G1a", "G1", 0)];
  const threads = [thread("a", "G1a", 0), thread("b", "G1", 0), thread("c", null, 0)];

  const before = walkOrder(buildCommentTree(groups, threads)).map((t) => t.id);
  assert.deepEqual(before, ["a", "b", "c"]);

  // One field changes — G1's position — and G1's whole subtree travels with it.
  const moved = groups.map((g) => (g.id === "G1" ? { ...g, position: 5 } : g));
  const after = walkOrder(buildCommentTree(moved, threads)).map((t) => t.id);
  assert.deepEqual(after, ["a", "b", "c"]);
  // G2 is empty, so the order of comments is unchanged; what changed is which
  // group is drawn first.
  assert.deepEqual(
    buildCommentTree(moved, threads).groups.map((n) => n.group.id),
    ["G2", "G1"],
  );
});

// ── §7.3 — what a drop means ────────────────────────────────────

function rowsFor(
  groups: CommentGroup[],
  threads: FakeThread[],
  collapsed: string[] = [],
): Array<CommentRow<FakeThread>> {
  return flattenRows(buildCommentTree(groups, threads), {
    collapsed: (g) => collapsed.includes(g.id),
    visible: () => true,
  });
}

test("a comment dropped on a group row lands inside it, last", () => {
  const groups = [group("G1", null, 0)];
  const threads = [thread("a", "G1", 0), thread("b", null, 0)];
  const rows = rowsFor(groups, threads);
  const header = rows.find((r) => r.kind === "group");
  assert.ok(header);

  const move = dropMove(rows, groups, { kind: "thread", id: "b" }, header, "inside");
  assert.deepEqual(move, { item: { kind: "thread", id: "b" }, parentId: "G1", after: "a" });
});

test("the line means beside: before takes the sibling above, after takes the row", () => {
  const threads = [thread("a", null, 0), thread("b", null, 1), thread("c", null, 2)];
  const rows = rowsFor([], threads);
  const target = rows.find((r) => r.id === "c");
  assert.ok(target);

  assert.deepEqual(dropMove(rows, [], { kind: "thread", id: "a" }, target, "before")?.after, "b");
  assert.deepEqual(dropMove(rows, [], { kind: "thread", id: "a" }, target, "after")?.after, "c");
});

test("§4.2 — the dragged row is taken out of the list before `after` is read", () => {
  // Dragging `b` to just before `c` must say "after a", not "after b" — and
  // "after b" is exactly what a naive previous-sibling lookup would return.
  const threads = [thread("a", null, 0), thread("b", null, 1), thread("c", null, 2)];
  const rows = rowsFor([], threads);
  const target = rows.find((r) => r.id === "c");
  assert.ok(target);
  assert.equal(dropMove(rows, [], { kind: "thread", id: "b" }, target, "before")?.after, "a");
});

test("§4.3 — a group never lands among comments, and a comment never among groups", () => {
  const groups = [group("G1", null, 0)];
  const threads = [thread("a", null, 0)];
  const rows = rowsFor(groups, threads);
  const commentRow = rows.find((r) => r.kind === "thread");
  const groupRow = rows.find((r) => r.kind === "group");
  assert.ok(commentRow && groupRow);

  assert.equal(dropMove(rows, groups, { kind: "group", id: "G1" }, commentRow, "before"), null);
  assert.equal(dropMove(rows, groups, { kind: "thread", id: "a" }, groupRow, "before"), null);
  // But "inside" a group row is exactly what a comment drag is for.
  assert.ok(dropMove(rows, groups, { kind: "thread", id: "a" }, groupRow, "inside"));
});

test("§5.5 — the panel refuses the cycle main refuses", () => {
  const groups = [group("G1", null, 0), group("G1a", "G1", 0)];
  const rows = rowsFor(groups, []);
  const child = rows.find((r) => r.id === "G1a");
  assert.ok(child);

  assert.equal(wouldCycle(groups, "G1", "G1a"), true);
  assert.equal(wouldCycle(groups, "G1a", null), false);
  assert.equal(dropMove(rows, groups, { kind: "group", id: "G1" }, child, "inside"), null);
});

test("a collapsed group still draws its own row, so it can be dragged", () => {
  const groups = [group("G1", null, 0)];
  const threads = [thread("a", "G1", 0)];
  const rows = rowsFor(groups, threads, ["G1"]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["G1"],
  );
});

// ── The group store, against a real database ────────────────────

function openDb(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE comment_group (
             id         TEXT PRIMARY KEY,
             root       TEXT NOT NULL,
             parent_id  TEXT REFERENCES comment_group(id) ON DELETE CASCADE,
             name       TEXT NOT NULL,
             position   INTEGER NOT NULL,
             collapsed  INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL
           );
           CREATE TABLE thread (
             id         TEXT PRIMARY KEY,
             note       TEXT NOT NULL,
             title      TEXT,
             group_id   TEXT REFERENCES comment_group(id) ON DELETE SET NULL,
             position   INTEGER NOT NULL DEFAULT 0,
             is_note    INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL
           )`);
  return db;
}

function seedThread(db: Database.Database, id: string, groupId: string | null): void {
  db.prepare(
    "INSERT INTO thread (id, note, group_id, position, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, `note ${id}`, groupId, nextThreadPosition(db, groupId), `2026-08-25T00:00:0${id}.000Z`);
}

const order = (db: Database.Database, groupId: string | null): string[] =>
  db
    .prepare<{ groupId: string | null }, { id: string }>(
      "SELECT id FROM thread WHERE group_id IS :groupId ORDER BY position",
    )
    .all({ groupId })
    .map((row) => row.id);

test("a new group goes last among its parent's groups", () => {
  const db = openDb("create.db");
  const first = createGroup(db, { root: "/w", parentId: null, name: "Blocking" });
  const second = createGroup(db, { root: "/w", parentId: null, name: "Later" });
  assert.equal(first.position, 0);
  assert.equal(second.position, 1);
  assert.equal(listGroups(db, "/w").length, 2);
  // Another workspace's groups are not in this one's list.
  assert.equal(listGroups(db, "/other").length, 0);
  db.close();
});

test("a group cannot be created or renamed with an empty name", () => {
  const db = openDb("names.db");
  assert.throws(() => createGroup(db, { root: "/w", parentId: null, name: "  " }));
  const g = createGroup(db, { root: "/w", parentId: null, name: "Blocking" });
  assert.throws(() => updateGroup(db, { groupId: g.id, name: "" }));
  assert.equal(getGroup(db, g.id)?.name, "Blocking");
  db.close();
});

test("collapsed is remembered", () => {
  const db = openDb("collapsed.db");
  const g = createGroup(db, { root: "/w", parentId: null, name: "Blocking" });
  assert.equal(g.collapsed, false);
  updateGroup(db, { groupId: g.id, collapsed: true });
  assert.equal(getGroup(db, g.id)?.collapsed, true);
  db.close();
});

test("a drop renumbers the whole sibling list, densely", () => {
  const db = openDb("renumber.db");
  seedThread(db, "1", null);
  seedThread(db, "2", null);
  seedThread(db, "3", null);

  // Move 3 to the front.
  moveItem(db, { item: { kind: "thread", id: "3" }, parentId: null, after: null });
  assert.deepEqual(order(db, null), ["3", "1", "2"]);

  const positions = db
    .prepare<[], { position: number }>("SELECT position FROM thread ORDER BY position")
    .all()
    .map((row) => row.position);
  // 0..n-1 with no gaps and no repeats — the renumber, not a fractional key.
  assert.deepEqual(positions, [0, 1, 2]);
  db.close();
});

test("an `after` that has been deleted mid-drag puts the row last, not nowhere", () => {
  const db = openDb("stale.db");
  seedThread(db, "1", null);
  seedThread(db, "2", null);
  moveItem(db, { item: { kind: "thread", id: "1" }, parentId: null, after: "gone" });
  assert.deepEqual(order(db, null), ["2", "1"]);
  db.close();
});

test("§4.6 — moving a group writes one row and touches no comment", () => {
  const db = openDb("move-group.db");
  const g1 = createGroup(db, { root: "/w", parentId: null, name: "One" });
  const g2 = createGroup(db, { root: "/w", parentId: null, name: "Two" });
  seedThread(db, "1", g1.id);
  seedThread(db, "2", g1.id);
  const before = db
    .prepare<[], { id: string; group_id: string | null; position: number }>(
      "SELECT id, group_id, position FROM thread ORDER BY id",
    )
    .all();

  moveItem(db, { item: { kind: "group", id: g1.id }, parentId: null, after: g2.id });

  assert.equal(getGroup(db, g1.id)?.position, 1);
  assert.equal(getGroup(db, g2.id)?.position, 0);
  const after = db
    .prepare<[], { id: string; group_id: string | null; position: number }>(
      "SELECT id, group_id, position FROM thread ORDER BY id",
    )
    .all();
  // Every comment untouched: same group, same rank inside it.
  assert.deepEqual(after, before);
  db.close();
});

test("§5.5 — main refuses to move a group inside its own descendant", () => {
  const db = openDb("cycle.db");
  const parent = createGroup(db, { root: "/w", parentId: null, name: "Parent" });
  const child = createGroup(db, { root: "/w", parentId: parent.id, name: "Child" });

  assert.throws(
    () => moveItem(db, { item: { kind: "group", id: parent.id }, parentId: child.id, after: null }),
    /inside itself/,
  );
  // And into itself, which is the same mistake one step shorter.
  assert.throws(() =>
    moveItem(db, { item: { kind: "group", id: parent.id }, parentId: parent.id, after: null }),
  );
  assert.equal(getGroup(db, parent.id)?.parentId, null);
  db.close();
});

test("§5.4 — deleting a group deletes no comment, and promotes by one level", () => {
  const db = openDb("delete.db");
  const outer = createGroup(db, { root: "/w", parentId: null, name: "Outer" });
  const inner = createGroup(db, { root: "/w", parentId: outer.id, name: "Inner" });
  const deepest = createGroup(db, { root: "/w", parentId: inner.id, name: "Deepest" });
  seedThread(db, "1", inner.id);
  seedThread(db, "2", inner.id);
  seedThread(db, "3", null);

  const total = (): number =>
    db.prepare<[], { n: number }>("SELECT count(*) AS n FROM thread").get()?.n ?? 0;
  assert.equal(total(), 3);

  deleteGroup(db, inner.id);

  // Nothing destroyed.
  assert.equal(total(), 3);
  // The comments went up one level — to Outer, not to the top.
  assert.deepEqual(order(db, outer.id), ["1", "2"]);
  // And so did the subgroup.
  assert.equal(getGroup(db, deepest.id)?.parentId, outer.id);
  assert.equal(getGroup(db, inner.id), null);
  db.close();
});

test("deleting a top-level group promotes its comments to the top level", () => {
  const db = openDb("delete-top.db");
  const g = createGroup(db, { root: "/w", parentId: null, name: "Blocking" });
  seedThread(db, "1", null);
  seedThread(db, "2", g.id);

  deleteGroup(db, g.id);

  // Last, behind the comment that was already there, rather than in front of it.
  assert.deepEqual(order(db, null), ["1", "2"]);
  db.close();
});

test("a group cannot be created inside another workspace's group", () => {
  const db = openDb("roots.db");
  const mine = createGroup(db, { root: "/w", parentId: null, name: "Mine" });
  assert.throws(() => createGroup(db, { root: "/other", parentId: mine.id, name: "Theirs" }));
  db.close();
});

// ── NOTE mode — a comment saved and sent to nobody ──────────────

test("the note flag is stored, and defaults to false", () => {
  const db = openDb("note-flag.db");
  db.prepare("INSERT INTO thread (id, note, position, created_at) VALUES ('a','x',0,'t')").run();
  db.prepare(
    "INSERT INTO thread (id, note, position, is_note, created_at) VALUES ('b','y',1,1,'t')",
  ).run();
  const rows = db
    .prepare<[], { id: string; is_note: number }>("SELECT id, is_note FROM thread ORDER BY id")
    .all();
  assert.deepEqual(rows, [
    { id: "a", is_note: 0 },
    { id: "b", is_note: 1 },
  ]);
  db.close();
});

test("sending a note clears the flag, and clearing twice is a no-op", () => {
  const db = openDb("note-clear.db");
  db.prepare(
    "INSERT INTO thread (id, note, position, is_note, created_at) VALUES ('a','y',0,1,'t')",
  ).run();
  clearNoteFlag(db, "a");
  const flag = (): number =>
    db.prepare<[], { is_note: number }>("SELECT is_note FROM thread WHERE id = 'a'").get()
      ?.is_note ?? -1;
  assert.equal(flag(), 0);
  clearNoteFlag(db, "a");
  assert.equal(flag(), 0);
  db.close();
});

test("the wash and the token put a note LAST, so it never hides a state", () => {
  // The whole argument for a fourth colour: it fills the slot that had none.
  assert.equal(washClass("open", null, true), "rex-thread-unsent");
  assert.equal(tokenClass("open", null, true), "rex-token-unsent");
  // An orphaned note is still drawn orphaned — where the text went matters more
  // than who wrote the comment.
  assert.equal(washClass("open", "orphaned", true), "rex-thread-orphaned");
  assert.equal(washClass("open", "moved", true), "rex-thread-moved");
  assert.equal(washClass("resolved", null, true), "rex-thread-done");
  // And an ordinary comment is untouched by the new argument.
  assert.equal(washClass("open", null), "");
  assert.equal(tokenClass("open", null), "");
});

test("the mode chord cycles all three, and ACT is still one press from ASK", () => {
  assert.equal(other("ask"), "act");
  assert.equal(other("act"), "note");
  assert.equal(other("note"), "ask");
});

test("every mode has a label, a promise and a verb", () => {
  for (const mode of ["ask", "act", "note"] as const) {
    assert.ok(MODE_LABEL[mode]);
    assert.ok(MODE_PROMISE[mode]);
    assert.ok(MODE_VERB[mode]);
  }
  assert.equal(MODE_VERB.note, "Save");
});
