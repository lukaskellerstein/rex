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
and deferred, so it must be loaded before it can be called),
[`rules/worktree.md`](rules/worktree.md) (where you may change files: your
worktree under `.worktrees/<name>`, never the main checkout).

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
- **Status**: **built through spec 50** — macOS, completely, 2026-09-08.
  **REX is a macOS app on Apple silicon.** Windows and Linux were built,
  installed and validated in VMs on 2026-09-07 and removed on 2026-09-08:
  REX claimed three operating systems while two could not run every agent in
  every mode, and one platform that is true beats three with footnotes. What
  those builds measured is in spec 50 §5 — read it before anyone proposes
  bringing them back, especially "there is no cross-build".
  **All four agent SDKs are built, and every one offers ASK and ACT.** There is
  no platform arm left in any adapter. `ALL_SDKS` and `ADAPTERS` are the same
  set and the agent control has its four rows.
  The specs are the authority. `SPEC.md` in these files means
  `docs/my-specs/01-initial/SPEC.md`; every later decision is a numbered spec
  under `docs/my-specs/NN-*/SPEC.md`, and the README's spec table indexes them.
  In order: 42 the agent library, 43 the local gateway, 44 Codex, 45 watching
  the gateway, 46 the built-in gateway, 47 OpenCode, 48 Deep Agents, 49
  releases, 50 macOS.
  - **Spec 46 — the built-in gateway** — is built through milestone 4: REX's own
    LiteLLM on `127.0.0.1:24334`, six providers with discovery, the Settings
    screen, the encrypted key store, the traffic log, §15's migration (which has
    run against `~/.rex/rex.db`), and packaging. `npm run bundle:python` stages
    a relocatable CPython with both Python packages; `npm run package` makes the
    DMG. Installing that DMG is what found the bug it exists to find:
    `local-gateway/catalogue.json` was never staged, so a packaged REX listed
    **no providers**, silently. It is in `electron-builder.yml`'s
    `extraResources` now, with a test guarding it.
  - **Spec 47 — OpenCode** — is built, ASK and ACT. It is the one adapter that
    owns a process beyond its pipe: `opencode serve`, leased per run. §7.4's
    boundary is a **seatbelt** around that server, so a shell command aimed
    outside `RunRequest.writable` gets `operation not permitted` — and ASK runs
    inside it too. Two measurements bite hardest: a `write` tool call asks
    permission under the name **`edit`**, so a ruleset denying `write` stops
    nothing; and OpenCode **echoes the reviewer's own prompt back as a `text`
    part**, so without a `messageID → role` map the question is stored as the
    answer and the run looks entirely successful.
  - **Spec 48 — Deep Agents** — is built, ASK and ACT. It is odd in the opposite
    direction: a LangGraph graph **inside the service's own interpreter** — no
    child, no CLI, no sandbox — so spec 42 §3.4's process boundary is the only
    one there is. Its ACT boundary is the SDK's rules **plus a second check**,
    because the SDK's matcher is textual: a symlink inside a writable directory
    matched `<writable>/**` and the write reached the real file. The second
    check resolves both sides with `Path.resolve()`.
    **Spec 50 fixed its ASK**, which could not read the document at all: REX's
    prompt names the working copy by absolute path, the copy lives outside
    `cwd`, and the backend was `virtual_mode=True`, which re-roots an absolute
    path inside itself. `RunRequest.readable` now carries those folders and
    `for_ask()` speaks real paths. Two things to carry from it: **42 green
    end-to-end checks missed it**, because the harness wrote its own prompt
    instead of REX's; and **`FilesystemBackend`'s own methods ignore the
    permission rules**, so a test that calls the backend directly measures
    nothing.
  - **Spec 49 — releases** — builds the DMG on `macos-latest` for every push to
    `main` and publishes a Release tagged `v<version>-<run>`. Pull requests run
    nothing. electron-builder must be told `--publish never` or a push dies
    after the build on a missing token, which is why `npm run package` exists.
  - Signing and notarisation are deliberately unconfigured (`identity: null`);
    both need an Apple ID and are their own job.
- **Milestone 0 passed.** `test/anchor.spec.ts` is the anchor spike, kept as
  the regression net for the one component that fails silently.
- **Stack**: TypeScript for the app — Electron + React + `electron-vite`,
  `better-sqlite3` — and **two Python packages**, which are siblings and never
  import each other:
  - `agent-runner/` (spec 42; called `agent-gateway/` until spec 46 §9 renamed
    it on 2026-09-06) — every agent SDK, run as one child of the main process
    and spoken to over stdin and stdout, one JSON line per message. No port.
    **All four adapters since 2026-09-08**: `claude`, `codex`, `opencode` and
    `deep_agents`. Two are odd in opposite directions. OpenCode has no Python
    SDK, so `adapters/opencode/` carries REX's own `httpx` client and starts an
    `opencode serve` child of its own — the ONE process this package owns beyond
    a pipe, leased per run rather than cached. Deep Agents has no child at all:
    it is a LangGraph graph in this interpreter, so the whole LangChain stack
    lives in `adapters/deep_agents/` and there is no process between the model
    client and the pipe. `test_boundary.py` pins `httpx` to the first directory
    and `deepagents`/`langchain*`/`langgraph` to the second, by the same rule
    that pins each SDK to its own adapter.
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
