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
- **Status**: **built through spec 45, plus spec 46 milestones 0 to 4.**
  `SPEC.md` in these files means `docs/my-specs/01-initial/SPEC.md`; the later
  specs are `docs/my-specs/NN-*/SPEC.md`, indexed in the README. Spec 46, the
  built-in gateway, is **in progress** — milestones 0 to 3 are built: the
  rename, `local-gateway/`, the `builtin` kind, the `enabled` switch, the port,
  the six providers with discovery, the Settings sheet, the `safeStorage` key
  store, the traffic log, and milestone 3's code — three kinds only
  (`original`/`builtin`/`litellm`), `stored` auth, §15's migration and §6's
  remote model list, and milestone 4's packaging — `scripts/bundle-python.mjs`
  plus `electron-builder.yml`, proven by launching the built `REX.app` and
  watching both Python children run from inside it. `npm run package` produces
  `release/REX-0.1.0-arm64.dmg` (470 MB) from an 806 MB `python-dist/` with
  `polars` gone — re-run 2026-09-06, exit 0. §15's migration **has run** against
  `~/.rex/rex.db`: `agent_gateway` holds `rex-original` and `rex-builtin` only,
  and `setting.gateway.retired` names the two rows it deleted, `Envoy LMS` and
  `Envoy Unsloth`. **Milestone 3 is complete on 2026-09-06**: `infra/` is
  deleted, its six containers, three volumes and two networks are gone, three
  of its four images are removed (`envoyproxy/ai-gateway-cli:latest` stays —
  `ai-gateway-envoy-envoy-1` from the reviewer's own `ai-gateway` repo still
  uses it), and spec 45's `gatewayTraces` channel went with it: it opened
  `infra/observability`'s Grafana, nothing in the renderer called it any more,
  and spec 46 §4.6's `gatewayTraffic` had replaced it.
  **Windows arm64: built, installed from the NSIS wizard, and validated on
  2026-09-07** in the `Windows 11 64-bit Arm` Fusion VM, driven headless over
  `vmrun` (credentials are Lukas's; ask; UAC is off in that VM). `npm run
  package` there produces `REX Setup 0.1.0.exe` (401 MB) from a 902 MB
  `python-dist`; the install lands 16,087 files in ~100 s, and the installed
  app spawns both children from `resources\python\python.exe` and serves on
  24334. Three bugs it found, none catchable from macOS, all fixed:
  (1) `src/main/python.ts` looked for `Scripts\python.exe` — that is a venv's
  layout; python-build-standalone puts `python.exe` at the root, so
  `venvLeafFor()` and `bundledLeafFor()` are now separate and
  `test/localGateway.spec.ts` asserts both per platform; (2) both Python
  children wrote cp1252 stdout, so LiteLLM's banner raised `UnicodeEncodeError`
  and the gateway never bound — `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` in
  `gateway/local.ts` and `agent/service.ts`; (3) electron-builder's NSIS
  installer silently omitted every PE binary and exited 0, because 7-Zip ≥23.01
  applies its `ARM64` filter to arm64 executables and the bundled `nsis7z`
  (7-Zip 19.00 SDK) cannot decode it — `scripts/package.mjs` sets
  `ELECTRON_BUILDER_7Z_FILTER=BCJ2`, which is why `npm run package` must be
  used and `electron-builder` never called directly. `compression: store` is
  silently overridden by the differential-update path and `nsis.useZip` fails
  outright; both measured. Windows build prerequisites:
  `Microsoft.VisualStudio.Component.VC.Tools.ARM64` (the `VCTools` workload
  omits it; `winget --force` with it in `--override` is the invocation that
  applies it), and `bundle-python.mjs` reports 0 MB because `du` is absent.
  **The installer has an "already installed" page** — `build/installer.nsh`,
  which electron-builder includes by name, so no YAML key names it. Run the
  setup on a machine with REX and it offers Reinstall (the default, and the
  repair — every file replaced, `~/.rex` kept) or Uninstall, which runs the
  installed uninstaller's own wizard and then closes the setup; a fresh
  install skips the page. Driven end to end in the VM on 2026-09-07 with
  SendKeys, both paths. `build/*` is gitignored, so the file is re-included
  by name and `test/localGateway.spec.ts` asserts both the file and the
  `.gitignore` line, because a missing file builds a working installer with
  no page and no error.
  No universal x64+arm64 installer: electron-builder #6571 is backlog and the
  combined installer of #5461 is broken, so x64 is a second `arch` on a second,
  x64 machine. **Linux: built, packaged and validated on 2026-09-07** in
  `~/Virtual Machines.localized/rex-ubuntu.vmx` (Ubuntu 26.04 LTS arm64,
  installed by cloud-init autoinstall; guest user `rex`, password in the
  session that created it, not here; VNC on `127.0.0.1:5934` answers the
  installer's one prompt). **The AppImage was dropped the same day**: its
  arm64 launcher wants an unversioned `libz.so` (electron-builder #7835) and
  Ubuntu 24.04+ blocks Electron's sandbox inside one, so REX never started.
  `.deb` and `.rpm` replace it — x64 in the YAML, `--arm64` on the command
  line for the VM — and the deb is proven: `apt install ./rex_0.1.0_arm64.deb`
  put REX in `/opt/REX` with an AppArmor profile, and with Node, npm and uv
  removed the installed app started both Python children from
  `/opt/REX/resources/python/bin/python` and LiteLLM answered on 24334 in 5 s.
  The deb needs `author` and `homepage` in package.json, guarded by a test.
  Still unproven on Linux: an ASK end to end, and installing the `.rpm` (built,
  not installed — no Fedora machine here). No cross-build exists — `bundle-python.mjs`
  installs and then *executes* the host's CPython. Signing and notarisation are
  unconfigured on purpose.
  **What installing the DMG found, 2026-09-07** — the reason milestone 4 exists
  as its own milestone. `local-gateway/catalogue.json` was never staged, so a
  packaged REX listed **no providers at all** and nothing could be added. It is
  data read from disk at `packageRoot()/catalogue.json` (`gateway/catalogue.ts`),
  not a Python import, so `bundle-python.mjs` never carried it; and it fails
  quietly by design, so the only symptom was an empty screen.
  `electron-builder.yml` now stages it to `Resources/catalogue.json` and
  `test/localGateway.spec.ts` guards the pair. **Verified from the rebuilt DMG
  on a throwaway `REX_DB_PATH`**: six providers listed, LM Studio added,
  discovery returned its models with windows and tool support, one ticked, and
  `config.yaml` came out with the alias `lmstudio-google-gemma-4-e4b`,
  `max_input_tokens: 122880` (§4.4 rule 3's reduction from 131072) and
  `os.environ/REX_PROVIDER_*` rather than any key. Both children ran from
  inside the bundle and the switch survived a restart. **Still unproven**: an
  ASK answering end to end from the packaged app — the document frame is
  sandboxed with scripting off, so the last step needs real mouse input.
  **Spec 49 — releases — is built and has never run on GitHub**:
  `.github/workflows/release.yml` builds macOS arm64, Windows x64 and arm64,
  and Linux x64 `.deb` + `.rpm` on `macos-latest`, `windows-latest`,
  `windows-11-arm` and `ubuntu-latest`, and a push to `main` publishes them as
  a Release tagged `v<version>-<run>` with `.github/release-notes.md` as the
  body; pull requests run nothing (they did on the first day, and only
  doubled every build), `workflow_dispatch` builds by hand. `scripts/package.mjs`
  defaults the architecture to the host's, because the YAML lists both
  Windows architectures, and always passes `--publish never`: package.json's
  `homepage` makes electron-builder infer a GitHub publisher, and the first
  push run died after every build on "GitHub Personal Access Token is not
  set" (PR #13). `REX_PACKAGE_DRY_RUN=1` prints its arguments. The first run
  answered two of spec 49 §5's unknowns — `windows-11-arm` has the MSVC ARM64
  toolset and `ubuntu-latest` builds the `.rpm` — and left one: the x64
  installer on real x64 hardware.
  Specs 47 and 48 are proposals and nothing in them exists yet, but both were
  **retargeted on 2026-09-07** (47 to v4.0, 48 to v3.0) onto the built-in
  gateway: `http://127.0.0.1:24334/v1`, `environment` auth, `REX_GATEWAY_KEY`.
  Their old target, `infra/envoy` on 26334, no longer exists. Both now share
  one open measurement — whether LiteLLM passes streaming `tool_calls` through
  intact — recorded as spec 47 §10.0 and spec 48 §12.4 item 0; take it once and
  write it in both. The numbers follow the build order.
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
