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
import { classifyError } from "../src/main/agent/runner.ts";

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
