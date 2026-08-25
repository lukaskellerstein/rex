// Spec 15 §11 — the working copy, the patch, and the line map.
//
// The fixture is a scratch git repository with one committed file and one
// UNTRACKED directory holding a Markdown document. That is §1.1 reduced to its
// cause: `git status --porcelain` prints one line for the untracked tree, the
// same line before an edit and after it, which is why the old Apply reported
// `Applied to 0 file(s).` about a file it had just changed.
//
// It is a scratch repository and never a real one. A test that edits somebody's
// working tree is its own bug.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

const WORK = mkdtempSync(join(tmpdir(), "rex-work-"));
process.env.REX_WORK_PATH = WORK;

const { changedRegions } = await import("../src/main/diff.ts");
const { hunksOf, toCurrentLine, toOriginalLine } = await import(
  "../src/renderer/overlay/lineMap.ts"
);
const {
  approveWorkingCopy,
  basePath,
  BEFORE_SET_CAP,
  BeforeSetTooLarge,
  currentHash,
  currentPath,
  discardWorkingCopy,
  forkWorkingCopy,
  listWorkingCopies,
  movedSince,
  readMeta,
  readMetaByPath,
  restoreFromBeforeSet,
  saveRevision,
  takeBeforeSet,
  undoLastRevision,
} = await import("../src/main/work.ts");
const { workingDiff } = await import("../src/main/workDiff.ts");
const { changedFiles } = await import("../src/main/git.ts");

let repo = "";
/** The document in the untracked tree — the one the old Apply could not see. */
let doc = "";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

const ORIGINAL = ["# Components", "", "one", "two", "three", ""].join("\n");

before(() => {
  repo = mkdtempSync(join(tmpdir(), "rex-repo-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(repo, "README.md"), "# Tracked\n");
  git("add", "README.md");
  git("commit", "-qm", "first");

  mkdirSync(join(repo, "docs"), { recursive: true });
  doc = join(repo, "docs", "components.md");
  writeFileSync(doc, ORIGINAL);
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(WORK, { recursive: true, force: true });
});

describe("§1.2 — the cause", () => {
  test("an untracked tree is now listed file by file", () => {
    // `git status --porcelain` alone prints `?? docs/`. With
    // `--untracked-files=all` the document itself is in the list, which is what
    // lets the before-set copy it.
    assert.ok(changedFiles(repo).includes("docs/components.md"));
  });
});

describe("§3 — the working copy", () => {
  test("forking writes base and current before anything else happens", () => {
    const meta = forkWorkingCopy("doc-1", doc);
    assert.equal(readFileSync(basePath(meta), "utf8"), ORIGINAL);
    assert.equal(readFileSync(currentPath(meta), "utf8"), ORIGINAL);
    assert.equal(meta.revisions.length, 0);
  });

  test("forking twice keeps the first fork", () => {
    writeFileSync(currentPath(forkWorkingCopy("doc-1", doc)), "edited\n");
    const again = forkWorkingCopy("doc-1", doc);
    assert.equal(readFileSync(currentPath(again), "utf8"), "edited\n");
  });

  test("a revision is saved only when the content moved", () => {
    const meta = readMeta("doc-1") as NonNullable<ReturnType<typeof readMeta>>;
    const hash = currentHash(meta);
    assert.equal(saveRevision(meta, { applyRunId: "r0", threadId: "t", before: hash }), null);

    writeFileSync(currentPath(meta), "changed once\n");
    const next = saveRevision(meta, { applyRunId: "r1", threadId: "t", before: hash });
    assert.ok(next);
    assert.equal(next.revisions.length, 1);
    assert.equal(next.current, 1);
  });

  test("undo steps back one run, and the file was never touched", () => {
    const meta = readMeta("doc-1") as NonNullable<ReturnType<typeof readMeta>>;
    writeFileSync(currentPath(meta), "changed twice\n");
    saveRevision(meta, { applyRunId: "r2", threadId: "t", before: "whatever" });

    const back = undoLastRevision("doc-1");
    assert.ok(back);
    assert.equal(back.revisions.length, 1);
    assert.equal(readFileSync(currentPath(back), "utf8"), "changed once\n");
    assert.equal(readFileSync(doc, "utf8"), ORIGINAL, "the reviewer's file is untouched");
  });

  test("it is found by path, which is how doc:open decides what to render", () => {
    assert.equal(readMetaByPath(doc)?.documentId, "doc-1");
    assert.equal(readMetaByPath(join(repo, "README.md")), null);
    assert.equal(listWorkingCopies().length, 1);
  });
});

describe("§6.3 — the patch", () => {
  test("an untracked file gets a real diff, which git diff cannot draw", () => {
    const meta = readMeta("doc-1") as NonNullable<ReturnType<typeof readMeta>>;
    writeFileSync(currentPath(meta), ["# Components", "", "one", "TWO", "three", ""].join("\n"));

    const change = workingDiff({
      base: basePath(meta),
      current: currentPath(meta),
      path: doc,
      root: repo,
    });

    assert.ok(change.patch.length > 0, "the patch is not empty");
    assert.equal(change.addedLines, 1);
    assert.equal(change.removedLines, 1);
    // The headers name the reviewer's file, never the copies in ~/.rex/work.
    assert.ok(change.patch.includes("+++ b/docs/components.md"));
    assert.ok(!change.patch.includes(".rex"));
    assert.deepEqual(change.added, [{ file: doc, from: 4, to: 4 }]);
    assert.deepEqual(change.removed, [{ file: doc, from: 4, to: 4 }]);
  });

  test("identical files produce nothing at all", () => {
    const meta = readMeta("doc-1") as NonNullable<ReturnType<typeof readMeta>>;
    const change = workingDiff({
      base: basePath(meta),
      current: basePath(meta),
      path: doc,
      root: repo,
    });
    assert.equal(change.patch, "");
    assert.deepEqual(change.added, []);
  });
});

describe("§7 — approve and discard", () => {
  test("approving writes the new version over the file", () => {
    const meta = forkWorkingCopy("doc-2", doc);
    writeFileSync(currentPath(meta), "approved\n");
    saveRevision(meta, { applyRunId: "r3", threadId: "t", before: "before" });

    assert.equal(readFileSync(doc, "utf8"), ORIGINAL, "untouched until approval");
    assert.deepEqual(approveWorkingCopy("doc-2"), { ok: true });
    assert.equal(readFileSync(doc, "utf8"), "approved\n");
    assert.equal(readMeta("doc-2"), null, "the directory is gone");

    writeFileSync(doc, ORIGINAL);
  });

  test("§7.3 — it refuses when the file moved under the copy, and writes nothing", () => {
    const meta = forkWorkingCopy("doc-3", doc);
    writeFileSync(currentPath(meta), "proposed\n");
    // The reviewer edited the document in their own editor meanwhile.
    writeFileSync(doc, "their own edit\n");

    const answer = approveWorkingCopy("doc-3");
    assert.equal(answer.ok, false);
    assert.match(answer.reason ?? "", /changed on disk/);
    assert.equal(readFileSync(doc, "utf8"), "their own edit\n", "their edit survives");

    discardWorkingCopy("doc-3");
    writeFileSync(doc, ORIGINAL);
  });

  test("discarding leaves the file exactly as it was", () => {
    const meta = forkWorkingCopy("doc-4", doc);
    writeFileSync(currentPath(meta), "never wanted\n");
    discardWorkingCopy("doc-4");
    assert.equal(readFileSync(doc, "utf8"), ORIGINAL);
    assert.equal(readMeta("doc-4"), null);
  });
});

describe("§3.4 and §4.3 — the before-set", () => {
  test("it copies content, and notices what moved", () => {
    const set = takeBeforeSet(repo, [doc]);
    assert.equal(movedSince(set, doc), false);
    writeFileSync(doc, "the agent wrote here\n");
    assert.equal(movedSince(set, doc), true);

    restoreFromBeforeSet(set, doc, "run-1");
    assert.equal(readFileSync(doc, "utf8"), ORIGINAL);
  });

  test("what it found is kept before it is put back", () => {
    const set = takeBeforeSet(repo, [doc]);
    writeFileSync(doc, "a save the reviewer made mid-run\n");
    restoreFromBeforeSet(set, doc, "run-2");

    const kept = join(WORK, "_restored", "run-2", "components.md");
    assert.equal(readFileSync(kept, "utf8"), "a save the reviewer made mid-run\n");
    assert.equal(readFileSync(doc, "utf8"), ORIGINAL);
  });

  test("a file that did not exist is removed rather than restored", () => {
    const invented = join(repo, "docs", "invented.md");
    const set = takeBeforeSet(repo, [doc]);
    writeFileSync(invented, "the agent made this up\n");
    restoreFromBeforeSet(set, invented, "run-3");
    assert.throws(() => readFileSync(invented));
  });

  test("§3.4 — over the cap it refuses, before any agent starts", () => {
    const big = join(repo, "docs", "big.bin");
    writeFileSync(big, Buffer.alloc(BEFORE_SET_CAP + 1));
    assert.throws(() => takeBeforeSet(repo, [big]), BeforeSetTooLarge);
    rmSync(big);
  });
});

describe("§6.2 — the two sides of a patch", () => {
  const patch = [
    "diff --git a/x.md b/x.md",
    "--- a/x.md",
    "+++ b/x.md",
    "@@ -1,4 +1,5 @@",
    " one",
    "-two",
    "+TWO",
    "+two and a half",
    " three",
    " four",
  ].join("\n");

  test("the new side is what the right-hand pane tints", () => {
    assert.deepEqual(changedRegions(patch, "/root", "new"), [
      { file: "/root/x.md", from: 2, to: 3 },
    ]);
  });

  test("the old side is what the left-hand pane tints", () => {
    assert.deepEqual(changedRegions(patch, "/root", "old"), [
      { file: "/root/x.md", from: 2, to: 2 },
    ]);
  });

  test("the default side is the new one, so no old caller changed", () => {
    assert.deepEqual(changedRegions(patch, "/root"), changedRegions(patch, "/root", "new"));
  });
});

describe("§6.2 — the line map that keeps the panes level", () => {
  const hunks = hunksOf(
    ["@@ -1,4 +1,5 @@", " one", "-two", "+TWO", "+two and a half", " three"].join("\n"),
  );

  test("a line before every hunk is the same line", () => {
    assert.equal(toOriginalLine(hunks, 1), 1);
    assert.equal(toCurrentLine(hunks, 1), 1);
  });

  test("a line inside a hunk lands on the top of the same change", () => {
    assert.equal(toOriginalLine(hunks, 3), 1);
  });

  test("a line after a hunk carries the shift", () => {
    // The new version gained one line, so line 8 there is line 7 here.
    assert.equal(toOriginalLine(hunks, 8), 7);
    assert.equal(toCurrentLine(hunks, 7), 8);
  });

  test("a hunk with no count is one line long", () => {
    const one = hunksOf("@@ -3 +3,2 @@");
    assert.deepEqual(one, [{ oldStart: 3, oldCount: 1, newStart: 3, newCount: 2 }]);
  });
});
