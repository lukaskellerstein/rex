// Spec 63 §3.2 and §3.3 — two pages' blocks, aligned, and the kind of each.
//
// Asserted rather than looked at, for the reason anchoring is: a wrong
// alignment still outlines SOMETHING. A block marked changed when its content
// is identical in both versions is the wrong outline spec 15 refused to draw.
//
// No DOM. The blocks arrive as their own content, which is what `changes.ts`
// builds from the page.
//
// Run: npm run test:block-diff

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { diffBlocks } from "../src/renderer/overlay/blockDiff.ts";

test("identical pages change nothing", () => {
  assert.deepEqual(diffBlocks(["a", "b", "c"], ["a", "b", "c"]), {
    before: [null, null, null],
    after: [null, null, null],
  });
});

test("a block only the new version has is added, and nothing else is", () => {
  assert.deepEqual(diffBlocks(["a", "b", "c"], ["a", "b", "new", "c"]), {
    before: [null, null, null],
    after: [null, null, "added", null],
  });
});

test("a block only the original has is removed", () => {
  assert.deepEqual(diffBlocks(["a", "gone", "b"], ["a", "b"]), {
    before: [null, "removed", null],
    after: [null, null],
  });
});

test("a gap that lost and gained is rewritten, on both sides", () => {
  // `b` became `B` and `x` was added beside it: one stretch, one rewrite.
  assert.deepEqual(diffBlocks(["a", "b", "c"], ["a", "B", "x", "c"]), {
    before: [null, "changed", null],
    after: [null, "changed", "changed", null],
  });
});

test("separate edits stay separate, and the blocks between them stay unchanged", () => {
  assert.deepEqual(diffBlocks(["a", "b", "c", "d", "e"], ["a", "B", "c", "d", "e", "f"]), {
    before: [null, "changed", null, null, null],
    after: [null, "changed", null, null, null, "added"],
  });
});

test("a repeated block is aligned, not mistaken for a change", () => {
  // Three identical rows and one inserted before them: only the insertion is new.
  assert.deepEqual(diffBlocks(["row", "row", "row"], ["head", "row", "row", "row"]), {
    before: [null, null, null],
    after: ["added", null, null, null],
  });
});

test("an empty side is all added or all removed", () => {
  assert.deepEqual(diffBlocks([], ["a", "b"]), { before: [], after: ["added", "added"] });
  assert.deepEqual(diffBlocks(["a"], []), { before: ["removed"], after: [] });
});

test("§3.4 — a change too big to align draws nothing", () => {
  const before = Array.from({ length: 2100 }, (_, at) => `old ${at}`);
  const after = Array.from({ length: 2100 }, (_, at) => `new ${at}`);
  assert.equal(diffBlocks(before, after), null);
});

test("a large page with a small change is still aligned", () => {
  // The unchanged head and tail are trimmed before the table is built, so a
  // long document pays only for the stretch that changed.
  const before = Array.from({ length: 20_000 }, (_, at) => `block ${at}`);
  const after = [...before];
  after[10_000] = "rewritten";
  const diff = diffBlocks(before, after);
  assert.ok(diff);
  assert.equal(diff.after.filter((kind) => kind !== null).length, 1);
  assert.equal(diff.after[10_000], "changed");
  assert.equal(diff.before[10_000], "changed");
});
