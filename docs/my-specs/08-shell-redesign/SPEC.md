# REX 08 — the shell redesign

**Version:** 1.1 · 2026-08-22
**Status:** implemented; all six milestones pass their acceptance criteria.
**§8 was withdrawn on 2026-08-23** by
[09 — removing the fact graph](../09-removing-the-fact-graph/SPEC.md);
§1 to §7 are current and unaffected.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md),
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md),
[`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md),
[`04-selection-and-shortcuts/SPEC.md`](../04-selection-and-shortcuts/SPEC.md),
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md),
[`06-document-section-and-pen/SPEC.md`](../06-document-section-and-pen/SPEC.md) and
[`07-fact-graph/SPEC.md`](../07-fact-graph/SPEC.md).

> [!note]
> **1.1 is the implementation pass.** No design changed. What changed is that
> three claims 1.0 made turned out to be wrong, and each is corrected where it
> happens rather than here: §5.2 (steps are **calls**, never rows), §5.3
> (`system` is a **third voice**, and folding it into the answer inverts its
> meaning), §6.5 (totals are counted from the **messages**, never from the
> blocks the sheet draws), and §7.3 (a saved comment **does** need new plumbing
> — the design's "no new plumbing" note is true only of the selection panel).

> [!note]
> **This spec changes layout and information architecture. It adds no
> dependency, no IPC channel and no table.** Every value it needs was already
> stored. Three shapes grew a field, each named in §9: `targetRefs`, `mark` and
> `topicId`. Nothing is persisted that was not persisted before.

> [!warning]
> **Four decisions here reverse a decision an earlier spec took.** Each is
> listed in §2 with the section it overrides and what it costs. Read §2 before
> writing any code, because three of the four look like refactors and are not:
> they change what the reviewer can see at the moment they are deciding
> something.

> [!note]
> **The palette and the typefaces are already done** and are not restated here.
> The Graphite palette and DM Sans landed before this spec was written; every
> colour named below is a token that exists today in
> `src/renderer/overlay/overlay.css`.

---

## 0. How to use this document

The authority for every pixel is the design canvas, not this file. This file
says *what changes and why*; the boards say what it looks like.

| Board | Governs |
|:--|:--|
| `Main.dc.html` | The entry screen. §3, §5, §7. |
| `Threads.dc.html` | The comment list and its filters. §3.3. |
| `Select.dc.html` | The selection tab. §3.2. |
| `Trace.dc.html` | The trace sheet. §6. |
| `Hover.dc.html` | Pick mode, the path bar, anchor strength. §4. |
| `Region.dc.html` | Regions of a figure, and the foot strip in its resting state. §4.1. |

`Findings.dc.html` and `Lens.dc.html` governed §8 and **govern nothing now** —
spec 09 removed the Facts mode they draw.

Two rules that apply throughout and are not repeated in each section:

- **Colour means state.** Nothing this spec adds may introduce a fifth meaning
  for a colour. The step bars in §5.4 are neutral for exactly this reason.
- **Selection is a change of intensity, never a second mark.** A tab, a row or
  a card that is selected deepens its own wash. It never changes hue.

> [!warning]
> **`Main.dc.html` and `Select.dc.html` disagree about one thing**, and this
> spec follows `Main.dc.html`. Select draws the tab bar only while the selection
> has something in it; Main and Trace draw it always, with `Selection 0` dimmed.
> Main is the entry artboard and the design's own README states the always-there
> rule as the decision. §3.1 records it, and `Select.dc.html` should be
> corrected rather than this spec.

---

## 1. What this is

Five changes to the shell, drawn as a set because they are one argument:
**every control belongs where the thing it acts on is, and the sidebar does one
job at a time.**

1. **The sidebar is two tabs** — `Selection` and `Comments`, switched with the
   same segmented control the top bar uses for `Document | Graph`. §3.
2. **The mode controls leave the top bar** for the strip at the foot of the
   paper, where the mode acts. §4.
3. **The comment card splits by what its content needs** — a meta strip, turns
   as blocks, and a step strip standing in for the machinery. §5.
4. **The full trace becomes a sheet over the document pane**, because a bash
   line cannot be read in 384px. §6.
5. **A comment points back at its places** — `go to ›`, and place rows that
   light their mark in the document. §7.

And one that follows from them: **Facts becomes one centre mode with two
presentations** rather than a lens hidden inside `Graph`. §8. ***Withdrawn by
spec 09** — there is no Facts mode. The centre segment is `Document | Graph`.*

### 1.1 What this is not

It is not a re-skin. The colours and the typefaces already match the design.
Every item above moves a control, splits a surface, or shows a value that is
already in the database and never drawn.

---

## 2. What changes in specs 01 to 07

Everywhere not named here, the earlier specs still govern.

| Spec | Section | What it said | What 08 says | Cost |
|:--|:--|:--|:--|:--|
| 05 | §3.3 | The selection panel sits **above** the comments so the comments stay visible while you build a selection | The two are **tabs**. §3.1 | Real: the comments are how you check you are not asking something already asked, and a count on a tab does not replace reading them |
| 05 | §3.3 | The selection list is capped at `34vh` | **No cap.** §3.2 | None — the cap existed only to stop twenty places pushing the comments off the bottom |
| 04 §2, 06 §5.1 | — | `Pick element` and `Pen` are top-bar buttons | Both are chips in the **foot strip**. §4 | The top bar loses two controls a new reader might have found there |
| 01 | §7 | The comment card shows "the note, the **full transcript**, a message box" | The card carries the answer and a **step strip**; the transcript moves to a **sheet**. §5.4, §6 | Reading the trace now costs the document pane until `esc` |
| 07 | §8.2 | The fact picture is a **lens over the reference graph** | Facts is one centre mode with **two presentations**. §8.1 | ~~`Graph` stops being able to show facts~~ — **moot: spec 09 withdrew both** |
| 07 | §8.2 | Topic colour comes from a wheel | **Three computed colours**, everything else neutral. §8.4 | ~~Topics four and up lose their hue~~ — **moot: spec 09 withdrew topics** |

Nothing in specs 01 §6 (anchoring), 01 §8.4 (the gate), 01 §8.7 (Apply) or 03
§5 (the paper) changes. This spec does not touch the resolver, the profiles, or
the document stylesheet.

---

## 3. The sidebar is two tabs

### 3.1 The bar

A 40px row at the top of the comments column, holding one segmented control with
two segments. It is **furniture**: present on every screen that shows the
comments column, whatever is in it.

| | |
|:--|:--|
| Height | 40px, `border-bottom: 1px solid var(--rule-soft)`, padding `0 14px` |
| Control | `.rex-segment`, `flex: 1` — the same control the top bar uses |
| Segments | `Selection` and `Comments`, each with a count pill |
| Count pill | on: `background: var(--link)`, `color: var(--bg)`; off: `background: var(--raised)`, `color: var(--muted)` |
| Empty selection | The `Selection` segment is dimmed to `var(--faint)` and reads `0`. It stays clickable and shows the tab's empty state |

**Why it never disappears.** A control that comes and goes is its own kind of
confusing, and that is the fault this change set out to fix. The zoom chip in
the top bar earns its disappearance because it is a *fact* about the document;
a tab bar is *navigation*, and navigation that moves is worse than navigation
that is sometimes empty.

**Ask empties the selection**, so the active tab returns to `Comments` the
moment `Ask` is pressed. The comment it made is the newest row, working.

### 3.2 The Selection tab

Everything spec 05 §3 specifies, with three changes.

1. **`clear` moves inside the tab**, at its head — a 30px row, right-aligned,
   `.rex-link`. Beside the tabs it read as chrome for the whole sidebar; it acts
   on the selection only, so it lives with the selection. It stays deliberately
   far from `Ask` at the foot: a destructive action beside the primary one is a
   slip waiting to happen. Its confirmation rules from spec 05 §3.2 are
   unchanged — it asks first above three places, or once a note has been typed.
2. **The `34vh` cap goes.** The list is `flex: 1` and scrolls inside the tab.
3. **The note and `Ask` sit at the foot of a full column**, not partway down it.

The tab's ground is `var(--well)`, so it reads as a different surface from the
comments. Row treatment is exactly spec 05 §3.2; the scope chips, the strength
meter and the `a region of it` chip are exactly spec 06 §6.2. A place in a
document that is not open keeps its row and its number and has no outline to
light (spec 05 §3.3) — its detail reads `Open components.md to widen this
place.`

Spec 05 §3.3's other layout consequence still holds and is **not** amended: the
comments column is hidden while the graph is showing, and stops being hidden
whenever the panel has items. The tab bar goes with the column.

**Empty state.** With nothing selected the tab shows one line of `.rex-meta`:
what picking is and which key starts it. It does not show a button — §4 moved
that control to where the mode acts.

### 3.3 The Comments tab

The comments column exactly as it is today, moved under the tab, with the filter
chips as its own 40px row below the tab bar.

| Row | Contents |
|:--|:--|
| Tab bar | §3.1 |
| Filters | `open` · `resolved` · `orphaned`, each a `.rex-chip` carrying its count |
| List | Thread rows, `flex: 1`, scrolling |
| Foot | `Synthesis thread…` and its hint |

Two changes to a thread row, both from `Threads.dc.html`:

- The row gains the **Newsreader quote** it was written on, between the note and
  the documents line — `.rex-quote-small`, two lines maximum. A row that shows
  only the note makes the reviewer open it to remember what it was about.
- The `orphaned` filter gains an **explanatory panel** above its rows:
  `.rex-orphan-note`, saying the text is gone, nothing is lost, and each comment
  keeps the quote it was written on.

The orphan tray (spec 01 §7) shows on the `open` and `resolved` filters and is
hidden on `orphaned`, where it would point at the list under it.

### 3.4 During pick mode

While pick mode is on and the selection is empty, the `Comments` tab's filter
row is replaced by a `WHAT YOU WOULD ANCHOR` label and the tab body shows the
hovered target: its kind, the `element.id` or `element.css` that would be
stored, the quote, and the strength meter. `Hover.dc.html` governs it.

This is a *display* of the hover state, not a new mode. It disappears with pick
mode, and it never has a "Comment on this" button — a click adds the place and
pick mode stays on for the next one.

---

## 4. The mode strip at the foot of the paper

### 4.1 One strip, three states

The 34px strip along the foot of the document pane, drawn over the pane and
never written into the document, has three states and only ever one at a time.

| State | Drawn as |
|:--|:--|
| Resting | Two small chips at `right: 48px; bottom: 14px` — `⌥ pick element` and `N pen`. Paper-side colours: `border: 1px solid #e2ded7`, `background: #f0eee9`, `color: #8a837a`, key caps on `#fff` |
| Pick mode on | The full-width **path bar** of spec 06 §6.1 — `PATH`, the crumbs, and the key hints on the right |
| Pen mode on | The full-width **pen bar** of spec 06 §6.3 — the existing `.rex-pentool`, carrying undo, redo, cancel and done |

The resting chips sit clear of the 32px gutter, which is why they are inset
48px rather than 12px.

### 4.2 The keys do not change

`P` toggles pick mode. Holding `⌥` for 250ms turns it on while held. `N` toggles
the pen. `esc` leaves either. All four are already bound; §4 moves the *button*,
not the binding.

> [!warning]
> **`ctrl` cannot be the key on macOS.** `ctrl`-click *is* a right-click and the
> OS takes the gesture before the page sees it. This is fault 1 of spec 05 §1
> and the reason spec 05 §3.1 carries a warning against a held modifier. `⌥` is
> free precisely because ⇧, `ctrl` and `⌘` stopped being selection modifiers and
> `⌥` never was one.

### 4.3 Why the top bar was wrong for them

The top bar holds facts about the document — its path, whether the file changed,
what it has cost — and actions on it. `Pick element` and `Pen` were the only
**modes** in that row, and a mode reads differently from an action: it is a
state you are in, not a thing you did. Put where the mode acts, the control and
its effect are in the same place, and the strip that carries the hint is the
same strip that becomes the path bar the moment the mode is on. One place, one
meaning.

### 4.4 What the top bar keeps

Mark, `Open ▾`, the breadcrumb path, the `FILE CHANGED` pill, the zoom chip when
the zoom is not 100%, the `Document | Graph` segment, the running cost,
and `Ask all · N`. That is the whole bar.

---

## 5. The comment card

The card in the sidebar shows a flat run of paragraphs and one collapsed
monospace row. It becomes four blocks. `Main.dc.html` governs.

### 5.1 The anchor card

Unchanged in substance, with §7's additions. It carries the state wash, the
numbered token, the `anchored in N places · <state phrase>` line, the documents
line, the Newsreader quote and the note.

### 5.2 The meta strip

A single row on `var(--well)`, `font-size: 10px`, holding what the thread cost.

```text
🛡 read | 2 turns  6 steps  12.4s  $0.031                      14:32
```

| Field | Source |
|:--|:--|
| Profile and shield | `Thread.profile` |
| Turns | count of `text` messages with `role = "user"` |
| Steps | count of `tool_call` messages — **calls, never rows.** A refused call arrives as a `tool_call` *and* an error `tool_result`; counting both makes the step strip draw one more bar than this number |
| Duration | sum of `Message.durationMs` |
| Cost | sum of `Message.costUsd` |
| Time | `Message.createdAt` of the last message, local, `HH:MM` |

**Nothing here is new data.** Every column already exists and is already
written; the card has simply never drawn any of it. The shield is the one fact
in the strip that is about safety rather than book-keeping, and it is the read
profile's promise made visible.

### 5.3 Turns as blocks

A turn is a block with a label, not another paragraph in a run.

| Turn | Treatment |
|:--|:--|
| `YOU` | `.rex-label`, then the text at `var(--fg-dim)` with a 2px `var(--rule)` left rule and 10px padding |
| `ANSWER` | `.rex-label`, a right-aligned `12.4s · $0.031` in mono, then body text at `var(--fg)`, full contrast, no chrome |
| `NOTE` | REX's own voice — a 2px `var(--write-edge)` rule, `var(--muted)`, 12.5px |
| `ERROR` | The same block, in `var(--lost-text)` |

The answer outranks the machinery, and this is what that means in layout: the
answer is the only thing on the card set at full contrast with no border, no
tint and no rule.

**A turn is a run of consecutive messages from one voice, not one message.**
The SDK emits an answer as several `text` rows, and labelling each of them
`ANSWER` printed the word three times down one reply. The meta strip counts
these runs, so `2 turns` means two voices spoke, not that two rows exist.

> [!warning]
> **`system` is a third voice, and folding it into the answer inverts it.** A
> `system` text message is REX's own notice, and the gate refusing a write is
> one of them. Rendered inside the `ANSWER` block it reads as the agent saying
> it — when the whole point of the notice is that the agent was *stopped*.
> Measured on 2026-08-22 against a real thread whose rows are
> `user, assistant, assistant, system`.

### 5.4 The step strip

One row standing in for the whole run, replacing today's collapsed
`{n} steps · read, search` toggle.

- One 3px bar per tool call, in order, `height: 10px`, `background: var(--rule)`.
- A **denied** call is `height: 12px` and `background: var(--lost)`.
- Then `N steps`, then `· N denied` in `var(--lost-text)` when any were.
- Then `show trace ›` on the right, in `var(--link)`.
- The whole row is a button. It opens §6.

**The bars are neutral on purpose.** Colour means state in this design, and
"which tool ran" is not a state. The single exception is the denied write: the
gate firing is the one thing worth seeing without opening anything, and it wears
the same red the write-capable agent wears everywhere else.

While the trace is open the strip lights: border `var(--action)`, background
`var(--wash-ok)`, bars `var(--faint)`, and the right-hand control reads
`showing`.

---

## 6. The trace sheet

### 6.1 What it covers

The **document pane, and only the document pane**. The explorer stays, and the
comment card stays beside it — so the reviewer always sees which comment they
are auditing, and the reply box is reachable without closing. `esc` closes it.

**Why a sheet and not a third centre mode.** `Document | Graph` is a
**workspace** switch; a trace belongs to one comment. As a peer it would be a
button that comes and goes, and leaving it there would need a decision about
what it shows with no comment open. Apply's review bar (spec 05 §5.6.1) settled
the same question the same way.

The reasoning in one line, and it is REX's own: **the answer outranks the
machinery.** An answer is about a passage, so it stays beside the passage. The
machinery has nothing to do with the document being on screen, so it is the only
part worth leaving the document for.

### 6.2 The head

A 44px bar on `var(--panel)`: the comment's token, the label `TRACE`, the
comment's note truncated to one line, a `N DENIED` pill when any were, the
`N steps · Ns · $N` summary in mono, and then two controls — **`debug`** and
**`close esc`**.

Both are the same hairline control (`.rex-trace-action`), 24px, muted at rest
and answering the pointer with intensity rather than hue. They are not links:
the bar already holds five pieces of text and a sixth cannot say "press me".
They are not `.rex-button` either — 28px of raised surface would outweigh the
summary they sit beside. Nor are they `.rex-chip`, which is **taken**: that is
the sidebar's filter pill, 999px and 12px, and reusing the word made these two
silently inherit its shape. The `esc` cap is `.rex-key-chrome`, the variant: the
plain `.rex-key` is a **paper** style, white on `#d6d1c8` for the pen, pick and
mode bars drawn over the document, and on this bar it was the brightest object
in the header — louder than the refusal pill, which is the one thing in that row
entitled to shout.

**`debug` copies this run's identifiers to the clipboard**, for pasting into a
bug report. It carries a beetle (`Icons.tsx`'s `Bug`) — not a wrench or a cog,
which mean *settings* in every toolbar anybody has used, while this button
changes nothing — and the beetle becomes a `Check` for as long as the
confirmation shows. The reviewer reading a trace is the one person who can see that the
answer is wrong, and the one person who cannot say *where* it happened: which
thread row, which SDK session, which of the dozen-odd JSONL files under
`~/.claude/projects/<cwd dashed>/` was written by this answer. Every one of those
facts lives in main — the agent's `cwd`, the transcript path, `~/.rex/rex.db`,
the versions — so `debug:copy` is a command rather than something the renderer
assembles, and main writes the clipboard itself: Electron owns it, and a copy
that depends on the renderer being focused fails exactly when somebody is trying
to report a bug.

The report is plain text, one `key  value` per line, and names: the thread with
its kind, status and profile; the model; the SDK session id; the working
directory; the database; when the thread was asked and last updated; the
comment; each place
with its anchor state and what it is anchored by; the totals, which are
`shared/totals.ts` so the report, the sheet and the card cannot disagree; **every
refusal with the full command that earned it**; any errors; and the versions of
REX, Electron, Chrome, Node and the Agent SDK. Sections that would be empty are
omitted — the totals line already counts the refusals and the errors, so an
absent section is never ambiguous.

The copied text becomes the button's `title` for as long as the confirmation
shows, so the reviewer can read what they are about to paste. The report carries
absolute paths and a clipped line of their document, and seeing it first is the
difference between copying and disclosing.

#### 6.2.1 The session is reported twice, on purpose

`sdk store` is what `getSessionInfo` says, and `sdk log` is what the filesystem
says. They are separate lines because **they can disagree, and each way of
disagreeing is a different bug**:

| `sdk store` | `sdk log` | What it means |
|:--|:--|:--|
| has it | present | The normal case. Read the file. |
| has it | missing | The store moved — REX is looking in the wrong config directory. |
| no record | present | The SDK will refuse to resume; §8.5's replay is what will actually happen, and the file is a leftover from another config directory. |
| no record | missing | The cache was cleaned. §8.5 replays, exactly as designed. |

Collapsing the pair into one `resumable: yes` hid two real faults at once, and
both were found by the first report this button ever produced (2026-08-23):

1. **`sessionFilePath` hardcoded `~/.claude`.** `CLAUDE_CONFIG_DIR` overrides
   it, this machine sets one, and the SDK honours it — so REX named a file that
   did not exist while the SDK wrote the transcript somewhere else. Invisible
   until something asked the filesystem rather than the SDK, which is what this
   report does. `transcript.ts` now has `configDir()`.
2. **`sessionExists` then answered `true` from a stale file** left by a REX
   launched with a different config directory, so `thread:reply` resumed a
   session the SDK had never heard of and the turn died with *No conversation
   found with session ID*. With (1) fixed the two sources agree, `sessionExists`
   answers `false`, and the reply replays the thread into a fresh session as
   §8.5 intends. Reproduced and re-tested.

### 6.3 The entries

One block per message, in `seq` order. Each has a 3px left edge, a 16px icon, a
label, its body, and a right-aligned duration.

| Kind | Edge | Ground | Body |
|:--|:--|:--|:--|
| `YOU` | `var(--action)` | `var(--wash-ok)` | The note, full contrast |
| `THINKING` | `var(--rule)` | `var(--well)` | Italic, `var(--muted)` |
| Tool call | `var(--rule)` | `var(--panel)` | The tool's own argument in a mono block on `var(--well)` |
| `DENIED` | `var(--lost)` | `var(--write-bg)` | The refusal, in `var(--lost-text)` |
| `ANSWER` | `var(--action)` | `var(--wash-ok)` | Body text, full contrast |

A tool call renders **the argument that matters for that tool** — a command for
`Bash`, a path for `Read`, a pattern for `Grep`. Its result is collapsed to a
summary (`4 matches in 2 files`) with a `show` / `hide` control; it is opened
only when the answer looks wrong, which is the one time its height earns itself.

**The denied block is open by default**, and it is the only one that is. Nobody
should have to unfold the gate firing: it is the whole safety story of the read
profile made visible.

### 6.4 Colour

Colour here distinguishes **kind**, and invents no meanings: steel is you and
the answer, neutral is machinery, faint is thinking, red is the write-capable
agent being refused. Those are the same two things red is spent on everywhere
else.

### 6.5 What it needs, and what is in the way

**No new storage.** `thinking`, `diff` and `completed` messages are written
today and thrown away on the way to the card: `conversation()` in
`src/renderer/overlay/CommentCard.tsx:79` filters to `text` and `error` and
nothing else. The trace needs the unfiltered list.

The fix is a second selector beside `conversation()`, not a change to it — the
card must keep showing only `text` and `error`, or the answer stops outranking
the machinery in the one place that matters most. **Thinking is drawn in the
trace and nowhere else.**

> [!warning]
> **The head's totals are counted from the messages, never from the blocks.**
> A `completed` message carries `durationMs` and `costUsd` and is drawn nowhere,
> so a head that summed its own blocks reported a run that took no time and cost
> nothing — beside a card saying `49.6s · $0.833`. One helper, `totalsOf`,
> serves both. A sheet that disagrees with the card that opened it is worse than
> a sheet that reports nothing.

A tool RESULT is never a block of its own; it belongs to the call above it, the
same rule §5.4's strip follows.

---

## 7. A comment points back at its places

### 7.1 `go to ›`

A control on the card's **documents line**, right-aligned, `.rex-link`. It opens
the document of the comment's **first** place and scrolls there.

It rides the documents line and not the meta line above it: with a state phrase
like `re-found after the file changed` beside it, the meta line wrapped.

### 7.2 Place rows

Under the documents line, one row per place, numbered as the comment numbered
them.

| Column | Contents |
|:--|:--|
| Index | A 15px circle in `var(--active)` — violet, the open comment's colour |
| Document | The file name, mono, `var(--muted)` |
| State | `text moved`, `not checked here`, `anchor lost`, or nothing when it resolved exactly |
| Chevron | Only when the place is in a document that is not open |

Pointing at a row lights it — the row takes the wash of its state — and **its
mark in the document takes the same number**, drawn in violet over the
highlight. That is what makes a comment with nine places readable: with nine
cells picked, "which nine" is the whole question.

The derived shape is one row and is never persisted:

```ts
interface PlaceRow {
  index: number;
  documentPath: string;
  /** null when the document has not been open — never "orphaned". */
  state: AnchorState | null;
  /** True when this place is in the document on screen. */
  live: boolean;
}
```

> [!warning]
> **`not checked here` is not `orphaned`.** A place in a document that has not
> been open gets the muted grey this design uses for absence, never red, and is
> never counted as an orphan. An orphan means the text is gone; this means
> nobody looked. Getting this wrong turns every cross-document comment red on
> first open.

### 7.3 Across documents

A place in a document that is not open has nothing to light. Its row says which
document it is in, carries a chevron, and clicking it opens that document and
scrolls there.

`doc:open`, `scrollToAnchor` and the wait-for-the-DOM step in `onSurfaceReady`
are what the selection panel already uses, and `repaintActive()` already paints
the open comment violet.

> [!warning]
> **One thing IS new, and the design's own note that "it needs no new plumbing"
> is wrong about it.** The selection panel gets away with a bare `documentId`
> because the reviewer has just picked the document and its `SelectionItem`
> carries the `DocumentRef`. A comment read back from the database does not: a
> stored `AnchorTarget` has a `documentId` and nothing else, and there is no
> channel that turns one into a ref. So `ThreadWithMessages` gains
> **`targetRefs`**, built in `threads.ts` from the same `documentsOf()` call
> that already builds `targetNames`. No new channel, no new query.

> [!warning]
> **`openDocument` closes the open card, and a place jump must put it back.**
> Clearing `activeId` is right in general — the comment you were reading need
> not be about the document you just opened — but a place jump is exactly the
> case where it always is, and closing the card takes away the list of places
> the reviewer is working through. `goToPlace` restores it after the open.

The badge needs somewhere to draw. `CheckedTarget` gains **`mark`** beside
`box`: a text target has no box, because filling it is the highlight's job, but
it still has a position. `mark` is null only for an orphan or a whole-document
target — the two cases where there is genuinely nowhere to point.

---

## 8. The Facts mode

> [!warning]
> **This section was withdrawn on 2026-08-23 by
> [09 — removing the fact graph](../09-removing-the-fact-graph/SPEC.md).**
> `FactsView.tsx`, `FactGraph.tsx`, the `Facts` segment and the `F` key are all
> deleted; the centre segment is `Document | Graph`. Spec 09 §1 has the reason —
> spec 07's own measurements — and §14 the trigger to revisit. The argument
> below is kept because §8.1's "one mode, two presentations" and §8.3's
> "a note about a finding is not part of the finding" are reusable, but nothing
> here describes REX as it is.

### 8.1 One mode, two presentations

Spec 07 §8.2 draws the fact picture as a lens over the reference graph, and that
is what `App.tsx` built: `centre === "graph" && lens === "facts"`. It leaves the
centre segment reading `Graph` while every node on screen is a fact.

**08 moves it.** `Facts` is one centre mode with two presentations, and
`VIEW · List | Graph` switches between them. `Graph` mode keeps the reference
graph to itself, and neither mode ever shows the other one's nodes.

The switch is **first in the centre pane on both boards**, 16px in from its top
left — the same corner *and* the same height — so it does not move when you
switch. On the list board the build strip follows it: what you are looking at,
then what built it, then what is filtered out of it.

> [!note]
> **Open, and recorded rather than fixed.** The picture draws no build strip, so
> it reports nothing about the build behind it. This is *not* to be fixed by
> putting the strip above the switch — that is what made the two boards disagree
> in the first place.

### 8.2 The build strip

One strip at the top of the list, in exactly one of three states.

| State | Shows |
|:--|:--|
| `BUILT` | counts, the three model aliases, when and how long, `Rebuild` |
| `BUILDING` | stage `N of 5`, a five-segment progress bar, chunks done, elapsed and remaining, `Cancel` |
| `CANNOT START` | which models the preflight could not find, and `Check again` |

Two things the strip must always carry, both from spec 07 §11.1:

- **What was not covered**, in an amber panel: claims dropped because their
  quote was not in the source, chunks that failed after retries, subjects that
  hit the pairing cap. Nothing is capped silently — a report that leaves these
  out reads as "everything was covered".
- **The word `candidates`**, in plain words, every time: *these are candidates,
  not all the contradictions.*

The `BUILDING` state must say **you can close REX** and that the build resumes
at the chunk it reached, because a first build of a large folder is an overnight
job (spec 07 §7.3). `CANNOT START` is a **stop, not a wait**: `embed` and
`local-31b` have no fallback on purpose, so that a build can never quietly reach
for a cloud model and send the documents off the machine.

### 8.3 The findings list

A 40px filter row — `candidates` · `confirmed` · `dismissed` as chips with
counts, and a `topic · all` menu on the right — then the rows.

A finding row carries: a `CONTRADICTS` or `SUPERSEDES` pill, the subject, its
topic swatch and name, a `confirmed` tick when judged, the two quotes side by
side with a `≠` or an arrow between them, and the actions `Open`, `Comment`,
`Dismiss`.

**A supersede stays amber.** An old decision replaced by a new one is not a
fault, and painting the third one red teaches the reviewer to ignore red. The
older claim's card is dimmed to `opacity: 0.75`; the live one keeps its border.

**A note about a finding is not part of the finding.** Lines like *stated in 3
documents · 1 against* or *dated by the text itself* sat in the same register as
the row and read as more of the finding. They go behind a `details ⌄`
disclosure, closed until asked for, each labelled inside — `EVIDENCE`,
`OLDER CLAIM`, `DATES`, `DISMISSED` — so the label says what the line is. A
disclosure and not a tooltip: the notes are longer than a tooltip holds, and a
tooltip is reachable by neither touch nor keyboard.

A dismissed row is kept, collapsed and quiet, with `restore`.

### 8.4 Topic colours are computed, and capped at three

| Topic | Colour |
|:--|:--|
| First community | `#2a9fb3` cyan |
| Second | `#9085e9` violet |
| Third | `#d55181` magenta |
| Fourth and after | `var(--rule)` neutral |

A node-link graph is an **all-pairs** surface — any two topics can end up
adjacent — and in this view colour on an *edge* carries meaning, so steel,
amber, red and green are all ruled out. On the graph's own ground no four
remaining hues clear both the colour-blindness and the normal-vision floors.
Three do. The worst pair sits at ΔE 8.0 under deuteranopia, which is the target
and not a comfortable margin.

That is legal **only because the topic is carried three more ways**: each
community has its own centre of gravity, its name is drawn at that centre, and
the legend names all three. Colour is never the only thing saying which topic a
node belongs to. This replaces the seven-colour wheel in
`src/renderer/overlay/FactGraph.tsx:127`.

Edges keep their meanings: `contradicts` red and solid, `supersedes` amber and
arrowed, `refines` grey and dashed, `about` the faintest hairline in the palette.

A finding row needs the same colour, so **`Finding` gains `topicId`** — one more
column on a query that already selects `s.topic_name`. Without it the row's
swatch could only be coloured by hashing the topic's *name*, which is exactly
the invented hue this section forbids.

### 8.5 The lens panel

The right column in `Graph` presentation, headed `FACT GRAPH`:

1. A three-cell stat grid — subjects, claims, candidates, the last in
   `var(--lost)`.
2. The selected claim's card — its topic dot, its value, a `DECIDED` pill, and
   `about` / `topic` / `live` rows.
3. `STATED IN N DOCUMENTS` — one card per evidence row, each with its Newsreader
   quote, its `path:line` and a `go to ›`.
4. `CONTRADICTED BY` — the opposing claim, its documents, and `open finding ›`.
5. One closing line: *that is not a vote — REX reports the pair and you decide.*

Point 3 is the view the whole feature was asked for: one fact, and every
document that states it.

---

## 9. Types and IPC

**One new IPC channel**, and it is §6.2's `debug`. Everything else below is
renderer-side or reuses a channel.

| Change | Where |
|:--|:--|
| `debug:copy` — thread id in, the report out, clipboard written in main | `src/shared/channels.ts`, `main/debug.ts`. §6.2 |
| `totalsOf` moves to `shared/`, taking `Message[]` | `src/shared/totals.ts` — main counts a run's cost too now, and three views of one number must not drift |
| `agentCwd` moves to `main/threads.ts` | It decides where the agent runs *and* where the SDK writes its transcript; `ipc.ts` kept it as a closure, where a report cannot reach it |
| `configDir()` and `sessionRecord()` | `main/agent/transcript.ts` — §6.2.1. `CLAUDE_CONFIG_DIR` was ignored, and one SDK call site replaces two |
| `targetRefs` on `ThreadWithMessages` — one ref per target | `src/shared/types.ts`, built in `main/threads.ts`. §7.3 |
| `mark` on `CheckedTarget` — where to draw a place's number | `renderer/overlay/anchoring.ts`, §7.2 |
| ~~`topicId` on `Finding`~~ | **Withdrawn by spec 09 — `Finding` is deleted** |
| `SidebarTab = "selection" \| "comments"` | `src/renderer/overlay/App.tsx` state |
| `TraceEntry` — a `Message` narrowed for §6.3 | `src/renderer/overlay/trace.ts` |
| ~~`FactsPresentation = "list" \| "graph"`~~ | **Withdrawn by spec 09** |

`targetRefs` and `mark` are unaffected by spec 09 and are current.

`thread:list` already answers with `ThreadWithMessages[]`, and `messages` is
every row for that thread — the whole point of that shape is to avoid a second
round trip. The trace itself needs no new call; it needs the renderer to stop
discarding what it is already given (§6.5). `debug:copy` is the exception and
not a contradiction of it: what it returns is not in `ThreadWithMessages` and
could not be, because none of it is a property of a thread — it is where main
put the run.

---

## 10. Where the code goes

```text
src/renderer/overlay/
├── App.tsx                 sidebar tab state, facts presentation state, trace open state
├── SidebarTabs.tsx         NEW — §3.1, the bar itself. It wraps both tabs, so it
│                           sits in App.tsx above them rather than inside either
├── Sidebar.tsx             §3.3 the comments tab
├── SelectionPanel.tsx      §3.2 — loses the 34vh cap, gains the clear row
├── CommentCard.tsx         §5 — anchor card, meta strip, turns, step strip
├── PlaceRows.tsx           NEW — §7.2
├── TraceSheet.tsx          NEW — §6
├── trace.ts                NEW — §6.5, the unfiltered selector and the per-tool argument
├── ModeStrip.tsx           NEW — §4.1, the three states of the foot strip
├── TopBar.tsx              §4.4 — loses Pick element and Pen
└── overlay.css             every class above

src/main/
├── debug.ts                NEW — §6.2, the report `debug:copy` returns
└── threads.ts              gains `agentCwd`, which `ipc.ts` used to keep private

src/shared/
└── totals.ts               NEW — §6.2, what a run cost, for both processes
```

Invariants I1, I2 and I3 are untouched: nothing here resolves an anchor outside
the renderer, nothing here reaches SQLite or the SDK from the renderer, and
nothing here opens a port.

---

## 11. Milestones

Each ends in something runnable, and each has acceptance criteria you can run.

### Milestone 0 — the tab bar

`Sidebar.tsx` grows the tab bar; the selection panel moves inside the Selection
tab; the filter chips move inside the Comments tab.

- [ ] The bar is present with nothing selected, `Selection` dimmed and reading `0`.
- [ ] Building a selection of twenty places scrolls inside the tab and pushes
      nothing off the bottom.
- [ ] `Ask` empties the selection and returns the active tab to `Comments`.
- [ ] `clear` sits at the head of the Selection tab and still confirms above
      three places or once a note is typed.

### Milestone 1 — the mode strip

`ModeStrip.tsx`; `TopBar.tsx` loses two buttons.

- [ ] The resting strip shows both chips, clear of the gutter.
- [ ] `P`, held `⌥`, `N` and `esc` behave exactly as before.
- [ ] Pick mode replaces the chips with the path bar; pen mode with the pen bar.
- [ ] The top bar holds only what §4.4 lists.

### Milestone 2 — the card

The meta strip, the turn blocks and the step strip.

- [ ] Every value in the meta strip matches the database for that thread.
- [ ] A denied write shows as a taller red bar in the strip and `· 1 denied`.
- [ ] The answer is the only block at full contrast.

### Milestone 3 — the trace sheet

`TraceSheet.tsx` and `trace.ts`.

- [ ] `show trace ›` covers the document pane and nothing else.
- [ ] The comment card stays beside it and the reply box still works.
- [ ] `esc` closes it.
- [ ] Thinking appears here and nowhere else.
- [ ] The denied block is open without being asked.
- [ ] `debug` copies a report whose `sdk log` path **exists on disk** — the one
      check that cannot be made by reading the code, because a path that is
      merely well-formed is exactly the failure it has to rule out.
- [ ] The report's totals match the summary in the bar above the button.

### Milestone 4 — places

`PlaceRows.tsx`, `go to ›`.

- [ ] A comment with two places in two documents shows two rows.
- [ ] Pointing at a live row numbers its mark in the document, in violet.
- [ ] A place in an unopened document reads `not checked here`, never
      `anchor lost`, and is not counted as an orphan.
- [ ] Clicking it opens that document and scrolls there.

### Milestone 5 — Facts *(withdrawn by spec 09)*

Implemented, then removed. Spec 09 milestone 0 is what replaced it, and its
acceptance criteria are the inverse: the segment reads `Document | Graph`, `F`
does nothing, and `Graph` mode draws the reference graph alone.

---

## 12. Non-goals

| Rejected | Why |
|:--|:--|
| A `Trace` peer beside `Document` and `Graph` | That segment is a workspace switch; a trace belongs to one comment. §6.1 |
| ~~A tooltip for a finding's notes~~ | Moot — spec 09 removed findings |
| ~~A fourth topic colour~~ | Moot — spec 09 removed topics |
| Keeping `Pick element` in the top bar | It is a mode, and a mode belongs where it acts. §4.3 |
| Showing thinking in the card | The answer outranks the machinery. §6.5 |
| Persisting `PlaceRow` | It is derived from anchors that already exist. §7.2 |
| A new IPC channel for the trace | `thread:list` already answers with every message. §9 |

---

## 13. References

- The design canvas: `claude.ai/design/p/9b19911a-ae55-44e3-ac02-916e2d0de437`,
  and its `design-source/README.md`, which is the authority on which parts of
  the boards are proposals and which are records of the code.
- Spec 05 §3.2 and §3.3 — what the panel holds, and the maximum height §3 of
  this document removes.
- Spec 06 §5 the pen, §6.1 the path bar and §6.3 the pen's toolbar — whose
  controls §4 moves without changing any of them.
- Spec 01 §7 — the user interface table, whose "comment card" row §5 and §6
  split in two.
- Spec 07 §8, §11 — the fact graph interface and its trust rules, which §8
  amends in one place and obeys everywhere else. **Both are withdrawn**; see
  [09 — removing the fact graph](../09-removing-the-fact-graph/SPEC.md).
