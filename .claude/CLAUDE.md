# WORKFLOW — MANDATORY FOR ANY PROMPT THAT RESULTS IN CHANGES

**If you are going to use the Edit or Write tool, or run a command that changes
the working tree or the database, you MUST complete the workflow in `rules/`
before reporting completion.** Applies to every type of work — application code,
the anchor resolver, agent prompts and profiles, the SQLite schema, build config,
and docs. No exceptions.

Steps, in order (each phase's detailed procedure is in the correspondingly-numbered
`rules/` file — already loaded into context, no need to open it):

1. **Understand** → [`rules/02-understand.md`](rules/02-understand.md)
2. **Plan** → [`rules/03-plan.md`](rules/03-plan.md) *(skip for trivial changes)*
3. **Implement** → [`rules/05-implement.md`](rules/05-implement.md)
4. **Test** → [`rules/06-testing.md`](rules/06-testing.md)
5. **Report** → [`rules/08-report.md`](rules/08-report.md)

Reference files: [`rules/01-project-config.md`](rules/01-project-config.md)
(architecture, the three invariants, ports, external paths),
[`rules/09-code-quality.md`](rules/09-code-quality.md),
[`rules/10-tech-stack.md`](rules/10-tech-stack.md),
[`rules/11-communication.md`](rules/11-communication.md),
[`rules/12-security.md`](rules/12-security.md),
[`rules/machine-tools.md`](rules/machine-tools.md) (the `nvim-tools` and
`lukas-ps` CLIs — pre-approved, read-only),
[`rules/lsp.md`](rules/lsp.md) (the `LSP` tool — only in repos that opted in,
and deferred, so it must be loaded before it can be called).

**NEVER report completion without first running the change and watching it
work.** "The code looks right" is not testing, and for the anchor resolver it is
actively misleading — a wrong anchor resolves to *somewhere*, reports `ok`, and
looks entirely fine until a human reads the highlight. Verification is YOUR
responsibility — the user should never need to ask you to test.

**Trivial changes** (a typo, a comment, a one-line doc edit, renaming a local
variable): skip step 2. State what you'll do and proceed.

## REX at a glance

- **What it is**: a desktop app for commenting on documents and discussing each
  comment with an AI agent. Select text → write a comment → **Ask** → one agent
  answers that one comment → keep chatting in the thread → **Apply** lets a
  second, write-capable agent make the change. `SPEC.md` §1.
- **Status**: **built through spec 45, plus spec 46 milestones 0 to 4.** The
  specs are the authority. `SPEC.md` in these files means
  `docs/my-specs/01-initial/SPEC.md`; every later decision is a numbered spec
  under `docs/my-specs/NN-*/SPEC.md`, and the README's spec table indexes them.
  Specs 42 to 45 — the agent library, the local gateway, the Codex agent and
  watching the gateway — are **built**. Spec 46 — the built-in gateway — is
  **in progress**: milestones 0 to 3 are built — the rename, `local-gateway/`,
  the `builtin` kind, the switch, the port, the six providers, the Settings
  screen, the encrypted key store, the traffic log, and milestone 3's code
  (three kinds only, `stored` auth, §15's migration, §6's remote model list).
  §15's migration **has run** against `~/.rex/rex.db` — verified 2026-09-06:
  `agent_gateway` holds only `rex-original` and `rex-builtin`, its `CHECK`
  lists three kinds, and `setting.gateway.retired` records the two rows it
  deleted, `Envoy LMS` and `Envoy Unsloth`. **Milestone 3 is complete**:
  `infra/` is deleted, its six containers, three volumes and two networks are
  gone, and the dead spec 45 `gatewayTraces` channel that opened its Grafana
  went with it. Milestone 4 is built
  for macOS — `npm run bundle:python` stages a relocatable CPython with both
  packages, `npm run package` makes a DMG, and installing that DMG on 2026-09-07
  found and fixed the bug it exists to find: `local-gateway/catalogue.json` was
  never staged, so a packaged REX listed **no providers**. It is now in
  `electron-builder.yml`'s `extraResources` with a test guarding it.
  **Windows arm64 is built, installed and validated — 2026-09-07, in the
  `Windows 11 64-bit Arm` VMware Fusion VM, driven headless with `vmrun`**
  (credentials are Lukas's; ask). Three real bugs found there, none catchable
  from macOS: `python.ts` looked for `Scripts\python.exe` where the standalone
  runtime keeps `python.exe` at its root; both Python children wrote cp1252
  stdout, which killed LiteLLM's banner before it bound; and electron-builder's
  NSIS installer **silently dropped every PE binary** because 7-Zip's `ARM64`
  filter is undecodable by the bundled `nsis7z` (7-Zip 19.00 SDK). That last
  one is fixed by `scripts/package.mjs` setting `ELECTRON_BUILDER_7Z_FILTER=BCJ2`
  — **never run `electron-builder` directly for Windows, use `npm run package`.**
  Windows prerequisites: `Microsoft.VisualStudio.Component.VC.Tools.ARM64` named
  explicitly (the `VCTools` workload omits it), and `bundle-python.mjs` reports
  0 MB there because `du` is absent. The installer's "already installed" page
  — Reinstall or Uninstall — is `build/installer.nsh`, included by name and
  guarded by a test, because `build/*` is gitignored and a missing include
  builds fine with no page. No universal x64+arm64 installer exists
  (electron-builder #6571 backlog, #5461 broken): x64 is a second `arch` and a
  second, x64 build machine. **Linux is validated — 2026-09-07, Ubuntu 26.04
  arm64 in `rex-ubuntu.vmx`**: the `.deb` installs to `/opt/REX` and the
  installed app ran both Python children with Node and uv removed. The
  AppImage was dropped that day — its arm64 launcher does not start
  (electron-builder #7835) and Ubuntu 24.04+ blocks Electron's sandbox inside
  one — so Linux ships `.deb` and `.rpm`. No cross-build
  exists: `bundle-python.mjs` installs and then *executes* the host's CPython.
  Signing and notarisation are deliberately unconfigured
  (`identity: null`); both need an Apple ID and are their own job. **Spec 49 — releases — is
  built, first run pending**: `.github/workflows/release.yml` builds the five
  installers on one runner per architecture and publishes a Release tagged
  `v<version>-<run>` on every push to `main`; pull requests build only. It
  has never run on GitHub — spec 49 §5 lists the three unknowns the first run
  settles. Specs 47 and 48 — OpenCode and
  Deep Agents — are **proposals**; nothing in them is built. Both were
  **retargeted on 2026-09-07** onto the built-in gateway (47 → v4.0, 48 → v3.0);
  their old target `infra/envoy` on 26334 is gone, and both now wait on one
  shared measurement — does LiteLLM pass streaming `tool_calls` through intact
  (spec 47 §10.0, spec 48 §12.4 item 0). The numbers follow the build
  order, which is why they were renumbered on 2026-09-06.
- **Milestone 0 passed.** `test/anchor.spec.ts` is the anchor spike, kept as
  the regression net for the one component that fails silently.
- **Stack**: TypeScript for the app — Electron + React + `electron-vite`,
  `better-sqlite3` — and **two Python packages**, which are siblings and never
  import each other:
  - `agent-runner/` (spec 42; called `agent-gateway/` until spec 46 §9 renamed
    it on 2026-09-06) — every agent SDK, run as one child of the main process
    and spoken to over stdin and stdout, one JSON line per message. No port.
  - `local-gateway/` (spec 46) — REX's own LiteLLM, serving inference on one
    loopback port. It is a separate package precisely because `agent-runner/`
    may hold no HTTP server and `litellm[proxy]` is one.

  **No file under `src/` imports an agent SDK**: `src/main/agent/service.ts` is
  a pipe client and `bridge.ts` is a mapping, and `grep -rn "claude-agent-sdk"
  src/ package.json` finds nothing. `SPEC.md` §12's "no Python runtime" row was
  retired by spec 42 §1.1.
- **Three invariants that shape every change** (`SPEC.md` §3): anchors resolve in
  the **renderer** on the live DOM; only the **main** process touches SQLite and
  the SDK; IPC only — no HTTP server, no broker, **and one loopback port that
  carries inference and nothing else**. That last clause is spec 46 §2's amendment
  to I3, forced by the fact that every SDK reaches a gateway by URL and none of
  them can address a pipe or a Unix socket. REX still *listens* on nothing.
- **Data lives outside the repo**: `~/.rex/rex.db`, so it can never be committed
  by accident.
- **Port 9334** is Electron's remote-debugging endpoint, for the Playwright MCP
  to attach to. It is not an app port. `dex` uses 9333 and `vex` uses 9222/9333.
- **Ported from Vex, not invented**: the Claude Agent SDK adapter comes from
  `~/Projects/Github/lukaskellerstein/vex` (read-only). `SPEC.md` §11 is the
  file-by-file mapping, including what to **drop**. Spec 42 §9 ported it back
  into Python, under REX's rules — it is
  `agent-runner/src/agent_runner/adapters/claude/` — and §15.1 records why
  Vex's broker and ports were not ported with it.

Full facts → [`rules/01-project-config.md`](rules/01-project-config.md); stack and
conventions → [`rules/10-tech-stack.md`](rules/10-tech-stack.md).

## Standing authorizations — do NOT ask before doing these

These actions are pre-approved. Run them yourself when the situation calls for it.

### Read-only inspection (always safe)

- Reading anything inside this repo, `SPEC.md` included.
- Reading `~/Projects/Github/lukaskellerstein/vex` — the reference implementation
  being ported. **Read-only: never write into vex.**
- Reading `~/Projects/Github/lukaskellerstein/documentation-sample` — the
  sample documents every test and every live check uses: `one/` holds three
  unrelated documents (a Markdown README, a DOCX business review, a PDF
  report), `two/` holds one report as Markdown, DOCX and PDF, `three/` a deck
  and a workbook. **Read-only: never write into it.** An ACT test runs on a
  throwaway copy.
- `git status`, `git diff`, `git log`, `git show`, `git blame`, `git ls-files`
  in this repo.
- Fetching the Claude Agent SDK docs at `https://code.claude.com/docs/en/agent-sdk`
  (the Python reference is `…/agent-sdk/python`) — `SPEC.md` §0 requires
  verifying every SDK symbol against them rather than assuming the names in a
  spec are the names in the pinned package. The same goes for
  `https://pypi.org/pypi/<name>/json` and the LangChain docs at
  `https://docs.langchain.com/oss/python/…` for specs 44, 47 and 48.
- Inspecting a running REX: `curl -s http://localhost:9334/json/version`.
- `sqlite3 ~/.rex/rex.db` with read-only statements (`SELECT`, `.schema`).

This machine's own `nvim-tools` and `lukas-ps` are pre-approved too, and are
documented once in [`rules/machine-tools.md`](rules/machine-tools.md) — do not
restate them here.

### Pre-approved mutations

- Creating and editing files under `src/`, `test/`, `agent-runner/`,
  `local-gateway/`, and the
  build config at the repo root (`package.json`, `tsconfig.json`,
  `electron.vite.config.ts`).
- Installing declared dependencies — the ones `SPEC.md` §3.2 names for the app,
  and the ones spec 42 §3 and specs 44, 47 and 48 §3 name for `agent-runner/` — and
  running `electron-rebuild` for `better-sqlite3`. In `agent-runner/` that is
  `uv add` and `uv sync`, **never `pip`**; `uv sync`, `uv run pytest` and
  `uv run python -m agent_runner.protocol --schema` are pre-approved.
- Building and launching REX locally. Since spec 13 the debugger port needs no
  flag — every run opens 9334 — so **check `curl -s http://localhost:9334/json/version`
  before starting one**: an answering endpoint is a REX that already exists, and
  it is probably the reviewer's own.
- Reading `~/.rex/rex.log` — this run's errors, renderer console included, with
  no debugger needed.
- Driving the running app with the `mcp__playwright-rex__browser_*` tools, and
  closing the browser afterwards.
- Deleting and recreating `~/.rex/rex.db` **during development**, when a schema
  change requires it. It holds only local development threads at this stage; say
  in the report that you did it.

### Requires confirmation — always ask first

- Adding any dependency no spec names — `SPEC.md` §3.2 for the app, spec 42 §3
  and specs 44, 47 and 48 §3 for `agent-runner/` — and never one from the §12
  forbidden list (NATS or any broker, any HTTP server framework, `nats.ws`, any
  socket listener in the agent library). A Python SDK package a spec names is an
  ordinary declared dependency; the interpreter itself is `uv`'s to install.
- Building anything from a milestone later than the one in progress, or any
  feature `SPEC.md` §12 lists as a non-goal.
- Editing `SPEC.md` itself. It is the authority; changing it changes the contract
  rather than the code, so propose the edit and say what forced it.
- Running REX's own **`write`-profile agent / Apply** against any real document.
  That is an agent editing a file on this machine — `SPEC.md` §8.7 step 5
  requires a diff be shown and accepted first, and that requirement applies to
  you as much as to the app.
- Anything at all that writes into `vex` or `documentation-sample`.
- `git push`, `git push --force`, branch deletes — **never commit unless the user
  explicitly asks**.
- Anything touching secrets, TLS material, tokens, or credential files. A secret
  never enters this repo in plaintext; if one must be versioned at all it is
  SOPS+age — [`rules/12-security.md`](rules/12-security.md).

When in doubt: ask. REX is a tool that lets an AI agent edit the user's own
documents — the `read`/`write` profile split and the deny gate in `SPEC.md` §8.4
are the whole safety story, and a shortcut taken while building them is a
shortcut taken in the thing that guards every document REX is ever pointed at.
