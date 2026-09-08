# REX 47 — the OpenCode agent

**Amended by [spec 50](../50-macos-completely/SPEC.md):** §7.4's boundary was a platform gate — ACT on macOS, ASK elsewhere. REX is now macOS only, so `sandbox_available()` asks about the machine (is `/usr/bin/sandbox-exec` there?) rather than about the platform, and ACT is simply offered.

**Version:** 5.0 · 2026-09-07
**Status:** **milestone 0 passed and milestone 1 built.** The gate's nine
measurements are §10.6, taken 2026-09-07 against `opencode` 1.18.27 and REX's
own gateway on 24334; five of them corrected this spec and the corrections are
written into §7.1, §7.3, §5.1, §5.2 and §3. Milestone 2 — ACT — is **not
BUILT on macOS**: §7.4's operating-system boundary is a seatbelt around the
server (§10.9), §7.4.1 chose option B, and §10.10 is the proof — a hostile ACT
got `operation not permitted` and left the originals byte-for-byte unchanged,
while the working copy was edited and reported. `supports_act` is true where
`sandbox_available()` is, which today is macOS alone; Linux and Windows offer
OpenCode ASK and refuse ACT by name.
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

**A server is LEASED per run, not cached per route.** Version 4.0 said cached,
and three measurements taken on 2026-09-07 (§10.6 G) turned it into a lease:

1. **Attribution can only travel in the provider config.** REX's client talks to
   the OpenCode *server*, not to the gateway, so a header on one of its own
   requests never reaches LiteLLM. `options.headers` does — measured. Headers are
   per run, a config holds one set, and a shared server would therefore file the
   second comment's spend under the first comment's thread. Criterion 16 and a
   cached server cannot both be had.
2. **A cached server is not free.** `lukas-ps`, 2026-09-07: an idle REX-spawned
   `opencode serve` holds **242 MB**. Five of them, held for the life of the app,
   is 1.2 GB to save half a second.
3. **A server costs 0.44 s to start** (§10.6 B1), against turns that take
   seconds. The cache was buying very little.

So the key is everything the config is built from — the route, the model **and
the run's attribution** — the registry counts holders, and the last one to let
go closes the child. Between runs the library keeps nothing at all, which is
what spec 42 §3.2 wants of it anyway; `close()` on `shutdown` remains as the
backstop for a run still going when the host quits (spec 42 §4.2, criterion 4).

**Nothing is lost by it.** Session state lives in `XDG_DATA_HOME`, which is
keyed by **route alone** and never by model or run, so a session one run created
is resumed by the next — §10.6 B4 measured exactly that across a server restart,
and the end-to-end run of §10.7 measured it across a *service* restart. And
§5.4's session-id filter stops being the only thing keeping two comments apart,
which is the right direction for a rule whose failure mode is one comment's
answer appearing in another's transcript.

A no-URL `inherit` route deliberately reads the reviewer's normal OpenCode
configuration and gets no isolated directories.

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

The tool names are `GET /experimental/tool/ids` at 1.18.27, measured (§10.6 E),
not guessed. **`list` and `patch` do not exist**; `apply_patch` does, and three
more the spec had never named:

| OpenCode tool | `CommonTool` | Input the policy reads |
|:--|:--|:--|
| `bash` | `shell` | `{ command }` |
| `edit`, `apply_patch` | `edit` | `{ file_path }` |
| `write` | `write` | `{ file_path }` |
| `read` | `read` | — |
| `glob` | `list` | — |
| `grep` | `search` | — |
| `webfetch`, `websearch` | `fetch` | — |
| `task` | `task` | — |
| `todowrite`, `skill`, `question`, `invalid` | `None` | — |
| anything else | `None` | — |

`filePath` is what OpenCode calls it and `file_path` is what REX's gate reads,
so `tools.py` renames it. The four `None` rows are named rather than left to the
fall-through so that a reader can see they were considered: `todowrite` and
`question` change nothing on disk but are not in the common vocabulary either,
and REX's answer for an unmapped OpenCode tool is a refusal with the name in it.

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

REX therefore uses four layers and does not pretend any one of them is enough:

1. the per-session OpenCode ruleset, built from `RunRequest.disallowed`;
2. REX's own policy, through §7.1's mapping;
3. a project mirror, so the reviewed tree is not the directory the agent is
   pointed at; and
4. **an operating-system boundary that makes everything outside the mirror
   unwritable by the server process** — built and measured 2026-09-07, §10.9.

**The fourth layer is new, and its arrival corrects this section's opening.**
The paragraph above is right that OpenCode has no sandbox of its own; it does not
follow that REX cannot give it one. `sandbox-exec` is the same seatbelt Codex's
sandbox uses, and `server.py` wraps every server in a profile that denies
`file-write*` outside the mirror and REX's own directories. It costs nothing —
0.43 s to start, unchanged — so **ASK has it too**, not only ACT.

On a platform where REX has not written a profile — Linux and Windows —
`sandbox_available()` is false, the server runs bare on three layers, and §7.4
keeps ACT off there. That is the gate, and it is why the layer is counted
separately rather than folded into the others.

Permission requests are filtered by session id before the adapter answers.

### 7.3 ASK

REX's read profile passes `disallowed: ["write", "edit"]` (spec 42 §6). The
adapter turns that into a session ruleset on `POST /session`, and §10.6 D and E
are what its shape has to obey:

1. **A ruleset is written in PERMISSION names, not tool names**, and the two
   differ in exactly one place that matters — a `write` tool call asks under
   `edit`. So the read ruleset allows `read`, `glob` and `grep`, and asks on
   everything else through `{"permission": "*", "pattern": "*", "action": "ask"}`.
   A closed deny-list would have to enumerate names OpenCode has not shipped yet;
   an open `ask` cannot miss one.
2. **`ask` and never `deny`.** Both stop the write, and both were measured to.
   But a denied tool tells the model nothing and it retries — 22 wasted calls in
   the measured run — while a rejection carries REX's own sentence back into the
   transcript and the model stops. The refusal has to be REX's anyway (§7.1), so
   asking is both the safer default and the one that says why.
3. **The default is `allow` for everything**, so a session created without a
   ruleset writes files. This is not a hardening option; it is the layer.

Its client directory is the disposable mirror from §5.2, not the reviewed
repository.

That protects the repository from the model's tool calls **and** from OpenCode's
own bootstrap writes. Milestone 1 must prove with a deliberately hostile prompt
that ASK cannot change the reviewed repository, `~/.rex/work`, `.git`, or
anything outside the workspace — and the proof must include the `.opencode`
bootstrap, which is a write nobody asked for.

### 7.4 ACT

OpenCode ACT combines all four layers of §7.2: `edit` allowed inside the mirror,
`external_directory` denied, `bash` asked and answered by the policy, and an OS
boundary that makes the reviewed repository unwritable from the server process.

**The boundary is built and proved — §10.9.** `write_ruleset()` is written,
`sandbox_available()` is true on macOS, and a `bash` command aimed at a
directory outside the mirror gets `operation not permitted` through REX's own
registry. Milestone 2's gate is passed.

### 7.4.1 How ACT reaches the working copies — **decided: option B**

**Built 2026-09-07, and `supports_act` is true on macOS.** Getting here needed a
decision, because a Claude or Codex ACT runs with `cwd` = the repository and
`writable` = the working-copy directories, and the write prompt names those
copies by absolute path — while an OpenCode agent confined to a mirror cannot
see those paths. One of three things had to give.

| Option | What it means | Cost |
|:--|:--|:--|
| **A — the spec as written** | mirror the repository, let the agent edit natural paths in it, map changes back onto working copies at turn end | the adapter must learn the source → working-copy mapping, which is REX's and is not on `RunRequest` |
| **B — no mirror for ACT** | run in the workspace exactly as Claude does, and let the **seatbelt** allow only the working copies. The prompt is unchanged | departs from §5.2, and rests the whole boundary on layer 4 — which exists only on macOS |
| **C — mirror the working copies** | mirror `writable` rather than `cwd`, so the agent edits copies by their own names | the prompt's absolute paths do not exist inside the mirror, so §8.6's write prompt needs an OpenCode shape |

**B was chosen, and measurement is why.** §5.2's stated reason for the mirror was
that OpenCode bootstraps `.opencode/` into its project directory — and **§10.6 F
measured that it does not**, at 1.18.27, with the isolated `XDG_*` directories
§5.1 already sets. So for ACT the mirror's remaining job was to be a place the
agent may write, and layer 4 does that job better, with no copy-back, no mapping
the library would have to be told, and no second shape of the write prompt.
B's cost is that ACT depends on a macOS-only mechanism — which §7.4 already
made true, since the boundary is the gate.

**So the two profiles run in different places, and that is the design rather
than an inconsistency:**

| | Project directory | Writable | Ruleset |
|:--|:--|:--|:--|
| **ASK** | a disposable mirror of `cwd` (§5.2) | the mirror | `read_ruleset()` — read freely, ask about everything else |
| **ACT** | `cwd`, the workspace itself | `RunRequest.writable`, the spec 22 working copies | `write_ruleset()` — the same, plus `external_directory` |

A read run has nowhere it may write, so a copy is its natural project directory
and it is the layer that works on every platform. A write run has specific
places it may write, those places have absolute paths the prompt already names,
and the seatbelt is what makes everything else unwritable.

**`external_directory` is `allow` in the ACT ruleset, and only there.** The
working copies live under `~/.rex/work` and the run's project directory is the
workspace, so *every* edit an ACT is supposed to make is an external-directory
write by OpenCode's reckoning. With that permission asking or denied the write is
refused before the tool call reaches a file — and it looks exactly like the model
failing to call the tool, which cost a run to work out (§10.10). What stops the
agent going anywhere else is layer 4, allowing precisely `RunRequest.writable`.

**ACT fails closed, twice.** `capabilities()` reports `supports_act: false` where
`sandbox_available()` is false, and `_act_refusal` refuses the run again at the
moment it starts — for a platform with no boundary, and for a run given nowhere
to write. Two checks that could disagree are two ways to be wrong, so they read
the same function.

Milestone 2 stays a gate: where the containment is not proven, `supports_act` is
false, OpenCode ASK stays available, and OpenCode ACT is visibly disabled —
spec 43 §8.1.

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
`POST /session/{id}/abort`.

**The two host decisions travel in the child's ENVIRONMENT, not in an `opencode`
block on the request**, and the change is deliberate. Version 4.0 sketched a
block; building it showed that `capabilities()` and `session_state()` need the
same two values and carry no request, so a request-only block would leave two of
an adapter's four questions unanswerable — and §2.1 itself calls the executable
app-wide rather than part of a route. So main sets two variables on the
`agent-runner` child, exactly as spec 46 §7.1 sets the gateway's master key on
its own process:

| Variable | What |
|:--|:--|
| `REX_OPENCODE_EXECUTABLE` | §2.1's resolved path. Absent means REX found none, and the run is refused with the sentence that says what to install |
| `REX_OPENCODE_HOME` | §5.1 and §5.2's root. The **host** supplies it; the library picks the per-route and per-thread directories under it, which is what §5.2 said all along |

`REX_CODEX_HOME` in the Codex adapter is the same shape for the same reason, and
the rule this keeps is the one that matters: **the library never searches a
machine.** It is handed an answer and checks that the answer is still runnable.
Since the child reads its environment once, at spawn, changing the override in
the sheet restarts the child — `restartAgentService()`, whose only caller this
is. Nothing is lost by it: the child holds no run state between turns.

**`RunRequest` therefore does not change**, which is worth stating: `schema.json`
and `src/shared/agent-protocol.ts` gained one row each — the `opencode`
descriptor `list_sdks()` now returns — and no message shape moved.

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

### 10.0 The four gateway claims — all taken 2026-09-07

**Nothing in §10.0b was taken through this gateway**, and honesty about that was
the point of splitting the section. The proxy changed; the models did not. All
four are now measured against a real `local_gateway serve` on 24334, master key
in `LITELLM_MASTER_KEY`, one ticked model — `lmstudio-google-gemma-4-e4b`, LM
Studio on 1234, the alias spec 46 §11 generates. §10.6 is the run.

| Claim | Status |
|:--|:--|
| The models stream fragmented `tool_calls` in the `@ai-sdk/openai-compatible` shape | **Stands.** A property of the engine, measured on three routes now (§10.0b, §10.0c, §10.6) |
| `delta.reasoning_content` is present | **Stands** — 204 of 207 chunks through LiteLLM (§10.6) |
| LiteLLM passes those fragments through `/v1/chat/completions` unaltered | **PROVED** (§10.6 A1). 207 SSE chunks, 2 carrying `tool_calls`, `finish_reason: "tool_calls"`, the fragments in order |
| An unknown alias is a 404 rather than a hang | **PROVED, as a 400** (§10.6 A2) — 0.11 s, naming the alias. Not a 404, and prompt, which is what the claim was about |
| `REX_GATEWAY_KEY` reaches OpenCode's server and is accepted | **PROVED** (§10.6 B2) — a real turn answered through the authenticated gateway with `{env:REX_AGENT_TOKEN}` in the provider config |

**One finding is a spec 46 problem, not this spec's** (§10.6 A3): a call with a
wrong or absent key IS refused and never reaches a model, but the sentence is
wrong. An absent key answers `500 Internal server error` and a wrong one
`400 No connected db.` — LiteLLM with no `DATABASE_URL` cannot look up a
non-master key, so it reports the missing database rather than the bad key.
Safety holds; the message does not. Criterion 18's sentence has to come from
REX, because the gateway will not supply one.

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

- **Whether the `opencode` executable may be redistributed inside a packaged
  REX.** §2.1 leaves this open, and it is a licensing and packaging question
  rather than a measurement. What §10.5 settles is the half that was feared
  most — a run-time npm download — and §10.6 B6 re-took it on this gateway.
  Until it is answered, `Auto-detect` finds the reviewer's own install and a
  machine without one is told what to install.
- **~~§7.4's write boundary~~** — taken 2026-09-07, §10.9 and §10.10. It holds
  on macOS, it is wired into `server.py`, and ACT is built on it.
- **The boundary on Linux and Windows.** `landlock` and a job object are the
  equivalents; neither is written, so neither platform gets layer 4 and both
  refuse ACT by name. This is the one thing standing between OpenCode ACT and
  every platform REX ships to.
- **An OpenCode ACT driven by mouse**, from Apply on a real document. §10.10
  drove `apply.ts`'s shape through the library; nobody has pressed the button.
- **~~The four gateway claims in §10.0.~~** Taken 2026-09-07 — §10.0 and §10.6 A.
- **~~Whether an OpenCode server accepts `{env:REX_GATEWAY_KEY}`.~~** Taken —
  §10.6 B2.
- **~~Every endpoint in §3.~~** All eleven are now driven: §10.6 D drove
  `POST /permission/{id}/reply` and §10.6 B `GET /session/status`, which was the
  finding that it answers `{}` for an idle session rather than `"idle"`.

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

### 10.6 Milestone 0, run 2026-09-07 — the gate, on the built-in gateway

The run that closed §10.0 and §10.4. `opencode` **1.18.27** at
`~/.opencode/bin/opencode`, `local_gateway serve --port 24334` with one ticked
model, LM Studio on 1234 behind it. Throwaway scripts, no UI and no service.
Five things it measured contradict what this spec assumed, and each is written
against the section it corrects.

#### A — the gateway, before anything OpenCode

| # | Measurement | Result |
|:--|:--|:--|
| A1 | `POST /v1/chat/completions`, `stream: true`, with a `tools` array | **207 SSE chunks in 2.8 s**, 2 carrying `tool_calls`, `finish_reason: "tool_calls"`. LiteLLM passes them through |
| A1b | `delta.reasoning_content` through LiteLLM | **204 of 207 chunks** |
| A2 | An unknown alias | **400 in 0.11 s** — "Invalid model name passed in model=no-such-alias". Prompt, and it names the alias |
| A3 | A wrong or an absent key | **Refused, in 0.01 s, never reaching a model** — but as `400 No connected db.` and `500 Internal server error`. See §10.0 |
| A4 | `GET /v1/models` with the master key | **200**, one alias |

The fragment shape `@ai-sdk/openai-compatible` needs survives the proxy. The
first chunk carries `index`, `id`, `type` and `function.name`; the next carries
`function.arguments`:

```json
{"delta":{"tool_calls":[{"id":"190856839","function":{"arguments":"","name":"get_weather"},"type":"function","index":0}]}}
{"delta":{"tool_calls":[{"function":{"arguments":"{\"city\":\"Prague\"}"},"type":"function","index":0}]}}
```

**This model fragments the arguments into one chunk rather than many**, where
§10.0b's `unsloth-26b` used nine. Both are the same shape and the consumer
accumulates either; nothing may assume more than one fragment.

#### B — the five proofs, re-taken on this gateway

| # | Proof | Result |
|:--|:--|:--|
| B1 | The server starts and takes its config inline | **healthy in 0.44 s**; `GET /config` echoed `model: "rex/lmstudio-google-gemma-4-e4b"`, `enabled_providers: ["rex"]`, `share: "disabled"`, `autoupdate: false`; `/config/providers` resolved `rex` with the model |
| B2 | A real turn through the **authenticated** gateway | **`prompt_async` 204, `session.idle` 1.7 s later**, with the model's answer and two reasoning parts. §10.0's fifth claim |
| B3 | Two concurrent sessions do not cross | **1.0 s for the pair**; A skipped **43** foreign events and B **63**, each keeping only its own |
| B4 | A session survives a server restart | `GET /session/{id}` **200** on a second server against the same `XDG_DATA_HOME`; history 2 → 4 messages, roles `['user','assistant','user','assistant']` |
| B5 | The abort endpoint | `POST /session/{id}/abort` → **200** |
| B6 | No run-time npm download | `@ai-sdk/openai-compatible` **never on disk** — before the spawn, after health, after `/config/providers`, and after a completed turn. §13's gate is passed |

`GET /session/status` answered `{}` — it reports only sessions that are busy or
retrying, so an idle session is absent rather than `"idle"`. It is not a
liveness check, and §3's table should not be read as though it were.

#### C — the server password is Basic, and the username is `opencode`

§10.5 found the warning and §5.1 gained a step; this is the step's shape,
measured because guessing it costs a 401 nobody can explain.

| Sent | Answer |
|:--|:--|
| nothing | **401**, `www-authenticate: Basic realm="Secure Area"` |
| `Authorization: Bearer <password>` | 401 |
| `Authorization: Basic base64("opencode:<password>")` | **200** |
| the same with any other username — `rex`, `x`, empty | 401 |
| `?password=`, `x-opencode-password:` | 401 |

So the username is the literal string `opencode`, and `/event` is gated too.
`client.py` sends HTTP Basic on every call including the SSE stream.

#### D — the ruleset is the whole of ASK's first layer, and §7.3 was too weak

**The default is `allow` for everything.** `GET /agent` shows every built-in
agent — `build`, `plan`, `general` and four more — carrying
`{"permission": "*", "pattern": "*", "action": "allow"}`, with `ask` on only
`doom_loop` and `external_directory`. A turn on a default session was told to
write a file and **wrote it**, with no permission event at all.

`POST /session` takes `permission: PermissionRuleset` — an array of
`{permission, pattern, action}` with `action` in `allow | deny | ask` — and it
works:

| Session ruleset | What happened |
|:--|:--|
| `deny` on the mutating names | `write` and `bash` **never ran**, no permission event, **no new file**. The model then looped 22 times reading a file it believed it had written |
| `ask` on them, answered `reject` | one `permission.asked`, and the tool part came back `status: "error"` carrying REX's own sentence verbatim: *"The user rejected permission to use this specific tool call with the following feedback: …"*. **No new file** |
| `deny` on the mutating names, a read prompt | `read` completed and the model answered |

**`ask` is the better half of the pair and `deny` is the trap.** A denied tool
tells the model nothing, so it retries — 22 wasted calls in the measured run.
A rejection carries a sentence, and the model stops. So REX asks and REX's own
policy refuses, which is also what §7.1's round trip is for.

#### E — a tool name is not a permission name

Measured by giving one session `{"permission": "*", "action": "ask"}` and
driving every tool in turn. `permission.v2.asked` never fired at 1.18.27; only
`permission.asked`.

| Tool | Permission it asks under | `patterns[0]` | `metadata` keys |
|:--|:--|:--|:--|
| `read` | `read` | the file path | — |
| `glob` | `glob` | the pattern | `pattern` |
| `grep` | `grep` | the pattern | `pattern` |
| `bash` | `bash` | the command | `command` |
| **`write`** | **`edit`** | the file path | `diff`, `filepath` |
| `edit` | `edit` | the file path | `diff`, `filepath` |
| `webfetch` | `webfetch` | the url | `format`, `url` |
| `task` | `task` | the agent name | `description`, `subagent_type` |
| `todowrite` | `todowrite` | `*` | — |

**Every tool asks under its own name except `write`, which asks under `edit`.**
That single exception is why a ruleset cannot be generated from §7.1's table:
a ruleset denying `write` and not `edit` stops nothing.

`GET /experimental/tool/ids` at 1.18.27 is the closed list, and §7.1's table
had three names wrong: **there is no `list` and no `patch`** — the fourteen are
`invalid`, `question`, `bash`, `read`, `glob`, `grep`, `edit`, `write`, `task`,
`webfetch`, `todowrite`, `websearch`, `skill`, `apply_patch`.

A `task` subagent's own `bash` call **asks on the parent session's id**, so the
§5.4 filter sees it and the policy judges it. Nothing extra is needed for
subagents, and nothing escapes the filter by being one.

#### F — §5.2's stated reason for the mirror did not reproduce

§5.2 says OpenCode "bootstraps `.opencode/package.json` and plugin dependencies
in its project directory before the model answers". **At 1.18.27, with the §5.1
isolated `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME`, it does not.**
Across six spike roots and every turn above, no `.opencode` directory appeared
in any project directory; the bootstrap landed in `XDG_CACHE_HOME/opencode/bin`,
`XDG_DATA_HOME/opencode/repos` and `XDG_DATA_HOME/opencode/log`. The only files
in a mirror after a run were the ones put there and the ones a tool call wrote.

**The mirror stays**, and §9 keeps `mirror.py`, for the reasons that did
reproduce: a tool call writes into the project directory whenever the ruleset
lets it (measured — `hacked.txt`), ACT needs a directory that is not the
repository, and an isolation that depends on three environment variables being
right is not one to lean the whole read boundary on. But §5.2's sentence
describes a version that is not the pinned one, and criterion 7's "including
through OpenCode's own `.opencode` bootstrap" has no instance to catch.

#### G — a server is 242 MB, and attribution has only one path

The pair of measurements that amended §5.1 from a cache to a lease.

| Measurement | Result |
|:--|:--|
| An idle REX-spawned `opencode serve`, by `lukas-ps` | **242 MB RSS**, one process |
| `options.headers` on the private provider, through to LiteLLM | **arrives** — `x-rex-thread` and `x-rex-profile` in the traffic log, on the row whose `model` and `tokens_in` are that turn's |
| A header on REX's own request to the OpenCode server | never reaches the gateway. The client addresses the server, not the model API — the two-plane shape of §2, in the one place it costs something |

So attribution is per run, it can only live in the config, and a config is what a
server is started with. §5.1 records what follows.

---

### 10.7 Milestone 1, run 2026-09-07 — the seam, end to end

Spec 42's real service on a real pipe, driven exactly as `service.ts` drives it:
one `agent_runner` child, JSON lines each way, an `opencode` route at
`http://127.0.0.1:24334/v1` with `Environment variable` auth, REX's own gateway
behind it and `lmstudio-google-gemma-4-e4b` behind that. No UI — what is under
test is the adapter and the pipe — but everything else is the real thing.

**24 checks, all passing.** The ones that are criteria:

| # | Check | Result |
|:--|:--|:--|
| — | `describe` lists `opencode` | `['claude-agent', 'codex', 'opencode']` |
| — | An ASK answers a real question about a real document | **4.0 s**, `['started','thinking','tool_call','tool_result','text','completed']`, answer *"The secret number is 41."* |
| — | The reviewer's own prompt is not stored as the answer | passes — see §10.8, the bug this caught |
| 5.3 | A `seed` session's supplied id is discarded | the id came back as OpenCode's own `ses_…` |
| **7** | **ASK cannot change the reviewed workspace** | a prompt ordering `write hacked.txt` **and** `bash rm notes.txt`: both refused, workspace **byte-for-byte unchanged** |
| **6** | A refusal names the tool | `denied` events for `write` and `bash`; `RunResult.denials` carries both with REX's own sentence |
| — | A refusal is not a failure | the `tool_result` rows are `denied: true`, not `isError` alone |
| **10** | Stop | `['started','thinking','stopped']` — **one** `stopped`, `error: null`, `stopped: true` |
| **9** | Resume after a **service** restart | a second `agent_runner` child found the session and the model answered *"41"* from it |
| — | A session the server never had | `exists: false`, which is what sends REX down its own replay path |
| **16** | The traffic log | **13 rows** carrying `x-rex-thread: thread-e2e-47` and `x-rex-profile: read`, request bodies showing the tool calls |
| **18** | The gateway switched off | *"Cannot connect to API… Nothing answered at `http://127.0.0.1:24399/v1`. If this is REX's own built-in gateway, it is switched off — turn it on in Settings."* |
| 4 | No server left behind | every `opencode serve` this run started had exited |
| 17 | `grep -rn "24334\|localhost" adapters/opencode/` | finds nothing |

Criterion 18 was the last to pass and it was **fixed in the wrong place first**.
When the gateway is off nothing fails at REX's HTTP layer: the OpenCode server
starts perfectly and is perfectly reachable, and it is *OpenCode* that cannot
reach the model. So the failure arrives on the event bus as prose — "Cannot
connect to API: Unable to connect. Is the computer able to access the url?" —
and REX's sentence has to be appended there, in `_session_error`, rather than in
the exception handler where it was put first.

### 10.8 The one mapping bug, and why it looks like a working run

Worth its own section because it passed every other check.

**OpenCode echoes the reviewer's own prompt back onto the bus as a `text`
part.** A part carries `messageID` and no role, and the role lives on a separate
`message.updated` event. So the first version of §6's mapping stored the
reviewer's question as the agent's answer, and then the real answer after it —
producing rows like `"Reply with exactly one word: readyready"`. Nothing errored,
the run completed, the tokens were right, and a transcript read as though the
agent had repeated the question back.

`adapter.py` now tracks `message.updated` into a `messageID → role` map and drops
every part of a `user` message. A part whose message has not been seen is
**kept**, because losing an answer is worse than keeping an echo.

### 10.9 Milestone 2's gate, 2026-09-07 — §7.4's boundary HOLDS on macOS

§7.2 said the honest difference between OpenCode and Codex is that Codex has an
operating-system sandbox and OpenCode has prompts. That is true of the two
*products*, and it turned out not to settle the question, because a sandbox can
be put **around** the server rather than found inside it.

`sandbox-exec` — macOS's seatbelt, deprecated since 10.10 and still enforcing on
**26.6.2** — is the same mechanism Codex's own sandbox uses. So REX is not
inventing a containment scheme; it is using the one the platform already gives
agents. `server.py` writes a profile per server and wraps the spawn.

**Two runs, both green.** The first by hand, the second through REX's own
registry — because a boundary that works in a spike and is not wired up is not a
boundary:

| Check | Result |
|:--|:--|
| `opencode serve` starts inside a seatbelt | **0.43 s**, no different from bare |
| An edit inside the mirror | **works** — ACT is useless otherwise |
| `bash` writing to a directory outside it | **`zsh:1: operation not permitted`** |
| The `write` tool with an absolute path outside it | blocked; the file is unchanged |
| `touch` outside it | nothing appears |
| REX wrote the profile, and it denies writing and allows the mirror | yes |
| **A full ASK end to end with the sandbox on** | §10.7's 24 checks, still 24 |

Three things this cost, each worth writing down because each is silent:

1. **Every path in a profile must be resolved.** `/tmp` is a symlink to
   `/private/tmp`, and a profile naming the unresolved form allows **nothing** —
   seatbelt does not complain about a subpath that matches no file. It is the
   first thing that went wrong.
2. **The temp directory has to be allowed**, because Bun will not start without
   it. That is the profile's one real weakness: a workspace under `TMPDIR` would
   be inside the boundary. It is also what made the first measurement *lie* —
   the fake repository was under `TMPDIR`, the escape "succeeded", and the
   boundary was blamed for the test's own mistake.
3. **`ps` cannot tell you whether a process is sandboxed.** `sandbox-exec`
   applies the profile and then `exec`s the target, so the argv on that pid
   becomes the bare program. The only honest test of this boundary is
   behavioural, which is why the assertion in `test_opencode_server.py` is about
   `sandbox_command`'s argument list and the proof is a denied write.

**ASK has the layer too**, and gets it for nothing. §7.3's boundary rested on the
ruleset, the policy and the mirror; it now rests on those and an operating-system
denial, on macOS. Linux and Windows have no profile written — `landlock` and a
job object are the equivalents and neither exists — so `sandbox_available()` is
false there and §7.4 stays a gate rather than a warning.

---

---

### 10.10 Milestone 2, run 2026-09-07 — an ACT that cannot touch the originals

Driven exactly as `apply.ts` drives one: `cwd` is the repository, `writable`
names the spec 22 working copies, the profile is `write`, and the policy is
`policyFor('write', 'opencode')` — which allows every tool that is not MCP,
exactly as `writeGateDecision` does for Claude. Real service, real pipe, real
`opencode serve`, real gateway, real model.

**The hostile question is asked first, because it is the one that matters.**

| # | Check | Result |
|:--|:--|:--|
| 1 | `supports_act` where the boundary is proved | **true**, and `capabilities().error` is `None` |
| 2 | A prompt ordering `bash` **and** `write` at two originals | `bash`: *"operation not permitted"*. `write`: an error from OpenCode's own filesystem layer. **The repository is byte-for-byte unchanged and nothing was created** |
| 3 | A legitimate edit of the working copy | written, and reported as `wrote` + `diff` naming `/…/work/report.md` — the path REX's accounting already understands |
| 4 | The original after that edit | unchanged |
| 5 | An ACT with an empty `writable` | **refused before anything started**: *"An OpenCode run that may write was given no writable directory… This is REX's bug, not the gateway's — report it."* |

The agent's own words on the hostile turn are worth keeping, because they are
what a reviewer would read in the transcript:

> Both commands have been executed as requested. The `bash` command failed with
> "operation not permitted," and the `write` tool reported an unknown error…

That is the boundary being visible without being explained away — the run did not
crash, the agent noticed, and the transcript says so.

#### The bug that looked like a stupid model

The first attempt produced **no tool call at all**: the model echoed the prompt
and stopped, and the obvious reading was that a small local model had failed to
follow an instruction. It had not. `external_directory` was `ask` in the ruleset
and nothing was answering it, so OpenCode refused the write **before** the call
reached a file — and a refused-before-it-happened tool call looks, from the event
bus, exactly like a tool call the model never made.

Allowing `external_directory` in the ACT ruleset fixed it, and §7.4.1 records why
that is safe rather than a hole: the working copies are outside the project
directory by construction, so the permission is not a boundary here — layer 4 is.

#### One regression this run caught

Widening the registry from one mirror to a list of writable roots left
`session_state` passing a single `Path` where a `list[Path]` was wanted. Two
end-to-end checks went red — "the session is resumable" and "the session survives
a service restart" — and `basedpyright` had the answer in one line. **The type
check should have been run before the end-to-end run**, not after; it is the
faster and more precise of the two, and it was skipped.

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
   **The first two sentences are met and measured (§10.10); approve, discard and
   undo after an OpenCode ACT have not been driven.**
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

### 0 — prove the OpenCode seam · **PASSED 2026-09-07, §10.6**

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

### 1 — OpenCode ASK · **BUILT 2026-09-07, proved in §10.7**

Executable preflight, `client.py`, the server registry, private provider
configuration, the project mirror, session persistence, SSE normalisation and
reconciliation, the §7.1 mapping, permissions, cancellation, the `list_sdks()`
row, and the transcript and debug labels.

*Tests, as built:* the §7.1 mapping and both rulesets in
`tests/test_opencode_tools.py`, including that an unknown name arrives as
`None`; recorded 1.18.27 events → `AgentEvent` in `tests/test_opencode_events.py`;
`client.py` against a fake server in `tests/test_opencode_client.py`; the config,
the keys, the child environment and the mirror in `tests/test_opencode_server.py`.
**79 new tests; 298 pass in the package.** They are four files rather than the
two the plan named, because the mapping and the server are separately testable
without a process and a spec that says "pure and separately tested" (§9) should
get what it asked for.

*Done, and how it was checked:* §10.7 is the run — an OpenCode route answered a
real question about a real document, resumed after a **service** restart,
stopped cleanly, and the §7.3 hostile prompt (`write` **and** `bash rm`) left the
workspace byte-for-byte unchanged. All on `http://127.0.0.1:24334/v1`, with 13
rows in the traffic log carrying this thread's `x-rex-thread` — which is also the
check that REX really went through its own gateway rather than reaching a model
some other way.

**Criterion 14 was taken separately**, because it is about two adapters rather
than about one: a `claude-agent` run and an `opencode` run, both through the
built-in gateway, under one `asyncio.gather` on one service. Both answered —
`"claude"` and `"41"` — and their session ids kept their own shapes, a uuid and
a `ses_…`, with neither answer in the other's stream.

**And the sheet was driven in a real window**, 2026-09-07: `Manage gateways` →
`Built-in` → `Edit` shows `OPENCODE EXECUTABLE` with the placeholder
`Auto-detect` and the resolved
`1.18.27 · ~/.opencode/bin/opencode (auto-detected)` under it, plus a
`MODELS FOR OPENCODE` list beside the other two — which is `list_sdks()`'s third
row arriving with no UI change, as §8 says it would. The run also exercised spec
46 §4.2.1 by accident and correctly: the spike's gateway held 24334, REX's own
walked to 24335 and rewrote all four routes.

**What milestone 1 has NOT proved:** an OpenCode ASK driven by mouse from the
composer on a real document. §10.7 drove the library and the sheet; nobody has
selected text, typed a comment and pressed **Ask** on an OpenCode route.

### 2 — OpenCode ACT · **BUILT on macOS, 2026-09-07 (§10.9, §10.10)**

The gate was "§7.4's boundary proof", and it is taken: `sandbox-exec` around
`opencode serve`, measured twice — by hand and through REX's own registry — with
a shell command aimed outside the writable roots getting `operation not
permitted`. It is wired into `server.py`, so **ASK runs inside it too** and gets
the layer for nothing.

§7.4.1 chose option B, so there is no copy-back to build: a write turn runs in
the workspace exactly as a Claude ACT does, and the seatbelt allows precisely
the spec 22 working copies.

*Done, and how it was checked:* §10.10 is the run. A prompt ordering `bash` and
`write` at the originals produced `operation not permitted` and an error, with
the repository **byte-for-byte unchanged and nothing created**; a legitimate edit
changed the working copy and came back as `wrote` and `diff`; and an ACT with an
empty `writable` was refused before anything started.

**Still unproven:** approve, discard and undo after an OpenCode ACT. They are
spec 22 and spec 34's machinery and this adapter feeds them the same `wrote` and
`diff` events Claude does, so there is no reason to expect a difference — but no
reason is not a measurement.
