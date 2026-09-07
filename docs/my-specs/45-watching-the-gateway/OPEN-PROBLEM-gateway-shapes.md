# OPEN PROBLEM — every gateway does the same job differently

**Status:** **unsolved.** This file states a problem and proposes nothing as
decided. §7 offers candidate answers; none is chosen.
**Written:** 2026-09-05, from a working session against both gateways running on
this machine. Every fact in §3 and §8 was measured, not read.
**Belongs to:** [`43-the-local-gateway/SPEC.md`](../43-the-local-gateway/SPEC.md)
— the gateway, the route, the model picker. It sits in spec 45's folder because
that is where the session that found it ended up; move it if 43 is a better home.
**Read first:** spec 43 §4 (the kinds and their fields), §5 (routes and models),
§11 (where a run's inference is served from); spec 42 §10 (the descriptor, and
why the host draws forms from data).

> [!important]
> **The task for whoever picks this up.** Do not start by writing code. Read §3,
> check §8 still reproduces, then argue with §5 and §6. The hard part of this
> problem is deciding what REX is allowed to know — the implementation after
> that is small.

---

## 1. The problem, in one paragraph

REX treats "a gateway" as one abstraction: a URL, an optional credential, and a
list of models per SDK. That abstraction is a lie in a specific and expensive
way. **Envoy AI Gateway and LiteLLM both do everything REX needs, and they do
almost none of it the same way.** Choosing the Anthropic protocol, listing the
models on offer, and declaring a token limit are three jobs where the two
products differ not in spelling but in *mechanism* — one uses a duplicated model
alias where the other uses a settings flag; one has a path prefix where the
other serves at the root; one declares limits per model in its config where the
other has no concept of a limit at all. REX must support both without encoding
either, and without demanding that the reviewer configure their gateway REX's
way.

## 2. Why this is hard rather than merely annoying

Three constraints pull against each other. Any proposed answer has to hold all
three at once, and each one on its own has an easy solution that breaks the
other two.

| # | Constraint | The easy answer that breaks the others |
|:--|:--|:--|
| C1 | **REX must not hardcode one deployment's conventions.** `-anthropic` is a suffix on this machine; the next person's gateway names things differently | "just strip `-anthropic`" — wrong the moment anyone else configures a gateway |
| C2 | **`agent-runner/` is meant to be reusable** by projects that are not REX (spec 42 §1) | "put the rules in REX" — the library is where gateways are known, so the knowledge would be in the wrong half |
| C3 | **The reviewer must not have to change their gateway to suit REX.** Their `ai-gateway` repo is under heavy development and is used by other projects | "require a REX-shaped config" — makes REX a fork of the gateway repo rather than a client of it |

C2 deserves emphasis. The temptation is to solve this in the app, where the
consequences are visible. But the app is not where a gateway is understood — the
library is — and a rule written in the app has to be rewritten by every other
consumer of the library.

## 3. The divergences, with evidence

Everything below was measured on 2026-09-05 against
`infra/envoy/` on port 26334 and the reviewer's LiteLLM on port 24000.

### 3.1 Choosing the Anthropic protocol

The Claude Agent SDK speaks the Anthropic Messages API. Every gateway must
therefore offer an Anthropic surface, and each one selects it differently.

| | Envoy AI Gateway | LiteLLM |
|:--|:--|:--|
| Where the Anthropic API lives | `/anthropic/v1/messages` — a **path prefix** | `/v1/messages` — **the root**, no prefix |
| How the untranslated backend is chosen | a **second model alias**, `lms-4b-anthropic` | a **settings flag**, `use_chat_completions_url_for_anthropic_messages` |
| Does the model name differ per protocol? | **yes** | **no** |

Measured:

```text
GET  http://localhost:26334/v1/models            200, 10 models
GET  http://localhost:26334/anthropic/v1/models  200, the same 10 models
GET  http://localhost:24000/v1/messages          405   (route exists, POST only)
```

**Envoy's duplication is forced, not stylistic.** `infra/envoy/config/local.yaml`
records why, and the reason is a property of the product: an `AIGatewayRoute`
rule matches on **headers alone** — `AIGatewayRouteRuleMatch` has no path field —
and the header it matches is the body's `model`. So the protocol can only be
chosen by the name the caller asks for. Without the second alias, a call to
`/anthropic/v1/messages` is translated Anthropic → OpenAI, which passes
`thinking` blocks into an OpenAI body where `content` may only be `text` or
`image_url`. A one-shot call survives that; an agent turn cannot, because turn
two sends the assistant's previous reply back. The engines answer
`400 messages.N.content.str: Input should be a valid string`, intermittently —
about one run in five, because the engines emit `reasoning_content` on some
replies and not others.

LiteLLM has the same problem and solves it in its own config, once, with the
flag above. Its model list is therefore not duplicated.

**The consequence for REX.** A model list discovered from `/v1/models` is
*correct and useless*: both Envoy prefixes return all ten names, so the list for
the Claude route contains `lms-4b`, which will fail on turn two, beside
`lms-4b-anthropic`, which will not. Nothing in the response distinguishes them.
REX cannot tell which name suits which SDK, and a heuristic that reads the
suffix would be this deployment's convention written into the product (C1).

### 3.2 Listing the models

Both products answer `GET {base_url}/v1/models` in the OpenAI shape. That is the
one thing they agree on, and it is already half-used: `verify.py:200` fetches
exactly this URL today and reads **only the status code**, discarding the body.

The divergences are around it:

| | Envoy | LiteLLM |
|:--|:--|:--|
| Needs a credential | **no** — it authenticates nobody | **yes** — `401` without a key |
| Lists per surface | no — every prefix returns all ten | n/a, one surface |
| Extra metadata | none | `/model/info` and `/v1/model/info` exist (both `401` unauthenticated) |

REX asks the reviewer to **type** the model names per SDK today
(`ManageGateways.tsx`, `models: Partial<Record<AgentSdk, string>>`, one per
line). The sheet's own comment explains why: the Claude adapter probes models by
asking the **CLI** (`get_server_info()`), and through a gateway the CLI reports
**Claude's own catalogue**, not the gateway's. So the existing probe cannot be
fixed to answer this; discovery has to come from the gateway's HTTP endpoint,
which is a second and separate source of truth.

### 3.3 Token limits

| | Envoy | LiteLLM |
|:--|:--|:--|
| Where a limit is declared | **nowhere** — no such concept | `model_info.max_input_tokens`, per model, in `config/*.yaml` |
| Who decides the limit at call time | the **caller**, per request | the caller, bounded by the config |
| Can REX discover it | no | probably — via `/model/info`, unverified |

REX currently carries no `max_tokens` on `RunRequest` at all; each adapter sets
its own. `infra/envoy/`'s Codex adapter hardcodes a `ROUTED_CONTEXT_WINDOW` of
122880 with a comment admitting it is "a floor rather than a truth".

**The trap here is symmetrical to §3.1.** If REX adds a required token-limit
field, every Envoy user must invent a number, and an invented limit is worse
than none — it silently truncates conversations that would have worked. If REX
adds no field, LiteLLM users cannot see a limit their gateway already knows.

### 3.4 Credentials

Included because it is the one divergence REX **already** handles well, and it
shows the shape of a working answer.

| | Envoy | LiteLLM |
|:--|:--|:--|
| Caller authentication | none | a key |

The kind descriptor solves this today: `litellm` declares a `tokenEnv` field and
`envoy` does not. The host renders whatever fields the descriptor lists and
branches on nothing. **§7 should be judged against how cleanly it matches this
precedent.**

## 4. What REX does today, and where it hurts

1. The reviewer types model names, per SDK, per gateway, by hand.
2. **Test** asks with the first typed name, or `null`. With `null` the CLI sends
   a real Claude id no local gateway has heard of, so the test fails for a reason
   that has nothing to do with the gateway being wrong.
3. **Verify** already works without a model — it only fetches `/v1/models`.
4. The chat's model dropdown is filled from what was typed, so a gateway that
   gained a model yesterday shows nothing new until someone retypes the list.

The reviewer's own words on 2026-09-05: *"I think we should not need a model name
from the user because the buttons Test and Verify can work even without
specifying the model."* That is true for Verify today and achievable for Test.

## 5. What a good answer must satisfy

Proposed acceptance criteria. Argue with these before arguing with §7.

| # | Criterion |
|:--|:--|
| A1 | Adding a gateway requires **no typed model name** for any kind that can list its models |
| A2 | **Test** works on a fresh gateway with nothing typed |
| A3 | No file under `src/` or `agent_runner/` contains the string `-anthropic`, or any other deployment's naming convention |
| A4 | Supporting a third gateway kind is **a descriptor entry, not a branch**. No `if kind == …` in a code path that renders, probes or routes |
| A5 | A gateway that lists nothing — `custom`, an offline host — still works, by asking the reviewer instead |
| A6 | Nothing REX stores requires the reviewer to change their `ai-gateway` repo |
| A7 | A wrong choice fails **loudly and early** — at Test, not on turn two of a real conversation |

A7 is worth dwelling on. The `-anthropic` failure is intermittent (one run in
five) and surfaces on the *second* turn. Any design that lets a reviewer pick
`lms-4b` for a Claude route must make that mistake visible before it costs a
conversation.

## 6. The framing I would argue from

Three kinds of knowledge are being mixed together, and most of the difficulty
comes from not separating them:

| Knowledge | Example | Whose is it | Where it belongs |
|:--|:--|:--|:--|
| What the **SDK** needs | Claude speaks Anthropic Messages | the SDK's | the adapter, in `agent-runner/` |
| What the **product** can do | Envoy has path prefixes; LiteLLM has one root and a key | the product's | the **kind descriptor** — which already exists |
| What **this deployment** chose | `-anthropic` suffix; `max_input_tokens: 122880` | the operator's | the stored gateway record, filled by **asking once** |

The third row is the one that feels like pollution and is not. It is
configuration, not code: it forces nothing on anyone else, because the next
person answers the same question differently. The candidate rule:

> **REX asks a gateway what it offers. It never infers what the gateway means.**

Discovery removes the *typing*. It cannot remove the *choice*, and a design that
tries to will violate C1 or A7.

---

## 7. Candidate solutions — none chosen

Suggestions only. They are listed so that the next reader has something to
disagree with, and they are deliberately not ranked as a decision.

### 7.1 Discover the names, ask which ones — the "pick, don't type" answer

Parse the body `verify.py` already fetches. Show every discovered name as a
picker in the gateway sheet, per SDK. The reviewer clicks the ones that route
belongs to, once. Store the result exactly where the typed list is stored today.

- **Meets** A1, A2, A5, A6. A3 holds because REX never reads the names, only
  offers them.
- **Weak on A7**: nothing stops a reviewer picking `lms-4b` for Claude. Pair it
  with a Test that actually sends **two** turns, so the `thinking`-block failure
  in §3.1 surfaces during configuration rather than during work.
- **Cost**: one function in `verify.py`, one field on `VerifyResult`, one
  picker. The smallest change that answers the reviewer's actual request.

### 7.2 Add capability flags to the kind descriptor

Extend the existing `kinds` data rather than the code:

```text
envoy    listsModels: "/v1/models"   reportsLimits: null
litellm  listsModels: "/v1/models"   reportsLimits: "/model/info"
custom   listsModels: null           reportsLimits: null
```

- **Meets** A4 directly, and it is the same mechanism that already solved
  credentials (§3.4).
- **Does not on its own solve** §3.1 — knowing that a kind lists models says
  nothing about which name suits which protocol.
- Best understood as a **prerequisite** for 7.1 and 7.3 rather than a rival.

### 7.3 Let the route declare its protocol, and let the gateway prove it

Give each route a `protocol` the adapter needs (`anthropic-messages`,
`openai-chat`, `openai-responses`) — SDK knowledge, row 1 of §6. Then have
**Test** establish which model names satisfy it, by trying and reporting, rather
than having REX reason about names.

- **Meets** A7 properly: the two-turn test is the oracle, and the answer is
  measured rather than assumed.
- **Cost**: a real turn per candidate model. Acceptable for local models, and
  **not** acceptable for a paid one — the `ai-gateway` repo's own discovery
  service already states this principle as *"MONEY IS NEVER DISCOVERED"*, and
  whatever is built here should inherit it.

### 7.4 Do nothing about token limits

Do not add a limit field. Let the SDK set `max_tokens` per request as it does
today; where a gateway advertises a limit, show it as **information** after
Verify; where it advertises nothing, show nothing.

- **Meets** the §3.3 trap on both sides — no invented numbers for Envoy users,
  no hidden knowledge for LiteLLM users.
- The weakest part of this suggestion is that it is untested: `/model/info`
  exists but its payload has not been read (§8).

### 7.5 Rejected outright, and why

| Idea | Why not |
|:--|:--|
| Strip or match the `-anthropic` suffix | Violates C1 and A3. It is this machine's convention, and Envoy's own docs mandate no naming at all |
| Require a REX-shaped gateway config | Violates C3 and A6. Makes REX a fork of `ai-gateway` rather than a client |
| Push the convention upstream to `envoyproxy/ai-gateway` and depend on it | Inverts the dependency. Worth an upstream issue on its own merits — the missing path matcher in `AIGatewayRouteRuleMatch` is a real gap — but REX must work before and after it lands |
| Infer the protocol from the URL path | Works for Envoy's `/anthropic` prefix, fails for LiteLLM's root. Two products, two answers, one guess |

---

## 8. Evidence — re-run before trusting any of the above

Both gateways must be up: `cd infra && ./up.sh -d`, and the reviewer's LiteLLM
on 24000.

```bash
# 3.1 — the same ten models on both Envoy surfaces
curl -s http://localhost:26334/v1/models           | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["data"]))'
curl -s http://localhost:26334/anthropic/v1/models | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["data"]))'

# 3.1 — LiteLLM serves the Anthropic API at the ROOT (405 = POST-only route)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:24000/v1/messages

# 3.2 — Envoy needs no key, LiteLLM does (401 = the route exists)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:26334/v1/models
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:24000/v1/models

# 3.3 — LiteLLM's per-model metadata endpoints exist
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:24000/model/info
```

Measured on 2026-09-05: `10`, `10`, `405`, `200`, `401`, `401`.

Files worth reading before proposing anything:

| File | Why |
|:--|:--|
| `infra/envoy/config/local.yaml` § The `-anthropic` aliases | The full reasoning, including the `AIGatewayRouteRuleMatch` limitation |
| `agent-runner/src/agent_runner/verify.py` | Already fetches `/v1/models`; discards the body |
| `agent-runner/src/agent_runner/adapters/claude/models.py` | Why the existing probe reports Claude's catalogue and not the gateway's |
| `src/renderer/overlay/ManageGateways.tsx` | The typed model list, and the comment explaining it |
| `~/Projects/Github/lukaskellerstein/ai-gateway/litellm/config/settings.yaml` | `use_chat_completions_url_for_anthropic_messages` — **read-only** |
| `~/Projects/Github/lukaskellerstein/ai-gateway/litellm/discover/gateway_discovery.py` | Prior art on discovery, and the "money is never discovered" rule — **read-only** |

## 9. What is deliberately not in scope

- **The observability stack.** Spec 45 is built and unaffected; this problem is
  about configuring a gateway, not watching one.
- **Choosing a third gateway product.** OpenRouter, Portkey and the rest change
  nothing about the shape of the problem, and adding one now would only widen
  the evidence base.
- **The `max_tokens` value itself.** §7.4 argues REX should not own it. If that
  is rejected, the value is a separate decision and not this document's.
