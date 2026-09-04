# REX 41 — copying a block

**Version:** 1.0 · 2026-09-03
**Status:** **built, and driven in a live window.** All three milestones are in
the tree; `npm run test:trace` is 17 tests green, `npm run typecheck` passes and
`nvim-tools --json --all` adds no finding. §5 milestone 2 was run on 2026-09-03
against an isolated REX on port 9444 over a clone of the real database — §8
records what it showed.
**Depends on:** [`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md)
§5.3 (a turn is a block), §6 (the trace sheet), §6.2 (the debug report),
§6.5 (the trace's own view of a thread's messages);
[`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §3.3 (the mode pill on a
`YOU` turn); [`23-renaming-and-deleting-a-file/SPEC.md`](../23-renaming-and-deleting-a-file/SPEC.md)
§3 (the tree's row menu, and its `copy path`);
[`33-the-comment-row/SPEC.md`](../33-the-comment-row/SPEC.md) §2 (the pen that
appears on hover); [`36-tools-in-the-chat/SPEC.md`](../36-tools-in-the-chat/SPEC.md)
§3 (the tool row between two turns); [`38-the-trace-block/SPEC.md`](../38-the-trace-block/SPEC.md)
§3 (a block is a head and rows), §3.1 (the clock, one aligned column), §3.3
(`INPUT` and `OUTPUT`), §3.4 (`CHANGE`).

> [!note]
> **This spec adds one button and one pure function.** Every block in the chat
> and in the trace grows a copy button in its head, hidden until the pointer is
> over the block. Pressing it puts that block's text on the clipboard. Nothing
> is stored, no channel changes, and no block moves.

---

## 1. Why

### 1.1 The words on the screen cannot be taken off it

REX shows the reviewer's question and the agent's answer in two places — the
chat on the card and the `YOU` / `ANSWER` blocks of the trace sheet — and
neither can be copied. The reviewer's words on 2026-09-03: *"for each user
prompt and each answer in the trace view and in the comment chat … I should be
able to copy the whole text. The card should, on hover, give me the option to
copy the text."*

What exists today is next to it and is not it. `debug` (spec 08 §6.2) copies
the run's **identifiers** — session file, places, refusals, cost — and none of
its words. The tree's row menu copies a **path** (spec 23 §3). Neither copies
what was said.

### 1.2 Dragging over it does not work

The obvious fallback fails on both surfaces, for two different reasons.

| Surface | What a drag-select gets |
|:--|:--|
| The chat | the head with it — `YOU`, the mode pill, the clock — and, past the block's foot, the model and style line and the next turn's head |
| The trace | nothing at all from a folded row. `INPUT`, `CHANGE` and `OUTPUT` are shut to one line and a count (spec 38 §3.3), so the text the reviewer wants is not in the DOM to select |

A reviewer who wants to paste a bad answer into an issue is therefore editing
the paste by hand, and a reviewer who wants the command that failed has to open
the row first and then drag.

---

## 2. The button

```text
✨ ANSWER                                        14:32  ⧉   ← the head, and it
┌──────────────────────────────────────────────────────┐      appears on hover
│ The Materializer validates the work item before it   │
│ writes anything, so a malformed state never reaches…  │
└──────────────────────────────────────────────────────┘
 Fable · Concise
```

### 2.1 Where it sits, and when it is there

**In the head, after the clock,** on the chat's `.rex-turn-head` and the
trace's `.rex-trace-head`. The clock is the block's own right-hand fact and
stays where spec 38 §3.1 put it; the action goes outside it, as the card's
header puts `debug` and the bin outside the words.

**The space is always reserved and the glyph is not always drawn.** The button
is in the DOM on every block at a fixed 20px, at `opacity: 0`, and comes to
`opacity: 1` when the pointer is over the block or the button has keyboard
focus. This is the pen's rule on a comment row (spec 33 §2) and it exists for
the reason it does there: down thirty blocks of a trace, thirty glyphs is a
column of noise. Reserving the space is what keeps the clock column aligned —
a button that appeared on hover would shift every clock in the sheet each time
the pointer crossed a block.

### 2.2 What pressing it does

The block's text goes on the clipboard through `navigator.clipboard.writeText`,
and the glyph becomes a tick for 1.4 seconds. This is the renderer's own
clipboard and not main's, for the same reason the tree's `copy path` uses it:
the string already exists here, and the click that asked for it is proof the
window is focused. `debug` goes through main because its report exists only
there (`channels.ts`, `debugCopy`).

**A clipboard write that fails says so in the console and changes no glyph.**
No tick means nothing was copied, which is the honest state, and a dialog over
a one-glyph action is worse than the failure. The tree's `copy path` fails the
same way and for the same reason.

---

## 3. What is copied

One rule per shape of block, and all three are decided in `trace.ts` as data,
so `node --test` can check them without a DOM — the split spec 38 §3 already
made for what a row shows.

### 3.1 A spoken block copies its words and nothing else

`YOU`, `ANSWER`, `ASIDE`, `THINKING`, `NOTE`, `STOPPED` and `ERROR` put their
text on the clipboard with no head, no clock, no mode pill and no place list.
A question pasted into an issue should read as the question.

For the answer that means the **Markdown source**, which is the string `Prose`
was given, not the text it rendered. The source is what pastes usefully into an
editor, a prompt or another chat, and it is the only form in which the fences,
the tables and the lists survive the trip.

### 3.2 A call block copies its whole record, labelled

A tool call's parts are folded separately and are meaningless run together — a
command with its output stuck to it, and no word saying which is which. So a
`TOOL`, `DENIED`, `FAILED` or `DIFF` block copies the labelled sections it
actually has, in the order it draws them:

```text
BASH · FAILED
Run the unit tests

INPUT
command: npm test -- --run
description: Run the unit tests

OUTPUT
(eval):1: == not found
```

The head line is the label, plus `· STATUS` when there is one; then `what`,
the agent's own account of the call, when the input carried one; then the
refusal's reason, on a `DENIED` block, because that sentence is the block; then
`INPUT`, `CHANGE` and `OUTPUT`, each under its own word. A section the block
does not have is not named. **What is folded is copied** — that is the point of
§1.2's second row.

### 3.3 The chat copies a turn; the trace copies a message

The two surfaces disagree about one thing, and the disagreement is theirs
already. A turn is a maximal run of messages from one voice (spec 08 §5.3), so
the chat's button copies **the whole answer**, its parts joined by a blank line
— which is exactly the string `Prose` renders. The trace keeps every message as
its own block (spec 08 §6.5), so its button copies **the block under the
pointer**.

An answer the SDK split across three `text` messages is therefore one copy in
the chat and three in the trace. That is what each surface is for: the chat is
the conversation, the trace is the record. Nothing here merges the trace's
blocks — a button that copied more than the block it sits on would be lying
about its own position.

---

## 4. Where the code goes

| File | Change |
|:--|:--|
| `renderer/overlay/CopyText.tsx` | **new** — the button: the glyph, the tick, the timer, the clipboard write, the failure |
| `renderer/overlay/Icons.tsx` | **new** `Copy` glyph — two overlapping rounded rectangles, the shape every editor uses |
| `renderer/overlay/trace.ts` | **new** `textOf(entry)` — §3.1 and §3.2, as a pure function |
| `renderer/overlay/TraceSheet.tsx` | the button in `.rex-trace-head`, after `.rex-trace-spent` |
| `renderer/overlay/CommentCard.tsx` | the button in `.rex-turn-head`, after `.rex-turn-spent` |
| `renderer/overlay/overlay.css` | `.rex-copy` — the reserved cell, the reveal, the tick |
| `test/trace.spec.ts` | `textOf` for each kind: spoken, tool, denied, failed, diff |

---

## 5. Milestones

**0 — the text.** §3.1 and §3.2 as `textOf` in `trace.ts`, with its tests.
*Done when:* `npm run test:trace` is green and `npm run typecheck` passes.

**1 — the button.** §2, `CopyText.tsx`, the glyph and the CSS, wired into both
surfaces. *Done when:* `npm run typecheck` passes and `nvim-tools --json --all`
adds no finding.

**2 — driven in a live window.** An isolated REX on port 9444 over a clone of
the database, on a comment with a real run: a `YOU` turn, an `ANSWER`, and in
the trace a failed call. *Done when:* §6 is checked by eye.

---

## 6. Acceptance

- [ ] A chat turn shows no copy glyph until the pointer is over it, and the clock does not move when it appears.
- [ ] Copying a `YOU` turn gives the question alone — no `YOU`, no clock, no mode word.
- [ ] Copying an `ANSWER` turn gives the Markdown source of the whole answer, its parts joined, and a fenced code block in it survives the paste.
- [ ] The glyph becomes a tick for about a second and a half, then goes back.
- [ ] The same two blocks copy in the trace sheet, and every other block there does too.
- [ ] Copying a **failed** call in the trace gives its head, its `INPUT` and its `OUTPUT`, with the rows still folded on screen.
- [ ] Copying a **denied** call gives the gate's reason.
- [ ] Tabbing to the button reveals it, and `enter` copies.
- [ ] `npm run test:trace` is green; `npm run typecheck` passes; `nvim-tools --json --all` adds no finding.

---

## 7. Rejected

**A copy on the whole conversation.** The ask is per block, and the thing that
takes a whole run somewhere else already exists: `debug` copies the run's
identifiers, and `rex export` writes the thread out. A second whole-thread
button in the same head would be a third answer to a question with two.

**Copying the rendered text instead of the source.** An answer's list, table
and code fence are all markers, and the render throws them away. `innerText`
would also have to reach into a shadow root to find them at all.

**A button on every block, always visible.** Thirty blocks of a trace is thirty
glyphs, and the reveal rule for exactly this case is already in the tree and on
the comment row.

**A right-click menu on a block.** One action does not earn a menu, and the
menu REX has (spec 23 §3) is on rows that carry five.

**Select the text and press `⌘C`.** §1.2 — it takes the head with it in the
chat, and in the trace the text is not in the DOM to select.

**A shared component with `DebugCopy`.** They look alike and are not: `debug`
asks main for a string that does not exist yet, can fail before there is
anything to copy, and puts the report in its own `title` so the reviewer can
read what they are about to paste. This one has its string in hand. The shared
part is a timer and a glyph swap, and a component general enough to hold both
would be longer than either.

---

## 8. What the live run showed

Run on 2026-09-03 on an isolated REX (port 9444, a clone of the reviewer's
database, launched with the document as an argument so no dialog was needed),
at 1400×918, on comment 3 — 15 turns, 58 trace blocks, three failed calls.

| Surface | What it said |
|:--|:--|
| The chat, nothing hovered | 15 turns, 15 buttons, every one at `opacity: 0` in a 20×20 cell |
| A `YOU` turn hovered | the glyph at `opacity: 1`, tooltip `Copy`, label *Copy this question to the clipboard*. The clock stayed at x=1318 — the same pixel it sat on unhovered |
| That turn pressed | the two messages the turn is made of, joined by a blank line, with no `YOU`, no clock and no `ACT` pill. The glyph turned `rgb(102, 173, 147)` and went back about a second and a half later |
| An `ANSWER` turn pressed | the Markdown source — `**bold**`, `` `code` ``, `*italic*` and the `-` bullets all intact |
| The trace sheet | 58 blocks, 58 buttons: 7 `YOU`, 6 `ANSWER`, 1 `ASIDE`, 1 `STOPPED`, 40 `TOOL`, 3 `FAILED` |
| A `BASH · FAILED` block pressed, `INPUT` shut | the head, the description, `INPUT` with both fields, then `OUTPUT` — §1.2's second row, fixed |
| An `EDIT` pressed with all three rows shut | head, `INPUT` (two fields), `CHANGE` (the whole diff). `old_string` and `new_string` stayed out of `INPUT`, where spec 38 §3.4 put them |
| A trace `YOU` pressed | the words alone |
| `tab` from the block above, pointer parked at (20, 900) | focus landed on the copy button, `:focus-visible` matched, `opacity: 1`. `enter` copied and showed the tick |

No `DENIED` block existed in this thread — the deny path is covered by
`test:trace` and not by eye. The clipboard the run wrote to is the reviewer's
own; it was saved before the first press and restored after the last.
