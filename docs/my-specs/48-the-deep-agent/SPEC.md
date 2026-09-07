# REX 48 — the deep agent

**Version:** 3.0 · 2026-09-07
**Status:** **proposal. Nothing in this spec is built.**
**Depends on:** [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
(the Python package, the service, `AgentEvent`, the policy round trip,
`AgentSession`, the adapter interface);
[`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md) (gateway
rows, the controls, sessions, the child environment);
[`44-the-codex-agent/SPEC.md`](../44-the-codex-agent/SPEC.md) (the agent
control, which this spec's fourth row joins);
[`46-the-builtin-gateway/SPEC.md`](../46-the-builtin-gateway/SPEC.md) — **the
gateway this spec targets**, whose migration already writes its route.
**Also:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §8 (one thread, one agent,
one session); [`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §6 (the
gate); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md) §2
(cancellation); [`22-the-whole-workspace/SPEC.md`](../22-the-whole-workspace/SPEC.md)
§3 (working copies).

> [!note]
> **The fourth SDK, added by the reviewer on 2026-09-04:**
>
> > The agents that we are going to use are going to be: Claude agent SDK,
> > Codex SDK, Open code, Deep agents from LangChain. I can provide to all of
> > them samples so you can take a look at how to use them.
>
> The Deep Agents samples are at
> [`~/Projects/Github/lukaskellerstein/ai-agents-course/Version_3/06_langchain-ai/3_deepagents`](../../../../ai-agents-course/Version_3/06_langchain-ai/3_deepagents),
> eight Python lessons on `deepagents` 0.6.12. **They are the reference as
> written.** §12.1 lists each thing they do and what REX does with it.
>
> **What changed in 3.0.** The gateway moved. Version 2.0 was written when four
> gateway kinds existed and this spec's route was described as "`{host}/v1` for
> both `litellm` and `envoy`". Spec 46 replaced that: `infra/` was deleted on
> 2026-09-06, the `envoy` and `custom` kinds are gone, and three remain —
> `original`, `builtin` and `litellm`. The target is now REX's own gateway,
> LiteLLM inside REX on `http://127.0.0.1:24334/v1`, with `auth = 'environment'`
> and `credential_env = REX_GATEWAY_KEY`. **This is the smallest retarget of the
> four adapters**, because §4.1 already chose the OpenAI chat protocol and
> `ChatOpenAI` against a LiteLLM proxy — which is exactly what the built-in
> gateway is. The class does not change; only which LiteLLM answers.
>
> **What changed in 2.0.** Version 1.0 had to translate the samples into the
> npm `deepagents` port, because REX was TypeScript only. On 2026-09-04 the
> reviewer chose Python for the whole agent library — spec 42 v3.0 — and the
> translation is gone. The adapter is
> `agent-runner/src/agent_runner/adapters/deep_agents/`, and it runs
> **inside the service's own process**: still no child for the model, still no
> CLI, still no sandbox. That makes this the one adapter where spec 42 §3.4's
> process boundary is the *only* boundary between the agent and REX — the
> graph, the model client and the filesystem tools all live in the interpreter
> main spawned, one pipe away from the window.
>
> **What makes this adapter different from the other three:** a deep agent is
> a LangGraph graph, and it reaches the model with a LangChain chat model
> class. What it has instead of a sandbox or a permission prompt is a
> *backend* — a virtual filesystem the agent's tools see — and *permission
> rules* on it. §5 is built on those.

---

## 1. Why

Spec 42 built the seam, spec 43 gave it gateways, specs 44 and 47 filled in the
two SDKs that, like Claude's, wrap a CLI, and spec 46 replaced every external
gateway with one REX runs itself. This spec fills in `deep-agents`, and it is
the one that tests whether the seam is really about agents and not about child
processes.

The schema does not change: `AgentSdk` already carries `'deep-agents'` (spec 42
§5.1), `gateway_route.sdk` already allows it (spec 43 §2.2), `Original` already
has a row for it (spec 43 §12), and **spec 46's migration already wrote the
`deep-agents` route for the built-in gateway** at `http://127.0.0.1:24334/v1`.
What this spec adds is one adapter directory, three dependencies, and the proofs
that its ASK cannot write.

---

## 2. Four adapters, four shapes

| | Claude Agent | Codex | OpenCode | **Deep Agents** |
|:--|:--|:--|:--|:--|
| runs as | a child CLI of the service | a child CLI of the service | a server the service owns | **a graph in the service's process** |
| calls the model from | the child | the child | the server | **the service** |
| session cache | `~/.claude/projects/` | the CLI's threads | the server's data dir | **none — §7** |
| write boundary | `PreToolUse` hook | OS sandbox | permission ruleset | **backend rules — §5.1** |
| shell | `Bash`, gated | `command_execution`, sandboxed | `bash`, asked | **none — §5** |

Every decision below follows from the last column.

---

## 3. The dependencies

The library adds three packages, each a `uv add` in `agent-runner/`, and each
a confirmation before it is installed, per `CLAUDE.md` — none is in spec 01
§3.2's list:

| Package | PyPI on 2026-09-04 | For |
|:--|:--|:--|
| `deepagents` | 0.7.13 (Python ≥3.11, <4.0) | `create_deep_agent`, `FilesystemBackend`, `CompositeBackend`, `FilesystemPermission` |
| `langchain-openai` | 1.6.0 | `ChatOpenAI` — the OpenAI chat protocol every gateway serves |
| `langchain-anthropic` | 1.7.1 | `ChatAnthropic` — `Original` on an Anthropic API key |
| `langchain` | 1.4.0, *(pulled by `deepagents`)* | `wrap_tool_call`, `ToolMessage` — §5.2 |
| `langgraph` | *(pulled by `deepagents`)* | `InMemorySaver`, `Command` |

The reviewer's samples pin `deepagents>=0.6.12` and resolve `langchain-openai`
1.3.3 (`1_basics/pyproject.toml`, `uv.lock`). REX pins 0.7.13, so every symbol
below is checked against the pinned version before it is used.

> [!important]
> Every symbol below is written from the samples and from the documentation at
> `docs.langchain.com/oss/python/deepagents`, and must be checked against the
> pinned package before it is used. `SPEC.md` §0's standing rule applies: the
> names in a spec are a description of intent, not a verified signature.

Nothing here runs a second process for inference. The service's interpreter
grows by the LangChain stack, which is spec 42 §12's second toolchain doing
its job; the Electron main process grows by nothing.

---

## 4. The route: which protocol, and which key

### 4.1 An explicit gateway is the OpenAI chat protocol

The Deep Agents column of the catalogue is `{host}/v1` for both `builtin` and
`litellm` — the two kinds that are a LiteLLM, and which spec 46 §3 says share
every route template for exactly this reason. The adapter reaches it with
`ChatOpenAI`, in exactly the samples' shape:

```python
ChatOpenAI(
    model=request.model,                  # the alias, as typed on the route
    base_url=route.base_url,
    api_key=route.token or "rex-local",   # §4.3
    streaming=True,
    max_tokens=8192,                      # §12.3 — the model thinks before it answers
)
```

The route editor says so:

> **OpenAI-compatible chat API base.** This often ends in `/v1`, and the server
> must serve `/chat/completions` with streaming tool calls.

Two reasons this is OpenAI chat and not Anthropic Messages, even against a
gateway that serves both:

1. **It is what the reviewer's samples do.** Every lesson builds
   `ChatOpenAI(model=MODEL_ALIAS, base_url=BASE_URL, api_key=API_KEY, …)`
   against a LiteLLM proxy (`1_basics/model.py:60-65`), and the alias decides
   the provider. **The built-in gateway is a LiteLLM proxy**, so the samples'
   shape is the shipping shape, not an approximation of it.
2. **It is measured — on the engine, not yet through this proxy.** Spec 43 §15.1
   records the engine streaming incremental `tool_calls` deltas, which is what
   `ChatOpenAI` consumes and the thing most local models get wrong. Whether
   LiteLLM passes those deltas through untouched is §12.4's first open item,
   and it is shared with spec 47 §10.0 — one measurement answers both.

One class for both LiteLLM kinds is also one fewer thing to get wrong, and it is
why spec 46 §3 made `builtin` and `litellm` share their route templates instead
of giving the built-in one its own.

### 4.2 `Original` is an API key, not the subscription

For a route with no URL the model id must be in `provider:model` form —
`anthropic:claude-sonnet-4-6`, `openai:gpt-5.4-mini` — which is `deepagents`'
own string form for `model=`. The adapter splits it at the first colon and
builds the class itself, so the key is an argument and never an ambient
variable:

| Prefix | Class | Credential it reads |
|:--|:--|:--|
| `anthropic:` | `ChatAnthropic(model=…, api_key=…)` | `ANTHROPIC_API_KEY` |
| `openai:` | `ChatOpenAI(model=…, api_key=…)` | `OPENAI_API_KEY` |
| anything else | refused by name, before anything runs | — |

> [!warning]
> **LangChain has no login.** `claude login`'s subscription token is a Claude
> Code credential and `ChatAnthropic` cannot use it. So for this SDK,
> `auth: inherit` means "the provider's own environment variable", and a
> reviewer whose `ANTHROPIC_API_KEY` is unset gets a named refusal before a run
> starts — not a 401 from inside one. The gateway sheet says this under the
> `Original` row for Deep Agents, and spec 43 §9's credential-availability
> check covers the variable. Main reads the variable and hands the value across
> as `route.token`, the same way it does for an `environment` route.

### 4.3 The three auth values

| Route auth | What the adapter does |
|:--|:--|
| SDK / account default | no URL: the provider's own variable, resolved by main (§4.2). With a URL: **refused** — a generated OpenAI-compatible client has no login convention to inherit, exactly as spec 47 §4 refuses it for OpenCode |
| Environment variable | `api_key=route.token`, resolved by main moments before (spec 42 §5.3) |
| No authentication | `api_key="rex-local"` — the client library refuses an empty key, the gateway ignores the value |

Nothing is written to `os.environ`. The key goes into one client object that
lives for one run, which is the in-process form of spec 43 §6.2's per-child
environment. Two runs on two gateways build two clients and share nothing.

### 4.4 The model list

Deep Agents has no model catalogue and no probe **of its own**, and there are now
two different answers depending on the kind:

| Route | Where its models come from |
|:--|:--|
| `builtin` | **Settings.** Spec 46's Models tab discovers them from the provider and the reviewer ticks them; the route's list is written, not typed. Nothing in this adapter probes anything |
| `litellm` | spec 46 §6's remote model list, read from that server's `/v1/models` |
| `Original` | typed by hand — a list of `provider:model` ids, per below |

So the sentence version 2.0 wrote — "a route offers the models typed into it"
(spec 43 §4.3) — is now true only of `Original`. For the built-in gateway the
model list is a consequence of what was ticked, which is the whole point of spec
46 §5: a reviewer picks a model once and every SDK can name it.

**This amends spec 43 §2.5 by one clause.** `Original` still cannot be renamed
or deleted, and its routes' URL and auth still cannot change; but a route's
*model list* can be typed for an SDK that has no probe. Claude's `Original`
route keeps its probe and its empty list.

---

## 5. The agent

```python
agent = create_deep_agent(
    model=model,                                  # §4
    system_prompt=request.system_prompt,          # spec 42 §6 — the text, as the whole instruction
    backend=backend,                              # §5.1 / §8.2
    permissions=permissions,                      # §5.1
    tools=[],                                     # no custom tools in 2.0
    middleware=[PolicyMiddleware(ask_policy, emit)],   # §5.2
    checkpointer=InMemorySaver(),                 # §7
)
```

The built-in tools are the whole tool set: `ls`, `read_file`, `write_file`,
`edit_file`, `glob`, `grep`, and `task`. There is **no `execute`** — it exists
only on sandbox backends, and this spec uses none. A deep agent in REX has no
shell.

That is weaker than Claude's ASK, which has `Bash` behind a gate, and it is the
honest trade: `deepagents`' permission rules do not cover `execute` (§12.2),
so a shell would have only the policy in front of it and no second layer. A
read-only question about a document does not need a shell. ACT gets one when
milestone 2 finds a second layer for it, and not before.

### 5.1 The read boundary is three layers

1. **`virtual_mode=True`** on every `FilesystemBackend`. The agent sees
   `root_dir` as `/`, and `..`, `~` and absolute paths outside it are blocked
   by the backend before any rule is consulted
   (`5_backends/2_filesystem_backend.py:6-8`).
2. **`permissions=`**, the SDK's own rules — evaluated in declaration order,
   first match wins, no match allows (§12.2):

   ```python
   from deepagents import FilesystemPermission

   READ_ONLY = [
       FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"),
   ]
   ```

   `"write"` covers `write_file`, `edit_file` and `delete`; `"read"` covers
   `ls`, `read_file`, `glob` and `grep`. This is the primary boundary for ASK,
   the way Codex's sandbox is primary in spec 44 §9.2: the backend refuses the
   write before the tool body runs.
3. **REX's policy**, through §5.2's middleware and spec 42 §8's round trip.
   Defence in depth, and the layer that produces the `denied` event the
   transcript draws.

`request.disallowed` (spec 42 §6) maps onto layer 2: `write` and `edit` both
become the deny-all rule above, because the SDK's rule vocabulary has one word
for both.

### 5.2 The policy is a middleware

The Claude adapter installs REX's policy as a `PreToolUse` hook; this one
installs it as a LangChain middleware around every tool call:

```python
from langchain.agents.middleware import AgentMiddleware
from langchain.messages import ToolMessage

class PolicyMiddleware(AgentMiddleware):
    def __init__(self, ask_policy, emit): ...

    async def awrap_tool_call(self, request, handler):
        call = request.tool_call
        reason = await self.ask_policy(ToolCall(
            name=call["name"], common=common_for(call["name"]), input=call["args"],
        ))
        if reason is None:
            return await handler(request)
        self.emit(Denied(name=call["name"], reason=reason))
        return ToolMessage(content=reason, tool_call_id=call["id"], status="error")
```

The model reads the reason as the tool's result, exactly as it does under
Claude's hook, and the library marks the matching `tool_result` event
`denied=True` because it wrote that sentence itself moments earlier. The
middleware is a coroutine because `ask_policy` is one: it is the round trip to
main over the pipe (spec 42 §8), and a synchronous hook could not wait for it.

**Three things must be verified at the pinned version, and milestone 0 records
all three.** The documentation types the hook as
`handler: Callable[[ToolCallRequest], ToolMessage | Command]` returning
`ToolMessage | Command` (§12.2), which admits a return without calling
`handler` — but it shows no example that does, so the short-circuit is
unproven. It shows no async form of the hook either, so `awrap_tool_call` may
not exist, in which case the middleware bridges the coroutine with a future on
the service's loop. And whether a middleware wraps calls made inside a `task`
subagent is not stated.

If the short-circuit fails, the fallback is the SDK's documented path, which
the reviewer's own lesson 7 exercises (`7_human_in_loop/main.py:11-50`):
`interrupt_on={tool: True}` for every tool, the run's `InMemorySaver`, and a
resume with `Command(resume={"decisions": [{"type": "reject", "message": reason}]})`.
Heavier, and proven. If the subagent question fails, `task` is denied by name
(§5.3), which it is anyway in 2.0.

### 5.3 The tool vocabulary

Spec 42 §8 recorded the trap: REX's gate speaks Claude, and a name it does not
know falls through into allow. So the adapter maps before it asks, and the
mapping is closed:

| Deep Agents tool | `CommonTool` | Input the policy reads |
|:--|:--|:--|
| `read_file` | `read` | `{ file_path }` |
| `ls`, `glob` | `list` | — |
| `grep` | `search` | — |
| `write_file` | `write` | `{ file_path }` |
| `edit_file` | `edit` | `{ file_path }` |
| `delete` | `write` | `{ file_path }` |
| `task` | `task` | — |
| `execute` | `shell` — never present in 2.0 | `{ command }` |
| anything else | `None` | — |

REX's policy (spec 42 §8's `policyFor`) denies `common: None` for every SDK but
Claude, so a tool this table does not name is a visible refusal with a name in
it. REX's read policy also denies `task` by name for this SDK: a subagent is a
second model call the reviewer did not ask for, and the samples record a
concrete reason to keep it off against the local engine — Unsloth rejects the
`name` field `deepagents` puts on a subagent's messages, and lessons 4 and 8
only run through the proxy's `custom_callbacks.py`
(`3_deepagents/README.md:77-90`).

`write_todos` is a built-in in the samples' 0.6.12 (`3_deepagents/README.md:10-15`)
and `result["todos"]` is read by several lessons. Whether it is still on by
default at 0.7.13 is milestone 0's to record; if it is present, it is mapped to
`None` and therefore denied by name — a todo list is state, not a document, and
a review comment has no use for one.

---

## 6. Graph events become `AgentEvent`s

The adapter streams the graph:

```python
stream = agent.astream(
    {"messages": [{"role": "user", "content": request.prompt}]},
    config={"configurable": {"thread_id": thread_id}, "recursion_limit": limit},
    stream_mode=["updates", "messages"],
)
```

`updates` yields each node's output — whole messages, which is what the
transcript stores; it is the mode the samples read (`2_custom_tools/main.py:44-69`).
`messages` yields token chunks, which drive the live text and are never
stored. Only `updates` makes durable events:

| Graph output | `AgentEvent` |
|:--|:--|
| `AIMessage` with text content | `text` |
| `AIMessage` with `additional_kwargs["reasoning_content"]` | `thinking` — if the engine's field survives the client, §12.4 |
| each entry of `AIMessage.tool_calls` | `tool_call` — `id`, `name`, `common` (§5.3), `args` |
| `ToolMessage` | `tool_result` — `id` from `tool_call_id`, `is_error` from `status`, `denied` when the content is a reason the policy wrote |
| `write_file` or `edit_file` call in ACT | `wrote` for the path, then `diff` — from `content`, or from `old_string`/`new_string` |
| a raised exception | `error`, keeping the library's original text |
| the run's task cancelled | `stopped` |
| the stream ends | `completed` — tokens summed from every `usage_metadata`; `cost_usd: None` |

`started` carries the model id and a null style. `cost_usd` is always None:
LangChain reports tokens and never a price, and spec 42 §7 forbids inventing
zero.

`max_turns` (spec 42 §6) becomes `recursion_limit`. The samples set 50 against
a default of 9999 (`1_basics/main.py:34-36`); one model step and one tool step
make a turn, so the adapter sends `2 * max_turns + 1` and milestone 0 checks
the arithmetic against a run that hits the limit.

Stop is spec 42 §6.1's `asyncio.Event`. LangGraph's Python stream takes no
signal, so the adapter consumes `astream()` inside an `asyncio.Task`, and when
the event is set it cancels the task, waits for it, and emits `stopped`. What a
cancellation that lands mid-tool does — whether the tool finishes first, or the
graph raises — is §12.4's fourth item.

---

## 7. Sessions: none, honestly

`supports_resume` is **false** in 2.0, and `session_exists` always answers
false.

An `InMemorySaver` (`langgraph.checkpoint.memory`) lives for one run and is
discarded. Every send therefore takes spec 43 §5.2's case 2 — a fresh graph,
seeded with the replay prompt — and pays the replay each time. The composer's
notice (spec 43 §5.2) says so once per combination, and the elapsed-time line
(spec 43 §7) shows the cost.

Why not a durable checkpointer: it would be a store, and spec 42 §3.2 says the
library owns none. A `SqliteSaver` handed in by the host is the right later
revision — it satisfies the same adapter contract, `session_exists` becomes a
lookup, and no schema changes. It is not in 2.0 because a review comment is a
short conversation and the replay is a known, bounded cost, while a
checkpointer is a second place REX's conversation lives.

The run's `thread_id` is spec 42 §5.5's `seed` id when one is given, so a trace
and a REX thread line up; nothing reads it back. The samples' own pattern —
one `{"configurable": {"thread_id": …}}` per conversation
(`5_backends/1_state_backend.py:47-55`) — is what this becomes when a durable
saver arrives.

---

## 8. Safety

### 8.1 ASK

The backend is `FilesystemBackend(root_dir=request.cwd, virtual_mode=True)`
with `READ_ONLY` (§5.1), no shell, and the policy. Milestone 1 must prove with
a deliberately hostile prompt that ASK cannot change:

- the reviewed repository;
- `~/.rex/work`;
- `.git`; or
- any file outside the workspace.

And that a `write_file` attempt produces one `denied` event and one
`tool_result` marked `denied`, not an error and not a silent no-op.

### 8.2 ACT

The reviewed repository stays read-only until the reviewer approves a working
copy. For ACT the backend is composite: the run's **REX working-copy
directory** at `/`, writable; the source repository mounted at `/source/`,
readable and never writable. This is the samples' own shape
(`5_backends/4_composite_backend.py:34-43`), with a different default:

```python
backend = CompositeBackend(
    default=FilesystemBackend(root_dir=work_dir, virtual_mode=True),
    routes={"/source/": FilesystemBackend(root_dir=repo, virtual_mode=True)},
)
permissions = [
    FilesystemPermission(operations=["write"], paths=["/source/**"], mode="deny"),
]
```

The agent sees the copy as its world and the original as a read-only mount.
This is the same shape spec 44 §9.3 gives Codex, with the backend doing what
the sandbox does there. Spec 22's before-and-after scan stays as defence in
depth and as the source of newly touched paths.

Milestone 2 is a gate. It must prove that `/source/**` refuses every write
under every path spelling the backend accepts — including the prefix-stripping
quirk the samples record, where a missing `/memories/profile.md` is reported as
`/profile.md` (`5_backends/README.md:46-66`) — and that every intended working
copy is writable. Until it passes, `supports_act` is false, Deep Agents ACT is
visibly disabled, and ASK is unaffected — spec 43 §8.1.

### 8.3 No silent downgrade

Spec 43 §10.2 applies unchanged. If a route cannot stream tool calls or the
model never emits one, REX says so. It never retries through another adapter
or against `api.openai.com`.

---

## 9. Capabilities

```python
RouteCapabilities(
    models=[...configured models, exactly as typed],
    styles=[],
    supports_styles=False,
    supports_plugins=False,
    supports_cost=False,
    supports_ask=True,
    supports_act=False,      # until milestone 2's proof passes
    supports_resume=False,   # §7
    error=None,
)
```

Styles and plugins are Claude features. Main rejects a non-null style and a
non-empty plugin list sent here; the renderer hides both controls.

---

## 10. What changes in specs 43, 44 and 46

Three lines:

1. The agent control (spec 44) gains a fourth row, from `list_sdks()`.
2. The Deep Agents column of the catalogue is `{host}/v1` for `builtin` and
   `litellm` — the two LiteLLM kinds, which spec 46 §3 already gives one set of
   route templates.
3. `Original`'s `deep-agents` route carries a typed model list (§4.4), and the
   sheet says under it that this SDK uses an API key.

**Spec 46 itself needs no change**, which is worth stating rather than assuming.
`EVERY_SDK` in `migrate.ts` already lists `deep-agents`, the
`gateway_route.sdk` check already admits it, and the migration already wrote the
built-in gateway's `deep-agents` row at `http://127.0.0.1:24334/v1` with
`environment` auth. Turning this spec on adds an adapter and touches no gateway.

---

## 11. Files

```text
agent-runner/src/agent_runner/adapters/deep_agents/
├── adapter.py     create_deep_agent, the stream task, the run result
├── model.py       §4 — route → ChatOpenAI or ChatAnthropic, the provider:model split
├── backend.py     §5.1, §8.2 — the ASK backend, the ACT composite, READ_ONLY
├── policy.py      §5.2 — the middleware, and the interrupt_on fallback if needed
├── tools.py       §5.3 — the CommonTool mapping, pure and separately tested
└── events.py      §6 — graph output → AgentEvent
```

One entry in `run.py`'s adapter map (spec 42 §6.1). Nothing under `src/main/`
changes but `bridge.ts`'s pass-through of the fourth SDK name, which it already
does not special-case. Tests are `agent-runner/tests/test_deep_agents_*.py`:
the mapping, the backend rules against a temporary directory, and recorded
graph output → `AgentEvent`.

---

## 12. Evidence

### 12.1 The reviewer's samples, and what REX does with each

Read 2026-09-04. Eight lessons, each a `uv` project on `deepagents` 0.6.12,
`langchain[openai]` 1.3.11, Python 3.12. Every lesson shares one `model.py`.

| The sample does | Where | REX |
|:--|:--|:--|
| `ChatOpenAI(model=MODEL_ALIAS, base_url=BASE_URL, api_key=API_KEY, temperature=…)` | `1_basics/model.py:60-65` | §4.1, the same call with the route's values |
| `LITELLM_BASE_URL` default `http://localhost:4000/v1`, alias `unsloth-gemma-26b` | `model.py:41-51` | a route's `base_url` and `models`; note the course's LiteLLM is a **different instance** from `ai-gateway`'s on 24000, and both are different again from REX's own on 24334. Three LiteLLMs, one product |
| `create_deep_agent(model=, system_prompt=, tools=, subagents=, backend=, skills=, interrupt_on=, checkpointer=)` | `1_basics/main.py:11`, others | §5 — `model`, `system_prompt`, `backend`, `permissions`, `middleware`, `checkpointer`; no `subagents`, no `skills` |
| `FilesystemBackend(root_dir=WORKSPACE, virtual_mode=True)` | `5_backends/2_filesystem_backend.py:31` | §5.1, rooted at the working directory |
| `CompositeBackend(default=StateBackend(), routes={"/workspace/": FilesystemBackend(...)})` | `5_backends/4_composite_backend.py:34-43` | §8.2, with the copy as default and `/source/` mounted |
| `agent.stream(..., stream_mode="updates")`, then `node_output["messages"]`, `message.tool_calls`, `isinstance(message, ToolMessage)` | `2_custom_tools/main.py:44-69` | §6's table, on `astream` |
| `config={"recursion_limit": 50}` because the default is 9999 | `1_basics/main.py:34-36` | `2 * max_turns + 1` |
| `interrupt_on={"write_file": True}`, `InMemorySaver()`, `result["__interrupt__"]`, `Command(resume={"decisions": [...]})` | `7_human_in_loop/main.py:11-50` | §5.2's fallback |
| `{"configurable": {"thread_id": "..."}}` on every call | `5_backends/1_state_backend.py:47-55` | §7 |
| no `permissions=`, no tool restriction anywhere | every lesson | REX adds both — §5.1 |
| lessons 4 and 8 need the proxy's `custom_callbacks.py`, because Unsloth rejects the `name` field on subagent messages | `3_deepagents/README.md:77-90` | why `task` is denied — §5.3 |
| the 26B alias, because a deep agent hands the model ten tools at once and the 4B aliases "lose the plot" | `README.md:54-59` | why `unsloth-26b` is the model to spike on |
| `write_todos` listed as a built-in; `result["todos"]` read back | `README.md:10-15` | §5.3 — denied by name if present at 0.7.13 |

### 12.2 The Python API, from its documentation

Read 2026-09-04 at `docs.langchain.com/oss/python/deepagents/permissions` and
`docs.langchain.com/oss/python/langchain/middleware/custom`:

- `permissions=` takes a list of `FilesystemPermission` (imported from
  `deepagents`) with `operations` (`"read"`, `"write"`), `paths` (glob
  patterns) and `mode` (`"allow"`, `"deny"` or `"interrupt"`). "Rules are
  evaluated in declaration order. The first matching rule wins. If no rule
  matches, the operation is allowed." `"read"` covers `ls`, `read_file`,
  `glob`, `grep`; `"write"` covers `write_file`, `edit_file`, `delete`.
- The read-only example is exactly §5.1's rule:
  `FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")`.
- Permissions apply only to the built-in filesystem tools — not custom tools,
  not MCP tools, and not sandbox `execute` commands. That sentence is why §5
  has no shell.
- How a denial is reported to the model is **not specified**; `mode="interrupt"`
  raises a human-in-the-loop interrupt instead.
- `wrap_tool_call` is `from langchain.agents.middleware import wrap_tool_call`
  as a decorator, or `AgentMiddleware.wrap_tool_call(self, request, handler)`,
  with `request.tool_call["name"]`, `["args"]`, `["id"]`, `request.tool`,
  `request.state`, `request.runtime`; `handler` is
  `Callable[[ToolCallRequest], ToolMessage | Command]` and the hook returns
  `ToolMessage | Command`. `ToolMessage` is `from langchain.messages import ToolMessage`.
- **The page shows no example that returns without calling `handler`, no
  `status="error"`, and no `awrap_tool_call`.** The type admits the
  short-circuit; the documentation does not demonstrate it. §5.2 carries the
  fallback for that reason.

### 12.3 The gateway side — what is measured, and against what

**The model half is measured; the proxy half is not.** Version 2.0 cited two
gateways that are no longer the target, and the distinction is worth keeping
straight, because one of the two findings survives the change and the other does
not.

**Survives.** Spec 43 §15.1: the engine streams `tool_calls` deltas with
fragmented `arguments`, and `unsloth-26b` spends tokens on a reasoning block
before it answers, so the client's `max_tokens` must be generous — which is why
§4.1's snippet sets 8192. Those are properties of the model and hold whatever
proxy is in front of it.

**Does not survive.** The routes themselves. `POST :24000/v1/chat/completions`
was the reviewer's own LiteLLM, which is a `litellm` gateway and not this spec's
target; `http://localhost:26000/v1` was his Envoy; and REX's own Envoy on 26334
was deleted with `infra/` on 2026-09-06. No measurement has been taken through
the built-in gateway.

One base URL backs a Deep Agents route now:

| Base URL | Model id | Auth |
|:--|:--|:--|
| `http://127.0.0.1:24334/v1` | whatever is ticked, as `<provider>-<slug>` | Environment variable · `REX_GATEWAY_KEY` |

Spike against it by switching it on in Settings. Read the port from the running
gateway rather than assuming 24334 — spec 46 §4.2 walks to 24343 if it is taken.

### 12.4 What is still unproven

0. **Whether LiteLLM passes streaming `tool_calls` deltas through untouched**,
   what an unknown alias answers, and whether `REX_GATEWAY_KEY` is accepted —
   all through `127.0.0.1:24334`. This is item zero because §4.1's whole design
   rests on it, and **it is the same measurement spec 47 §10.0 needs**: take it
   once, record it in both. If it fails, the fault is in spec 46 and neither
   adapter should be built on top of it.

1. Whether `wrap_tool_call` may short-circuit by returning a `ToolMessage`
   without calling `handler`, whether an async form of the hook exists, and
   whether it wraps a subagent's calls (§5.2). The type admits the first; the
   documentation shows none of the three.
2. How a `permissions` denial reaches the model — an error result to the tool,
   a raised exception, or an interrupt. The documentation does not say. It
   decides whether layer 2 alone produces a `tool_result` the transcript can
   draw.
3. Whether the engine's `delta.reasoning_content` reaches
   `additional_kwargs` through `ChatOpenAI`, or is dropped. It decides §6's
   `thinking` row.
4. What cancelling the stream's task mid-tool does: whether the tool finishes
   first, the graph raises `CancelledError` cleanly, or a thread pool keeps
   running the tool after the run has reported `stopped`.
5. Whether `usage_metadata` is populated through the built-in gateway. Spec 46
   §4.6's traffic log records the token counts and the cost per request, so
   this is also the check that the two agree.
6. The `recursion_limit` arithmetic in §6.
7. Whether `write_todos` is on by default at 0.7.13 (§5.3).
8. One real Deep Agents turn end to end, through spec 42's service, with a tool
   call landing and a write refused.

---

## 13. Acceptance criteria

1. A reviewer can add a Deep Agents route to a gateway, with a chat API URL, a
   model list and an authentication choice.
2. `SDK / account default` is refused for a route with an explicit URL, with a
   sentence saying why; on `Original` it names the environment variable it will
   read, and refuses before a run when that variable is unset.
3. A Deep Agents send creates no process beyond the service itself and touches
   no file outside the backend's `root_dir`.
4. An unmapped tool name is denied by the policy and named in the denial;
   `task` is denied by name.
5. ASK cannot change the reviewed repository, `~/.rex/work`, `.git`, or
   anything outside the workspace, under a deliberately hostile prompt — and
   the attempt is one `denied` event and one `tool_result` marked `denied`.
6. ACT changes only REX working copies; `/source/**` refuses every write;
   originals are byte-for-byte unchanged before approval; approve, discard and
   undo behave as they do under Claude.
7. Every send starts a fresh graph seeded with the replay, the composer says so
   once per combination, and `session_exists` answers false.
8. Stop cancels the stream and emits one `stopped` event, not an error.
9. The style and plugin controls are hidden for a Deep Agents route, and a
   non-null style or a non-empty plugin list sent to one is rejected rather than
   ignored.
10. Cost is always drawn as unknown, never as `$0.00`; tokens are shown when the
    gateway reports them.
11. No credential value appears in a client object that outlives the run, in
    `os.environ`, in a `log` message, or in a debug report.
12. A Claude route and a Deep Agents route run at the same time in one service
    without exchanging URLs, models, credentials or session ids.
13. A Deep Agents run through the built-in gateway appears in the traffic log
    (spec 46 §4.6) under this thread's `x-rex-thread`.
14. `grep -rn "24334\|localhost" agent-runner/src/agent_runner/adapters/deep_agents/`
    finds nothing. The port is spec 46's and it moves; `ChatOpenAI` gets
    `route.base_url` and the adapter knows nothing else.
15. With the built-in gateway switched **off**, a route to it refuses with a
    sentence naming the switch rather than a connection error.
16. One model ticked once in Settings is usable by a Deep Agents route and by a
    Claude route, under the same name — spec 46 §4.5's one-alias rule, which is
    what makes a per-SDK model list unnecessary.

---

## 14. Deliberately out of scope

- A shell for the deep agent — `LocalShellBackend` or any sandbox backend.
  Nothing in 3.0 has a second layer in front of `execute`.
- **Any gateway but the built-in one.** As in spec 47 §12 this limits the
  EVIDENCE and not the design: the adapter takes a base URL and an auth choice
  and may not test what is behind them. An external `litellm` route is
  configuration a reviewer types, and if it fails that is a bug in this
  adapter's gateway independence.
- **Reviving the `envoy` or `custom` gateway kinds.** They were removed by spec
  46 §3.1 and `infra/` was deleted on 2026-09-06. Three kinds exist.
- Subagents, `skills`, `memory` (`AGENTS.md`), `StoreBackend`, MCP tools, and
  custom tools. Each is a lesson in the samples and none is a review comment's
  need.
- A durable checkpointer (§7).
- Translating between protocols, or running a gateway.
- Anything spec 43 §14 already excludes.

---

## 15. Milestones

### 0 — prove the deep-agent seam

A throwaway, non-UI spike through spec 42's service, against the built-in
gateway on `http://127.0.0.1:24334/v1` with `REX_GATEWAY_KEY` and a model ticked
in Settings. Switch the gateway on there rather than starting anything by hand,
and read the port from it rather than assuming 24334 (spec 46 §4.2). The three
dependencies are added with `uv add` only after the reviewer confirms them (§3).

0. Take §12.4 item 0 first — streaming `tool_calls` through LiteLLM intact, an
   unknown alias, and the key being accepted. **If this fails, stop**: the fault
   is spec 46's, and every item below would be measuring a broken pipe. Record
   the result in spec 47 §10.0 too; it is the same measurement.
1. Stream one turn with one tool call landing, through `ChatOpenAI`.
2. Attempt a `write_file` under `READ_ONLY` and record what comes back — §12.4
   item 2.
3. Deny a call from the middleware and record whether `handler` was skipped and
   whether the async form exists — §12.4 item 1; if either fails, switch to the
   `interrupt_on` fallback and record that.
4. Set the stop event mid-tool and record what the stream did — §12.4 item 4.
5. Record `usage_metadata`, `reasoning_content`, the `recursion_limit`
   arithmetic and the `write_todos` default — §12.4 items 3, 5, 6 and 7.

*Gate:* no UI work before all nine items of §12.4 are recorded here.

### 1 — Deep Agents ASK

The dependencies, `model.py`, `backend.py`, `policy.py`, `tools.py`,
`events.py`, the read boundary, cancellation, the fourth row in the agent
control, and the transcript and debug labels.

*Done when:* a Deep Agents route answers a real comment on a real document
through the built-in gateway, stops, runs at the same time as a Claude route,
and the §8.1 hostile prompt changes nothing — with every request visible in the
traffic log (spec 46 §4.6) under this thread's `x-rex-thread`, which is also
the check that the run really went through REX's own gateway.

### 2 — Deep Agents ACT

Only after §8.2's boundary proof. The composite backend, `wrote` and `diff`
events from the two write tools, and the existing working-copy accounting.

*Done when:* hostile prompts cannot change `/source/**`, ACT changes only
intended working copies, and approve, discard and undo match the other
adapters.
