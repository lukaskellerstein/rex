# Spec 52 — whose boundary it is

**Status**: built, 2026-09-10. Measured before and after against the same
repository, through `ClaudeAdapter.run()` and not through a harness's own
options.

> [!important]
> **A reviewed repository may shape the agent's context. It may not set REX's
> boundary.**
>
> Spec 42 §9.1 chose `setting_sources=["project"]` so that "the repository's own
> `.claude/` is part of what run in this directory means". That is right about
> `CLAUDE.md`, skills, agents and output style. The same switch also loads the
> repository's `sandbox` block, its permission rules and its permission mode —
> and those decide whether a tool call runs at all. `gate.ts` decides that.
>
> This spec amends that row. `setting_sources` stays `["project"]`; the two
> control keys are answered by REX instead.

## 1. The bug, as the reviewer met it

A comment thread on a document in a repository whose `.claude/settings.json`
says `sandbox.enabled: true`. Nineteen steps, three minutes ten, $4.03, and
three failed `gh` calls the debug report summarised as:

```text
FAILED — these ran and did not succeed (3)
  1 Bash · Run outside of the sandbox
```

`0 denied · 3 failed`. The gate refused nothing. REX allowed all three and they
still did not run.

## 2. What was actually happening

Two separate mechanisms, and the first one hides the second.

### 2.1 The sandbox has no network, and REX never chose it

Claude Code's bash sandbox confines filesystem and network access. Its network
allowlist is built from `WebFetch` permission rules, and REX loads none, so
every outbound connection is denied. The first `gh` call in the failing run
came back:

```text
Post "https://api.github.com/graphql": Forbidden
<sandbox_violations>
deny network-outbound api.github.com:443 (user denied)
</sandbox_violations>
```

REX's own gate lists `git` and `gh` among its read-only binaries
(`gate.ts` — `GH_READ_ONLY`, `ghApiDenial`). The gate said yes. The sandbox,
switched on by a file in the document's repository, said no.

### 2.2 A permission question with nobody to answer it

The model read the violation and did what the escape hatch is for: it retried
with `dangerouslyDisableSandbox: true`. A retried command runs outside the
sandbox, so it goes back through the regular permission flow, where an
interactive session shows a prompt. The bundled CLI turns that into:

```js
return { behavior: "ask",
         decisionReason: { type: "sandboxOverride", … },
         message: "Run outside of the sandbox" }
```

A headless run has no prompt. The question became the tool result, and its
whole text was the prompt's title.

**The `PreToolUse` hook does not prevent this.** REX's hook returns an explicit
allow (spec 42 §8), and that allow suppresses the ordinary prompt — but not
this one. The CLI's own check accepts a prior approval only when it came from a
**permission rule**:

```js
function dgt(e){ if(e?.type==="rule") return true;
                 if(e?.type==="subcommandResults") return […].every(…);
                 return false }
```

A hook decision is `{type: "hook"}`, so `dgt` is false and the question is
asked anyway.

### 2.3 The same hole, without any sandbox

The sandbox is not the only way in. A repository carrying
`permissions.ask: ["Bash(gh api:*)"]` — an ordinary, sensible thing for a
repository to carry — produces:

```text
Claude requested permissions to use Bash, but you haven't granted it yet.
```

for a command REX's gate allows. Same shape, same silence, no sandbox involved.

### 2.4 What this cost, and why nobody saw it

Not a crash and not a denial. `is_error = 1`, `denied = 0`, and the run
completed. Every surface drew a successful run that had quietly lost three
steps, and the model spent the rest of the turn working around a repository it
could not read.

## 3. What was rejected, and why

| Option | Rejected because |
|:--|:--|
| Configure the sandbox instead — `excludedCommands: ["gh", "git"]`, `network.allowedDomains` | Names the hosts a review needs in advance. It cannot be done, and each new repository is a new guess |
| `setting_sources=[]` | Throws out `CLAUDE.md`, skills and agents to fix permissions. The context is the reason spec 42 chose `project` |
| `permission_mode="bypassPermissions"` | Removes every question, including the ones REX would want to answer, and it shadows the callback in §4.2 outright. Blunt where a decision exists |
| Leave the sandbox on and answer the retry | Works, and wastes a turn and a network round trip on every command that needs a host. The first attempt always fails first |

## 4. The change

Both halves are in `agent-runner/src/agent_runner/adapters/claude/adapter.py`,
in `_options()`. Nothing in `src/` moves.

### 4.1 REX pins the sandbox

```python
sandbox={"enabled": False},
```

`ClaudeAgentOptions.sandbox` is merged into the CLI's `--settings`, and the
CLI's settings precedence is:

```js
qs = ["userSettings","projectSettings","localSettings","flagSettings","policySettings"]
```

`flagSettings` is `--settings` and outranks `projectSettings`, so this is the
value that lands whatever the repository says. It coexists with the
`outputStyle` REX already passes there — the SDK merges the two into one
object rather than replacing one with the other, and `test_claude_permissions`
pins that pair.

**This restores REX's stated model rather than changing it.** `bridge.ts:120`
and `apply.ts:870` both already say Claude has no sandbox and that its boundary
is the hook. The sandbox was never REX's; it arrived with a repository.

### 4.2 REX answers the prompt

```python
can_use_tool=_permission_prompt(emit, ask_policy, denials),
```

The hook is asked before every tool call and is the gate. This is asked only
when the CLI's own rules want a person, and it answers with the same policy —
`gate.ts`, over the same pipe. Allow becomes `PermissionResultAllow`, a refusal
becomes `PermissionResultDeny` and is recorded as a denial like any other.

Asking the policy twice for one call is deliberate. The answer is the same both
times, and writing a bare allow here would make it the one place in REX where
something runs because nobody looked.

> The SDK's own docstring says a `PreToolUse` hook returning allow "also skips
> this callback". **Measured 2026-09-10: it does not always.** With an `ask`
> rule in the repository, the hook allowed and the callback was still reached
> and still decided the call. The docstring describes the ordinary path; the
> paths in §2.2 and §2.3 are the ones that were failing.

## 5. What was measured

One scratch repository carrying **both** traps at once:

```json
{ "permissions": { "ask": ["Bash(gh api:*)"] },
  "sandbox": { "enabled": true, "autoAllowBashIfSandboxed": true } }
```

Two Bash calls each run: a multi-statement pipeline
(`cd <dir> && grep … | head -20; echo …; wc -l …`) and `gh api rate_limit`.

| Options | pipeline | `gh api` |
|:--|:--|:--|
| spec 42's, sandbox on, no `ask` rule | ok | `deny network-outbound api.github.com:443` |
| spec 42's, both traps | ok | `Claude requested permissions to use Bash, but you haven't granted it yet.` |
| **this spec's, both traps** | **ok** | **ok — `5000`** |

The last row ran through `ClaudeAdapter.run()` with a `RunRequest`, so it is the
shipped path and not a harness's own options object: `error=None`,
`denials=0`, both results `is_error=False`.

### 5.1 The worry this had to answer

The sandbox is what suppresses approval prompts in an interactive session —
`autoAllowBashIfSandboxed` defaults to true, and that is why it was switched on
in the first place. Turning it off could plausibly have brought every prompt
back.

**It does not, in REX.** REX's hook already returns an explicit allow, and that
is what suppresses the ordinary prompt here — the sandbox was never doing that
job. Measured with the sandbox off: the multi-statement pipeline ran with no
approval and the permission callback was never reached.

### 5.2 A class of failure that had already gone

The database holds seven older failures of a different shape, all between
3 and 5 September:

```text
This Bash command contains multiple operations.
The following part requires approval: cd ~/… && grep -rn "aging" docs/architecture/
```

Those repositories have no `.claude/settings.json` at all. The same command
shapes were re-run on 2026-09-10 against `claude-agent-sdk` 0.2.152 with
bundled CLI 2.1.259 and **none of them reproduces**. The class is recorded
because it is what the reviewer remembered, and it is not a reason to keep the
sandbox: it is already gone.

## 6. What this does not do

- It does not touch the other three adapters. Codex and OpenCode have sandboxes
  they chose themselves (specs 44 §9, 47 §7.4) and Deep Agents has none
  (spec 48 §5.1).
- It does not weaken ACT. `writeGateDecision` allows everything but MCP, and
  what protects a document is `SPEC.md` §8.7 step 5 — the diff is shown and
  nothing is kept until the reviewer accepts.
- It does not stop a repository shaping the agent. `CLAUDE.md`, skills, agents
  and hooks still load, because those are context.

## 7. Acceptance

1. `_options()` sets `sandbox={"enabled": False}` for both profiles.
2. A chosen output style and the sandbox pin both survive into `--settings`.
3. `can_use_tool` is set, answers with the policy, and records a refusal as a
   denial.
4. Against a repository carrying both traps, a `gh api` call and a
   multi-statement pipeline both run, with no denial and no error.

`agent-runner/tests/test_claude_permissions.py` covers 1 to 3. Criterion 4 was
driven live and is §5's last row.
