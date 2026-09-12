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

// ── Spec 12 — refuse a command for what it does, not for being unlisted ──
//
// The two cases below are transcripts, not inventions. Both were refused by a
// gate that was working exactly as written, and neither command could have
// changed a single byte. That is the failure spec 12 exists to fix: an
// unnecessary refusal costs a step and teaches the reviewer nothing, and an
// agent that cannot search the way it wanted answers from the prose instead.

test("§3.2 — cd is allowed, because it cannot write", () => {
  // Thread a1d3793c, 2026-08-25, verbatim.
  assert.equal(
    bash(
      'cd /Users/lukas/Projects/docs/architecture && grep -n -i "mcp|adapter api" components.md | head -60',
    ),
    null,
  );
  assert.equal(bash("cd /repo && ls -la"), null);
  assert.equal(bash("cd ~/Projects && git status --porcelain"), null);

  // And it smuggles nothing: every stage is still checked in its own right.
  assert.notEqual(bash("cd /repo && rm -rf build"), null);
  assert.notEqual(bash("cd /repo; python -c 'x'"), null);
});

test("§3.5 — a redirect to /dev/null puts nothing on disk", () => {
  // Thread e2c37e06, 2026-08-25, verbatim.
  assert.equal(
    bash(
      "wc -l docs/architecture/*.md 2>/dev/null; wc -l LUKAS-questions.md REFERENCES.md 2>/dev/null",
    ),
    null,
  );
  for (const command of [
    "rg foo src 2>/dev/null",
    "ls -la 2>&1",
    "git status 1>&2",
    "find . -name '*.md' &>/dev/null",
    "cat missing.md 2>/dev/null | head -5",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

test("§3.5 — every other redirect is still a write", () => {
  for (const command of [
    "ls > listing.txt",
    "ls >> listing.txt",
    // /dev/null is matched as a COMPLETE word.
    "ls > /dev/null.txt",
    "ls >/dev/nullx",
    "cat a.md > b.md",
    "wc -l x 2> errors.log",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("§3.3 — the ordinary ways of reading something are allowed", () => {
  for (const command of [
    "jq '.dependencies' package.json",
    "diff a.md b.md",
    "sort names.txt | uniq -c",
    "tree -L 2 src",
    "du -sh node_modules",
    "cut -d: -f1 list.txt",
    "xxd -l 64 deck.pptx",
    "unzip -l deck.pptx",
    "unzip -p deck.pptx ppt/slides/slide1.xml",
    "shasum -a 256 README.md",
    "date",
    "sed -n '40,80p' SPEC.md",
    "awk -F: '{print $1}' list.txt",
    "awk '{n+=$1} END {print n}' numbers.txt",
    "sed 's/a/b/' words.txt",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

test("§3.3 — each new binary is guarded where it can write", () => {
  for (const command of [
    "sort -o out.txt in.txt",
    "sort -nro out.txt in.txt",
    "sort --output=out.txt in.txt",
    "uniq in.txt out.txt",
    "tree -o listing.txt",
    "yq -i '.a = 1' config.yaml",
    "unzip deck.pptx",
    "unzip -d /tmp/out deck.pptx",
    "tail -f server.log",
    "rg --pre=sh foo src",
    "rg --hostname-bin /tmp/evil foo",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
  // A flag VALUE is not an operand: `uniq -f 2 file` has one file, not two.
  assert.equal(bash("uniq -f 2 list.txt"), null);
});

test("§3.4 — sed and awk write from inside their program text", () => {
  for (const command of [
    "sed -i 's/a/b/' README.md",
    "sed --in-place 's/a/b/' README.md",
    "sed 'w /tmp/out.txt' README.md",
    "sed 's/a/b/w /tmp/out.txt' README.md",
    "sed -f script.sed README.md",
    // The `>` survives splitStages because quotes are tracked, so without the
    // guard this is a plain write hole rather than a theoretical one.
    `awk '{print > "/tmp/out.txt"}' list.txt`,
    `awk '{system("rm -rf /tmp/x")}' list.txt`,
    `awk '{"date" | getline d; print d}' list.txt`,
    "awk -f program.awk list.txt",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("§5 — a git subcommand that both reads and writes is judged on its operands", () => {
  for (const command of [
    "git branch",
    "git branch -a",
    "git branch --list 'feature/*'",
    "git tag -l",
    "git stash list",
    "git remote -v",
    "git config --get user.name",
    "git config --list",
    "git worktree list",
    "git submodule status",
    "git reflog -20",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }

  for (const command of [
    "git branch spike",
    "git branch -d old",
    "git tag v1.0",
    "git tag -a v1.0 -m x",
    "git stash push",
    "git stash pop",
    "git remote add origin git@example.com:x/y",
    "git config user.name hacker",
    "git config --global user.email x@y.z",
    "git worktree add /tmp/wt",
    "git submodule update --init",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

/**
 * §3.6 — the refusal is about the command, not about REX's book-keeping.
 *
 * "'cd' is not on the allowlist" is the sentence this whole spec started from.
 * It is a fact about REX, the agent cannot act on it, and the reviewer reading
 * the trace learns nothing about their own document.
 */
test("§3.6 — a refusal says what the command would do", () => {
  const cases: Array<[string, string]> = [
    ["echo hi | tee out.txt", "tee writes a file"],
    ["rm -rf build", "rm deletes files"],
    ["python -c 'x'", "can write any file"],
    ["ls | xargs rm", "run another command"],
    ["curl -o page.html https://example.com", "write the response to a file"],
    ["sed -i 's/a/b/' x.md", "sed -i rewrites the file"],
    ["less README.md", "waits for a keypress"],
  ];
  for (const [command, phrase] of cases) {
    const reason = bash(command);
    assert.ok(reason?.includes(phrase), `${command} → ${reason}`);
    assert.ok(!reason?.includes("is not on the allowlist"), `${command} must not cite the list`);
  }

  // The default is the honest one: REX admitting it cannot tell.
  const unknown = bash("xsltproc -o out.xml sheet.xsl in.xml");
  assert.ok(unknown?.includes("cannot tell whether 'xsltproc' writes"), String(unknown));
});

// ── spec 56 §3.3 — curl, where the unit is the flag ──────────────
//
// Thread ef3df7aa, 2026-09-11: the reviewer asked "What is it?" about a
// glossary whose introduction cites an Anthropic article. The agent read the
// file, read its neighbour, searched the repository, and then tried to open the
// citation. The gate refused every `curl` and told it to use `WebFetch` — a
// tool the Codex adapter does not have — and the run died with no answer.
//
// So the binary is allowed and the FLAGS are judged, which is the shape §6.5
// already uses for `sort -o` and `tree -o`.

test("§3.3 — curl may fetch a page", () => {
  for (const command of [
    "curl https://example.com",
    "curl -s https://example.com",
    "curl -sL --max-time 15 https://www.anthropic.com/engineering/a-page",
    "curl -sSL -H 'Accept: text/html' https://example.com",
    "curl -I https://example.com",
    "curl --compressed -A 'rex' https://example.com",
    "curl -X GET https://example.com",
    "curl --request HEAD https://example.com",
  ]) {
    assert.equal(bash(command), null, `${command} → ${bash(command)}`);
  }
});

test("§3.3 — curl may not write a file, send a body, or use another method", () => {
  const cases: Array<[string, string]> = [
    ["curl -o page.html https://example.com", "write the response to a file"],
    ["curl -O https://example.com/a.zip", "write the response to a file"],
    ["curl --output page.html https://example.com", "writes the response to a file"],
    ["curl --output-dir /tmp -O https://example.com/a", "writes the response to a file"],
    ["curl --create-dirs -o a/b.html https://example.com", "writes the response to a file"],
    ["curl -d 'a=1' https://example.com", "send a body"],
    ["curl --data-raw 'a=1' https://example.com", "sends a body"],
    ["curl --data-binary @file https://example.com", "sends a body"],
    ["curl -F file=@x.md https://example.com", "send a body"],
    ["curl -T upload.md https://example.com", "send a body"],
    ["curl --upload-file x https://example.com", "sends a body"],
    ["curl -X POST https://example.com", "CHANGE something"],
    ["curl --request DELETE https://example.com", "CHANGE something"],
    ["curl --request=PUT https://example.com", "CHANGE something"],
    ["curl -D headers.txt https://example.com", "write a file beside the response"],
    ["curl -c jar.txt https://example.com", "write a file beside the response"],
    ["curl -K flags.txt", "write a file beside the response"],
    ["curl --dump-header h.txt https://example.com", "writes a second file"],
    ["curl --trace t.log https://example.com", "writes a second file"],
    ["curl --config flags.txt", "somewhere REX cannot read"],
  ];
  for (const [command, phrase] of cases) {
    const reason = bash(command);
    assert.ok(reason?.includes(phrase), `${command} → ${reason}`);
  }
});

test("§3.3 — a bundled short flag is read letter by letter", () => {
  // `-sLo out.html` is ONE word, and a rule looking for a bare `-o` passes it.
  // This is the case the guard exists for.
  assert.ok(bash("curl -sLo out.html https://example.com")?.includes("write the response"));
  assert.ok(bash("curl -fsSLo /tmp/x https://example.com")?.includes("write the response"));
  // …and a bundle of reading flags is still a fetch.
  assert.equal(bash("curl -fsSL https://example.com"), null);
});

test("§3.3 — wget still names the tool that replaces it", () => {
  const reason = bash("wget https://example.com");
  assert.ok(reason?.includes("curl"), String(reason));
  assert.ok(!reason?.includes("WebFetch"), "Codex has no WebFetch to be sent to");
});

// ── §6.8 — gh, where the unit is the command pair ────────────────
//
// Thread e2c37e06, 2026-08-25: the reviewer asked which agents a document's
// system supports, the agent went for the pull request that introduced them,
// and the gate answered "REX cannot tell whether 'gh' writes". It cannot tell
// about `gh`, and it does not have to — `gh pr view` reads and `gh pr merge`
// merges, so the pair is what the admission test is met by.
//
// The repository in every case below is `lukaskellerstein/my-ecommerce`, which
// exists to be tested against. No fixture here names a repository REX's own
// test documents come from.

const REPO = "lukaskellerstein/my-ecommerce";

test("§6.8 — gh reads a repository, an issue and a run", () => {
  for (const command of [
    // The shape of thread e2c37e06's refused command, on the test repository.
    `gh pr view 1 --repo ${REPO} --json number,title,state,author,url`,
    "gh pr list --state merged --limit 20",
    "gh pr diff 1",
    "gh pr checks 1",
    "gh issue view 44 --comments",
    "gh issue list --label bug",
    `gh repo view ${REPO}`,
    "gh run list --workflow ci.yml",
    "gh run view 90210 --log",
    "gh workflow list",
    `gh search code 'checkout' --repo ${REPO}`,
    `gh api repos/${REPO}/pulls/1`,
    `gh api --paginate repos/${REPO}/issues -q '.[].title'`,
    "gh status",
    "gh --version",
    // The forms an agent writes around it stay intact.
    "gh pr view 1 --json body -q .body | head -40",
    "cd /repo && gh pr list --json number,title 2>/dev/null",
  ]) {
    assert.equal(bash(command), null, `${command} should be allowed`);
  }
});

test("§6.8 — every gh command that changes something is refused", () => {
  for (const command of [
    "gh pr create --title x --body y",
    "gh pr merge 1 --squash",
    "gh pr close 1",
    "gh pr comment 1 --body 'looks good'",
    "gh pr edit 1 --add-label bug",
    "gh pr checkout 1",
    "gh issue create --title x",
    "gh issue delete 44",
    `gh repo clone ${REPO}`,
    `gh repo delete ${REPO}`,
    "gh repo fork",
    "gh release download v1.0",
    "gh release create v1.0",
    "gh run rerun 90210",
    "gh run download 90210",
    "gh workflow run ci.yml",
    "gh label create bug",
    "gh secret set TOKEN",
    "gh gist create notes.md",
    "gh alias set x 'pr view'",
    // The token itself, which must never reach a trace.
    "gh auth token",
    "gh auth status --show-token",
    // A command with no subcommand is a pair REX has not admitted.
    "gh pr",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("§6.8 — gh api is a GET or it is nothing", () => {
  for (const command of [
    "gh api -X DELETE repos/o/n/issues/1",
    "gh api -XPOST repos/o/n/issues",
    "gh api --method PATCH repos/o/n",
    "gh api --method=PUT repos/o/n",
    // A single field silently turns the request into a POST.
    "gh api repos/o/n/issues -f title=x",
    "gh api repos/o/n/issues -ftitle=x",
    "gh api repos/o/n/issues -F number=1",
    "gh api repos/o/n/issues --field title=x",
    "gh api repos/o/n/issues --input body.json",
    // GraphQL needs -f query=…, so it goes with them.
    "gh api graphql -f query='{ viewer { login } }'",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

/**
 * Neither of these writes. Both are refused for the reason `tail -f` is: the
 * run would wait — on a browser nothing can show, or on a CI run that has not
 * finished.
 */
test("§6.8 — gh may not open a browser or wait for CI", () => {
  for (const command of [
    "gh pr view 12 --web",
    "gh pr view -w 12",
    "gh issue list --web",
    "gh pr checks 12 --watch",
    "gh run view 90210 --watch",
  ]) {
    assert.notEqual(bash(command), null, `${command} must be denied`);
  }
});

test("§6.8 — the refusal says what to reach for instead", () => {
  const merge = bash("gh pr merge 12");
  assert.ok(merge?.includes("gh pr view"), String(merge));
  assert.ok(!merge?.includes("cannot tell whether 'gh' writes"), String(merge));

  const post = bash("gh api repos/o/n/issues -f title=x");
  assert.ok(post?.includes("Ask for it in the path instead"), String(post));
});
