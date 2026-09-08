# REX 44 — the Codex agent

**Amended by [spec 50](../50-macos-completely/SPEC.md):** §9.3's platform gate is gone. It made Codex ACT a claim only macOS had earned, and REX is now macOS only, so there is nothing left for it to exclude. `ACT_PROVED` no longer exists.

**Version:** 3.1 · 2026-09-05
**Status:** **built.** Milestones 0, 1 and 2 all passed on
2026-09-04; §10.0 records what the SDK actually does, including four places
where §5, §6 and §8 guessed wrong and are corrected there rather than rewritten
here.
**Depends on:** [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
— the seam: the service and its pipe, `AgentAdapter`, `RunRequest`,
`AgentEvent`, the policy round trip, `AgentSession`, the descriptor;
[`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md) — the gateway
rows, the controls, the session model, the child environment.
**Also:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §8 (one thread, one agent,
one session); [`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §6 (the
gate); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md) §2
(cancellation); [`22-the-whole-workspace/SPEC.md`](../22-the-whole-workspace/SPEC.md)
§3 (working copies); [`38-the-trace-block/SPEC.md`](../38-the-trace-block/SPEC.md)
(the transcript).

> [!note]
> **The local path exists.** Responses is what the Codex SDK speaks, and §10
> records two working Responses endpoints on this machine — LiteLLM and the
> model engine itself — with a third, Envoy, registered in source. A Codex
> route against the reviewer's local Gemma is buildable today.
>
> **What changed in 3.0.** The reviewer chose Python for the library on
> 2026-09-04 — "ok, let's go with python" — so the adapter is
> `agent-runner/src/agent_runner/adapters/codex/`, on the official Python SDK
> **`openai-codex`** (PyPI 0.147.0), not `@openai/codex-sdk`. The reviewer's
> own Python samples in `vibe-coding-course/03_Codex_SDK/python/` now apply
> directly, and §10.1 lists what they confirm. Version 2.0 had renumbered this
> spec from 43 to 44, dropped MLflow, moved the adapter into a TypeScript
> library and put the **agent control** on screen (§3); all of that stands
> except the language.

---

## 1. Why

Spec 42 built the seam: one `AgentAdapter` behind one `run`, a general
`AgentEvent`, a policy the host answers over the pipe, and a rule that an
`AgentSdk` value with no adapter is refused by name (spec 42 §5.1). Spec 43
built the gateway rows with a route per SDK, one child environment per run, and
one session per (thread, SDK, gateway). This spec fills in `codex`.

Nothing in the schema changes. `AgentSdk` already carries `'codex'` (spec 42
§5.1), `gateway_route.sdk` already allows it (spec 43 §2.2), and `Original`
already has a `codex` row (spec 43 §12). What this spec adds is one adapter
directory in the library, one Python dependency, one control on screen, and
the proofs that its ASK cannot write.

---

## 2. What changes in specs 42 and 43

Three lines were planned:

1. `run.py`'s adapter map (spec 42 §6.1) gains a `codex` entry, so `list_sdks()`
   (spec 42 §10) returns two SDKs.
2. The gateway sheet's greyed Codex row (spec 43 §4.5) becomes editable, and a
   gateway can hold a `codex` route.
3. The composer gains the agent control (§3).

**Building it needed two more, and both are additions to spec 42's contract.**
Recorded here rather than folded in silently, because a spec that says "three
lines" and cost five is a spec nobody can plan the next one from:

- **`RunRequest` gains `writable: list[str]`** — the directories a run may
  change, named for intent rather than for a sandbox. §9.3 has to say the
  boundary to the library, and spec 42 §6 had no field that could carry it. The
  Claude adapter ignores it and nothing about a Claude run moves, which is the
  test of whether the name was chosen well.
- **`SdkDescriptor` gains `supports_plugins`**, beside the `supports_styles` it
  already had. §7 says `bridge.ts` passes no plugin paths to Codex — and a host
  that builds a plugin list per run has to know *before* the run whether to
  build one. Without it every Codex ASK was refused by the library for a list
  REX should never have made (§10.0.2).

The URL field's meaning changes with the SDK, and the route editor says so:

> **Responses API base.** This often ends in `/v1`, and the server must serve
> `/responses`. An OpenAI Chat Completions endpoint is not enough.

That sentence is the whole difference between this spec's route and spec 43's.
§10 names the URLs on this machine that satisfy it.

| Agent SDK | Needed gateway surface | REX configuration |
|:--|:--|:--|
| Claude Agent SDK | Anthropic Messages | `ANTHROPIC_BASE_URL` (spec 43 §6.3) |
| Codex SDK | OpenAI **Responses** | a custom `model_provider` with `wire_api = "responses"` (§5) |

---

## 3. The agent control

Spec 43 §4 drew the composer with two controls and promised a third to the
left of them when a second SDK existed. This is that moment:

```text
[ Claude  ▾ ]  [ Original ▾ ]  [ Fable 5.1 ▾ ]  [ Style: default ▾ ]     ASK  ACT
    agent          gateway            model            Claude only
```

The agent list is `list_sdks()` from spec 42 §10, delivered over the pipe's
`describe` reply, which returns only SDKs that have an adapter — after this
spec, `Claude Agent SDK` and `Codex SDK`. The control names no SDK in REX's
source: the labels are the descriptor's.

The cascade gains the row spec 43 §4.1 left for it:

| Changed | Effect |
|:--|:--|
| **agent** | the gateway list keeps only gateways with a route for that SDK; the model list is rebuilt; the style control appears only for `claude-agent` |
| **gateway** | the model list is rebuilt from that route |
| **model** | nothing else moves |

Four consequences, each already specified and first exercised here:

- `setting.agent.sdk` (spec 43 §4.0) is now written by *Use as default*, and a
  new comment starts on it. A sent comment starts on the SDK of its newest
  non-NOTE message, exactly as it does for gateway and model.
- A gateway with no `codex` route stays in the list, greyed, with the reason on
  hover — spec 43 §4.2's rule, and this is where it first bites: `Original` has
  a `codex` row from the migration, but a LiteLLM gateway added before this
  spec has only a Claude route until the reviewer fills the Codex one.
- Switching a comment from Claude to Codex starts a fresh session for
  `(thread, 'codex', gateway)` and seeds it with the conversation so far —
  spec 43 §5.2 case 3 — and the composer says so once.
- The answer's foot names the agent beside the gateway and the model. The
  per-thread debug report's `agent :` line (spec 43 §9) already has the field.

Impossible combinations are shown, not hidden. Hiding a greyed gateway would
make a missing route look like a missing feature.

The control is renderer code, TypeScript, and unchanged by the language of the
library: it draws what `describe` returns.

---

## 4. The dependency

The library adds **`openai-codex`** (module `openai_codex`) to
`agent-runner/pyproject.toml`, imported **only** from
`agent-runner/src/agent_runner/adapters/codex/` — spec 42 §2 rule 2,
enforced by `test_boundary.py`. It is a programmatic wrapper around a Codex CLI
child process, which it pulls in through `openai-codex-cli-bin`, so it carries
the same shape as the Claude Agent SDK: the library does not speak HTTP to the
model, the child does.

The service is an `asyncio` loop (spec 42 §4.1), so the adapter uses
**`AsyncCodex`** and never the synchronous `Codex`. A blocking `thread.run()`
would stall every other run on the pipe.

The adapter streams with `turn.stream()`, never `thread.run()` alone. A
completed `run()` cannot fill the trace block while work is happening, and spec
38's trace is not a log written afterwards — it is what the reviewer watches.

> [!important]
> Every symbol below is written from the Codex documentation and the reviewer's
> own Python samples (§10.1) and must be checked against the pinned SDK before
> it is used. `SPEC.md` §0's standing rule applies: the names in a spec are a
> description of intent, not a verified signature. The Python SDK's names
> differ from the TypeScript ones — `thread_start` for `startThread`,
> `Sandbox.read_only` for `"read-only"`, `ApprovalMode.deny_all` for
> `"never"` — and the Python README carries a TS↔Python table for anyone
> porting.

The adapter directory:

```text
agent-runner/src/agent_runner/adapters/codex/
├── adapter.py     the AsyncCodex client, thread lifecycle, child environment, cancellation
├── events.py      Codex items → AgentEvent (§8)
└── tools.py       Codex item types → CommonTool (§9.1)
```

The executable: `CodexConfig(codex_bin=...)` names the CLI, and the samples
read it from `CODEX_EXECUTABLE` (`helpers.py:26-29`). The library takes the
path from the host as part of the route's run input, the way spec 47 §2.1 does
for OpenCode; when none is given, `CodexConfig()` lets the SDK resolve its own
bundled binary.

---

## 5. A custom provider, not only a base URL

The Codex CLI's built-in OpenAI provider can be pointed at a proxy, but that
describes an authenticated OpenAI-compatible host and does not describe an
unauthenticated local provider. For every explicit URL, the adapter defines a
custom provider in the CLI's own `config.toml` vocabulary and passes it through
the SDK's structured config:

```python
config = {
    "model_provider": "rex",
    "model_providers": {
        "rex": {
            "name": route.gateway_name,
            "base_url": route.base_url,
            "wire_api": "responses",
            "supports_websockets": False,
            **({"requires_openai_auth": True} if route.auth == "inherit" else {}),
            **({"env_key": "REX_AGENT_TOKEN"} if route.auth == "environment" else {}),
        },
    },
}
```

The provider id is a constant, because the config is built per run and never
shared: each `AsyncCodex` instance sees exactly one provider. A
`ResolvedRoute` carries the gateway's name, not its id (spec 42 §5.3), and
nothing here needs one. `supports_websockets: False` picks the broadly
implemented SSE path.

> [!warning]
> **Where this config goes is unexercised by the samples.** They pass structured
> config in two places — `thread_start(config={"model_reasoning_effort": …})`
> (`2_thread_with_options.py:30-41`) and `thread_start(config={"mcp_servers":
> …})` (`6_mcp_tools.py:81`) — but never a `model_provider`, and never a
> `CodexConfig` field beyond `codex_bin`. Milestone 0 records which of
> `CodexConfig(...)` and `thread_start(config=...)` carries `model_providers`
> at the pinned version.

The three authentication choices map cleanly, and the two flags are **never**
set together:

| Route auth | `requires_openai_auth` | `env_key` | Child environment |
|:--|:--|:--|:--|
| SDK / account default | `True` | absent | unchanged credentials |
| Environment variable | absent | `REX_AGENT_TOKEN` | `REX_AGENT_TOKEN` holds `route.token` |
| No authentication | absent | absent | no credential at all |

A route with no URL uses Codex's built-in provider. `inherit` leaves its normal
authentication alone — the Codex CLI's own ChatGPT login, or `OPENAI_API_KEY`
if that is what the reviewer has set. The samples document
`codex.login_api_key("sk-…")` and `codex.login_chatgpt()` (`README.md:29-35`)
and never call either; REX never calls either. The adapter passes the chosen
model at thread creation either way.

### 5.1 The child environment, in Python

Spec 43 §6.2's rule stands: no adapter touches the process environment. In the
service that means **`os.environ` is never assigned**, because one Python
process serves every run at once, and a global assignment would route one
comment's credential into another comment's child.

The TypeScript SDK exposes a per-client `env`. Whether `CodexConfig` or
`thread_start` accepts one is unknown, and milestone 0 records it. Three
outcomes, in order of preference:

1. **The SDK takes a per-child environment.** The adapter builds it by spec 43
   §6.2's rule — the defined string values of the service's environment, with
   only `REX_AGENT_TOKEN` added — and passes it. `route.token` lives there and
   nowhere else: never in the config dict, a log, or a command line.
2. **The SDK exposes a spawn hook** but no `env`. The adapter sets the variable
   in the hook, for that child only, and still never in `os.environ`.
3. **Neither exists.** The `environment` auth is refused for Codex before
   anything spawns, with one sentence: "The Codex SDK cannot be given a
   per-run credential; use No authentication or SDK / account default." A
   route the reviewer can configure and cannot run is worse than a refusal.

---

## 6. Threads, sessions and profiles

```python
thread = await codex.thread_start(
    model=request.model,
    sandbox=Sandbox.read_only if "write" in request.disallowed else Sandbox.workspace_write,
    approval_mode=ApprovalMode.deny_all,
    developer_instructions=request.system_prompt,
    config={**provider_config, "network_access_enabled": False, "web_search_mode": "disabled"},
)
```

`request.disallowed` is spec 42 §6's common-vocabulary list. REX's read profile
passes `["write", "edit"]`; the Codex adapter has no per-tool disallow list to
map it onto, so the presence of `write` selects the read-only sandbox and its
absence the workspace-write one. That is the whole mapping, and §9.2 is why it
is enough.

`ApprovalMode.deny_all` is the Python name for the TypeScript
`approvalPolicy: "never"` — the samples' comment reads "never prompt for
escalated permissions (fully headless)" (`2_thread_with_options.py:38`), and
the default, `auto_review`, would stall a headless run on the first escalation.
`workspace_write` is shown at `python/README.md:122`; `developer_instructions`
at `python/README.md:168`. The two keys in `config` beside the provider are
`config.toml` names for the TypeScript `networkAccessEnabled` and
`webSearchMode` options, and milestone 0 confirms them.

### 6.1 The session shape

Spec 42 §5.5 defines three session modes. Codex cannot accept a supplied id, so
the mapping is:

| `AgentSession` | Codex call |
|:--|:--|
| `SeedSession(id)` | `thread_start(...)` — **the supplied id is discarded** |
| `NewSession()` | `thread_start(...)` |
| `ResumeSession(id)` | `thread_resume(id, ...)` |

Codex names its thread when it starts. The adapter returns that id in
`RunResult.session_id`; REX stores it in the `thread_session` row for this
(thread, `codex`, gateway) triple — spec 43 §5.2 — and per spec 43 §5.5 **only
the ASK and reply path stores it.** An ACT, DOCX or PPTX run discards its id,
exactly as those callers already discard the deterministic Claude one.

The adapter keeps no `AsyncCodex` alive between runs. Each reply opens a
fresh client, resumes the thread, streams one turn, and closes it, which is
what lets spec 42 §3.2 hold: no state outlives a run. `thread_resume`,
`thread_fork`, `thread_list` and `thread_archive` are documented
(`python/README.md:141`) and never exercised by a sample; milestone 0 exercises
`thread_resume` in a second process.

### 6.2 `session_exists`

Spec 42 §6.1 puts `session_exists` on the adapter, because the replay path is
what lets a REX thread outlive an SDK's cache. The Codex adapter answers it by
asking the SDK for that thread — `thread_list`, or `thread_resume` inside a
try — and reporting whether it resolves. A false answer sends REX down the
same `renderTranscript` → `replayPrompt` path Claude uses, with the route
unchanged. Spec 43 §5.2 case 3 uses that same path the first time a thread is
sent to Codex at all.

### 6.3 Stopping

Spec 42 §6.1 hands the adapter a `stop: asyncio.Event`, set when main sends
`stop` for this `run_id`. The adapter waits on it beside the stream and, when
it fires, interrupts the turn through whatever the Python SDK offers for that
— the TypeScript client takes an abort signal on `runStreamed`, and the Python
equivalent is milestone 0's fourth measurement. If the pinned SDK has no
interrupt, the adapter cancels the stream task and archives the thread, so a
stopped run cannot keep spending.

Either way the adapter emits the same single `stopped` event the Claude
adapter emits (spec 42 §7), and `bridge.ts` writes the one `stopped` row. A
stop is never an error, and never a cost of zero.

---

## 7. Instructions and capabilities

`RunRequest.system_prompt` (spec 42 §6) — REX's READ or WRITE prompt as text —
becomes Codex `developer_instructions` on `thread_start`. The prompt content
stays shared; adapter-specific mechanics do not leak into it, except where a
tool name genuinely differs.

Claude plugins and output styles do **not** silently become Codex plugins or
personalities. Spec 43 §4.4 made styles an advertised capability precisely for
this moment, and spec 42 §9.4 did the same for plugins: this is the first
adapter that answers both false. Main rejects a non-null style or a non-empty
plugin list sent here; the renderer hides the style control; `bridge.ts`
passes no plugin paths.

```python
# The Codex adapter's answer.
RouteCapabilities(
    models=[configured model only],
    styles=[],
    supports_styles=False,
    supports_plugins=False,
    supports_cost=False,
    supports_ask=True,
    supports_act=False,    # until milestone 2's boundary proof passes
    supports_resume=True,
    error=None,
)
```

The Codex SDK supplies no gateway-independent model catalogue, so a Codex route
offers the models typed into it and nothing else — spec 43 §4.3. For `Original`
it offers the configured model too, because `Original` + `inherit` means "the
Codex CLI's own default" and REX has no way to list what that account may use.

---

## 8. Codex events become `AgentEvent`s

The Python SDK delivers a turn as a stream of events, each with a `method`
string and a `payload`. Items arrive wrapped: `item.root` is the concrete item,
and `item.root.type` is **camelCase** — `agentMessage`, `reasoning`,
`commandExecution`, `fileChange`, `mcpToolCall`, `webSearch`
(`1_simplest_thread.py:35-50`, `6_mcp_tools.py:31-60`). The adapter unwraps
once, in `events.py`, and nothing downstream sees the wrapper.

Only terminal `item/completed` events produce durable events. `item/started`
and `item/agentMessage/delta` update ephemeral progress in memory — the delta
drives the live text and is never stored. Emitting each snapshot would repeat
one command several times in the transcript, which is the failure spec 38
exists to avoid.

The adapter emits spec 42 §7's union and nothing else; `bridge.ts` turns each
event into the `MessageDraft` REX stores, exactly as it does for Claude:

| Codex item or event | `AgentEvent` |
|:--|:--|
| `agentMessage` | `text` |
| `reasoning` | `thinking` |
| `commandExecution` | `tool_call` — name `command_execution`, common `shell`, input `{ command }` — then `tool_result` with the aggregate output; `is_error` when the exit status is non-zero |
| `fileChange` | `tool_call` — common `write` — then one `diff` and one `wrote` per path; the working-copy diff stays authoritative |
| `mcpToolCall` | `tool_call` — name `mcp__<server>__<tool>`, common `mcp` — then `tool_result`, or an error result |
| `webSearch` | `tool_call` — name `web_search`, common `fetch` — then `tool_result` |
| `todoList` | dropped — spec 42 §7 rule 5. The plan is visible in the `agentMessage` text that accompanies it |
| an item or turn error, `turn/failed` | `error`, keeping the SDK's original text |
| the thread's first event | `started`, with the thread id and the model |
| `turn/completed` | `completed` with `input_tokens` and `output_tokens` from `usage.total`; `cost_usd: None` |

Usage is nested in Python — `result.usage.total.input_tokens`,
`.cached_input_tokens`, `.output_tokens` (`helpers.py:39-45`) — and the
adapter reads the total, never a per-step figure.

The mapping is a pure function with fixture tests in
`agent-runner/tests/test_events.py`. Streaming to the pipe and database writes
stay with the code that handles Claude events today.

Codex reports token usage and does not always report a dollar cost, especially
for a custom provider. `cost_usd: None` means "the SDK reported no cost". It is
never drawn as `$0.00` — spec 43 §8.1.

---

## 9. Safety

### 9.1 The policy speaks `CommonTool`, so this adapter brings its own mapping

Spec 42 §8 recorded the trap: REX's `gateDecision()` matches `Write`, `Edit`,
`NotebookEdit`, `Bash` and `mcp__*`, and **returns allow for any name it does
not know**. `commandExecution` and `fileChange` are names it does not know.

So the library's `adapters/codex/tools.py` maps every item that is a tool call
into the common vocabulary before the policy is asked, and the mapping is
closed:

| Codex item | `CommonTool` | Input the policy reads |
|:--|:--|:--|
| `commandExecution` | `shell` | `{ command }` |
| `fileChange` | `write`, one call per path | `{ file_path }` |
| `mcpToolCall` | `mcp`, named `mcp__<server>__<tool>` | the call's arguments |
| `webSearch` | `fetch` | `{ query }` |
| anything else | `None` | — |

`agentMessage`, `reasoning` and `todoList` are not tool calls and never reach
the policy.

REX's policy is spec 42 §8's `policyFor()`, answered over the pipe, and for
every SDK but Claude it **denies `common: None`**. So a new Codex item type is a
visible refusal with a name in it, not a silent hole — the fall-through
direction is the whole difference between a gate and a decoration.
`test_policy.py` asserts the library's half: an unknown item type arrives as
`None` and is never guessed.

Where the policy runs is the honest part. The Codex SDK exposes no
pre-execution veto — hooks are a config-file feature of the CLI, not an SDK
callback (§10.1) — so the adapter calls `ask_policy` when an item **starts**,
and a denial emits a `denied` event and ends the turn with an error naming the
tool. The sandbox (§9.2) is what actually stops the write; the policy is what
makes the attempt visible. Milestone 0 records whether the pinned SDK offers an
approval callback, and if it does the policy moves in front of the tool.

### 9.2 ASK

Codex ASK uses `Sandbox.read_only` and `ApprovalMode.deny_all`, so the sandbox
is the primary boundary and the policy is defence in depth. That is the
opposite order from Claude, where the policy is primary, and it is an
improvement: the sandbox stops the write before the tool runs.

Milestone 1 must prove with a deliberately hostile prompt that Codex ASK cannot
change:

- the reviewed repository;
- `~/.rex/work`;
- `.git`; or
- any file outside the workspace.

ASK does not ship on an assumption about SDK option names.

### 9.3 ACT

The reviewed repository stays read-only until the reviewer approves a working
copy. For Codex ACT the working directory is the run's **REX working-copy
directory**, not the source repository. `workspace_write` can write that
directory and the additional working-copy directories the run names. The source
repository is readable by absolute path.

This is stronger than starting Codex in the repository and repairing writes
afterwards: the sandbox stops the original write. Spec 22's before-and-after scan
stays as defence in depth and as the source of newly touched paths.

Milestone 2 is a gate. It must prove on every packaged platform that the source
repository is readable and not writable, and that every intended working copy is
writable. Until it passes, `supports_act` is false, Codex ACT is visibly
disabled (spec 43 §8.1), and Claude ACT is unaffected.

### 9.4 No silent downgrade

Spec 43 §10.2 applies unchanged. If a Codex route cannot stream Responses, call
tools, or resume, REX says so. It never retries through the Claude adapter or
`api.openai.com`.

---

## 10. Evidence — measured 2026-09-03, and again 2026-09-04

The reviewer's gateways are the compose projects in
[`~/Projects/Github/lukaskellerstein/ai-gateway`](../../../../ai-gateway).
`unsloth-26b` is `unsloth/gemma-4-26B-A4B-it-qat-GGUF` on Unsloth Studio, port
8888.

| Route | Result |
|:--|:--|
| LiteLLM `POST :24000/v1/responses` | **200** — a real `"object": "response"` |
| Engine `POST :8888/v1/responses` | **200** |
| `unsloth-26b` tool call | `finish_reason: "tool_calls"`, one well-formed function call |
| Envoy `POST :26000/v1/responses` | **not measured** — registered in source (below); milestone 0 records it |

LiteLLM needs `Authorization: Bearer <key>`; the master key defaults to
`sk-litellm-master` and the repository's tests read `AI_GATEWAY_KEY` first
(`litellm/tests/common.py:152`). The engine needs `UNSLOTH_API_KEY` on every
route.

Envoy registers `{openai}/v1/responses` in `cmd/extproc/mainlib/main.go`, with
the OpenAI prefix defaulting to `/` — spec 43 §15.2 — so the route is
`http://localhost:26000/v1`, and Envoy checks no caller key. The reviewer's own
`ai-gateway/envoy/tests` drive `base_url=http://localhost:26000/v1` for chat
completions and list nothing for `/v1/responses`. The path exists; whether the
translation onto an OpenAI-schema backend carries a Responses turn with tool
calls is the measurement.

**Two base URLs back a Codex route on this machine:**

| Base URL | Auth | Notes |
|:--|:--|:--|
| `http://localhost:24000/v1` | Environment variable · `AI_GATEWAY_KEY` | LiteLLM. Brings virtual keys, spend logs and budgets |
| `http://localhost:26334/v1` | No authentication | REX's own Envoy. **The one every milestone below was driven through** |

Two things follow:

1. **Neither the model nor the protocol is the blocker.** The engine returns
   structured tool calls — the hard part, and the thing most local models fail —
   and it implements `/v1/responses` itself, which is why a gateway can forward
   to it.
2. **Spike against LiteLLM first.** Its Responses route is measured, and its
   spend logs are the reason to have a gateway at all.

### 10.0 Milestone 0, run 2026-09-04 — five records and four corrections

The gate §13 sets. **Four of this spec's own guesses were wrong**, and each is
corrected in place below rather than left for a reader to trip over.

| §13 step | Result |
|:--|:--|
| 1 · start, stream, stop one turn | **Passed.** `AsyncCodex` + `turn.stream()`, `TurnStatus.completed`; a stop mid-turn gives `TurnStatus.interrupted`, the stream ends clean and nothing is thrown |
| 2 · persist the SDK's id and resume it in a second process | **Passed.** `thread_resume` recalled the first turn's question |
| 3 · two runs, two URLs, `os.environ` untouched | **Passed**, and re-run 2026-09-05 as the real thing: a Claude turn and a Codex turn started with one `Promise.all` on one service finished in 7.9 s where each alone takes ~6 s, answered their own questions (`42` and `4`), took different session ids, and left `REX_AGENT_TOKEN` unset in the parent. Two *Codex* runs on two gateways at once likewise kept their own answers — and their own errors |
| 4 · record every symbol | Below |
| 5 · repeat against Envoy | **Passed on `:26334`.** `:26000` is the wrong address — 404 `No matching route found`; it serves `ollama-*` aliases only |

**The four corrections.** Read them before §5 and §6, which are written as they
were guessed:

1. **`model_provider` is a keyword argument**, not a config key:
   `thread_start(model_provider="rex", config={"model_providers": {...}})`.
   `model_providers` does go in `config`, and `Config` declares `extra="allow"`,
   which is why it passes through.
2. **`network_access_enabled` and `web_search_mode` are not config names.** The
   real ones are `sandbox_workspace_write.network_access` and `web_search`
   (`disabled` | `cached` | `indexed` | `live`), from the SDK's own `Config`
   model.
3. **`CodexConfig.env` is MERGED** onto `os.environ.copy()` at spawn, not a
   replacement — the same shape spec 43 §6.2 found in the Claude Python SDK. So
   §5.1's rule holds by naming one variable, and `PATH` and `HOME` survive
   without being restated.
4. **The item type §8 calls `todoList` is `plan`.** The full union also carries
   `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `imageView`,
   `sleep`, `imageGeneration` and the review-mode markers — which is why §9.1's
   mapping is written as a list of what is **not** a tool call, so an SDK that
   adds one falls through to a refusal rather than past the policy.

**The approval callback exists and is unusable.** `CodexClient` takes an
`approval_handler` for `item/commandExecution/requestApproval` and
`item/fileChange/requestApproval`, but it is not reachable through
`AsyncCodex(config=...)`, it is synchronous on the sole stdout reader thread,
and `ApprovalMode.deny_all` means the CLI never sends one. §9.1's
`item/started` design therefore stands, and the sandbox stays the primary
boundary.

**What interrupts a turn:** `await turn.interrupt()` on `AsyncTurnHandle`.

**Reasoning arrives as its own item**, both in the raw Responses body and as a
Codex `reasoning` item, so §8's first two rows are clean. A local model fills
`content` and leaves `summary` empty, so the adapter reads both.

**`APPENDS["codex"]` was wrong.** Codex appends **`/responses`** and not
`/v1/responses`: a route with `base_url = http://host/v1` knocks on
`http://host/v1/responses`, which the CLI's own error names. Every kind's
template already ends the base in `/v1`, so the doubled spelling made §2.4's
Verify report `/v1/v1/responses` and call a correct route broken — spec 43 §3's
trap pointing the wrong way, at the route rather than at the reviewer.

### 10.0.1 The write boundary — milestone 2's gate, passed on macOS

Run 2026-09-04 with `cwd` on one working copy and a second named in
`writable_roots`, against a prompt that asked for all three targets:

| Target | Result |
|:--|:--|
| the repository, read | `cat` returned its contents |
| the repository, written | `operation not permitted` |
| the working copy that is `cwd` | written |
| the working copy in `writable_roots` | written |

Two findings, both now in the adapter:

- **`cwd` is implicitly writable** under `workspace-write`. This is what decides
  §9.3's design: a child left in the reviewer's repository has a writable
  repository however carefully `writable_roots` is filled.
- **`/tmp` is writable by default.** `exclude_slash_tmp` and
  `exclude_tmpdir_env_var` are both set, so the boundary is the working copies
  and nothing else. The first run of this proof was staged under `/tmp` and
  proved nothing.

`ACT_PROVED` is `{"darwin"}`. Another platform advertises Codex ASK and not
ACT, with the reason on the route, exactly as §9.3 requires.

**And through `thread:apply` itself, 2026-09-05** — the sandbox proof above is
the adapter's half, and §11 criterion 10 is about the whole path. On a
throwaway git repository holding one Markdown document, a Codex ACT asked to
retitle the first heading:

| Step | Result |
|:--|:--|
| the run | one clean diff, `-# Tilecat` / `+# Tilecat (reviewed)` |
| `restored`, `created`, `misplaced` | all empty — nothing escaped the working copy |
| the reviewer's file, before approval | **byte-for-byte identical**, `git status` clean |
| approve | the heading lands in the file; `git status` shows it modified |
| undo | rewinds a working-copy revision, and is correctly not an un-approve |
| discard, on a second run | the file returns to the pre-run hash exactly |

Nothing in `work.ts` or `apply.ts` is Codex-aware, which is the point: the
three verbs are the same code under either agent, and what changed is only what
lands in the copy.

### 10.0.2 Two integration defects only a running REX showed

Both passed every unit test. Both are fixed, and each is worth the sentence:

1. **Codex wraps every command in `/bin/zsh -lc '…'`**, where Claude's `Bash`
   tool passes the command itself. REX's gate matches on the binary (spec 12
   §6), saw `/bin/zsh`, and refused — so a plain `cat` was denied and Codex ASK
   could read nothing. `adapters/codex/events.py` unwraps exactly
   `<known shell> -<flags including c> <one script>` and passes anything else
   through whole, so the gate still refuses what it cannot parse.
2. **REX built Claude plugins for every Codex run.** `lsp-bash` is resolved for
   every run, the library refuses a plugin list an adapter cannot honour (§7,
   correctly), and so **every Codex ASK failed before its child started**.
   `SdkDescriptor` gained `supports_plugins` beside `supports_styles`, and
   `bridge.ts` asks it before building the list — which is what §7's "`bridge.ts`
   passes no plugin paths" always meant.

### 10.0.3 The reviewer's own Codex toolbox, and how it got out

Learned from the reviewer's own gateway suite —
`ai-gateway/envoy/tests/6_codex_sdk/`, whose `common.py` says of two config
lines: *"`mcp_servers={}` and `plugins={}` are load-bearing… without it the run
depends on who is at the keyboard."* Measured here 2026-09-05, and it is worse
than a determinism problem.

**Codex starts what `$CODEX_HOME/config.toml` lists, before the turn begins.**
A REX Codex run on this machine spawned, every time:

| Process | What it is |
|:--|:--|
| `node_repl` | a JavaScript interpreter — arbitrary code execution outside the shell path the gate reads |
| `@playwright/mcp` × 2 | a full browser API |
| `SkyComputerUseClient` | the `notify` hook |

from eleven installed plugins including Slack, Google Calendar, documents and a
site deployer. REX's gate is deny-by-default for MCP (spec 12 §6.4.3) and that
does not help: `writeGateDecision` says why in its own words — starting a
server has already happened by the time anything is shown, and a server that
has started has read whatever it was configured to read.

**Two mechanisms were tried and neither works at 0.147.0.**

| Attempt | Servers still spawned |
|:--|:--|
| `thread_start(config={"mcp_servers": {}, "plugins": {}})` | 5 |
| `CodexConfig(config_overrides=("mcp_servers={}", "plugins={}"))` | 5 — it reaches the binary as `--config` and is ignored |
| **`CODEX_HOME` pointed at a REX directory** | **0** |

So the isolation is a **directory and not a setting**: `~/.rex/codex-home`,
stable rather than per run, because Codex keeps its rollouts there and
`thread_resume` (§6.1) reads them. It also keeps REX's sessions out of the
reviewer's `~/.codex`, which is the courtesy spec 42 §9.3 records for the
Claude transcript store. Proved through `runAgent` itself: **0 of the
reviewer's tools started, and the run still answered.**

**`Original` is deliberately left alone.** No URL means the Codex CLI's own
endpoint on the reviewer's own login, and that login lives in `~/.codex` —
moving the home would take the account with it. A reviewer on `Original` gets
their own toolbox, which is what `Original` means; a reviewer on a gateway has
chosen to keep the work local, and now it is.

**And `model_context_window`**, from the same file: left unset for a model
Codex has never heard of, it assumes a small window and compacts far too early,
*"which on a local model looks like an agent that forgets things mid-task for no
visible reason."* Set for a routed run only.

### 10.0.4 Two notes about the gateways themselves

- **LiteLLM cools a failed deployment down and then misreports why.** A request
  that times out puts the alias in cooldown, and the next call answers
  `Invalid model name passed in model=lms-26b` — a sentence about configuration
  for a fault that is transient. §9.4's `UNKNOWN_MODEL` hint says so.
- **The alias vocabulary moved.** LiteLLM's `/v1/models` lists `lms-*`;
  `unsloth-26b` is no longer among them. REX's own Envoy on `:26334` lists both
  families and their `-anthropic` twins.

### 10.1 The reviewer's own samples

`~/Projects/Github/lukaskellerstein/vibe-coding-course/03_Codex_SDK/python/`
pins `openai-codex>=0.1` (`pyproject.toml:6-9`, with `pydantic>=2.7`, Python
≥3.10); PyPI's latest is `0.147.0`. The library pins the latest and verifies
every symbol in §5 and §6 against it. The samples confirm the shape this spec
assumes:

- the import: `from openai_codex import Codex, AsyncCodex, CodexConfig, Sandbox,
  ApprovalMode`; the SDK pulls its own runtime binary through
  `openai-codex-cli-bin` (`README.md`);
- the executable: `CodexConfig(codex_bin=executable)` when `CODEX_EXECUTABLE`
  is set, else `CodexConfig()` (`helpers.py:26-29`);
- the async client: `async with AsyncCodex(config=codex_config()) as codex`,
  `thread = await codex.thread_start()`, `result = await thread.run(prompt)`,
  fanned out with `asyncio.gather` (`examples/1_single_thread/11_async_parity.py:26-34`);
- the thread: `codex.thread_start(model="gpt-5.4-mini", sandbox=Sandbox.read_only,
  approval_mode=ApprovalMode.deny_all, config={"model_reasoning_effort": "medium"})`
  (`examples/1_single_thread/2_thread_with_options.py:30-41`);
  `Sandbox.workspace_write` at `README.md:122`; `developer_instructions=` on
  `thread_start` at `README.md:168`;
- the stream: `turn = thread.turn(prompt)`, then `for event in turn.stream()`
  with `event.method` in `item/agentMessage/delta` (`event.payload.delta`),
  `turn/completed` (`event.payload.turn.status`), `item/started`,
  `item/completed` (`examples/1_single_thread/1b_streaming.py:29-47`,
  `6_mcp_tools.py:63-73`);
- the items: `item.root.type` in camelCase — `agentMessage`, `reasoning`,
  `commandExecution`, `fileChange`, `mcpToolCall`, `webSearch`
  (`1_simplest_thread.py:35-50`, `6_mcp_tools.py:31-60`);
- usage: `result.usage.total.{input_tokens, cached_input_tokens, output_tokens}`
  (`helpers.py:39-45`);
- MCP servers: `codex.thread_start(config={"mcp_servers": MCP_SERVERS})`
  (`6_mcp_tools.py:81`);
- resumption: `thread_resume`, `thread_fork`, `thread_list`, `thread_archive`
  documented (`README.md:141`) and never exercised;
- authentication: an existing Codex CLI session by default; `codex.login_api_key`
  and `codex.login_chatgpt()` documented (`README.md:29-35`) and never called;
- hooks, subagents, skills and plugins are config-file features
  (`.codex/hooks.json`, `.codex/config.toml`), not SDK API (`README.md:147-159`).

**No sample sets a base URL, a `model_provider`, or a per-child environment.**
§5's provider path and §5.1's environment are unexercised by the samples and
stay milestone 0. The TypeScript track of the same course
(`03_Codex_SDK/typescript/`, `@openai/codex-sdk` `0.121.0`) exists and is no
longer the reference; `python/README.md`'s TS↔Python differences table is
there for anyone reading the TypeScript names.

### 10.2 What is still unproven

Everything this list held on 2026-09-03 was answered by §10.0 on 2026-09-04.
What is left is smaller and is written down so nobody reads silence as proof:

- **The write boundary on any platform but macOS.** Codex's sandbox is seatbelt
  here, landlock on Linux and its own thing on Windows, so §10.0.1 proves one
  of three. `ACT_PROVED` is the gate, and it is deliberately a list rather than
  a flag.
- **A gate refusal of a genuinely destructive command, end to end.** The gate
  was made to speak on a real Codex call — `xyzzy-diagnostic` was refused by
  name and ended the turn — but the local model declines `rm` and redirects on
  its own, so no run has yet been refused a command it actually wanted. The
  unit tests cover the shape (`test/bridge.spec.ts`), and the sandbox is the
  primary boundary either way (§9.2).
- **An unmapped item type, live.** §9.1's fall-through is unit-tested on both
  sides — the library answers `common: None` and the host denies it — and no
  SDK has yet produced an item type this adapter has not mapped, which is the
  only way to see it happen.
- **A paid endpoint.** Every measurement here is against a local model through
  a local gateway. Nothing has driven Codex's own endpoint on a real account,
  so `requires_openai_auth` (§5) is written and unexercised.
- **`webSearch` items.** Mapped and unit-tested against the SDK's own model,
  and no live run has produced one — REX disables web search on every run.
- **`mcpToolCall` items cannot occur at this version, and that is upstream.**
  The reviewer's own suite records two open bugs, and both bite exactly here:
  [openai/codex#19871](https://github.com/openai/codex/issues/19871) — MCP tool
  invocation regressed for **custom providers** in 0.117.0+, last good 0.116.0,
  and REX pins 0.147.0 — and
  [openai/codex#24135](https://github.com/openai/codex/issues/24135) — there is
  no supported way to approve an MCP tool call non-interactively;
  `approval_policy="never"` and friends are silently ignored. So §8's and
  §9.1's `mcpToolCall` rows are written, tested and unreachable through a
  gateway route until those close. They are kept rather than deleted: the
  mapping is right, and a hole that opens when a bug is fixed is worse than one
  line of unreached code.

---

## 11. Acceptance criteria

1. A reviewer can add a Codex route to a gateway, with a Responses URL, a model
   list and an authentication choice.
2. The composer shows an agent control listing Claude and Codex from the
   descriptor; changing it rebuilds the gateway and model lists; a gateway with
   no Codex route is greyed with the reason.
3. A Codex send routes only through its own custom provider configuration and
   its own child environment; `os.environ` in the service is never assigned.
4. A Codex thread id is assigned by the SDK, stored on the thread, and never
   manufactured by REX.
5. An ACT, DOCX or PPTX run never overwrites the thread's conversation session.
6. A reply whose Codex session is gone still answers, through the replay path.
7. Stop emits one `stopped` event and no error.
8. An unmapped Codex item type reaches the policy as `common: None`, is denied,
   and is named in the denial.
9. ASK cannot change the reviewed repository, `~/.rex/work`, `.git`, or anything
   outside the workspace, under a deliberately hostile prompt.
10. ACT changes only REX working copies. Originals are byte-for-byte unchanged
    before approval, and approve, discard and undo behave as they do under Claude.
11. The style control is hidden for a Codex route, and a non-null style or a
    non-empty plugin list sent to one is rejected rather than ignored.
12. Cost that the SDK did not report is drawn as unknown, never as `$0.00`.
13. A Claude route and a Codex route run at the same time, on one service,
    without exchanging URLs, models, credentials or session ids.
14. `openai-codex` is imported only under
    `agent-runner/src/agent_runner/adapters/codex/`, and spec 42's
    `test_boundary.py` still passes.
15. Every answer's foot names the agent, and switching a comment from Claude to
    Codex seeds the new session with the conversation so far.
16. When the pinned SDK cannot take a per-child credential, the `environment`
    auth is refused for Codex with a sentence, before anything spawns.

---

## 12. Deliberately out of scope

- Translating Chat Completions into Responses, or any other protocol bridging.
- Codex extensions, personalities, or plugins as equivalents of Claude's.
- Running or supervising a gateway that serves Responses.
- The synchronous `Codex` client. The service is asyncio, and a blocking run
  would stall every other run on the pipe.
- Anything spec 43 §14 already excludes.

---

## 13. Milestones

### 0 — prove the Codex seam

A throwaway, non-UI spike through spec 42's service: a `run` message on the
pipe reaching the Codex adapter, against `http://localhost:24000/v1` with
`AI_GATEWAY_KEY` per §10.

1. Start, stream and stop one turn through `AsyncCodex` and `turn.stream()`.
2. Persist the SDK's thread id and resume it with `thread_resume` in a second
   process.
3. Prove two concurrent Codex runs on one service, against two base URLs, each
   reach their own — and that `os.environ` is untouched afterwards.
4. Record every symbol from §5 and §6 that the pinned SDK actually has: where
   `model_providers` goes, whether there is a per-child `env` or a spawn hook,
   what interrupts a turn, and whether there is a pre-execution approval
   callback.
5. Repeat step 1 against `http://localhost:26000/v1` and record the result in
   §10.

*Gate:* no UI work before these five are recorded in §10.

### 1 — Codex ASK

The dependency, the adapter directory, the route config, the §9.1 mapping,
session storage and resumption, event normalisation, the read profile,
cancellation, the agent control (§3), and the transcript and debug labels.

*Tests:* `agent-runner/tests/test_events.py` and `test_policy.py` grow Codex
fixtures; `test/choices.spec.ts` (spec 43) grows the agent row of the cascade.

*Done when:* a Codex route answers a real comment, resumes, stops, and runs at
the same time as a Claude route; the agent control switches a comment between
the two and both feet say which answered; and the §9.2 hostile prompt changes
nothing.

### 2 — Codex ACT

Only after the §9.3 write-boundary proof on every packaged platform. Connect
`fileChange` and `commandExecution` to the existing working-copy accounting and
diff review.

*Done when:* ACT changes only REX working copies, originals are unchanged before
approval, and approve, discard and undo match the Claude adapter. A platform
without the proof advertises Codex ASK and not ACT.
