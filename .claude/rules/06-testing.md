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

When the change belongs to a spec, use that spec's acceptance criteria as the
checklist.

## 4b. Test

**UI changes** — drive a REX window with Playwright. The MCP server
`playwright-rex` attaches to the app over CDP on 9334:

1. Check who holds the port: `curl -s http://localhost:9334/json/version`.
   `pw-agent` in the `User-Agent` means an agent instance — attach to it. No
   marker means the instance is the user's own: do not quit it, restart it or
   drive it.
2. If nothing answers, start your own instance **only** through
   `.claude/hooks/playwright-launch.sh npm run dev` — never bare.
3. Drive it via `mcp__playwright-rex__browser_navigate` and the other
   `browser_*` tools, and verify the change is visible **and** functional — take
   a snapshot, don't just assert the page loaded.
4. **Close the browser when done.**

If the user's REX holds 9334, ask, or launch a second instance with
`REX_CDP_PORT=9444 .claude/hooks/playwright-launch.sh npm run dev` and reach it
by raw CDP — the MCP is pinned to 9334. Before any script attaches to a CDP
port, run `python3 .claude/hooks/pw.py owns-port <port>`: exit 1 means the
instance is the user's.

To debug, read `~/.rex/rex.log` first. The user's `B` key copies a debug report;
ask for it when a bug report comes without one.

**Anchoring changes** — run `npm run test:anchor`, then check anchors by hand on
the sample documents in `documentation-sample` (`one/sample-document.md`,
`two/sample-report.md`, and the `.docx` beside each). A passage that moved must
report `moved` or `orphaned`. **An anchor that reports `ok` on the wrong place
is a failure.**

**Agent changes** — an ASK must not write. After a read session, run this in
the document's repository:

```bash
git status --porcelain
```

Anything changed is a bug in the gate. Surface it — `SPEC.md` §8.4.

**Project test suite** — run the suites that cover what you touched:
`npm run test:<name>`. A change on either side of the pipe runs
`npm run test:library`; a change to the gateway runs `npm run test:gateway`.

**Every code change** — repo-wide lint / format / type check:

```bash
nvim-tools --json --all
```

Your change must not add findings, measured against the baseline you took in the
Understand step. How to read the output (including `gated-off`), and why this
never replaces the project's own suite: [`machine-tools.md`](machine-tools.md).

**Non-testable changes** (docs, config, IaC only): explicitly state why no
runtime test is needed.

## 4c. Fix and repeat

If a test fails: fix the issue, then retest. Repeat until all DoD items pass. If
you hit a problem you repeatedly cannot resolve, ask the user for help rather
than reporting partial success.

## 4d. Never report completion without testing

If you write code and stop without verifying it works, you have failed. Testing
is YOUR responsibility — the user should never need to ask you to test.
