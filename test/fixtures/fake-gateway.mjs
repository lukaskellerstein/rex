// A stand-in for `python -m agent_runner`, in a few lines of Node.
//
// Spec 42 §12 — `test/service.spec.ts` drives the real `AgentService` against
// this, so the client's own behaviour (line framing, the ready wait, run
// routing, the policy round trip, restart, shutdown) is tested with no Python,
// no SDK and no key. The Python loop has its own test on the other side of the
// pipe, in `agent-runner/tests/test_service.py`.
//
// What a run does is chosen by its prompt, which is the cheapest possible way
// to script a stream.

const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const event = (runId, body) => say({ type: "event", runId, event: body });

/** run id → the reply that ends it, once a `stop` arrives. */
const waiting = new Map();
/** policy request id → the run it belongs to. */
const asked = new Map();

say({
  type: "ready",
  version: "1",
  python: "3.12.0 (fake)",
  library: "0.1.0",
  sdks: { "claude-agent-sdk": "0.2.152" },
});

function finish(runId, result) {
  say({
    type: "result",
    runId,
    result: {
      sessionId: "s1",
      costUsd: null,
      durationMs: 1,
      denials: [],
      error: null,
      stopped: false,
      ...result,
    },
  });
}

function run(message) {
  const { runId, prompt } = message;

  if (prompt === "crash") {
    process.exit(9);
  }

  event(runId, {
    type: "started",
    sessionId: "s1",
    model: "fake",
    style: null,
    tools: 2,
    plugins: ["lsp-bash"],
  });

  if (prompt === "forever") {
    waiting.set(runId, true);
    return;
  }

  if (prompt === "policy") {
    asked.set(`p-${runId}`, runId);
    say({
      type: "policy",
      id: `p-${runId}`,
      runId,
      call: { name: "Bash", common: "shell", input: { command: "ls > out.txt" }, subagentId: null },
    });
    return;
  }

  if (prompt === "garbage") {
    // A line on fd 1 that is not JSON. The client must log it and carry on.
    process.stdout.write("this is not json\n");
  }

  event(runId, { type: "text", text: "hello" });
  event(runId, { type: "wrote", path: "/tmp/written.md" });
  event(runId, {
    type: "completed",
    costUsd: 0.25,
    durationMs: 42,
    inputTokens: 7,
    outputTokens: 9,
  });
  finish(runId, { costUsd: 0.25, durationMs: 42 });
}

function handle(message) {
  switch (message.type) {
    case "describe":
      say({
        type: "reply",
        id: message.id,
        ok: true,
        value: { kind: "describe", describe: { sdks: [], kinds: [] } },
        error: null,
      });
      break;

    case "session_exists":
      say({
        type: "reply",
        id: message.id,
        ok: true,
        value: {
          kind: "exists",
          session: {
            exists: message.sessionId === "known",
            summary: null,
            lastModified: null,
            path: "/tmp/known.jsonl",
            size: null,
          },
        },
        error: null,
      });
      break;

    case "capabilities":
      say({ type: "reply", id: message.id, ok: false, value: null, error: "no probe here" });
      break;

    case "run":
      run(message);
      break;

    case "stop":
      if (waiting.delete(message.runId)) {
        event(message.runId, { type: "stopped", costUsd: null, durationMs: null });
        finish(message.runId, { stopped: true });
      }
      break;

    case "policy_reply": {
      const runId = asked.get(message.id);
      asked.delete(message.id);
      if (runId === undefined) break;
      const denials =
        message.reason === null
          ? []
          : [{ toolName: "Bash", reason: message.reason, subagentId: null }];
      event(runId, { type: "text", text: message.reason === null ? "allowed" : "refused" });
      finish(runId, { denials });
      break;
    }

    case "shutdown":
      process.exit(0);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let cut = buffer.indexOf("\n");
  while (cut >= 0) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (line) handle(JSON.parse(line));
    cut = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
