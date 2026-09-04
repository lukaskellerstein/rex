// Spec 42 §4 — the pipe client, driven against a fake child.
//
// What is being protected here is the half of the seam that has no types to
// lean on: a process. The Python loop is tested on its own side of the pipe
// (`agent-gateway/tests/test_service.py`); this is the side that has to survive
// a child that crashes, a child that says something unreadable, and a quit that
// arrives while a run is still open.
//
// The fake is `test/fixtures/fake-gateway.mjs` and it speaks the real protocol,
// so nothing here needs Python, an SDK or a key.
//
// Run: npm run test:service

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { AgentService, defaultSpawn, interpreterFor } from "../src/main/agent/service.ts";
import type { AgentEvent, RunMessage } from "../src/shared/agent-protocol.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-gateway.mjs");

const services: AgentService[] = [];

function service(): AgentService {
  const made = new AgentService({ command: process.execPath, args: [FAKE], cwd: HERE });
  services.push(made);
  return made;
}

// A live child keeps `node --test` from ever exiting, so every one of them is
// ended here whether its test passed or not.
after(async () => {
  for (const one of services) await one.quit();
});

function runMessage(runId: string, prompt: string): RunMessage {
  return {
    type: "run",
    runId,
    route: {
      sdk: "claude-agent",
      gatewayName: "Original",
      baseUrl: null,
      auth: "inherit",
      token: null,
    },
    cwd: ".",
    prompt,
    session: { mode: "seed", id: "s1" },
    model: null,
    style: null,
    systemPrompt: "",
    disallowed: [],
    plugins: [],
    maxTurns: null,
  };
}

const allow = () => null;

test("the child answers `ready`, and that is the whole health check", async () => {
  const one = service();
  await one.ready();

  const state = one.state();
  assert.equal(state.version, "1");
  assert.equal(state.library, "0.1.0");
  assert.deepEqual(state.sdks, { "claude-agent-sdk": "0.2.152" });
  assert.ok(state.pid !== null, "a running child has a pid");
  assert.equal(state.down, null);
});

test("a run streams its events and resolves on its result", async () => {
  const one = service();
  const seen: AgentEvent[] = [];
  const wrote: string[] = [];

  const result = await one.run(runMessage("r1", "hello"), {
    onEvent: (event) => {
      seen.push(event);
      if (event.type === "wrote") wrote.push(event.path);
    },
    onPolicy: allow,
  });

  assert.deepEqual(
    seen.map((event) => event.type),
    ["started", "text", "wrote", "completed"],
  );
  assert.deepEqual(wrote, ["/tmp/written.md"]);
  assert.equal(result.costUsd, 0.25);
  assert.equal(result.stopped, false);
  assert.equal(one.state().openRuns, 0, "a finished run is forgotten");
});

test("two runs on one pipe never exchange events", async () => {
  // §13 criterion 13. The fake replies to both immediately, so if the client
  // routed by anything but `run_id` the two lists would be mixed.
  const one = service();
  const a: string[] = [];
  const b: string[] = [];

  const [first, second] = await Promise.all([
    one.run(runMessage("a", "hello"), { onEvent: (e) => a.push(e.type), onPolicy: allow }),
    one.run(runMessage("b", "hello"), { onEvent: (e) => b.push(e.type), onPolicy: allow }),
  ]);

  assert.deepEqual(a, ["started", "text", "wrote", "completed"]);
  assert.deepEqual(b, ["started", "text", "wrote", "completed"]);
  assert.equal(first.sessionId, "s1");
  assert.equal(second.sessionId, "s1");
});

test("a policy is answered by the run that owns it", async () => {
  const one = service();
  const asked: string[] = [];

  const result = await one.run(runMessage("r1", "policy"), {
    onEvent: () => {},
    onPolicy: (call) => {
      asked.push(call.name);
      return "no writing in a read session";
    },
  });

  assert.deepEqual(asked, ["Bash"]);
  assert.deepEqual(result.denials, [
    { toolName: "Bash", reason: "no writing in a read session", subagentId: null },
  ]);
});

test("a policy answered with null allows the call", async () => {
  const one = service();
  const texts: string[] = [];

  const result = await one.run(runMessage("r1", "policy"), {
    onEvent: (event) => {
      if (event.type === "text") texts.push(event.text);
    },
    onPolicy: allow,
  });

  assert.deepEqual(texts, ["allowed"]);
  assert.deepEqual(result.denials, []);
});

test("a stop ends the run it names", async () => {
  const one = service();
  const seen: string[] = [];

  const running = one.run(runMessage("r1", "forever"), {
    onEvent: (event) => seen.push(event.type),
    onPolicy: allow,
  });
  // The run has started before it is stopped — otherwise this would be testing
  // the pre-spawn shortcut instead of the stop.
  while (!seen.includes("started")) await new Promise((wake) => setTimeout(wake, 5));

  one.stop("r1");
  const result = await running;

  assert.equal(result.stopped, true);
  assert.equal(result.error, null, "a stop is never a failure");
  assert.deepEqual(seen, ["started", "stopped"]);
});

test("a child that exits mid-run ends the run and comes back", async () => {
  // §4.1 step 5. The promise MUST settle: a caller left awaiting forever is
  // worse than a caller told the truth.
  const one = service();
  await one.ready();

  const seen: string[] = [];
  const result = await one.run(runMessage("r1", "crash"), {
    onEvent: (event) => seen.push(event.type),
    onPolicy: allow,
  });

  assert.deepEqual(seen, ["error"], "one error event, and only one");
  assert.match(result.error ?? "", /agent service exited/i);
  assert.equal(result.stopped, false, "a crash is not a stop");

  // And the service restarted itself, so the next run works.
  await one.ready();
  assert.equal(one.state().restarts, 1);
  const after = await one.run(runMessage("r2", "hello"), { onEvent: () => {}, onPolicy: allow });
  assert.equal(after.error, null);
});

test("a line that is not JSON is ignored rather than fatal", async () => {
  const one = service();
  const result = await one.run(runMessage("r1", "garbage"), {
    onEvent: () => {},
    onPolicy: allow,
  });
  assert.equal(result.error, null, "the run finished despite the bad line");
});

test("a question is answered by its own id", async () => {
  const one = service();
  const value = await one.ask((id) => ({
    type: "session_exists",
    id,
    route: runMessage("x", "y").route,
    cwd: ".",
    sessionId: "known",
  }));
  assert.equal(value?.kind, "exists");
  assert.equal(value?.kind === "exists" && value.session.exists, true);
});

test("a refused question rejects rather than resolving to nothing", async () => {
  const one = service();
  await assert.rejects(
    one.ask((id) => ({
      type: "capabilities",
      id,
      route: runMessage("x", "y").route,
      cwd: ".",
    })),
    /no probe here/,
  );
});

test("quit ends the child", async () => {
  const one = service();
  await one.ready();
  await one.quit();
  assert.equal(one.state().pid, null);
});

test("a missing interpreter is refused with the command that fixes it", async () => {
  // §4.1 step 1 — said once, plainly, rather than as a spawn failure nobody can
  // act on. This is what a fresh checkout meets before `uv sync`.
  const missing = new AgentService({
    command: join(HERE, "fixtures", "no-such-python"),
    args: [],
    cwd: "/tmp/agent-gateway",
  });
  await assert.rejects(missing.ready(), /uv sync/);
  assert.match(missing.state().down ?? "", /uv sync/);
});

test("the interpreter is the venv's own, never one from PATH", () => {
  // A Mac app started from the Dock has a stunted PATH, so `python` on it is
  // either absent or the wrong one.
  const root = defaultSpawn().cwd;
  assert.match(interpreterFor(root), /\.venv\/bin\/python$|\/python\/bin\/python$/);
  assert.deepEqual(defaultSpawn().args, ["-m", "agent_gateway"]);
});
