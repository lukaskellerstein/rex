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
- **Status**: **built through spec 50** — macOS, completely, 2026-09-08.
  **REX is a macOS app on Apple silicon, and nothing else.** Windows and Linux
  were built, installed and validated in VMs on 2026-09-07 and removed the next
  day: two of the three could not run every agent in every mode, and the claim
  was worth less than the truth. Spec 50 §5 is the record of what those builds
  measured — the Windows NSIS 7-Zip filter, the cp1252 stdout, the AppImage,
  the `.deb`'s AppArmor profile, and above all that **there is no cross-build**,
  because `bundle-python.mjs` installs the host's CPython and then executes it.
  **All four SDKs are built and every one offers ASK and ACT.** No adapter has a
  platform arm left. Codex and OpenCode had one until spec 50; Claude and Deep
  Agents never did.
  `SPEC.md` in these files means `docs/my-specs/01-initial/SPEC.md`; the later
  specs are `docs/my-specs/NN-*/SPEC.md`, indexed in the README. In build order:
  42 the agent library, 43 the local gateway, 44 Codex, 45 watching the gateway,
  46 the built-in gateway, 47 OpenCode, 48 Deep Agents, 49 releases, 50 macOS.
- **What spec 50 fixed, and the two lessons in it.** A Deep Agents ASK could not
  read the document at all — it answered "not found" about a file that was
  there. REX's ASK prompt names the spec 22 working copy by **absolute** path
  (`prompts.ts`), the copy lives under `~/.rex/work/`, outside `cwd`, and
  `for_ask()` built a `virtual_mode=True` backend, which re-roots an absolute
  path inside itself. `RunRequest.readable` now carries those folders and
  `for_ask()` speaks real paths with reads scoped to `cwd` plus them.
  1. **Spec 48's 42 end-to-end checks missed it** because the harness wrote its
     own prompt, with paths inside `cwd`. A proof that does not use REX's own
     prompt is not a proof of REX.
  2. **`FilesystemBackend`'s own methods ignore the permission rules** — called
     directly it will read `/etc/hosts` under a deny-all rule. The rules are
     enforced where the tool runs, so a test that calls the backend directly
     measures nothing at all.
- **Packaging and releases**: `npm run bundle:python` stages a relocatable
  CPython 3.12 with both Python packages into `python-dist/`; `npm run package`
  hands it to `electron-builder` and produces `release/REX-0.1.0-arm64.dmg`.
  Both outputs are gitignored. `.github/workflows/release.yml` builds that DMG
  on `macos-latest` for every push to `main` and publishes a Release tagged
  `v<version>-<run>`; pull requests run nothing. electron-builder must be told
  `--publish never` or a push dies after the build on a missing token — that is
  what `scripts/package.mjs` is for, so never call `electron-builder` directly.
  **`local-gateway/catalogue.json` must be staged**: it is data read from disk
  at `packageRoot()/catalogue.json`, not a Python import, so `bundle-python.mjs`
  never carries it, and without it a packaged REX lists **no providers at all**,
  silently. `electron-builder.yml` stages it and a test guards the pair.
  Signing and notarisation are deliberately unconfigured.
- **Still unproven**: an ASK answering end to end from the **packaged** app —
  the document frame is sandboxed with scripting off, so the last step needs
  real mouse input.
- **Architecture**: Electron, two processes (`SPEC.md` §3). The renderer holds
  the document view, the shadow-root overlay and the anchor resolver; the main
  process holds the thread service, the document renderers, the gate and
  SQLite. They talk over IPC only. **Since spec 42, a third process:** the
  Python agent library, `agent-runner/`, spawned by main and spoken to over its
  own stdin and stdout — every agent SDK lives there, and main keeps only a pipe
  client (`src/main/agent/service.ts`) and a mapping (`bridge.ts`). **Since spec
  46, a fourth, when the switch is on:** `local-gateway/`, REX's own LiteLLM on
  `127.0.0.1:24334`, owned by `src/main/gateway/`.
- **Structure**: `src/main/` (`agent/`, `db/`, `docx/`, `gateway/`, `pptx/`,
  `render/`, `workspace/`, `ipc.ts`, `apply.ts`, …), `src/renderer/`
  (`overlay/`, `anchor/`), `src/shared/`, `src/preload/`, `test/`
  (50 `*.spec.ts` files), `docs/my-specs/`, and two Python packages at the
  root: `agent-runner/` (spec 42) and `local-gateway/` (spec 46).
- **Build**: `electron-vite` — `npm run build`; `npm run typecheck` is
  `tsc --noEmit`. **Packaging** (spec 46 §13): `npm run bundle:python` stages a
  relocatable CPython 3.12 with both Python packages into `python-dist/`
  (806 MB, `polars` deleted), and `npm run package` hands it to
  `electron-builder`. Both outputs are gitignored.
- **Run locally**: `npm run dev` — Vite on 5334, the debugger on 9334 (§ Ports).
  An agent starts its own instance only through
  `.claude/hooks/playwright-launch.sh npm run dev`
  ([`06-testing.md`](06-testing.md)).
- **Test**: one script per file — `npm run test:<name>` runs
  `node --test test/<name>.spec.ts`. There are 50 and there is no `npm test`.
  `npm run test:library` runs the three seam suites and `uv run pytest` in
  `agent-runner/`; `npm run test:gateway` runs the two gateway suites and
  `uv run pytest` in `local-gateway/`. A change on either side of a boundary
  runs both halves.
- **Key dependencies**: `electron`, `electron-vite`, `react` + `react-dom`,
  `better-sqlite3` (native — needs `electron-rebuild`), `markdown-it`,
  `dompurify`, `diff-match-patch`, `uuid`, `mermaid`, `pdfjs-dist`, `mammoth`,
  `jszip`, `pptxtojson`, `katex`. **No agent SDK**: spec 42 moved
  `@anthropic-ai/claude-agent-sdk` out of `package.json` entirely, and
  `agent-runner/` carries `claude-agent-sdk` instead.
- **Package manager**: npm for the app (`package-lock.json`); `uv` for
  `agent-runner/` and `local-gateway/`, and never `pip` — package managers are
  not interchangeable. Each Python package has its own `.venv`;
  `local-gateway/.venv` is 456 MB because `litellm[proxy]` is, and spec 46 §13
  makes trimming it a milestone 4 task with a measurement attached.

## The three invariants

`SPEC.md` §3 states these as non-negotiable. They constrain almost every change:

| # | Invariant |
|:--|:--|
| I1 | The anchor resolver runs **in the renderer, on the live DOM**. The main process stores anchors and never resolves them. |
| I2 | Only the main process touches SQLite and the Agent SDK. The renderer displays untrusted document content. |
| I3 | Commands are `ipcRenderer.invoke`; agent output is `webContents.send`. No HTTP server, no SSE, no message broker. **Amended by spec 46 §2:** one loopback port carries inference, and nothing else. |

### What spec 46 changed about I3, and what it did not

Every SDK reaches a gateway by URL — `ANTHROPIC_BASE_URL`, Codex's `base_url`,
OpenCode's `baseURL`, `ChatOpenAI`'s `base_url`. None of them speaks a pipe and
none can address a Unix socket, so a built-in gateway needs a port. It binds
`127.0.0.1` and never anything else (§14 rule 1), and a test asserts the
argument because LiteLLM's own default is `0.0.0.0`.

What still holds: **REX's own processes listen on nothing.** No IPC over HTTP,
no broker, no SSE, and the agent library is still a child on pipes.

## Ports

The two dev ports below belong to Electron's debugger and the dev-time bundler,
not to the app. The third is the built-in gateway's, and it exists only while
that switch is on:

| Port | What | Where |
|:--|:--|:--|
| 9334 | Electron remote debugging (CDP), for the Playwright MCP to attach to | `.mcp.json`; **every run opens it** — spec 13 §2.1, `src/main/cdp.ts` |
| 5334 | The Vite dev server that serves the renderer during `npm run dev` | `electron.vite.config.ts`, `renderer.server.port` |
| 24334 | The built-in gateway (spec 46 §4.2), when it is switched on. Walks up to 24343 if taken; `REX_GATEWAY_PORT` pins one | `src/main/gateway/local.ts` |

**A busy 24334 is never adopted.** REX proves a server is its own with a master
key minted per launch *and* by checking which process holds the socket; a
stranger that answers 200 to anything still fails the second test. When the port
moves, `pointRoutesAtPort` rewrites the stored routes before anything resolves
one — spec 46 §4.2.1, and the one place the walk-up could otherwise break a run
silently.

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
| `~/Projects/Github/lukaskellerstein/vibe-coding-course` | The Codex and OpenCode samples specs 44 and 47 cite by file and line. **Read-only.** |
| `~/Projects/Github/lukaskellerstein/ai-agents-course/Version_3/06_langchain-ai/3_deepagents` | The Deep Agents samples spec 48 cites. **Read-only.** |
