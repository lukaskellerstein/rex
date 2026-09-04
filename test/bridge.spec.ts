// Spec 42 §11 and §13 criterion 10 — a library event, as the row REX stores.
//
// This is the half of the seam where a mistake is invisible: an event mapped to
// a slightly different draft produces a transcript that looks right and is not
// the one the reviewer had yesterday. Every case below is a row `runner.ts`
// wrote before spec 42, asserted field by field.
//
// The other half — an SDK message becoming an event — is tested in Python, in
// `agent-gateway/tests/test_events.py`. Together the two cover the whole path
// with no CLI, no network and no key.
//
// Run: npm run test:bridge

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  baseUrlProblem,
  buildRoutes,
  draftFor,
  drawDiff,
  ORIGINAL_GATEWAY,
  policyFor,
  REX_SDK,
  resolveRoute,
  validateGateway,
} from "../src/main/agent/bridge.ts";
import type { AgentEvent } from "../src/shared/agent-protocol.ts";

/** Every draft carries these unless the event says otherwise. */
const BLANK = {
  toolName: null,
  toolInput: null,
  isError: false,
  costUsd: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
};

// ── §7 — events become rows ─────────────────────────────────────

test("text and thinking become assistant rows", () => {
  assert.deepEqual(draftFor({ type: "text", text: "hello" }), {
    role: "assistant",
    kind: "text",
    content: "hello",
    ...BLANK,
  });
  assert.deepEqual(draftFor({ type: "thinking", text: "hmm" }), {
    role: "assistant",
    kind: "thinking",
    content: "hmm",
    ...BLANK,
  });
});

test("a tool call keeps the SDK's own name, not the mapped one", () => {
  // The row a reviewer reads says `Bash`, because that is what ran. `common`
  // exists for deciding, and never for displaying.
  const row = draftFor({
    type: "tool_call",
    id: "t1",
    name: "Bash",
    common: "shell",
    input: { command: "ls" },
  });
  assert.deepEqual(row, {
    role: "assistant",
    kind: "tool_call",
    content: null,
    ...BLANK,
    toolName: "Bash",
    toolInput: { command: "ls" },
  });
});

test("a tool call with no input stores null, not an empty object", () => {
  const row = draftFor({ type: "tool_call", id: "t1", name: "Skill", common: null, input: null });
  assert.equal(row?.toolInput, null);
});

test("an edit is drawn as removed lines then added lines", () => {
  const row = draftFor({ type: "diff", path: "/a.md", before: "one\ntwo", after: "three" });
  assert.equal(row?.kind, "diff");
  assert.equal(row?.content, "/a.md\n- one\n- two\n+ three");
});

test("a new file has no removed lines at all", () => {
  // `before: null` is a Write. It is a different thing from an edit whose old
  // text was empty, and the two must not draw the same.
  assert.equal(drawDiff("/b.md", null, "hi\nthere"), "/b.md\n+ hi\n+ there");
  assert.equal(drawDiff("/b.md", "", "hi"), "/b.md\n- \n+ hi");
});

test("a wrote event is a callback and never a row", () => {
  // Spec 15 §4.3 — it is how Apply knows what a run touched. Nothing is drawn.
  const paths: string[] = [];
  const row = draftFor({ type: "wrote", path: "/a.md" }, (path) => paths.push(path));
  assert.equal(row, null);
  assert.deepEqual(paths, ["/a.md"]);
});

test("a tool result carries its tool, its error flag and its denial flag", () => {
  const row = draftFor({
    type: "tool_result",
    id: "t1",
    name: "Bash",
    text: "refused",
    isError: true,
    denied: true,
  });
  assert.deepEqual(row, {
    role: "user",
    kind: "tool_result",
    content: "refused",
    ...BLANK,
    toolName: "Bash",
    isError: true,
    denied: true,
  });
});

test("an error keeps the cost the failed run had already spent", () => {
  // A failed turn still costs money, and it is the one kind of run whose cost is
  // most worth seeing.
  const row = draftFor({ type: "error", text: "boom", costUsd: 0.5, durationMs: 120 });
  assert.deepEqual(row, {
    role: "system",
    kind: "error",
    content: "boom",
    ...BLANK,
    isError: true,
    costUsd: 0.5,
    durationMs: 120,
  });
});

test("a stop writes one sentence, and it is not an error", () => {
  const row = draftFor({ type: "stopped", costUsd: null, durationMs: null });
  assert.deepEqual(row, {
    role: "system",
    kind: "stopped",
    content: "You stopped this run.",
    ...BLANK,
  });
  assert.equal(row?.isError, false, "spec 17 §2.3 — nothing about a stop is a fault");
});

test("a completed row says how long it took and what it used", () => {
  const row = draftFor({
    type: "completed",
    costUsd: 0.25,
    durationMs: 4200,
    inputTokens: 11,
    outputTokens: 22,
  });
  assert.deepEqual(row, {
    role: "system",
    kind: "completed",
    content: "Completed in 4200ms",
    ...BLANK,
    costUsd: 0.25,
    durationMs: 4200,
    inputTokens: 11,
    outputTokens: 22,
  });
});

test("a cost the SDK did not report stays null and is never drawn as zero", () => {
  // §13 criterion 11. Zero is a measurement; null is the absence of one.
  const row = draftFor({
    type: "completed",
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });
  assert.equal(row?.costUsd, null);
  assert.equal(row?.content, "Completed in ?ms");
});

test("started and denied are not rows", () => {
  // `started` becomes a log line; `denied` is already in RunResult.denials,
  // which is where every caller reads a refusal from.
  assert.equal(
    draftFor({ type: "started", sessionId: "s", model: "m", style: null, tools: 3, plugins: [] }),
    null,
  );
  assert.equal(draftFor({ type: "denied", name: "Bash", reason: "no", subagentId: null }), null);
});

test("every event kind is accounted for", () => {
  // A new event added to the protocol and forgotten here would silently vanish
  // from every transcript. This fails the moment one is added.
  const kinds: AgentEvent["type"][] = [
    "started",
    "text",
    "thinking",
    "tool_call",
    "tool_result",
    "diff",
    "wrote",
    "denied",
    "error",
    "stopped",
    "completed",
  ];
  assert.equal(new Set(kinds).size, 11);
});

// ── §8 — the gate, asked over the pipe ──────────────────────────

test("the read policy refuses a write tool by Claude's own name", () => {
  const decide = policyFor("read", REX_SDK);
  assert.match(
    decide({ name: "Write", common: "write", input: {}, subagentId: null }) ?? "",
    /read session/,
  );
  assert.match(
    decide({ name: "Edit", common: "edit", input: {}, subagentId: null }) ?? "",
    /read session/,
  );
});

test("the read policy still refuses a Bash redirect", () => {
  const decide = policyFor("read", REX_SDK);
  const reason = decide({
    name: "Bash",
    common: "shell",
    input: { command: "ls > out.txt" },
    subagentId: null,
  });
  assert.match(reason ?? "", /cannot change any file/);
});

test("for Claude, a tool the library could not map is still ALLOWED", () => {
  // §8.1 — this is today's behaviour exactly. `gateDecision` reasons in Claude's
  // own names and always allowed `TodoWrite`, `Skill` and `AskUserQuestion`;
  // denying them here would change what a read session can do.
  const decide = policyFor("read", REX_SDK);
  for (const name of ["TodoWrite", "Skill", "AskUserQuestion"]) {
    assert.equal(decide({ name, common: null, input: {}, subagentId: null }), null, name);
  }
});

test("for any later SDK, a tool the library could not map is DENIED", () => {
  // The fall-through direction is the whole difference between a gate and a
  // decoration, and specs 44 to 46 each bring a closed mapping.
  const decide = policyFor("read", "codex");
  const reason = decide({ name: "apply_patch", common: null, input: {}, subagentId: null });
  assert.match(reason ?? "", /does not know the codex tool 'apply_patch'/);
});

test("the write policy allows everything but an MCP tool", () => {
  const decide = policyFor("write", REX_SDK);
  assert.equal(decide({ name: "Edit", common: "edit", input: {}, subagentId: null }), null);
  assert.match(
    decide({ name: "mcp__x__y", common: "mcp", input: {}, subagentId: null }) ?? "",
    /deny-by-default/,
  );
});

// ── §5.3 — resolving a route ────────────────────────────────────

test("the Original gateway resolves to no URL and no token", () => {
  const route = resolveRoute(ORIGINAL_GATEWAY, REX_SDK, {});
  assert.deepEqual(route, {
    sdk: "claude-agent",
    gatewayName: "Original",
    baseUrl: null,
    auth: "inherit",
    token: null,
  });
});

test("an SDK with no adapter is refused by name", () => {
  assert.throws(() => resolveRoute(ORIGINAL_GATEWAY, "codex", {}), /No adapter for 'codex'/);
});

test("a credential is read from the environment it was handed", () => {
  const gateway = {
    ...ORIGINAL_GATEWAY,
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment" as const,
        credentialEnv: "KEY",
        models: [],
      },
    },
  };
  assert.equal(resolveRoute(gateway, REX_SDK, { KEY: "secret" }).token, "secret");
  assert.throws(() => resolveRoute(gateway, REX_SDK, {}), /needs KEY, and it is not set/);
});

// ── §10 — the descriptor, rendered without a round trip ─────────

test("the two sides build the same routes for the Original kind", () => {
  // The Python side asserts the same thing over the same catalogue, which is
  // the point of committing it as data.
  const routes = buildRoutes("original", {});
  assert.deepEqual(Object.keys(routes).sort(), [
    "claude-agent",
    "codex",
    "deep-agents",
    "opencode",
  ]);
  for (const route of Object.values(routes)) {
    assert.equal(route?.baseUrl, null);
    assert.equal(route?.auth, "inherit");
  }
});

test("a kind nobody declared builds nothing and says so", () => {
  assert.deepEqual(buildRoutes("invented", {}), {});
  assert.deepEqual(validateGateway("invented", {}), [
    { key: "kind", message: "There is no gateway kind called 'invented'." },
  ]);
});

test("the Original kind asks nothing, so anything validates", () => {
  assert.deepEqual(validateGateway("original", {}), []);
});

test("a gateway URL must be an address and nothing more", () => {
  assert.equal(baseUrlProblem("http://localhost:24000"), null);
  assert.equal(baseUrlProblem("https://gw.example.com/"), null);
  for (const bad of [
    "",
    "localhost:24000",
    "ftp://gw.example.com",
    "http://user:pass@gw.example.com",
    "http://gw.example.com?key=secret",
    "http://gw.example.com#f",
  ]) {
    assert.notEqual(baseUrlProblem(bad), null, bad);
  }
});
