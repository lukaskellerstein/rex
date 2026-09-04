---
description: Project configuration — architecture, paths, dev environment
---

# Project Config

<!-- Filled from what the repo actually contains. Every line must be verifiable
     by reading a file in the repo — never write an aspiration here.
     A line about a spec that is not built yet says so and cites the spec;
     everything else is a fact about the working tree today (2026-09-04). -->

- **Project**: REX — a desktop app for commenting on documents and discussing
  each comment with an AI agent (`SPEC.md` §1). Third in the family after
  **VEX** (*Visual EX*) and **DEX**; *Review EX* (`SPEC.md` §1.1).
- **Status**: **built through spec 41.** `SPEC.md` in these files means
  `docs/my-specs/01-initial/SPEC.md`; the later specs are
  `docs/my-specs/NN-*/SPEC.md`, indexed in the README. Specs 42 to 46 are
  proposals and nothing in them exists yet.
- **Architecture**: Electron, two processes (`SPEC.md` §3). The renderer holds
  the document view, the shadow-root overlay and the anchor resolver; the main
  process holds the thread service, the document renderers, the gate and
  SQLite. They talk over IPC only. **From spec 42 on, a third process:** the
  Python agent library, `agent-gateway/`, spawned by main and spoken to over its
  own stdin and stdout — every agent SDK lives there, and main keeps only a pipe
  client (`src/main/agent/service.ts`) and a mapping (`bridge.ts`).
- **Structure**: `src/main/` (`agent/`, `db/`, `docx/`, `pptx/`, `render/`,
  `workspace/`, `ipc.ts`, `apply.ts`, …), `src/renderer/` (`overlay/`,
  `anchor/`), `src/shared/`, `src/preload/`, `test/` (39 `*.spec.ts` files),
  `docs/my-specs/`. Spec 42 adds `agent-gateway/` at the root.
- **Build**: `electron-vite` — `npm run build`; `npm run typecheck` is
  `tsc --noEmit`.
- **Run locally**: `npm run dev` — Vite on 5334, the debugger on 9334 (§ Ports).
  An agent starts its own instance only through
  `.claude/hooks/playwright-launch.sh npm run dev`
  ([`06-testing.md`](06-testing.md)).
- **Test**: one script per file — `npm run test:<name>` runs
  `node --test test/<name>.spec.ts`. There are 39 and there is no `npm test`.
  Spec 42 adds `uv run pytest` in `agent-gateway/` and `npm run test:library`.
- **Key dependencies**: `electron`, `electron-vite`, `react` + `react-dom`,
  `better-sqlite3` (native — needs `electron-rebuild`), `markdown-it`,
  `dompurify`, `diff-match-patch`, `uuid`, `mermaid`, `pdfjs-dist`, `mammoth`,
  `jszip`, `pptxtojson`, `katex`; and `@anthropic-ai/claude-agent-sdk` until
  spec 42 moves it into `agent-gateway/` as `claude-agent-sdk`.
- **Package manager**: npm for the app (`package-lock.json`); `uv` for
  `agent-gateway/`, and never `pip` — package managers are not
  interchangeable.

## The three invariants

`SPEC.md` §3 states these as non-negotiable. They constrain almost every change:

| # | Invariant |
|:--|:--|
| I1 | The anchor resolver runs **in the renderer, on the live DOM**. The main process stores anchors and never resolves them. |
| I2 | Only the main process touches SQLite and the Agent SDK. The renderer displays untrusted document content. |
| I3 | Commands are `ipcRenderer.invoke`; agent output is `webContents.send`. **No HTTP server, no SSE, no message broker, no listening port.** |

## Ports

REX itself listens on nothing — that is invariant I3, and it holds for the
agent library too: `agent-gateway/` is a child on pipes, not a server (spec 42
§4). The two ports in this repo's config belong to Electron's debugger and to
the dev-time bundler, not to the app. The built app opens neither:

| Port | What | Where |
|:--|:--|:--|
| 9334 | Electron remote debugging (CDP), for the Playwright MCP to attach to | `.mcp.json`; **every run opens it** — spec 13 §2.1, `src/main/cdp.ts` |
| 5334 | The Vite dev server that serves the renderer during `npm run dev` | `electron.vite.config.ts`, `renderer.server.port` |

5334 replaces Vite's default 5173, which every other Vite project on this
machine also wants. The digits mirror 9334 on purpose. `strictPort` is off, so a
second REX slides to 5335 rather than failing, and the main process follows
either way — it reads the URL from `ELECTRON_RENDERER_URL`
(`src/main/index.ts:108`) and never hardcodes a port.

Since spec 13 no flag is needed: `npm run dev` opens 9334 on its own, so the
window a reviewer is looking at can always be attached to. An explicit
`--remote-debugging-port` still wins, and `REX_CDP_PORT=N` moves it —
`REX_CDP_PORT=off` closes it. Only one REX can hold the port; a second gets
none, silently, which is why the debug report prints what it *found*.

Chosen to avoid a collision: `dex` uses 9333 and `vex` uses 9222 and 9333, and
several sessions run on this machine at once.

## External paths this project depends on

Verified to exist on this machine. `SPEC.md` §2 is the source.

| Path | Used for |
|:--|:--|
| `~/Projects/Github/lukaskellerstein/vex` | The reference adapter being ported (`SPEC.md` §11). **Read-only.** |
| `~/Projects/Github/lukaskellerstein/claude-my-marketplace` | Supplies the `lsp-*` plugins REX loads into its own agents (`SPEC.md` §8.3) |
| `~/Projects/Github/lukaskellerstein/documentation-sample` | The sample documents every test and live check uses. `one/`: `sample-document.md` (263 lines, a README), `sample-document.docx` (a different document — a quarterly business review, 45 blocks, 4 images, 4 tables) and `sample-document.pdf` (a third — a watershed monitoring report). `two/`: `sample-report.md` (349 lines), `.docx` and `.pdf`, one report in three formats. `three/`: `sample-deck.pptx`, `sample-workbook.xlsx`. **Read-only.** |
| `~/.rex/rex.db` | REX's database at runtime — **outside every repository**, so it can never be committed (`SPEC.md` §9) |
| `~/Projects/Github/lukaskellerstein/ai-gateway` | The reviewer's gateways — `litellm/` on 24000, `envoy/` on 26000 — that spec 43 routes agents through. **Read-only.** Never run `compose config` there; it prints keys |
| `~/Projects/Github/lukaskellerstein/vibe-coding-course` | The Codex and OpenCode samples specs 44 and 45 cite by file and line. **Read-only.** |
| `~/Projects/Github/lukaskellerstein/ai-agents-course/Version_3/06_langchain-ai/3_deepagents` | The Deep Agents samples spec 46 cites. **Read-only.** |
