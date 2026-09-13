---
description: "Step 3: Implement — coding rules and this project's layout"
---

# Step 3: Implement

Write clean code from the start. Follow these rules during implementation:

- Every edit lands in your own worktree (`.worktrees/<name>`, branch `<name>`),
  never in the main checkout or another worktree — [`worktree.md`](worktree.md)
- Do NOT commit via `git` unless explicitly instructed by the user
- When creating diagrams or graphs, use `mermaid`
- Write clean code from the start — don't plan to "clean it up later"
- Refactor continuously — improve code structure immediately when you see issues
- Remove dead code — delete unused functions, variables, imports, and commented code
- Before changing any signature, renaming, or deleting something shared, find
  every caller with `findReferences` where the `LSP` tool is available — grep
  misses the ones spelled differently and finds ones that are not calls.
  [`lsp.md`](lsp.md)
- After writing code: review comments, clean up imports, check for side effects
- **A large or architectural change gets a new numbered spec** in
  `docs/my-specs/` before any code
- **Where the spec is silent, prefer the simplest thing that works.** Do not add
  features

## Where code belongs

Each area's rules come from `SPEC.md` §3. Read it before moving anything across
a boundary.

| Area | What it is |
|:--|:--|
| `src/main/` | the only privileged process: SQLite, the filesystem, the pipe to the agent library, the gate |
| `src/renderer/` | untrusted document content, the shadow-root overlay, the anchor resolver. No database, no credentials, and no mutation of the document under review |
| `src/shared/` | the contract between the two. Imports nothing from `main/` or `renderer/`. `agent-protocol.ts` is generated — never edit it by hand |
| `src/preload/` | the `contextBridge` surface, and nothing else |
| `agent-runner/` | every agent SDK, one adapter each |
| `local-gateway/` | REX's own LiteLLM |
