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
//
// Spec 34 §2 — the copy is permanent. The §3 and §7 cases below check the
// thing that spec reverses: approve and discard move bytes, and the directory
// an agent was pointed at is still there afterwards.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  ensureWorkingCopy,
  isPending,
  listWorkingCopies,
  matchesBase,
  migrateWorkingCopyNames,
  movedSince,
  pendingCopies,
  pendingCopy,
  readMeta,
  readMetaByPath,
  restoreFromBeforeSet,
  saveRevision,
  takeBeforeSet,
  undoLastRevision,
  workDir,
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
  test("the copy writes base and current before anything else happens", () => {
    const meta = ensureWorkingCopy("doc-1", doc);
    assert.equal(readFileSync(basePath(meta), "utf8"), ORIGINAL);
    assert.equal(readFileSync(currentPath(meta), "utf8"), ORIGINAL);
    assert.equal(meta.revisions.length, 0);
    assert.equal(isPending(meta), false, "a fresh copy is the file");
  });

  test("ensuring it again keeps a pending change", () => {
    writeFileSync(currentPath(ensureWorkingCopy("doc-1", doc)), "edited\n");
    const again = ensureWorkingCopy("doc-1", doc);
    assert.equal(readFileSync(currentPath(again), "utf8"), "edited\n");
    assert.equal(isPending(again), true);
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

// The agent reads the working copy and quotes the path it read back to the
// reviewer, so these names end up in the conversation. `current.md:31` read as
// a different file entirely — reported on 2026-08-26.
describe("§3.1 — the files are named after the document", () => {
  test("base, current and every revision carry the document's own name", () => {
    const meta = ensureWorkingCopy("doc-named", doc);
    assert.equal(basename(basePath(meta)), "components.original.md");
    // Spec 34 §3.1 — the copy IS the document, so it carries the document's
    // name and no infix.
    assert.equal(basename(currentPath(meta)), "components.md");

    writeFileSync(currentPath(meta), "a revision\n");
    const next = saveRevision(meta, { applyRunId: "r-n", threadId: "t", before: "before" });
    assert.ok(next);
    assert.ok(existsSync(join(workDir("doc-named"), "components.v1.md")));
    discardWorkingCopy("doc-named");
  });

  test("a copy written by the spec 15 REX is renamed, not lost", () => {
    // Spec 34 §3.4 — the `.new` generation, by hand: what is on disk for a
    // reviewer who has a change open across the change.
    const dir = workDir("doc-new");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "components.original.md"), ORIGINAL);
    writeFileSync(join(dir, "components.new.md"), "the new version\n");
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        documentId: "doc-new",
        path: doc,
        baseSha256: "whatever",
        forkedAt: "2026-08-20T00:00:00.000Z",
        revisions: [],
        current: 0,
      }),
    );

    migrateWorkingCopyNames();

    const meta = readMeta("doc-new") as NonNullable<ReturnType<typeof readMeta>>;
    assert.equal(readFileSync(currentPath(meta), "utf8"), "the new version\n");
    assert.ok(!existsSync(join(dir, "components.new.md")), "and the old name is gone");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a copy written by the first REX is renamed, not lost", () => {
    // The oldest layout, by hand.
    const dir = workDir("doc-old");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "base.md"), ORIGINAL);
    writeFileSync(join(dir, "current.md"), "the new version\n");
    writeFileSync(join(dir, "rev-1.md"), "the new version\n");
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        documentId: "doc-old",
        path: doc,
        baseSha256: "whatever",
        forkedAt: "2026-08-01T00:00:00.000Z",
        revisions: [{ n: 1, applyRunId: "r-old", threadId: "t", at: "x", sha256: "y" }],
        current: 1,
      }),
    );

    migrateWorkingCopyNames();

    const meta = readMeta("doc-old") as NonNullable<ReturnType<typeof readMeta>>;
    assert.equal(readFileSync(currentPath(meta), "utf8"), "the new version\n");
    assert.equal(readFileSync(basePath(meta), "utf8"), ORIGINAL);
    assert.ok(existsSync(join(dir, "components.v1.md")), "the revision moved too");
    assert.ok(!existsSync(join(dir, "current.md")), "and the old name is gone");
    rmSync(dir, { recursive: true, force: true });
  });

  test("running it again does nothing at all", () => {
    const meta = ensureWorkingCopy("doc-twice", doc);
    migrateWorkingCopyNames();
    assert.equal(readFileSync(currentPath(meta), "utf8"), ORIGINAL);
    rmSync(workDir("doc-twice"), { recursive: true, force: true });
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
  test("approving writes the new version over the file, and the copy stays", () => {
    const meta = ensureWorkingCopy("doc-2", doc);
    writeFileSync(currentPath(meta), "approved\n");
    saveRevision(meta, { applyRunId: "r3", threadId: "t", before: "before" });

    assert.equal(readFileSync(doc, "utf8"), ORIGINAL, "untouched until approval");
    assert.deepEqual(approveWorkingCopy("doc-2"), { ok: true });
    assert.equal(readFileSync(doc, "utf8"), "approved\n");

    // Spec 34 §3.2 — the directory an agent was pointed at is still there,
    // holding what the file now holds, with nothing left to undo.
    const after = readMeta("doc-2") as NonNullable<ReturnType<typeof readMeta>>;
    assert.equal(readFileSync(currentPath(after), "utf8"), "approved\n", "the copy is the file");
    assert.equal(readFileSync(basePath(after), "utf8"), "approved\n", "and so is base");
    assert.equal(isPending(after), false);
    assert.equal(after.revisions.length, 0);
    assert.ok(!existsSync(join(workDir("doc-2"), "components.v1.md")), "the revision file went");

    writeFileSync(doc, ORIGINAL);
  });

  test("§7.3 — it refuses when the file moved under the copy, and writes nothing", () => {
    const meta = ensureWorkingCopy("doc-3", doc);
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

  test("discarding leaves the file exactly as it was, and the copy follows it", () => {
    const meta = ensureWorkingCopy("doc-4", doc);
    writeFileSync(currentPath(meta), "never wanted\n");
    saveRevision(meta, { applyRunId: "r4", threadId: "t", before: "before" });
    discardWorkingCopy("doc-4");
    assert.equal(readFileSync(doc, "utf8"), ORIGINAL);

    const after = readMeta("doc-4") as NonNullable<ReturnType<typeof readMeta>>;
    assert.ok(after, "the directory stays");
    assert.equal(readFileSync(currentPath(after), "utf8"), ORIGINAL);
    assert.equal(isPending(after), false);
    assert.equal(after.revisions.length, 0);
  });

  test("discarding a copy whose file is gone falls back to base", () => {
    const orphan = join(repo, "docs", "gone.md");
    writeFileSync(orphan, "was here\n");
    const meta = ensureWorkingCopy("doc-gone", orphan);
    writeFileSync(currentPath(meta), "changed\n");
    rmSync(orphan);

    discardWorkingCopy("doc-gone");
    const after = readMeta("doc-gone") as NonNullable<ReturnType<typeof readMeta>>;
    assert.equal(readFileSync(currentPath(after), "utf8"), "was here\n");
    assert.equal(isPending(after), false);
  });
});

// Spec 34 §2 — "is a change waiting?" is the bytes, never the directory. Under
// spec 15 §4.2 the two were one question, because a copy that matched its base
// was swept away; a run that changed nothing, or a second run that took back
// what the first wrote, both left a fork behind until the sweep ran. Now the
// directory stays and only `isPending` says.
describe("spec 34 §2 — pending is the bytes, not the directory", () => {
  test("matchesBase reads the bytes, not the revision list", () => {
    const meta = ensureWorkingCopy("doc-same", doc);
    assert.equal(matchesBase(meta), true, "a fresh copy is the file");

    writeFileSync(currentPath(meta), "edited\n");
    assert.equal(matchesBase(meta), false);

    // A second run that puts every line back: one more revision, no difference.
    const once = saveRevision(meta, { applyRunId: "r1", threadId: "t", before: "x" });
    assert.ok(once);
    writeFileSync(currentPath(once), ORIGINAL);
    const twice = saveRevision(once, { applyRunId: "r2", threadId: "t", before: "y" });
    assert.ok(twice);
    assert.equal(twice.revisions.length, 2);
    assert.equal(matchesBase(twice), true);
  });

  test("the pending list is what differs, and every directory is still there", () => {
    // `doc-same` is the copy above: two revisions and the original's bytes.
    const kept = ensureWorkingCopy("doc-diff", doc);
    writeFileSync(currentPath(kept), "a real change\n");
    ensureWorkingCopy("doc-fresh", doc);

    const pending = pendingCopies().map((meta) => meta.documentId);
    assert.ok(
      pending.includes("doc-diff"),
      "a difference is pending whatever the book-keeping says",
    );
    assert.ok(!pending.includes("doc-same"), "two revisions, no difference — not pending");
    assert.ok(!pending.includes("doc-fresh"), "never written to — not pending");
    assert.ok(readMeta("doc-same"), "and nothing was removed");
    assert.ok(readMeta("doc-fresh"));
    assert.equal(readFileSync(doc, "utf8"), ORIGINAL, "the reviewer's file is untouched");

    // By path — what `doc:open` asks. Several copies share this document in the
    // fixture; the one it finds is pending, which is the property that matters.
    const found = pendingCopy(doc);
    assert.ok(found);
    assert.equal(isPending(found), true);

    discardWorkingCopy("doc-diff");
    assert.equal(
      pendingCopies().some((meta) => meta.documentId === "doc-diff"),
      false,
    );
  });
});

// Spec 34 §3.3 — the copy can be stale in exactly one way: nothing is pending
// and the reviewer edited the file in their own editor. The one entry point
// that hands a copy to an agent fixes that on the way, and touches nothing when
// a change is pending.
describe("spec 34 §3.3 — the copy follows the file when nothing is pending", () => {
  test("a stale copy takes the file's bytes", () => {
    const meta = ensureWorkingCopy("doc-stale", doc);
    assert.equal(isPending(meta), false);
    writeFileSync(doc, "the reviewer typed this\n");

    const fresh = ensureWorkingCopy("doc-stale", doc);
    assert.equal(readFileSync(currentPath(fresh), "utf8"), "the reviewer typed this\n");
    assert.equal(readFileSync(basePath(fresh), "utf8"), "the reviewer typed this\n");
    assert.equal(isPending(fresh), false);

    writeFileSync(doc, ORIGINAL);
  });

  test("§5.5 — two runs ending on one copy leave two revisions, not one", () => {
    // Both runs read the meta when they started, before either had written.
    const first = ensureWorkingCopy("doc-two-runs", doc);
    const second = ensureWorkingCopy("doc-two-runs", doc);
    const before = currentHash(first);

    writeFileSync(currentPath(first), "run A's edit\n");
    const afterA = saveRevision(first, { applyRunId: "ra", threadId: "ta", before });
    assert.ok(afterA);
    writeFileSync(currentPath(second), "run A's edit\nand run B's\n");
    const afterB = saveRevision(second, { applyRunId: "rb", threadId: "tb", before });
    assert.ok(afterB);

    assert.equal(afterB.revisions.length, 2, "the second run appended to the list on disk");
    assert.equal(afterB.revisions[0].applyRunId, "ra");
    assert.equal(afterB.revisions[1].applyRunId, "rb");
    // Undo steps back to what the copy held when the first run ended.
    const back = undoLastRevision("doc-two-runs");
    assert.ok(back);
    assert.equal(readFileSync(currentPath(back), "utf8"), "run A's edit\n");
    discardWorkingCopy("doc-two-runs");
  });

  test("a pending change is never overwritten by the file", () => {
    const meta = ensureWorkingCopy("doc-held", doc);
    writeFileSync(currentPath(meta), "the agent's change\n");
    writeFileSync(doc, "the reviewer's edit\n");

    const kept = ensureWorkingCopy("doc-held", doc);
    assert.equal(readFileSync(currentPath(kept), "utf8"), "the agent's change\n");
    assert.equal(
      readFileSync(basePath(kept), "utf8"),
      ORIGINAL,
      "base is what the change was made against",
    );
    // And that is §7.3's conflict, which approve still refuses.
    assert.equal(approveWorkingCopy("doc-held").ok, false);

    discardWorkingCopy("doc-held");
    writeFileSync(doc, ORIGINAL);
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
