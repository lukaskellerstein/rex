// `classifyError` — the sentence a failed run puts on the reviewer's screen.
//
// This exists because of a measured wrong diagnosis. On 2026-08-25 thread
// `e2c37e06` failed and the debug report said "check that the claude executable
// is installed and on PATH". The Agent SDK ships and resolves its own binary and
// never consults PATH — a query spawns normally under
// `PATH=/usr/bin:/bin:/usr/sbin:/sbin` — so the sentence was false, and the
// SDK's own words had been discarded to make room for it.
//
// A wrong hint costs more than no hint: it is read as a diagnosis, and it sends
// the reader after a bug that does not exist.
//
// Run: npm run test:errors

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Denial } from "../src/main/agent/gate.ts";
import { classifyError, deniedBy } from "../src/main/agent/runner.ts";

test("the original error always survives", () => {
  for (const text of [
    "Connection reset by peer",
    "model 'claude-nope' not found",
    "ENOENT: no such file or directory, open '/tmp/plan.json'",
    "Request timed out after 600000ms",
    "401 unauthorized",
  ]) {
    assert.ok(
      classifyError(new Error(text)).includes(text),
      `REX must not speak in place of: ${text}`,
    );
  }
});

/**
 * The regression itself. Each of these contains "not found" or "enoent" and
 * none of them is about the executable, so none may be blamed on it.
 */
test("an unrelated 'not found' is not blamed on the executable", () => {
  for (const text of [
    "model 'claude-nope' not found",
    "ENOENT: no such file or directory, open '/tmp/plan.json'",
    "MCP server 'media-mcp' not found",
    "404 not found",
  ]) {
    const message = classifyError(new Error(text));
    assert.ok(
      !message.includes("executable"),
      `must not name the executable for: ${text} — got ${message}`,
    );
  }
});

test("the SDK's own executable failures do get the hint", () => {
  for (const text of [
    "Claude Code executable not found at /usr/local/bin/claude. Is options.pathToClaudeCodeExecutable set?",
    "Claude Code native binary not found at /Users/x/.local/bin/claude.",
    "spawn /Users/x/.local/bin/claude ENOENT",
  ]) {
    const message = classifyError(new Error(text));
    assert.ok(message.includes("could not be started"), `must hint for: ${text}`);
    assert.ok(message.includes(text), "and must still carry the SDK's own words");
  }
});

test("authentication is matched on a word, not on the letters 'auth'", () => {
  for (const text of ["401 unauthorized", "invalid api_key", "authentication failed"]) {
    assert.ok(classifyError(new Error(text)).includes("Authentication failed"), text);
  }
  // "author" contains "auth", and the old substring test fired on it.
  for (const text of ["author of the commit is unknown", "unauthorised is spelled -ised here"]) {
    assert.ok(!classifyError(new Error(text)).includes("Authentication failed"), text);
  }
});

test("a timeout is still recognised", () => {
  assert.ok(
    classifyError(new Error("Request timed out after 600000ms")).includes("timed out"),
    "a timeout keeps its hint",
  );
});

test("a thrown non-Error is stringified rather than dropped", () => {
  assert.ok(classifyError("plain string failure").includes("plain string failure"));
});

// ── `deniedBy` — refused, or merely failed ────────────────────
//
// The second measured wrong diagnosis in this file's subject, and the same
// shape as the first. On 2026-09-01 thread `f5e79775` reported two DENIED
// steps in a session where the gate never fired: both were `zsh` errors, and
// `is_error` was the whole basis for the word. A reader who trusts REX about
// its own gate then goes looking for a safety bug that does not exist.
//
// This is where the two are told apart, and the flag it returns is what every
// view and the debug report read afterwards.

const GATE = "A read session cannot change any file, so Bash may not redirect — 'ls > out.txt'.";
const REFUSAL: Denial[] = [{ toolName: "Bash", reason: GATE }];

test("the gate's own sentence, handed back by the SDK, is a refusal", () => {
  assert.equal(deniedBy(REFUSAL, "Bash", GATE), true);
});

test("a command that exited non-zero in the same run is not", () => {
  // The run really did have a refusal in it — that is the case that made the
  // old rule look right. Every other failure in it is still just a failure.
  assert.equal(deniedBy(REFUSAL, "Bash", "Exit code 1\n(eval):1: == not found"), false);
  assert.equal(
    deniedBy(REFUSAL, "Bash", "Exit code 1\nls: docs/review: No such file or directory"),
    false,
  );
});

test("a refusal recorded for one tool does not mark another tool's failure", () => {
  assert.equal(deniedBy(REFUSAL, "Read", GATE), false);
});

test("the SDK's own refusal is a refusal, with nothing recorded by the gate", () => {
  assert.equal(
    deniedBy([], "Bash", "Permission to use Bash with command find . -type f has been denied."),
    true,
  );
});

test("output that merely quotes that sentence is not a refusal", () => {
  // A `grep` of REX's own log does exactly this. Matched loosely, REX would
  // report a gate that fired because somebody searched for the words.
  assert.equal(
    deniedBy(
      [],
      "Bash",
      "Exit code 1\nrex.log:41:Permission to use Bash with command find . has been denied.",
    ),
    false,
  );
});

test("nothing refused and nothing quoted is simply a failure", () => {
  assert.equal(deniedBy([], "Bash", "Exit code 2\ngrep: docs: Is a directory"), false);
});

// ── The bundled CLI is older than the model needs ───────────────
//
// Reported 2026-09-03. The API's own message ends "Run `claude update`", which
// is the one instruction that cannot work here: the SDK resolves its own
// binary. This machine's Claude Code was 2.1.259 while REX's runs were on
// 2.1.237 — so following the advice would have changed nothing and looked like
// REX being broken.

const VERSION_GATE =
  "API Error: 400 Claude Code 2.1.237 does not support this model; version 2.1.251 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.";

test("the version gate names both versions, and the dependency to update", () => {
  const said = classifyError(new Error(VERSION_GATE));

  assert.match(said, /2\.1\.237/, "the version REX is actually running");
  assert.match(said, /2\.1\.251/, "the version the model needs");
  assert.match(said, /@anthropic-ai\/claude-agent-sdk/, "the thing to update is REX's dependency");
  assert.ok(said.includes(VERSION_GATE), "and the API's own words survive, as ever");
});

test("the version gate contradicts the CLI's own advice, out loud", () => {
  const said = classifyError(new Error(VERSION_GATE));
  // Not merely omitting it: the wrong instruction is still there, three lines
  // below, and a hint that ignores it leaves the reader to follow it.
  assert.match(said, /Ignore the "run claude update" advice/i);
});

test("it does not fire on any other 400", () => {
  for (const text of [
    "API Error: 400 messages.0: all messages must have non-empty content",
    "400 model 'claude-nope' not found",
    "Claude Code 2.1.237 exited with code 1",
  ]) {
    assert.equal(
      classifyError(new Error(text)).startsWith("Agent error:"),
      true,
      `REX must add no hint to: ${text}`,
    );
  }
});
