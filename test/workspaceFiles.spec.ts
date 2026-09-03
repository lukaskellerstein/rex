// Spec 23 §9, milestone 0 — the guards on REX's second write door.
//
// Every one of these is about a refusal, and the reason they are worth a suite
// is that a refusal which does not happen is silent: the file is renamed, the
// document row is not, and the comments on it are still in the database keyed
// to a name that no longer exists. Nothing on screen says so. That is the exact
// failure spec 23 §1.2 describes, and these tests are what stop REX shipping it
// in its own menu.
//
// A real temporary workspace and a real in-memory database, as `workspace.spec`
// does: the guards are filesystem reasoning and the record-moving is SQL, and a
// test of either against a fake is a test of the fake. The Bin is the one thing
// faked — `shell.trashItem` needs Electron, and a suite must never put the
// runner's own files in it.
//
// Run: npm run test:workspace-files

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";

const WORK = mkdtempSync(join(tmpdir(), "rex-files-work-"));
process.env.REX_WORK_PATH = WORK;

const { createThread, findDocument, upsertDocument, toggleWorkspaceRule, workspaceRules } =
  await import("../src/main/db/queries.ts");
const { ensureWorkingCopy, readMeta, currentPath, basePath } = await import("../src/main/work.ts");
const { deleteEntry, forgetWorkspaceRoots, noteWorkspaceRoot, renameEntry } = await import(
  "../src/main/workspace/files.ts"
);

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

/** A workspace with a document, a folder of them, and a dependency tree. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "rex-files-"));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "README.md"), "# Read me\n");
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n");
  writeFileSync(join(root, "docs", "notes.md"), "# Notes\n");
  writeFileSync(join(root, "node_modules", "readme.md"), "# dependency\n");
  noteWorkspaceRoot(root);
  return root;
}

function database(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

/** A document row with one comment on it, which is what a rename must carry. */
function commented(db: Database.Database, path: string): string {
  const { record } = upsertDocument(db, { kind: "file", value: path }, "A document", "hash");
  createThread(db, {
    documentId: record.id,
    kind: "synthesis",
    note: "Is this still true?",
    profile: "read",
    targets: [],
  });
  return record.id;
}

/** A Bin that records rather than one that deletes. */
function fakeBin(): { trash: (path: string) => Promise<void>; taken: string[] } {
  const taken: string[] = [];
  return {
    taken,
    trash: async (path: string) => {
      taken.push(path);
      rmSync(path, { force: true });
    },
  };
}

beforeEach(() => {
  forgetWorkspaceRoots();
});

describe("§2.2 — what main refuses before it touches anything", () => {
  it("refuses a root it has never scanned", () => {
    const root = workspace();
    forgetWorkspaceRoots();
    const answer = renameEntry(database(), {
      root,
      path: join(root, "README.md"),
      name: "READ.md",
    });
    assert.equal(answer.ok, false);
    assert.ok(existsSync(join(root, "README.md")));
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a path outside the workspace", () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), "rex-elsewhere-"));
    writeFileSync(join(outside, "secret.md"), "# Not yours\n");

    const answer = renameEntry(database(), {
      root,
      path: join(outside, "secret.md"),
      name: "taken.md",
    });
    assert.equal(answer.ok, false);
    assert.ok(existsSync(join(outside, "secret.md")), "the file outside is untouched");

    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses a path that walks out with ..", () => {
    const root = workspace();
    const answer = renameEntry(database(), {
      root,
      path: join(root, "..", "..", "etc", "hosts"),
      name: "hosts.md",
    });
    assert.equal(answer.ok, false);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a folder REX never touches", () => {
    const root = workspace();
    const answer = renameEntry(database(), {
      root,
      path: join(root, "node_modules", "readme.md"),
      name: "gone.md",
    });
    assert.equal(answer.ok, false);
    assert.ok(existsSync(join(root, "node_modules", "readme.md")));
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a file that is no longer there", () => {
    const root = workspace();
    const answer = renameEntry(database(), {
      root,
      path: join(root, "docs", "vanished.md"),
      name: "back.md",
    });
    assert.equal(answer.ok, false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("§4.2 — the names a rename refuses", () => {
  it("refuses a name holding a path separator — a rename is not a move", () => {
    const root = workspace();
    for (const name of ["../escaped.md", "docs/moved.md", "a\\b.md"]) {
      const answer = renameEntry(database(), { root, path: join(root, "README.md"), name });
      assert.equal(answer.ok, false, name);
    }
    assert.ok(existsSync(join(root, "README.md")));
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses an empty name, and . and ..", () => {
    const root = workspace();
    for (const name of ["", "   ", ".", ".."]) {
      const answer = renameEntry(database(), { root, path: join(root, "README.md"), name });
      assert.equal(answer.ok, false, JSON.stringify(name));
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a name another file already has, and does not overwrite it", () => {
    const root = workspace();
    const answer = renameEntry(database(), {
      root,
      path: join(root, "docs", "guide.md"),
      name: "notes.md",
    });
    assert.equal(answer.ok, false);
    assert.equal(readFileSync(join(root, "docs", "notes.md"), "utf8"), "# Notes\n");
    assert.ok(existsSync(join(root, "docs", "guide.md")));
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a name REX still holds comments for — §4.2, before the disk act", () => {
    const root = workspace();
    const db = database();
    // A file that was deleted earlier: its comments are kept (§3.2), so the row
    // is still there and the UNIQUE (kind, value) would throw on the update.
    commented(db, join(root, "docs", "old-guide.md"));

    const answer = renameEntry(db, {
      root,
      path: join(root, "docs", "guide.md"),
      name: "old-guide.md",
    });
    assert.equal(answer.ok, false);
    assert.match(answer.ok ? "" : answer.reason, /comments/);
    assert.ok(existsSync(join(root, "docs", "guide.md")), "nothing was renamed");
    rmSync(root, { recursive: true, force: true });
  });

  it("renaming to the same name is not an error and does nothing", () => {
    const root = workspace();
    const answer = renameEntry(database(), {
      root,
      path: join(root, "README.md"),
      name: "README.md",
    });
    assert.equal(answer.ok, true);
    assert.ok(existsSync(join(root, "README.md")));
    rmSync(root, { recursive: true, force: true });
  });
});

describe("§4.1 — the records that follow the file", () => {
  it("a renamed document keeps its comments, under the new path", () => {
    const root = workspace();
    const db = database();
    const from = join(root, "docs", "guide.md");
    const documentId = commented(db, from);

    const answer = renameEntry(db, { root, path: from, name: "handbook.md" });
    assert.equal(answer.ok, true);

    const to = join(root, "docs", "handbook.md");
    assert.ok(existsSync(to));
    assert.ok(!existsSync(from));

    const moved = findDocument(db, { kind: "file", value: to });
    assert.equal(moved?.id, documentId, "the same row, so every comment came with it");
    assert.equal(findDocument(db, { kind: "file", value: from }), null);
    rmSync(root, { recursive: true, force: true });
  });

  it("an exclusion the reviewer wrote is about the file, not the name", () => {
    const root = workspace();
    const db = database();
    const from = join(root, "docs", "notes.md");
    toggleWorkspaceRule(db, root, from, "exclude");

    const answer = renameEntry(db, { root, path: from, name: "scratch.md" });
    assert.equal(answer.ok, true);

    const rules = workspaceRules(db, root);
    assert.equal(rules.get(join(root, "docs", "scratch.md")), "exclude");
    assert.equal(rules.has(from), false);
    rmSync(root, { recursive: true, force: true });
  });

  it("a folder rename carries every document under it", () => {
    const root = workspace();
    const db = database();
    const guide = commented(db, join(root, "docs", "guide.md"));
    const notes = commented(db, join(root, "docs", "notes.md"));

    const answer = renameEntry(db, { root, path: join(root, "docs"), name: "documentation" });
    assert.equal(answer.ok, true);

    assert.equal(
      findDocument(db, { kind: "file", value: join(root, "documentation", "guide.md") })?.id,
      guide,
    );
    assert.equal(
      findDocument(db, { kind: "file", value: join(root, "documentation", "notes.md") })?.id,
      notes,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("a sibling whose name only starts the same is left alone", () => {
    const root = workspace();
    const db = database();
    mkdirSync(join(root, "docs-old"));
    writeFileSync(join(root, "docs-old", "ancient.md"), "# Ancient\n");
    const ancient = commented(db, join(root, "docs-old", "ancient.md"));

    const answer = renameEntry(db, { root, path: join(root, "docs"), name: "documentation" });
    assert.equal(answer.ok, true);

    assert.equal(
      findDocument(db, { kind: "file", value: join(root, "docs-old", "ancient.md") })?.id,
      ancient,
      "the string-prefix bug: /docs-old never lived inside /docs",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("an unapproved working copy follows the file, bytes and all", () => {
    const root = workspace();
    const db = database();
    const from = join(root, "docs", "guide.md");
    const documentId = commented(db, from);
    const meta = ensureWorkingCopy(documentId, from);
    writeFileSync(currentPath(meta), "# Guide, rewritten\n");

    const answer = renameEntry(db, { root, path: from, name: "handbook.md" });
    assert.equal(answer.ok, true);

    const after = readMeta(documentId);
    assert.equal(after?.path, join(root, "docs", "handbook.md"), "approve writes to the new name");
    assert.ok(after !== null);
    assert.equal(readFileSync(currentPath(after), "utf8"), "# Guide, rewritten\n");
    assert.equal(readFileSync(basePath(after), "utf8"), "# Guide\n");
    rmSync(root, { recursive: true, force: true });
  });

  it("a case-only rename is allowed — the same file is not 'already taken'", () => {
    const root = workspace();
    const db = database();
    const from = join(root, "README.md");
    const documentId = commented(db, from);

    const answer = renameEntry(db, { root, path: from, name: "Readme.md" });
    assert.equal(answer.ok, true, answer.ok ? "" : answer.reason);
    assert.equal(
      findDocument(db, { kind: "file", value: join(root, "Readme.md") })?.id,
      documentId,
    );
    rmSync(root, { recursive: true, force: true });
  });
});

describe("§3 — to the Bin", () => {
  it("moves the file and keeps every comment on it", async () => {
    const root = workspace();
    const db = database();
    const path = join(root, "docs", "guide.md");
    const documentId = commented(db, path);
    const bin = fakeBin();

    const answer = await deleteEntry({ root, path }, bin.trash);
    assert.equal(answer.ok, true);
    assert.deepEqual(bin.taken, [path]);
    assert.ok(!existsSync(path));
    assert.equal(
      findDocument(db, { kind: "file", value: path })?.id,
      documentId,
      "§3.2 — put the file back and the comments are still there",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a folder", async () => {
    const root = workspace();
    const bin = fakeBin();
    const answer = await deleteEntry({ root, path: join(root, "docs") }, bin.trash);
    assert.equal(answer.ok, false);
    assert.deepEqual(bin.taken, []);
    assert.ok(existsSync(join(root, "docs", "guide.md")));
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a file with an unapproved working copy", async () => {
    const root = workspace();
    const db = database();
    const path = join(root, "docs", "guide.md");
    const meta = ensureWorkingCopy(commented(db, path), path);
    writeFileSync(currentPath(meta), "# Work nobody has approved\n");
    const bin = fakeBin();

    const answer = await deleteEntry({ root, path }, bin.trash);
    assert.equal(answer.ok, false);
    assert.deepEqual(bin.taken, [], "the Bin was never asked");
    assert.ok(existsSync(path));
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a path outside the workspace, and never asks the Bin", async () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), "rex-elsewhere-"));
    writeFileSync(join(outside, "secret.md"), "# Not yours\n");
    const bin = fakeBin();

    const answer = await deleteEntry({ root, path: join(outside, "secret.md") }, bin.trash);
    assert.equal(answer.ok, false);
    assert.deepEqual(bin.taken, []);
    assert.ok(existsSync(join(outside, "secret.md")));

    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
