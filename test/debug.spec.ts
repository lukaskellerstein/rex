// Spec 08 §6.2 — the steps that went wrong in the debug report, paired with
// their commands.
//
// This is the one piece of the report that is not a lookup. Everything else is
// an id, a path or a sum; a bad step has to be matched back to the call it
// belongs to, and §4's `Message` carries no `tool_use_id` to match on. So the
// pairing is rebuilt from order, and what it rebuilds is the single line
// somebody debugging will read first — the command.
//
// Getting it wrong is quiet: a mispaired command is a plausible command, and it
// sends the reader after the wrong call in a session file of hundreds. Calling a
// failure a refusal is quiet the same way, and is what the `denied` flag is for.
//
// Run: npm run test:debug

import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { chooseCdpPort, DEFAULT_CDP_PORT, probeCdp } from "../src/main/cdp.ts";
import { appendMessage, createThread, upsertDocument } from "../src/main/db/queries.ts";
import { type AppFacts, appReport, badStepsOf, debugReport } from "../src/main/debug.ts";
import { entries, record, resetLog } from "../src/main/log.ts";
import type { Anchor, Message, MessageKind, MessageRole, ViewState } from "../src/shared/types.ts";

let seq = 0;

function message(kind: MessageKind, role: MessageRole, fields: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    threadId: "t",
    seq: seq++,
    role,
    kind,
    mode: null,
    model: null,
    style: null,
    // Spec 43 §5.3 — the evidence a run leaves. Null here is what a fixture
    // that was never produced by one honestly is.
    sdk: null,
    gatewayName: null,
    baseUrl: null,
    content: null,
    toolName: null,
    toolInput: null,
    isError: false,
    denied: false,
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

const result = (toolName: string, content: string): Message =>
  message("tool_result", "user", { toolName, content });

/** The gate refused it: an error, and denied. Both flags, as the runner writes them. */
const refused = (toolName: string, content: string): Message =>
  message("tool_result", "user", { toolName, content, isError: true, denied: true });

/** It ran and did not succeed. An error, and nobody refused anything. */
const failed = (toolName: string, content: string): Message =>
  message("tool_result", "user", { toolName, content, isError: true });

test("a refusal carries the whole command, not the clipped one in its reason", () => {
  const command = `ls -la ${"/some/very/long/path".repeat(4)} 2>&1`;
  const steps = badStepsOf([
    message("text", "user", { content: "do you see these?" }),
    call("Bash", { command }),
    refused("Bash", "Bash in a read session may not redirect, background or substitute — '…'"),
  ]);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].toolName, "Bash");
  assert.equal(steps[0].command, command);
  assert.equal(steps[0].denied, true);
  assert.match(steps[0].reason, /may not redirect/);
});

test("a command that exited non-zero is a failure, and is never called a refusal", () => {
  // The bug this whole split exists for. Measured on 2026-09-01, thread
  // `f5e79775`: two zsh errors in a read session where the gate never fired,
  // both printed under DENIED. `zsh` expands `===` to a lookup for a command
  // named `==`, and `--include=*.md` with no `.md` beside it aborts the line —
  // neither has anything to do with REX.
  const steps = badStepsOf([
    call("Bash", { command: "echo ===" }),
    failed("Bash", "Exit code 1\n(eval):1: == not found"),
  ]);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].denied, false);
  assert.equal(steps[0].command, "echo ===");
  // On one line: the report gives a step one line, and a raw newline here put
  // the second half of the output where the command belongs.
  assert.equal(steps[0].reason, "Exit code 1 (eval):1: == not found");
});

test("an allowed call is not a bad step, and does not consume the next one's result", () => {
  const steps = badStepsOf([
    call("Read", { file_path: "/docs/one.md" }),
    result("Read", "1\t# Tilecat"),
    call("Bash", { command: "rm -rf /tmp/x" }),
    refused("Bash", "'rm' is not on the allowlist"),
  ]);

  assert.deepEqual(
    steps.map((step) => step.command),
    ["rm -rf /tmp/x"],
  );
});

test("two calls in flight at once are paired by tool, not by recency", () => {
  // The SDK emits both calls before either result when the model asks for them
  // in one turn. Pairing on "the most recent call still unanswered" hands the
  // Bash result the Grep call, and the report then names a search as the thing
  // the gate refused.
  const steps = badStepsOf([
    call("Bash", { command: "cat a.md > b.md" }),
    call("Grep", { pattern: "retry|backoff" }),
    result("Grep", "3 matches"),
    refused("Bash", "Bash in a read session may not redirect"),
  ]);

  assert.deepEqual(
    steps.map((step) => step.command),
    ["cat a.md > b.md"],
  );
});

test("a refusal and a failure in one run keep their own commands and their own names", () => {
  const steps = badStepsOf([
    call("Bash", { command: "tee out.txt" }),
    refused("Bash", "'tee' is not on the allowlist"),
    call("Bash", { command: "ls docs/review" }),
    failed("Bash", "Exit code 1\nls: docs/review: No such file or directory"),
  ]);

  assert.deepEqual(
    steps.map((step) => [step.command, step.denied]),
    [
      ["tee out.txt", true],
      ["ls docs/review", false],
    ],
  );
});

test("a tool with no command argument reports whatever it was given", () => {
  const steps = badStepsOf([
    call("mcp__playwright__browser_click", { element: "Save", ref: "e12" }),
    refused("mcp__playwright__browser_click", "MCP tools are deny-by-default"),
  ]);

  assert.equal(steps[0].command, '{"element":"Save","ref":"e12"}');
});

test("a result whose call is missing is reported rather than dropped", () => {
  // A transcript can be truncated — `tool_result` content is clipped to 4000
  // chars on the way in, and a thread deleted mid-run keeps whatever arrived.
  // The refusal is still the interesting half, so it survives without a call.
  const steps = badStepsOf([refused("Bash", "'curl' is not on the allowlist")]);

  assert.equal(steps.length, 1);
  assert.match(steps[0].command, /not in the transcript/);
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

// ── Spec 13 §7 — "does not claim a port it did not get" ───────
//
// The criterion was written in the spec and not met by the code. `probeCdp`
// fetched `/json/version` and believed the answer, and when a second REX is the
// thing that failed to bind, the FIRST one answers that fetch. Measured on
// 2026-09-03: pid 91081 printed `bind() failed: Address already in use` on
// Chromium's stderr at 13:18:37.195 and `cdp … listening · Chrome/150` into
// `~/.rex/rex.log` 114ms earlier — the version of a REX from two days before.
//
// So the socket's owner decides, and the endpoint only ever supplies a version
// string. `9334` is the port throughout; only the pids matter.

const CHOICE = { port: 9334, source: "default" as const, warning: null };
const NEVER_ASKED = async () => {
  throw new Error("the endpoint was asked about a port this process does not hold");
};

test("a port another process holds is never reported as this REX's own", async () => {
  const status = await probeCdp(CHOICE, {
    ownPid: 91081,
    listeners: async () => [55547],
    version: NEVER_ASKED,
  });

  assert.equal(status.listening, false);
  assert.equal(status.owner, 55547);
  assert.equal(status.browser, null);
  assert.match(status.detail ?? "", /pid 55547 holds it/);
});

test("the port is this REX's own only when this process holds the socket", async () => {
  const status = await probeCdp(CHOICE, {
    ownPid: 91081,
    listeners: async () => [91081],
    version: async () => ({ browser: "Chrome/150.0.7871.224", detail: null }),
  });

  assert.equal(status.listening, true);
  assert.equal(status.owner, null);
  assert.equal(status.browser, "Chrome/150.0.7871.224");
});

test("a port nothing bound at all says so, and does not blame another process", async () => {
  const status = await probeCdp(CHOICE, {
    ownPid: 91081,
    listeners: async () => [],
    version: NEVER_ASKED,
  });

  assert.equal(status.listening, false);
  assert.equal(status.owner, null);
  assert.match(status.detail ?? "", /nothing is listening/);
});

test("when the owner cannot be looked up, the endpoint is still the last word", async () => {
  // `lsof` missing must not turn a working debugger into a reported failure.
  // `null` is "could not ask", which is not the same as "nobody holds it".
  const status = await probeCdp(CHOICE, {
    ownPid: 91081,
    listeners: async () => null,
    version: async () => ({ browser: "Chrome/150.0.7871.224", detail: null }),
  });

  assert.equal(status.listening, true);
  assert.equal(status.browser, "Chrome/150.0.7871.224");
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
    owner: null,
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
  groups: 2,
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
        owner: null,
      },
    },
    VIEW,
    [],
  );

  assert.match(report, /NOT LISTENING/);
  assert.doesNotMatch(report, /· listening ·/);
});

test("the report names the pid holding the port, and the command that frees it", () => {
  const report = appReport(
    {
      ...FACTS,
      cdp: {
        port: 9334,
        source: "default",
        listening: false,
        browser: null,
        detail: "pid 55547 holds it",
        owner: 55547,
      },
    },
    VIEW,
    [],
  );

  // A pid alone leaves the reader to work out what to do with it, and the thing
  // to do is one command. Both, or the block has not finished its job.
  assert.match(report, /NOT LISTENING — pid 55547 holds it/);
  assert.match(report, /kill -INT 55547/);
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

// ── Spec 08 §6.2 — READ, the block that makes the paste actionable ──
//
// The report has always named the thread and the database. Naming them is not
// the same as being able to read the conversation, and the gap showed up the
// first time a report was pasted into a fresh session: it held the id, and had
// to be told which table to look in.
//
// So these tests do not check that a command was PRINTED. They run it. A SQL
// string nobody executed is exactly the kind of instruction that reads fine and
// fails on the machine it was pasted into.

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

const QUOTE: Anchor = {
  quote: { exact: "WMS Adapter", prefix: "", suffix: "" },
  position: null,
  element: null,
  region: null,
  source: null,
};

function draft(kind: MessageKind, role: MessageRole, fields: Partial<Message> = {}) {
  return {
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
    ...fields,
  };
}

/** A real database on disk, because the command under test is a real `sqlite3`. */
function threadOnDisk(file: string): { db: Database.Database; threadId: string } {
  const db = new Database(file);
  db.exec(SCHEMA);

  const { record: document } = upsertDocument(
    db,
    { kind: "file", value: "/w/components.md" },
    "Components",
    null,
  );
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: document.id, anchor: QUOTE }],
    note: "What exactly is the role of the WMS adapter?",
    profile: "read",
  });

  const question = "Why do we need the WMS at all?";
  appendMessage(db, thread.id, draft("text", "user", { content: question }));
  appendMessage(
    db,
    thread.id,
    draft("tool_call", "assistant", { toolName: "Read", toolInput: { file_path: "/w/x.md" } }),
  );
  appendMessage(
    db,
    thread.id,
    draft("text", "assistant", { content: "It owns the work items the prototype consumes." }),
  );
  return { db, threadId: thread.id };
}

/** The `chat` line as a shell command, pointed at this test's database. */
function chatCommand(report: string, file: string): string {
  const line = report.split("\n").find((candidate) => candidate.startsWith("  chat "));
  assert.ok(line, "the report has no chat line");
  return line
    .trim()
    .replace(/^chat\s+/, "")
    .replace(/(sqlite3 )\S+/, `$1${file}`);
}

test("the report leads with a command that reads this comment's chat", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rex-debug-"));
  const file = join(directory, "rex.db");
  const { db, threadId } = threadOnDisk(file);

  try {
    const report = await debugReport(db, threadId, "0.1.0");

    // READ before RUN, for spec 13 §4.2's reason: the block that turns the
    // paste into an instruction goes first, and the evidence follows it.
    assert.ok(report.indexOf("\nREAD\n") < report.indexOf("\nRUN\n"));
    assert.match(report, new RegExp(`FROM message WHERE thread_id = '${threadId}' ORDER BY seq`));

    // Closing leaves the database exactly as a REX that has quit leaves it: no
    // `-shm` file. That is the state `sqlite3 -readonly` cannot open, and the
    // state every pasted report is read in, so it is the state to test in.
    db.close();
    assert.doesNotMatch(report, /-readonly/);

    const chat = chatCommand(report, file);
    const output = execSync(chat, { encoding: "utf8" });

    assert.match(output, /Why do we need the WMS at all\?/);
    assert.match(output, /It owns the work items the prototype consumes\./);
    assert.match(output, /kind = tool_call/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the words-only hint is a change the reader can actually make", async () => {
  // `words` tells the reader to add one clause before ORDER BY. If that
  // sentence does not describe the command above it, it is worse than absent —
  // it hands them a syntax error while they are already debugging something.
  const directory = mkdtempSync(join(tmpdir(), "rex-debug-words-"));
  const file = join(directory, "rex.db");
  const { db, threadId } = threadOnDisk(file);

  try {
    const report = await debugReport(db, threadId, "0.1.0");
    db.close();

    const chat = chatCommand(report, file);
    const words = chat.replace("ORDER BY seq", "AND kind = 'text' ORDER BY seq");
    const output = execSync(words, { encoding: "utf8" });

    assert.match(output, /Why do we need the WMS at all\?/);
    assert.doesNotMatch(output, /tool_call/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the report puts a refusal and a failure under different headings", async () => {
  // The report a reviewer pastes into a fresh session. Both facts were printed
  // under DENIED until 2026-09-01, so the session that received it started by
  // investigating a gate that had never fired.
  const directory = mkdtempSync(join(tmpdir(), "rex-debug-denied-"));
  const file = join(directory, "rex.db");
  const { db, threadId } = threadOnDisk(file);

  try {
    const gate = "A read session cannot change any file: 'rm' is not on the allowlist.";
    appendMessage(
      db,
      threadId,
      draft("tool_call", "assistant", { toolName: "Bash", toolInput: { command: "rm -rf out" } }),
    );
    appendMessage(
      db,
      threadId,
      draft("tool_result", "user", {
        toolName: "Bash",
        content: gate,
        isError: true,
        denied: true,
      }),
    );
    appendMessage(
      db,
      threadId,
      draft("tool_call", "assistant", { toolName: "Bash", toolInput: { command: "echo ===" } }),
    );
    appendMessage(
      db,
      threadId,
      draft("tool_result", "user", {
        toolName: "Bash",
        content: "Exit code 1\n(eval):1: == not found",
        isError: true,
      }),
    );

    const report = await debugReport(db, threadId, "0.1.0");
    db.close();

    assert.match(report, /1 denied · 1 failed/);
    assert.match(report, /DENIED — the gate refused these \(1\)\n {2}1 Bash · A read session/);
    assert.match(report, /FAILED — these ran and did not succeed \(1\)\n {2}1 Bash · Exit code 1/);
    // Each command under its own heading, and never both under DENIED.
    assert.ok(report.indexOf("rm -rf out") < report.indexOf("FAILED —"));
    assert.ok(report.indexOf("echo ===") > report.indexOf("FAILED —"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
