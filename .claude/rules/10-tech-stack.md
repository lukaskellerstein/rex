---
description: "Reference: Technology stack — Electron + React + TypeScript, SQLite, Claude Agent SDK"
---

# Reference: Technology Stack

<!-- Read from SPEC.md §3.2 and §12, not guessed. There is no package.json yet,
     so this file describes what the spec fixes; update it from the manifest the
     day one exists. -->

**Two languages, one boundary.** The app is TypeScript. The agent library is
Python — `agent-gateway/`, spec 42, built — and it runs as one child of the main
process that speaks JSON lines over stdin and stdout. `SPEC.md` §12's "bundled
Python runtime" row was retired by spec 42 §1.1 on 2026-09-04. The rows beside
it — no broker, no HTTP server, no listening port — stand, and the pipe is how
they are kept. Spec 42 §15.1 records why Vex's shape (NATS plus uvicorn) is
not the one being repeated.

## Main process

- **Runtime**: Electron
- **Data**: SQLite via `better-sqlite3`, at `~/.rex/rex.db` — outside every
  repository. Native module: needs `electron-rebuild` in the build.
- **Agents**: none directly. `src/main/agent/service.ts` spawns
  `agent-gateway/` and `bridge.ts` maps its events. `grep -rn
  "claude-agent-sdk" src/ package.json` finds nothing, and that is a rule, not
  an accident
- **Document rendering**: `markdown-it` (needs `token.map` for `data-src-line`),
  `dompurify` for HTML sanitising

## The agent library (Python, spec 42 — built)

- **Where**: `agent-gateway/` at the repo root, module `agent_gateway`,
  Python 3.12 pinned in `.python-version`. A sibling of `src/`, never inside it.
- **Tooling**: `uv` only — `uv sync`, `uv add`, `uv run pytest`. Never `pip`.
- **The contract**: Pydantic models in `protocol.py`, camelCase on the wire;
  `src/shared/agent-protocol.ts` is generated from them and never edited by
  hand — `test/protocol.spec.ts` fails when the two drift.
- **SDKs**: `claude-agent-sdk` 0.2.152 (spec 42), `openai-codex` (44), an own `httpx`
  client for OpenCode's server (45), `deepagents` with `langchain-openai` and
  `langchain-anthropic` (46). **Only `agent-gateway/` imports an agent SDK.**
- **The gate stays in TypeScript.** The library asks `gate.ts` over the pipe
  before every tool call (spec 42 §8); no answer within thirty seconds is a
  deny.
- **Lint and types**: `ruff.toml` and `pyrightconfig.json` inside the package
  are the markers `nvim-tools` gates `ruff` and `basedpyright` on.
- **What it must never contain**: an HTTP server, a NATS client, a socket
  listener, a database, or an import of anything in REX.

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
- any HTTP server framework, SSE, or listening port — in the app **or** in the
  agent library
- `nats.ws`
- a second client of the agent library, or any transport to it but the pipe
- JSON or JSONL as the store (SQLite; `rex export` is how files are produced)

## Scripting & Automation

- Default: TypeScript for scripts, consistent with the rest of the app
- Python only inside `agent-gateway/`
- Shell scripts only for trivial one-liners

## Conventions this machine imposes

- **One formatter per filetype.** Biome owns the JS/TS family; prettier and
  eslint are not installed on this machine.
- Tools run only where the repo carries their config file — see
  `rules/09-code-quality.md`.
