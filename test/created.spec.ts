// Spec 21 §2 — the file the agent creates, and the decision that keeps it.
//
// This decision is the one that has to be right, and it is wrong in two
// directions rather than one. Treat a modification as a creation and REX keeps
// a change nobody agreed to. Treat a creation as a modification and REX deletes
// the file the reviewer asked for — which is spec 21 §1's report, and it went
// unnoticed because a delete and a restore print the same sentence.
//
// Pure, so the tests are about what is decided rather than about what moved.
// The file operations that follow each verdict are in `main/apply.ts`.

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  classifyStray,
  isInsideWorkspace,
  keepsCreatedFile,
} from "../src/main/workspace/created.ts";

const ROOT = "/Users/someone/Projects/shop";

describe("§3 — inside the workspace", () => {
  it("a file under the root is inside it", () => {
    assert.equal(isInsideWorkspace(ROOT, join(ROOT, "docs", "overview.md")), true);
  });

  it("the root itself is not a file in it", () => {
    assert.equal(isInsideWorkspace(ROOT, ROOT), false);
  });

  it("a sibling directory sharing a name prefix is outside", () => {
    // The string-prefix bug this exists to avoid: `/…/shop-archive` starts with
    // `/…/shop`, and is a different workspace.
    assert.equal(isInsideWorkspace(ROOT, "/Users/someone/Projects/shop-archive/notes.md"), false);
  });

  it("a path that walks out with .. is outside", () => {
    assert.equal(isInsideWorkspace(ROOT, join(ROOT, "..", "..", "..", "etc", "hosts")), false);
  });
});

describe("§3 — where a created file is kept", () => {
  it("a document at the path the reviewer named is kept", () => {
    assert.equal(keepsCreatedFile(ROOT, join(ROOT, "docs", "EARS_example.md")), true);
  });

  it("any extension is kept — §6, REX holds nothing so it has no opinion", () => {
    for (const name of ["notes.md", "page.html", "helper.ts", "data.json", "logo.png"]) {
      assert.equal(keepsCreatedFile(ROOT, join(ROOT, name)), true, name);
    }
  });

  it("a file under a directory the tree never draws is not kept", () => {
    for (const directory of ["node_modules", "dist", ".git", "build", ".venv"]) {
      assert.equal(keepsCreatedFile(ROOT, join(ROOT, directory, "thing.md")), false, directory);
    }
  });

  it("a FILE named like a skipped directory is kept", () => {
    // The segment check must exclude the file's own name, or a document called
    // `build` would be thrown away for its name alone.
    assert.equal(keepsCreatedFile(ROOT, join(ROOT, "docs", "build")), true);
  });

  it("a file outside the workspace is not kept", () => {
    assert.equal(keepsCreatedFile(ROOT, "/tmp/scratch.md"), false);
  });

  it("with no workspace open, nothing is kept", () => {
    // REX cannot show a file in a tree that is not on screen, and a file it
    // cannot draw is the silent case spec 21 exists to end.
    assert.equal(keepsCreatedFile(null, join(ROOT, "docs", "new.md")), false);
  });
});

describe("§2.3 — did it exist, and therefore what happens to it", () => {
  const stray = (over: Partial<Parameters<typeof classifyStray>[0]>) =>
    classifyStray({
      path: join(ROOT, "docs", "new.md"),
      inBeforeSet: false,
      tracked: false,
      workspaceRoot: ROOT,
      ...over,
    });

  // Spec 22 §2 moved Markdown and HTML out of the three put-back cases below.
  // A `.json` is what a put-back still looks like.
  const data = join(ROOT, "docs", "numbers.json");

  it("in the before-set — a modification, restored from the bytes REX kept", () => {
    assert.equal(stray({ path: data, inBeforeSet: true }), "restore-bytes");
  });

  it("tracked and clean — a modification, restored with git checkout", () => {
    // The regression this test exists for. Before spec 21 a tracked clean file
    // was absent from the before-set, so "no bytes" was read as "never there"
    // and the restore was a delete of the reviewer's committed file.
    assert.equal(stray({ path: data, tracked: true }), "restore-git");
  });

  it("the before-set wins over git — REX's own copy is the exact one", () => {
    assert.equal(stray({ path: data, inBeforeSet: true, tracked: true }), "restore-bytes");
  });

  it("in neither, inside the workspace — a creation, kept", () => {
    assert.equal(stray({}), "keep");
  });

  it("in neither, outside the workspace — a creation nobody would see, deleted", () => {
    assert.equal(stray({ path: "/tmp/scratch.md" }), "delete");
  });

  it("in neither, under node_modules — deleted", () => {
    assert.equal(stray({ path: join(ROOT, "node_modules", "x", "readme.md") }), "delete");
  });

  it("in neither, with no workspace — deleted", () => {
    assert.equal(stray({ workspaceRoot: null }), "delete");
  });
});

describe("spec 22 §2 — an edit to a text document under the workspace is adopted", () => {
  const stray = (over: Partial<Parameters<typeof classifyStray>[0]>) =>
    classifyStray({
      path: join(ROOT, "docs", "feedback.md"),
      inBeforeSet: false,
      tracked: false,
      workspaceRoot: ROOT,
      ...over,
    });

  it("a Markdown file that existed — in the before-set — is adopted", () => {
    assert.equal(stray({ inBeforeSet: true }), "adopt");
  });

  it("a Markdown file that existed — tracked and clean — is adopted", () => {
    assert.equal(stray({ tracked: true }), "adopt");
  });

  it("an HTML file is adopted too", () => {
    assert.equal(stray({ path: join(ROOT, "site", "index.html"), tracked: true }), "adopt");
  });

  it("a .docx is not — it is a zip, and an Edit into it is corruption", () => {
    assert.equal(stray({ path: join(ROOT, "docs", "brief.docx"), tracked: true }), "restore-git");
  });

  it("a .pptx is not, for the same reason", () => {
    assert.equal(
      stray({ path: join(ROOT, "docs", "deck.pptx"), inBeforeSet: true }),
      "restore-bytes",
    );
  });

  it("code is not — REX cannot draw two versions of it", () => {
    assert.equal(
      stray({ path: join(ROOT, "src", "index.ts"), inBeforeSet: true }),
      "restore-bytes",
    );
  });

  it("outside the workspace — put back, as before", () => {
    assert.equal(stray({ path: "/tmp/notes.md", inBeforeSet: true }), "restore-bytes");
  });

  it("under node_modules — put back, the tree would never draw the copy", () => {
    assert.equal(
      stray({ path: join(ROOT, "node_modules", "x", "readme.md"), tracked: true }),
      "restore-git",
    );
  });

  it("with no workspace open — put back, exactly as before spec 22", () => {
    assert.equal(stray({ workspaceRoot: null, tracked: true }), "restore-git");
  });

  it("a file that did NOT exist is a creation, never an adoption", () => {
    assert.equal(stray({}), "keep");
  });
});
