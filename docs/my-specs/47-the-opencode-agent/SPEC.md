# REX 47 — the OpenCode agent

**Version:** 4.0 · 2026-09-07
**Status:** **proposal. Nothing in this spec is built.**
**Depends on:** [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
— the Python package, the pipe, `AgentEvent`, the policy round trip,
`AgentSession`, `AgentAdapter`; [`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md)
— the gateway rows, the controls, the session model, the child environment;
[`44-the-codex-agent/SPEC.md`](../44-the-codex-agent/SPEC.md) — the agent
control, whose third row this spec is;
[`46-the-builtin-gateway/SPEC.md`](../46-the-builtin-gateway/SPEC.md) — **the
gateway this spec is now proved against**, and the only one it targets.
**Also:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §8 (one thread, one agent,
one session); [`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §6 (the
gate); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md) §2
(cancellation); [`21-the-file-the-agent-creates/SPEC.md`](../21-the-file-the-agent-creates/SPEC.md)
(files a run leaves behind); [`22-the-whole-workspace/SPEC.md`](../22-the-whole-workspace/SPEC.md)
§3 (working copies).

> [!note]
> **The local path exists, and there is exactly one of it: REX's own.** The
> built-in gateway of spec 46 — LiteLLM inside REX, on
> `http://127.0.0.1:24334/v1`, switched on in Settings and needing nothing
> installed. Spec 46's migration already writes the `opencode` route for it, at
> that URL, with `auth = 'environment'` and `credential_env = REX_GATEWAY_KEY`.
>
> **One gateway to prove it on, not one gateway it works with.** The adapter
> reads a base URL and knows nothing else; §12 says so as a rule. What is
> narrowed is the evidence — an external LiteLLM and the engines' own ports get
> no measurement and no milestone. The reviewer, 2026-09-05: "We should be
> gateway-independent but we are going to test it out and work primarily, for
> now, with [one gateway] from the start." That sentence still governs; only
> which gateway has changed.
>
> **What changed in 4.0.** The target moved. Version 3.0 was written against
> REX's Envoy in `infra/envoy` on port 26334, and spec 46 replaced it: `infra/`
> was deleted on 2026-09-06 and the `envoy` gateway kind no longer exists —
> three kinds remain, `original`, `builtin` and `litellm`. Three consequences
> run through this spec:
>
> - **The URL and the port.** `http://127.0.0.1:24334/v1`, not
>   `http://localhost:26334/v1`, and it walks to 24343 if the port is taken
>   (spec 46 §4.2), so nothing here may hardcode the number.
> - **Authentication is no longer "none".** The Envoy authenticated no caller.
>   The built-in gateway mints a master key per launch and REX passes it to the
>   child in `REX_GATEWAY_KEY`, so an OpenCode route to it is
>   `Environment variable` — the branch §4's config snippet already has.
> - **The measurements in §10 were taken against a gateway that is gone.** They
>   are kept as history in §10.0b, because what they prove is a property of the
>   *models* and not of the proxy; §10 says plainly which numbers still need
>   re-taking against 24334, and milestone 0 is where that happens.
>
> **What 3.0 established and still stands.** The library is Python (spec 42
> v3.0), and this adapter uses **no SDK package at all**. PyPI's `opencode-ai`
> is a stale alpha (0.1.0a36), and OpenCode's server is plain HTTP and SSE, so
> `adapters/opencode/client.py` is REX's own `httpx` client — about 300 lines,
> modelled on the reviewer's course client, covering only the endpoints §3
> lists. The reviewer, 2026-09-04: "having our own Python client for this
> OpenCode HTTP server is fine with me. I don't need to have some wrapper
> library just to communicate via HTTP." The launcher and the project mirror
> are Python too, and the launcher's `OPENCODE_CONFIG_CONTENT` mechanism comes
> from the same course client. Version 2.0 had renumbered this spec from 44 and
> dropped MLflow; both stand.

---

## 1. Why

Spec 42 built the seam, spec 43 gave the Claude adapter a gateway, spec 44
filled in Codex and added the agent control, and spec 46 replaced every external
gateway with one REX runs itself. This spec fills in `opencode`. The schema does
not change: `AgentSdk` already carries `'opencode'` (spec 42 §5.1), the
`gateway_route.sdk` check already admits it (spec 43 §2.2), and **the route
already exists** — spec 46's migration writes an `opencode` row for the built-in
gateway pointing at `http://127.0.0.1:24334/v1`, because §4.5 of that spec makes
one LiteLLM alias answer all four SDKs from the same `model_name`.

That last point is what spec 45 left open — "which listed name suits which
SDK" — and it now has no instances. A model the reviewer ticks in Settings is
one string that OpenCode can use, over `/v1/chat/completions`, without anybody
choosing a per-SDK name.

OpenCode is different from the other two in one structural way, and every
decision below follows from it.

---

## 2. Two planes, and only one of them is the setting

The Claude and Codex SDKs spawn a CLI child that talks to the model API. OpenCode
has one more hop: a client talks HTTP and SSE to an **OpenCode server**, and
that server talks to the model API.

```text
service -> REX's HTTP client -> loopback OpenCode server -> configured model API
                                transient server URL       route.base_url
```

**`route.base_url` always names the model API**, exactly as it does for Claude
and Codex. The library starts and owns the OpenCode server on `127.0.0.1` with
an ephemeral port. That transient control URL is not editable and is not stored
on the route; showing it as "API URL" would make one field mean two different
things on different rows.

The route editor (spec 43 §4.5) says so:

> **OpenAI-compatible model API base.** This often ends in `/v1`. REX starts the
> OpenCode server itself, on loopback.

Attaching REX to a separately managed or shared `opencode serve` is out of scope
(§12). It would need a second URL, an ownership rule for shutdown, a trust
decision about that server's config and plugins, and isolation between
reviewers.

### 2.1 The executable

`OPENCODE EXECUTABLE` appears in the gateway sheet when an OpenCode route exists.
Its default is `Auto-detect`; an advanced override takes an absolute path. The
value is app-wide (`setting.agent.opencode_executable`) and is **not** part of a
route, because every OpenCode route must use the same server version. Main
reports the detected version beside it.

No package contains the `opencode` executable. Resolution checks the override
first, a REX-bundled binary second, and normal install locations and `PATH`
last. Milestone 0 records whether the binary can be redistributed with the
packaged app. If it cannot, the sheet links the prerequisite and reports
OpenCode as unavailable — REX does not install software during a run.

The host passes the resolved path to the library in the run request; the
library never searches for it. Searching a machine is a host decision, and
spec 42 §3.2 keeps the library out of REX's settings.

---

## 3. The client

The adapter's only dependency is `httpx`, async. There is no SDK: the course's
Python track is a hand-written client by design (§10.3), and REX's is the same
thing cut down to what a review comment needs.

`adapters/opencode/client.py` covers these endpoints and no others, each read
from the course client
(`~/Projects/Github/lukaskellerstein/vibe-coding-course/50_opencode_sdk/python/opencode_course/client.py`):

| REX needs | Method and path | Body or params | Course client |
|:--|:--|:--|:--|
| health, during launch | `GET /global/health` | — | `:45-46`, polled at `:428-441` |
| create a session | `POST /session` | `{ title }` → `{ id, … }` | `:69-70`, `:515-517` |
| validate a stored session | `GET /session/{id}` | — | `:78-79` |
| prompt, fire-and-forget | `POST /session/{id}/prompt_async` | `{ parts: [{ type: "text", text }], model?, system?, tools? }` | `:103-104` |
| prompt, blocking (spike only) | `POST /session/{id}/message` | the same body → the assistant message | `:100-101`, `:520-526` |
| history, for reconciliation | `GET /session/{id}/message` | `?limit=` → `[{ info, parts }]` | `:94-95`, `:537-542` |
| all session states | `GET /session/status` | → `{ [id]: { type: "busy" \| "retry" \| "idle" } }` | `:75-76`, `:533-535` |
| stop | `POST /session/{id}/abort` | — | `:106-107` |
| the event bus | `GET /event` | SSE; `data:` lines, one JSON each | `:290-299` |
| answer a permission | `POST /permission/{id}/reply` | `{ reply: "once" \| "always" \| "reject", message? }` | `:162-166` |
| provider discovery, no-URL routes only | `GET /config/providers` | → the resolved provider list | `:56-57` |

Every request carries `?directory=<mirror>` — the course client sets it as a
default query parameter on every call (`:347-350`) — and that is how the server
knows which project a session belongs to. The client is about 300 lines: one
`httpx.AsyncClient` with `base_url`, one `request()` that raises on
`is_error`, the eleven calls above, and the SSE loop.

SSE is parsed by hand, exactly as the course does (`:290-299`): open
`GET /event` as a stream, iterate `aiter_lines()`, and `json.loads` every line
that starts with `data:`. There is no reconnect logic and no need for one: the
subscription lives exactly as long as the run, and the adapter closes it.

The parts REX reads are Pydantic models in `client.py`, and only those:

| Model | Fields REX reads | From |
|:--|:--|:--|
| `TextPart` | `type: "text"`, `text` | `message.part.updated`, history |
| `ReasoningPart` | `type: "reasoning"`, `text` | the same |
| `ToolPart` | `type: "tool"`, `tool`, `callID`, `state.status` (`pending`, `running`, `completed`, `error`), `state.input`, `state.output`, `state.error` | `message.part.updated` |
| `PartDelta` | `field`, `delta`, `sessionID` | `message.part.delta` |
| `PermissionRequest` | `id`, `sessionID`, `permission`, `metadata` | `permission.asked`, `permission.v2.asked` |
| `MessageInfo` | `id`, `role`, `time.completed`, `tokens`, `cost` | history and `message.updated` |

Unknown part types and unknown event types are dropped, never guessed, and
never crash the stream — spec 42 §7's fifth rule. The exact union is pinned
with recorded fixtures in `agent-runner/tests/test_events.py`, because
1.18.x exposes both a legacy and a newer permission event.

---

## 4. An explicit gateway becomes a private provider

For an explicit URL, the adapter supplies one private provider inline. The
entered model stays the upstream model id; the provider prefix is an
implementation detail the reviewer never types, and it is a constant because
each server is built for exactly one route (§5.1) — a `ResolvedRoute` carries
the gateway's name, not its id, and nothing here needs one.

```python
PROVIDER = "rex"

config = {
    "model": f"{PROVIDER}/{request.model}",
    "small_model": f"{PROVIDER}/{request.model}",
    "enabled_providers": [PROVIDER],
    "share": "disabled",
    "autoupdate": False,
    "provider": {
        PROVIDER: {
            "name": route.gateway_name,
            "npm": "@ai-sdk/openai-compatible",
            "options": {
                "baseURL": route.base_url,
                **({"apiKey": "{env:REX_AGENT_TOKEN}"} if route.auth == "environment" else {}),
            },
            "models": {request.model: {"name": request.model}},
        },
    },
}
```

`model` and `small_model` are both set to the chosen model. OpenCode uses the
small model for titles and summaries, and leaving it inherited would turn one
local-model choice into an unnoticed cloud request — which spec 43 §10.2
forbids. Sharing and auto-update are off in the agent server.

The config passed inline is the `opencode.json` schema, layered on top of the
reviewer's global file — which is why an explicit-URL route also gets isolated
config directories (§5.1), so the layering has nothing underneath it.

**`SDK / account default` is refused for an explicit OpenCode URL.** A newly
generated private provider has no vendor credential convention to inherit, so
`Environment variable` or `No authentication` is required. A route with no URL
can use credentials from `opencode auth login` or the provider's normal
environment.

For `base_url: None` the model must be in `provider/model` form. The adapter
splits it at the first slash and synthesizes no provider. `inherit` lets normal
OpenCode provider configuration resolve it. `environment` overlays only that
provider's `options.apiKey` with `{env:REX_AGENT_TOKEN}`; it does not replace
the provider implementation or its other options.

Version 3.0 supports the `@ai-sdk/openai-compatible` package for custom URLs
and no other. A later revision can expose a reviewed allow-list. **It must never
accept an arbitrary npm package name from IPC and load that code on the
reviewer's machine.** The pinned package must be present in the packaged
OpenCode runtime before a run starts; OpenCode is not allowed to satisfy it with
an implicit npm download after Send is pressed.

---

## 5. Server, session and stream lifecycle

### 5.1 The server

The library owns a small explicit launcher, `adapters/opencode/server.py`. It
is the course client's `start_server()` (`:459-484`) with a per-child
environment and isolated directories:

```python
process = await asyncio.create_subprocess_exec(
    executable, "serve", "--hostname=127.0.0.1", f"--port={port}",
    cwd=mirror, env=child_env,
    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
)
```

1. bind a free loopback port and release it — the course's `_free_port()`
   (`:415-418`);
2. build `child_env` by spec 43 §6.2's rule — the defined string values of the
   service's own environment, with only these keys changed:
   `OPENCODE_CONFIG_CONTENT` carrying §4's config as JSON (the course sets it
   at `:467-468`), `REX_AGENT_TOKEN` carrying `route.token` when the route's
   auth is `environment`, and for an explicit-URL route `XDG_CONFIG_HOME`,
   `XDG_DATA_HOME` and `XDG_CACHE_HOME` pointing at directories the host
   supplied in the run request, so global providers and plugins cannot alter
   the route;
3. spawn with the mirror (§5.2) as the working directory, and drain `stdout`
   and `stderr` into the service's own `stderr`, so a server crash lands in
   `rex.log` (spec 42 §4.1);
4. poll `GET /global/health` until it answers or the process exits — the
   course's `_wait_healthy()` (`:428-441`), which reports the exit status
   rather than a timeout with nothing;
5. hand back a `client.py` instance bound to `http://127.0.0.1:{port}` and the
   mirror.

`close()` is the course's (`:402-412`): `terminate()`, wait five seconds, then
`kill()`.

The token is never substituted into JSON, a log, or a command-line argument.
`{env:REX_AGENT_TOKEN}` stays in the provider config and OpenCode resolves it
from the child's own environment.

One server is cached per route — keyed by the gateway's name, the base URL and
the auth, which is everything the config is built from — started on demand,
and closed when the service receives `shutdown` (spec 42 §4.2). The registry
is the one piece of state the library keeps beyond a run, and it is allowed
because it is OpenCode's process, not REX's data — spec 42 §3.2 says so. An
edited gateway builds a different config and therefore a different server; the
old one is closed when its last session ends. A no-URL `inherit` route
deliberately reads the reviewer's normal OpenCode configuration and gets no
isolated directories.

### 5.2 The project mirror

Each client sets its `directory` to a stable per-thread OpenCode project mirror
under a directory the host supplies — **never the reviewed repository**.

This matters even for ASK. OpenCode bootstraps `.opencode/package.json` and
plugin dependencies in its project directory before the model answers, so a
client pointed at the repository writes into it during a read-only question. The
mirror holds the thread's source snapshot, lasts as long as its OpenCode session,
and is excluded from every review diff. `adapters/opencode/mirror.py` reconciles
reviewed source changes and pending REX working copies before each later turn.

The mirror stays in the library because it is *OpenCode's* requirement rather
than REX's: any host that runs OpenCode against a directory it does not want
written needs one. The host passes the directory to use; the library never
picks one.

### 5.3 Sessions

Spec 42 §5.5's three session modes map onto three HTTP calls:

| `AgentSession` | Call |
|:--|:--|
| `{ mode: "seed", id }` | `POST /session` — **the supplied id is discarded** |
| `{ mode: "new" }` | `POST /session` |
| `{ mode: "resume", id }` | `GET /session/{id}`, then prompt |

For a new thread the adapter creates the session with a per-session permission
ruleset and returns the server's `id` in `RunResult.session_id`; REX stores it
in the `thread_session` row for this (thread, `opencode`, gateway) triple —
spec 43 §5.2 — and per spec 43 §5.5 **only the ASK and reply path stores it.**
An ACT, DOCX or PPTX run discards its id, exactly as those callers already
discard the deterministic Claude one.

For a reply the adapter calls `GET /session/{id}` to validate the stored id,
updates the permission ruleset for that run's profile, and prompts the same
session. That call is also the adapter's `session_exists` (spec 42 §6.1), so a
session the server has lost — a 404 — sends REX down the replay path with the
route unchanged.

OpenCode sessions are server-side, so no in-memory object has to survive an app
restart. Milestone 0 must prove resumption after both a server restart and a
service restart, against the isolated data directory.

### 5.4 The stream

The adapter opens `GET /event` **before** it calls
`POST /session/{id}/prompt_async`, and reads until `session.idle` for its own
session.

OpenCode's event bus is server-wide. Every message, permission, status and idle
event is discarded unless `properties.sessionID` equals this run's session id
— the course's own filter (`5_events/2_live_progress.py:17-19`). Two comments
running at once on one route share a server, so this filter is not a tidiness
rule — without it one comment's answer lands in the other's transcript.

On `session.idle` the adapter fetches `GET /session/{id}/message` and
reconciles finished parts, so an SSE disconnect cannot leave a successful
answer half-written; then it closes the stream. On stop — spec 42 §6.1's
`stop` event set by the service — it calls `POST /session/{id}/abort`, waits
for the idle, and emits the one `stopped` event.

---

## 6. OpenCode events become `AgentEvent`s

The adapter emits spec 42 §7's union and nothing else. `message.part.delta`
updates ephemeral text or reasoning. Terminal `message.part.updated` tool states
become the same `tool_call` and `tool_result` events the other adapters emit.

| OpenCode part or event | `AgentEvent` |
|:--|:--|
| text part, completed | `text` |
| reasoning part, completed | `thinking` |
| tool part, pending or running | ephemeral — nothing emitted |
| tool part, completed or error | `tool_call` with the §7.1 `common` name, then `tool_result`, or one with `is_error` |
| `edit`, `write` or `patch` completed | `wrote` for each path, and `diff` where the part carries before and after |
| file part | dropped; never invented prose |
| `permission.asked` or `permission.v2.asked` | ask the policy (§7.1), reply through `POST /permission/{id}/reply`, and emit `denied` on a rejection |
| `session.error` or an assistant error | `error`, keeping the original text |
| `session.idle` | `completed`, after history reconciliation, with the assistant message's `tokens` and `cost` |

OpenCode assistant messages report tokens and sometimes report cost. Missing
cost is `None`, never zero.

`bridge.ts` does the rest: `text` becomes an assistant row, `denied` joins the
`Denial` list, `completed` becomes the foot. Nothing OpenCode-shaped crosses the
pipe.

---

## 7. Safety

### 7.1 The mapping is the library's; the decision is REX's

Spec 42 §8 recorded the trap, and it bites harder here than anywhere else:
`gateDecision()` matches `Write`, `Edit`, `NotebookEdit`, `Bash` and `mcp__*`,
and **returns allow for any name it does not know**. OpenCode's tools are
lowercase — `edit`, `write`, `patch`, `bash`, `read`, `grep`, `glob`, `list`,
`webfetch`, `task`. Every one of them would fall straight through into allow.

So `adapters/opencode/tools.py` maps into the common vocabulary before the
policy is asked, and the mapping is closed:

| OpenCode tool | `CommonTool` | Input the policy reads |
|:--|:--|:--|
| `bash` | `shell` | `{ command }` |
| `edit`, `patch` | `edit` | `{ file_path }` |
| `write` | `write` | `{ file_path }` |
| `read` | `read` | — |
| `glob`, `list` | `list` | — |
| `grep` | `search` | — |
| `webfetch` | `fetch` | — |
| `task` | `task` | — |
| anything else | `None` | — |

REX's policy — spec 42 §8's `policyFor()` — denies `common: None` for every SDK
but Claude, so a new OpenCode tool is a visible refusal with a name in it, not a
silent hole. REX's read policy also denies `fetch` and `task` by name for this
SDK, as it did before: a read session does not leave the machine and does not
spawn a subagent.

A `permission.asked` event is answered from the same decision, through the
`ask_policy` callback of spec 42 §6.1: `once` when the policy returns `None`,
`reject` with the reason otherwise. **The adapter never answers `always`** —
the server is shared across a route's sessions, so `always` would change the
rules for another comment.

### 7.2 Permissions are policy, not a sandbox

This is the honest difference between OpenCode and Codex, and it decides the
whole shape of §7.4. Codex has an operating-system sandbox; OpenCode has
prompts. A permission ruleset is a policy the server applies to a cooperating
agent, and a shell command that the ruleset allowed can do anything the process
can do.

REX therefore uses three layers and does not pretend any one of them is enough:

1. the per-session OpenCode ruleset, built from `RunRequest.disallowed`;
2. REX's own policy, through §7.1's mapping; and
3. an operating-system boundary that makes the reviewed repository unwritable by
   the server process.

Permission requests are filtered by session id before the adapter answers.

### 7.3 ASK

REX's read profile passes `disallowed: ["write", "edit"]` (spec 42 §6). The
adapter turns that into a session ruleset with `read`, `glob`, `grep` and `list`
allowed, and `edit`, `write`, `patch`, `bash`, `external_directory` and every
other mutating tool denied. Its client directory is the disposable mirror from
§5.2, not the reviewed repository.

That protects the repository from the model's tool calls **and** from OpenCode's
own bootstrap writes. Milestone 1 must prove with a deliberately hostile prompt
that ASK cannot change the reviewed repository, `~/.rex/work`, `.git`, or
anything outside the workspace — and the proof must include the `.opencode`
bootstrap, which is a write nobody asked for.

### 7.4 ACT

OpenCode ACT combines all three layers of §7.2: `edit` allowed inside the
mirror, `external_directory` denied, `bash` asked and answered by the policy,
and an OS boundary that makes the reviewed repository unwritable from the
server process.

At turn end REX compares the mirror to its pre-turn snapshot and turns eligible
text changes into the existing spec 22 working copies. The `.opencode` bootstrap
area is excluded.

Milestone 2 is a gate. If that containment is not proven on a packaged platform,
`supports_act` is false there: OpenCode ASK stays available and OpenCode ACT is
visibly disabled — spec 43 §8.1.

### 7.5 Capabilities

```python
RouteCapabilities(
    models=[configured model, or GET /config/providers for a no-URL route],
    styles=[],
    supports_styles=False,
    supports_plugins=False,
    supports_cost=True,       # reported when the provider reports it
    supports_ask=True,
    supports_act=False,       # until milestone 2's proof passes, per platform
    supports_resume=True,
    error=None,
)
```

`supports_styles` and `supports_plugins` are both false: OpenCode plugins are
not Claude plugins, and a style sent here is rejected rather than ignored —
spec 43 §4.4. Discovery asks OpenCode's own server for its resolved
configuration, never the model gateway directly. Availability also covers the
detected executable and its version. A failed probe never removes the
configured model (spec 43 §8).

---

## 8. What changes in specs 42, 43, 44 and 46

Two lines, as in spec 44: `run.py`'s adapter map (spec 42 §6.1) gains an
`opencode` entry, and `list_sdks()` (spec 42 §10) gains a third row, which spec
44's agent control draws with no edit. A gateway with an `opencode` route
reveals `OPENCODE EXECUTABLE` (§2.1) and changes that row's help text (§2).

**Spec 46 needs no change at all**, and that is worth stating rather than
assuming. Its migration already writes the `opencode` route for the built-in
gateway, `EVERY_SDK` in `migrate.ts` already lists it, the `gateway_route.sdk`
check already admits it, and §4.5's one-alias rule means no new model naming.
Turning this spec on is adding an adapter, not touching the gateway.

`RunRequest` (spec 42 §6) maps onto OpenCode without a new field:
`system_prompt` becomes the prompt's `system`; `disallowed` becomes the
permission ruleset (§7.3); `plugins` is refused because `supports_plugins` is
false; `session` maps per §5.3; the `stop` event becomes
`POST /session/{id}/abort`. The host also passes the executable path and the
mirror and `XDG_*` directories, which are host decisions (§2.1, §5.1); they
travel as an `opencode` block on the request that other adapters ignore.

---

## 9. Files

```text
agent-runner/src/agent_runner/adapters/opencode/
├── adapter.py     AgentAdapter — session lifecycle, event normalisation, capabilities
├── client.py      §3 — the httpx client: eleven calls, the SSE loop, the part models
├── server.py      §5.1 — the launcher and the per-route registry
├── tools.py       §7.1 — the CommonTool mapping, pure and separately tested
└── mirror.py      §5.2 — the project mirror and its reconciliation
```

The mirror is its own file because it is the part with no counterpart in the
other adapters, and the part spec 21 will need to reason about. All five sit
inside the library, so spec 42's `test_boundary.py` covers them: nothing in
this directory imports anything outside the package's declared dependencies,
and `httpx` is the only one this directory adds.

---

## 10. Evidence

**ONE GATEWAY: REX's own, on `http://127.0.0.1:24334/v1`.** The built-in gateway
of spec 46 — LiteLLM inside REX, switched on in Settings, needing nothing
installed and no container. Spec 46's migration already writes this spec's route.

That single target is a decision and not a convenience. §12 lists what it
excludes: an external LiteLLM, and the engines on their own ports. One route
means one thing to configure, one thing to prove, and one thing to blame when a
turn fails.

**The caller is authenticated**, which is the one thing 3.0's target did
differently. The gateway mints `sk-rex-<48 hex>` per launch and never writes it
to disk; REX puts it in the child's `REX_GATEWAY_KEY`, so an OpenCode route here
takes `Environment variable` and never `No authentication`. Provider keys are
the gateway's own business upstream and a caller never sees one.

Which models are behind it is the reviewer's choice in Settings rather than a
fact about the gateway: any of spec 46 §5.1's six providers, each contributing
aliases of the form `<provider>-<slug>` (spec 46 §11). `lmstudio-*` reaches LM
Studio on 1234 and `unsloth-*` reaches Unsloth Studio on 8888, exactly as before,
but now because a row in `gateway_model` says so.

### 10.0 What still needs measuring against 24334

**Nothing in §10.0b was taken through this gateway**, and honesty about that is
the point of splitting the section. The proxy changed; the models did not. So:

| Claim | Status |
|:--|:--|
| The models stream fragmented `tool_calls` in the `@ai-sdk/openai-compatible` shape | **Stands.** A property of the engine, measured twice on two routes (§10.0b, §10.0c) |
| `delta.reasoning_content` is present | **Stands**, same reason |
| LiteLLM passes those fragments through `/v1/chat/completions` unaltered | **Unproven.** Spec 46 §18 measured `/v1/chat/completions` answering 200 through an alias, but never with a `tools` array and never streaming |
| An unknown alias is a 404 rather than a hang | **Unproven** on LiteLLM |
| `REX_GATEWAY_KEY` reaches OpenCode's server and is accepted | **Unproven** — 3.0's target needed no key, so this path has never run |

Milestone 0 takes all four. Until it does, this spec claims the model evidence
and not the gateway evidence.

### 10.0b History — measured 2026-09-05 against a gateway that no longer exists

Kept because what it proves is a property of the **models**, and models do not
change when a proxy is replaced. The route it used is gone: `infra/envoy` on
port 26334, REX's own Envoy AI Gateway, deleted with `infra/` on 2026-09-06 when
spec 46 replaced it. **Do not use these numbers as evidence about the built-in
gateway** — §10.0 says which of them transfer and which do not.

One config, both local engines, so switching engine was naming a different
model: `lms-*` reached LM Studio on 1234 and `unsloth-*` Unsloth Studio on 8888.
That gateway authenticated no caller.

| Through `http://localhost:26334/v1` (**gone**) | Result |
|:--|:--|
| `GET /v1/models` | **200** — ten aliases |
| `POST /v1/chat/completions`, `unsloth-26b` | **200** |
| `POST /v1/chat/completions`, `lms-26b` | **200** |
| `unsloth-26b`, `stream: true` with a `tools` array | **works** — 61 SSE lines, 9 carrying `tool_calls`, `finish_reason: "tool_calls"` |
| `lms-26b`, the same | **works** — 47 SSE lines, 3 carrying `tool_calls`, `finish_reason: "tool_calls"` |
| Either, `delta.reasoning_content` | **present** — 49 chunks of 61 on `unsloth-26b`, 42 of 47 on `lms-26b` |

The tool-call stream has the shape `@ai-sdk/openai-compatible` needs, verbatim:
the first chunk carries `index`, `id`, `type` and `function.name` with the
opening brace of the arguments, and every later chunk carries a fragment of
`function.arguments`. Measured on `unsloth-26b`:

```json
{"delta":{"tool_calls":[{"index":0,"id":"oLy1…","type":"function",
  "function":{"name":"get_weather","arguments":"{"}}]}}
{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"city"}}]}}
{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":"}}]}}
```

Routing was by the body's `model`, which that gateway copied into an
`x-ai-eg-model` header and matched against one `AIGatewayRoute` rule per alias;
an unknown alias was a 404.

**LiteLLM routes differently, and the difference is not cosmetic.** It matches
the body's `model` against `model_name` in the generated `config.yaml` (spec 46
§4.4) and rewrites it to the `litellm_params.model` behind it. Nothing is copied
into a header, there is no `AIGatewayRoute`, and what an unknown alias returns
has not been measured — §10.0 lists it as unproven for exactly this reason.

#### 10.0c And before that — 2026-09-03

On 2026-09-03 there was no `infra/envoy` either, so the routes to hand were the compose
projects in
[`~/Projects/Github/lukaskellerstein/ai-gateway`](../../../../ai-gateway) with
`GATEWAY_ENGINE=unsloth`, and the engine directly. Those measurements stand as
history and are kept because they are the same finding on a different route:
LiteLLM `POST :24000/v1/chat/completions` answered **200**, and the engine on
`:8888` streamed `delta.content`, `delta.reasoning_content` and incremental
`tool_calls`.

Neither is a target now, and neither is 26334. The reviewer's LiteLLM on 24000
needs `Authorization: Bearer <key>` from `AI_GATEWAY_KEY`, which is **not
exported on this machine** — measured 2026-09-05, `:24000/v1/models` answers
`401`. The engine on `:8888` answers `401` on every route including
`/v1/models`, and reaching it directly skips the traffic log entirely.

The built-in gateway supersedes all three: it is REX's own process, it needs no
container and no other software, and its traffic log (spec 46 §4.6) is the
replacement for the tracing those routes were reached through.

### 10.1 The model is ready for this

Streaming tool calls with fragmented arguments is exactly what
`@ai-sdk/openai-compatible` consumes, and it is the thing most local models get
wrong — they emit tool syntax as prose. `unsloth-26b` does not.

### 10.2 One base URL backs an OpenCode route

| Base URL | Model ids | Auth |
|:--|:--|:--|
| `http://127.0.0.1:24334/v1` | whatever is ticked in Settings, as `<provider>-<slug>` | **Environment variable**, `REX_GATEWAY_KEY` |

**The reviewer configures none of this.** Spec 46's migration wrote the row, its
Models tab fills the model list, and §4.2 of that spec rewrites `base_url` before
anything resolves it if the port walked past 24334. This section describes what
REX produces, not a form somebody fills in.

**There are no `-anthropic` twins to avoid any more.** That warning belonged to
the Envoy, which needed a separate alias per protocol. Spec 46 §4.5 removed the
problem: LiteLLM answers `/v1/messages`, `/v1/chat/completions` and
`/v1/responses` from the same `model_name`, so one ticked model is one string
every SDK can use, and OpenCode simply reaches it over chat completions.
Embedding models are still not agent models, and spec 46 §5.5 is what keeps them
off the list.

This is the whole gateway story for spec 47. There is one row because there is
one gateway: everything goes through REX's own, and neither an external LiteLLM
nor a direct engine port is supported (§12).

```text
NAME          Built-in
KIND          Built-in
HOST          http://127.0.0.1:24334        (walks to 24343 if taken)
  OpenCode    http://127.0.0.1:24334/v1
  MODELS      lmstudio-google-gemma-4-e4b   (an example; whatever is ticked)
  AUTH        Environment variable · REX_GATEWAY_KEY
```

Two consequences worth writing down before someone rediscovers them:

- **Unsloth serves one model at a time**, and that limit spans chat and
  embeddings. REX's five-agent cap becomes a serial queue against this engine,
  with a model swap measured at 14 s cold and 4.4 s warm if anything else calls
  the embedder.
- **The model spends tokens on reasoning.** 89 completion tokens produced the
  single word `ready`. The gateway's own notes record an empty reply at
  `max_tokens: 60` with `finish_reason: length` — the entire budget went to the
  reasoning block. Any REX turn must leave a generous output budget, and
  §6's reasoning-part row is where those tokens become visible instead of
  looking like a stall.

### 10.3 The reviewer's own client

The Python track of the reviewer's course is a hand-written client by design.
`50_opencode_sdk/python/README.md:3-6`: "OpenCode does not currently publish a
maintained official Python SDK. These examples use a small, course-owned async
client over the same documented HTTP, SSE, and WebSocket endpoints used by
`@opencode-ai/sdk`. The server remains the source of truth; Python is only the
control client." `06_others/PLAN.md:40` records the decision: "PyPI
`opencode-ai` is stale 0.1.0a36 → skip Python."

That client, `opencode_course/client.py` (547 lines, twenty-two namespaces),
confirms everything §3 and §5.1 rely on, against `opencode` 1.18.18:

| Claim | Where |
|:--|:--|
| every endpoint in §3's table, with its method, path and body | `:45-166` |
| `directory` is a default query parameter on every request | `:347-350` |
| SSE is `GET /event`, `aiter_lines()`, `data:` lines, `json.loads` | `:290-299` |
| a hand-spawned `opencode serve --hostname=127.0.0.1 --port=N` takes its inline config through `OPENCODE_CONFIG_CONTENT` | `:467-478` |
| health is `GET /global/health` polled every 100 ms, and an early exit is reported with its status | `:428-441` |
| close is `terminate()`, five seconds, `kill()` | `:402-412` |
| a free port is a `bind(("127.0.0.1", 0))` probe | `:415-418` |
| the permission reply is `{ reply, message? }` to `POST /permission/{id}/reply` | `:162-166`, used at `3_tools_and_agents/6_permissions.py:19-27` |
| events are filtered by `properties.sessionID`; tool parts carry `callID`, `tool`, `state.status` | `5_events/2_live_progress.py:16-27` |
| history messages are `{ info, parts }`, and an assistant message is done when `info.time.completed` is set | `2_sessions/3_messages_and_parts.py:18-19`, `client.py:537-542` |

The TypeScript track of the same course drives the same server API from the
other side with `@opencode-ai/sdk/v2` at 1.18.18 — `createOpencodeServer`,
`session.create`, `session.promptAsync`, `event.subscribe`,
`permission.reply` with `once | always | reject`, and an inline provider with
`npm: "@ai-sdk/openai-compatible"`, `options.baseURL`,
`options.apiKey: "{env:…}"`, `model` and `small_model` — which is the shape §4
builds. Two clients in two languages agreeing on one server is the evidence
that the server, not a package, is the contract.

### 10.4 What is still unproven

- **The four gateway claims in §10.0.** Everything §10.5 measured about the
  gateway went through a proxy that no longer exists, so the streaming
  tool-call path through LiteLLM, the unknown-alias answer, and the
  `REX_GATEWAY_KEY` hop are all open. Milestone 0 step 0 takes them.
- **Whether the `opencode` executable may be redistributed inside a packaged
  REX.** §2.1 leaves this to milestone 0, and it is a licensing and packaging
  question rather than a measurement. What §10.5 settles is the half that was
  feared most — a run-time npm download — and that half is clean, and is
  gateway-independent, so it survives the retarget.
- **Whether an OpenCode server accepts `{env:REX_GATEWAY_KEY}`** where 3.0's
  config sent no key at all. §4's snippet already has the branch; nothing has
  run it.
- Every endpoint in §3. §10.5 drove nine of the eleven; `GET /session/status`
  and `POST /permission/{id}/reply` are exercised only when a run asks for a
  permission, and milestone 1 is where that happens.

---

### 10.5 Milestone 0, run 2026-09-05 — five proofs, on the superseded gateway

> [!warning]
> **The model hop in this run went through `http://localhost:26334/v1`, which no
> longer exists.** What is about the **executable** — the server starting, the
> inline config being honoured, the absence of an npm download, the isolated
> directories — is gateway-independent and stands unchanged. What is about a
> model **answering** has to be re-taken against 24334 in milestone 0 step 0.

Three throwaway spikes against `~/.opencode/bin/opencode` **1.18.27**, an
inline §4 config, isolated `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and
`XDG_CACHE_HOME`, and the now-deleted `http://localhost:26334/v1` behind it. No
UI, no service.

**1 — the server starts and takes its config inline.** `GET /global/health`
answered `{"healthy":true,"version":"1.18.27"}` **0.5 s** after spawn.
`OPENCODE_CONFIG_CONTENT` **is honoured**: `GET /config` echoed the inline
document back — `model: "rex/unsloth-26b"`, `enabled_providers: ["rex"]`,
`share: "disabled"`, `autoupdate: false` — and `GET /config/providers` resolved
the provider with `source: "config"` and the route's `baseURL`. §4's config
block needs no change.

**4 — THE GATE IS PASSED. There is no run-time npm download.**
`@ai-sdk/openai-compatible` is **not on disk** before the server starts, not
after it is healthy, not after `/config/providers` resolves the provider, and
not after a completed turn the model actually answered. Searched under the
isolated root, `~/.opencode` and `~/.cache/opencode`. The package is satisfied
from inside the binary. §4's rule — "OpenCode is not allowed to satisfy it with
an implicit npm download after Send is pressed" — is met by the executable as
shipped, so the adapter may ship.

**5 — the abort endpoint is the one the course names.**
`POST /session/{id}/abort` → **200**. The course never called it; it is now
measured.

**One real turn, end to end.** `POST /session/{id}/prompt_async` → **204**
immediately, and `session.idle` **3.4 s** later with the model's answer. The
event vocabulary seen on that one turn:

```text
server.connected  session.updated  message.updated  message.part.updated
session.status    session.diff     plugin.added     catalog.updated
reference.updated integration.updated  message.part.delta  session.idle
```

**6 — reasoning parts DO arrive**, which decides §6's second row and decides it
the right way. A prompt that makes the model think produced two `reasoning`
parts, one carrying the model's own words:

```text
"*   The user is asking a riddle: \"A farmer has 17 sheep. All but 9 run
    away. How many are left?\"  *   Constraint: …"
```

So the engine's non-standard `delta.reasoning_content` survives both the gateway
and OpenCode's OpenAI-compatible provider. Two notes for the adapter:

- **An empty reasoning part is normal.** The other of the two carried `''`.
  Dropping a reasoning part on empty text would be wrong — it is a real part
  with nothing in it yet.
- **`step-start` and `step-finish` are part types §3 does not model.** They are
  unknown types and are dropped by spec 42 §7's fifth rule, which is correct and
  not a gap. Written down so nobody later reads their absence as a bug.

**3 — two sessions on one server do not cross.** Two turns run under
`asyncio.gather` on one server. Each filtered on `properties.sessionID` and
skipped **23** and **14** foreign events respectively, keeping only its own
parts. Both answered, 3.6 s for the pair.

**2 — a session survives a server restart.** The server was terminated and a
second spawned on a new port against the same `XDG_DATA_HOME`.
`GET /session/{id}` → **200**, the history still held its two messages with
roles `['user', 'assistant']`, and a further turn grew it to four. Session state
lives in the data directory and not in the process — which is why §5.1's
isolated directories are also what makes resumption work.

**The surprise: `opencode serve` says it is unsecured.** Every launch prints

```text
Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.
```

1.18.27 supports a server password and REX sets none. The server binds
`127.0.0.1` only, so this is not a hole in the write boundary — but anything
else on this machine can drive it while a run is open, and the variable costs
one line. **§5.1 gains a step:** `server.py` sets a fresh random
`OPENCODE_SERVER_PASSWORD` in each child's environment and `client.py` sends
it, on spec 43 §6.3's reasoning — a credential that never leaves the child, and
never a command-line argument.

---

## 11. Acceptance criteria

1. A reviewer can add an OpenCode route to a gateway, with a model API URL, a
   model list and an authentication choice.
2. `SDK / account default` is refused for a route with an explicit URL, with a
   sentence saying why.
3. OpenCode's control URL can never be mistaken for the model API URL. It is not
   stored and not shown as configuration.
4. The OpenCode server, its bootstrap files and its project mirror stay in
   host-supplied storage, and every server is closed on `shutdown`.
5. Two OpenCode comments running at once filter text, tool, permission, error and
   idle events by session id, and close their SSE streams when finished.
6. An unmapped OpenCode tool name reaches REX's policy as `common: None`, is
   denied, and is named in the denial.
7. ASK cannot change the reviewed repository, `~/.rex/work`, `.git`, or anything
   outside the workspace — including through OpenCode's own `.opencode`
   bootstrap.
8. ACT changes only REX working copies. Originals are byte-for-byte unchanged
   before approval, and approve, discard and undo behave as they do under Claude.
9. A session is resumed after both a server restart and a service restart.
10. Stop aborts the session and emits one `stopped` event, not an error.
11. The adapter never answers a permission request with `always`.
12. The style control is hidden for an OpenCode route, and a non-null style or
    a non-empty plugin list sent to one is rejected rather than ignored.
13. No credential value appears in the provider JSON, a log, a command line, or a
    debug report — `REX_AGENT_TOKEN` exists only in the server's environment.
14. A Claude route and an OpenCode route run at the same time without
    exchanging URLs, models, credentials or session ids.
15. The adapter emits only `AgentEvent`s; nothing OpenCode-shaped crosses the
    pipe, `client.py` covers only §3's endpoints, and `httpx` is the only
    dependency it adds — `test_boundary.py` stays green.
16. An OpenCode run through the built-in gateway appears in the traffic log
    (spec 46 §4.6) carrying this thread's `x-rex-thread`, and its request and
    response bodies show the tool calls the run made.
17. `grep -rn "24334\|localhost" agent-runner/src/agent_runner/adapters/opencode/`
    finds nothing. The port is spec 46's and may move; an adapter that knows it
    is a bug, not a shortcut.
18. With the built-in gateway switched **off**, an OpenCode route to it fails
    with a sentence naming the switch, not with a connection error the reviewer
    has to interpret.

---

## 12. Deliberately out of scope

- Attaching to a separately managed or remote OpenCode server. The library owns
  a loopback server, and the configured URL always means the model API.
- A wrapper package for the OpenCode API. The server is the contract; the
  client covers §3's endpoints and grows only when a spec needs a call.
- Loading reviewer-supplied OpenCode provider npm packages. Version 3.0 uses the
  pinned `@ai-sdk/openai-compatible` and nothing else.
- OpenCode plugins as equivalents of Claude's plugins or output styles.
- Fixing, running or supervising a gateway.
- **Proving this adapter against any gateway but REX's own built-in one on
  `http://127.0.0.1:24334/v1`.** This is a limit on the EVIDENCE, not on the
  design, and the difference matters.

  **The adapter stays gateway-independent.** A route is a base URL, a model list
  and an authentication choice, and nothing in `adapters/opencode/` may test
  which product is behind it, special-case a hostname, or carry a port number.
  That is spec 43 §4.3's rule and it holds here unchanged — and spec 46 §4.2's
  port walk makes it load-bearing rather than tidy: 24334 is not guaranteed, so
  an adapter that remembered the number would break on a machine where something
  else held it.

  What is out of scope is the *work* of proving it elsewhere. An external
  LiteLLM — the `litellm` kind — and the engines on their own ports get no
  measurement in §10, no milestone, and no acceptance criterion. Pointing a
  route at one later is configuration a reviewer types, not a change to this
  spec — and if it fails, that is a bug in this adapter's gateway independence.
- **Reviving any of the gateways this spec used to target.** `infra/envoy` on
  26334 was deleted with `infra/` on 2026-09-06, and the `envoy` and `custom`
  gateway kinds went with it (spec 46 §3.1). Three kinds exist: `original`,
  `builtin` and `litellm`.
- Anything spec 43 §14 already excludes, and anything spec 46 §17 excludes.

---

## 13. Milestones

### 0 — prove the OpenCode seam

A throwaway, non-UI spike through spec 42's service, against
`http://127.0.0.1:24334/v1` with **`Environment variable` auth** per §10.2 —
REX's own built-in gateway. That is the only target; there is no second gateway
to repeat it on.

Start it by switching it on in Settings, or spawn `local_gateway serve` directly
for a spike. There is no `up.sh`, no compose file and no container: spec 46
deleted all of that, and the gateway is a child of the main process that starts
in about 1.6 s. Read the port from the running gateway rather than assuming
24334 — spec 46 §4.2 walks to 24343 and rewrites the stored routes when it does.

**Take the four measurements §10.0 lists as unproven first**, because three of
the five proofs below are worthless if the gateway mangles a tool-call stream.
Through 24334 with the master key: a streaming `/v1/chat/completions` with a
`tools` array arrives with its `tool_calls` fragments intact and in order; an
unknown alias answers promptly with an error rather than hanging; and a request
with a wrong or absent key is refused. Record it in spec 48 §12.4 item 0 too —
it is the same measurement. Then:

1. Own a loopback server through §5.1's launcher, with a per-child environment,
   an inline `@ai-sdk/openai-compatible` provider, and isolated config and data
   directories.
2. Start, stream, stop, persist the session id, restart the server, restart the
   service, and resume that session.
3. Prove two concurrent sessions on one server cannot consume each other's SSE or
   permission events.
4. Resolve a version-compatible executable in a packaged app, and prove the
   provider package needs no surprise network install at run time.
5. Record that `OPENCODE_CONFIG_CONTENT` is honoured by the pinned `opencode`
   executable, and the exact abort endpoint it serves.

*Gate:* no UI work before the gateway check and all five are recorded in §10.
**If OpenCode cannot
run without an unapproved package download, do not ship this adapter.** **If
LiteLLM does not pass streaming tool calls through intact, stop and say so** —
that is a spec 46 problem, not an OpenCode one, and building an adapter on top
of it would hide the cause.

### 1 — OpenCode ASK

Executable preflight, `client.py`, the server registry, private provider
configuration, the project mirror, session persistence, SSE normalisation and
reconciliation, the §7.1 mapping, permissions, cancellation, the `list_sdks()`
row, and the transcript and debug labels.

*Tests:* recorded server events → `AgentEvent` in `agent-runner/tests/test_events.py`;
the §7.1 mapping in `test_policy.py`, including that an unknown name arrives as
`None`; `client.py` against a fake server in `test_opencode_client.py`.

*Done when:* an OpenCode route answers a real comment on a real document,
resumes after a service restart, stops, reports a missing prerequisite clearly,
and runs at the same time as a Claude route; and the §7.3 hostile prompt changes
nothing — the `.opencode` bootstrap included. All of it on
`http://127.0.0.1:24334/v1`, recorded in §10, **and every request visible in the
traffic log** (spec 46 §4.6) with this thread's `x-rex-thread` on it — which is
also the check that REX really went through its own gateway rather than reaching
a model some other way.

### 2 — OpenCode ACT

Only after §7.4's boundary proof on a packaged platform. Keep the server's own
files in host storage and connect completed edit and tool parts to the existing
working-copy accounting.

*Done when:* hostile prompts and shell commands cannot change the originals, ACT
changes only intended working copies, and approve, discard and undo match the
other adapters. A platform without the proof advertises OpenCode ASK and not ACT.
