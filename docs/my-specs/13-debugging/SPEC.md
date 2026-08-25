# REX 13 — debugging a REX you started yourself

**Version:** 1.0 · 2026-08-25
**Status:** proposed.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §3 (the two
processes and invariant I3) and
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §6.2 (the per-thread
debug report, which this spec generalises without replacing).

> [!warning]
> **A debugging port is an open door, and this spec opens one by default.**
> Chromium's remote-debugging endpoint gives whoever reaches it full control of
> the renderer: read the DOM, run script, read anything the page can read. It is
> bound to loopback and REX is a desktop app on one person's machine, so the
> exposure is the same as `dex` and `vex` already accept — but it is a *default*
> now, not a flag someone typed, and §2.4 is the escape hatch that has to exist
> because of it. This is not invariant I3 being broken: I3 forbids REX from
> *serving* its own function over a port, and the debugger serves none of REX's
> function.

---

## 1. Why

**REX can fail in a way that produces no output anywhere.** Measured on
2026-08-25: a reviewer clicked a document in the explorer, the document pane
stayed empty, and there was nothing to look at — `npm run dev` printed no error,
the window showed no notice, and the renderer's console was unreachable because
the window was started without a debugger.

> [!note]
> **What that failure turned out to be, once this spec's own tooling existed.**
> Nothing was broken. `yabai` tiles every new window, and on a 3440px screen it
> gave REX an 857px column instead of the 1400 `createWindow` asks for. The
> explorer keeps 272px and the comments panel keeps 384px — both fixed — and
> only the middle flexes, so **the document pane was 164px wide**. The document
> had rendered: right title, 102 nodes, `surface ready`.
>
> Every instinct was wrong about it, and each wrong instinct is one this spec
> now answers: it was not the renderer (§3.2 would have shown a console error),
> not main (§3.3 would have shown `doc:open` throwing), and not the anchor
> resolver. It was **geometry**, which is why §4.2's VIEW block carries the
> window size and the pane's box, and why the report says the sentence out loud
> rather than printing two numbers to be compared.

Three separate holes made one dead end:

### 1.1 The manual run has no debugger

`rules/06-testing.md` tells an agent to launch REX with
`--remote-debugging-port=9334` and attach the Playwright MCP to it. That is the
agent's own path and it works. **A REX the reviewer started with `npm run dev`
has no such port**, so the tooling that exists for exactly this moment cannot be
pointed at the window that is actually broken. The only fix on offer was "quit
it and let the agent start its own" — which throws away the state that
reproduced the bug.

### 1.2 Nothing the renderer says reaches the terminal

Electron does not forward renderer console output to the process that launched
it. Every `console.error` React throws, every rejected `docOpen`, every
`did-fail-load` on the document frame lands in a DevTools window nobody has
open. The terminal running `npm run dev` is silent *because* the renderer
failed, which is the exact inversion of what a log is for.

### 1.3 The one report REX can produce is about a thread

Spec 08 §6.2's report is good and stays. But it needs a `threadId`, and the
failure above happened before any thread existed. **There was no way to ask REX
what it thought its own state was** — which document it believed it had opened,
what the frame contained, what had gone wrong most recently.

The shape of the fix follows from 1.3: what the reviewer needs is not a panel to
read, it is **something to paste to whoever is fixing it**, exactly as §6.2
already decided. This spec adds the second report — the one about the *app* —
and the port and the log that make the pasted text actionable.

---

## 2. The port

### 2.1 REX opens one by default

`src/main/cdp.ts` decides the port before `app.whenReady()`, and
`app.commandLine.appendSwitch("remote-debugging-port", …)` opens it. **9334** is
the default, unchanged from `.mcp.json` — the whole point is that the MCP server
already configured in this repo attaches to a manually-started REX with no
argument anywhere.

Precedence, highest first:

| Source | Wins because |
|:--|:--|
| `--remote-debugging-port=N` in `process.argv` | the agent's own launch path (`rules/06-testing.md`) must keep behaving exactly as it does today. If it is already there, REX appends nothing. |
| `REX_CDP_PORT=N` in the environment | the one way to move the port without editing a file — a second REX, or a machine where 9334 is taken |
| nothing | 9334 |

`REX_CDP_PORT=off` (also `none`, `no`, `0`, or empty) opens no port at all.

`chooseCdpPort(argv, env)` is a **pure function** and is where every one of those
rules lives, so `test/debug.spec.ts` can state them without an Electron around
it — the same reason `debug.ts` takes `appVersion` as an argument.

### 2.2 REX checks the port actually opened

Appending the switch is a request, not a result. A second REX started while the
first holds 9334 gets `Cannot start http server for devtools` on Chromium's own
stderr and then **runs perfectly normally with no debugger** — the failure mode
this spec exists to remove, reintroduced one level down.

So after `ready`, REX fetches `http://127.0.0.1:<port>/json/version` once and
keeps the answer. The report prints what it found, never what it asked for:

```text
  cdp        http://localhost:9334 · listening · Chrome/140.0.0.0
  cdp        http://localhost:9334 · NOT LISTENING — another REX probably has it
```

### 2.3 Two ways to run REX, and they do not fight

Unchanged: an agent that needs a REX follows `rules/06-testing.md` — probe
`http://localhost:9334/json/version` first, and launch one only if nothing
answers. What changes is that the probe now succeeds against the reviewer's own
`npm run dev`, so the agent **attaches to the window that has the bug** instead
of starting a clean one beside it.

`package.json` gains nothing. The port is chosen in main, so `npm run dev`,
`npm run start` and a packaged build all behave the same, and there is no shell
variable to remember.

### 2.4 Turning it off

`REX_CDP_PORT=off npm run dev`. Named in `CLAUDE.md` and in this section because
a default-open debugger with no documented way to close it is a worse trade than
no default at all.

---

## 3. The log

### 3.1 One ring, in main

`src/main/log.ts` — 300 entries, oldest dropped, `{ at, level, source, message }`
per entry. Main is the only process that can hold it: it already sees the
renderer's console (§3.2), it outlives a renderer reload, and it is the process
with a terminal attached.

Every entry goes three places:

1. **the ring**, for §4's report;
2. **`~/.rex/rex.log`**, truncated at the start of a run, capped at 2 MB — beside
   `rex.db` and outside every repository, so a Claude Code instance with no CDP
   at all can still read what happened;
3. **stderr**, `warn` and `error` only, prefixed `[rex]` — which is what finally
   puts something in the terminal that `npm run dev` is running in (§1.2).

### 3.2 What gets recorded

Main sees more than the renderer does, so the renderer is asked for almost
nothing:

| Source | Hook | Catches |
|:--|:--|:--|
| `renderer` / `guest` | `app.on("web-contents-created")` → `console-message` | every `console.warn` / `console.error` in the overlay **and** inside a `<webview>` guest. Electron 43's signature is `(details: Event<WebContentsConsoleMessageEventParams>)`; `info` and `debug` are dropped, or a React render fills the ring |
| `load` | `did-fail-load`, `preload-error` | a preload that did not load, a frame that did not — the document pane's own failure |
| `crash` | `render-process-gone`, `unresponsive` | the renderer dying, which is otherwise a blank window and nothing else |
| `ipc` | §3.3's wrapper | a command that threw, with its channel name |
| `main` | `uncaughtException`, `unhandledRejection` | everything else |

### 3.3 A command that throws says so

`registerIpc` registers nineteen handlers with `ipcMain.handle`. Each becomes
`handle(...)` — one wrapper at the top of `ipc.ts`, which records
`channel + message` and **rethrows unchanged**, so `guard` still shows its notice and
nothing about the existing behaviour moves. `doc:open` throwing
`REX renders Markdown, HTML, PDF, DOCX and PPTX…` is the line §1's failure would
have produced, and there was no place for it to appear.

### 3.4 What is not recorded

No document text, no comment text, no agent output, no message content. The
report is pasted into a chat window with a stranger; §6.2's per-thread report
already carries the reviewer's own words *by design and by their choice*, and
this one is offered without one. Paths are `~`-shortened by the same `tilde()`
`debug.ts` uses.

---

## 4. The report

### 4.1 A button in the bar

`TopBar.tsx`, **last in the bar, past `Ask all`**: an icon button,
`Copy debug report`, and the key **`B`** — free, mnemonic, and bound beside `P`,
`N`, `D` and `G` in `App.tsx`'s switch. `⇧A` is the only other action bound to a
letter, and it spends money; this one writes a string.

Past the primary action rather than before it. Everything to its left acts on
the document under review; this one acts on REX, and the end of the row is the
one place a control that belongs to no group can sit without joining one.

It is in the top bar and not in the trace sheet because it is about the **app**.
Spec 08 §6.2's report is reached from the comment it is about, and that is still
where it is reached from.

### 4.2 What it says

Plain text, `KEY  value`, exactly the format §6.2 chose and for the same
reason — a human reads it before anything else does. Sections in the order the
reader needs them:

```text
REX debug · 2026-08-25T14:02:11.904Z

ATTACH
  cdp        http://localhost:9334 · listening · Chrome/140.0.0.0
  check      curl -s http://localhost:9334/json/version
  mcp        .mcp.json → playwright-rex is already pointed at this endpoint
  log        ~/.rex/rex.log · 41 lines this run

APP
  pid        16273 · dev (electron-vite) · up 12.4m
  database   ~/.rex/rex.db
  userdata   ~/Library/Application Support/rex

VIEW
  window     857×1365
  workspace  ~/Projects/Github/lukaskellerstein/my-ecommerce
  document   ~/Projects/…/my-ecommerce/README.md · file
             html · 30.2 KB · surface ready · frame 102 nodes · pane 164×1320
             id 908374c1-… · unchanged since the anchors
  ⚠ the document pane is only 164px wide. The document IS loaded —
    the window is too narrow to show it. Widen the REX window; on a tiling
    window manager, give it a wider tile or float it.
  centre     document · sidebar comments · zoom 100%
  comments   14 · 3 unanswered · none open · 0 in the panel
  notice     (none)

RECENT (6)
  14:01:58  error  ipc     doc:open — ENOENT: no such file or directory, open '…'
  14:01:58  error  render  Uncaught TypeError: …
  …

VERSIONS
  rex 0.1.0 · electron 43.4.1 · chrome 140.0.0.0 · node 22.22.0 · agent-sdk 0.3.237 · darwin arm64
```

`ATTACH` is first and is the part that does the work: it turns "REX is broken"
into an instruction a fresh Claude Code session can follow without asking
anything.

`VIEW` is the renderer's answer and nothing else can produce it — which tab is
open, how big the window is, and what the document frame did are facts only the
overlay holds. It travels as one `ViewState` argument on the invoke.

Two failures are **stated rather than left to be inferred**, because a reviewer
reading this believes no document is open and every other line disagrees:

| What the fields say | The line the report adds |
|:--|:--|
| a pane narrower than 400px | ⚠ the document IS loaded; the window is too narrow |
| `surface NOT ready` beside a non-zero size | main rendered the HTML and the frame never came up |

400px is the smallest measure the Markdown stylesheet's body type survives.
Below it the pane is a strip, not a page — which is what §1's note measured.

### 4.3 Where it goes

The clipboard, from main, exactly as `debug:copy` does — Electron owns the
clipboard, and a copy that needs the renderer focused fails in the case where
the renderer is the thing that is wrong. A notice confirms it: `Debug report
copied — paste it to Claude Code.` The text is returned as well, so a test can
read it.

Channel: `debug:snapshot`. Not an argument on `debug:copy` — that one names a
thread and always will, and a channel that means two things depending on a null
is the kind of economy that costs an afternoon later.

---

## 5. What this adds

| | |
|:--|:--|
| Dependencies | **none** |
| IPC channels | one — `debug:snapshot` |
| Tables | none |
| Shapes | `ViewState` (window size and the pane's box included), `LogEntry`, `CdpChoice`, `CdpStatus`, `AppFacts` |
| New files | `main/cdp.ts`, `main/log.ts`, `main/diagnostics.ts` |
| Changed | `main/index.ts`, `main/ipc.ts` (`ipcMain.handle` → `handle`), `main/debug.ts` (+`appReport`), `shared/channels.ts`, `shared/types.ts`, `preload/index.ts`, `overlay/App.tsx`, `overlay/TopBar.tsx`, `overlay/Icons.tsx`, `overlay/overlay.css` |
| Docs | `CLAUDE.md` § Standing authorizations, `rules/06-testing.md` § 4b |

Invariant I1 is untouched. I2 is untouched — the ring lives in main, and the
renderer hands over view state, never reads a log. I3 is argued in the warning
at the top: the debugger is Chromium's, it serves none of REX's own function,
and REX still has no server of its own.

---

## 6. Acceptance

- [ ] `npm run dev` with no arguments: `curl -s http://localhost:9334/json/version`
      answers, and `mcp__playwright-rex__browser_snapshot` attaches to that
      window.
- [ ] Launching with `--remote-debugging-port=9334` explicitly still works and
      REX appends nothing — the agent's path from `rules/06-testing.md` is
      unchanged.
- [ ] `REX_CDP_PORT=9444 npm run dev` listens on 9444 and not on 9334.
- [ ] `REX_CDP_PORT=off npm run dev` listens on neither, and the report says so
      rather than claiming 9334.
- [ ] A second REX started while the first holds the port reports
      **NOT LISTENING**, and does not claim a port it did not get.
- [ ] A `console.error` in the overlay appears in the `npm run dev` terminal
      prefixed `[rex]`, in `~/.rex/rex.log`, and in the report's `RECENT`.
- [ ] An IPC command that throws is recorded with its channel name, **and the
      renderer still shows the same notice it showed before.**
- [ ] The button copies the report; pasting it gives a `Chrome/…` version, the
      open document's path, the sidebar tab, and the last errors.
- [ ] `B` copies it too, and does nothing while the caret is in a text field.
- [ ] The report holds no document text, no comment text and no agent output,
      and every path outside `$HOME` — there are none — would be shown as
      written.
- [ ] **A document squeezed into a narrow window is named as such**, with the
      window's size, the pane's box, and the sentence saying the document is
      loaded. This is §1's own failure, and it is the one the report exists for.
- [ ] `npm run test:debug` covers `chooseCdpPort`, the ring's cap, and
      `appReport`'s sections.
- [ ] `npx tsc --noEmit` is clean and `nvim-tools --json --all` adds no finding.

---

## 7. What this spec does NOT fix

**The layout that caused §1.** REX gives the document pane every pixel the two
side panels do not want, and both want a fixed number: 272 and 384. In an 857px
window that leaves 164px for the thing the app is *for*, and the first casualty
of a narrow window is the document.

That is a real bug and it is **spec 08's shell**, not this spec's. Making it
right is a design decision — collapse the comments panel below some width, or
floor the document pane and let a panel go off-screen — and it belongs in a spec
of its own with a screen to look at. This spec's contribution is that the
failure now names itself instead of looking like a document that would not load.
