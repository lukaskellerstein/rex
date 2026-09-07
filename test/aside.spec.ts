// Which agent text is the answer, which is a remark, and where a block may not
// be merged upward — the rule the comment card and the trace sheet both read.
//
// The card's own `turnsOf` lives in a `.tsx` file that `node --test` cannot
// load, so this is the only place the rule can be checked. It matters: getting
// it wrong prints `ANSWER` twice down one reply, or hides the answer under a
// remark, which is the bug `aside.ts` was written for.
//
// Run: npm run test:aside

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { agentText } from "../src/renderer/overlay/aside.ts";
import type { Message } from "../src/shared/types.ts";

/** A thread, in arrival order: `seq` is the position, which is the walk's order. */
function thread(rows: Array<[Message["kind"], Partial<Message>]>): Message[] {
  return rows.map(([kind, extra], position) => ({
    id: `m${position + 1}`,
    threadId: "t",
    seq: position + 1,
    role: "assistant",
    kind,
    content: "…",
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
    createdAt: "2026-09-04T19:00:00.000Z",
    ...extra,
  })) as Message[];
}

const you: [Message["kind"], Partial<Message>] = ["text", { role: "user", content: "why?" }];
const said = (text: string): [Message["kind"], Partial<Message>] => ["text", { content: text }];
const thought = (text = "let me check"): [Message["kind"], Partial<Message>] => [
  "thinking",
  { content: text },
];
const call: [Message["kind"], Partial<Message>] = ["tool_call", { toolName: "Read" }];
const result: [Message["kind"], Partial<Message>] = ["tool_result", { role: "user" }];

test("one answer split across rows is one block", () => {
  const { asides, breaks } = agentText(thread([you, said("part one"), said("part two")]));
  assert.equal(asides.size, 0);
  assert.equal(breaks.size, 0);
});

test("the agent speaking again after tool work makes the first an aside", () => {
  const { asides, breaks } = agentText(
    thread([you, said("let me look"), call, result, said("here it is")]),
  );
  assert.deepEqual([...asides], ["m2"]);
  assert.equal(breaks.has("m5"), true);
});

test("a thought demotes what the agent said before it", () => {
  // The agent stopped talking to the reviewer and went back to reasoning, so
  // what it had said is a remark. Before 2026-09-04 the thought was invisible
  // and the two `text` rows merged into one block under the remark's label.
  const { asides } = agentText(thread([you, said("let me look"), thought(), said("here it is")]));
  assert.deepEqual([...asides], ["m2"]);
});

test("a thought with nothing said before it demotes nothing", () => {
  const { asides } = agentText(thread([you, thought(), said("here it is")]));
  assert.equal(asides.size, 0);
});

test("two thoughts in a row are one block", () => {
  // One stream of reasoning, split by the SDK the way one answer arrives as
  // several `text` rows. Neither may open a second folded block.
  const { breaks } = agentText(thread([you, thought("first"), thought("second"), said("done")]));
  assert.equal(breaks.has("m3"), false);
});

test("two thoughts with a tool call between them are two blocks", () => {
  // The second thought happened AFTER the call, and a single block containing
  // both would sit above the call and claim otherwise.
  const { breaks } = agentText(
    thread([you, thought("first"), call, result, thought("second"), said("done")]),
  );
  assert.equal(breaks.has("m5"), true);
});

test("a thought does not become the answer", () => {
  // `asides` only ever holds agent TEXT. A thought is never a candidate for
  // either label, so it can never be demoted and never be the answer.
  const { asides } = agentText(thread([you, said("here it is"), thought("after the fact")]));
  assert.equal(asides.has("m3"), false);
  assert.deepEqual([...asides], ["m2"]);
});

test("an empty thought changes nothing", () => {
  const { asides, breaks } = agentText(
    thread([you, said("part one"), ["thinking", { content: null }], said("part two")]),
  );
  assert.equal(asides.size, 0);
  assert.equal(breaks.size, 0);
});
