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
(architecture, commands, ports, external paths),
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
work.** "The code looks right" is not testing — and for the anchor resolver it is
actively misleading, because a wrong anchor still reports `ok`. Verification is
YOUR responsibility — the user should never need to ask you to test.

**Trivial changes** (a typo, a comment, a one-line doc edit, renaming a local
variable): skip step 2. State what you'll do and proceed.

## REX at a glance

A desktop app for commenting on documents and discussing each comment with an AI
agent. **macOS on Apple silicon only.**

Where to read, when you need it:

| What | Where |
|:--|:--|
| What REX does, how to install and run it | [`README.md`](../README.md) |
| **The specs — the authority on what REX is** | [`docs/my-specs/`](../docs/my-specs/). `SPEC.md` in these files means `docs/my-specs/01-initial/SPEC.md`; every later decision is a numbered spec, one folder each, in build order |
| Architecture and the three invariants | `SPEC.md` §3, and the README's *How it works* |
| What REX will and will not do to each file format | [`docs/FORMATS.md`](../docs/FORMATS.md) |
| Stack, commands, ports, external paths | [`rules/01-project-config.md`](rules/01-project-config.md), [`rules/10-tech-stack.md`](rules/10-tech-stack.md) |

## Standing authorizations — do NOT ask before doing these

These actions are pre-approved. Run them yourself when the situation calls for it.

### Read-only inspection (always safe)

- Reading anything inside this repo.
- Reading the external paths in [`rules/01-project-config.md`](rules/01-project-config.md).
  **All of them are read-only: never write into `vex` or `documentation-sample`.**
- `git status`, `git diff`, `git log`, `git show`, `git blame`, `git ls-files`
  in this repo.
- Fetching the docs of an SDK or package REX uses — the Claude Agent SDK docs at
  `https://code.claude.com/docs/en/agent-sdk`, `https://pypi.org/pypi/<name>/json`,
  the LangChain docs. Verify every SDK symbol there before using it.
- Inspecting a running REX: `curl -s http://localhost:9334/json/version`.
- `sqlite3 ~/.rex/rex.db` with read-only statements (`SELECT`, `.schema`).
- Reading `~/.rex/rex.log`.

This machine's own `nvim-tools` and `lukas-ps` are pre-approved too, and are
documented once in [`rules/machine-tools.md`](rules/machine-tools.md) — do not
restate them here.

### Pre-approved mutations

- Creating and editing files under `src/`, `test/`, `scripts/`, `agent-runner/`,
  `local-gateway/`, and the build config at the repo root.
- Installing dependencies a spec names: `npm` for the app, `uv add` / `uv sync`
  in the two Python packages (**never `pip`**), and `npm run rebuild` for
  `better-sqlite3`.
- `uv run pytest` and `uv run python -m agent_runner.protocol --schema`.
- Building and launching REX locally — check `curl -s http://localhost:9334/json/version`
  first, because an answering endpoint is probably the reviewer's own REX.
- Driving the running app with the `mcp__playwright-rex__browser_*` tools, and
  closing the browser afterwards.
- Deleting and recreating `~/.rex/rex.db` **during development**, when a schema
  change requires it. Say in the report that you did it.

### Requires confirmation — always ask first

- Adding a dependency no spec names, or anything `SPEC.md` §12 forbids.
- Building a feature `SPEC.md` §12 lists as a non-goal.
- Editing an existing spec's contract. Propose the edit and say what forced it.
- Running REX's own ACT (`write` profile) against any real document.
- Anything at all that writes into `vex` or `documentation-sample`.
- `git push`, `git push --force`, branch deletes — **never commit unless the user
  explicitly asks**.
- Anything touching secrets, TLS material, tokens, or credential files. A secret
  never enters this repo in plaintext; if one must be versioned at all it is
  SOPS+age — [`rules/12-security.md`](rules/12-security.md).

When in doubt: ask. REX lets an AI agent edit the user's own documents, and a
shortcut taken while building its safety is a shortcut taken in the thing that
guards every document REX is ever pointed at.
