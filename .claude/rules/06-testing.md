---
description: "Step 4: Testing — define DoD, test, fix and repeat until passing"
---

# Step 4: Testing

**Every code change must be tested before reporting completion. No exceptions.**

## 4a. Define your Definition of Done

Before testing, **write out your DoD checklist in the conversation** so the user
can see what you intend to verify. Example:

> **Definition of Done for this task:**
>
> - [ ] The new button appears on the dashboard page
> - [ ] Clicking the button opens the modal
> - [ ] The modal displays the correct data
> - [ ] Browser closed after testing

`SPEC.md` §13 already gives a DoD for each milestone — when the change belongs to
a milestone, use its acceptance criteria as the checklist rather than inventing
one. They are written as checks, not opinions.

## 4b. Test

**UI changes** — drive the running REX window with Playwright. This is an
Electron app, so the MCP server **attaches** to the app over CDP rather than
launching its own browser:

1. Confirm the app is up and exposing its debugger:
   `curl -s http://localhost:9334/json/version`. If it is not, launch REX with
   `--remote-debugging-port=9334` and wait for that endpoint to answer.
2. Drive it via `mcp__playwright-rex__browser_navigate` and the other
   `browser_*` tools, and verify the change is visible **and** functional — take
   a snapshot, don't just assert the page loaded.
3. **Close the browser when done.**

> The browser opens on its own desktop/space and is closed automatically at
> session end by `.claude/hooks/`. That is a safety net, not a substitute for
> closing it yourself when the test is finished.

**Anchoring changes** — anchoring is the one component that **fails silently**,
so a green run proves nothing unless it includes the hostile documents:

- `~/Projects/Github/redhat/ProtoBot/docs/review/2026-08-20-architecture-explained.html`
  — 920 lines, only 4 `id` attributes, 4 inline SVG diagrams
- `~/Projects/Github/redhat/ProtoBot/docs/architecture/components.md` — 1,063 lines

Both are read-only. The acceptance bar from `SPEC.md` §13 Milestone 0: every
anchor must report `ok`, `moved` or `orphaned`, and each classification must be
correct by inspection. **A reworded passage must be `moved` or `orphaned` — never
silently resolved to the wrong place.** A wrong-place resolution that reports
`ok` is the failure this whole test exists to catch.

**Agent changes** — the `read` profile carries a hard guarantee that it cannot
write. Verify it the way `SPEC.md` §8.4 specifies, as a backstop to the gate:

```bash
git status --porcelain          # in the document's repository, after a read session
```

Anything changed is a bug in the gate. Surface it, do not merely log it.
`SPEC.md` §13 Milestone 3 also requires a deliberate attempt to make the agent
write a file, and that attempt must be denied.

**Project test suite** — there is **no suite yet**; `package.json` does not
exist. Milestone 0 is a standalone script (`test/anchor.spec.ts`). Once a test
command exists, run it before anything else and replace this paragraph with it.

**Every code change** — repo-wide lint / format / type check:

```bash
nvim-tools --json --all
```

Your change must not add findings, measured against the baseline you took in the
Understand step. How to read the output (including `gated-off`), and why this
never replaces the project's own suite: [`machine-tools.md`](machine-tools.md).

Expect `gated-off` for the type checker until `tsconfig.json` exists — that is
the repo missing a marker, not the CLI failing. See
[`09-code-quality.md`](09-code-quality.md).

**Non-testable changes** (docs, config, IaC only): explicitly state why no
runtime test is needed.

## 4c. Fix and repeat

If a test fails: fix the issue, then retest. Repeat until all DoD items pass. If
you hit a problem you repeatedly cannot resolve, ask the user for help rather
than reporting partial success.

## 4d. Never report completion without testing

If you write code and stop without verifying it works, you have failed. Testing
is YOUR responsibility — the user should never need to ask you to test.
