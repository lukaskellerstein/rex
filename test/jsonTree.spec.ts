// Spec 51 §5.4 — depth 4's fold tree, as data.
//
// Criterion A9 is a claim about this module: **every node folds, and a folded
// node keeps its summary.** A fold that hides a thing without saying how much it
// hid is a fold nobody dares open or leave, and that is the failure this file
// exists to prevent.
//
// Run: npm run test:json-tree

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  BLOB_PREFIX,
  foldablePaths,
  jsonLines,
  messagesOf,
  pathLabel,
  roleOf,
  valueAt,
  valueText,
  visibleLines,
} from "../src/renderer/overlay/jsonTree.ts";

/** One assistant message, in the shape an SDK actually sends. */
const MESSAGE = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "x".repeat(640), signature: "ErUBCkYIBRgCKkD1x9" },
    {
      type: "tool_use",
      id: "toolu_01AbCdEf",
      name: "Read",
      input: { file_path: "~/.rex/work/9f2c/sample-report.md", offset: 140, limit: 30 },
    },
  ],
};

test("every object and array is a foldable node, and a leaf is not", () => {
  const lines = jsonLines(MESSAGE);
  const nodes = foldablePaths(lines);
  assert.ok(nodes.includes("root"), "the message itself folds");
  assert.ok(nodes.includes("root.content"), "the content array folds");
  assert.ok(nodes.includes("root.content.1.input"), "a tool's input folds");
  assert.equal(nodes.includes("root.role"), false, "a string is not a node");
});

test("a folded node keeps its summary — criterion A9", () => {
  const lines = jsonLines(MESSAGE);
  const input = lines.find((line) => line.path === "root.content.1.input");
  assert.equal(input?.tail, "3 keys");
  // The summary is on the LINE, not on the children, so folding cannot lose it:
  // the line is still drawn when the node is shut.
  const shut = new Set(["root.content.1.input"]);
  const drawn = visibleLines(lines, shut);
  const folded = drawn.find((line) => line.path === "root.content.1.input");
  assert.equal(folded?.tail, "3 keys", "the count survived the fold");
  // `input` is the block's last key, so no trailing comma. The comma is part of
  // the folded text on purpose: a shut node has to read as valid JSON in place.
  assert.equal(folded?.shut, "{ … }", "and the line says it is hiding something");
  const content = visibleLines(lines, new Set(["root.content.0"])).find(
    (line) => line.path === "root.content.0",
  );
  assert.equal(content?.shut, "{ … },", "a node with a sibling after it keeps its comma");
});

test("a folded node's children and its closing brace are hidden", () => {
  const lines = jsonLines(MESSAGE);
  const drawn = visibleLines(lines, new Set(["root.content.1.input"]));
  assert.equal(
    drawn.some((line) => line.path === "root.content.1.input.offset"),
    false,
  );
  assert.equal(
    drawn.some((line) => line.path === "root.content.1.input/close"),
    false,
    "the closing brace goes too, so `{ … }` is one line and not two",
  );
});

test("a content block says WHAT it is, not how many keys it has", () => {
  // `thinking` and `tool_use · Read` are the whole reason somebody is scrolling.
  // `4 keys` is true and useless.
  const lines = jsonLines(MESSAGE);
  assert.equal(lines.find((line) => line.path === "root.content.0")?.tail, "thinking");
  assert.equal(lines.find((line) => line.path === "root.content.1")?.tail, "tool_use · Read");
});

test("a long string is cut, and says how long it really was", () => {
  const line = jsonLines(MESSAGE).find((one) => one.path === "root.content.0.thinking");
  assert.ok((line?.value.length ?? 0) < 60, "the line is one line");
  assert.equal(line?.tail, "640 chars", "and it says what it cut");
});

test("a long string carries the WHOLE text, so it can be read", () => {
  // Reported 2026-09-09: *"you are showing just part of it and then 1,229 chars
  // more but I need to see the whole text."* A count of what is hidden is not a
  // way to read it, so the line carries every character.
  const line = jsonLines(MESSAGE).find((one) => one.path === "root.content.0.thinking");
  assert.equal(line?.full, "x".repeat(640));
  assert.equal(line?.full?.length, 640);
});

test("a short string offers nothing to expand", () => {
  // A control that does nothing is worse than no control.
  const lines = jsonLines({ short: "hello", long: "y".repeat(200) });
  assert.equal(lines.find((one) => one.path === "root.short")?.full, null);
  assert.equal(lines.find((one) => one.path === "root.long")?.full?.length, 200);
});

test("an image reference offers nothing to expand either", () => {
  // Its whole text is a hash. There is nothing in it to read.
  const lines = jsonLines({ url: `${BLOB_PREFIX}${"a".repeat(80)}.b64` });
  assert.equal(lines.find((one) => one.path === "root.url")?.full, null);
});

test("an image reference is drawn as an image, never as forty characters of hash", () => {
  // §3.1 rule 4 — the base64 left the log and a reference took its place. A
  // reader wants to know it is an image, not to read its digest.
  const lines = jsonLines({ url: `${BLOB_PREFIX}blobs/2026-09-09/deadbeef.b64` });
  const line = lines.find((one) => one.path === "root.url");
  assert.equal(line?.value, '"an image, stored beside the log"');
  assert.equal(line?.tail, "blobs/2026-09-09/deadbeef.b64");
});

test("values keep their kind, which is the only thing colour means here", () => {
  const lines = jsonLines({ a: "text", b: 42, c: true, d: null });
  assert.equal(lines.find((one) => one.path === "root.a")?.kind, "string");
  assert.equal(lines.find((one) => one.path === "root.b")?.kind, "number");
  assert.equal(lines.find((one) => one.path === "root.c")?.kind, "atom");
  assert.equal(lines.find((one) => one.path === "root.d")?.kind, "atom");
});

test("nothing folded means nothing hidden", () => {
  const lines = jsonLines(MESSAGE);
  assert.equal(visibleLines(lines, new Set()).length, lines.length);
});

// ── the pager (§5.4) ────────────────────────────────────────────

test("the messages come out of a whole request, and out of an old bare array", () => {
  // §3 made `request_body` the whole request. The log still holds rows written
  // before that, where the body IS the array — both have to read.
  assert.equal(messagesOf({ model: "m", messages: [{}, {}] }).length, 2);
  assert.equal(messagesOf([{}, {}, {}]).length, 3, "the pre-spec-51 shape");
  assert.deepEqual(messagesOf(undefined), [], "capture off is no messages, not a throw");
  assert.deepEqual(messagesOf({ model: "m" }), []);
});

test("a message with no role says so rather than guessing one", () => {
  assert.equal(roleOf({ role: "user" }), "user");
  assert.equal(roleOf({}), "?");
  assert.equal(roleOf(null), "?");
});

// ── the pane beside the tree (§5.4, amended 2026-09-11) ─────────
//
// The tree draws paths and the reader picks one. These three turn that string
// back into the thing it came from, into a label a person can read, and into
// text. Every path they are given comes out of `jsonLines`, so the tests build
// them the same way rather than writing them by hand.

test("a picked path resolves to the value the tree drew there", () => {
  const paths = jsonLines(MESSAGE).map((line) => line.path);
  assert.ok(paths.includes("root.content.1.name"), "the tree really draws this path");

  assert.equal(valueAt(MESSAGE, "root.content.1.name"), "Read");
  assert.equal(valueAt(MESSAGE, "root.content.1.input.offset"), 140);
  assert.equal(valueAt(MESSAGE, "root.role"), "assistant");
  assert.equal(valueAt(MESSAGE, "root"), MESSAGE, "the root is the message itself");
  assert.deepEqual(valueAt(MESSAGE, "root.content.1.input"), MESSAGE.content[1].input);
});

test("a closing brace resolves to the node it closes, and a stale path to nothing", () => {
  // Both come off the screen rather than out of a mistake: the tree emits a
  // `/close` line per node, and the pager can move a selection out from under
  // itself. Neither may throw.
  assert.deepEqual(valueAt(MESSAGE, "root.content.1/close"), MESSAGE.content[1]);
  assert.equal(valueAt(MESSAGE, "root.content.9.name"), undefined, "past the end");
  assert.equal(valueAt(MESSAGE, "root.nothing.here"), undefined);
  assert.equal(valueAt(MESSAGE, "elsewhere.role"), undefined, "not one of our paths");
  assert.equal(valueAt(null, "root.role"), undefined);
});

test("a path is labelled the way a person writes it", () => {
  assert.equal(pathLabel("root.content.0.text"), "content[0].text");
  assert.equal(pathLabel("root.content.1.input.file_path"), "content[1].input.file_path");
  assert.equal(pathLabel("root.role"), "role");
  assert.equal(pathLabel("root.content.1/close"), "content[1]");
  assert.equal(pathLabel("root"), "", "the whole message is the caller's word, not ours");
});

test("a string is its own text; anything else is JSON again", () => {
  // The point of the pane: a string arrives with its REAL line breaks, which is
  // the one thing the tree can never show, because a row is one row.
  assert.equal(valueText("one\ntwo"), "one\ntwo");
  assert.equal(valueText(140), "140");
  assert.equal(valueText(undefined), "", "a path that named nothing is not the text 'undefined'");
  assert.match(valueText({ a: 1 }), /^\{\n {2}"a": 1\n\}$/, "indented, not one line");
});
