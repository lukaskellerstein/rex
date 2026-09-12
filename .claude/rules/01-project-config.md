---
description: Project configuration — architecture, paths, dev environment
---

# Project Config

<!-- Filled from what the repo actually contains, as pointers. The reasoning and
     the history live in the specs; nothing here restates them. -->

- **Project**: REX — a desktop app for commenting on documents and discussing
  each comment with an AI agent. macOS on Apple silicon only.
- **Architecture**: four processes — the renderer, main, the agent library
  (`agent-runner/`, a Python child on stdin/stdout) and the built-in gateway
  (`local-gateway/`, LiteLLM on loopback, only while switched on). Read
  `SPEC.md` §3 for the invariants, and the README's *How it works*.
- **Structure**: `src/main/`, `src/renderer/`, `src/shared/`, `src/preload/`,
  `src/cli/`, `test/`, `scripts/`, `agent-runner/`, `local-gateway/`,
  `docs/my-specs/`. The README's *How it works* has the tree.
- **Build**: `npm run build`; `npm run typecheck`. The DMG: `npm run package` —
  never call `electron-builder` directly.
- **Run locally**: `npm run dev`. An agent starts its own instance only through
  `.claude/hooks/playwright-launch.sh npm run dev` — [`06-testing.md`](06-testing.md).
- **Test**: `npm run test:<name>`, one suite per file, no `npm test`.
  `npm run test:library` and `npm run test:gateway` run each Python package with
  its seam suites.
- **Key dependencies**: `package.json`, `agent-runner/pyproject.toml`,
  `local-gateway/pyproject.toml`.
- **Package manager**: npm for the app; `uv` for both Python packages, never
  `pip`. Run `npm run rebuild` after every `npm install`.
- **Releases**: every pull request into `main` raises `version`
  (`npm version patch|minor --no-git-tag-version`) — spec 57.

## Services and ports

| Port | What |
|:--|:--|
| 9334 | Electron remote debugging (CDP), for the `playwright-rex` MCP. Every run opens it; `REX_CDP_PORT` moves it |
| 5334 | The Vite dev server during `npm run dev` |
| 24334 | The built-in gateway, while switched on. Walks up to 24343 if taken; `REX_GATEWAY_PORT` pins one |

## External paths

All read-only.

| Path | Used for |
|:--|:--|
| `~/Projects/Github/lukaskellerstein/documentation-sample` | The sample documents every test and live check uses |
| `~/Projects/Github/lukaskellerstein/vex` | The reference implementation REX was ported from (`SPEC.md` §11) |
| `~/Projects/Github/lukaskellerstein/claude-my-marketplace` | The plugins REX loads into its agents |
| `~/Projects/Github/lukaskellerstein/ai-gateway` | The reviewer's external gateways (spec 43). Never run `compose config` there; it prints keys |
| `~/Projects/Github/lukaskellerstein/vibe-coding-course` | The Codex and OpenCode samples specs 44 and 47 cite |
| `~/Projects/Github/lukaskellerstein/ai-agents-course/Version_3/06_langchain-ai/3_deepagents` | The Deep Agents samples spec 48 cites |
| `~/.rex/` | REX's data at runtime — the database, the log, working copies, the gateway |
