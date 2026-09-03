// Spec 21 §2 — what a run does with the files it wrote outside its own list.
//
// Real files and a real repository, not a fake. The decision under test is
// "delete one of the reviewer's files, or keep it", and every input to it comes
// from the filesystem or from git: a test against a mock would be a test of the
// mock, and the two bugs this covers both live in the gap between what git
// reports and what is actually on disk.
//
// The important one is `restore-git`. Before spec 21 a **tracked, clean** file
// was absent from the before-set — it holds only what `git status` reported —
// so "no bytes to put back" was read as "it was never there", and the restore
// for that is `rmSync`. An agent that touched a committed file therefore had it
// deleted, under a notice that said REX had put it back.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

let repo: string;
let work: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function write(relativePath: string, text: string): string {
  const path = join(repo, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

before(() => {
  work = mkdtempSync(join(tmpdir(), "rex-work-"));
  // Set before `work.ts` is imported: `workRoot()` reads the variable on every
  // call, but the stash directory must never land in the real ~/.rex.
  process.env.REX_WORK_PATH = work;
});

after(() => {
  rmSync(work, { recursive: true, force: true });
  if (repo) rmSync(repo, { recursive: true, force: true });
});

beforeEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = mkdtempSync(join(tmpdir(), "rex-repo-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write("docs/committed.md", "the committed text\n");
  write("docs/target.md", "the document under review\n");
  // Spec 22 §2.2 — one file of each kind the rule tells apart: a document REX
  // can draw two versions of, and one it cannot.
  write("site/index.html", "<p>the committed page</p>\n");
  write("docs/numbers.json", '{"the": "committed data"}\n');
  git("add", "-A");
  git("commit", "-qm", "first");
});

/** The before-set as `apply.ts` builds it: git's changed paths, plus targets. */
async function beforeSetFor(targets: string[]) {
  const { takeBeforeSet } = await import("../src/main/work.ts");
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repo,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => join(repo, line.slice(2).trim()));
  return takeBeforeSet(repo, [...new Set([...targets, ...status])]);
}

// Spec 22 §2.2 moved Markdown and HTML out of the put-back. These three keep
// testing it on the file kind that still gets one.
describe("§2.3 — a file that existed is put back, never deleted", () => {
  it("a TRACKED, CLEAN file the agent changed is restored to its committed text", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const path = join(repo, "docs/numbers.json");
    const set = await beforeSetFor([]);
    // The before-set does NOT hold it: git reported nothing about a clean file.
    assert.equal(set.contents.has(path), false, "precondition: absent from the before-set");

    writeFileSync(path, "the agent's text\n");
    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-1",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(existsSync(path), true, "the reviewer's committed file must still exist");
    assert.equal(readFileSync(path, "utf8"), '{"the": "committed data"}\n');
    assert.deepEqual(stray.restored, ["docs/numbers.json"]);
    assert.deepEqual(stray.created, []);
    assert.deepEqual(stray.adopted, []);
  });

  it("what it found is kept first, so the agent's text is recoverable", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const path = join(repo, "docs/numbers.json");
    const set = await beforeSetFor([]);
    writeFileSync(path, "the agent's text\n");
    putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-stash",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    const stashed = join(work, "_restored", "run-stash", "numbers.json");
    assert.equal(readFileSync(stashed, "utf8"), "the agent's text\n");
  });

  it("a DIRTY file the agent changed is restored from the bytes REX kept", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const path = join(repo, "docs/numbers.json");
    writeFileSync(path, "the reviewer's own edit\n");
    const set = await beforeSetFor([]);
    assert.equal(set.contents.has(path), true, "precondition: git reported it, so REX copied it");

    writeFileSync(path, "the agent's text\n");
    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-2",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    // Not the committed text — the reviewer's uncommitted edit, which git
    // checkout would have thrown away.
    assert.equal(readFileSync(path, "utf8"), "the reviewer's own edit\n");
    assert.deepEqual(stray.restored, ["docs/numbers.json"]);
  });

  it("a path the agent named but never changed is not reported at all", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const path = join(repo, "docs/committed.md");
    writeFileSync(path, "the reviewer's own edit\n");
    const set = await beforeSetFor([]);

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-3",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.deepEqual(stray.restored, []);
    assert.deepEqual(stray.created, []);
    assert.equal(readFileSync(path, "utf8"), "the reviewer's own edit\n");
  });
});

describe("§2 — a file that did not exist is kept, and shown", () => {
  it("a new file inside the workspace survives the run", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const path = write("docs/EARS_example.md", "# EARS by Example\n");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-4",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(existsSync(path), true, "spec 21 §1 — this is the file that was deleted");
    assert.equal(readFileSync(path, "utf8"), "# EARS by Example\n");
    assert.deepEqual(stray.created, ["docs/EARS_example.md"]);
    assert.deepEqual(stray.restored, []);
  });

  it("any extension is kept — §6, REX holds nothing so it has no opinion", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const paths = ["notes.md", "page.html", "helper.ts", "data.json"].map((name) =>
      write(`docs/${name}`, "x"),
    );

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-5",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set(paths),
      allowed: new Set(),
    });

    assert.equal(stray.created.length, 4);
    for (const path of paths) assert.equal(existsSync(path), true, path);
  });

  it("a new file under node_modules is removed — the tree would never draw it", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const path = write("node_modules/pkg/notes.md", "x");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-6",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(existsSync(path), false);
    assert.deepEqual(stray.created, []);
    assert.deepEqual(stray.restored, ["node_modules/pkg/notes.md"]);
  });

  it("a new file outside the workspace is removed", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const outside = mkdtempSync(join(tmpdir(), "rex-elsewhere-"));
    const path = join(outside, "stray.md");
    writeFileSync(path, "x");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-7",
      root: repo,
      // The workspace is the repository; this path is somewhere else entirely.
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(existsSync(path), false);
    assert.deepEqual(stray.created, []);
    rmSync(outside, { recursive: true, force: true });
  });

  it("with no workspace open, a new file is removed", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const path = write("docs/orphan.md", "x");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-8",
      root: repo,
      workspaceRoot: null,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(existsSync(path), false);
    assert.deepEqual(stray.created, []);
  });
});

describe("§2 — the boundaries that were already there", () => {
  it("a working copy the run was allowed to edit is not a stray write", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const path = write("docs/target.md", "the agent's new version\n");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-9",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set([path]),
    });

    assert.deepEqual(stray.restored, []);
    assert.deepEqual(stray.created, []);
    assert.equal(readFileSync(path, "utf8"), "the agent's new version\n");
  });

  it("REX's own store is never touched, whatever the agent wrote there", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    // `base` is the only copy of the reviewer's original bytes in the whole
    // design, and "restoring" a path REX has no before-bytes for is a delete.
    const path = join(work, "some-doc-id", "overview.original.md");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "the reviewer's original\n");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-10",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(readFileSync(path, "utf8"), "the reviewer's original\n");
    assert.deepEqual(stray.restored, []);
    assert.deepEqual(stray.created, []);
    // Spec 21 §13 — untouched, but no longer unmentioned. A write to `base` is
    // the agent overwriting the reviewer's only original, and REX saying
    // nothing about it was the same silence §13 reports.
    assert.deepEqual(stray.misplaced, [path]);
  });
});

describe("§13 — a file written into REX's store is reported, not lost", () => {
  it("a new file beside the working copies survives and is named", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    // §13's own case: the agent read "inside this workspace" as "the directory
    // the files you may edit are in", and wrote 9.5 KB where nothing shows it.
    const path = join(work, "ce0de02e", "EARS_example.md");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "# EARS by Example\n");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-11",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(existsSync(path), true, "the bytes are the only copy — never delete them");
    assert.equal(readFileSync(path, "utf8"), "# EARS by Example\n");
    assert.deepEqual(stray.misplaced, [path], "absolute: it is the way back to the file");
    assert.deepEqual(stray.created, [], "nothing was added to the workspace");
    assert.deepEqual(stray.restored, [], "nothing was put back");
  });

  it("REX does not move it into the workspace", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const path = join(work, "ce0de02e", "notes.md");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "x");

    putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-12",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    // Where it "should" have gone is a guess, and a guess that writes into the
    // reviewer's tree can overwrite a file nobody named. §13 reports instead.
    assert.equal(existsSync(join(repo, "notes.md")), false);
    assert.equal(existsSync(join(repo, "docs/notes.md")), false);
  });

  it("the working copy the run was allowed to edit is not reported", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);
    const path = join(work, "ce0de02e", "overview.new.md");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "the agent's version\n");

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-13",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set([path]),
    });

    // The ordinary, correct write. Every run makes one, and a notice about it
    // would fire on every ACT.
    assert.deepEqual(stray.misplaced, []);
    assert.deepEqual(stray.created, []);
    assert.deepEqual(stray.restored, []);
  });

  it("a run that wrote nowhere odd reports nothing", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const set = await beforeSetFor([]);

    const stray = putBack({
      threadId: "thread-1",
      documentIdFor: () => "doc-1",
      applyRunId: "run-14",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set(),
      allowed: new Set(),
    });

    assert.deepEqual(stray, { restored: [], created: [], misplaced: [], adopted: [] });
  });
});

describe("spec 22 §3 — an edit under the workspace root is held, not put back", () => {
  /**
   * The whole adoption, as `apply.ts` drives it, with the id it would mint.
   * The before-set is the caller's, taken BEFORE the agent's write — as the
   * run takes it — or it would hold the agent's bytes as the original.
   */
  async function adopt(
    path: string,
    documentId: string,
    applyRunId: string,
    set: Awaited<ReturnType<typeof beforeSetFor>>,
  ) {
    const { putBack } = await import("../src/main/stray.ts");
    const asked: string[] = [];
    const stray = putBack({
      threadId: "thread-22",
      documentIdFor: (asked_path) => {
        asked.push(asked_path);
        return documentId;
      },
      applyRunId,
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });
    return { stray, asked };
  }

  it("a TRACKED, CLEAN Markdown file: the disk is the original, the copy is the agent's", async () => {
    const { basePath, currentPath } = await import("../src/main/work.ts");
    const path = join(repo, "docs/committed.md");
    const set = await beforeSetFor([]);
    assert.equal(set.contents.has(path), false, "precondition: absent from the before-set");

    writeFileSync(path, "the agent's text\n");
    const { stray, asked } = await adopt(path, "doc-committed", "run-20", set);

    assert.equal(readFileSync(path, "utf8"), "the committed text\n", "the file holds what it held");
    assert.deepEqual(stray.restored, [], "not a put-back");
    assert.deepEqual(stray.created, [], "not a creation");
    assert.equal(stray.adopted.length, 1);

    const meta = stray.adopted[0];
    assert.equal(meta.documentId, "doc-committed");
    assert.equal(meta.path, path);
    assert.equal(readFileSync(basePath(meta), "utf8"), "the committed text\n");
    assert.equal(readFileSync(currentPath(meta), "utf8"), "the agent's text\n");
    assert.equal(meta.revisions.length, 1);
    assert.equal(meta.revisions[0].applyRunId, "run-20");
    assert.equal(meta.revisions[0].threadId, "thread-22");
    assert.deepEqual(asked, [path], "the document row is asked for once");
  });

  it("a DIRTY Markdown file: `base` is the reviewer's own edit, not the commit", async () => {
    const { basePath, currentPath } = await import("../src/main/work.ts");
    const path = join(repo, "docs/committed.md");
    writeFileSync(path, "the reviewer's own edit\n");
    // Taken now, so it holds the reviewer's edit — as `apply.ts` takes it
    // before the agent starts.
    const { takeBeforeSet } = await import("../src/main/work.ts");
    const set = takeBeforeSet(repo, [path]);
    assert.equal(set.contents.has(path), true, "precondition: REX copied the dirty file");

    writeFileSync(path, "the agent's text\n");
    const { putBack } = await import("../src/main/stray.ts");
    const stray = putBack({
      threadId: "thread-22",
      documentIdFor: () => "doc-dirty",
      applyRunId: "run-21",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(readFileSync(path, "utf8"), "the reviewer's own edit\n");
    assert.equal(stray.adopted.length, 1);
    assert.equal(readFileSync(basePath(stray.adopted[0]), "utf8"), "the reviewer's own edit\n");
    assert.equal(readFileSync(currentPath(stray.adopted[0]), "utf8"), "the agent's text\n");
  });

  it("a second run on the same file adds a revision to the same copy", async () => {
    const { basePath, currentPath } = await import("../src/main/work.ts");
    const path = join(repo, "docs/committed.md");
    const first = await beforeSetFor([]);
    writeFileSync(path, "the agent's first text\n");
    await adopt(path, "doc-twice", "run-22a", first);
    assert.equal(readFileSync(path, "utf8"), "the committed text\n", "put back after run 1");

    const second = await beforeSetFor([]);
    writeFileSync(path, "the agent's second text\n");
    const { stray } = await adopt(path, "doc-twice", "run-22b", second);

    assert.equal(stray.adopted.length, 1);
    const meta = stray.adopted[0];
    assert.equal(meta.revisions.length, 2);
    assert.deepEqual(
      meta.revisions.map((revision) => revision.applyRunId),
      ["run-22a", "run-22b"],
    );
    assert.equal(readFileSync(basePath(meta), "utf8"), "the committed text\n");
    assert.equal(readFileSync(currentPath(meta), "utf8"), "the agent's second text\n");
  });

  it("an HTML file is adopted too", async () => {
    const { currentPath } = await import("../src/main/work.ts");
    const path = join(repo, "site/index.html");
    const set = await beforeSetFor([]);
    writeFileSync(path, "<p>the agent's page</p>\n");
    const { stray } = await adopt(path, "doc-html", "run-23", set);

    assert.equal(readFileSync(path, "utf8"), "<p>the committed page</p>\n");
    assert.equal(stray.adopted.length, 1);
    assert.equal(readFileSync(currentPath(stray.adopted[0]), "utf8"), "<p>the agent's page</p>\n");
  });

  it("a file the agent named and wrote unchanged makes no copy and asks for no row", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const path = join(repo, "docs/committed.md");
    const set = await beforeSetFor([]);
    writeFileSync(path, "the committed text\n");

    const stray = putBack({
      threadId: "thread-22",
      documentIdFor: () => {
        throw new Error("no row for a file nothing happened to");
      },
      applyRunId: "run-24",
      root: repo,
      workspaceRoot: repo,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.deepEqual(stray.adopted, []);
    assert.deepEqual(stray.restored, []);
  });

  it("the agent's version is the copy, so nothing goes under _restored", async () => {
    const path = join(repo, "docs/committed.md");
    const set = await beforeSetFor([]);
    writeFileSync(path, "the agent's text\n");
    await adopt(path, "doc-no-stash", "run-25", set);

    assert.equal(existsSync(join(work, "_restored", "run-25")), false);
  });

  it("with no workspace open, a Markdown edit is put back exactly as before", async () => {
    const { putBack } = await import("../src/main/stray.ts");
    const path = join(repo, "docs/committed.md");
    const set = await beforeSetFor([]);
    writeFileSync(path, "the agent's text\n");

    const stray = putBack({
      threadId: "thread-22",
      documentIdFor: () => "doc-never",
      applyRunId: "run-26",
      root: repo,
      workspaceRoot: null,
      beforeSet: set,
      wrote: new Set([path]),
      allowed: new Set(),
    });

    assert.equal(readFileSync(path, "utf8"), "the committed text\n");
    assert.deepEqual(stray.restored, ["docs/committed.md"]);
    assert.deepEqual(stray.adopted, []);
  });
});
