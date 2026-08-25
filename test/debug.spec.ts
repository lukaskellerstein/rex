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
import { chooseCdpPort, DEFAULT_CDP_PORT } from "../src/main/cdp.ts";
import { type AppFacts, appReport, denialsOf } from "../src/main/debug.ts";
import { entries, record, resetLog } from "../src/main/log.ts";
import type { Message, MessageKind, MessageRole, ViewState } from "../src/shared/types.ts";

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

// ── Spec 13 — the port, the ring and the app report ───────────
//
// `chooseCdpPort` is a pure function for this test's sake. The rule that
// matters is the first one: an explicit `--remote-debugging-port` on the
// command line must win, because that is how `rules/06-testing.md` launches REX
// and a second appended switch would change a workflow spec 13 leaves alone.

test("with nothing said, REX opens the port .mcp.json already points at", () => {
  const choice = chooseCdpPort(["electron", "."], {});
  assert.deepEqual(choice, { port: DEFAULT_CDP_PORT, source: "default", warning: null });
});

test("an explicit switch wins, in either spelling, and REX appends nothing", () => {
  assert.deepEqual(chooseCdpPort(["electron", "--remote-debugging-port=9444"], {}), {
    port: 9444,
    source: "argv",
    warning: null,
  });
  assert.deepEqual(chooseCdpPort(["electron", "--remote-debugging-port", "9555"], {}), {
    port: 9555,
    source: "argv",
    warning: null,
  });
});

test("the environment moves the port, and the command line still beats it", () => {
  assert.equal(chooseCdpPort(["electron"], { REX_CDP_PORT: "9444" }).port, 9444);
  assert.equal(
    chooseCdpPort(["electron", "--remote-debugging-port=9334"], { REX_CDP_PORT: "9444" }).source,
    "argv",
  );
});

test("every spelling of off closes it, and none of them looks like a port", () => {
  for (const value of ["off", "none", "NO", "false", "0", ""]) {
    const choice = chooseCdpPort(["electron"], { REX_CDP_PORT: value });
    assert.equal(choice.port, null, value);
    assert.equal(choice.source, "off", value);
  }
});

test("a typo in REX_CDP_PORT is said out loud, not silently ignored", () => {
  // Falling back is right — REX must still start. Doing it in silence is not:
  // the reviewer would then be told the port is 9334 by a report they asked for
  // precisely because they no longer trust what REX says about itself.
  const choice = chooseCdpPort(["electron"], { REX_CDP_PORT: "yes please" });
  assert.equal(choice.port, DEFAULT_CDP_PORT);
  assert.match(choice.warning ?? "", /not a port number/);
});

test("the ring keeps the newest lines and drops the oldest", () => {
  resetLog();
  for (let index = 0; index < 350; index++) record("info", "test", `line ${index}`);

  const kept = entries();
  assert.equal(kept.length, 300);
  assert.equal(kept[0].message, "line 50");
  assert.equal(kept.at(-1)?.message, "line 349");
  assert.deepEqual(
    entries(3).map((entry) => entry.message),
    ["line 347", "line 348", "line 349"],
  );
});

const FACTS: AppFacts = {
  appVersion: "0.1.0",
  pid: 16273,
  packaged: false,
  uptimeMs: 744_000,
  userDataPath: "/tmp/userdata",
  cdp: {
    port: 9334,
    source: "default",
    listening: true,
    browser: "Chrome/140.0.0.0",
    detail: null,
  },
  logPath: "/tmp/rex.log",
  logLines: 41,
};

const VIEW: ViewState = {
  window: { width: 1500, height: 918 },
  workspaceRoot: "/w",
  document: {
    documentId: "d1",
    value: "/w/components.md",
    kind: "file",
    title: "Components",
    presentation: "html",
    documentBytes: 86_235,
    contentChanged: false,
    surfaceReady: false,
    frameChildren: 0,
    frameWidth: 807,
    frameHeight: 873,
  },
  centre: "document",
  sidebarTab: "comments",
  zoom: 1,
  threads: 14,
  unanswered: 3,
  activeThreadId: null,
  traceOpen: false,
  selectionItems: 0,
  notice: null,
};

test("the report leads with how to attach, and prints what the port did", () => {
  resetLog();
  const report = appReport(FACTS, VIEW, entries());

  // ATTACH before everything, because it is the part a fresh Claude Code
  // session acts on; the rest is evidence it reads afterwards.
  assert.ok(report.indexOf("ATTACH") < report.indexOf("APP"));
  assert.match(report, /cdp {8}http:\/\/localhost:9334 · listening · Chrome\/140/);
  assert.match(report, /curl -s http:\/\/localhost:9334\/json\/version/);
  assert.match(report, /playwright-rex/);
});

test("a port that did not open is never reported as one that did", () => {
  const report = appReport(
    {
      ...FACTS,
      cdp: {
        port: 9334,
        source: "default",
        listening: false,
        browser: null,
        detail: "no answer (fetch failed)",
      },
    },
    VIEW,
    [],
  );

  assert.match(report, /NOT LISTENING/);
  assert.doesNotMatch(report, /· listening ·/);
});

test("a rendered document with no surface is stated, which is the bug it is for", () => {
  const report = appReport(FACTS, VIEW, []);
  assert.match(report, /84\.2 KB · surface NOT ready · frame 0 nodes · pane 807×873/);
  assert.match(report, /comments {3}14 · 3 unanswered/);
  assert.match(report, /window {5}1500×918/);
  // Nothing is wrong with an 807px pane, so nothing is said about it.
  assert.doesNotMatch(report, /too narrow/);
});

test("a document squeezed to a strip is called out, not left to be inferred", () => {
  // The measured failure: 857px window, 164px pane, document fully loaded. Two
  // numbers a reader could compare are not enough — they are reading this
  // because they believe no document is open, and every other line agrees with
  // them.
  const report = appReport(
    FACTS,
    {
      ...VIEW,
      window: { width: 857, height: 1365 },
      document: { ...VIEW.document!, surfaceReady: true, frameChildren: 102, frameWidth: 164 },
    },
    [],
  );

  assert.match(report, /pane 164×873/);
  assert.match(report, /only 164px wide/);
  assert.match(report, /The document IS loaded/);
  assert.match(report, /too narrow to show it/);
});

test("an empty RECENT says nothing was recorded, not that nothing went wrong", () => {
  const report = appReport(FACTS, VIEW, []);
  assert.match(report, /RECENT \(0\)\n {2}nothing was recorded this run/);
});

test("the report survives a renderer that never answered", () => {
  // The failure this whole spec is for can be the renderer itself. A report
  // that threw here would be missing in exactly the case it is needed.
  resetLog();
  record("error", "crash", "renderer gone: crashed (exit 133)");
  const report = appReport(FACTS, null, entries());

  assert.match(report, /the renderer did not answer/);
  assert.match(report, /crash {4}renderer gone: crashed/);
});
