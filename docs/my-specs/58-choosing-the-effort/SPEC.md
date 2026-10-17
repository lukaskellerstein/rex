# REX 58 — choosing the effort

**Version:** 1.2 · 2026-10-17
**Status:** **built, milestones 0–3.** §3's tables were measured on this machine
on 2026-10-17, against `claude-agent-sdk` 0.2.168 and its bundled Claude Code
2.1.301. 1.1 corrects §6, §6.2 and milestone 1 to what was built and proved.
1.2 makes every "default" in the model and effort menus name its value (§3.1,
§7.1).
**Amends:** [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
§6.3 and §9; [`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md)
§4.0 and §4.1; [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
§5 — §2.1 lists every row.
**Depends on:** spec 25 (the model picker, the default, the record), spec 31
(the style, which this control sits beside), spec 43 §4 (the control row and
what a control starts on), spec 42 (the library and its protocol).

---

## 1. Why

Every run REX makes thinks as hard as the CLI's default says. The reviewer cannot
see that level, and cannot change it.

The reviewer's words, 2026-10-17, after a run that failed on credit:

> It should use model Sonnet 5.5 with medium thinking to save some money.

The run behind that sentence is the case. One ASK on `default`, which the CLI
resolved to `claude-opus-5`, with thinking on at the CLI's own level. It made 23
model calls, each reading 46 000 to 95 000 cached tokens, and reported $1.19
before the account ran dry. The question was "redraw this section's diagram".
That is not work that needs the deepest reasoning the most expensive model can
do.

Spec 25 §9 saw this coming: *"`ModelInfo` carries `supportsEffort` and the
levels … It gets its own spec if it is wanted."* It is wanted now.

### 1.1 Effort, not a thinking budget

The SDK has two knobs and they are not the same thing.

| Option | What it does |
|:--|:--|
| `thinking` | on, off, or a token budget. `adaptive` lets the model decide how much to think |
| `effort` | `low` … `max`. **Guides how deeply adaptive thinking goes**, and also how much the model does around it |

Every model the account offers today except Haiku 4.5 says
`supportsAdaptiveThinking: true` (§3). So "medium thinking" is `effort: "medium"` with `thinking` left alone. A
token budget is a number nobody can choose well; a level is a word the reviewer
already used.

---

## 2. The rule

1. **Effort is a property of a send, like the model.** It is an argument, it is
   recorded on every message the run produces, and the answer says so.
2. **The levels come from the model row the CLI offered.** REX holds no list of
   which model takes which level.
3. **One default, set together with the model.** *Use as default* saves both.

### 2.1 What this changes in the earlier specs

| Spec | Section | Change |
|:--|:--|:--|
| 25 | §6.3 | `ModelChoice` gains `effortLevels`. The levels now reach the renderer, because the picker needs them; the fast-mode flags still do not |
| 25 | §9 | The *Effort levels* row is this spec |
| 42 | §5 | `RunRequest.effort: str \| None`; `ModelChoice.effort_levels: list[str]` |
| 43 | §4.0 | A fourth setting, `setting.agent.effort`. *Use as default* writes the panel's model and effort (§6.1) |
| 43 | §4.1 | The cascade gains a row: changing the **model** re-checks the effort (§6.2) |
| 37 | §2 | The send row grows one control, between the model and the style |

---

## 3. The levels come from the CLI

The CLI's initialize response already carries them, on every model row. The
promptless probe (spec 42 §9.4) reads that response today and throws these
fields away in `name_models`.

Measured 2026-10-17, on the reviewer's Max login:

| `value` | Name | `supportedEffortLevels` |
|:--|:--|:--|
| `sonnet` | Sonnet 5.5 | `low` `medium` `high` `xhigh` `max` |
| `haiku` | Haiku 5.5 | `low` `medium` `high` `xhigh` `max` |
| `claude-opus-5` | Opus 5 | `low` `medium` `high` `xhigh` `max` |
| `claude-opus-4-6` | Opus 4.6 | `low` `medium` `high` `max` |
| `claude-haiku-4-5-20251001` | Haiku 4.5 | *none* — `supportsEffort` is null |

The last two rows are why REX must ask and not assume. Opus 4.6 has no `xhigh`,
and Haiku 4.5 takes no level at all.

### 3.1 `default` is said by saying nothing

`default` is the first row of the menu, and it means "REX says nothing, so the
CLI decides". REX records `default` and never sends it — spec 25 §13.3's rule
for the model, applied to one more field.

**The CLI's decision differs per model, and the menu names it** (1.2). The
reviewer's report of 2026-10-17: *"you are showing me 'default effort' but I
don't know what the default effort is."* The probe asks the CLI for each model's
own level and the row reads `Default effort (Medium)`.

The CLI reports that level only through its `get_settings` control request, as
`applied.effort`, after `set_model`. Measured 2026-10-17 on the Max login, with
the run's own `setting_sources=["project"]`:

| Model | Own level |
|:--|:--|
| `default` (Fable 5.1), Fable 5.1, Opus 5, Opus 4.8, Opus 4.6 | `high` |
| Opus 5.5, Sonnet 5.5, Haiku 5.5 | `medium` |
| Opus 4.7 | `xhigh` |
| Haiku 4.5 | none |

Three rules hold it honest:

- **The probe loads the run's settings sources** (`SETTING_SOURCES`, shared by
  both). Loading the SDK's default `["user", "project"]` read the reviewer's
  `~/.claude/settings.json` and reported `xhigh` for Fable 5.1, a level no run
  uses.
- **It is the one private SDK call in the library.** The TypeScript SDK wraps the
  request as `getSettings()`; the Python SDK 0.2.168 does not, so `own_levels`
  sends it through `client._query`. The reviewer allowed it on 2026-10-17
  because a failure costs only a label: an error or the 8 s budget returns what
  was learned so far, and the row reads `Default effort`. Swap it for the public
  call when the Python SDK gains one.
- A document repository's own `.claude/settings.json` can set `effortLevel`.
  The probe does not run there, so the label is the model's level, not that
  repository's.

It costs about 0.3 s a model, on top of the probe, and spends no tokens.

### 3.2 A gateway with a URL gets no effort control

A routed gateway's models are strings a person typed (spec 43 §4.3). Nothing
says which levels they take. And whether a gateway's engine accepts the effort
field at all is **unmeasured**. A refusal would come back as a 400 inside a turn
the reviewer has already started — the same class of failure as spec 43 §15's
beta headers.

So in this spec, a route with a URL reports no levels, and the control is not
drawn. §9 says what it would take to change that.

---

## 4. What a send carries

`SendChoices` gains one field: `effort: string | null`. Every send channel
already carries `SendChoices`, so no channel changes shape.

| Value | Meaning |
|:--|:--|
| `null` | nothing recorded. A NOTE, and every send made before this spec |
| `default` | the reviewer chose the CLI's own level. Recorded, never sent |
| a level | sent as `ClaudeAgentOptions.effort` |

Main passes it into `RunRequest.effort`. The Claude adapter sets
`options.effort` only for a level. The other three adapters ignore the field in
this spec, and their probes report no levels, so the control is never drawn for
them.

---

## 5. What is recorded

`message.effort TEXT` — the level this row ran under, as the reviewer picked it.
The same rows as spec 25 §5: the reviewer's send and everything its run
produced. `NULL` for a NOTE and for every row written before this spec.

**The requested level, not the one in effect.** The CLI can lower a level for a
model that does not take it, and it reports the result in a hook's
`effort.level`. REX keeps the reviewer's word for spec 25 §5.1's reason: the
record has to say what was chosen, and a stored downgrade would read as a choice
nobody made.

The migration is `migrateMessageEffort`: one guarded
`ALTER TABLE message ADD COLUMN effort TEXT`, beside `migrateMessageModel`.

---

## 6. The default

`setting.agent.effort` holds the level a new comment starts on. Absent means
`default`.

> **Superseded by spec 60 §3** (2026-10-17): the level is per agent, in
> `agent.<sdk>.effort`, and Claude ships at `medium`. The rest of this section
> holds for each agent's own key.

The effort lives as long as the model pick does. A level the reviewer picks on a
comment holds for that comment until REX restarts; a comment with no pick follows
`setting.agent.effort`. So changing the default moves every comment that never
had a level picked, which is what the reviewer means by a default.

### 6.1 *Use as default* saves the panel's model and effort

*Use as default* in `Manage gateways…` writes `agent.sdk`, `agent.gateway` and
`agent.model`. For the model it writes the gateway's **stored** default —
`choicesFor(panelSdk, gatewayId).chosen` (`App.tsx:5478`) — and not the model
the reviewer picked in the panel. So today a model picked in the panel never
becomes the default, and there is no other way left to set one: spec 25 §7.2's
top-bar picker was removed on 2026-09-04, on the reviewer's ask, with this
button named as its replacement (`TopBar.tsx:321`).

This spec fixes that on the way, because it is the same click. *Use as default*
saves what the panel shows: its model (`selectionModel`, or the stored default
when the panel follows it) and its effort. That is what spec 44 §3 already says
for the agent: *"the row the reviewer has set there, not the row that was
already stored."*

The button stays pressable on the gateway that already is the default. Before,
it was disabled there, so the one gateway most reviewers use could never take a
new model or level.

So the reviewer's ask is three actions: pick **Sonnet 5.5** and **Medium** in the
panel, open the gateway sheet (Settings → *Other gateways* → *Add*, or *Manage*
once one exists), and press *Use as default* on `Original`.

### 6.2 When the model changes

Changing the model re-checks the effort against the new row's levels:

| The new model | Effect |
|:--|:--|
| takes the current level | nothing moves |
| takes levels, but not this one | the control shows `Default effort` and its tooltip says why. The pick is kept, so it comes back on a model that takes it |
| takes no level | the control is drawn dim, and the send carries `null` |

`default` and not "the nearest level", because `default` is the one value that
is always right — it is the CLI's own choice for that model. A nearest level is
a guess about what the reviewer would have wanted.

A stored default the default model cannot take resolves the same way, and the
stored row is kept (spec 25 §6.2).

---

## 7. What the reviewer sees

### 7.1 The send row

One control, between the model and the style:

```text
 ASK  ACT  NOTE  ⇧⇥     Original   Sonnet 5.5   Medium   default   Ask about 3
```

- The button reads the level: `Low`, `Medium`, `High`, `Extra high`, `Max`. The
  `default` row reads `Default effort (Medium)`, naming the model's own level
  (§3.1), so it cannot be taken for the model's `Default` beside it. With no
  level known it reads `Default effort`, and nothing is guessed.
- **Every "default" says what it is** (1.2). The model menu's first row, REX's
  own default, reads `Default (Sonnet 5.5)`. The CLI's own `default` row reads
  `Recommended (Fable 5.1)`, from its `resolvedModel`, and the probe re-reads
  it on every start, so the name moves when the CLI's choice does. When REX's
  default is that row, the first row reads `Default (Fable 5.1, recommended)`.
- The menu is `ModelPick`, like its neighbours: one row per level the model
  takes, a tick beside the current one.
- Each row has a one-line tooltip. These are REX's words, because the CLI gives
  the levels no description:

| Row | Tooltip |
|:--|:--|
| Default effort | The level this model runs at when REX asks for none |
| Low | The least thinking. Fastest and cheapest |
| Medium | Moderate thinking |
| High | Deep reasoning |
| Extra high | Deeper than High, where the model takes it |
| Max | The most the model can do. Slowest and most expensive |

- Dim in NOTE mode, with the reason as the tooltip, like every control in the row.

### 7.2 The answer says which level wrote it

The foot carries the level after the model, only when a level was chosen:

```text
Sonnet 5.5 · medium · 5 turns · 4.9s · $0.219
```

`default` draws nothing. It is the absence of a choice, and saying "default" on
every answer would be noise in a line that exists to say what was different.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `agent-runner/src/agent_runner/types.py` | `RunRequest.effort`; `ModelChoice.effort_levels` |
| `agent-runner/src/agent_runner/adapters/claude/models.py` | `name_models` keeps `supportedEffortLevels`. A gateway route's rows get none (§3.2) |
| `agent-runner/src/agent_runner/adapters/claude/adapter.py` | `options.effort` for a level; nothing for `default` or `null` |
| `src/shared/agent-protocol.ts` | regenerated by `uv run python -m agent_runner.protocol --schema`, never by hand |
| `src/shared/types.ts` | `effort` on `SendChoices` and `Message`; `effortLevels` on `ModelChoice`; `DEFAULT_EFFORT` |
| `src/main/db/schema.sql`, `src/main/db/migrate.ts` | `message.effort`; `migrateMessageEffort` |
| `src/main/db/settings.ts` | `AGENT_EFFORT_KEY`; the default resolved against the default model's levels (§6.2) |
| `src/main/db/queries.ts` | `effort` on `MessageDraft`, the insert, and `Message` |
| `src/main/agent/bridge.ts` | `effort` into `RunRequest`, beside `model` |
| `src/main/ipc.ts` | `effort` threaded where `style` is; `gatewayDefault` takes and writes it |
| `src/main/debug.ts` | the report's `RUN` block gains an `effort` line, beside `model` |
| `src/renderer/overlay/Composer.tsx` | the control (§7.1) |
| `src/renderer/overlay/App.tsx` | `effortByThread`, mirroring `modelByThread`; the cascade (§6.2); *Use as default* sends the panel's model and effort (§6.1) |
| `src/renderer/overlay/AnswerFoot.tsx` | the level after the model (§7.2) |
| `agent-runner/tests/`, `test/models.spec.ts`, `test/bridge.spec.ts` | §10 |

---

## 9. What this does not do

| Not doing | Why |
|:--|:--|
| **A thinking budget, or thinking off** | §1.1. A budget is a number nobody chooses well, and every model offered today thinks adaptively. Effort is the knob that was asked for |
| **Effort for Codex** | Codex has `model_reasoning_effort` (the samples spec 44 §5 cites), with its own vocabulary. The field is generic so that a later spec can add it with no protocol change. Not asked for yet |
| **Effort for OpenCode and Deep Agents** | Neither SDK has been checked for a level. Their probes report none, so the control is not drawn |
| **Effort through a gateway with a URL** | §3.2. Unmeasured, and the failure lands inside a paid turn. It needs a milestone that sends one level through LiteLLM and Envoy and reads what reached the engine |
| **A different effort for ASK and for ACT** | Spec 25 §9's argument for the model: it doubles the control to save one click |
| **Fast mode** | Another flag in the same row, and nobody asked for it |
| **A cost estimate per level** | Spec 25 §9. The foot already prints what was spent, exactly, after the fact |

---

## 10. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| **0** | The library knows the levels | `npm run test:library` green. The probe's rows carry the levels against the real CLI and spend nothing. A gateway route's rows carry none. A level sets `options.effort`; `default` and `null` set nothing |
| **1** | A level reaches the CLI | One ASK on Sonnet 5.5 at Medium. Proved from the CLI, not from REX's record: the top-level `effort` on the CLI transcript's `assistant` line reads `medium` (a hook fires only on a tool call, and a short ASK makes none). Then a reply at Low in the same comment reads `low` — §11 |
| **2** | The surfaces | The control, the dim in NOTE, the cascade of §6.2 (Opus 4.6 drops `xhigh`, Haiku 4.5 goes dim), the foot of §7.2, and *Use as default* saving the panel's model and effort |
| **3** | The live run | §10.1 |

### 10.1 How milestone 3 is checked

In an isolated REX (`REX_DB_PATH`, `REX_CDP_PORT=9444`) unless the agent window
on 9334 carries `pw-agent`, per `rules/06-testing.md`. On
`documentation-sample/one/sample-document.md`.

1. Pick **Sonnet 5.5** and **Medium** in the panel. Press *Use as default* on
   `Original`. Done when a new comment starts on Sonnet 5.5 and Medium.
2. ASK. Done when the foot reads `Sonnet 5.5 · medium · …` and the CLI
   transcript's `effort` reads `medium`.
3. Restart. Done when a new comment still starts on Sonnet 5.5 and Medium.
4. Switch the model to Haiku 4.5. Done when the effort control is dim and the
   row's `effort` is `NULL`.
5. Done when `git status --porcelain` in `documentation-sample` is empty — an
   ASK writes nothing (`SPEC.md` §8.4).

---

## 11. The one risk

**A comment resumes one SDK session across turns.** Spec 25 §11 proved that a
resumed session takes a different model on a later turn. Nobody has proved it
for effort. If it fails, it fails quietly: the second turn runs at the first
turn's level while REX records the new one, and nothing shows an error.

Milestone 1's second step is that proof, read from the CLI and not from REX.
**Proved 2026-10-17:** one session, turn 1 `medium`, turn 2 `low`, both on
`claude-sonnet-5-5`.

---

## 12. Rejected

| Rejected | Why |
|:--|:--|
| **A hardcoded table of levels per model** | §3. Opus 4.6 and Haiku 4.5 already differ from the rest, and the next model will differ again. Spec 25 §3.1's argument, applied to levels |
| **Falling back to the nearest level** | §6.2. It guesses what the reviewer wanted; `default` is always correct |
| **Recording the level in effect** | §5. It records a downgrade as if it were a choice |
| **Sending `default` as a value** | §3.1. It would be REX asserting a level it does not mean |
| **A setting under the model's own default (`model.default`)** | Effort belongs with the model a new comment starts on, and that is spec 43 §4.0's `agent.*` group |
| **Folding effort into the model menu** (`Sonnet 5.5 · Medium`) | Five models times five levels is twenty-five rows, and the two choices change for different reasons |
