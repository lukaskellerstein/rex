# REX 20 — the agent window

**Version:** 1.0 · 2026-08-30
**Status:** implemented
**Depends on:** [`13-debugging/SPEC.md`](../13-debugging/SPEC.md) §2 (the CDP
port, `REX_CDP_PORT`, and why every run opens a debugger).

> [!note]
> **This spec adds one environment variable.** With `PW_AGENT=1`, REX marks its
> window and its CDP endpoint as agent-driven, and shows the window without
> taking focus. Everything that *acts* on those marks — the desktop the window
> is born on, the rules that place it, the hooks that refuse to drive the
> reviewer's instance — lives in this machine's `mac-setup` repo, not here.
> REX only tells the truth about who opened it.

---

## 1. Why

**An agent's REX and the reviewer's REX are the same binary, and nothing on the
outside can tell them apart.** Both are started with `npm run dev`. Both default
to port 9334. The process tree above either one can be a shell, a `tmux`, a
Claude Code session, or `launchd` after a reparent — depending on nothing more
than when you look.

Every scheme that guessed ownership from the outside has failed on this
machine, each time in a different launch shape. The last failure is the worst
one, because it inverted: the desktop hooks read "a Playwright MCP server is
attached to port 9334" as "this window is an agent's", and moved the
**reviewer's own REX** to the test desktop while an agent was merely attached
to it. Measured 2026-08-30, reproduced live during the spike for this spec.

The fix is to stop guessing. The instance that knows whether it is an agent's
is the instance itself — so REX carries the fact, in the two places the
desktop can read it, from the first frame of the window's life.

## 2. The contract — `PW_AGENT=1`

`src/main/agentMode.ts` owns the rules as pure functions (no `electron`
import), and `src/main/index.ts` applies them once at startup. `PW_AGENT` takes
the same spellings of *off* as `REX_CDP_PORT` (`off`, `none`, `no`, `false`,
`0`, empty); anything else turns agent mode on.

| Signal | Value | Who reads it |
|:--|:--|:--|
| window title | ends in `[agent]` (a space, then the tag), kept through every title update | the `claude-pw-agent` yabai rule (`title='\[agent\]$'`), which places the window on the `playwright` desktop **at creation** |
| user agent | `pw-agent` appended to `app.userAgentFallback` | the Playwright hooks' ownership gate, via `GET /json/version` on the CDP port |
| showing | `showInactive()` instead of `show()` | macOS — activation is what carries the reviewer's desktop to a new window, so the agent window never activates |

### 2.1 The title

The `BrowserWindow` is created with the tagged title, so the tag is on the
window before it is ever drawn — a rule that fires at `window_created` sees it.
The renderer then sets `document.title`, and Electron would copy it onto the
window untagged; a `page-title-updated` handler re-appends the tag instead.
The append is idempotent: a title already ending in the tag is left alone.

### 2.2 The showing

`showInactive()` maps the window wherever the window manager put it and leaves
focus where it is. `show()` activates the app, and macOS follows an activated
window to its space. The reviewer's REX keeps `show()` — stealing focus on
launch is correct for the app you asked for by hand.

### 2.3 The marker

`app.userAgentFallback` is set before any window exists, so Chromium's
debugger endpoint reports it from the first request:

```text
$ curl -s http://localhost:9444/json/version | grep User-Agent
"User-Agent": "… rex/0.1.0 Chrome/150.… Electron/43.4.1 Safari/537.36 pw-agent"
```

The marker is lowercase on both sides — the hook lowercases what it reads, and
`test/agentMode.spec.ts` pins the constant to its own `toLowerCase()`.

## 3. What REX deliberately does not do

- **REX never calls yabai.** Placement is the machine's job (`mac-setup`,
  `modules/yabai/playwright_space.sh` and the `claude-pw-*` rules). An app
  that moves its own window couples itself to one window manager and breaks
  silently on every other machine.
- **This is not a security boundary.** `PW_AGENT=1` is an honest label, not a
  privilege: a reviewer who sets it by hand gets a window that opens on the
  test desktop and nothing else. The gate that matters — which instance an
  agent may drive — only *reads* the label; refusing to drive an unmarked
  instance stays safe however the label is abused.
- **No new port, no new file, no new state.** The three signals are derived
  from one environment variable at startup and stored nowhere.

## 4. The machine side (informative)

Recorded here because REX is the reference implementation of the app half; the
authority is `mac-setup` — `projects/claude-code.md` § The agent window
contract.

- The `playwright` desktop is permanent: `yabairc` runs `playwright_space.sh`
  on every yabai start, which relabels or recreates it and re-points both
  placement rules. No runtime state survives to be lost.
- The launch wrapper (`.claude/hooks/playwright-launch.sh`) is what sets
  `PW_AGENT=1`, verifies the window was born on that desktop, and refuses to
  launch onto a CDP port that already has a listener.
- Two macOS defaults are load-bearing for "the reviewer's desktop never
  switches": `workspaces-auto-swoosh=false` and
  `AppleSpacesSwitchOnActivate=false` (`modules/macos/defaults.sh`).

## 5. Measured, 2026-08-30 (the spike)

| Question | Result |
|:--|:--|
| Is the window born on the test desktop? | first observation, ~2 s after launch: on the labelled space, unfocused, untiled into no reviewer layout; the visible space never changed |
| Does `Page.bringToFront` over CDP drag the reviewer there? | no — 20 samples at 100 ms across a `bringToFront` + keypress: visible space and front app never moved |
| Does a yabai label survive `yabai --restart-service`? | **no** — but the space itself does (it is macOS's, keyed by uuid). This asymmetry is why the machine script re-adopts instead of creating, and why label-based runtime state kept breaking |
| Is `app.userAgentFallback` visible on `/json/version`? | yes, verbatim |

## 6. Files

| File | Change |
|:--|:--|
| `src/main/agentMode.ts` | new — `isAgentMode`, `windowTitle`, `userAgent`, the two exported constants |
| `src/main/index.ts` | reads `PW_AGENT` once; tagged title, `showInactive()`, `page-title-updated` keeps the tag, marker on `userAgentFallback`, one log line |
| `test/agentMode.spec.ts` | new — the rules under `node --test`, including the regex-match test that pins the tag to the yabai rule |
| `package.json` | `test:agent-mode` |

## 7. Acceptance

- [ ] `npm run test:agent-mode` is green.
- [ ] `PW_AGENT=1 REX_CDP_PORT=9444 npm run dev`: the window's first observed
      space is the `playwright` desktop, the visible space does not change,
      and `curl -s http://localhost:9444/json/version` shows `pw-agent`.
- [ ] `npm run dev` without `PW_AGENT`: title `REX`, no marker, `show()` —
      byte-for-byte the behaviour before this spec.
