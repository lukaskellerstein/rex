// Spec 55 §2 — the facts of a turn, counted in one place for both processes.
//
// The screen groups blocks and the report reads rows, and until this function
// existed each did its own arithmetic. The failure that makes it worth pinning
// is quiet: a report that says a turn cost $0.012 while the screen it was
// copied from says $0.014 is not an error anybody sees, it is two numbers in a
// chat window that cannot both be true.
//
// The other quiet one is the Map key. A message whose `runId` is `undefined`
// rather than `null` made a second "no turn" group, drawn as a turn that never
// happened — and `trace.ts` carried a comment about exactly that for a reason.
//
// Run: npm run test:turns

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { turnFactsOf } from "../src/shared/turns.ts";
import type { Message, MessageKind, MessageRole } from "../src/shared/types.ts";

let seq = 0;

function message(kind: MessageKind, role: MessageRole, fields: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    threadId: "t",
    seq,
    role,
    kind,
    mode: null,
    model: null,
    style: null,
    sdk: null,
    gatewayName: null,
    baseUrl: null,
    runId: null,
    content: null,
    toolName: null,
    toolInput: null,
    isError: false,
    denied: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-09-11T20:12:59.000Z",
    ...fields,
  };
}

test("rows group into turns by their run id, oldest first", () => {
  const turns = turnFactsOf([
    message("text", "user", { runId: "r-1", mode: "ask", content: "what does this mean?" }),
    message("text", "assistant", { runId: "r-1", content: "the deadline moved." }),
    message("text", "user", { runId: "r-2", mode: "act", content: "change it then" }),
    message("text", "assistant", { runId: "r-2", content: "done." }),
  ]);

  assert.deepEqual(
    turns.map((turn) => [turn.runId, turn.number, turn.mode]),
    [
      ["r-1", 1, "ask"],
      ["r-2", 2, "act"],
    ],
  );
});

test("the four who-answered facts come from the newest row that names each", () => {
  // A run can change none of them mid-way, but a row written before a column
  // existed carries a null — and the turn is not entitled to report null when a
  // later row in the same run says what answered.
  const turns = turnFactsOf([
    message("text", "user", { runId: "r-1" }),
    message("text", "assistant", {
      runId: "r-1",
      sdk: "claude-agent",
      gatewayName: "Built-in",
      baseUrl: "http://127.0.0.1:24334",
      model: "gemma-4",
      style: "default",
    }),
    message("completed", "assistant", { runId: "r-1" }),
  ]);

  assert.equal(turns[0]?.sdk, "claude-agent");
  assert.equal(turns[0]?.gatewayName, "Built-in");
  assert.equal(turns[0]?.baseUrl, "http://127.0.0.1:24334");
  assert.equal(turns[0]?.model, "gemma-4");
  assert.equal(turns[0]?.style, "default");
});

test("a cost nobody reported stays null, and one that was reported is summed", () => {
  // Spec 43 §8.1 — a missing cost is unknown and never `$0.00`. A sum seeded at
  // zero makes "the SDK said nothing" and "the SDK said zero" one value.
  const quiet = turnFactsOf([message("text", "user", { runId: "r-1" })]);
  assert.equal(quiet[0]?.costUsd, null);

  const priced = turnFactsOf([
    message("text", "user", { runId: "r-1" }),
    message("completed", "assistant", { runId: "r-1", costUsd: 0, durationMs: 120 }),
  ]);
  assert.equal(priced[0]?.costUsd, 0, "a reported zero is a number, not an absence");
  assert.equal(priced[0]?.durationMs, 120);
});

test("the turn's clock ends at the run's last row, which is the one nothing draws", () => {
  // Spec 55 §6 rule 3 — `completed` carries the run's own numbers and appears
  // on no screen, so a clock that stopped at the last drawn block reported an
  // end before the run had one.
  const turns = turnFactsOf([
    message("text", "user", { runId: "r-1", createdAt: "2026-09-11T20:12:59.000Z" }),
    message("text", "assistant", { runId: "r-1", createdAt: "2026-09-11T20:13:50.000Z" }),
    message("completed", "assistant", { runId: "r-1", createdAt: "2026-09-11T20:13:54.000Z" }),
  ]);

  assert.equal(turns[0]?.startedAt, "2026-09-11T20:12:59.000Z");
  assert.equal(turns[0]?.endedAt, "2026-09-11T20:13:54.000Z");
});

test("a refusal and a failure are both counted, and tool calls are counted apart", () => {
  const turns = turnFactsOf([
    message("text", "user", { runId: "r-1" }),
    message("tool_call", "assistant", { runId: "r-1", toolName: "Bash" }),
    message("tool_result", "user", {
      runId: "r-1",
      toolName: "Bash",
      content: "The read profile cannot write.",
      denied: true,
      isError: true,
    }),
    message("tool_call", "assistant", { runId: "r-1", toolName: "Read" }),
    message("tool_result", "user", { runId: "r-1", toolName: "Read", content: "no such file" }),
  ]);

  assert.equal(turns[0]?.toolCalls, 2);
  assert.equal(turns[0]?.failed, 1, "the refusal counts and the result that worked does not");
  assert.equal(turns[0]?.messages, 5);
});

test("tokens sum across the run and stay null when nothing counted any", () => {
  const turns = turnFactsOf([
    message("text", "user", { runId: "r-1" }),
    message("completed", "assistant", { runId: "r-1", inputTokens: 59305, outputTokens: 1321 }),
    message("text", "user", { runId: "r-2" }),
  ]);

  assert.equal(turns[0]?.inputTokens, 59305);
  assert.equal(turns[0]?.outputTokens, 1321);
  assert.equal(turns[1]?.inputTokens, null);
  assert.equal(turns[1]?.outputTokens, null);
});

test("rows from before the column group into one unnumbered turn", () => {
  // A chat from last week has real machinery in it, and hiding it would say REX
  // had never run. `undefined` and `null` are the same absence: a Map keyed on
  // the raw value made two groups out of one, drawn as a turn that never was.
  const turns = turnFactsOf([
    message("text", "user", { runId: undefined as unknown as null }),
    message("text", "assistant", { runId: null }),
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.runId, null);
  assert.equal(turns[0]?.number, 0, "it is not the first turn of anything");
  assert.equal(turns[0]?.messages, 2);
});
