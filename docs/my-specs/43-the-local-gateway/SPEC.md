# REX 43 — the local gateway

**Version:** 4.1 · 2026-09-04
**Status:** **proposal. Nothing in this spec is built.**
**Depends on:** [`42-the-agent-library/SPEC.md`](../42-the-agent-library/SPEC.md)
(the seam, the route types, the Claude adapter, the descriptor);
[`01-initial/SPEC.md`](../01-initial/SPEC.md) §3 (the main-process boundary), §8
(one thread, one agent, one session — **this spec changes it**), §8.5 (session
replay), §9 (the schema), §10 (IPC);
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §6 (the safety gate);
[`13-debugging/SPEC.md`](../13-debugging/SPEC.md) §4 (the debug report);
[`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md) §2 (cancellation);
[`22-the-whole-workspace/SPEC.md`](../22-the-whole-workspace/SPEC.md) §3 (working
copies); [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
(the model picker and the durable model record);
[`31-how-the-agent-writes/SPEC.md`](../31-how-the-agent-writes/SPEC.md) (output
styles); [`34-the-permanent-copy/SPEC.md`](../34-the-permanent-copy/SPEC.md) §5
(documents held by a run); [`38-the-trace-block/SPEC.md`](../38-the-trace-block/SPEC.md)
(the transcript and its foot).
**Extended by:** [`44-the-codex-agent/SPEC.md`](../44-the-codex-agent/SPEC.md)
(which adds the agent control), [`45-the-opencode-agent/SPEC.md`](../45-the-opencode-agent/SPEC.md),
[`46-the-deep-agent/SPEC.md`](../46-the-deep-agent/SPEC.md).

> [!note]
> **This spec separates three things REX now calls "the model".** The **agent
> SDK** runs the loop and the tools. The **gateway** decides where inference is
> served from. The **model** picks one model behind that gateway. They are three
> controls, they are chosen **per message**, and each answer records all three.
>
> **In this spec the SDK is still Claude, and only Claude.** The gateway and the
> model become choices; the agent control that makes the SDK a choice too
> arrives with the second adapter, in spec 44. Everything the schema records
> already has room for four SDKs, so spec 44 adds a control and no column.
>
> **What changed in 4.0.** This was spec 42 v3.0, "the agent and its gateway".
> On 2026-09-04 the reviewer put the library first and moved this after it, and
> dropped MLflow: "The AI Gateway that we are going to use will be Envoy and
> LiteLLM. No MLflow." Three things follow. The adapter seam, the session shape
> and the route catalogue now live in spec 42 and are referenced here. The
> `{model}` URL placeholder is gone — MLflow's raw proxy was the only route that
> put the model in the address. And Envoy AI Gateway is a first-class kind,
> read from its source and from the reviewer's own `ai-gateway` repository,
> with milestone 3 to measure it.
>
> **What changed in 4.1.** Spec 42 became a Python package the same day. For
> this spec that moves four things and changes one fact: the Claude adapter's
> file is `agent-gateway/src/agent_gateway/adapters/claude/adapter.py`; the
> descriptor the gateway sheet renders arrives over the pipe (§4.5, §11); the
> credential crosses the pipe once, going down (§6.1); and the Python SDK
> documents `ClaudeAgentOptions.env` as **merged** onto the inherited
> environment, where the TypeScript one replaced it (§6.2).

---

## 1. Why

Spec 25 made the model selectable and left the API host fixed. Spec 42 put the
SDK behind a seam and kept the host fixed. This spec makes the host a choice.

The reviewer's words, 2026-09-03:

> The Claude Agent SDK will use my subscription that I have locally installed;
> that should be the default state. However I should also have the option to
> specify the AI gateway, my local one, so we could have a drop-down with the
> specification of the AI gateway. […] I would be able to change the AI gateway
> drop-down to LiteLLM […], and then it will also change the drop-down for the
> models. […] It should also show in the UI for each answer what kind of agent
> was answering, what kind of AI gateway was used, what kind of model was
> selected.

And, on the same day:

> We need to have the possibility to change it for each message.

That is three requirements, and the third is the one that shapes the design:

1. a **gateway** control beside the model, with the model list following the
   gateway;
2. the default is the SDK's own official API and the locally installed
   subscription; and
3. **every message chooses again**, and every answer says what answered it.

The reviewer's gateways are the two in
[`~/Projects/Github/lukaskellerstein/ai-gateway`](../../../../ai-gateway):
LiteLLM on port 24000, and Envoy AI Gateway in standalone mode on port 26000.
Both front the same local engines under one alias vocabulary — `unsloth-26b`,
`lms-4b`, `ollama-26b` and the rest — and both can front the cloud.

---

## 2. Vocabulary

### 2.1 What one send picks

```ts
/** What one send picks. All four are recorded on the message it produces. */
export interface SendChoices {
  sdk: AgentSdk;          // "claude-agent" in this spec; spec 44 makes it a choice
  gatewayId: string;
  model: string | null;
  style: string | null;
}
```

`AgentSdk` is spec 42 §5.1's type. `model` and `style` stay nullable.
`threadNote` records a message no agent ever saw, and a null there is the honest
record of that (§5.4).

### 2.2 A gateway is a named set of routes, not one URL

The base URL is a function of the gateway *and* the SDK, because each SDK
speaks a different protocol and a gateway exposes each protocol at a different
path — spec 42 §5.2 defines the shape, §3 below is the measurement. Stored as
two tables, because `routes` is a map and SQLite is not a document store:

```sql
CREATE TABLE agent_gateway (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL
                CHECK (kind IN ('original','litellm','envoy','custom')),
  created_at  TEXT NOT NULL
);

CREATE TABLE gateway_route (
  gateway_id      TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
  sdk             TEXT NOT NULL
                    CHECK (sdk IN ('claude-agent','codex','opencode','deep-agents')),
  base_url        TEXT,
  auth            TEXT NOT NULL
                    CHECK (auth IN ('inherit','none','environment')),
  credential_env  TEXT,
  models          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (gateway_id, sdk),
  CHECK (
    (auth = 'environment' AND credential_env IS NOT NULL) OR
    (auth <> 'environment' AND credential_env IS NULL)
  ),
  -- §4.5 — "No authentication" needs an explicit URL. In the table, not only in
  -- the validator: a row that cannot run must not be creatable by any route,
  -- and `sqlite3 ~/.rex/rex.db` is a route.
  CHECK (auth <> 'none' OR base_url IS NOT NULL)
);
```

`models` is a newline-separated list, not JSON. It is displayed as typed and
never queried by element, and a text column keeps
`sqlite3 ~/.rex/rex.db "select * from gateway_route"` readable — which is how
every gateway problem in §15 was actually diagnosed.

The `sdk` check names all four SDKs now, so specs 44 to 46 add rows and no
migration. In this spec only `claude-agent` rows are ever written.

### 2.3 Gateway kinds are a catalogue, and the catalogue is the library's

The reviewer picks a **kind** and types **one host**. The library fills the
routes — spec 42 §10's `build_routes()`, from `catalogue.py`. This spec adds
three kinds to the one spec 42 shipped:

| Kind | Claude Agent | Codex | OpenCode | Deep Agents |
|:--|:--|:--|:--|:--|
| `original` | *(no URL)* | *(no URL)* | *(no URL)* | *(no URL)* |
| `litellm` | `{host}` | `{host}/v1` | `{host}/v1` | `{host}/v1` |
| `envoy` | `{host}/anthropic` | `{host}/v1` | `{host}/v1` | `{host}/v1` |
| `custom` | typed by hand | typed by hand | typed by hand | typed by hand |

**Only the Claude column is this spec's.** It is measured for LiteLLM (§15) and
read from source for Envoy (§15.2), whose row ships with
`KindDescriptor.unverified` set until milestone 3 clears it. The other three
columns are what specs 44 to 46 will prove; they are in the table so the
catalogue's shape is visible, and each of those specs owns its column.

**This catalogue is code, not data.** It is hard-won knowledge about other
people's products, learned by measurement and shipped so no reviewer has to
learn it twice. Adding a kind is a pull request against `catalogue.py`, which
is correct: a new entry is a claim about another product's URL layout, and that
claim needs the same evidence §15 carries. It never touches REX — spec 42 §10.

`custom` is the escape hatch and takes a URL per SDK, so a gateway REX has never
heard of never needs a code change to be usable.

### 2.4 REX cannot ask a gateway for its routes

The obvious alternative is discovery — read the server's OpenAPI document and
work the routes out. It does not settle the question. An OpenAPI document lists
paths; it does not say that `/v1/messages` is the Anthropic Messages route the
Claude SDK needs while `/v1/chat/completions` is not. That mapping is a
judgement, and §15 is what it cost to make. And a gateway may publish nothing:
MLflow, measured before it was dropped, answered `404` at `/openapi.json` and
declared only `POST` routes.

So discovery has one honest use, and it is **verification, not guessing**: when
a server does publish something — LiteLLM's FastAPI `/openapi.json`, Envoy's
`/v1/models` under each prefix — the gateway sheet may check that the paths the
kind expects exist, and say so. A server with no document is never penalised
for it, and a check never rewrites a route. This spec adds one message to spec
42 §4.2's table for it — `verify { id, route }`, answered with what the server
published and whether the expected path is in it — and §4.5 is the button.

### 2.5 The `Original` gateway

`Original` is the `original`-kind row, and it is the default. It has a route for
every SDK and **no `baseUrl` on any of them**: each SDK uses its own official
endpoint and the credential the reviewer already has installed — `claude login`
today; the OpenAI subscription and `opencode auth login` in specs 44 and 45.
`auth` is `inherit`, and REX changes nothing about how that SDK authenticates.

`Original` cannot be edited or deleted. It is what REX does today, and it must
stay reachable in one click from any state the settings screen can get into.
It is the same thing as spec 42 §5.4's `ORIGINAL_GATEWAY` constant, given a row
so that `thread_session` and `gateway_route` have something to reference.

### 2.6 Four rules

1. **Every send picks an SDK, a gateway and a model.** None of the three is a
   property of the thread.
2. **A message carries its own evidence** — the SDK, the gateway's name, the
   base URL, the model and the style, copied onto the row. Editing or deleting a
   gateway later cannot change what an old answer says (§5.3).
3. **A session belongs to one (thread, SDK, gateway) triple**, and REX keeps as
   many as a thread needs (§5).
4. **No credential value enters SQLite, IPC, a message, the log, or a debug
   report.**

---

## 3. One gateway, one route per SDK

The Claude column, on this machine:

| Gateway | Claude Agent | Standard |
|:--|:--|:--|
| Original | SDK default | today's behaviour |
| LiteLLM | `http://localhost:24000` — **no `/v1`** | **measured** 2026-09-03, §15.1 |
| Envoy | `http://localhost:26000/anthropic` — **no `/v1`** | read from source, §15.2 — milestone 3 |

Two things in that table are traps, and each cost a live test to find:

- **The Claude route takes no `/v1`.** The SDK appends `/v1/messages` itself, so
  a base ending in `/v1` produces `/v1/v1/messages` and a 404 that explains
  nothing. LiteLLM's own README says exactly this, and Envoy's registered path is
  `{anthropic-prefix}/v1/messages` with the prefix defaulting to `/anthropic`.
- **The two gateways put the Anthropic route at different depths.** LiteLLM
  serves it at the root; Envoy under a prefix. That is why the kind fills the
  route and the reviewer types only a host.

### 3.1 URL validation

Spec 42 §5.3's `validate_base_url()`, and its TypeScript twin in `bridge.ts`
(spec 42 §10), which is the one the sheet calls: an absolute `http:` or
`https:` URL,
trimmed, one trailing slash removed, **no path appended**. Guessing `/v1` is
what makes a correct URL wrong.

The URL may carry a path. It must not carry a username, password, query, or
fragment. Plain HTTP is allowed, because loopback gateways use it; the form
warns, and does not block, when an HTTP host is not loopback.

There is no placeholder. A route is a plain string.

---

## 4. The controls

The composer's control row becomes:

```text
[ Original ▾ ]  [ Fable 5.1 ▾ ]  [ Style: default ▾ ]     ASK  ACT
    gateway          model            Claude only
```

The gateway control sits to the **left** of spec 25's model picker, on the
selection panel and on every comment card — including a card that has already
been answered, because §5 is what makes changing it mid-conversation safe. Spec
44 adds the agent control to the left of the gateway, and the row reads
agent · gateway · model from then on.

### 4.0 What a control starts on

Three settings, and one rule that resolves them:

| Setting | Holds | Written by |
|:--|:--|:--|
| `setting.agent.sdk` | the SDK a new comment starts on | spec 44; absent, `claude-agent` |
| `setting.agent.gateway` | the gateway id a new comment starts on | this spec |
| `setting.agent.model` | the model a new comment starts on | this spec |

A **new** comment reads the three settings. Absent, they are `claude-agent`,
`rex-original`, and spec 25's `defaultModel()`.

A comment that has already been sent starts on **what it last used** — the SDK,
gateway, model and style of its newest non-NOTE message (§5.3). Spec 31 §4.1
already does this for style, and the reason generalises: a reply usually
continues the conversation it is in, and re-picking controls on every reply is
a tax on the common case.

Changing a control **does not** write the settings. `Manage gateways…` has an
explicit *Use as default* action, so a one-off escalation to `Original` does not
silently become the default for every future comment.

A setting naming a gateway that no longer exists falls back to `rex-original`,
keeps the stored row, and says so once in the picker's tooltip — spec 25 §6.2's
rule, applied to one more field.

### 4.1 The cascade

Changing a control to the left re-evaluates everything to its right:

| Changed | Effect |
|:--|:--|
| **gateway** | the model list is rebuilt from that route |
| **model** | nothing else moves |

Spec 44 adds the row above these: changing the agent keeps only gateways with a
route for that SDK and rebuilds the model list.

When a rebuild drops the current value, REX picks that route's first model
rather than clearing the control. An empty model control that the reviewer has
to notice is worse than a filled one they can change.

### 4.2 Impossible combinations are shown, not hidden

A gateway with no route for the selected SDK stays in the list, greyed, with the
reason on hover: "Envoy has no Claude route. Add one in Manage gateways…".

In this spec every gateway has a Claude route, because the sheet fills one from
the kind. The rule is written now because spec 44 is where it first bites, and a
rule added at the same time as its first violation is a rule nobody tested.
Hiding it would make a missing configuration look like a missing feature.

### 4.3 The model list

| Gateway | Models offered |
|:--|:--|
| `Original` | today's initialization probe — the account's own list |
| any other | `GatewayRoute.models`, exactly as configured |

A route's model list is typed by the person who configured it, because a
gateway's catalogue is its own business — LiteLLM's aliases are one edit per
engine in `litellm/config/*.yaml`, and REX has no way to know a new one exists.
**A failed probe never removes a configured model** — this reverses spec 25
§3.1's first-party assumption, and only for non-`Original` routes.

### 4.4 Output style

Styles are a Claude Agent SDK feature. The control appears when the selected SDK
advertises `supportsStyles` (spec 42 §9.4) and is hidden otherwise. Main
**rejects** a non-null style sent to an adapter that does not advertise them; it
never accepts a choice and silently ignores it.

The style is per-send, exactly as spec 31 made it, and it is recorded on the
message beside the other three.

### 4.5 Managing gateways

`Manage gateways…` lists gateways. It is a generic form over spec 42 §10's
descriptor, which main fetches once over the pipe with `describe` and caches:
the kind dropdown is the reply's `kinds`, the fields under it are the kind's
`fields`, the preview is `buildRoutes()` and the errors are `validateGateway()`
— `bridge.ts`'s twins of the library's two pure functions, written over the
exported `catalogue.json` (spec 42 §10), so the form previews a route with no
round trip. REX contributes the styling, the
shadow root, the layout and where the row is saved. It contributes no knowledge
of any gateway.

```text
NAME     LiteLLM
KIND     LiteLLM                   ▾
HOST     http://localhost:24000

REX will use:
  Claude       {host}                  Anthropic Messages
  Codex        {host}/v1               OpenAI Responses        spec 44
  OpenCode     {host}/v1               OpenAI chat             spec 45
  Deep Agents  {host}/v1               OpenAI chat             spec 46

                        Cancel   Verify   Test   Save   Use as default
```

Rows for SDKs that have no adapter yet are shown greyed with the spec that will
fill them, so the reviewer sees the shape and cannot save a route nothing can
run.

Each filled row then expands to its own auth and model list, because both are
per route and not per gateway:

```text
Claude    http://localhost:24000
          AUTH    Environment variable   ▾    AI_GATEWAY_KEY   ✓ set
          MODELS  unsloth-26b
                  lms-4b
```

A `custom` kind shows the URL fields empty and editable. Any kind's rows can be
edited after they are filled — the catalogue is a starting point, not a lock.
The `envoy` kind carries two optional fields, `openaiPrefix` and
`anthropicPrefix`, because Envoy's prefixes are deployment configuration
(§15.2); the common case needs one host and the configured case needs no
`custom` kind.

**Verify** is §2.4's honest use of discovery: it sends the library a `verify`
message to fetch what the server publishes and report whether the expected
paths exist.
It never rewrites a route, and a server with no document reports "none
published", which is not a failure.

**Test** is an explicit, read-only one-turn run of one route through the real
adapter, with a warning that a remote model may charge.

`AUTH` has three values, and the second needs an explicit URL:

| Choice | Meaning |
|:--|:--|
| SDK / account default | give no gateway credential; the SDK uses its normal login |
| No authentication | a local endpoint; REX configures the SDK not to demand a login |
| Environment variable | a second field names the variable main passes to the SDK child |

The renderer may ask whether a named variable exists. Main answers true or false
and never sends the value.

---

## 5. Sessions, when the gateway can change mid-conversation

### 5.1 The problem, stated honestly

Spec 01 §8 says "one thread, one agent, one session". Per-message choice breaks
the literal reading: a session created against LiteLLM's local Gemma means
nothing to `api.anthropic.com`, and a gateway that has never seen a conversation
cannot resume it.

An earlier draft solved this by forbidding the change. That was the wrong
trade — it protected an implementation detail at the cost of the feature.

### 5.2 The rule: one session per (thread, SDK, gateway)

**The conversation is REX's, and it lives in SQLite.** An SDK session is a cache
that one harness keeps of part of it.

```sql
CREATE TABLE thread_session (
  thread_id   TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  sdk         TEXT NOT NULL,
  gateway_id  TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
  -- The URL this session was actually created against. Case 2b.
  base_url    TEXT,
  session_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (thread_id, sdk, gateway_id)
);
```

On every send, main looks up `(thread, sdk, gateway)`:

1. **A row exists, its `base_url` still matches, and the adapter's
   `sessionExists` says yes** → resume. This is a normal reply and costs
   nothing extra.
2. **A row exists but cannot be used** → start a fresh session, seed it with the
   replay prompt, overwrite the row. Two ways to get here:
   - **2a** the adapter has lost the session — its cache was cleaned;
   - **2b** the gateway was edited and `base_url` no longer matches. Resuming
     would ask a *different server* to continue state it has never seen, which is
     the one failure §5.1 exists to prevent. This is why the URL is on the row and
     not merely on the gateway.
3. **No row** → start a fresh session, seed it with the replay prompt, insert the
   row.

Deleting a gateway cascades its sessions away. It does not touch a single
message, because §5.3's evidence is a copy.

Cases 2 and 3 are the same code path, and it is the one REX already has: spec 01
§8.5's `renderTranscript` and `replayPrompt`, built because the Claude CLI's
transcript cache gets cleaned. "This harness has never seen this conversation"
is the same problem with the same answer.

**Seeding is a decision, not a default.** The reviewer was asked on 2026-09-03
whether a newly chosen gateway should be given the conversation so far, or start
clean, and chose to give it the conversation. So a switch of gateway never loses
the thread: the second model reads what the first one said and answers in the
same discussion.

> [!warning]
> **The first send to a new combination replays the whole thread**, and that is
> the price of the decision above. On a local model measured at ~100 tok/s
> prompt processing (§15), it is minutes, and it is paid again for each new
> combination a thread uses. The composer says so before the first such send:
> "LiteLLM has not seen this comment yet. It will be given the conversation so
> far." One sentence, once per combination.

Two consequences follow, and both are cheap:

- **The replay is built from REX's rows, not from another SDK's transcript.**
  `renderTranscript` already drops `thinking`, `tool_result` and `completed` as
  replay noise, so nothing SDK-specific crosses between harnesses.
- **Spec 34 §6.2's events come with it.** A replayed conversation that omits the
  reviewer's approve, discard or undo would have the new model reading "I
  changed X" about a document that no longer holds X.

### 5.3 The message carries its own evidence

```sql
ALTER TABLE message ADD COLUMN sdk TEXT;
ALTER TABLE message ADD COLUMN gateway_name TEXT;
ALTER TABLE message ADD COLUMN base_url TEXT;
```

`message.model` and `message.style` already exist (specs 25 and 31). With these
three, a row records the whole answer: which agent, through which gateway, at
which URL, on which model, in which style.

**These are copies, not foreign keys**, and that is the point. The reviewer's
requirement, 2026-09-03:

> Each response will have evidence what model, what gateway produced that
> answer. If I change the config of gateways, it does not affect that historical
> evidence.

A `gateway_id` reference would not satisfy it. Re-point a gateway at another host
and every answer it ever produced would start claiming the new URL — the record
would be rewritten by an edit nobody thought of as editing history. Copying four
short strings onto the row makes that impossible by construction.

So this spec has **no gateway revisioning and no retirement**. A gateway row is
ordinary configuration: edit it, delete it, rename it. History does not move,
because history does not point at it.

`base_url` is stored **sanitised** — it is what the run actually addressed.
`Original` stores null, which is the honest record of "the SDK's own endpoint".

> [!note]
> **The cost is denormalisation, and it is the right trade here.** The same
> gateway name repeats on thousands of message rows. That is a few hundred
> kilobytes across a large database, and it buys a record that no later edit can
> corrupt. REX already made this trade for `message.model` in spec 25.

### 5.4 What NOTE does

NOTE runs nothing, so it starts no session and touches no row in
`thread_session`. Its message stores a null SDK, gateway, model and style.

### 5.5 Who writes the session back

**Only the ASK and reply path writes `thread_session`.** `apply.ts`,
`docx/run.ts` and `pptx/run.ts` use a run-scoped id on purpose —
`apply.ts:831` says why: two turns sharing a session id would resume the first
one's transcript in the second one's working directory. Those callers discard
`AgentRunResult.sessionId`.

They still read the three choices, because an ACT run must use the gateway the
reviewer picked for it. They simply do not persist its session.

---

## 6. The child environment

This is what the Claude adapter (spec 42 §9) does with a route that has a URL.
The code lives in `agent-gateway/src/agent_gateway/adapters/claude/adapter.py`,
because it is knowledge about how the Claude SDK is pointed somewhere; the rules
live here, because this is the spec that first needs them.

### 6.1 Secrets are references

An `environment` route stores `AI_GATEWAY_KEY`, not its value. Main resolves it
immediately before it sends the run — spec 42 §5.3's `resolveRoute()` in
`bridge.ts`, handed `process.env`. A missing or empty variable is a
configuration error shown **before** anything is sent. The value then crosses
the pipe once, inside the `run` message, and nowhere else — spec 42 §4.4.

This spec puts no API key in SQLite and adds no keychain. A future keychain
satisfies the same adapter contract with no schema change.

### 6.2 Every run gets its own environment

No adapter touches `process.env`. Two comments can run at once on two different
gateways, so a process-global assignment would route one of them
nondeterministically. The reviewer's own course samples set
`process.env.ANTHROPIC_BASE_URL` before calling the SDK
(`vibe-coding-course/05_Claude_Agent_SDK/typescript/src/1_single_agent/1b_local_model.ts:20`),
which is fine for a script with one run and wrong for an app with five.

The TypeScript SDK had a sharp edge here: a supplied `env` **replaced** the
child environment. The Python SDK documents `ClaudeAgentOptions.env` as "merged
on top of the inherited process environment" (spec 42 §15.2), so the adapter
passes only the routing and credential keys and `PATH`, `HOME` and proxy
settings survive on their own. A merge cannot unset a variable, which is why
§6.3 sets the conflicting flags to an empty string rather than deleting them.
§16 records the canary test that proves the merge at the pinned version.

Logs and debug reports may carry the gateway name, the SDK and the sanitised base
URL. They never carry a credential value or arbitrary request headers.

### 6.3 What the Claude adapter sets

For the `Original` gateway with `auth: inherit`, REX changes nothing at all —
today's behaviour exactly, on the reviewer's own subscription, with no `env`
option passed.

For any route with a base URL, the adapter passes an `env` that is merged onto
the service's own environment (§6.2):

```python
env = {
    "ANTHROPIC_BASE_URL": route.base_url,
    "CLAUDE_AGENT_SDK_CLIENT_APP": f"rex/{version}",
    # §15 — a non-Anthropic backend does not implement the beta headers the SDK
    # sends by default, and the failure is a 400 from inside a paid turn.
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
    # §7 — a local model's first token can be minutes away. The gateway's own
    # recipe sets this; the SDK's default would kill the turn first.
    "API_TIMEOUT_MS": "3600000",
    # A merge cannot unset. An inherited Bedrock, Vertex or Foundry flag would
    # re-route the run, so each is set to "" — milestone 0 checks that the CLI
    # reads an empty value as off.
    "CLAUDE_CODE_USE_BEDROCK": "", "CLAUDE_CODE_USE_VERTEX": "", "CLAUDE_CODE_USE_FOUNDRY": "",
}
if route.auth == "environment":
    env |= {"ANTHROPIC_AUTH_TOKEN": route.token, "ANTHROPIC_API_KEY": route.token}
if route.auth == "none":
    env |= {"ANTHROPIC_AUTH_TOKEN": "rex-local", "ANTHROPIC_API_KEY": "rex-local"}
options = ClaudeAgentOptions(env=env, ...)
```

Two details are the gateway's own documented recipe
(`ai-gateway/litellm/README.md:86-108`), not assumptions:

- **Both credential variables get the same value.** `ANTHROPIC_AUTH_TOKEN`
  becomes `Authorization: Bearer` and `ANTHROPIC_API_KEY` becomes `x-api-key`,
  and which one is read **has moved between versions**. An empty string is not
  the same as an unset variable to every client, so neither is ever set to `""`.
- **`No authentication` uses a non-secret sentinel** rather than an empty value,
  because the bundled Claude Code client expects an authentication value even
  when the server ignores it. Envoy checks no caller key at all, so this is the
  auth its route will normally use.

### 6.4 The three model slots

A gateway has never heard of `claude-opus-5`. When Claude Code is pointed at one
and any of its three model slots is unset, it sends a real Claude model id and
the gateway answers `Invalid model name passed in model=claude-…`, which reads
like a broken proxy and is an unmapped slot.

REX sends its chosen model explicitly, so the main slot is covered. The
**background** slot is not: the SDK uses a small model for titles and summaries.
For any route with a base URL the adapter therefore sets all three of
`ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` and
`ANTHROPIC_DEFAULT_HAIKU_MODEL` to the chosen model.

Setting them to one id is deliberate. Leaving the small slot inherited would turn
one local-model choice into an unnoticed cloud request, which §10.2 forbids.

---

## 7. Timeouts

A local model is not slow the way a slow cloud model is slow. Measured on this
machine's gateway (§15): prompt processing runs at about 100 tokens per second,
and the SDK re-sends its system prompt and every tool schema each turn. **A real
agent turn needs 5 to 15 minutes before the first token**, and §5.2's replay adds
a whole transcript to the first send on a new combination.

Three consequences:

1. **The capability probe's 10-second timeout** (spec 42 §9.4) is a CLI
   handshake and not a model call, so it stays. §8 makes probes per route, so a
   slow gateway cannot block the picker for `Original`.
2. **`runAgent` gains no timeout.** Stop is spec 17's job and the reviewer's
   decision. A REX-invented deadline would kill a turn the gateway was serving;
   `API_TIMEOUT_MS` in §6.3 is the SDK's own deadline moved out of the way.
3. **The card shows elapsed time** from the moment a run starts on any route with
   a base URL. A card that shows nothing for twelve minutes is indistinguishable
   from a hung app.

---

## 8. Capabilities per route

Spec 42 §9.4's cache in `bridge.ts` is keyed by `(sdk, gatewayId)`: each probe
is lazy, each has its own failure state, and a probe on a custom route can be
slow. `RouteCapabilities` is spec 42's shape, unchanged.

There is no unconditional request to `/models`. It is not a common discovery
contract, it can need different authentication, and a model in a catalogue is not
proof it supports the streaming and tool semantics an agent needs.

A failed probe never removes a configured model (§4.3).

### 8.1 What the flags do on screen

They are declared in spec 42 and consumed by the UI, so their behaviour belongs
here rather than in specs 44 to 46 that first set them false:

| Flag | False means |
|:--|:--|
| `supportsAsk` | the whole combination is greyed, as §4.2 greys a missing route |
| `supportsAct` | **ACT is disabled and ASK is not.** The button is greyed with the reason on hover; the comment can still be asked |
| `supportsStyles` | the style control is hidden, and a non-null style is rejected (§4.4) |
| `supportsPlugins` | REX passes no plugin paths, and the LSP and design plugins are simply absent |
| `supportsCost` | a missing cost is drawn as unknown, never as `$0.00` |
| `supportsResume` | every send takes §5.2 case 2 — a fresh session and a replay, each time |

`supportsAct` false is the interesting one, and it is not hypothetical: specs
44 and 45 both hold ACT behind a per-platform write-boundary proof, and a
platform that fails it must still offer ASK. **A disabled ACT button is never
silently a read-only run** — REX refuses, and says which combination cannot
write.

For the Claude adapter every flag is true, so nothing on screen changes in this
spec.

---

## 9. Errors and the debug record

Every adapter keeps the SDK's original error and may put one REX sentence in
front of it. That rule is spec 25's, learned the hard way, and spec 42 §9.2
carries it into the library.

New hints, in `adapters/claude/errors.py`:

- **404 at the Messages path**: "This Claude route needs an Anthropic
  Messages-compatible endpoint. The SDK appends `/v1/messages` itself, so a base
  ending in `/v1` produces `/v1/v1/messages`."
- **`Invalid model name passed in model=claude-…`**: "The gateway was sent a
  first-party model id. This is REX's bug, not the gateway's — report it."
- **missing credential variable**: named before anything spawns.
- **connection refused**: the gateway name and the sanitised host, and for a
  gateway from `ai-gateway`, the compose folder to start.

The per-thread debug report adds a line per combination the thread has used:

```text
agent    : Claude Agent SDK
gateway  : LiteLLM
api base : http://localhost:24000
model    : unsloth-26b
session  : 019c…
```

It never prints auth headers, credential values, or the child environment. The
app-wide report lists gateways by name and route, and says **whether** each named
credential exists — never its value.

---

## 10. Safety

### 10.1 ASK and ACT are unchanged

The Claude adapter keeps REX's policy exactly as it is. ASK cannot write. ACT
writes working copies and never the reviewed originals before approval. Nothing
here touches spec 12 §6 or spec 22 §3.

Changing gateway mid-thread does not change that: the working-copy accounting
is REX's own, and every adapter reports the paths it wrote through the same
`wrote` event.

The DOCX and PPTX plan runs keep the read profile. Their deterministic editors
are REX code and do not change with the gateway.

### 10.2 No silent downgrade

If a route cannot call tools, stream, or resume, REX reports that. **It never
retries against `Original`.** A local choice must never become a cloud request
because it failed — that is a privacy failure, not a convenience.

---

## 11. IPC and shared types

The renderer receives gateway rows, their routes, and credential
**availability**. It never receives environment contents.

```ts
interface GatewayRouteDraft {
  baseUrl: string | null;
  auth: AgentAuth;
  credentialEnv: string | null;
  models: string[];
}

interface AgentGatewayDraft {
  name: string;
  kind: GatewayKind;
  routes: Partial<Record<AgentSdk, GatewayRouteDraft>>;
}
```

| Channel | Purpose |
|:--|:--|
| `gateway:describe` | spec 42 §10's `list_sdks()` and `list_kinds()`, fetched once over the pipe and cached in main, so the renderer can offer kinds and preview the routes a host will fill |
| `gateway:list` | gateways, their routes, and capability summaries per SDK |
| `gateway:save` | validate and write one gateway and its routes |
| `gateway:delete` | remove it; history is unaffected (§5.3) |
| `gateway:verify` | §2.4 — what the server publishes, checked against the kind. Writes nothing |
| `gateway:test` | an explicit, read-only one-turn test of one route; warns that a remote model may charge |
| `gateway:default` | set the `setting.agent.*` values from §4.0 |
| `gateway:has-env` | whether a named variable is set — true or false, never the value |

There is no `gateway:retire`. Nothing needs retiring, because §5.3 made history
independent of these rows.

`thread:ask`, `thread:reply` and `thread:apply` carry `SendChoices` (§2.1). Spec
25's positional `threadAsk(threadId, model, style)` becomes a request object: a
fifth positional argument is the shape that proves the old convenience has run
out.

Main re-reads the gateway row and resolves credentials itself. IPC data is never
used as executable SDK configuration without a database lookup and validation.

`bridge.ts`'s `runAgent` (spec 42 §11) gains one input, `route: ResolvedRoute`,
and every caller passes the one it resolved from the reviewer's choice.

---

## 12. Migration

```sql
INSERT INTO agent_gateway (id, name, kind, created_at)
  VALUES ('rex-original', 'Original', 'original', :now);

INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
  VALUES ('rex-original', 'claude-agent', NULL, 'inherit', NULL, ''),
         ('rex-original', 'codex',        NULL, 'inherit', NULL, ''),
         ('rex-original', 'opencode',     NULL, 'inherit', NULL, ''),
         ('rex-original', 'deep-agents',  NULL, 'inherit', NULL, '');
```

Then:

- every existing `thread.session_id` becomes one `thread_session` row keyed
  `(thread_id, 'claude-agent', 'rex-original')`, with a null `base_url`;
- `thread.session_id` is retired in place, not dropped;
- every existing `message` gets `sdk = 'claude-agent'`,
  `gateway_name = 'Original'` and a null `base_url`;
- `message.model` and `message.style` are untouched;
- `setting.model.default` keeps its **raw** stored value as the default model for
  `Original` + Claude. `defaultModel()` (`src/main/db/settings.ts:45`)
  deliberately keeps a stored model that is missing from today's list and returns
  `default` for the send, so that the choice comes back when the model does. A
  migration seeding from the resolved value would destroy the choice spec 25 §6.2
  promised to keep.

`PRAGMA foreign_keys` is ON (`src/main/db/database.ts:89`), so `agent_gateway` is
created and its `Original` row inserted **before** `gateway_route`,
`thread_session`, and the `message` columns.

Every migration step is idempotent and additive, the way `migrate.ts`'s existing
steps are: a database made after this spec sees a no-op, and a database made
before it is filled in once.

With only `Original` configured, REX behaves exactly as it did before this spec.
The migration has tests asserting that property.

The two gateway rows §15.3 describes — LiteLLM and Envoy — are **not** created by
the migration. They are this machine's configuration, not REX's defaults, and
milestone 2 adds them through the UI as its own acceptance test.

---

## 13. Acceptance criteria

1. The composer shows gateway and model, plus style for Claude, and each can be
   changed before any send.
2. Changing the gateway rebuilds the model list; a dropped value falls back to
   the route's first model.
3. `Original` is the default, cannot be edited or deleted, and runs on the
   reviewer's installed subscription with no REX-supplied credential and no
   `env` option.
4. Picking the `LiteLLM` kind and typing one host fills the Claude route from the
   library's catalogue, previews the other three as greyed, and the filled one
   is then editable.
5. A new comment starts on the `setting.agent.*` values; a sent comment starts
   on what it last used; changing a control does not change the settings.
6. One comment can be asked of a local model through LiteLLM and then continued
   against `Original`, and both answers are correct and complete.
7. Each combination a thread uses keeps its own session; resuming one does not
   disturb another.
8. The first send to a new combination is seeded with the conversation so far,
   and the composer says so before it happens.
9. **Editing a gateway's host, renaming it, or deleting it changes no existing
   message.** Every old answer still names the agent, gateway, URL, model and
   style that produced it.
10. Editing a gateway's URL makes the next send on it start a fresh session
    rather than resuming against a different server (§5.2 case 2b).
11. Every answer's foot names the agent, the gateway, the model and — for Claude —
    the style.
12. Two comments running at once on two gateways cannot exchange URLs, models,
    credentials or session ids; `process.env` is never mutated.
13. No secret value appears in `rex.db`, `rex.log`, an IPC payload, a message, or
    a debug report — `ResolvedRoute.token` crosses the pipe once, going down,
    and appears nowhere else (spec 42 §4.4).
14. NOTE starts no SDK, creates no session, and stores null for every choice.
15. ASK cannot write. ACT changes working copies and never the reviewed originals
    before approval — through every gateway.
16. An ACT, DOCX or PPTX run never overwrites a conversation's session.
17. With only `Original` configured, all pre-43 behaviour and tests are unchanged.
18. The `envoy` kind fills `{host}/anthropic`, shows its `unverified` note until
    milestone 3, and after milestone 3 either carries a measured route or a
    corrected one.

---

## 14. Deliberately out of scope

- Running, installing or supervising LiteLLM, Envoy, Ollama or another gateway.
  `ai-gateway`'s compose folders do that.
- MLflow AI Gateway. Dropped by the reviewer on 2026-09-04; §15.4 keeps the one
  lesson it taught.
- A `{model}` placeholder in a URL. No remaining gateway needs one.
- Translating between protocols. REX picks a route; it never bridges one.
- Guessing endpoint suffixes.
- Migrating a live SDK session from one harness to another. §5.2 replays the
  conversation instead, which is a different and honest thing.
- Arbitrary static headers, query parameters, mTLS, Bedrock, Vertex, Foundry or
  Azure credential flows.
- Storing raw API keys in REX.
- Falling back from a local route to `Original`.
- The agent control and any SDK but Claude (specs 44 to 46).

---

## 15. Evidence

The reviewer's gateways are the compose projects in
[`~/Projects/Github/lukaskellerstein/ai-gateway`](../../../../ai-gateway), one
folder each, started with `docker compose up -d` inside the folder and
`GATEWAY_ENGINE` picking the engine. `unsloth-26b` is
`unsloth/gemma-4-26B-A4B-it-qat-GGUF` on Unsloth Studio, port 8888.

### 15.1 LiteLLM — measured 2026-09-03

| Route | Result |
|:--|:--|
| `POST :24000/v1/messages` | **200 — a real Anthropic Messages reply**; LiteLLM translates to the OpenAI-shaped engine |
| `POST :24000/v1/chat/completions` | 200, streams |
| `POST :24000/v1/responses` | 200 |
| Engine `POST :8888/v1/messages` | **200** — Unsloth speaks Anthropic Messages itself |
| Engine `POST :8888/v1/chat/completions`, `stream: true` | works — SSE chunks with `delta.content` and `delta.reasoning_content` |
| `unsloth-26b`, tool call | **`finish_reason: "tool_calls"`**, one well-formed function call; incremental `tool_calls` deltas when streamed |

Every call needs `Authorization: Bearer <key>`; the master key defaults to
`sk-litellm-master` and the repository's tests read `AI_GATEWAY_KEY` first
(`litellm/tests/common.py:152`). The README's Claude Code recipe
(`litellm/README.md:98-108`) is §6.3 line for line — base URL with no `/v1`,
both key variables, the three slots, the betas flag, `API_TIMEOUT_MS`.

Three conclusions:

1. **LiteLLM serves a Claude Agent route at its root.** `ANTHROPIC_BASE_URL`
   is `http://localhost:24000`, the SDK appends `/v1/messages`, and LiteLLM
   translates to whatever the alias names.
2. **`unsloth-26b` is a real agent model, and it spends tokens thinking.** It
   emitted structured `tool_calls`, not the raw-text tool syntax that makes most
   local models useless. 89 completion tokens produced the single word `ready`,
   and the gateway's notes record an empty reply at `max_tokens: 60` with
   `finish_reason: length`. Leave a generous output budget.
3. **Unsloth serves one model at a time**, and that limit spans chat and
   embeddings. REX's five-agent cap becomes a serial queue against this engine,
   with a model swap measured at 14 s cold and 4.4 s warm.

### 15.2 Envoy AI Gateway — read from source, not measured

Two sources, and neither is a live call — which is why the row ships with
`KindDescriptor.unverified` set and why milestone 3 exists.

**The gateway's source**, `~/Projects/Github/envoyproxy/ai-gateway` at commit
`4b2e83d3`. Routes registered in `cmd/extproc/mainlib/main.go`:

| Registered path | Serves |
|:--|:--|
| `{openai}/v1/chat/completions` | OpenAI chat |
| `{openai}/v1/responses` | OpenAI Responses — Codex, spec 44 |
| `{openai}/v1/models` | model listing |
| `{anthropic}/v1/messages` | **Anthropic Messages — Claude** |
| `{anthropic}/v1/models` | model listing |
| `{anthropic}/v1/messages/count_tokens` | token counting |

The prefixes are **deployment configuration**, not constants
(`internal/internalapi/internalapi.go:275`), defaulting to `openai:/` and
`anthropic:/anthropic`. So the catalogue row uses the defaults, and a deployment
passing `--endpointPrefixes` edits its routes through §4.5's two prefix fields.

**The reviewer's deployment**, `ai-gateway/envoy/`: the `aigw run` standalone
mode in a container (`envoy/compose.yml:56-78`), listener `1975` published on
`26000`, every backend `schema.name: OpenAI` — the local engines and the two
hosted ones alike — and **no caller authentication** (`envoy/.env.example:9`).
Its README lists `/anthropic/v1/messages` as served
(`envoy/README.md:63`) and its test README lists it as **untested**
(`envoy/tests/README.md:207`). Routing is by model name: the gateway copies the
body's `model` into an `x-ai-eg-model` header and matches an `AIGatewayRoute`
rule on it; an unknown alias is a 404.

So the row is `http://localhost:26000/anthropic`, `auth: none`, and the SDK's
own `/v1/messages` lands on the registered path. That Envoy translates Anthropic
Messages onto an OpenAI-schema backend — including tool calls, streaming and the
`thinking` block — is the claim milestone 3 must measure.

Two things make Envoy worth the measurement:

- **It serves Anthropic Messages and OpenAI Responses natively**, so all four
  SDKs work against one host with no proxy tricks.
- **It has `/v1/models` under both prefixes**, so §2.4's verification has
  something real to ask.

### 15.3 The two gateway rows this machine wants

| Gateway | Kind | Host | Claude route | Auth | Models |
|:--|:--|:--|:--|:--|:--|
| LiteLLM | `litellm` | `http://localhost:24000` | `http://localhost:24000` | Environment variable · `AI_GATEWAY_KEY` | `unsloth-26b`, `lms-4b`, and whatever `GATEWAY_ENGINE` serves |
| Envoy | `envoy` | `http://localhost:26000` | `http://localhost:26000/anthropic` | No authentication | the same aliases, one `AIGatewayRoute` rule each |

**LiteLLM is the one to spike against.** Its Claude route is measured, its
recipe is written by the gateway's own author, and its spend logs are the reason
to have a gateway at all. Envoy is milestone 3.

### 15.4 What MLflow taught, kept in one paragraph

MLflow AI Gateway on port 25000 was measured on 2026-09-03 and dropped on
2026-09-04. It had three route families that were not equivalent — a unified
route that could not stream, a passthrough typed by provider, and a raw proxy
that pinned the model in the URL — and it published no OpenAPI document and
answered no `GET`. Two design decisions survive it: a gateway is a set of
routes and not one URL (§2.2), and discovery verifies and never guesses (§2.4).
The `{model}` placeholder in a URL does not survive it, because nothing else
needs one.

### 15.5 What is still unproven

The routes answer `curl`. What has not been driven is a real agent turn:

- one Claude Agent SDK `query()` against LiteLLM, carrying tool calls to
  completion; and
- whether `ANTHROPIC_AUTH_TOKEN` alone, `ANTHROPIC_API_KEY` alone, or both are
  read by the bundled SDK version.

Both are milestone 0. Envoy's Claude route in its entirety is milestone 3.

---

## 16. Evidence to add while building

Each milestone adds the command, fixture or live run that proved its claim. The
build must record:

- the `ClaudeAgentOptions.env` merge of the pinned Python SDK, proved with a
  canary variable, and whether an empty value switches the Bedrock, Vertex and
  Foundry flags off (§6.3);
- which of `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` the pinned version
  sends, and what an empty string does;
- whether `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` is needed against each
  gateway, and the exact 400 seen without it;
- whether a long ASK against a 128k-context local model needs
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` — the gateway's recipe sets `122880`, and
  REX does not, because the value belongs to the model and REX does not know
  it; the measurement decides whether it becomes a per-route field;
- the measured time to first token for one real ASK turn on each route, and the
  measured cost of one §5.2 replay;
- one full ASK turn's tool calls, proving the policy still denies a write; and
- for Envoy: one `curl` per registered Anthropic path, one streamed turn with a
  tool call, and the `x-ai-eg-model` match seen in its access log.

---

## 17. Milestones

### 0 — prove the Claude seam against LiteLLM

A throwaway, non-UI spike through spec 42's service — a `run` message with a
LiteLLM route — against `http://localhost:24000` with `AI_GATEWAY_KEY`.

1. ~~Find a local Anthropic Messages route and confirm it answers and
   streams.~~ **Done 2026-09-03 — §15.1.**
2. Run one `query()` with that `ANTHROPIC_BASE_URL`, the three model slots set,
   and a per-child `env`.
3. Prove the child environment is per-run: two concurrent queries against two
   different base URLs, each reaching its own.
4. Make one tool call land and one write attempt be denied by the policy.
5. Stop a run mid-turn and see one `stopped` event.

*Gate:* if the route cannot carry a real agent turn, this spec still ships — the
gateway control and the session model are worth having for `Original` alone —
but the gateway sheet says the local path is unproven.

### 1 — gateways, sessions and the record

Schema (`agent_gateway`, `gateway_route`, `thread_session`, the three `message`
columns), migration, queries, the `litellm`, `envoy` and `custom` kinds in the
library's catalogue, URL and auth validation, IPC, and the `Manage gateways…`
sheet rendered from the descriptor.

*Tests:* `test/gateways.spec.ts` — every §3.1 URL rejection, the two `CHECK`
constraints, each migration step run twice to prove it is idempotent; and in
the library, `test_catalogue.py` growing three kinds that each fill four routes
from one host.

*Done when:* `Original` behaves exactly as today, a LiteLLM gateway can be added
from a kind and a host, a thread keeps one session per combination, editing a
gateway's URL forces a fresh session, deleting a gateway changes no message,
and no secret reaches the renderer or the database.

### 2 — the controls

The gateway control, the §4.0 defaults, the cascade (§4.1), greying (§4.2), the
per-route model lists, the replay notice (§5.2), the §8.1 flags, the elapsed
time (§7) and the answer foot (§9). Add the LiteLLM row through the UI as the
acceptance test for §15.3.

*Tests:* `test/choices.spec.ts` — the cascade's fallback when a rebuild drops the
current model, a new comment against a deleted gateway falling back to
`rex-original`, and a message's evidence surviving a rename and a delete of the
gateway that produced it.

*Done when:* a comment can be asked of `unsloth-26b` through LiteLLM and
continued on `Original`, both answers are complete, each foot names its own
gateway, model and style, and every existing test is green.

### 3 — Envoy, measured

Start `ai-gateway/envoy` with `GATEWAY_ENGINE=unsloth`, run each row of §15.2's
table with `curl`, then drive one real ASK turn with a tool call through
`http://localhost:26000/anthropic`.

*Done when:* the `envoy` descriptor loses its `unverified` marker, or is
corrected by what the live calls actually return — and either way §15.2 records
the result.
