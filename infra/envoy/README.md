# infra/envoy — REX's own gateway, on port 26334

One gateway, one config, **both local engines**. LMStudio and Unsloth sit side
by side on one listener, so switching engine is naming a different model.

```bash
cd infra/envoy
podman compose up                               # or `up -d` to detach
curl -fsS http://localhost:26334/v1/models      # all 10 aliases
podman compose down                             # when you are done
```

`up` prints the URLs to call as soon as the gateway really answers:

```text
gateway-1  | Envoy AI Gateway listening on http://localhost:26334 … after 5.3s
banner-1   |
banner-1   |   ┌──────────────────────────────────────────────────────┐
banner-1   |   │  Envoy AI Gateway is ready                           │
banner-1   |   ├──────────────────────────────────────────────────────┤
banner-1   |   │  OpenAI      http://localhost:26334/v1               │
banner-1   |   │  Anthropic   http://localhost:26334/anthropic        │
banner-1   |   │  Models      http://localhost:26334/v1/models        │
banner-1   |   │  Metrics     http://localhost:26364/metrics          │
banner-1   |   ├──────────────────────────────────────────────────────┤
banner-1   |   │  lms-*       LMStudio        localhost:1234          │
banner-1   |   │  unsloth-*   Unsloth Studio  localhost:8888          │
banner-1   |   │  ...-anthropic  for an agent — no translation        │
banner-1   |   └──────────────────────────────────────────────────────┘
banner-1   |
banner-1 exited with code 0
```

**`banner` is a second container that prints that box and exits.** The gateway
image is distroless — no shell — so nothing can be added to what the aigw binary
itself says. `banner` is a 9 MB alpine that polls `/v1/models` and prints only
once the gateway really answers, so the box is proof the gateway is callable,
not merely started. `Exited (0)` in `compose ps` is that job done.

`podman compose` works too. Nothing here is part of the REX application — it is
a container on a port, and REX is an ordinary HTTP client of it. REX itself
still listens on nothing (invariant I3).

## Switching engine is naming a model

```bash
# LMStudio, on host port 1234
curl -sX POST http://localhost:26334/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"lms-4b","messages":[{"role":"user","content":"Say OK."}]}'

# Unsloth Studio, on host port 8888 — same port, same path, one word different
curl -sX POST http://localhost:26334/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"unsloth-4b","messages":[{"role":"user","content":"Say OK."}]}'
```

Nothing restarts and no variable is edited. `config/local.yaml` carries one
`AIGatewayRoute` rule per alias, and the alias picks the engine.

## Why a copy

`~/Projects/Github/lukaskellerstein/ai-gateway` is the real home of these
gateways, and it is **under heavy development**. Spec 43 needs a gateway that
does not change under it, so this folder is REX's own: a different port, a
different compose project name, and no file in it reads that repo.

Both can run at the same time, and on this machine both usually do.

| | The reviewer's copy | This copy |
|:--|:--|:--|
| Folder | `ai-gateway/envoy/` | `rex/infra/envoy/` |
| Compose project | `ai-gateway-envoy` | `rex-envoy` |
| Config files | five, one per engine | **one**, `config/local.yaml` |
| Engines live | one, picked by `GATEWAY_ENGINE` + a restart | **two, at once** |
| Data plane | 26000 | **26334** |
| Admin | 26064 | **26364** |

26334 keeps REX's `334` family (9334 is the debugger, 5334 is the Vite dev
server) inside the same 26xxx band as the original.

## The routes

| Port | Path | What |
|:--|:--|:--|
| 26334 | `/v1/models` | all 10 aliases, built from the `AIGatewayRoute` rules |
| 26334 | `/v1/chat/completions` | the OpenAI route |
| 26334 | `/v1/embeddings` | `lms-embed` and `unsloth-embed` |
| 26334 | `/anthropic/v1/messages` | the Anthropic Messages API |
| 26364 | `/health` | `OK`. See the race below |
| 26364 | `/metrics` | Prometheus |

Ten aliases, two engines, one listener:

| Alias | Engine | Model | Protocol upstream |
|:--|:--|:--|:--|
| `unsloth-4b` | Unsloth :8888 | `unsloth/gemma-4-E4B-it-qat-GGUF` | OpenAI |
| `unsloth-26b` | Unsloth :8888 | `unsloth/gemma-4-26B-A4B-it-qat-GGUF` | OpenAI |
| `unsloth-embed` | Unsloth :8888 | `second-state/Nomic-embed-text-v1.5-Embedding-GGUF` | OpenAI |
| `unsloth-4b-anthropic` | Unsloth :8888 | `unsloth/gemma-4-E4B-it-qat-GGUF` | **Anthropic, untranslated** |
| `unsloth-26b-anthropic` | Unsloth :8888 | `unsloth/gemma-4-26B-A4B-it-qat-GGUF` | **Anthropic, untranslated** |
| `lms-4b` | LMStudio :1234 | `google/gemma-4-e4b` | OpenAI |
| `lms-26b` | LMStudio :1234 | `google/gemma-4-26b-a4b-qat` | OpenAI |
| `lms-embed` | LMStudio :1234 | `text-embedding-nomic-embed-text-v1.5` | OpenAI |
| `lms-4b-anthropic` | LMStudio :1234 | `google/gemma-4-e4b` | **Anthropic, untranslated** |
| `lms-26b-anthropic` | LMStudio :1234 | `google/gemma-4-26b-a4b-qat` | **Anthropic, untranslated** |

**An unknown alias is a 404.** With both engines on one listener that now means
a typo, not another engine's name.

> [!important]
> **An agent must use an `-anthropic` alias.** The plain aliases reach a backend
> whose schema is `OpenAI`, so a call to `/anthropic/v1/messages` is translated
> on the way in — and that translation passes `thinking` blocks straight into an
> OpenAI body, where they are not a legal content part. A one-shot call works and
> a second turn fails with `400 messages.N.content.str: Input should be a valid
> string`. The `-anthropic` aliases reach a second backend whose schema is
> `Anthropic`, so the body goes upstream untouched. The long note on those rules
> in `config/local.yaml` has the measurements.

An Anthropic-shaped call — the one spec 43 cares about:

```bash
curl -sX POST http://localhost:26334/anthropic/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"lms-4b-anthropic","max_tokens":32,
       "messages":[{"role":"user","content":"Say OK."}]}'
```

The gateway needs no key from the caller. It sends `UNSLOTH_API_KEY` upstream
itself, and that arrives from the shell through `~/Projects/.envrc` — see
`.env.example`. LMStudio needs no key at all.

## Traps

- **Docker and podman are two daemons, and only one can hold 26334.** Starting
  this stack under one while the other still runs it fails with
  `listen tcp :26334: bind: address already in use`, and the second runtime is
  left holding a `Created` container that never started. Stop the other one
  first, and clear the half-made one:

  ```bash
  docker compose down    # or podman compose down, whichever holds the port
  podman compose down    # clears a container stuck in `Created`
  lsof -nP -iTCP:26334 -sTCP:LISTEN    # empty means the port is free
  ```

  Both runtimes work. Verified 2026-09-04: under podman the gateway came up in
  4 s, served all 10 aliases, and reached both engines on the macOS host through
  `host.docker.internal`.
- **`--build` does nothing here.** There is no `build:` section — the image is
  stock and pulled, never built. `docker compose up -d` is the whole command.
- **The admin port goes green before the data plane accepts a connection.**
  `26364/health` answers while Envoy's listener is still starting, so a call
  right after `up -d` gets a connection refused. Probe `26334/v1/models`
  instead. The wait is a few seconds — the service says so itself, and that is
  the line to trust: `docker compose logs gateway | grep listening` prints
  `Envoy AI Gateway listening on http://localhost:26334 … after 5.3s`. With
  `compose up` attached there is nothing to watch for — the `banner` box appears
  when the data plane answers, which is what it waits for.
- **`exiting on infrastructure runner error: Get "https://archive.tetratelabs.io/…"`
  in the log is harmless.** aigw looks up Envoy versions online at start; when
  that fetch fails it retries and comes up anyway. Measured 2026-09-04: the line
  appeared, the container went `healthy`, and every route answered. Judge by
  `compose ps` and `/v1/models`, not by that line.
- **LMStudio JIT-loads a model that is not resident**, and a JIT load comes back
  at 8192 context with a 1 h TTL, ignoring the numbers the model was configured
  with. Load them first, and trust `lms ps --json` over the LMStudio window:

  ```bash
  lms load google/gemma-4-e4b         --context-length 131072 --parallel 1 --gpu max
  lms load google/gemma-4-26b-a4b-qat --context-length 262144 --parallel 1 --gpu max
  lms load text-embedding-nomic-embed-text-v1.5
  ```

- **Unsloth holds one model at a time**, chat and embedder alike. `unsloth-embed`
  evicts `unsloth-26b` and the next chat call swaps it back — 14 s cold, 4.4 s
  warm. **Two gateways pointed at Unsloth at once will thrash it**, and the
  reviewer's copy on 26000 usually is. Check what is loaded before blaming a slow
  first call:
  `curl -sS localhost:8888/v1/models -H "Authorization: Bearer $UNSLOTH_API_KEY"`
  and read the `loaded` field. LMStudio holds several at once, so the `lms`
  aliases do not have this problem.
- **`Settings -> API -> Model auto-switch` must be on** in Unsloth Studio, or
  the first call to a model that is not resident returns `400 No model loaded`.
- **`docker compose logs gateway` shows startup lines only** unless
  `AIGW_DEBUG=true`. The image is distroless, so the access log goes to a file
  no shell can reach.

## Where this came from

`config/local.yaml` is a **merge**, made on **2026-09-04**, of two files in
`ai-gateway/envoy/config/`:

| Resource | Copies | From |
|:--|:--|:--|
| `GatewayClass`, `Gateway`, `EnvoyProxy`, `AIGatewayRoute`, `ClientTrafficPolicy` | one | both files agree; `unsloth.yaml` was the base |
| `Backend`, `AIServiceBackend` ×2, `Secret`, `BackendSecurityPolicy` | one set per engine | `unsloth.yaml` and `lms.yaml`, unchanged apart from being placed side by side |

`compose.yml` and `.env.example` come from `envoy/compose.yml` and
`envoy/.env.example`. What differs, beyond the merge:

| Change | Why |
|:--|:--|
| One hardcoded config, no `GATEWAY_ENGINE` | both engines are live at once, so there is nothing to switch |
| New port pair, new project name | so this and the reviewer's copy can run together |
| **Listener `26334`, not `1975`** | the same number inside and outside makes aigw's own startup line name a URL that works from the host |
| A `banner` service | the gateway image is distroless, so nothing else can print |

**Re-syncing is a read, not a diff**, because the merge reorders resources. When
that repo settles, compare resource by resource:

```bash
cd ~/Projects/Github/lukaskellerstein
diff <(grep -v '^#' ai-gateway/envoy/config/unsloth.yaml) \
     <(grep -v '^#' rex/infra/envoy/config/local.yaml)
```

The alias names, the `modelNameOverride` values, the `60m` timeouts and the
`50Mi` buffer are the parts worth checking. Splitting back into one file per
engine, if that is ever wanted, is a copy of the two originals plus a
`GATEWAY_ENGINE` line in `compose.yml`.

> [!note]
> **Spec 43 §15.3 names `http://localhost:26000`** for the Envoy row, because it
> was written against the reviewer's copy. A route pointed at this one uses
> `http://localhost:26334` and `http://localhost:26334/anthropic`. The spec is
> the authority on the catalogue; this is a local deployment of the same
> gateway, and §4.5 already treats the host as editable configuration.
