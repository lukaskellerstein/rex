// Spec 08 §6.2 — the refusals in the debug report, paired with their commands.
//
// This is the one piece of the report that is not a lookup. Everything else is
// an id, a path or a sum; a denial has to be matched back to the call it
// refused, and §4's `Message` carries no `tool_use_id` to match on. So the
// pairing is rebuilt from order, and what it rebuilds is the single line
// somebody debugging a refusal will read first — the command.
//
// Getting it wrong is quiet: a mispaired command is a plausible command, and it
// sends the reader after the wrong call in a session file of hundreds.
//
// Run: npm run test:debug

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { denialsOf } from "../src/main/debug.ts";
import type { Message, MessageKind, MessageRole } from "../src/shared/types.ts";

let seq = 0;

function message(kind: MessageKind, role: MessageRole, fields: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    threadId: "t",
    seq: seq++,
    role,
    kind,
    content: null,
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-08-23T20:12:03.000Z",
    ...fields,
  };
}

const call = (toolName: string, input: unknown): Message =>
  message("tool_call", "assistant", { toolName, toolInput: input });

const result = (toolName: string, content: string, isError = false): Message =>
  message("tool_result", "user", { toolName, content, isError });

test("a refusal carries the whole command, not the clipped one in its reason", () => {
  const command = `ls -la ${"/some/very/long/path".repeat(4)} 2>&1`;
  const denials = denialsOf([
    message("text", "user", { content: "do you see these?" }),
    call("Bash", { command }),
    result("Bash", "Bash in a read session may not redirect, background or substitute — '…'", true),
  ]);

  assert.equal(denials.length, 1);
  assert.equal(denials[0].toolName, "Bash");
  assert.equal(denials[0].command, command);
  assert.match(denials[0].reason, /may not redirect/);
});

test("an allowed call is not a denial, and does not consume the next one's result", () => {
  const denials = denialsOf([
    call("Read", { file_path: "/docs/one.md" }),
    result("Read", "1\t# Tilecat"),
    call("Bash", { command: "rm -rf /tmp/x" }),
    result("Bash", "'rm' is not on the allowlist", true),
  ]);

  assert.deepEqual(
    denials.map((denial) => denial.command),
    ["rm -rf /tmp/x"],
  );
});

test("two calls in flight at once are paired by tool, not by recency", () => {
  // The SDK emits both calls before either result when the model asks for them
  // in one turn. Pairing on "the most recent call still unanswered" hands the
  // Bash result the Grep call, and the report then names a search as the thing
  // the gate refused.
  const denials = denialsOf([
    call("Bash", { command: "cat a.md > b.md" }),
    call("Grep", { pattern: "retry|backoff" }),
    result("Grep", "3 matches"),
    result("Bash", "Bash in a read session may not redirect", true),
  ]);

  assert.deepEqual(
    denials.map((denial) => denial.command),
    ["cat a.md > b.md"],
  );
});

test("two refusals from the same tool keep their own commands, in order", () => {
  const denials = denialsOf([
    call("Bash", { command: "tee out.txt" }),
    result("Bash", "'tee' is not on the allowlist", true),
    call("Bash", { command: "find . -delete" }),
    result("Bash", "find may walk a tree in a read session but not act on it", true),
  ]);

  assert.deepEqual(
    denials.map((denial) => denial.command),
    ["tee out.txt", "find . -delete"],
  );
});

test("a tool with no command argument reports whatever it was given", () => {
  const denials = denialsOf([
    call("mcp__playwright__browser_click", { element: "Save", ref: "e12" }),
    result("mcp__playwright__browser_click", "MCP tools are deny-by-default", true),
  ]);

  assert.equal(denials[0].command, '{"element":"Save","ref":"e12"}');
});

test("a result whose call is missing is reported rather than dropped", () => {
  // A transcript can be truncated — `tool_result` content is clipped to 4000
  // chars on the way in, and a thread deleted mid-run keeps whatever arrived.
  // The refusal is still the interesting half, so it survives without a call.
  const denials = denialsOf([result("Bash", "'curl' is not on the allowlist", true)]);

  assert.equal(denials.length, 1);
  assert.match(denials[0].command, /not in the transcript/);
});
