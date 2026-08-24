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
import { allowGenerationTools, gateDecision, writeGateDecision } from "../src/main/agent/gate.ts";

const bash = (command: string): string | null => gateDecision("Bash", { command });

test("write tools are denied outright", () => {
  for (const tool of ["Write", "Edit", "NotebookEdit"]) {
    assert.notEqual(gateDecision(tool, {}), null, `${tool} must be denied`);
  }
});

/**
 * Spec 11 §6.3 makes the web half of this a decision rather than an accident.
 *
 * `WebSearch` and `WebFetch` pass the gate because they are neither a write
 * tool, nor Bash, nor MCP — true by construction. The spec states the rule the
 * construction happens to produce: *a `read`-profile agent may search and fetch
 * the web to check a claim in the document; it may not write anything,
 * anywhere, by any route.* The two are independent, and the test below is what
 * stops a later tightening from silently taking the first one away.
 *
 * It matters most on a deck, which is the format where "is this number still
 * right?" is the commonest comment — a slide asserts a figure with no room for
 * the paragraph that would have justified it.
 */
test("read tools are allowed, including the two that reach the web", () => {
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
    "grep -rn 'anchor' src",
    "find . -name '*.md' -type f",
    "head -40 SPEC.md",
    "tail -n 20 README.md",
    "stat -f %z package.json",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

/**
 * The regression this file was extended for. A pipe inside a quoted pattern is
 * an alternation, and the gate used to test the raw string for `|` — so a plain
 * search fired the deny hook and the reviewer saw DENIED on `rg`.
 */
test("a pipe inside a quoted pattern is not a pipeline", () => {
  for (const command of [
    `rg -n "retry|backoff" --glob '*.md' --hidden`,
    "grep -rnE 'foo|bar' src",
    `rg "a > b" docs`,
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

test("a real pipeline is allowed only when every stage is", () => {
  assert.equal(bash("rg -n foo src | head -20"), null);
  assert.equal(bash("git log --oneline | wc -l"), null);
  assert.notEqual(bash("rg foo src | tee hits.txt"), null);
  assert.notEqual(bash("cat a.md | python -c 'import sys'"), null);
  assert.notEqual(bash("ls | xargs rm"), null);
});

/**
 * `git -C <repo>` is the form an agent actually writes, because REX's working
 * directory is not the document's repository. A prefix-matching allowlist
 * refused every one of them; measured in a real transcript on 2026-08-22.
 */
test("git global options before the subcommand are seen through", () => {
  for (const command of [
    "git -C /Users/lukas/Projects/docs status --porcelain",
    "git -C /Users/lukas/Projects/docs log --oneline -5",
    "git --no-pager diff HEAD~1",
    "git --git-dir=/repo/.git --work-tree=/repo ls-files",
    "git -C /repo grep -n 'scaling.png'",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

test("a git subcommand that writes is denied wherever it sits", () => {
  for (const command of [
    "git -C /repo checkout main",
    "git -C /repo add .",
    "git config user.name hacker",
    "git --no-pager commit -m x",
    // -c can redefine the very subcommand being checked:
    // `git -c alias.status='!rm -rf x' status` reads as `status`.
    "git -c alias.status='!rm -rf x' status",
    "git grep -O vim pattern",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

/**
 * A chain of read-only commands is read-only. The operator was never the
 * danger — reaching a writing binary, or a redirect, is.
 */
test("&& and ; chains are checked stage by stage, like a pipeline", () => {
  assert.equal(bash('ls -la && echo "---UNTRACKED---" && git status --porcelain'), null);
  assert.equal(bash("cat a.md; wc -l b.md"), null);
  assert.equal(bash("rg foo src || echo none"), null);
  assert.notEqual(bash("ls -la && rm -rf /tmp/x"), null);
  assert.notEqual(bash("cat a.md; python -c 'x'"), null);
  // A lone `&` backgrounds the command past the session the gate reasons about.
  assert.notEqual(bash("find / -name x &"), null);
});

test("binaries whose flags write are not on the list, or are guarded", () => {
  for (const command of [
    "sort -o out.txt in.txt",
    "uniq in.txt out.txt",
    "tree -o listing.txt",
    "nvim-tools --fix-all",
    "nvim-tools --fix src/main/index.ts",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
  assert.equal(bash("nvim-tools --json --all"), null);
});

test("find may walk a tree but never act on it", () => {
  for (const command of [
    "find . -name '*.tmp' -delete",
    "find src -type f -exec rm {} ;",
    "find . -name x -ok rm {} +",
    "find . -fprint listing.txt",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
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

/**
 * Double quotes are NOT inert: the shell runs `$(…)` and backticks inside them.
 * A tokeniser that treats quoted text as literal approves `cat "$(whoami).txt"`
 * as the word `cat` plus a filename — measured, and the reason this test exists.
 */
test("command substitution inside double quotes still executes, so it is denied", () => {
  for (const command of [
    'cat "$(whoami).txt"',
    'grep foo "`touch /tmp/pwned`"',
    'ls "$(rm -rf /tmp/x)"',
    'git -C "$(pwd)" status',
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("single quotes are inert, and expansions that run nothing are fine", () => {
  // The shell expands neither of these; `$?` and `$HOME` expand but run nothing.
  assert.equal(bash("grep -rn '$(not a command)' src"), null);
  assert.equal(bash('git status --porcelain; echo "EXIT:$?"'), null);
  assert.equal(bash('ls -la "$HOME/Projects"'), null);
});

test("MCP tools are deny-by-default", () => {
  assert.notEqual(gateDecision("mcp__anything__do_thing", {}), null);
});

// ── Spec 11 §6.4.4 — the write profile's MCP allowlist ──────────
//
// This is the one change spec 11 makes to spec 01's contract, and the reason is
// concrete: loading `media-plugin` declares FIVE MCP servers, and three of them
// are things a deck agent must not silently reach — `drawio` opens a GUI editor
// in a headless session, `media-playwright` spawns a second browser, and
// `mermaid` is a **remote HTTP endpoint** that would be sent slide content.
//
// Spec 01 §8.4 already said what it wanted: "an MCP server added later must be
// allowed explicitly rather than silently gaining access." That was true of the
// read profile and false of the write profile. It is true of both now.

test("§6.4.4 — MCP is deny-by-default in the write profile too", () => {
  for (const tool of [
    "mcp__mermaid__render",
    "mcp__drawio__open",
    "mcp__media-playwright__browser_navigate",
    "mcp__ElevenLabs__text_to_speech",
    "mcp__media-mcp__generate_image",
  ]) {
    assert.notEqual(writeGateDecision(tool), null, `${tool} must be denied by default`);
  }
});

test("§6.4.4 — everything that is not MCP stays allowed for write", () => {
  // Without this the SDK's default permission mode prompts for approval on
  // every Edit, and a headless session has nobody to prompt. What protects the
  // user for these is §8.7 step 5: the change is shown and nothing is kept
  // until they accept.
  for (const tool of ["Write", "Edit", "Bash", "Read", "WebFetch", "Glob"]) {
    assert.equal(writeGateDecision(tool), null, `${tool} must be allowed for write`);
  }
});

test("§6.4.3 — the key opens exactly two tools and no server", () => {
  allowGenerationTools();
  assert.equal(writeGateDecision("mcp__media-mcp__generate_image"), null);
  assert.equal(writeGateDecision("mcp__media-mcp__generate_video"), null);

  // The other four servers stay refused whether the key is set or not. An
  // allowlist that names two tools is a much smaller thing to reason about
  // than one that names a server.
  for (const tool of [
    "mcp__media-mcp__generate_music",
    "mcp__mermaid__render",
    "mcp__drawio__open",
    "mcp__media-playwright__browser_navigate",
    "mcp__ElevenLabs__text_to_speech",
  ]) {
    assert.notEqual(writeGateDecision(tool), null, `${tool} must stay denied`);
  }

  // And the read profile gains nothing from the key at all.
  assert.notEqual(gateDecision("mcp__media-mcp__generate_image", {}), null);
});
