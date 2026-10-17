# Spec 62 — the workspace's hooks are not REX's

**Status**: built, 2026-10-17. Measured before and after with the shipped
`claude-agent-sdk` 0.2.168, against a scratch repository and against
`agentic-SDLC`.

> [!important]
> **A hook is a boundary, not context.** Spec 52 drew the line: a reviewed
> repository may shape the agent's context, and it may not set REX's boundary.
> Its §6 put hooks on the context side. That was wrong. A `PreToolUse` hook that
> answers `deny` decides whether a tool call runs, which is `gate.ts`'s job, and
> a `SessionStart` hook runs the repository's code on every run, an ASK
> included.
>
> This spec amends spec 52 §6 and spec 42 §9.1: `setting_sources` stays
> `["project"]`, and the Claude adapter turns every settings hook off.

## 1. The bug, as the reviewer met it

An ACT run on `docs/mami-review/index.html` in `agentic-SDLC`. The reviewer
asked for a change to `index.html` and a new gap in `found-gaps.html`. 153
steps, 23 minutes, $15.03. The debug report:

```text
FAILED — these ran and did not succeed (19)
  16 Edit · PreToolUse:Edit hook error: …/agentic-SDLC/docs/mami-review/found-gaps.html
     is in the main checkout …/agentic-SDLC, which is read-only for agents.
     Ask the user to start a session with `claud…
```

The agent ended the turn by telling the reviewer to restart it with
`claude -w <name>`, which is advice for a Claude Code session and means nothing
in REX.

## 2. What was happening

`agentic-SDLC/.claude/settings.json` registers `worktree-guard.py` as a
`PreToolUse` hook on `Edit|Write|NotebookEdit`. It denies any edit inside the
repository's main checkout, which is right for a developer's Claude Code session
and wrong for REX:

- Spec 22 §2.2 has the agent edit a second Markdown or HTML file **in place**.
  REX then moves the change into a working copy and puts the original back. The
  guard refuses exactly that edit.
- The anchored document's own copy is under `~/.rex/work/`, outside every
  checkout, so the guard let it through. That is why one file worked and the
  other did not.
- REX's own hook said allow. A deny from any hook wins, so the gate's answer did
  not matter.

The same file also runs two `SessionStart` scripts and two Playwright hooks on
every run. None of them was chosen by REX, and an ASK ran them too.

## 3. What was rejected, and why

| Option | Rejected because |
|:--|:--|
| Set `CLAUDE_NO_WORKTREE=1` in the agent's environment | Answers one hook on one machine. Any other repository's `deny` still stops REX |
| Teach the guard about REX | Puts knowledge of REX into every repository REX opens |
| `setting_sources=[]` | Throws out `CLAUDE.md`, skills and agents. Spec 52 §3 already rejected it |
| Override `hooks` in `--settings` | Claude Code merges hooks from every source. A later source cannot remove an earlier one |

## 4. The change

### 4.1 The adapter turns the settings hooks off

`--settings` (`flagSettings`) outranks the project's settings, as spec 52 §4.1
measured, so REX always passes:

```json
{ "disableAllHooks": true }
```

merged with the output style when one is chosen. The model probe passes the same
settings, because a probe that loads more than a run describes a different CLI
(`models.py`, `SETTING_SOURCES`), and because its handshake starts a session,
which runs `SessionStart`.

**REX's gate is not a settings hook.** It is an SDK callback, registered over
the control protocol, and the CLI keeps running those. §5 measured it.

### 4.2 The write prompt says whose boundary it is

Turning the hook off is not enough when the repository's `CLAUDE.md` says the
same thing in words. `agentic-SDLC/.claude/rules/worktree.md` tells every agent
that the main checkout is read-only. The ACT prompt, with a workspace open,
gains one sentence after the in-place paragraph:

> This is a REX run, not a coding session in that repository. Its instructions
> about which checkout or worktree an agent may write do not apply here: REX
> holds every edit until the reviewer approves it.

## 5. What was measured

A scratch git repository whose settings register a `SessionStart` hook, a
`PreToolUse` hook on `Write` that answers `deny`, and a `PostToolUse` hook. A
local plugin registers the same three events. REX's callback records each call
and answers allow. The model is asked to `Write` one file.

| `--settings` | REX's callback | workspace hooks | plugin hooks | file written |
|:--|:--|:--|:--|:--|
| none (before) | ran | all ran, `deny` won | ran | **no** |
| none, workspace without the `deny` | ran | ran | ran | yes |
| `{"disableAllHooks": true}` (this spec) | **ran** | none ran | **none ran** | yes |

## 6. What it costs

**Plugin hooks go too.** `disableAllHooks` has no narrower form. The only
plugin REX loads that carries hooks is `media-plugin`, whose two `PostToolUse`
hooks run the draw.io edge postprocessor and an SVG check after a `Write`. Both
skills already tell the agent to run the same step itself (`graph-generation`
§2, `svg-mastery` HARD RULE 4), so the hooks were a safety net. If REX ever
needs a plugin hook, it becomes an SDK callback in the adapter, where REX
chooses it.

## 7. What this does not do

- It does not touch the other three adapters. None of them loads the
  repository's hook configuration today.
- It does not stop the repository shaping the agent. `CLAUDE.md`, skills and
  agents still load.
- It does not widen what ACT may write. Spec 22's put-back is unchanged.

## 8. Acceptance

1. `_options()` passes `disableAllHooks: true` in `--settings`, with and without
   a chosen output style, for both profiles.
2. The model probe passes the same settings.
3. With a workspace open, the ACT prompt carries the §4.2 sentence.
4. Against a repository whose hook denies `Write`, REX's callback still runs
   and the file is written.
5. In `agentic-SDLC`, the run that failed in §1 edits `found-gaps.html`, and
   that edit becomes a working copy with `git status --porcelain` empty.

`agent-runner/tests/test_claude_permissions.py` covers 1 and 2. Criterion 4 is
§5's last row. Criterion 5 is driven live.
