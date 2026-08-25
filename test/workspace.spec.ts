// Spec 10 §3 — what is and is not part of a review.
//
// Three of these guard a failure that looks like nothing at all. A scan that
// walks into an excluded folder still *produces a tree*: it is simply the wrong
// tree, one entry budget shorter, and the reviewer sees a truncation warning
// rather than the mistake. And a fan-out rule that is one predicate loose asks
// every comment in an excluded appendix — which costs money, and reports
// success.
//
// A real directory and a real SQLite database, not mocks: the scan is
// filesystem work and the rules are SQL, and a test of either against a fake is
// a test of the fake.
//
// Run: npm run test:workspace

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createThread, toggleWorkspaceRule, workspaceRules } from "../src/main/db/queries.ts";
import { documentPaths, scanWorkspace } from "../src/main/workspace/tree.ts";
import { outOfReviewScope } from "../src/shared/targets.ts";
import type { DocumentRef, TreeEntry } from "../src/shared/types.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

/**
 * A workspace shaped like the case this feature exists for: documents worth
 * reviewing, an archive nobody wants in the tree, and a dependency folder REX
 * skips on its own.
 */
function workspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "rex-workspace-"));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "docs", "archive"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "node_modules", "left-pad"));
  writeFileSync(join(root, "README.md"), "# Read me\n");
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n");
  writeFileSync(join(root, "docs", "archive", "old.md"), "# Old\n");
  writeFileSync(join(root, "node_modules", "left-pad", "readme.md"), "# left-pad\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function database(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

/** Every entry's name, depth first, so a test can say what the tree holds. */
function names(entries: TreeEntry[]): string[] {
  return entries.flatMap((entry) => [entry.name, ...names(entry.children)]);
}

function fileRef(value: string): DocumentRef {
  return { kind: "file", value };
}

test("the built-in skip list is unchanged when there are no rules", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    const tree = scanWorkspace(db, root);
    assert.ok(names(tree.entries).includes("guide.md"));
    assert.ok(!names(tree.entries).includes("node_modules"));
    // §3.3 — a default skip is a scan-cost decision, not a statement about
    // scope, so it never reaches the workspace-wide commands.
    assert.deepEqual(tree.excluded, []);
  } finally {
    db.close();
    cleanup();
  }
});

test("an excluded folder stays in the tree, marked, with its subtree pruned", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    const archive = join(root, "docs", "archive");
    assert.equal(toggleWorkspaceRule(db, root, archive, "exclude"), "exclude");

    // No `reveal`: a rule the reviewer wrote is drawn whatever the flag says.
    // A decision that hides its own undo is a trap, and a row that vanishes
    // cannot be told from a folder that is simply gone.
    const tree = scanWorkspace(db, root);
    const docs = tree.entries.find((entry) => entry.name === "docs");
    const listed = docs?.children.find((entry) => entry.name === "archive");
    assert.equal(listed?.exclusion, "user");
    // Marked, but never walked — the prune is where the whole saving is.
    assert.deepEqual(listed?.children, []);
    assert.ok(!names(tree.entries).includes("old.md"));
    // The folder beside it is untouched.
    assert.ok(names(tree.entries).includes("guide.md"));
  } finally {
    db.close();
    cleanup();
  }
});

test("an excluded folder leaves the graph's inputs and Ask all", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    const archive = join(root, "docs", "archive");
    toggleWorkspaceRule(db, root, archive, "exclude");
    const tree = scanWorkspace(db, root);

    // Being drawn is not being in the review. The reference graph is built from
    // this list, so excluding reaches it without the graph knowing anything
    // about exclusions.
    assert.ok(!documentPaths(tree).some((path) => path.includes("archive")));
    assert.deepEqual(tree.excluded, [archive]);
  } finally {
    db.close();
    cleanup();
  }
});

test("an excluded document still says how many comments are on it", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    // §3.3 — excluding narrows what REX looks at, never what it holds. The
    // count of what is about to be left behind is the number somebody needs to
    // judge whether the exclusion was right, so the row must not go quiet.
    const guide = join(root, "docs", "guide.md");
    db.prepare(
      "INSERT INTO document (id, kind, value, title, content_hash, last_seen_at) VALUES ('g', 'file', ?, NULL, NULL, ?)",
    ).run(guide, "2026-08-24T00:00:00.000Z");
    createThread(db, {
      kind: "anchored",
      targets: [
        {
          documentId: "g",
          anchor: {
            quote: { exact: "A passage.", prefix: "", suffix: "" },
            position: null,
            element: null,
            region: null,
            source: null,
          },
        },
      ],
      note: "Is this still true?",
      profile: "read",
    });

    toggleWorkspaceRule(db, root, guide, "exclude");
    const docs = scanWorkspace(db, root).entries.find((entry) => entry.name === "docs");
    const excluded = docs?.children.find((entry) => entry.name === "guide.md");
    assert.equal(excluded?.exclusion, "user");
    assert.equal(excluded?.comments?.open, 1);

    // A folder honestly cannot say — its subtree was never walked.
    toggleWorkspaceRule(db, root, join(root, "docs"), "exclude");
    const folder = scanWorkspace(db, root).entries.find((entry) => entry.name === "docs");
    assert.equal(folder?.exclusion, "user");
    assert.equal(folder?.comments, null);
  } finally {
    db.close();
    cleanup();
  }
});

test("the built-in skip list stays out of the tree until it is asked for", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    // Not the reviewer's decision, a dozen names in a typical repository, and
    // drawing them all in every tree is the noise spec 02 §4.2 removed.
    assert.ok(!names(scanWorkspace(db, root).entries).includes("node_modules"));

    const revealed = scanWorkspace(db, root, { reveal: true });
    const listed = names(revealed.entries);
    assert.ok(listed.includes("node_modules"));

    // …and it is still not walked. This is the assertion that matters:
    // revealing `node_modules` in a real repository must cost one row, not the
    // whole 5,000-entry budget and a tree nobody can read.
    assert.ok(!listed.includes("left-pad"));
    const entry = revealed.entries.find((one) => one.name === "node_modules");
    assert.equal(entry?.exclusion, "default");
    assert.deepEqual(entry?.children, []);
    // A default skip is a scan-cost decision, not a statement about scope.
    assert.deepEqual(revealed.excluded, []);
    // Drawn so it can be brought back, never so it can be acted on.
    assert.ok(!documentPaths(revealed).some((path) => path.includes("node_modules")));
  } finally {
    db.close();
    cleanup();
  }
});

test("including pulls in a folder the built-in list skips", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    assert.equal(toggleWorkspaceRule(db, root, join(root, "node_modules"), "include"), "include");
    const tree = scanWorkspace(db, root);
    assert.ok(names(tree.entries).includes("node_modules"));
    assert.ok(names(tree.entries).includes("left-pad"));
    // An include is not an exclusion, so nothing narrows.
    assert.deepEqual(tree.excluded, []);
  } finally {
    db.close();
    cleanup();
  }
});

test("the menu is a toggle against the default, so no rule is left behind", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    const archive = join(root, "docs", "archive");
    toggleWorkspaceRule(db, root, archive, "exclude");
    // Including an excluded path deletes the rule rather than writing an
    // `include`, so the table holds only genuine departures from the default.
    assert.equal(toggleWorkspaceRule(db, root, archive, "include"), null);
    assert.equal(workspaceRules(db, root).size, 0);
    // Walked again, which a marked-but-pruned row would not be.
    assert.ok(names(scanWorkspace(db, root).entries).includes("old.md"));

    // And the other way: excluding a path that was only included by hand puts
    // it back on the built-in list rather than adding a second rule.
    const modules = join(root, "node_modules");
    toggleWorkspaceRule(db, root, modules, "include");
    assert.equal(toggleWorkspaceRule(db, root, modules, "exclude"), null);
    assert.equal(workspaceRules(db, root).size, 0);
    assert.ok(!names(scanWorkspace(db, root).entries).includes("node_modules"));
  } finally {
    db.close();
    cleanup();
  }
});

test("rules are per workspace root", () => {
  const { root, cleanup } = workspace();
  const db = database();
  try {
    toggleWorkspaceRule(db, root, join(root, "docs"), "exclude");
    // The same folder opened as its own workspace is a different review, and
    // says nothing about what the larger one should show.
    assert.equal(workspaceRules(db, join(root, "docs")).size, 0);
    assert.equal(workspaceRules(db, root).size, 1);
  } finally {
    db.close();
    cleanup();
  }
});

test("Ask all skips a comment about nothing but excluded documents", () => {
  const excluded = ["/w/docs/archive"];
  assert.equal(outOfReviewScope([fileRef("/w/docs/archive/old.md")], excluded), true);
  assert.equal(outOfReviewScope([fileRef("/w/docs/guide.md")], excluded), false);
});

test("one target still in review keeps the whole comment in scope", () => {
  // The loose reading loses work: a comment spanning an excluded appendix and a
  // chapter still under review is a comment about the chapter.
  const excluded = ["/w/docs/archive"];
  const spanning = [fileRef("/w/docs/archive/old.md"), fileRef("/w/docs/guide.md")];
  assert.equal(outOfReviewScope(spanning, excluded), false);
});

test("a comment that names no file is never out of scope", () => {
  const excluded = ["/w/docs/archive"];
  // A synthesis comment has no targets at all, and a target whose document row
  // has gone resolves to null. Exclusion is a statement about a folder; neither
  // of these names one, so neither can be its subject.
  assert.equal(outOfReviewScope([], excluded), false);
  assert.equal(outOfReviewScope([null], excluded), false);
});

test("a sibling with the excluded folder's name as a prefix stays in review", () => {
  // The same trap `listThreads` walks around with its trailing separator:
  // `/docs-old` is not inside `/docs`.
  assert.equal(outOfReviewScope([fileRef("/w/docs-old/notes.md")], ["/w/docs"]), false);
  assert.equal(outOfReviewScope([fileRef("/w/docs/notes.md")], ["/w/docs"]), true);
});
