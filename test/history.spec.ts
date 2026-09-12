// Spec 53 §5.4 — the back and forward stacks.
//
// The reviewer's six steps in §1.1 are one claim about this module: after
// following a link and reading a while, ONE gesture returns to the file AND to
// the row. The row is carried, not recomputed, so the test that matters is that
// the place which comes back is the place that went in.
//
// Run: npm run test:history

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  canGoBack,
  canGoForward,
  EMPTY_HISTORY,
  goBack,
  goForward,
  HISTORY_DEPTH,
  type History,
  pushPlace,
} from "../src/renderer/overlay/history.ts";
import type { DocumentPlace } from "../src/shared/types.ts";

function place(path: string, line: number | null, scrollY = 0): DocumentPlace {
  return { path, line, scrollY, zoom: 1 };
}

const A = place("/docs/a.md", 120, 4000);
const B = place("/docs/b.md", 7, 300);
const C = place("/docs/c.md", null, 980);

test("an empty history offers neither direction", () => {
  assert.equal(canGoBack(EMPTY_HISTORY), false);
  assert.equal(canGoForward(EMPTY_HISTORY), false);
  assert.equal(goBack(EMPTY_HISTORY, A), null);
  assert.equal(goForward(EMPTY_HISTORY, A), null);
});

test("the reviewer's six steps: back returns the file AND the row", () => {
  // Reading a.md at line 120, a link on that line is clicked.
  const afterClick = pushPlace(EMPTY_HISTORY, A);
  assert.equal(canGoBack(afterClick), true);

  // Reading b.md a while, then back.
  const step = goBack(afterClick, place("/docs/b.md", 55, 1800));
  assert.ok(step);
  assert.deepEqual(step.to, A, "the place that comes back is the place that went in");
  assert.equal(step.to.line, 120, "the row, not the top of the file");
  assert.equal(canGoBack(step.history), false);
  assert.equal(canGoForward(step.history), true);
});

test("forward is the mirror, so the pair walks the same two files both ways", () => {
  const back = goBack(pushPlace(EMPTY_HISTORY, A), B);
  assert.ok(back);
  const forward = goForward(back.history, back.to);
  assert.ok(forward);
  assert.deepEqual(forward.to, B);
  assert.deepEqual(forward.history.back, [A]);
  assert.deepEqual(forward.history.forward, []);
});

test("a chain of three walks back in order", () => {
  const history = pushPlace(pushPlace(pushPlace(EMPTY_HISTORY, A), B), C);
  const first = goBack(history, place("/docs/d.md", 1));
  assert.ok(first);
  assert.deepEqual(first.to, C);
  const second = goBack(first.history, first.to);
  assert.ok(second);
  assert.deepEqual(second.to, B);
  const third = goBack(second.history, second.to);
  assert.ok(third);
  assert.deepEqual(third.to, A);
  assert.equal(canGoBack(third.history), false);
});

test("opening something new throws the forward stack away", () => {
  const back = goBack(pushPlace(EMPTY_HISTORY, A), B);
  assert.ok(back);
  assert.equal(canGoForward(back.history), true);

  const opened = pushPlace(back.history, back.to);
  assert.equal(canGoForward(opened), false, "the branch not taken is gone, as in a browser");
  assert.deepEqual(opened.back, [A]);
});

test("the cap drops the oldest entry, never the newest", () => {
  let history: History = EMPTY_HISTORY;
  for (let i = 0; i < HISTORY_DEPTH + 10; i++) {
    history = pushPlace(history, place(`/docs/${i}.md`, i));
  }
  assert.equal(history.back.length, HISTORY_DEPTH);
  assert.equal(history.back.at(-1)?.path, `/docs/${HISTORY_DEPTH + 9}.md`);
  assert.equal(history.back[0]?.path, "/docs/10.md");
});

test("a place with no line still travels, for the formats that stamp none", () => {
  const step = goBack(pushPlace(EMPTY_HISTORY, C), A);
  assert.ok(step);
  assert.equal(step.to.line, null);
  assert.equal(step.to.scrollY, 980, "the offset is what a DOCX or a PDF has instead");
});

test("nothing is mutated in place", () => {
  const start = pushPlace(EMPTY_HISTORY, A);
  const snapshot = JSON.stringify(start);
  goBack(start, B);
  pushPlace(start, C);
  assert.equal(JSON.stringify(start), snapshot);
});
