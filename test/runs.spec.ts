// Spec 17 §2.1 — the registry of runs in flight, and the three things it does.
//
// This exists because a stop that misses is worse than no stop at all: the
// reviewer believes the run is over, the card clears, and an agent keeps
// spending. Every failure below is silent in exactly that way — a controller
// left in the map after its run ended, a second run on one comment that the
// first stop did not reach, a thread that stays stoppable forever.
//
// Run: npm run test:runs

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { beginRun, endRun, isHeld, stopRun } from "../src/main/agent/runs.ts";

test("a registered run is stopped, and its signal says so", () => {
  const controller = beginRun("thread-a");
  assert.equal(controller.signal.aborted, false);

  assert.equal(stopRun("thread-a"), 1);
  assert.equal(controller.signal.aborted, true);

  endRun("thread-a", controller);
});

test("stopping a thread with nothing running answers 0", () => {
  // §3.1 — the card says "that run had already finished" on this, rather than
  // leaving a button that appears to do nothing.
  assert.equal(stopRun("thread-with-no-run"), 0);
});

test("a finished run is no longer stoppable", () => {
  const controller = beginRun("thread-b");
  endRun("thread-b", controller);

  assert.equal(stopRun("thread-b"), 0);
  assert.equal(controller.signal.aborted, false);
});

/**
 * §2.1 — this is why the map holds a set.
 *
 * `startApply` runs one agent per repository, so a comment about files in two
 * repositories has two runs alive under one thread id. A stop that reached only
 * the first would leave the second one spending.
 */
test("every run a thread has is stopped, not just the first", () => {
  const first = beginRun("thread-c");
  const second = beginRun("thread-c");

  assert.equal(stopRun("thread-c"), 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);

  endRun("thread-c", first);
  endRun("thread-c", second);
});

test("one run ending leaves the thread's other run stoppable", () => {
  const first = beginRun("thread-d");
  const second = beginRun("thread-d");
  endRun("thread-d", first);

  assert.equal(stopRun("thread-d"), 1);
  assert.equal(first.signal.aborted, false);
  assert.equal(second.signal.aborted, true);

  endRun("thread-d", second);
});

test("ending a run that was already stopped clears the thread", () => {
  const controller = beginRun("thread-e");
  stopRun("thread-e");
  // Aborting does not remove the controller — `runTurn`'s `finally` does, and
  // it runs after a stop exactly as it does after a normal end.
  endRun("thread-e", controller);

  assert.equal(stopRun("thread-e"), 0);
});

test("ending a run REX never registered changes nothing", () => {
  const stranger = new AbortController();
  const mine = beginRun("thread-f");

  endRun("thread-f", stranger);
  assert.equal(stopRun("thread-f"), 1, "the real run must still be there");

  endRun("thread-f", mine);
});

test("threads are stopped independently", () => {
  // The case "Ask all" makes: fourteen comments running, one of them stopped.
  const one = beginRun("thread-g");
  const two = beginRun("thread-h");

  assert.equal(stopRun("thread-g"), 1);
  assert.equal(two.signal.aborted, false, "another comment's run must survive");

  endRun("thread-g", one);
  endRun("thread-h", two);
});

/**
 * Spec 34 §5.1 — a run holds the documents its prompt named, from `beginRun`
 * to `endRun`. This is what stops approve, discard and undo from replacing a
 * working copy under a running agent (§1.1's incident).
 */
test("a run holds its documents until it ends", () => {
  assert.equal(isHeld("doc-x"), false);
  const controller = beginRun("thread-i", ["doc-x", "doc-y"]);
  assert.equal(isHeld("doc-x"), true);
  assert.equal(isHeld("doc-y"), true);
  assert.equal(isHeld("doc-z"), false, "only what the prompt named");

  endRun("thread-i", controller);
  assert.equal(isHeld("doc-x"), false);
  assert.equal(isHeld("doc-y"), false);
});

test("two runs on one document hold it until the last one ends", () => {
  // §5.5 — several agents on one document is the case the spec exists for, so
  // the hold is a count and not a flag.
  const first = beginRun("thread-j", ["doc-shared"]);
  const second = beginRun("thread-k", ["doc-shared"]);

  endRun("thread-j", first);
  assert.equal(isHeld("doc-shared"), true, "the second run still holds it");

  endRun("thread-k", second);
  assert.equal(isHeld("doc-shared"), false);
});

test("a stopped run releases its documents when it ends, not when it is stopped", () => {
  // Stop aborts; the run's `finally` is what ends it — and until then the
  // agent may still be writing, so the copy must not be replaced yet.
  const controller = beginRun("thread-l", ["doc-stopped"]);
  stopRun("thread-l");
  assert.equal(isHeld("doc-stopped"), true);

  endRun("thread-l", controller);
  assert.equal(isHeld("doc-stopped"), false);
});

test("a run with no documents holds nothing, and the old calls still work", () => {
  const controller = beginRun("thread-m");
  assert.equal(stopRun("thread-m"), 1);
  endRun("thread-m", controller);
});
