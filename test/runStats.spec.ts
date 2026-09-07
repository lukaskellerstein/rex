// What ONE answer took, cost and needed — the reviewer's ask of 2026-09-04.
//
// The three numbers are drawn under every answer in the chat and in the trace,
// so a wrong attribution is a wrong claim on the screen rather than a crash:
// this file is the only thing that can catch it. Every case here is a shape a
// real thread actually takes.
//
// Run: npm run test:run-stats

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { costText, runStatsOf, spentText, stepsText } from "../src/shared/totals.ts";
import type { Message } from "../src/shared/types.ts";

/** A thread, in arrival order: `seq` is the position, which is what the walk sorts by. */
function thread(rows: Array<[Message["kind"], Partial<Message>]>): Message[] {
  return rows.map(([kind, extra], position) => ({
    id: `m${position + 1}`,
    threadId: "t",
    seq: position + 1,
    role: "assistant",
    kind,
    content: null,
    toolName: null,
    toolInput: null,
    isError: false,
    denied: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    model: null,
    style: null,
    mode: null,
    sdk: null,
    gatewayName: null,
    baseUrl: null,
    createdAt: "2026-09-04T19:33:52.875Z",
    ...extra,
  })) as Message[];
}

const at = (iso: string): Partial<Message> => ({ createdAt: iso });
const you = (iso: string): [Message["kind"], Partial<Message>] => [
  "text",
  { role: "user", content: "why?", ...at(iso) },
];
const said = (iso: string): [Message["kind"], Partial<Message>] => [
  "text",
  { content: "because.", ...at(iso) },
];
const call = (iso: string): [Message["kind"], Partial<Message>] => [
  "tool_call",
  { toolName: "Read", ...at(iso) },
];
const done = (iso: string, costUsd: number | null = null): [Message["kind"], Partial<Message>] => [
  "completed",
  { role: "system", content: "Completed", costUsd, ...at(iso) },
];

test("the elapsed time is the wall clock from the send to the end of the run", () => {
  // The reviewer's own run, 2026-09-04: sent at 19:33:52.875, completed at
  // 19:34:20.246. The SDK reported 26,536ms for the same run — REX's own work
  // around the call is the difference, and the reviewer waited all of it.
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:33:52.875Z"),
      said("2026-09-04T19:34:20.239Z"),
      done("2026-09-04T19:34:20.246Z"),
    ]),
  );
  assert.equal(stats.get("m2")?.elapsedMs, 27_371);
  assert.equal(spentText(stats.get("m2")?.elapsedMs ?? 0), "27.4s");
});

test("the run is keyed on its LAST answer, so a split answer is counted once", () => {
  // The SDK splits one reply across several `text` messages. The card merges
  // them into one turn whose last message id is the key; the trace keeps them
  // apart and finds the same id on the last block.
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      said("2026-09-04T19:00:02.000Z"),
      said("2026-09-04T19:00:03.000Z"),
      said("2026-09-04T19:00:04.000Z"),
      done("2026-09-04T19:00:05.000Z"),
    ]),
  );
  assert.equal(stats.size, 1);
  assert.equal(stats.get("m4")?.elapsedMs, 5_000);
  assert.equal(stats.get("m2"), undefined);
});

test("an aside is not the answer: the numbers land on the reply that ends the run", () => {
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      said("2026-09-04T19:00:01.000Z"), // the aside: it spoke, then worked
      call("2026-09-04T19:00:02.000Z"),
      ["tool_result", { role: "user", content: "ok", ...at("2026-09-04T19:00:03.000Z") }],
      said("2026-09-04T19:00:09.000Z"), // the answer
      done("2026-09-04T19:00:10.000Z"),
    ]),
  );
  assert.equal(stats.size, 1);
  assert.deepEqual(stats.get("m5"), { elapsedMs: 10_000, costUsd: null, steps: 1 });
});

test("each run in a thread is counted on its own", () => {
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      said("2026-09-04T19:00:04.000Z"),
      done("2026-09-04T19:00:04.000Z", 0.25),
      you("2026-09-04T19:10:00.000Z"),
      call("2026-09-04T19:10:01.000Z"),
      call("2026-09-04T19:10:02.000Z"),
      said("2026-09-04T19:10:30.000Z"),
      done("2026-09-04T19:10:30.000Z", 0.5),
    ]),
  );
  assert.deepEqual(stats.get("m2"), { elapsedMs: 4_000, costUsd: 0.25, steps: 0 });
  assert.deepEqual(stats.get("m7"), { elapsedMs: 30_000, costUsd: 0.5, steps: 2 });
});

test("a cost nobody reported is unknown, and never $0.000", () => {
  // Measured in the reviewer's own database: every message of an Envoy run
  // carries a null `cost_usd`. This asserted `$0.000` until 2026-09-05, on the
  // reasoning that a local model's price is known to be zero — and the reviewer
  // chose the other way, which is what spec 43 §8.1 and spec 44 §11 criterion
  // 12 had said all along.
  //
  // The reasoning was wrong about what a zero says. "Nobody reported one" and
  // "it cost nothing" are two facts, and `$0.000` on both hides the first — a
  // run whose cost REX failed to record looks exactly like a free one, and a
  // column of zeroes invites being added up.
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:33:52.875Z"),
      said("2026-09-04T19:34:20.239Z"),
      done("2026-09-04T19:34:20.246Z", null),
    ]),
  );
  assert.equal(stats.get("m2")?.costUsd, null);
  assert.equal(costText(stats.get("m2")?.costUsd ?? null), "—");
});

test("a cost the SDK DID report is still a number, including a real zero", () => {
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      said("2026-09-04T19:00:05.000Z"),
      done("2026-09-04T19:00:06.000Z", 0),
    ]),
  );
  assert.equal(stats.get("m2")?.costUsd, 0);
  assert.equal(costText(0), "$0.000");
  assert.equal(costText(0.0125), "$0.013");
});

test("a run that answered nothing is keyed on its error or its stop", () => {
  // "It failed after twelve minutes" is worth more than "it failed", so the two
  // ends a reviewer can SEE carry the numbers when no answer did.
  const failed = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      [
        "error",
        { role: "system", content: "boom", isError: true, ...at("2026-09-04T19:12:00.000Z") },
      ],
    ]),
  );
  assert.equal(failed.get("m2")?.elapsedMs, 720_000);

  const stopped = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      call("2026-09-04T19:00:01.000Z"),
      ["stopped", { role: "system", content: "Stopped", ...at("2026-09-04T19:00:20.000Z") }],
    ]),
  );
  assert.deepEqual(stopped.get("m3"), { elapsedMs: 20_000, costUsd: null, steps: 1 });
});

test("a `completed` with no answer before it is keyed on nothing", () => {
  // `completed` is drawn nowhere, so there is no block to hang the numbers on.
  // The thread's own totals still count the run — this map is only about what
  // one visible answer cost.
  const stats = runStatsOf(
    thread([you("2026-09-04T19:00:00.000Z"), done("2026-09-04T19:00:01.000Z", 0.1)]),
  );
  assert.equal(stats.size, 0);
});

test("two sends with no answer between them time the second one", () => {
  // The reviewer typed again before anything came back. The run they are
  // waiting on started at the second send, and the first produced nothing that
  // can honestly be timed.
  const stats = runStatsOf(
    thread([
      you("2026-09-04T19:00:00.000Z"),
      you("2026-09-04T19:05:00.000Z"),
      said("2026-09-04T19:05:08.000Z"),
      done("2026-09-04T19:05:08.000Z"),
    ]),
  );
  assert.equal(stats.get("m3")?.elapsedMs, 8_000);
});

test("a NOTE runs nothing, so it has no numbers", () => {
  const stats = runStatsOf(thread([you("2026-09-04T19:00:00.000Z")]));
  assert.equal(stats.size, 0);
});

test("out-of-order rows are sorted by seq before the walk", () => {
  const rows = thread([
    you("2026-09-04T19:00:00.000Z"),
    said("2026-09-04T19:00:06.000Z"),
    done("2026-09-04T19:00:06.000Z"),
  ]);
  const stats = runStatsOf([...rows].reverse());
  assert.equal(stats.get("m2")?.elapsedMs, 6_000);
});

test("spentText says seconds, then minutes and seconds, then hours and minutes", () => {
  // One formatter for the whole app. There were three, and they disagreed about
  // every run over a minute — which is exactly the run somebody is measuring.
  assert.equal(spentText(0), "0.0s");
  assert.equal(spentText(1_499), "1.5s");
  assert.equal(spentText(27_371), "27.4s");
  assert.equal(spentText(243_000), "4m 03s");
  assert.equal(spentText(4_320_000), "1h 12m");
  // A clock read a tick before its own start must never print a minus.
  assert.equal(spentText(-500), "0.0s");
});

test("stepsText counts one step as `1 step`", () => {
  assert.equal(stepsText(0), "0 steps");
  assert.equal(stepsText(1), "1 step");
  assert.equal(stepsText(4), "4 steps");
});
