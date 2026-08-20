// SPEC.md §8.4 — the deny gate, tested against the write vectors the spec
// itself names.
//
// This exists because the guarantee it protects is the whole safety story:
// "read cannot write" is what REX promises about the user's own documents, and
// `disallowedTools` is configuration rather than a wall. A regression here is
// silent — a read agent that can write looks exactly like one that cannot,
// right up until it edits something.
//
// Run: npm run test:gate

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gateDecision } from "../src/main/agent/gate.ts";

const bash = (command: string): string | null => gateDecision("Bash", { command });

test("write tools are denied outright", () => {
  for (const tool of ["Write", "Edit", "NotebookEdit"]) {
    assert.notEqual(gateDecision(tool, {}), null, `${tool} must be denied`);
  }
});

test("read tools are allowed", () => {
  for (const tool of ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "ToolSearch", "Agent"]) {
    assert.equal(gateDecision(tool, {}), null, `${tool} must be allowed`);
  }
});

test("the §8.4 allowlist admits read-only inspection", () => {
  for (const command of [
    "git log --oneline -20",
    "git diff HEAD~1",
    "git status --porcelain",
    "git blame README.md",
    "ls -la src",
    "rg 'anchor' src",
    "nvim-tools --json --all",
    "cat package.json",
    "wc -l src/main/index.ts",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

test("every write vector §8.4 names is denied", () => {
  for (const command of [
    "python -c \"open('x','w').write('hi')\"",
    "echo hi | tee x.txt",
    "sh -c 'echo hi > x.txt'",
    "echo hi > x.txt",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("an allowlisted command cannot be turned into a write by the shell", () => {
  // The allowlist anchors on the start of the command, so without a check on
  // shell composition each of these begins with an approved binary and still
  // writes a file.
  for (const command of [
    "git status --porcelain > DECISION.txt",
    "ls -la >> listing.txt",
    "cat notes.md > copy.md",
    "rg foo src | tee hits.txt",
    "wc -l x && touch marker",
    "cat a; rm -rf b",
    "cat `whoami`.txt",
    "ls $(pwd)/x > y",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("MCP tools are deny-by-default", () => {
  assert.notEqual(gateDecision("mcp__anything__do_thing", {}), null);
});
