---
description: "Reference: Technology stack — Electron + React + TypeScript, SQLite, two Python packages"
---

# Reference: Technology Stack

<!-- Versions live in the manifests: package.json, agent-runner/pyproject.toml,
     local-gateway/pyproject.toml. The reasons live in the specs. -->

## The app — TypeScript

- **Runtime**: Electron, built with `electron-vite`
- **UI**: React, inside a shadow root (`SPEC.md` §7)
- **Highlighting**: the CSS Custom Highlight API — never `<mark>` or any wrapper
  element (`SPEC.md` §6.7)
- **Data**: SQLite via `better-sqlite3`, at `~/.rex/rex.db`
- **Agents**: none in the app. No file under `src/` imports an agent SDK

## The two Python packages

Python 3.12, `uv` only. They never import each other, and neither imports
anything from `src/`.

| Package | What it is | Spec |
|:--|:--|:--|
| `agent-runner/` | every agent SDK, spoken to over stdin/stdout. The only place an SDK may be imported. `protocol.py` generates `src/shared/agent-protocol.ts` | 42 |
| `local-gateway/` | REX's own LiteLLM, on `127.0.0.1` only | 46 |

## Do not add

Anything `SPEC.md` §12 forbids — among them a message broker, an HTTP server or
SSE for REX's own IPC, and JSON files as the store. What each Python package
must never contain: spec 42 §3.2 and spec 46 §10.

## Scripting & Automation

- Default: TypeScript for scripts, consistent with the rest of the app
- Python only inside `agent-runner/` and `local-gateway/`
- Shell scripts only for trivial one-liners

## Conventions this machine imposes

- **One formatter per filetype.** Biome owns the JS/TS family; prettier and
  eslint are not installed. Python formats with the ruff CLI chain.
- Tools run only where the repo carries their config file — see
  `rules/09-code-quality.md`.
