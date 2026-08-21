// Spec 05 §10 milestone 18 — a unified diff into the lines to outline.
//
// This is a wrong-place failure waiting to happen: read the `-` side by mistake
// and every outline lands on a paragraph the agent did not touch, with complete
// confidence and no error anywhere. One character in a regex separates the two.
//
// Run: npm run test:diff

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { changedRegions } from "../src/main/diff.ts";

const ROOT = "/tmp/rex-diff-spec";

test("only the added lines are reported, at their new numbers", () => {
  const diff = [
    "diff --git a/docs/a.md b/docs/a.md",
    "index 1111111..2222222 100644",
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -12,3 +12,5 @@ Retry policy",
    " context",
    "-old line",
    "+new line",
    "+another new line",
  ].join("\n");

  // Line 12 is the context line; the two added lines are 13 and 14. The whole
  // hunk would be 12–16, and on a short file that reaches blocks the agent
  // never touched — see the note in diff.ts.
  assert.deepEqual(changedRegions(diff, ROOT), [{ file: `${ROOT}/docs/a.md`, from: 13, to: 14 }]);
});

test("the old side's numbering is never used", () => {
  // The reviewer is about to read the *new* file. A range taken from the old
  // numbering would outline the wrong paragraphs and report nothing wrong.
  const diff = [
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -400,2 +7,2 @@",
    "-was here",
    "+is here",
  ].join("\n");

  assert.deepEqual(changedRegions(diff, ROOT), [{ file: `${ROOT}/docs/a.md`, from: 7, to: 7 }]);
});

test("a hunk that only deletes yields no range", () => {
  // Nothing is left in the document to outline, and the diff says the rest.
  const diff = [
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -12,3 +11,0 @@",
    "-gone",
    "-gone too",
  ].join("\n");

  assert.deepEqual(changedRegions(diff, ROOT), []);
});

test("two separate edits in one hunk stay two ranges", () => {
  // Context between them means two places changed, not one long one — and one
  // long one would outline the untouched paragraph in the middle.
  const diff = [
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -1,6 +1,6 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    " four",
    "-five",
    "+FIVE",
  ].join("\n");

  assert.deepEqual(changedRegions(diff, ROOT), [
    { file: `${ROOT}/docs/a.md`, from: 2, to: 2 },
    { file: `${ROOT}/docs/a.md`, from: 5, to: 5 },
  ]);
});

test("an omitted count means exactly one line", () => {
  const diff = ["--- a/docs/a.md", "+++ b/docs/a.md", "@@ -9 +9 @@", "-old", "+new"].join("\n");

  assert.deepEqual(changedRegions(diff, ROOT), [{ file: `${ROOT}/docs/a.md`, from: 9, to: 9 }]);
});

test("several files in one patch keep their own ranges", () => {
  const diff = [
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -1,2 +1,3 @@",
    "+added",
    " kept",
    "--- a/docs/b.md",
    "+++ b/docs/b.md",
    "@@ -40,1 +41,2 @@",
    " kept there",
    "+added there too",
  ].join("\n");

  assert.deepEqual(changedRegions(diff, ROOT), [
    { file: `${ROOT}/docs/a.md`, from: 1, to: 1 },
    { file: `${ROOT}/docs/b.md`, from: 42, to: 42 },
  ]);
});

test("a deleted file contributes nothing", () => {
  // `+++ /dev/null` — there is no document left to outline anything in.
  const diff = ["--- a/docs/gone.md", "+++ /dev/null", "@@ -1,5 +0,0 @@", "-all of it"].join("\n");

  assert.deepEqual(changedRegions(diff, ROOT), []);
});
