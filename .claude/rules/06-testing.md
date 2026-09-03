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

**UI changes** — drive a REX window with Playwright. This is an Electron app,
so the MCP server **attaches** to the app over CDP rather than launching its
own browser:

1. Check who holds the port: `curl -s http://localhost:9334/json/version`.
   `pw-agent` in the `User-Agent` means an agent instance — attach to it. No
   marker means the instance is Lukas's own: the PreToolUse gate denies every
   `browser_*` call on it, and step 2 is how you get your own.
2. If nothing answers, start your own instance **only** through
   `.claude/hooks/playwright-launch.sh npm run dev` — never bare. The wrapper
   sets `PW_AGENT=1`, so the window is born on the `playwright` desktop with
   the title `REX [agent]` (spec 20) and never appears on Lukas's screen.
3. Drive it via `mcp__playwright-rex__browser_navigate` and the other
   `browser_*` tools, and verify the change is visible **and** functional — take
   a snapshot, don't just assert the page loaded.
4. **Close the browser when done.**

> [!important]
> **A 9334 answer without `pw-agent` is Lukas's own REX**, started with
> `npm run dev` — spec 13 §2.1 gives every run the port. Do not quit it,
> restart it, or drive it. The gate denies `browser_*` calls on it and the
> wrapper refuses a busy port; to proceed, either ask Lukas (the denial
> message names the consent command) or test on a second instance's own port —
> `REX_CDP_PORT=9444 .claude/hooks/playwright-launch.sh npm run dev` — knowing
> the MCP is pinned to 9334, so a second instance is reachable only by raw CDP.
>
> Two things follow from spec 13 and are worth knowing before debugging blind:
>
> - **`~/.rex/rex.log`** holds this run's errors — renderer console included —
>   and can be read with no debugger at all. Start there.
> - **The reviewer can hand you the whole state**: the `B` key, or the bug
>   button in the top bar, copies a report naming the port, the open document,
>   the frame's state and the recent errors. If they are reporting a bug and did
>   not paste one, ask for it before guessing.
>
> A second REX cannot have the port — Chromium fails to bind it and runs on
> with no debugger, silently. That is why the wrapper refuses a busy port
> instead of launching into it.

> An agent window is born on the `playwright` desktop (spec 20) and is closed
> automatically at session end by `.claude/hooks/`. That is a safety net, not a
> substitute for closing it yourself when the test is finished.

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
