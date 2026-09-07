---
description: "Reference: Technology stack — Electron + React + TypeScript, SQLite, Claude Agent SDK"
---

# Reference: Technology Stack

<!-- Read from SPEC.md §3.2 and §12 and from the three manifests: package.json,
     agent-runner/pyproject.toml, local-gateway/pyproject.toml. -->

**Two languages, three boundaries.** The app is TypeScript. Two Python packages
sit beside it, both spawned by main, and **they never import each other**:

| Package | Spec | Transport | Why it is its own package |
|:--|:--|:--|:--|
| `agent-runner/` | 42 | a pipe — JSON lines on stdin and stdout, no port | every agent SDK lives here, and nothing else may |
| `local-gateway/` | 46 | one loopback port, `127.0.0.1:24334` | `litellm[proxy]` **is** an HTTP server, which `agent-runner/` may not hold |

`SPEC.md` §12's "bundled Python runtime" row was retired by spec 42 §1.1 on
2026-09-04, and its "no listening port" row was amended by spec 46 §2 on
2026-09-06: one loopback port carries inference, because every SDK reaches a
gateway by URL and none can address a pipe. The "no broker" and "no HTTP server
for REX's own IPC" rows stand. Spec 42 §15.1 records why Vex's shape (NATS plus
uvicorn) is not the one being repeated.

## Main process

- **Runtime**: Electron
- **Data**: SQLite via `better-sqlite3`, at `~/.rex/rex.db` — outside every
  repository. Native module: needs `electron-rebuild` in the build.
- **Agents**: none directly. `src/main/agent/service.ts` spawns
  `agent-runner/` and `bridge.ts` maps its events. `grep -rn
  "claude-agent-sdk" src/ package.json` finds nothing, and that is a rule, not
  an accident
- **Document rendering**: `markdown-it` (needs `token.map` for `data-src-line`),
  `dompurify` for HTML sanitising

## The agent library (Python, spec 42 — built)

- **Where**: `agent-runner/` at the repo root, module `agent_runner`,
  Python 3.12 pinned in `.python-version`. A sibling of `src/`, never inside it.
- **Tooling**: `uv` only — `uv sync`, `uv add`, `uv run pytest`. Never `pip`.
- **The contract**: Pydantic models in `protocol.py`, camelCase on the wire;
  `src/shared/agent-protocol.ts` is generated from them and never edited by
  hand — `test/protocol.spec.ts` fails when the two drift.
- **SDKs**: `claude-agent-sdk` 0.2.152 (spec 42), `openai-codex` (44), an own `httpx`
  client for OpenCode's server (47), `deepagents` with `langchain-openai` and
  `langchain-anthropic` (48). **Only `agent-runner/` imports an agent SDK.**
- **The gate stays in TypeScript.** The library asks `gate.ts` over the pipe
  before every tool call (spec 42 §8); no answer within thirty seconds is a
  deny.
- **Lint and types**: `ruff.toml` and `pyrightconfig.json` inside the package
  are the markers `nvim-tools` gates `ruff` and `basedpyright` on.
- **What it must never contain**: an HTTP server, a NATS client, a socket
  listener, a database, an import of anything in REX, or an import of
  `local_gateway`.

## The built-in gateway (Python, spec 46 — milestones 0 and 1 built)

- **Where**: `local-gateway/` at the repo root, module `local_gateway`,
  Python 3.12. A sibling of `agent-runner/`, never inside it or inside `src/`.
- **What it is**: LiteLLM, `litellm[proxy]` 1.100.0, serving inference on
  `127.0.0.1:24334`. One product for every gateway REX supports, so `builtin`
  and `litellm` are two kinds sharing every route template (spec 46 §3).
- **Three entry points**, all spawned by main, none of them a pipe protocol:
  `serve --port N --config <path>`, `discover --provider <id> [--url]`, and
  `write-config --out <path>` reading JSON on stdin.
- **One alias, four SDKs** (§4.5). LiteLLM answers `/v1/messages`,
  `/v1/chat/completions` and `/v1/responses` from the same `model_name`, so a
  model chosen in REX is one string every SDK can use. This is what makes spec
  45's open problem — "which listed name suits which SDK" — have no instances.
- **`config.yaml` is generated whole, every time**, and holds
  `os.environ/REX_PROVIDER_<ID>` and **never a value**.
- **What it must never contain**: a database, a NATS client, an import of
  anything in REX, or an import of `agent_runner`. It binds `127.0.0.1` and
  never any other interface — LiteLLM's own `--host` default is `0.0.0.0`, so
  the address is passed explicitly and `tests/test_serve.py` asserts it.

## Renderer

- **Framework**: React (`react`, `react-dom`)
- **Build tool**: `electron-vite`
- **Styling**: every pixel REX draws lives inside a **shadow root** (`SPEC.md`
  §7). This is not a style preference — without isolation the document's CSS
  styles REX's controls, and REX's CSS changes how the document looks, which is
  unacceptable in a review tool.
- **Highlighting**: the **CSS Custom Highlight API**, never `<mark>` or any
  wrapper element (`SPEC.md` §6.7). Wrapping mutates the document under review
  and shifts the offsets every other anchor depends on.
- **Anchor matching**: `diff-match-patch` for the fuzzy layer
- **Ids**: `uuid`, including `uuidv5` for deterministic session ids

## Do not add

`SPEC.md` §3.2 and §12 forbid these outright — each was considered and rejected:

- any NATS client or other message broker
- any HTTP server framework or SSE for REX's own IPC — in the app **or** in the
  agent library. The one exception is `local-gateway/`, which spec 46 §2
  amended I3 to allow, on loopback, for inference and nothing else
- `nats.ws`
- a second client of the agent library, or any transport to it but the pipe
- a database behind the gateway. LiteLLM runs with no `DATABASE_URL`; adding
  Postgres to get hot reload or the admin UI costs 155 MB and a migration on
  first boot, and spec 46 §17 declines it
- JSON or JSONL as the store (SQLite; `rex export` is how files are produced).
  The one JSONL that does exist is the gateway's traffic log under
  `~/.rex/gateway/traffic/`, which is a record and never the store

## Scripting & Automation

- Default: TypeScript for scripts, consistent with the rest of the app
- Python only inside `agent-runner/` and `local-gateway/`
- Shell scripts only for trivial one-liners

## Conventions this machine imposes

- **One formatter per filetype.** Biome owns the JS/TS family; prettier and
  eslint are not installed on this machine.
- Tools run only where the repo carries their config file — see
  `rules/09-code-quality.md`.
