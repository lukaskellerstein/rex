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
- **Status**: **not implemented.** `SPEC.md` (1,135 lines, at the repo root) is
  a complete implementation spec and is the authority on everything. The repo
  holds it, a README, tooling markers and this scaffold — no `package.json`, no
  `src/`, no `node_modules`.
- **Milestone 0 is a gate.** The anchor spike (a ~150-line standalone script, no
  Electron, no database, no UI) must pass before the app is built. `SPEC.md` §13.
- **Stack**: TypeScript only — Electron + React + `electron-vite`,
  `better-sqlite3`, `@anthropic-ai/claude-agent-sdk`. A Python runtime is an
  explicit non-goal (`SPEC.md` §12).
- **Three invariants that shape every change** (`SPEC.md` §3): anchors resolve in
  the **renderer** on the live DOM; only the **main** process touches SQLite and
  the SDK; IPC only — **no HTTP server, no broker, no listening port**.
- **Data lives outside the repo**: `~/.rex/rex.db`, so it can never be committed
  by accident.
- **Port 9334** is Electron's remote-debugging endpoint, for the Playwright MCP
  to attach to. It is not an app port. `dex` uses 9333 and `vex` uses 9222/9333.
- **Ported from Vex, not invented**: the Claude Agent SDK adapter comes from
  `~/Projects/Github/lukaskellerstein/vex` (read-only). `SPEC.md` §11 is the
  file-by-file mapping, including what to **drop**.

Full facts → [`rules/01-project-config.md`](rules/01-project-config.md); stack and
conventions → [`rules/10-tech-stack.md`](rules/10-tech-stack.md).

## Standing authorizations — do NOT ask before doing these

These actions are pre-approved. Run them yourself when the situation calls for it.

### Read-only inspection (always safe)

- Reading anything inside this repo, `SPEC.md` included.
- Reading `~/Projects/Github/lukaskellerstein/vex` — the reference implementation
  being ported. **Read-only: never write into vex.**
- Reading `~/Projects/Github/redhat/ProtoBot/docs/` — the test documents
  anchoring is developed against. **Read-only: never write into ProtoBot.**
- `git status`, `git diff`, `git log`, `git show`, `git blame`, `git ls-files`
  in this repo.
- Fetching the Claude Agent SDK docs at `https://code.claude.com/docs/en/agent-sdk`
  — `SPEC.md` §0 requires verifying every SDK symbol against them rather than
  assuming the TypeScript names match the Python ones.
- Inspecting a running REX: `curl -s http://localhost:9334/json/version`.
- `sqlite3 ~/.rex/rex.db` with read-only statements (`SELECT`, `.schema`).

This machine's own `nvim-tools` and `lukas-ps` are pre-approved too, and are
documented once in [`rules/machine-tools.md`](rules/machine-tools.md) — do not
restate them here.

### Pre-approved mutations

- Creating and editing files under `src/`, `test/`, and the build config at the
  repo root (`package.json`, `tsconfig.json`, `electron.vite.config.ts`).
- Installing declared dependencies — the ones `SPEC.md` §3.2 names — and running
  `electron-rebuild` for `better-sqlite3`.
- Building and launching REX locally, including with
  `--remote-debugging-port=9334`.
- Driving the running app with the `mcp__playwright-rex__browser_*` tools, and
  closing the browser afterwards.
- Deleting and recreating `~/.rex/rex.db` **during development**, when a schema
  change requires it. It holds only local development threads at this stage; say
  in the report that you did it.

### Requires confirmation — always ask first

- Adding any dependency `SPEC.md` §3.2 does not name — and never one from the
  §12 forbidden list (NATS or any broker, any HTTP server framework, `nats.ws`,
  any Python runtime).
- Building anything from a milestone later than the one in progress, or any
  feature `SPEC.md` §12 lists as a non-goal.
- Editing `SPEC.md` itself. It is the authority; changing it changes the contract
  rather than the code, so propose the edit and say what forced it.
- Running REX's own **`write`-profile agent / Apply** against any real document.
  That is an agent editing a file on this machine — `SPEC.md` §8.7 step 5
  requires a diff be shown and accepted first, and that requirement applies to
  you as much as to the app.
- Anything at all that writes into `vex` or `ProtoBot`.
- `git push`, `git push --force`, branch deletes — **never commit unless the user
  explicitly asks**.
- Anything touching secrets, TLS material, tokens, or credential files. A secret
  never enters this repo in plaintext; if one must be versioned at all it is
  SOPS+age — [`rules/12-security.md`](rules/12-security.md).

When in doubt: ask. REX is a tool that lets an AI agent edit the user's own
documents — the `read`/`write` profile split and the deny gate in `SPEC.md` §8.4
are the whole safety story, and a shortcut taken while building them is a
shortcut taken in the thing that guards every document REX is ever pointed at.
