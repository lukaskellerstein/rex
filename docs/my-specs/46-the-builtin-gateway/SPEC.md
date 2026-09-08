# REX 46 — the built-in gateway

**Amended by [spec 50](../50-macos-completely/SPEC.md):** §13's packaging is macOS only. The Windows and Linux builds this spec describes were made, installed and validated on 2026-09-07 and removed on 2026-09-08; spec 50 §5 keeps what they measured.

**Version:** 1.0 · 2026-09-06
**Status:** **proposal. Nothing in this spec is built.**
**Depends on:** [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
— the Python package, the pipe, the descriptor, `ResolvedRoute`;
[`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md) — the gateway
rows, the per-send controls, the session model, the child environment;
[`45-watching-the-gateway/SPEC.md`](../45-watching-the-gateway/SPEC.md) — the
attribution headers a run already sends.
**Amends:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §3 invariant **I3** and
§12 (the forbidden list); spec 43 §2.3 (the kinds), §4.3 (the model list) and
§6.1 (secrets are references).
**Answers:** [`../45-watching-the-gateway/OPEN-PROBLEM-gateway-shapes.md`](../45-watching-the-gateway/OPEN-PROBLEM-gateway-shapes.md)
— for every kind that survives this spec. §4.5 is why the problem stops
existing rather than being solved.
**Retires:** spec 45's four containers and the whole of `infra/`, in milestone 3.
Spec 45's three attribution headers **stay** and gain a second job: they are how
§4.6 filters one comment's traffic out of the gateway's log.

> [!important]
> **This spec turns REX into something a person installs.** Everything before it
> assumed a reviewer who runs `docker compose up` in another repository. After
> it, a person double-clicks an installer, opens Settings, adds their OpenAI key
> or points at LM Studio, and REX works. That is the whole reason the shape
> below is worth the size it costs.

---

## 1. Why

REX today can only reach a model in two ways: the reviewer's own Claude
subscription (`Original`), or a gateway the reviewer runs themselves in
`~/Projects/Github/lukaskellerstein/ai-gateway`. The second is not a product
feature. It is a development arrangement that happens to work on one machine,
and it cannot be shipped: it needs Docker, two compose projects, a YAML file per
engine, and the knowledge of which alias suits which SDK.

Three things follow from wanting to distribute REX as a Mac, Windows and Linux
application:

1. **REX must be able to reach models with no other software installed.** A
   gateway has to be inside the app.
2. **The person configuring it is not the person who wrote the gateway.** They
   pick "OpenAI" and paste a key. They never see a YAML file.
3. **REX must support exactly one gateway product.** Two products mean two sets
   of conventions, and the open problem in spec 45's folder is eleven pages
   about what that costs.

### 1.1 Why LiteLLM and not Envoy

Both were measured. Envoy is smaller and starts faster, and it still loses:

| | LiteLLM | Envoy AI Gateway |
|:--|:--|:--|
| **Windows** | yes, it is Python | **no.** `aigw run` docs: *"Currently, `aigw run` supports Linux and macOS"* |
| First run needs the network | no | **yes** — the Envoy binary is downloaded through `func-e` |
| Claude SDK against hosted OpenAI | **works, 7/7** | **fails every call** — `thinking` is passed through verbatim and OpenAI answers `400 Unknown parameter: 'thinking'` (`ai-gateway/TESTING.md` §5.2, upstream PR #2099) |
| OpenCode against GPT-5.x | works — LiteLLM renames `max_tokens` | **fails** — no body rewriting (`TESTING.md` §5.3) |
| One alias for all four SDKs | **yes** (§4.5) | no — a second `-anthropic` alias per model |
| Runtime already in REX | **yes** — spec 42 ships Python | no, a Go and a C++ binary |
| Resident memory, idle | 296 MB | 130 MB |
| Ready after start | 1.6 s | 1.3 s |

The memory and startup rows are the only two Envoy wins, and on a machine
running a local language model they are noise: one 26B model resident outweighs
both gateways by an order of magnitude. The Windows row alone decides it.

> [!note]
> **Envoy is not being deleted from the reviewer's world.** `infra/envoy/` and
> spec 45's observability stack stay exactly as they are — they are development
> infrastructure and this spec does not touch them. What goes is REX's *support
> for configuring an Envoy as a gateway*, which is §3.1.

### 1.2 What this spec is not

It is not an observability feature (spec 45), not a cost dashboard, and not a
model router. REX picks one model per send and always has. LiteLLM is here to
speak four protocols to many providers, and for nothing else.

---

## 2. What changes, in one table

| Area | Before | After |
|:--|:--|:--|
| Gateway kinds | `original`, `litellm`, `envoy`, `custom` | `original`, `builtin`, `litellm` (§3) |
| Reaching a model | the reviewer runs a gateway | REX runs one, on a switch (§4) |
| Configuring models | typed by hand, per SDK, per gateway | providers and a model picker (§5) |
| Model names | one list per SDK, because Envoy routed on the name | **one list, full stop** (§4.5) |
| Credentials | the NAME of a shell variable (43 §6.1) | the value, encrypted, in REX's own store (§7) |
| Settings | a "Manage gateways…" sheet | a Settings sheet with two tabs (§8) |
| Seeing a thread's traffic | four containers and Grafana (spec 45) | a file the gateway writes, read in a REX sheet (§4.6) |
| `infra/` | REX's own Envoy and the observability stack | **deleted**, milestone 3 |
| The Python package | `agent-gateway/` | `agent-runner/`, plus a new `local-gateway/` (§9, §10) |
| Invariant I3 | REX listens on nothing | REX listens on nothing; **one loopback port carries inference** (§4.2) |

---

## 3. The three kinds

```python
GatewayKind = Literal["original", "builtin", "litellm"]
```

| Kind | How many | What it is | Editable |
|:--|:--|:--|:--|
| `original` | exactly one | **not a gateway.** Each SDK's own endpoint on the reviewer's own login — `claude login`, the Codex subscription. Spec 43 §2.5, unchanged | no |
| `builtin` | exactly one | REX's own LiteLLM, on `127.0.0.1:24334`. A switch turns it on and off | its providers and models, always |
| `litellm` | zero or more | a LiteLLM somebody else runs. A URL and a key. REX asks it what it serves | yes |

All three can exist at once, and the composer's gateway control already draws
them as one list — spec 43 §4, built. A person can have `Original`, the built-in
one, and two external LiteLLMs, and pick between them per message. The model
dropdown follows the chosen gateway, which is spec 43 §4.1's cascade, also
built.

> [!note]
> **`builtin` and `litellm` are the same product, so they share every route
> template.** The only difference is who starts the process and who owns the
> configuration. That is why this is two kinds and not two products, and why §6
> is short.

### 3.1 What goes, and what happens to rows that exist

`envoy` and `custom` are removed. There is no deprecation period, because the
only person with rows of either kind is the reviewer.

**Measured in `~/.rex/rex.db` on 2026-09-06** — two `envoy` gateways exist:

| id | name | Claude route | Claude models |
|:--|:--|:--|:--|
| `gw-72ebc684…` | Envoy LMS | `http://localhost:26334/anthropic` | `lms-26b` |
| `gw-2ac13cc2…` | Envoy Unsloth | `http://localhost:26334/anthropic` | `unsloth-26b-anthropic` |

The first row is the open problem in one line: its Claude model is `lms-26b`,
not `lms-26b-anthropic`, so it is configured to fail on turn two of any real
conversation — intermittently, about one run in five. Nobody noticed, because
nothing could notice.

**The migration deletes both rows and says so once**, naming them, in the
Settings screen. Deletion is correct rather than harsh:

- A row that cannot run must not be selectable. That rule is already in the
  schema (spec 43 §2.2's `CHECK (auth <> 'none' OR base_url IS NOT NULL)`), and
  a gateway whose product REX no longer supports cannot run.
- **No history is lost.** Spec 43 §2.6 rule 2 copies the SDK, gateway name, base
  URL and model onto every message. An old answer still says which gateway
  produced it after that gateway is gone.
- `thread_session` rows cascade on `agent_gateway` delete (`schema.sql:244`), so
  a deleted gateway costs a replay on a thread that used it, never the thread.

§15 is the migration in full.

---

## 4. The built-in gateway

### 4.1 The switch, and what "off" means

The built-in gateway is a **permanent row**, created by the migration, in the
same way `Original` is. It is never created and never deleted by a person. It
carries one flag:

```sql
ALTER TABLE agent_gateway ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```

| Switch | The child | The row in the send picker | Providers, models and keys |
|:--|:--|:--|:--|
| on | running | shown | kept |
| off | stopped | hidden | **kept** |

> [!important]
> **Turning it off deletes nothing.** The reviewer asked for exactly this: "it's
> already the second time that he is enabling it and he already has some
> configuration — we should not force him to fill it in again." Off is a
> statement about a process, not about a configuration. `enabled` is the only
> column the switch writes.

**Enabled means running.** REX starts the child when the app starts with the
switch on, and when the switch is turned on. It is not lazy. A switch that says
"on" while nothing runs is a switch that lies, and the Settings screen shows the
live port, which needs a live process. The cost of that choice is stated on the
screen: **296 MB and about 1.6 seconds**, measured (§18).

### 4.2 The port

**A port is unavoidable.** Every SDK reaches a gateway by URL —
`ANTHROPIC_BASE_URL` for Claude, `base_url` in a Codex `model_provider`,
`baseURL` for OpenCode's provider, `base_url` for `ChatOpenAI`. None of them
speaks a pipe, and none can address a Unix socket: the Claude CLI needs an
`http://host:port` URL. A socket was considered and does not work on the client
side, which is the side REX does not control.

| Fact | Value |
|:--|:--|
| Address | **`127.0.0.1` only.** Never `0.0.0.0` |
| First port | **24334** |
| If busy | 24335, 24336, … up to **24343**, then fail loudly, naming the ports tried |
| Override | `REX_GATEWAY_PORT=N` |

**Why 24334.** `24xxx` is the LiteLLM family on this machine — the reviewer's own
is 24000 — and `334` is REX's own signature: 9334 the debugger, 5334 Vite, 26334
REX's Envoy. It reads as "LiteLLM, REX's own". Measured free on 2026-09-06.

> [!warning]
> **A busy port is never adopted.** If something already answers on 24334, REX
> must not assume it is a LiteLLM of its own, and must never send it a provider
> key. REX claims a port by *starting its own child on it*; if the child cannot
> bind, REX moves up a number. There is no "is something already there?" probe
> whose answer could be trusted.

The debug report (spec 13) prints the port REX **got**, not the port it wanted,
for the same reason it does that for 9334.

#### 4.2.1 A moved port must reach the stored route

> [!warning]
> **This is the one place where the walk-up can silently break a run.**
> `resolveRoute()` in `bridge.ts:277` returns `route.baseUrl` **as stored**. A
> built-in row written with `:24334` that starts on `:24335` would resolve to a
> dead address, and the failure would look like a broken gateway rather than a
> moved port.

So: **the moment the child is listening, main rewrites the built-in gateway's
four routes with the live port**, before anything can resolve one. The database
holds the truth, `resolveRoute()` stays exactly as it is, and no caller learns
that a port can move.

The consequence is correct and worth naming rather than discovering. Spec 43
§5.2 keys a session on `(thread, sdk, gateway)` and stores the `base_url` it was
created against, so **a moved port invalidates that thread's sessions on the
built-in gateway** and the next send replays instead of resuming. That is the
rule working: a different address is a different server, and asking it to
continue state it never saw is precisely what §5.2 exists to prevent. A replay
costs one transcript; a wrong resume costs the answer.

### 4.3 The child

| Question | Answer |
|:--|:--|
| Command | `<bundled python> -m local_gateway serve --port <N>` |
| Owner | the main process, exactly as `agent-runner` is (spec 42 §4.1) |
| Config | `~/.rex/gateway/config.yaml`, written by REX (§4.4) |
| Database | **none.** LiteLLM runs with no `DATABASE_URL`; measured |
| Master key | random per launch, passed as `LITELLM_MASTER_KEY`, **never written to disk** |
| Death | killed on quit and on crash. `~/.rex/gateway/child.json` records pid and port so the next start can clean up after a hard kill |

> [!warning]
> **A gateway that outlives REX is a key server nobody is watching.** It holds
> every provider key in its process environment. Killing it on quit is not
> tidiness; it is the security boundary. The pid file exists because a `SIGKILL`
> on REX skips every handler REX has.

**Restarting.** A change to providers or models rewrites `config.yaml` and
restarts the child, which costs 1.6 s. LiteLLM has no hot reload without a
database, and adding a database to get one is not worth 155 MB and a migration
step. **The restart waits for in-flight runs** and the screen says it is
waiting: a local model turn takes 5 to 15 minutes (spec 43 §7), and killing the
gateway underneath one would lose it.

### 4.4 The config REX writes

One file, regenerated whole every time, never hand-edited and never merged:

```yaml
# Written by REX. Every edit here is lost on the next change in Settings.
model_list:
  - model_name: lms-google-gemma-4-e4b
    litellm_params:
      model: lm_studio/google/gemma-4-e4b
      api_base: http://127.0.0.1:1234/v1
      api_key: os.environ/REX_PROVIDER_LMSTUDIO
      timeout: 3600
    model_info:
      max_input_tokens: 122880
      max_output_tokens: 8192

litellm_settings:
  # Without this the Claude Agent SDK receives NO thinking blocks from any
  # `openai/` provider. Global; there is no per-model override. The evidence is
  # `ai-gateway/litellm/config/settings.yaml:99-146`, measured by its author.
  use_chat_completions_url_for_anthropic_messages: true
```

Four rules the writer keeps:

1. **Every model names its key explicitly**, as `os.environ/REX_PROVIDER_<ID>`.
   Never omitted. A missing `api_key` lets LiteLLM fall back to whatever
   `OPENAI_API_KEY` happens to be in the inherited environment, which would send
   a paid request the person never configured.
2. **`use_chat_completions_url_for_anthropic_messages: true`, always.** It is the
   line that makes the Claude SDK work through an `openai/`-provider model.
3. **`max_input_tokens` comes from the provider**, minus an 8192 output reserve,
   floored at half the window. That formula is
   `ai-gateway/litellm/discover/gateway_discovery.py:207-215` and it is copied
   rather than reinvented.
4. **No secret value is ever written into the file.**

### 4.5 One alias, four SDKs — why the open problem stops existing

LiteLLM answers `/v1/messages`, `/v1/chat/completions` and `/v1/responses` from
**the same `model_name`**. Measured 2026-09-06: one alias called `probe`, and all
three routes accepted it and reached the upstream call.

So a model chosen in REX is one string, usable by every SDK:

| SDK | Path it addresses | Alias it sends |
|:--|:--|:--|
| Claude Agent | `{host}/v1/messages` | `lms-google-gemma-4-e4b` |
| Codex | `{host}/v1/responses` | the same |
| OpenCode | `{host}/v1/chat/completions` | the same |
| Deep Agents | `{host}/v1/chat/completions` | the same |

Envoy could not do this: an `AIGatewayRoute` rule matches on headers alone, so
the protocol had to be chosen by the model name, which is where the `-anthropic`
duplication came from. **The open problem of spec 45's folder — "which listed
name suits which SDK" — has no instances left once Envoy is gone.** It is not
solved. It stops being a question.

The per-SDK model textarea in `ManageGateways.tsx` therefore goes, and
`gateway_route.models` becomes one list per gateway rather than one per route.
§11 keeps the column where it is and writes the same value to all four rows, so
no query changes.

### 4.6 The traffic log — what actually went through

Spec 45 gave a comment card a button that opens **this thread's** requests and
responses. That button stays, and §15 deletes the four containers behind it. So
the gateway keeps the record itself.

**A LiteLLM callback, named in the config REX writes:**

```yaml
litellm_settings:
  callbacks: rex_trace.proxy_handler_instance
```

`local-gateway/rex_trace.py` implements `async_log_success_event` and
`async_log_failure_event` and appends one JSON line per request. **Failures are
recorded too**, which is more than the Grafana stack gave: a request that never
reached a model still leaves a row saying why.

**Measured 2026-09-06** — one real request through LiteLLM to LM Studio on
`:1234`, with REX's three headers, no database anywhere:

| Field | Value it captured |
|:--|:--|
| `thread` | `thread-abc123` — **spec 45's `x-rex-thread`, straight through** |
| `run`, `profile` | `run-777`, `read` |
| `model` | `google/gemma-4-e4b` — the engine's own id, not the alias |
| `ms` | 427 |
| `tokens_in`, `tokens_out` | 22, 2 |
| `cost` | 0.0 |
| `request_body` | the whole body REX sent |
| `response` | the whole reply, `choices` and all |

> [!important]
> **This is what spec 45's three headers are for.** They were attribution for a
> Grafana that is going away; they are now the join key that turns a pile of
> requests into *this comment's traffic*. Nothing about them changes —
> `attribution.py` and both adapters keep sending them.

**Where it goes, and for how long:**

| | |
|:--|:--|
| Path | `~/.rex/gateway/traffic/YYYY-MM-DD.jsonl`, one file per day |
| Retention | **30 days**, and a total size cap. Oldest day deleted first |
| Bodies | captured **by default**, with a switch in Settings to stop |
| Reading it | the comment card's existing button, opening a REX sheet |

> [!warning]
> **This file is a plaintext record of your prompts and your documents' text.**
> It holds no credential — the callback never sees a provider key, and §14 rule 3
> covers it — but it does hold what you asked and what the model answered. It
> lives in `~/.rex/`, outside every repository, and the Settings switch that
> turns bodies off is there because on someone else's machine that trade lands
> differently.

**Only the built-in gateway has one.** REX writes its config, so REX can install
a callback. An existing LiteLLM belongs to someone else and REX will not ask it
to load code. On a `litellm` gateway the button says the traffic log is not
available and names why — it does not disappear, because a control that vanishes
looks like a bug.

**Why not LiteLLM's own admin UI.** It needs Postgres. Measured 2026-09-06 with
no database: `/ui/` answers `200` — the shell loads — while `/spend/logs` and
`/global/spend/logs` both answer `500`. Shipping a link to it would show a UI
whose every page fails. Adding Postgres to a desktop app costs 155 MB, a second
process and a schema migration on first boot, to reach a browser tab behind a
login. §17 declines it.

---

## 5. Model providers

### 5.1 The six

These are the six the reviewer named, and they are the six their own
`ai-gateway/litellm/config/` already carries, which is why the details below are
copied rather than guessed.

| Provider | Needs | LiteLLM prefix | Model list from |
|:--|:--|:--|:--|
| LM Studio | URL | `lm_studio/` | `GET /api/v0/models` |
| Ollama | URL | `openai/` | `GET /api/tags`, then `POST /api/show` per model |
| Unsloth | URL, sometimes a key | `openai/` | `GET /v1/models` |
| OpenAI | key | `openai/` | `GET /v1/models` |
| OpenRouter | key | `openrouter/` | `GET /v1/models` |
| Anthropic | key | `anthropic/` | `GET /v1/models` |

> [!note]
> **`openai/` is a protocol, not a company.** Ollama and Unsloth use it because
> they speak the OpenAI wire format; `api_base` is the only thing separating them
> from `api.openai.com`. The reviewer's own config says this in
> `litellm/config/unsloth.yaml:15`, and copying the sentence into REX's Settings
> help text saves the next person the same confusion.

> [!warning]
> **Anthropic as a provider is a second hop.** REX → LiteLLM → Anthropic, for a
> protocol that was already Anthropic. It is worth having for a person with an
> API key and no Claude subscription, and for reaching Claude models from Codex
> or Deep Agents. For a Claude model on a Claude login, `Original` is the shorter
> path and the screen says so once. Whether `thinking` blocks survive the hop is
> **unproven** — milestone 2.

### 5.2 The catalogue is data

The provider list is a table, with the same shape and the same rule as spec 42
§10's gateway kinds:

```python
class ProviderDescriptor(Model):
    id: str                    # "lmstudio"
    label: str                 # "LM Studio"
    prefix: str                # "lm_studio/" — what config.yaml gets (§4.4)
    fields: list[ConfigField]  # url, key — spec 42 §10's own type, reused
    local: bool                # free to enumerate? §5.4
    note: str                  # one sentence, drawn in Settings
```

**What the descriptor does NOT carry is how to ask.** That was tried and it does
not survive the six: LM Studio answers one `GET` with everything, OpenAI answers
one `GET` with almost nothing, and **Ollama needs two calls** — `/api/tags`,
then a `POST /api/show` per model to learn its context window. A data language
able to express that is a programming language with worse syntax.

So the split is:

| Part | Where | Shape |
|:--|:--|:--|
| What to ask the person, and what to write into `config.yaml` | the descriptor | **data** |
| How to ask the provider what it serves | `local-gateway/probes/<id>.py` | **one function per provider** |

Each probe answers the same type, and that is what keeps the rest generic:

```python
class DiscoveredModel(Model):
    id: str                    # the provider's own name for it
    context: int | None        # None when the provider does not say
    kind: Literal["chat", "embedding", "unknown"]
    tools: bool | None         # None when the provider does not say (§5.5)
```

This is exactly the shape of the prior art —
`ai-gateway/litellm/discover/gateway_discovery.py` has `probe_lms`,
`probe_ollama` and `probe_unsloth` side by side for the same reason — and it is
560 lines that already work.

> **The rule, stated precisely.** Adding a seventh provider is **a descriptor row
> and at most one probe function**. There is no `if provider ==` in anything that
> renders, validates, builds a route, or writes `config.yaml`. The probes are a
> lookup table keyed by id, and a provider whose listing is a plain
> `GET /v1/models` reuses the shared probe and adds no function at all.

### 5.3 Discovery — what each provider is asked

Measured 2026-09-06 against what was running on this machine.

**LM Studio, `GET http://127.0.0.1:1234/api/v0/models`** — 14 models, and the
richest answer of the six:

```json
{ "id": "google/gemma-4-e4b", "type": "vlm", "state": "loaded",
  "max_context_length": 131072, "quantization": "4bit",
  "capabilities": ["tool_use"] }
```

`type` is one of `llm`, `vlm`, `embeddings`. Its plain `/v1/models` carries only
`id`, `object` and `owned_by`, which is why the richer path is worth knowing per
provider rather than assuming one shape for all.

**Ollama** answers `/api/tags` and needs `POST /api/show` for the window —
`gateway_discovery.py:268-306`. Not running on this machine on 2026-09-06.

**Unsloth**, `GET :8888/v1/models`, answered **401** on 2026-09-06, so its
descriptor carries an optional key field. It reports the loaded model's window
only.

**OpenAI, OpenRouter, Anthropic** answer `GET /v1/models` with ids and no
windows. Their limits are not discoverable and REX writes none — §17. All three
use the shared probe and add no function of their own (§5.2).

**A ticked model that stops being offered is kept, and marked.** A refresh that
no longer lists it means the engine unloaded it, the account lost access, or the
name changed — three different problems, and REX can tell none of them apart.
Deleting the row would silently change what the person configured; keeping it
and drawing it as *"not offered when last asked"* leaves the decision with them.
It stays in `config.yaml` until they untick it, and a send against it fails with
the gateway's own error, which is the honest one.

### 5.4 Money is never discovered

A local provider may be enumerated freely: listing everything on the disk costs
nothing. A paid provider lists hundreds of models, **every one of which bills a
real account**, so:

> **REX lists what a paid provider offers. It adds nothing without a click.**

That rule is `gateway_discovery.py:35-38` in the reviewer's own repository, and
it is inherited word for word. It also settles what "Test" may do: a test that
sends a real turn to a paid model spends money, so it is a button with the cost
named, never something that runs on save.

### 5.5 What a model must be able to do

REX runs agents. An agent needs tool calls, and a model that cannot make one is
useless here in a way that is invisible until a run silently does nothing.

Where the provider says — LM Studio's `capabilities` array is the only one of
the six that does — the Models screen **marks a model that cannot call tools and
warns before it is added**. Where the provider says nothing, REX says nothing:
a guess would be worse than silence.

Embedding models are excluded outright. LM Studio's `type: "embeddings"` names
them; elsewhere they are recognisable only by name, and REX does not guess by
name. An embedding model added by hand fails at the first send with the
gateway's own error, which is an honest outcome.

---

## 6. An existing LiteLLM

A `litellm` gateway is a URL and a key. **REX configures no models for it**, and
that is the whole point: its models are already configured, inside it.

| | built-in | existing |
|:--|:--|:--|
| Who runs the process | REX | somebody else |
| Who writes `config.yaml` | REX | somebody else |
| Where models come from | the providers the person added (§5) | **`GET /v1/models`** |
| Model limits | REX wrote them | `GET /model/info`, when the key allows |
| Providers screen | applies | **does not apply** |

`GET /v1/models` on a LiteLLM carries `max_input_tokens` and
`max_output_tokens` per model — measured 2026-09-06 — so one call fills the
picker and the limits together.

> [!warning]
> **An external LiteLLM needs its master key before it will say anything.** The
> reviewer's own on 24000 answers `401` at `/v1/models` and at `/model/info`.
> An empty model list must therefore say *"add the key"*, never *"no models"*.

**A cached list is dated.** REX stores what the gateway answered, shows when it
asked, and puts a refresh beside it. A list that silently ages is how a person
concludes their gateway is broken when it merely gained a model.

---

## 7. Secrets

### 7.1 Nothing readable on disk

> **Every credential REX is given is stored encrypted. No plaintext, anywhere,
> ever.**

That is the reviewer's instruction of 2026-09-06 and it **reverses spec 43
§6.1**, which stored the *name* of an environment variable and deliberately
added no keychain. The reversal is forced by distribution: a person installing
REX has no `~/.secrets/secrets.enc.yaml` and no `direnv`, and telling them to
create a shell variable is not a product.

| Secret | Where it lives |
|:--|:--|
| A provider key (OpenAI, OpenRouter, Anthropic, …) | encrypted, in `~/.rex/rex.db`, decrypted in main only |
| An external LiteLLM's master key | the same |
| The built-in gateway's master key | **nowhere.** Random per launch, environment only |
| `claude login`, the Codex subscription | the SDK's own store. Not REX's business |

Encryption is Electron's `safeStorage`: the macOS Keychain, Windows DPAPI, and
`kwallet` or `gnome-libsecret` on Linux. The ciphertext goes in a `BLOB` column
in the database REX already keeps outside every repository. **The key that
decrypts it belongs to the OS keystore, not to REX**, so copying `rex.db` to
another machine carries no secrets — which is correct.

Nothing else changes. `bridge.ts` already resolves a route into a
`ResolvedRoute.token` and sends the value down the pipe once (spec 42 §4.4,
§5.3). After this spec it decrypts instead of reading `process.env`, and the
pipe, the adapters and the whole Python side are untouched.

### 7.2 What the config file holds

`config.yaml` holds `os.environ/REX_PROVIDER_<ID>` and never a value. The value
reaches LiteLLM in the child's environment, decrypted in main immediately before
spawn. A person who opens the file finds names.

### 7.3 The Linux caveat, which must be said out loud

> [!warning]
> **On Linux, `safeStorage` can silently be no storage at all.** With no keyring
> available it falls back to a backend called `basic_text`, and Electron's own
> documentation says items are then *"unprotected as they are encrypted via
> hardcoded plaintext password"*.
>
> So REX calls `safeStorage.getSelectedStorageBackend()` and, when the answer is
> `basic_text`, **says so before it stores a key**: the key will be saved
> without real protection, and here is how to install a keyring. Storing it
> anyway while displaying a padlock would be the worst of the three options.

`isEncryptionAvailable()` is only meaningful after the app's `ready` event on
Linux and Windows, so the store is opened after `ready` and never at module
load.

---

## 8. Settings

A Settings screen, reachable from the shell, with two tabs. The existing
`Manage gateways…` item in the composer's gateway menu opens it on the
`Gateways` tab, so the gesture people have does not break.

**Tab 1 — Gateways.**

```text
ORIGINAL          Your own Claude login                      always on

BUILT-IN          LiteLLM, inside REX                    [ on  ●——  ]
                  Running on http://127.0.0.1:24334
                  6 models from 2 providers · configure them in Models

EXISTING          Work LiteLLM      http://litellm.corp:4000   ✎  🗑
                  + Add a LiteLLM
```

**Tab 2 — Models.** The providers behind the built-in gateway, and nothing about
external ones (§6).

```text
+ Add a provider ▾   LM Studio · Ollama · Unsloth · OpenAI · OpenRouter · Anthropic

LM STUDIO         http://127.0.0.1:1234                          ✎  🗑
                  ☑ google/gemma-4-e4b        128k    tools
                  ☑ google/gemma-4-26b        128k    tools
                  ☐ text-embedding-nomic      2k      embedding — cannot be used
                  Asked 3 minutes ago · Refresh

OPENAI            key set ✓                                      ✎  🗑
                  ☐ gpt-5.4          ☐ gpt-5.4-mini
                  Nothing is added until you tick it. These models cost money.
```

**Where it lives.** REX has no "screen" today — it has sheets, rendered
conditionally at the end of `App.tsx` (`{gatewaysOpen && descriptor && gateways
? <ManageGateways … /> : null}`, `App.tsx:4798`). Settings is the same pattern
with tabs inside it, and it inherits the shadow root, the styling and the escape
handling that already work:

```text
src/renderer/overlay/
├── Settings.tsx          NEW — the sheet, the two tabs, and nothing else
├── SettingsGateways.tsx  NEW — tab 1: Original, the switch, external rows
├── SettingsModels.tsx    NEW — tab 2: providers, discovery, the model ticks
├── providers.ts          NEW — the pure questions, beside the components,
│                         as `gatewayChoices.ts` is (no JSX, so `node --test`
│                         can run its tests directly)
└── ManageGateways.tsx    becomes tab 1's body; the per-SDK model textarea
                          goes (§4.5) and the kind dropdown loses two rows
```

`App.tsx` gains one piece of state beside `gatewaysOpen`, and the composer's
existing `Manage gateways…` item opens the sheet on tab 1 — so the gesture
people already have keeps working and nothing else in the composer changes.

Four rules the screen keeps:

1. **A ticked model is a model REX will offer.** Nothing else reaches the
   composer.
2. **Every string a provider supplied is drawn as data, never as markup.** Spec
   42 §10's warning applies here with more force, because these strings come
   from a remote server rather than from a table REX wrote.
3. **A change restarts the gateway** (§4.3) and the screen says when it is
   waiting for a run to finish.
4. **The screen never shows a key**, not even masked-with-a-reveal. It shows
   `set` or `not set`, and offers replace and remove.
5. **The traffic log has one switch and one number** on tab 1, under the built-in
   row: capture bodies on or off, and how much disk the log currently holds with
   a way to clear it (§4.6).

The comment card's existing "this thread's traffic" button — `Icons.tsx:411`,
`CommentCard.tsx:755`, `channels.ts:948`, `ipc.ts:1724` — keeps its glyph, its
row and its IPC. **Only its destination changes**, from a Grafana URL to a REX
sheet reading §4.6's file. That is a smaller change than deleting it.

---

## 9. The rename — `agent-gateway` becomes `agent-runner`

The package named `agent-gateway/` is not a gateway. It runs agent SDKs. With a
real gateway arriving beside it, one word would mean two opposite things, so:

| Before | After |
|:--|:--|
| `agent-gateway/` | `agent-runner/` |
| module `agent_gateway` | module `agent_runner` |
| distribution `agent-gateway` | `agent-runner` |
| script `agent-gateway = …` | `agent-runner = …` |

**Decided 2026-09-06.** `agent-orchestrator`, matching Vex, was rejected on
purpose: Vex's orchestrator is a FastAPI service on NATS and ports, which is
precisely the shape spec 42 §15.1 refused to repeat. Borrowing its name would
import the confusion the spec spent a section avoiding.

Nine references break the build if missed, and they are the whole risk:

| Where | What |
|:--|:--|
| `package.json:58` | `test:library` does `cd agent-gateway` |
| `src/main/agent/service.ts:94` | walks the tree looking for a directory of that name |
| `service.ts:127` | spawns `python -m agent_gateway` |
| `pyproject.toml` | `name`, `[project.scripts]`, `packages = ["src/agent_gateway"]` |

The other ~210 uses are prose, comments and imports. `uv sync` must be re-run,
because the venv holds an editable install pointing at the old path, and the
three generated artefacts must be regenerated because they are produced by
`python -m <module>.protocol`.

Specs 42 to 45 are built and name the old directory throughout. They are
**updated as fact, not rewritten** — the same treatment the 2026-09-06 renumber
gave them — and spec 42 §3.1, which names the directory as a decision, gains one
line recording the rename and its reason.

---

## 10. `local-gateway/` — the second Python package

```text
rex/
├── agent-runner/     runs agent SDKs. Talks to main over a pipe. No port.
└── local-gateway/    runs LiteLLM. Serves inference on 24334.
```

**Two packages and not one, for three reasons:**

1. `agent-runner/`'s own rules forbid an HTTP server (spec 42 §3.2), and
   `litellm[proxy]` **is** one. Putting it there would break the rule that keeps
   the library reviewable.
2. Spec 42 §3.3 promises the library is reusable by projects that are not REX. A
   479 MB proxy in its dependency closure would end that.
3. They have nothing to say to each other. `agent-runner` is given a URL; it does
   not care who serves it.

**`local-gateway/` never imports `agent_runner`, and `agent_runner` never
imports `local_gateway`.** A test asserts both directions, exactly as spec 42
§3.2's rule is asserted today.

Its three entry points, all spawned by main:

| Command | Shape | Purpose |
|:--|:--|:--|
| `serve --port N` | long-running | LiteLLM itself |
| `discover --provider <id> --url <url>` | one shot, JSON on stdout | §5.3 |
| `write-config --out <path>` | one shot, reads JSON on stdin | §4.4 |

**No new pipe protocol.** Two of the three are ordinary commands that print JSON
and exit, which is the simplest thing that works and needs no generated
contract. The discovery code is a port of
`ai-gateway/litellm/discover/gateway_discovery.py` — 560 proven lines — which is
the second reason this half is Python rather than TypeScript.

---

## 11. The data model

```sql
-- §3 — one kind leaves, two arrive.
CHECK (kind IN ('original','builtin','litellm'))

-- §4.1 — the switch. Only the built-in row ever has this false.
ALTER TABLE agent_gateway ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

-- §5 — a provider behind the built-in gateway.
CREATE TABLE gateway_provider (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,        -- a ProviderDescriptor id (§5.2)
  label        TEXT NOT NULL,
  base_url     TEXT,                 -- null for a provider with a fixed endpoint
  key_cipher   BLOB,                 -- §7. safeStorage ciphertext. NEVER text
  listed_at    TEXT,                 -- when its models were last asked for
  created_at   TEXT NOT NULL
);

-- §5.5 — one model the person ticked. What REX writes into config.yaml.
CREATE TABLE gateway_model (
  provider_id  TEXT NOT NULL REFERENCES gateway_provider(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,        -- the provider's own id
  alias        TEXT NOT NULL,        -- the LiteLLM model_name REX generates
  max_input    INTEGER,
  max_output   INTEGER,
  tools        INTEGER,              -- 1 yes, 0 no, NULL the provider did not say
  PRIMARY KEY (provider_id, model)
);

-- §7 — an external gateway's key, beside the row it belongs to.
ALTER TABLE gateway_route ADD COLUMN token_cipher BLOB;
```

Three notes:

- **`credential_env` stays**, unused by new rows. Dropping a column rewrites a
  table in SQLite, and the column is harmless. A row has a `token_cipher` or a
  `credential_env`, never both, and the validator says so.
- **`gateway_route.models` is unchanged** (§4.5). REX writes the same list to all
  four SDK rows, so every query and every test keeps working.
- **`alias` is REX's**, generated as `<provider>-<slug(model id)>`, following
  `gateway_discovery.py:174-204`. The person never types one.

---

## 12. IPC

New channels, all `invoke` except the last (spec 01 §3, invariant I3):

| Channel | Answers |
|:--|:--|
| `gateway:builtin:state` | on/off, the port it got, running or not, and why not |
| `gateway:builtin:enable` | flips the switch; starts or stops the child |
| `gateway:provider:list` / `:save` / `:remove` | the providers behind it |
| `gateway:provider:discover` | what one provider serves, now (§5.3) |
| `gateway:models:save` | the ticked models; rewrites the config and restarts |
| `gateway:secret:set` / `:clear` | a key in, never out. **There is no `get`** |
| `gateway:builtin:status` (send) | started, stopped, restarting, waiting for a run |

> [!warning]
> **No channel returns a secret.** `gateway:secret:set` takes a value and answers
> `true`. The renderer displays untrusted document content (invariant I2) and
> must never be able to ask for a key, not even its own.

---

## 13. Packaging

Vex's `electron-app/scripts/bundle-python.mjs` is the model, as spec 42 §15.3
already recorded: `uv python install`, copy the standalone runtime, strip
`EXTERNALLY-MANAGED`, `uv pip install` both packages, ship under
`extraResources`. `service.ts:118` already looks for
`Resources/python/bin/python`, so the runtime lookup exists.

| Platform | Notes |
|:--|:--|
| macOS | the measured path. Signing and notarisation are a milestone of their own |
| Windows | **`python.exe` and `Scripts/`, not `bin/`.** `interpreterFor()` must branch on platform |
| Linux | the `safeStorage` caveat (§7.3) is a first-class case, not an edge |

**Size.** `litellm[proxy]` installs 479 MB, of which **193 MB is `polars`**,
imported only by three spend-report integrations REX never calls. Removing it
after install is a milestone task with a measurement attached, and the spec sets
no budget until that number is known.

---

## 14. Safety

1. **Loopback only.** The gateway binds `127.0.0.1`. A bind on any other
   interface is a bug, and a test asserts the argument.
2. **The child dies with REX** (§4.3).
3. **No key leaves main.** Not to the renderer, not into `~/.rex/rex.log`, not
   into a debug report, not into `config.yaml`. Spec 43 §6.3's rule — logs may
   carry a gateway name and a sanitised URL, never a credential — extends
   unchanged to the provider keys.
4. **Nothing is added without a click** (§5.4).
5. **ASK and ACT are unchanged.** The gate, the profiles and the deny hook do not
   know a gateway exists and must not learn. A model reached through the built-in
   gateway has exactly the tools the profile allows.
6. **A remote string is data.** Model ids from a provider are rendered as text
   and never as markup, and never used to build a file path.
7. **The traffic log holds no credential.** The callback sees the request body
   and the response, never `api_key` and never an `Authorization` header. A test
   asserts that a row containing a key cannot be written, because this file is
   the one artefact a person is most likely to paste into a bug report.

---

## 15. Migration

In order, in one transaction:

1. Widen `agent_gateway.kind` to `('original','builtin','litellm')`. SQLite
   rewrites the table for a `CHECK` change; the existing `migrateGateways` in
   `src/main/db/migrate.ts:474` is where it happens.
2. **Delete every `envoy` and `custom` row.** Their routes and their
   `thread_session` rows cascade. Record the names deleted (§3.1).
3. Keep every `litellm` row as it is. It is now "an existing LiteLLM", which is
   what it always was.
4. Insert the `builtin` row, `enabled = 0`, with routes for all four SDKs
   pointing at `http://127.0.0.1:24334` and `{host}/v1`.
5. Create `gateway_provider` and `gateway_model`, empty.

The Settings screen then shows one note, once: which gateways were removed and
why. On this machine that is two rows, `Envoy LMS` and `Envoy Unsloth`.

---

## 16. Acceptance criteria

| # | Criterion |
|:--|:--|
| A1 | A fresh install with no other software: switch on, add LM Studio, tick a model, ASK answers |
| A2 | The switch off, then on, and **nothing has to be typed again** |
| A3 | `grep -rn "0.0.0.0" local-gateway/ src/` finds nothing |
| A4 | No plaintext key anywhere: not in `rex.db`, not in `config.yaml`, not in `rex.log`, not in a debug report |
| A5 | Quitting REX leaves no `litellm` process. `SIGKILL`ing REX and restarting it leaves none either |
| A6 | One ticked model is selectable for **all four** SDKs, with one name (§4.5) |
| A7 | An external LiteLLM with no key says "add the key", not "no models" |
| A8 | Adding a seventh provider is a descriptor row plus at most one probe function (§5.2). No `if provider ==` in anything that renders, validates, builds a route or writes `config.yaml` |
| A9 | A paid provider adds no model without a click |
| A10 | On a Linux box with no keyring, REX says the key will not really be protected, **before** storing it |
| A11 | 24334 busy → REX runs on 24335 and the debug report says 24335 |
| A12 | `agent_runner` does not import `local_gateway`, and the reverse |
| A13 | An answer produced before the migration still names the gateway that produced it |
| A14 | The comment card's traffic button opens **this thread's** requests and responses, filtered by `x-rex-thread`, with no container running and no browser |
| A15 | No credential appears in `~/.rex/gateway/traffic/`. Turning body capture off leaves the timing, token and cost rows intact |
| A16 | On a `litellm` gateway the traffic button is present and says why it has nothing to show |

---

## 17. Deliberately out of scope

- **Cost tracking, budgets and virtual keys.** LiteLLM has them and they need a
  database. §4.6's file carries the per-request cost, which is what a comment
  card needs; a month-long dashboard is not this spec's.
- **LiteLLM's admin UI, and the Postgres under it.** Measured dead without a
  database (§4.6). REX renders the traffic itself.
- **Token limits REX invents.** Where a provider states a window, REX writes it;
  where it does not, REX writes none. §7.4 of the open problem, adopted.
- **Model routing, fallbacks, load balancing.** One send picks one model.
- **Any second gateway product.** That is the decision this spec exists to make.
- **Hot reload without a restart.**
- **Editing `config.yaml` by hand.** It is generated, and it says so.

---

## 18. Evidence — measured 2026-09-06

LiteLLM **1.100.0**, `litellm[proxy]`, in a scratch venv, no database, one model
pointed at a dead upstream, on `127.0.0.1:24999`:

| What | Result |
|:--|:--|
| Install size | **479 MB** — `polars` 193, `litellm` 90, `botocore` 25, `numpy` 22, `granian` 16, `openai` 15 |
| `import litellm.proxy.proxy_server` | 2.8 s |
| Spawn → `GET /health/liveliness` 200 | **1.6 s** |
| Resident memory, idle | **296 MB** |
| `/v1/models` with the key | 200, and it carries `max_input_tokens` and `max_output_tokens` |
| `/v1/models` without the key | **500, not 401** — so REX always sends it |
| `/model/info` with the key | 200; `model_info` carries the limits and `key: "openai/probe"`, the provider prefix |
| `/v1/messages`, `/v1/chat/completions`, `/v1/responses` | all three routed the same alias to the upstream (§4.5) |
| No `DATABASE_URL` | starts and serves |
| `/ui/` with no database | **200** — the shell loads |
| `/spend/logs`, `/global/spend/logs` with no database | **500** — every logs page behind that shell fails |
| A custom callback with no database | **works.** One real request to LM Studio produced a row with `x-rex-thread`, the model, 427 ms, 22/2 tokens, the cost, and the full request and response bodies (§4.6) |

Elsewhere on this machine, the same day:

| What | Result |
|:--|:--|
| Ports 24334, 24335, 24336 | free |
| LM Studio `:1234/api/v0/models` | 14 models, with `type`, `max_context_length`, `capabilities: ["tool_use"]`, `state` |
| LM Studio `:1234/v1/models` | the same 14, with `id`, `object`, `owned_by` and nothing else |
| Unsloth `:8888/v1/models` | **401** |
| Ollama `:11434` | not running |
| The reviewer's LiteLLM `:24000/v1/models` | **401** |
| REX's Envoy `:26334/v1/models` | 200, ten models, the same ten under `/anthropic` |

From documentation, not measured here:

- `aigw run`: *"Currently, `aigw run` supports Linux and macOS."*
- Electron `safeStorage`: macOS Keychain, Windows DPAPI, Linux
  `kwallet`/`gnome-libsecret`, fallback `basic_text` where items are
  *"unprotected as they are encrypted via hardcoded plaintext password"*;
  `isEncryptionAvailable()` meaningful only after `ready` on Linux and Windows.

### 18.1 What is still unproven

1. **`LITELLM_MASTER_KEY` as an environment variable.** The measurement used
   `general_settings.master_key` in the file. Milestone 0.
2. **A real agent turn through the built-in gateway**, carrying tool calls to
   completion. Milestone 1.
3. **The Anthropic provider hop** — whether `thinking` survives REX → LiteLLM →
   Anthropic. Milestone 2.
4. **Windows, entirely.** Nothing here has ever run on Windows. **Assumed to
   work** — the reviewer's call, 2026-09-06 — and proven in milestone 4 rather
   than blocking milestone 0. The likeliest break is one line: `interpreterFor()`
   (`src/main/agent/service.ts:118`) looks for `bin/python`, and a Windows
   standalone runtime has `Scripts/python.exe`.
5. **Removing `polars`** without breaking an import LiteLLM makes at start.
   Milestone 4.

---

## 19. Milestones

Each ends in something runnable.

### 0 — the rename, the package, and one port

`agent-gateway/` → `agent-runner/` (§9), `local-gateway/` created, LiteLLM
pinned, the child spawned by hand on 24334 with a config REX wrote. macOS only —
Windows is milestone 4 (§18.1 item 4).

*Done when:* `test:library` and `nvim-tools --json --all` are clean after the
rename; `curl 127.0.0.1:24334/v1/models` lists a model REX configured; the
master key arrives through the environment; the child dies with its parent.

### 1 — the switch, and a real turn

The `builtin` kind, the `enabled` column, the child's lifecycle, and a Claude
Agent SDK ASK against a local model through it, carrying a tool call to
completion.

*Done when:* A1, A2, A5, A6, A11.

### 2 — providers and the Models tab

The six descriptors, discovery, the picker, `config.yaml` generation, the
encrypted store, and **§4.6's traffic log with the comment card's button
pointed at it**.

*Done when:* A4, A8, A9, A10, A14, A15, and the Anthropic hop of §18.1 is
measured and recorded here.

### 3 — existing LiteLLM, the migration, and the end of `infra/`

The `litellm` kind reduced to a URL and a key, its model list from `/v1/models`,
`envoy` and `custom` removed, the migration run against a copy of the reviewer's
own database.

**`infra/` is deleted in this milestone and not before**, because it is what
specs 43, 44 and 45 were verified against and milestone 1 is where its
replacement is proven. Deleting the old thing before the new one works leaves
neither. It goes in one step, on the reviewer's machine:

```bash
cd infra && podman compose -f envoy/compose.yml down -v
podman compose -f observability/compose.yml down -v
podman image prune -a          # the aigw, collector, Tempo, Prometheus and Grafana images
cd .. && git rm -r infra
```

Spec 45 keeps its folder and its status. It records what was built and why it
was retired here; a built spec is not rewritten because the thing it built was
later replaced.

*Done when:* A7, A13, A16; §15 has run against `~/.rex/rex.db` with both Envoy
rows gone and every old answer still naming its gateway; `podman ps -a` lists
none of the five containers and `infra/` is gone.

### 4 — the installer

`electron-builder` for macOS, Windows and Linux. **Windows runs for the first
time here** (§18.1 item 4). `polars` removed and the size measured. Signing and
notarisation are named here and scoped in their own spec if they grow.

*Done when:* a person with none of this installed can double-click, switch the
gateway on, add a provider, and ask a comment a question.
