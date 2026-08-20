---
description: Project configuration — architecture, paths, dev environment
---

# Project Config

<!-- Filled from what the repo actually contains. Every line must be verifiable
     by reading a file in the repo — never write an aspiration here.
     This repo is pre-implementation: the only substantive file is SPEC.md, so
     every "planned" line below cites the section of SPEC.md that fixes it, and
     every "not yet present" line is a fact about the working tree today. -->

- **Project**: REX — a desktop app for commenting on documents and discussing
  each comment with an AI agent (`SPEC.md` §1). Third in the family after
  **VEX** (*Visual EX*) and **DEX**; *Review EX* (`SPEC.md` §1.1).
- **Status**: **not implemented.** The tree holds `SPEC.md`, `README.md`, tooling
  markers and this `.claude/`. No `package.json`, no `src/`, no `node_modules`.
  `SPEC.md` is the authority on everything below.
- **Architecture**: Electron, two processes (`SPEC.md` §3). The renderer holds
  the document view, the shadow-root overlay and the anchor resolver; the main
  process holds the thread service, the agent runner, the document renderers and
  SQLite. They talk over IPC only.
- **Structure**: planned as `src/main/`, `src/renderer/`, `src/shared/`,
  `src/preload/`, `test/` — the full tree is `SPEC.md` §3.1. **None of it exists
  yet.**
- **Build**: `electron-vite` (`SPEC.md` §3.2) — config not yet written.
- **Run locally**: not yet runnable. Milestone 1 (`SPEC.md` §13) is the first
  milestone that produces a launchable app.
- **Test**: no suite yet. Milestone 0 is a standalone ~150-line script in
  `test/anchor.spec.ts` (`SPEC.md` §13, Milestone 0).
- **Key dependencies** (planned, `SPEC.md` §3.2): `electron`, `electron-vite`,
  `react` + `react-dom`, `better-sqlite3` (native — needs `electron-rebuild`),
  `@anthropic-ai/claude-agent-sdk`, `markdown-it`, `dompurify`,
  `diff-match-patch`, `uuid`.
- **Package manager**: not yet chosen — decided when `package.json` is written at
  milestone 1. The sibling repos `~/Projects/Github/lukaskellerstein/dex` and
  `~/Projects/Github/lukaskellerstein/vex` both use npm.

## The three invariants

`SPEC.md` §3 states these as non-negotiable. They constrain almost every change:

| # | Invariant |
|:--|:--|
| I1 | The anchor resolver runs **in the renderer, on the live DOM**. The main process stores anchors and never resolves them. |
| I2 | Only the main process touches SQLite and the Agent SDK. The renderer displays untrusted document content. |
| I3 | Commands are `ipcRenderer.invoke`; agent output is `webContents.send`. **No HTTP server, no SSE, no message broker, no listening port.** |

## Ports

REX itself listens on nothing — that is invariant I3. The one port in this repo's
config belongs to Electron's debugger, not to the app:

| Port | What | Where |
|:--|:--|:--|
| 9334 | Electron remote debugging (CDP), for the Playwright MCP to attach to | `.mcp.json`; the app must be launched with `--remote-debugging-port=9334` |

Chosen to avoid a collision: `dex` uses 9333 and `vex` uses 9222 and 9333, and
several sessions run on this machine at once.

## External paths this project depends on

Verified to exist on this machine. `SPEC.md` §2 is the source.

| Path | Used for |
|:--|:--|
| `~/Projects/Github/lukaskellerstein/vex` | The reference adapter being ported (`SPEC.md` §11). **Read-only.** |
| `~/Projects/Github/lukaskellerstein/claude-my-marketplace` | Supplies the `lsp-*` plugins REX loads into its own agents (`SPEC.md` §8.3) |
| `~/Projects/Github/redhat/ProtoBot/docs/` | The test documents anchoring is developed against (`SPEC.md` §2). Note the capitalisation — `redhat` lower, `ProtoBot` camel. **Read-only.** |
| `~/.rex/rex.db` | REX's database at runtime — **outside every repository**, so it can never be committed (`SPEC.md` §9) |
