// Spec 51 §5.3 — every API shape depth 3 has to read, checked against the shape
// the wire really uses.
//
// **This file exists because seeded fixtures kept passing while the real thing
// was broken.** Three rounds of that on 2026-09-09: a Codex turn drew a column
// of `?` because the Responses API's items have no `role` at all, and no test I
// had written could have caught it — every one of them was written from the
// shape I already handled.
//
// So the fixtures below are transcribed from a REAL request out of
// `~/.rex/gateway/traffic/`, key for key, and the roles they assert are the
// roles the screen must show for them.
//
// Run: npm run test:wire

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readWire, wireEntries } from "../src/renderer/overlay/wire.ts";

// ── Anthropic, `/v1/messages` — the Claude Agent SDK ─────────────
//
// Measured: `role=user blocks=['tool_result','tool_result']`. There is no
// `role: "tool"` in this format at all.

test("Anthropic — a tool call is a `tool_use` block, named by its tool", () => {
  const seen = readWire({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "The quote is two paragraphs above." },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.md" } },
    ],
  });
  assert.deepEqual(seen.tools, ["Read"]);
  assert.equal(seen.role, "", "the word `assistant` adds nothing beside `Read`");
  assert.equal(seen.kind, "assistant");
  assert.equal(seen.thinking, true, "the thinking block is what the line shows");
});

test("Anthropic — a tool RESULT is a user message, and reads as `tool`", () => {
  const seen = readWire({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "30 lines" }],
  });
  assert.equal(seen.role, "tool");
  assert.equal(seen.kind, "tool");
  assert.equal(seen.text, "30 lines");
});

test("Anthropic — a real user message stays `user`", () => {
  const seen = readWire({ role: "user", content: [{ type: "text", text: "does it hold?" }] });
  assert.equal(seen.role, "user");
  assert.equal(seen.kind, "user");
});

// ── OpenAI chat, `/v1/chat/completions` ──────────────────────────

test("OpenAI chat — the call is in `tool_calls`, its arguments a JSON STRING", () => {
  const seen = readWire({
    role: "assistant",
    content: null,
    reasoning_content: "Let me read the file first.",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "Read", arguments: '{"file_path":"/a.md"}' },
      },
    ],
  });
  assert.deepEqual(seen.tools, ["Read"]);
  assert.equal(seen.role, "");
  assert.equal(seen.thinking, true, "the reasoning leads, as the thinking block does");
  assert.equal(seen.text, "Let me read the file first.");
});

test("OpenAI chat — a tool result has a role of its own", () => {
  const seen = readWire({ role: "tool", tool_call_id: "call_1", content: "30 lines" });
  assert.equal(seen.role, "tool");
  assert.equal(seen.kind, "tool");
  assert.equal(seen.text, "30 lines");
});

// ── OpenAI responses, `/v1/responses` — Codex ────────────────────
//
// **The shape that drew a column of `?`.** Its items carry a `type` and no
// `role`. Transcribed from run `mttw07pz-4`, a real 55-item request.

test("Responses — a `reasoning` item has NO role, and reads as thinking", () => {
  const seen = readWire({
    type: "reasoning",
    id: "rs_7b7083de",
    summary: [
      { type: "summary_text", text: "The user is asking, with reference to the document…" },
    ],
    content: null,
    encrypted_content: null,
  });
  assert.equal(seen.kind, "assistant");
  assert.equal(seen.thinking, true);
  assert.match(seen.text, /^The user is asking/);
  assert.notEqual(seen.role, "?", "a `?` is what this shape used to draw");
  // And it has to say SOMETHING: on this API reasoning is an item of its own,
  // so unlike Anthropic's it has no tool call beside it to take a name from.
  assert.equal(seen.role, "thinking");
});

test("Responses — a `function_call` is named by its tool", () => {
  const seen = readWire({
    type: "function_call",
    call_id: "call_9",
    name: "shell",
    arguments: '{"command":["bash","-lc","ls"]}',
  });
  assert.deepEqual(seen.tools, ["shell"]);
  assert.equal(seen.role, "");
  assert.match(seen.text, /bash/);
});

test("Responses — a `function_call_output` reads as `tool`", () => {
  const seen = readWire({
    type: "function_call_output",
    call_id: "call_9",
    id: "fc_1",
    output: "a.md\nb.md",
  });
  assert.equal(seen.role, "tool");
  assert.equal(seen.kind, "tool");
  assert.match(seen.text, /a\.md/);
});

test("Responses — a `message` item keeps its role", () => {
  const seen = readWire({
    type: "message",
    id: "msg_1",
    role: "developer",
    content: [{ type: "input_text", text: "You answer questions about a document." }],
  });
  assert.equal(seen.role, "developer");
  assert.equal(seen.kind, "system", "developer is the system voice");
  assert.match(seen.text, /You answer questions/);
});

// ── the point of all three ───────────────────────────────────────

test("all three shapes use the same four words, so two agents compare", () => {
  const anthropic = readWire({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t", content: "out" }],
  });
  const chat = readWire({ role: "tool", tool_call_id: "c", content: "out" });
  const responses = readWire({ type: "function_call_output", call_id: "c", output: "out" });

  for (const seen of [anthropic, chat, responses]) {
    assert.equal(seen.role, "tool");
    assert.equal(seen.kind, "tool");
    assert.equal(seen.text, "out");
  }
});

test("nothing REX cannot place is invented into a role", () => {
  // A shape no adapter sends yet must read as unknown, not as a guess.
  const seen = readWire({ something: "else" });
  assert.equal(seen.kind, "other");
});

// ── the system prompt, which is not one of the messages ──────────
//
// Every fixture below is the real shape out of `~/.rex/gateway/traffic/`, and
// the nesting is the point: what `rex_trace.py` records is LiteLLM's `kwargs`,
// and by then the request as it ARRIVED is four levels down. A reader that goes
// looking for `system` at the top level of the record finds nothing and reports
// "this turn had no system prompt", which is the failure these tests exist to
// stop — a turn of 8 138 characters of instructions drawing as if it had none.

/** The record's shape: LiteLLM's kwargs, with the arrived request inside it. */
function recorded(body: Record<string, unknown>, messages: unknown[]): unknown {
  return {
    model: "lmstudio-google-gemma-4-26b-a4b-qat",
    messages,
    litellm_params: { proxy_server_request: { url: "/v1/messages", method: "POST", body } },
  };
}

test("Anthropic — the `system` field becomes the first row, before message 1", () => {
  const entries = wireEntries(
    recorded(
      {
        model: "lmstudio-google-gemma-4-26b-a4b-qat",
        system: [
          { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.259.14d;" },
          { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ],
        messages: [{ role: "user", content: [{ type: "text", text: "is this true?" }] }],
      },
      [{ role: "user", content: [{ type: "text", text: "is this true?" }] }],
    ),
  );

  assert.equal(entries.length, 2, "the prompt is a row the messages array does not have");
  assert.equal(entries[0]?.at, null, "it belongs to no place in `messages`");
  assert.equal(entries[0]?.seen.kind, "prompt");
  assert.equal(entries[0]?.seen.role, "system prompt");
  assert.equal(entries[1]?.at, 0, "the first message is still the first message");
  assert.equal(entries[1]?.seen.role, "user");
});

test("Anthropic — every block is in the preview, not only the first", () => {
  // Claude Code's block 0 is a 73-character billing header. A preview of that
  // alone says nothing at all about the prompt underneath it.
  const entries = wireEntries(
    recorded(
      {
        system: [
          { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.259.14d;" },
          { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ],
        messages: [],
      },
      [],
    ),
  );
  assert.match(entries[0]?.seen.text ?? "", /You are Claude Code/);
});

test("Responses — the prompt is `instructions`, and is one string", () => {
  const entries = wireEntries(
    recorded(
      {
        model: "codex-model",
        instructions: "You are a coding agent running in the Codex CLI.",
        input: [{ type: "message", role: "user", content: [] }],
      },
      [{ type: "message", role: "developer", content: [] }],
    ),
  );
  assert.equal(entries[0]?.seen.kind, "prompt");
  assert.match(entries[0]?.seen.text ?? "", /Codex CLI/);
  assert.equal(entries[1]?.at, 0);
});

test("OpenAI chat — its prompt is already message 1, so no row is added", () => {
  const entries = wireEntries(
    recorded({ model: "m", messages: [{ role: "system", content: "You answer questions." }] }, [
      { role: "system", content: "You answer questions." },
      { role: "user", content: "is this true?" },
    ]),
  );
  assert.equal(entries.length, 2, "two messages and nothing else");
  assert.equal(entries[0]?.at, 0);
  assert.equal(entries[0]?.seen.kind, "system", "the grey system MESSAGE, not the prompt row");
});

test("a system message inside the conversation is never read as the prompt", () => {
  // Claude Code sends these: its SessionStart hook output, its `# Environment`
  // block, and reminders further down. Measured on one real turn of 36
  // messages — four of them, at indexes 1, 8, 15 and 26. They are messages.
  const entries = wireEntries(
    recorded({ model: "m", messages: [] }, [
      { role: "user", content: [{ type: "text", text: "is this true?" }] },
      { role: "system", content: "SessionStart:startup hook success: Worktree guard" },
    ]),
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.seen.kind, "user");
  assert.equal(entries[1]?.seen.kind, "system");
  assert.equal(entries[1]?.at, 1, "it keeps its own place in the conversation");
});

test("an empty `system` adds no row, so the list never lies about one", () => {
  for (const empty of [[], "", undefined]) {
    const entries = wireEntries(recorded({ model: "m", system: empty, messages: [] }, []));
    assert.equal(entries.length, 0, `an empty ${JSON.stringify(empty)} is not a prompt`);
  }
});

test("a body recorded with capture off draws nothing at all", () => {
  assert.deepEqual(wireEntries(undefined), []);
  assert.deepEqual(wireEntries(null), []);
});

test("a raw request body answers from its own top level", () => {
  // Nothing records this shape today. It costs one fallback and it is what a
  // body captured anywhere but inside LiteLLM's kwargs would look like.
  const entries = wireEntries({ system: "You answer questions.", messages: [] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.seen.kind, "prompt");
});

test("depth 3 and depth 4 agree on what row 1 is", () => {
  // The index depth 3 hands over is a place in THIS list. The two screens build
  // it from one function so that they cannot disagree, and this is the check
  // that the prompt row shifted both of them and not just one.
  const entries = wireEntries(
    recorded({ system: "the prompt", messages: [] }, [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.at),
    [null, 0, 1],
  );
});
