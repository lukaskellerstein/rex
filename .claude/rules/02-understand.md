---
description: "Step 1: Understand — read code, ask questions, identify gaps before any implementation"
---

# Step 1: Understand

- Know where you stand first: `pwd` and `git branch --show-current`. In the
  main checkout you may read and answer, not edit — [`worktree.md`](worktree.md).
- Read relevant code and identify impacted areas
- Baseline the repo's existing problems with `nvim-tools --json --all`, so
  findings you introduce stay distinguishable from ones that were already there.
  For performance or RAM questions, `lukas-ps --json [name]` measures the real
  process tree. Both: [`machine-tools.md`](machine-tools.md).
- **If `LSP` is in your tool list, load it and use it** for every question about
  a symbol — where defined, who implements, who calls. It is deferred, so
  `ToolSearch("select:LSP")` comes first or it cannot be called at all. Absent
  from the list means this repo did not opt in: use `grep`.
  [`lsp.md`](lsp.md).
- Ask clarifying questions if requirements are ambiguous
- Identify gaps in the current design and opportunities for improvement
- Understand the requirement completely before proceeding
- **The specs are the authority on what REX is.** `SPEC.md` in these files is
  `docs/my-specs/01-initial/SPEC.md`; every later decision is a numbered spec
  beside it, and a later spec says what it changes in an earlier one. Read the
  relevant section before designing anything — they are complete implementation
  specs, not sketches, and spec 01 §12 lists what was deliberately rejected. If
  your plan contradicts a spec, say so explicitly rather than quietly diverging.
- **For bug reports**: reproduce the issue first (launch the app, open
  `~/Projects/Github/lukaskellerstein/documentation-sample`, and drive it to the
  failing state) to confirm the problem before attempting a fix. Anchoring bugs
  reproduce against `one/sample-document.md` and `two/sample-report.md` there —
  [`06-testing.md`](06-testing.md) lists what makes each of them hard.
