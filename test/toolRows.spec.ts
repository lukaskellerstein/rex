// Spec 36 §3 — the tool calls between two turns, as rows.
//
// Run: npm run test:tool-rows

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { glyphOf, toolRowsOf } from "../src/renderer/overlay/toolRows.ts";
import type { Message } from "../src/shared/types.ts";

/**
 * A thread, built in the order its messages arrive: `seq` is the position in
 * the list, which is what the walk sorts by.
 */
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
    createdAt: "2026-09-02T13:53:00.000Z",
    ...extra,
  })) as Message[];
}

const you = (text: string): [Message["kind"], Partial<Message>] => [
  "text",
  { role: "user", content: text },
];
const said = (text: string): [Message["kind"], Partial<Message>] => ["text", { content: text }];
const call = (
  toolName: string,
  input: Record<string, unknown> = {},
): [Message["kind"], Partial<Message>] => ["tool_call", { toolName, toolInput: input }];
const result = (extra: Partial<Message> = {}): [Message["kind"], Partial<Message>] => [
  "tool_result",
  extra,
];
const diff = (path: string): [Message["kind"], Partial<Message>] => [
  "diff",
  { content: `${path}\n- old\n+ new` },
];

/** The ids of the spoken messages, in order — what `turnsOf` keys its turns by. */
const spoken = (messages: Message[]): Set<string> =>
  new Set(messages.filter((m) => m.kind === "text").map((m) => m.id));

test("spec 36 §3.1 — a tool is drawn by what it does, and its state first", () => {
  assert.equal(glyphOf("Read", false, false), "read");
  assert.equal(glyphOf("Grep", false, false), "read");
  assert.equal(glyphOf("WebFetch", false, false), "read");
  assert.equal(glyphOf("Edit", false, false), "change");
  assert.equal(glyphOf("MultiEdit", false, false), "change");
  assert.equal(glyphOf("Write", false, false), "change");
  assert.equal(glyphOf("Bash", false, false), "command");
  assert.equal(glyphOf("Task", false, false), "command");
  assert.equal(glyphOf("Edit", true, false), "denied");
  assert.equal(glyphOf("Bash", false, true), "failed");
});

test("spec 36 §3.2 — the reviewer's example: you, three tools, an aside, three, an aside, three, the answer", () => {
  const messages = thread([
    you("OK so then update the feedback."),
    call("Bash", { command: "git status" }),
    result(),
    call("Read", { file_path: "/w/lukas-feedback.md" }),
    result(),
    call("Bash", { command: "grep -n 7b" }),
    result(),
    said("Merging."),
    call("Edit", { file_path: "/w/lukas-feedback.md" }),
    diff("/w/lukas-feedback.md"),
    diff("/w/lukas-feedback.md"),
    said("Now removing 7b."),
    call("Edit", { file_path: "/w/lukas-feedback.md" }),
    diff("/w/lukas-feedback.md"),
    call("Bash", { command: "git diff --stat" }),
    result(),
    said("Done."),
  ]);
  const [q, , , , , , , a1, , , , a2, , , , , answer] = messages;
  const rows = toolRowsOf(messages, spoken(messages));

  assert.equal(rows.before.get(q.id), undefined, "nothing runs before the question");
  assert.deepEqual(
    rows.before.get(a1.id)?.map((m) => m.glyph),
    ["command", "read", "command"],
  );
  assert.deepEqual(
    rows.before.get(a2.id)?.map((m) => m.glyph),
    ["change", "diff", "diff"],
  );
  assert.deepEqual(
    rows.before.get(answer.id)?.map((m) => m.glyph),
    ["change", "diff", "command"],
  );
  assert.deepEqual(rows.trailing, []);

  // Hover says which: the tool and its argument, and a diff its path.
  assert.equal(rows.before.get(a1.id)?.[0].detail, "git status");
  assert.equal(rows.before.get(a2.id)?.[1].detail, "/w/lukas-feedback.md");
});

test("a failed result marks the call it belongs to, and a refusal marks it denied", () => {
  const messages = thread([
    you("?"),
    call("Read", { file_path: "/w/missing.md" }),
    result({ isError: true, content: "ENOENT" }),
    call("Edit", { file_path: "/w/a.md" }),
    result({ isError: true, denied: true, content: "refused" }),
    call("Bash", { command: "ls" }),
    result(),
    said("!"),
  ]);
  const answer = messages.at(-1) as Message;
  const rows = toolRowsOf(messages, spoken(messages));
  assert.deepEqual(
    rows.before.get(answer.id)?.map((m) => m.glyph),
    ["failed", "denied", "command"],
  );
});

test("a run still going has a trailing row, and a finished one has none", () => {
  const going = thread([you("?"), call("Read"), result(), call("Bash")]);
  const rows = toolRowsOf(going, spoken(going));
  assert.deepEqual(
    rows.trailing.map((m) => m.glyph),
    ["read", "command"],
  );

  const done = thread([you("?"), call("Read"), result(), call("Bash"), result(), said("!")]);
  const answer = done.at(-1) as Message;
  const finished = toolRowsOf(done, spoken(done));
  assert.deepEqual(finished.trailing, []);
  assert.equal(finished.before.get(answer.id)?.length, 2);
});

test("the walk is in seq order whatever order the messages arrive in", () => {
  const messages = thread([you("?"), call("Read"), call("Bash"), said("!")]);
  const answer = messages.at(-1) as Message;
  const shuffled = [messages[3], messages[2], messages[0], messages[1]];
  const rows = toolRowsOf(shuffled, spoken(messages));
  assert.deepEqual(
    rows.before.get(answer.id)?.map((m) => m.name),
    ["Read", "Bash"],
  );
});
