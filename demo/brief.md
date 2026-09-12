# Demo brief

Start here: in this worktree run `/demo-video-plugin:demo-setup` once, then
`/demo-video-plugin:demo-video`. It needs demo-video-plugin **1.1.0 or later** (OBS capture
and the Final Cut Pro export). Everything below is a starting position, not a decision:
confirm audience, length and the section list at GATE 1.

## Audience

Engineers and tech leads who review documents — specs, READMEs, reports — with an AI
assistant today, by copying passages into a chat window. They are deciding whether REX
replaces that loop.

## Length

Target duration: 90 s.

## The one thing

The conversation happens on the document, and nothing changes the file until you approve
the exact change.

## Must show

- Open a folder: Markdown, Word, PDF and PowerPoint in one explorer.
- Select a passage → comment → Ask (`⌘↵`) → the answer lands on the comment, pinned to
  that place.
- ACT (`⇧⇥`) → Change → the work bar `+N −M` → Original / Both / New → Approve.
- The document changed and the comments kept their places (green `ok`, amber `moved`).
- Any agent: Claude Agent SDK, Codex, OpenCode, Deep Agents, and the model picker.
- Traffic: from every chat down to one message's JSON — "nothing is hidden".

## Do not show

- Anything from the real `~/.rex/rex.db`. Its threads point at a private repository.
- The `.env` file inside `documentation-sample`, or any API key. Settings never displays a
  key, but typing one happens off camera.
- Windows or Linux, or any claim about them — REX is a macOS app on Apple silicon.
- `.xlsx` opening — REX does not open workbooks.
- The packaged app answering an ASK — still unproven; record from `npm run build`.

## Tone

Concrete and calm. Say what changed for the reviewer. No hype words.

## Surfaces

- [ ] Web app — URL:
- [x] Electron/desktop app — launch: `npm run build`, then `npx electron . <workspace>`
      with the isolated environment below
- [ ] CLI / code walkthrough

## Capture

- driver: **attach** — REX's launch carries the isolated state and the agent-window rules,
  so the pipeline must not own it.
- recorder: **obs**, window title contains `REX`; crop the title bar (it reads `REX [agent]`).
- Launch the demo instance only through the agent wrapper, on its own port. The user's REX
  may already hold 9334:
  `PW_CDP_PORT=9444 REX_CDP_PORT=9444 <isolated env> .claude/hooks/playwright-launch.sh npx electron . <workspace>`
- The window is born on the hidden `playwright` desktop. Measure it before relying on it (see
  the plugin's `obs.md`): record 10 s and check that frames change. Real CDP input may not
  reach that desktop, so start with `meta.capture.input: "dom"`. If the frames freeze, ask
  the user before recording on a visible desktop.
- The document is a sandboxed iframe with scripting off, inside REX's shadow root:
  `"in": ["#rex-root", "iframe.rex-frame"]`, and select passages with `selectText`.
- Agent runs take seconds to minutes: `waitFor` the finished answer with
  `compress: "pause"`.

## App state

- Copy `~/Projects/Github/lukaskellerstein/documentation-sample` into
  `demo/prep/state/live/workspace/`, without `.env`, `.claude/` or `.git`. The original is
  read-only and never opened by the demo.
- Point `REX_DB_PATH`, `REX_WORK_PATH`, `REX_CACHE_PATH` and `REX_GATEWAY_DIR` into
  `demo/prep/state/live/`.
- Seed 2–3 real Asks off camera so the sidebar is not empty, then copy `live/` to
  `golden/`. `reset.sh` restores it before any take that changes the document.
- Apply (the write agent) runs only on the copy. Still tell the user at GATE 2 before the
  first take that uses it.
- Traffic needs the built-in gateway with a provider key, which the user types off camera
  in the demo instance's Settings.

## Voice

ElevenLabs. Pick the narrator at GATE 1. Pronunciation: "REX" is one word ("rex"); "ASK" and
"ACT" are spoken as words; say "Word document", not "docx".

## Finish

- [x] Remotion — rendered headlessly, re-renders when the app changes
- [x] Final Cut Pro — exported as an FCP project, finished by hand with FCP titles

Make both from the same timeline and compare them. The user has third-party title packs
installed (DesignStudio, motionVFX); list them with `fcp-templates.mjs` at GATE 3.
