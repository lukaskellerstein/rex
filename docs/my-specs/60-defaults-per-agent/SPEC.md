# REX 60 — defaults per agent

**Version:** 1.0 · 2026-10-17
**Status:** **built, milestones 0–3** (2026-10-17). §6's table was measured on
this machine against `openai-codex` 0.147.0 on the reviewer's ChatGPT login.
§7 is not built, by design. One deviation from §5's sketch: *Agents* is the
second section, after *Gateways*, because spec 46 keeps Gateways first and its
lists are the default gateway's.
**Amends:** [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
§6 (`model.default`); [`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md)
§4.0 (`agent.model`) and §4.1 (a routed gateway starts on its first model);
[`44-the-codex-agent/SPEC.md`](../44-the-codex-agent/SPEC.md) §7 (Codex probes nothing);
[`58-choosing-the-effort/SPEC.md`](../58-choosing-the-effort/SPEC.md) §6
(`agent.effort`).
**Depends on:** spec 58 (the effort control and each model's own level).

---

## 1. Why

The reviewer, 2026-10-17: *"I'm not sure from where we got the recommended or
the default one … we should be fine with having Sonnet 5.5 as the default one.
The default effort should be medium. … Just think about the other options and
other coding agents as well, such as Codex, Open Code, and Deep Agents."*

Three facts make that ask a spec and not a setting:

1. **REX ships no default of its own.** With nothing stored, a comment asks for
   the model `default`, and the CLI picks. Claude Code's `default` row is
   Anthropic's choice for the account: Fable 5.1 at `high` on the reviewer's Max
   login today, and Opus 5 at `high` on the day of the credit error that started
   spec 58.
2. **REX stores one default for four agents.** `model.default` (spec 25) and
   `agent.model` (spec 43) are each one value. A Claude alias means nothing to
   Codex, so a default set for one agent is silently the CLI's own on the
   others.
3. **Nothing in Settings sets a default.** The one writer is *Use as default*,
   three clicks deep in the gateway sheet (spec 58 §6.1).

---

## 2. The rule

**Each agent has its own default model and its own default effort. REX ships one
for Claude, and the reviewer sets every agent's on Settings → Agents.**

| Agent | Ships with | Why |
|:--|:--|:--|
| Claude | `sonnet` (Sonnet 5.5) at `medium` | the reviewer's choice, 2026-10-17 |
| Codex | the CLI's own default | REX has no opinion to ship for that vendor |
| OpenCode | the route's first model | a route's models are typed (spec 43 §4.3) |
| Deep Agents | the route's first model | the same |

`sonnet` and not `claude-sonnet-5-5`: the CLI's list offers the alias and not
the pinned id, and a stored default is checked against that list (§4). The alias
moves to the next Sonnet when Anthropic ships one. The menu then reads
`Default (Sonnet 6)` (spec 58 §7.1), so the move is visible.

A comment that was already sent keeps what it was sent on. Only a new comment
reads the defaults, as before (spec 58 §6).

---

## 3. What is stored

| Key | Holds |
|:--|:--|
| `agent.sdk` | the agent a new comment starts on (spec 44, unchanged) |
| `agent.gateway` | the gateway a new comment starts on (spec 43, unchanged) |
| `agent.<sdk>.model` | that agent's default model, for example `agent.claude-agent.model` |
| `agent.<sdk>.effort` | that agent's default effort |

**Absent means the shipped default of §2.**

### 3.1 The migration

Once, at start, in `migrate.ts`:

1. `agent.model`, or else `model.default`, moves to
   `agent.<agent.sdk or claude-agent>.model`.
2. `agent.effort` moves to `agent.<agent.sdk or claude-agent>.effort`.
3. The three old keys are deleted, so no reader can find two answers.

A key already present under the new name wins: the migration never overwrites.

---

## 4. How a default resolves

`modelList(gateway, sdk)` answers `chosen` and, new, `effort`:

| Field | Resolves to |
|:--|:--|
| `chosen` | the stored model if the list offers it → the shipped model if the list offers it → `default` on `Original`, the first model on a routed gateway |
| `effort` | the stored effort → the shipped effort → `default` |

- **A stored model the list does not offer falls back, and the stored row is
  kept** — spec 25 §6.2's rule, now per agent.
- **A routed gateway now honours a stored model** when its typed list holds it.
  Spec 43 §4.1 started every routed gateway on its first model; that rule stays
  only as the fallback.
- **The effort is not checked here.** Which levels exist depends on the model,
  and spec 58 §6.2's cascade in the renderer already checks it.

The renderer's `defaultEffort` becomes per agent: a comment with no level picked
follows `choicesFor(sdk, gateway).effort`.

---

## 5. Settings → Agents

A third page, between *Gateways* and *Models*. One row per agent REX has an
adapter for (`descriptor.sdks`):

```text
 Claude Agent SDK      Sonnet 5.5 ⌄        Default effort (Medium) ⌄   Medium ⌄
 Codex                 Recommended (GPT-5.6-Sol) ⌄   Low ⌄
 OpenCode              qwen3-coder ⌄
 Deep Agents           gpt-oss-120b ⌄
```

- **The model menu** is the agent's list on the default gateway — the same list a
  new comment starts from. It has no `Default (…)` row, because this row *is*
  the default.
- **The effort menu** is spec 58's `EffortPick`, for the model beside it. An
  agent whose models take no level draws none.
- **A pick saves at once**, like every other control on the Settings page. The
  card's foot says what it does: *"A new comment starts on these. A comment
  already sent keeps its own."*
- *Use as default* in the gateway sheet writes the same keys: `agent.sdk`,
  `agent.gateway`, and that agent's model and effort.

---

## 6. Codex gets a model list and an effort

Spec 44 §7 probed nothing, because Codex had "no gateway-independent catalogue
to ask for". It has one: `AsyncCodex.models()`, public, answering in 210 ms with
no tokens spent. Measured 2026-10-17 on the reviewer's login:

| `id` | `isDefault` | `defaultReasoningEffort` | `supportedReasoningEfforts` |
|:--|:--|:--|:--|
| `gpt-5.6-sol` | yes | `low` | `low` `medium` `high` `xhigh` `max` `ultra` |
| `gpt-5.6-terra` | | `medium` | `low` `medium` `high` `xhigh` `max` `ultra` |
| `gpt-5.6-luna` | | `medium` | `low` `medium` `high` `xhigh` `max` |

- **`Original` is probed**; a routed gateway is not, because its models are typed
  (spec 43 §4.3) and the levels of a gateway's engine are unmeasured (spec 58
  §3.2).
- The rows become spec 58's `ModelChoice`: `effortLevels` from
  `supportedReasoningEfforts`, `defaultEffort` from `defaultReasoningEffort`.
  The `default` row comes first, named `Recommended (GPT-5.6-Sol)` from the row
  marked `isDefault`, so the two agents' menus read alike.
- **A failed probe leaves the one `Default` row** it offers today, with the
  reason, and nothing else changes.
- **The run passes the level** as `thread.turn(prompt, effort=…)`. `default`
  and none pass nothing (spec 58 §3.1). The SDK's `ReasoningEffort` enum lists
  `none` to `xhigh`, but it accepts any string, so `max` and `ultra` pass as the
  CLI offered them.

---

## 7. OpenCode and Deep Agents — effort waits for a measurement

Both get a default model now, through §3 and §5. Neither gets an effort control
until a live run proves the field:

- **OpenCode** calls its effort a *variant*: `opencode run --variant high`,
  provider-specific. REX drives OpenCode's server, and which request field
  carries the variant there is unmeasured.
- **Deep Agents** sets effort per LangChain provider class (`reasoning_effort` on
  `ChatOpenAI`, a thinking budget on `ChatAnthropic`), and a gateway's engine may
  refuse either.

A wrong field fails inside a turn the reviewer has already started, which is the
failure spec 58 §3.2 already refused. Each gets its own section in a later
version of this spec, after its measurement.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `src/main/db/settings.ts` | `agentModelKey(sdk)`, `agentEffortKey(sdk)`, `SHIPPED_DEFAULTS`, `agentModel()` replaces `defaultModel()`; `agentDefaults()` loses `model` and `effort` |
| `src/main/db/migrate.ts` | `migrateAgentDefaults` (§3.1) |
| `src/main/ipc.ts` | `modelList` answers `chosen` and `effort` per agent (§4); `gatewayDefault` writes the per-agent keys; new `agentDefault` writer for §5 |
| `src/shared/types.ts`, `channels.ts` | `AgentChoices.effort`; the `agentDefault` channel; `GatewayListResponse.defaults` loses `model` and `effort` |
| `src/renderer/overlay/App.tsx` | the per-agent effort default; Settings wiring |
| `src/renderer/overlay/SettingsAgents.tsx` | new — §5 |
| `src/renderer/overlay/Settings.tsx` | the third tab |
| `src/renderer/overlay/modelChoices.ts` | names for Codex's extra levels (`minimal`, `none`, `ultra`) |
| `agent-runner/.../codex/adapter.py` | the probe and the `effort` argument (§6) |

---

## 9. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| **0** | Defaults per agent | Tests: the migration moves each old key once and never overwrites; with nothing stored, Claude resolves to `sonnet` and `medium`; a stored model a list lacks falls back and stays stored; a routed list holding the stored model starts on it |
| **1** | Settings → Agents | A pick on the page is the next new comment's start, for that agent only; *Use as default* writes the same keys |
| **2** | Codex | The probe returns §6's rows; a Codex ASK at `medium` is recorded `medium` and the Codex CLI's own record shows `medium` |
| **3** | The live run | In an isolated REX on an empty database, a new comment starts on Sonnet 5.5 and `Default effort (Medium)`… §9.1 |

**Proved 2026-10-17**, on an empty database: a new comment started on Claude,
Sonnet 5.5 and Medium; Settings → Agents set Codex to GPT-5.6-Terra at High and
stored only `agent.codex.*`; a new comment switched to Codex started on Terra and
High. The Codex ASK was recorded `high`, and Codex's own session record read
`"model":"gpt-5.6-terra","effort":"high"`. The Claude ASK was recorded `medium`,
and the CLI transcript read `claude-sonnet-5-5` at `medium`.
`documentation-sample` gained no change.

### 9.1 How milestone 3 is checked

In an isolated REX (`REX_DB_PATH`, `REX_CDP_PORT=9444`), on
`documentation-sample/one/sample-document.md`:

1. Empty database. Done when a new comment starts on Claude, Sonnet 5.5 and
   Medium, with nothing picked.
2. Settings → Agents: set Codex to GPT-5.6-Terra at High. Done when a new comment
   switched to Codex starts on Terra and High, and Claude's row is unchanged.
3. One ASK on each agent. Done when each answer's foot names its model and level.
4. Done when `git status --porcelain` in `documentation-sample` shows nothing new
   — an ASK writes nothing (`SPEC.md` §8.4).

---

## 10. Rejected

| Rejected | Why |
|:--|:--|
| One default for every agent (today) | a model id is one vendor's; Codex cannot run `sonnet` |
| Ship Medium for every agent | REX has no opinion about other vendors' models, and a level a route's model does not take falls back anyway |
| Store `claude-sonnet-5-5` | the CLI does not list the pinned id, so it would fall back to `default` at once |
| A default per agent **and** per gateway | four agents times every gateway is a grid nobody keeps; a routed gateway that lacks the agent's model already falls back to its first |
| Effort for OpenCode and Deep Agents now | unmeasured fields fail inside a paid turn (§7) |
