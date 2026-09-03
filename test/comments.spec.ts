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
import { markThreadDraft, markThreadNoted, markThreadSent } from "../src/main/db/queries.ts";
import { filesOf } from "../src/renderer/overlay/files.ts";
import { LANE_LABEL, LANES, laneOf } from "../src/renderer/overlay/lanes.ts";
import { MODE_LABEL, MODE_PROMISE, MODE_VERB, other } from "../src/renderer/overlay/mode.ts";
import { markerClass, tokenClass, washClass } from "../src/renderer/overlay/wash.ts";
import {
  buildCommentTree,
  type CommentRow,
  dropMove,
  flattenRows,
  startsLooseBlock,
  totalsById,
  treeCells,
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
             -- Spec 30 §2 — the lane. No CHECK here on purpose: this fixture is
             -- for the query functions, and constraining it would make the test
             -- a second copy of schema.sql, free to drift from it.
             status     TEXT NOT NULL DEFAULT 'open',
             is_note    INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL,
             updated_at TEXT
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

// ── Spec 30 §2 — the five lanes, and the moves between them ─────

/** Every lane move goes through these, so one helper reads the stored lane back. */
function laneInDb(db: Database.Database, id: string): string {
  return (
    db.prepare<[string], { status: string }>("SELECT status FROM thread WHERE id = ?").get(id)
      ?.status ?? "gone from the table"
  );
}

function seed(db: Database.Database, id: string, status: string): void {
  db.prepare(
    "INSERT INTO thread (id, note, position, status, created_at) VALUES (?, 'y', 0, ?, 't')",
  ).run(id, status);
}

test("sending moves a comment out of draft and out of note", () => {
  const db = openDb("lane-sent.db");
  seed(db, "d", "draft");
  seed(db, "n", "note");
  markThreadSent(db, "d");
  markThreadSent(db, "n");
  assert.equal(laneInDb(db, "d"), "open");
  assert.equal(laneInDb(db, "n"), "open");
  db.close();
});

test("sending twice is a no-op, and it never reopens a resolved comment", () => {
  const db = openDb("lane-sent-twice.db");
  seed(db, "d", "draft");
  markThreadSent(db, "d");
  markThreadSent(db, "d");
  assert.equal(laneInDb(db, "d"), "open");

  // Spec 18 §2 — resolved is terminal. Replying to a resolved comment must not
  // quietly drag it back into `open`, which is why the UPDATE names the two
  // unsent lanes rather than testing for "not open".
  seed(db, "r", "resolved");
  markThreadSent(db, "r");
  assert.equal(laneInDb(db, "r"), "resolved");
  db.close();
});

test("Save makes a note out of a draft, and leaves a sent comment alone", () => {
  const db = openDb("lane-noted.db");
  seed(db, "d", "draft");
  markThreadNoted(db, "d");
  assert.equal(laneInDb(db, "d"), "note");

  // Spec 24 §4.3 — a note ON an answered comment. That comment has been sent,
  // so it keeps its lane; only the message is a note.
  seed(db, "o", "open");
  markThreadNoted(db, "o");
  assert.equal(laneInDb(db, "o"), "open");
  db.close();
});

test("Turn into a comment promotes a note, and refuses anything else", () => {
  const db = openDb("lane-promote.db");
  seed(db, "n", "note");
  assert.equal(markThreadDraft(db, "n"), true);
  assert.equal(laneInDb(db, "n"), "draft");
  // Already a draft: the second press changes nothing and says so.
  assert.equal(markThreadDraft(db, "n"), false);

  seed(db, "o", "open");
  assert.equal(markThreadDraft(db, "o"), false);
  assert.equal(laneInDb(db, "o"), "open");
  db.close();
});

test("spec 30 §6 — the two unsent lanes are drawn before every other state", () => {
  assert.equal(washClass("draft", null), "rex-thread-draft");
  assert.equal(tokenClass("draft", null), "rex-token-draft");
  assert.equal(washClass("note", null), "rex-thread-unsent");
  assert.equal(tokenClass("note", null), "rex-token-unsent");

  // They come FIRST now, where the note came last while it was a flag. A draft
  // or a note cannot also be resolved or moved, so there is nothing left for it
  // to hide — the tension that put the note at the bottom went with the flag.
  assert.equal(washClass("draft", "orphaned"), "rex-thread-draft");
  assert.equal(washClass("note", "moved"), "rex-thread-unsent");

  // And the three older lanes are untouched.
  assert.equal(washClass("resolved", null), "rex-thread-done");
  assert.equal(washClass("open", "orphaned"), "rex-thread-orphaned");
  assert.equal(washClass("open", null), "");
  assert.equal(tokenClass("open", null), "");
});

test("spec 33 §3.1 — the wash follows the lane, and `moved` is not one", () => {
  // A comment with a moved or a part-lost place is an open comment and wears
  // the open comment's look on all three surfaces. The amber went to the note.
  for (const fn of [washClass, tokenClass, markerClass]) {
    assert.equal(fn("open", "moved"), "");
    assert.equal(fn("open", "ok"), "");
    assert.equal(fn("open", null), "");
  }
  // The one anchor state that IS a lane keeps its colour.
  assert.equal(markerClass("open", "orphaned"), "rex-margin-lost");
  // And a lane still outranks it.
  assert.equal(markerClass("resolved", "orphaned"), "rex-margin-done");
  assert.equal(markerClass("note", "orphaned"), "rex-margin-unsent");
});

/** Spec 33 §2.1 — a place, as `filesOf` reads it: a file, and whether it is the whole of it. */
function place(name: string, whole = false): { name: string; whole: boolean } {
  return { name, whole };
}

function chipsOf(
  places: Array<{ name: string; whole: boolean }>,
  states: Array<"ok" | "moved" | "orphaned" | null>,
) {
  return filesOf(
    {
      targets: places.map((p) => ({
        documentId: p.name,
        anchor: {
          quote: null,
          position: null,
          element: null,
          region: null,
          source: null,
          ...(p.whole ? { extent: "document" as const } : {}),
        },
        state: null,
        messageId: null,
      })),
      targetNames: places.map((p) => p.name),
    },
    states,
  );
}

test("spec 33 §2.1 — one chip per file, in target order, counting every place", () => {
  // The reviewer's comment 4: five places in four files, one lost.
  const chips = chipsOf(
    [
      place("user-interaction-flow.md", true),
      place("components.md"),
      place("components.md"),
      place("overview.md"),
      place("lukas-feedback.md"),
    ],
    ["ok", "orphaned", "ok", "ok", "ok"],
  );
  assert.deepEqual(chips, [
    { name: "user-interaction-flow.md", places: 1, whole: true, lost: 0 },
    { name: "components.md", places: 2, whole: false, lost: 1 },
    { name: "overview.md", places: 1, whole: false, lost: 0 },
    { name: "lukas-feedback.md", places: 1, whole: false, lost: 0 },
  ]);
  // The counts sum to the places, so no place is hidden by the grouping.
  assert.equal(
    chips.reduce((n, chip) => n + chip.places, 0),
    5,
  );
});

test("spec 33 §2.1 — the whole file, and more places in it, is one chip", () => {
  const [chip] = chipsOf([place("a.md"), place("a.md", true), place("a.md")], ["ok", "ok", "ok"]);
  assert.deepEqual(chip, { name: "a.md", places: 3, whole: true, lost: 0 });
});

test("spec 33 §2.1 — a place nobody looked at is counted and is never lost", () => {
  // Spec 05 §5.4: null is "nobody looked". It is a place, so it counts; it is
  // not evidence of loss, so it does not.
  const [chip] = chipsOf([place("a.md"), place("a.md")], [null, "orphaned"]);
  assert.deepEqual(chip, { name: "a.md", places: 2, whole: false, lost: 1 });
  // And a moved place gets no mark at all — spec 18 §2.1.
  const [moved] = chipsOf([place("b.md")], ["moved"]);
  assert.deepEqual(moved, { name: "b.md", places: 1, whole: false, lost: 0 });
});

test("spec 33 §2.1 — a synthesis comment has no places and draws no chips", () => {
  assert.deepEqual(chipsOf([], []), []);
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

// ── Spec 30 §2 — laneOf, the one rule the list and the paper share ──

test("the four stored lanes come straight back when the anchor is fine", () => {
  assert.equal(laneOf("draft", null), "draft");
  assert.equal(laneOf("note", "ok"), "note");
  assert.equal(laneOf("open", "ok"), "open");
  assert.equal(laneOf("resolved", "moved"), "resolved");
});

test("gone catches draft, note and open — and never resolved", () => {
  // Spec 30 §2 widened spec 18's open-only rule at the front: a draft or a note
  // whose text vanished is as lost as an open comment whose text vanished.
  assert.equal(laneOf("draft", "orphaned"), "orphaned");
  assert.equal(laneOf("note", "orphaned"), "orphaned");
  assert.equal(laneOf("open", "orphaned"), "orphaned");

  // Spec 18 §2 — and resolved is still terminal. A comment that was dealt with
  // and whose text was later removed stays resolved: the gone lane exists so a
  // reviewer does not lose a question they asked, and an answered question
  // cannot be lost.
  assert.equal(laneOf("resolved", "orphaned"), "resolved");
});

test("`moved` is not a lane, in any status", () => {
  // Spec 18 §2.1 — a comment whose text was re-found somewhere else is open. It
  // counts as open and is drawn as open; that it moved is a pill on its card.
  for (const status of ["draft", "note", "open"] as const) {
    assert.equal(laneOf(status, "moved"), status);
  }
});

test("every lane has a label, and two of them are not their own key", () => {
  for (const one of LANES) assert.equal(typeof LANE_LABEL[one], "string");
  // Both differences were bought with a measurement: spec 18 §5.2 for `gone`,
  // spec 30 §4.4 for `done`.
  assert.equal(LANE_LABEL.orphaned, "gone");
  assert.equal(LANE_LABEL.resolved, "done");
});

test("the lanes are disjoint — every comment lands in exactly one", () => {
  // The whole reason laneOf is one function and not five predicates. A set of
  // independent tests is free to put one comment in two lanes; this cannot.
  const seen: string[] = [];
  for (const status of ["draft", "note", "open", "resolved"] as const) {
    for (const state of [null, "ok", "moved", "orphaned"] as const) {
      const one = laneOf(status, state);
      assert.equal(LANES.includes(one), true, `${status}/${state} gave ${one}`);
      seen.push(one);
    }
  }
  // And all five are reachable, so no pill is a control that can never fill.
  for (const one of LANES) assert.equal(seen.includes(one), true, `nothing reaches ${one}`);
});

test("spec 30 §3.6 — a comment with neither a name nor words is not blank", () => {
  // Unreachable before spec 30: every comment was made by a send, and a send
  // needs a question. A draft is saved by walking away, and walking away at once
  // is allowed — so this row exists now, and it drew an empty headline.
  assert.equal(commentName({ title: null, note: "" }), "Untitled");
  assert.equal(commentName({ title: "   ", note: "  \n  " }), "Untitled");
  // And the two rules above it are untouched.
  assert.equal(commentName({ title: null, note: "the note" }), "the note");
  assert.equal(commentName({ title: "A name", note: "" }), "A name");
});

// ── §7.2 — the tree drawn beside the rows ───────────────────────

/** Every row's cells, as one readable line per row: `id: cell cell`. */
function drawn(rows: Array<CommentRow<FakeThread>>): string[] {
  return rows.map((row, index) => `${row.id}: ${treeCells(rows, index).join(" ")}`.trim());
}

test("a folder's rows hang off it, and the last one closes the trunk", () => {
  const groups = [group("G1", null, 0)];
  const threads = [thread("a", "G1", 0), thread("b", "G1", 1), thread("loose", null, 0)];

  assert.deepEqual(drawn(rowsFor(groups, threads)), [
    // The folder hangs a stem for the rows below it.
    "G1: stem",
    // `a` is not the last, so its trunk carries on past the turn.
    "a: tee",
    // `b` is, so the trunk stops where it turns right.
    "b: end",
    // And a comment in no folder draws nothing at all.
    "loose:",
  ]);
});

test("a folder with nothing under it hangs no stem", () => {
  // Collapsed is the same case: no row follows it at a deeper level, so there
  // is nothing for a stem to reach.
  assert.deepEqual(drawn(rowsFor([group("G1", null, 0)], [])), ["G1:"]);
  const closed = rowsFor([group("G1", null, 0)], [thread("a", "G1", 0)], ["G1"]);
  assert.deepEqual(drawn(closed), ["G1:"]);
});

test("a nested folder keeps the outer trunk running while it has rows left", () => {
  const groups = [group("G1", null, 0), group("G1a", "G1", 0)];
  const threads = [thread("deep", "G1a", 0), thread("own", "G1", 0), thread("loose", null, 0)];

  assert.deepEqual(drawn(rowsFor(groups, threads)), [
    "G1: stem",
    // G1 has `own` still to come, so its trunk carries on past G1a.
    "G1a: tee stem",
    // `deep` is G1a's last row, and G1's trunk still runs to its left.
    "deep: line end",
    "own: end",
    "loose:",
  ]);
});

test("the last row of the last nested folder leaves every column blank", () => {
  const groups = [group("G1", null, 0), group("G1a", "G1", 0)];
  const threads = [thread("deep", "G1a", 0)];

  assert.deepEqual(drawn(rowsFor(groups, threads)), [
    "G1: stem",
    // G1a is G1's last row, so G1's trunk ends here rather than continuing.
    "G1a: end stem",
    // Nothing follows, so the outer column is blank — `tree` draws it the same.
    "deep:  end",
  ]);
});

// ── §7.2 — where the folders end ────────────────────────────────

/** The rows that begin the "in no folder" block. There is never more than one. */
function looseAt(rows: Array<CommentRow<FakeThread>>): string[] {
  return rows.filter((_, index) => startsLooseBlock(rows, index)).map((row) => row.id);
}

test("the rule falls on the first comment that is in no folder", () => {
  const groups = [group("G1", null, 0)];
  const threads = [thread("a", "G1", 0), thread("x", null, 0), thread("y", null, 1)];
  // `x` only. `y` is in no folder too, but the break is above `x`.
  assert.deepEqual(looseAt(rowsFor(groups, threads)), ["x"]);
});

test("a COLLAPSED folder still ends the folders — the reported bug", () => {
  // Nothing steps out here: the folder header and the comment are both at the
  // top level, and the rule that looked for a change of depth drew nothing.
  const groups = [group("G1", null, 0)];
  const threads = [thread("a", "G1", 0), thread("x", null, 0)];
  assert.deepEqual(looseAt(rowsFor(groups, threads, ["G1"])), ["x"]);
});

test("an EMPTY folder ends them too", () => {
  assert.deepEqual(looseAt(rowsFor([group("G1", null, 0)], [thread("x", null, 0)])), ["x"]);
});

test("with no folder at all there is nothing to separate", () => {
  assert.deepEqual(looseAt(rowsFor([], [thread("x", null, 0), thread("y", null, 1)])), []);
});

test("a list that is entirely folders has no rule either", () => {
  const groups = [group("G1", null, 0)];
  assert.deepEqual(looseAt(rowsFor(groups, [thread("a", "G1", 0)])), []);
});
