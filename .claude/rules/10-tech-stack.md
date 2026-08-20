---
description: "Reference: Technology stack — Electron + React + TypeScript, SQLite, Claude Agent SDK"
---

# Reference: Technology Stack

<!-- Read from SPEC.md §3.2 and §12, not guessed. There is no package.json yet,
     so this file describes what the spec fixes; update it from the manifest the
     day one exists. -->

**TypeScript only.** No Python runtime, no second language — `SPEC.md` §12 lists
a bundled Python runtime as an explicit non-goal, and §1.2 records the Vex → REX
change from "TypeScript + Python" to "TypeScript only".

## Main process

- **Runtime**: Electron
- **Data**: SQLite via `better-sqlite3`, at `~/.rex/rex.db` — outside every
  repository. Native module: needs `electron-rebuild` in the build.
- **Agents**: `@anthropic-ai/claude-agent-sdk`
- **Document rendering**: `markdown-it` (needs `token.map` for `data-src-line`),
  `dompurify` for HTML sanitising

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
- any HTTP server framework, SSE, or listening port
- `nats.ws`
- any Python runtime
- JSON or JSONL as the store (SQLite; `rex export` is how files are produced)

## Scripting & Automation

- Default: TypeScript for scripts, consistent with the rest of the stack
- Shell scripts only for trivial one-liners

## Conventions this machine imposes

- **One formatter per filetype.** Biome owns the JS/TS family; prettier and
  eslint are not installed on this machine.
- Tools run only where the repo carries their config file — see
  `rules/09-code-quality.md`.
