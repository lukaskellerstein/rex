# REX 38 — the trace block

**Version:** 1.1 · 2026-09-02
**Status:** **built, and driven in a live window.** All five milestones are in
the tree; `npm run test:trace` is 12 tests green, `npm run test:place-line` 10,
`npm run test:tool-rows` 5, `npm run typecheck` passes and
`nvim-tools --json --all` adds no finding. §7 milestone 4 was run on
2026-09-02 against an isolated REX on port 9444 holding a clone of the real
database — §10 records what it showed.

> [!note]
> **1.1 adds §3.7, the answer's prose.** Read on the built 1.0, the answer's
> Markdown was hard to read: a black chip for every citation, a table with no
> visible lines, on a blue ground. Three rules in `overlay.css` change; nothing
> else does.
**Depends on:** [`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md)
§5.4 (the step strip), §6 (the trace sheet), §6.3 (the entries and their
folds); [`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md) §3.3 (the mode a
message was sent in), §7.3 (the mode beside DENIED);
[`14-naming-order-groups/SPEC.md`](../14-naming-order-groups/SPEC.md) §3.4 (the
name is the headline); [`24-pointing-mid-conversation/SPEC.md`](../24-pointing-mid-conversation/SPEC.md)
§3.2 (the pending strip), §3.4 (the places a `YOU` turn brought), §5.1
(`messageId` on a target); [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
§7.1 (the composer), §7.3 (the model in the answer's foot);
[`31-how-the-agent-writes/SPEC.md`](../31-how-the-agent-writes/SPEC.md) §5 (the
style beside it), §7.1 (the style picker); [`33-the-comment-row/SPEC.md`](../33-the-comment-row/SPEC.md)
§2.2 (the run line); [`35-the-card-head/SPEC.md`](../35-the-card-head/SPEC.md)
§2.3 (a place in cells); [`36-tools-in-the-chat/SPEC.md`](../36-tools-in-the-chat/SPEC.md)
§2 (the numbers on the run line), §3.1 (a change is a pencil);
[`37-the-composer-foot/SPEC.md`](../37-the-composer-foot/SPEC.md) §3 (the
first turn's places).

> [!note]
> **This spec redraws every block of the trace sheet, its head and its foot.**
> A tool call becomes a head and stacked rows — `INPUT`, `CHANGE`, `OUTPUT` —
> each shut to one line. `YOU` carries the mode pill and the places it came
> with. The answer's foot names the model and the style. The head is the
> comment's name and the card's run line. The foot is the card's composer,
> lifted into one component the two surfaces share. Nothing is stored and no
> channel changes.

---

## 1. Why

Measured on 2026-09-02 on comment 4, *Work item states*: 72 steps, four
failed reads, one `Edit`. The reviewer read the trace and named five things.

### 1.1 The answer does not say what wrote it

The card's foot says `Fable · Concise` (spec 25 §7.3, spec 31 §5). The sheet's
`ANSWER` block says nothing. *"I do not see what model generated the answer
and what output style was used."*

### 1.2 The question does not say how it was sent

The card's `YOU` turn wears the ASK / ACT / NOTE pill (spec 12 §3.3). The
sheet's `YOU` block does not. *"In the user message I do not see in what mode
this message was sent."*

### 1.3 A tool block's head is a piece of its input

`BASH`, then one mono line of the command, then `▸ input · 107 chars` and
`▸ output · 12 lines` side by side. A `READ` has no `input` fold at all — its
path is short, so the line is the whole of it — and the reviewer could not
tell where the input had gone. *"In some messages and tools, like read, we do
not have the input at all; we only have a line that represents the name of the
file. I would expect that to also be included in the input section."* And the
two folds: *"I would prefer to see them stacked on top of each other rather
than side by side."*

### 1.4 The question does not say what it was about

The card draws the places a `YOU` turn brought as pills (spec 24 §3.4, spec 37
§3). The sheet draws none. *"Only the selection IDs are not enough. I think we
should show similar information as we are showing now in chat."*

### 1.5 The foot is a box and a button

The card's foot has the mode switch, the model, the style and Send under the
box. The sheet's has a box with Send beside it and no choice at all. *"The send
button should be below it, not next to it. I should also be able to select the
mode, the model, and the style."*

### 1.6 The head says the note, the mode and a pill

`TRACE`, then the note's first line — which is the first `YOU` block, one
scroll below — then `● 4 FAILED`, then `MODE ASK · cannot change any file, by
any route`. *"I don't know what the text means. We definitely do not need the
mode ask. Instead we should show not only how many failed but how many
succeeded as well."*

---

## 2. The head

```text
④ TRACE  Work item states        ▁▁▁▁▁▁▁▁▁▁  72 steps ✓68 ⚠4 · 32 turns · 17m · $12.043   debug   close esc
```

The token, `TRACE`, and the comment's **name** from `commentName()` (spec 14
§3.4) — never the note. Then the card's run line (spec 33 §2.2, spec 36 §2):
the bars, `72 steps`, the marks, and `32 turns · 17m · $12.043` in faint mono.
Then `debug` and `close esc` as they are.

### 2.1 The marks gain the succeeded count

`RunNums` draws `✓68` before `⚠4` and `⊘N`: a check and the count of calls
that ran and succeeded, in the muted grey, so the three marks add up to the
step count. The list row and the card head draw the same component, so they
gain it too. Marks and not words, for spec 33 §2.2's reason.

### 2.2 What leaves the bar

The note. The `MODE ASK · …` line: the pill on every `YOU` block says the mode
per message, which is the only honest place for it now that a thread can be
asked in one mode and changed in another. The `N FAILED` and `N DENIED` pills:
the marks beside the bars say it, once.

### 2.3 What gives way on a narrow pane

The bars first, down to the 1px each keeps; then the numbers; then the name,
never below ten characters. The marks and the two buttons survive. Version
1.0 said the name goes first, and the live run (§10) showed what that means
in flexbox: a basis of zero, and on a 700px pane the name was drawn as
nothing while the bars kept every pixel.

---

## 3. The blocks

### 3.1 Every block

A glyph in the gutter, a label, and the **clock** at the right — always the
time of day, one aligned column down the whole trace. The duration and the
tokens that used to take the corner on a block that had them belong to the
`completed` row, which is drawn nowhere; in practice every block showed the
clock already, and now the rule says so.

### 3.2 `YOU`

```text
◯ YOU  ASK                                                            13:06
The reviewer's words, verbatim.
───────────────────────────────────────────────────────────────────────────
PLACES 2
 ▪4  lukas-feedback.md    │ L794–812 │ 19 lines │ section           go to ›
 ▪5  lukas-feedback.md ?  │ L954     │ 1 line   │ table row         go to ›
```

The mode pill after `YOU`, from `message.mode` — the same `.rex-sent` pill the
card draws, in the same three colours. No pill when the mode was not recorded.

Under the text, when the message brought places: `PLACES n`, then one line
per place in the card head's cells (spec 35 §2.3) — the violet square, the
file, `where`, `size`, `kind`, `was`, `not checked here` — and `go to ›`.
Which places belong to which message is spec 24 §5.1's `messageId`, completed
by spec 37 §3: the places with none belong to the first `YOU` block. The cells
come from `placeCells` with the same facts the card gets, so the sheet and the
head cannot describe one place differently.

### 3.3 A tool call

```text
▸_ BASH  Verify cited line ranges in components.md                    13:07
   ▶ INPUT   sed -n '1582,1614p;592,595p' /Users/…/components.md   2 fields
   ▶ OUTPUT  | `change_set_id` | string | The change set …          70 lines
```

**The head** is the glyph, the tool's name, and — when the input carries a
string field named `description` — that sentence, in `--fg-dim`. It is the
agent's own one-line account of the call, and down a run of thirty blocks it
is what the eye scans. Nothing else from the input reaches the head. `· FAILED`
and `· DENIED · ASK MODE` ride the label as they do today.

**The rows** are stacked, one per side, in this order: `INPUT`, `CHANGE`
(§3.4), `OUTPUT`. A row is one button. Shut, it reads: a triangle, the word,
one line of **preview** in mono cut at 96 characters, and a **count** at the
right. Open, the preview goes and the content sits under the row, indented to
the word.

| Row | Preview | Count | Open |
|:--|:--|:--|:--|
| `INPUT` | `argumentOf` — the command, the path, the pattern | `N fields` | every field of the input, as key and value, in a mono grid. Values wrap. A value that is not a string is printed as JSON |
| `CHANGE` | `−a +b`, the removed and added line counts in the diff's two colours | `N lines` | the diff, `-` lines in the removed red and `+` lines in the added green |
| `OUTPUT` | the first non-empty line of the result | `N lines`, or `N chars` for one line | the result, in the mono well, capped at 22rem and scrolling |

A row that has nothing is not drawn: a call with no result yet has no
`OUTPUT`, and only a change has a `CHANGE`.

**A field the `CHANGE` row draws is not repeated in `INPUT`.** `old_string`,
`new_string` and `content` are the diff; listing them again as raw text would
say one change twice, once unreadably. Every other field is listed —
`file_path`, `offset`, `limit`, `replace_all`, `description`, `url`, `prompt`
— so a `Read` finally has an `INPUT` row with its path in it.

**What opens by itself** is the rule spec 08 §6.3.1 set: a `DENIED` block
opens its `INPUT`, a `FAILED` block opens its `OUTPUT`, and everything else is
shut. The `DENIED` block keeps its reason sentence above the rows.

### 3.4 The `DIFF` block folds into its change

`runner.ts` writes a `diff` row for every `Edit` and `Write`, made from the
call's own `old_string` and `new_string` (`diffStep`) or `content`
(`writeStep`), with the path on its first line. The sheet drew it as a second
block that printed the path a second time.

Now a `diff` row attaches to the most recent tool entry that is a change
(spec 36 §3.1's `glyphOf` says which) and has no change yet, and becomes that
entry's `CHANGE` row. A `diff` row with no such entry above it — a transcript
the rule cannot pair — stays a block of its own, drawn as today.

### 3.5 `ANSWER`

The prose, then a foot: the model's display name and the style, in the
register the card's foot uses (spec 25 §7.3, spec 31 §5) — `Fable · Concise`
— and nothing else. Spec 36 §2 moved the numbers to the head; the sheet's head
already had them. An `ASIDE` gets no foot, as on the card.

### 3.6 What an old transcript shows

A message written before `mode`, `model`, `style` or `messageId` existed has
null in them, and null draws nothing: no pill, no foot, no places. The card's
rule, for the card's reason — inventing a value would say more than is known.

### 3.7 The answer's prose

Measured on 2026-09-02 on the built 1.0, on an answer with forty citations
and a seven-row table. The reviewer's words: *"anything that is in the
backticks has the black background and white text. The table does not show
the border correctly."* Three rules were the cause, and three rules change.

| What | Was | Is |
|:--|:--|:--|
| The answer's ground in the sheet | `--wash-ok-on`, a blue tint | `--sunk`, the card's ground. The lit blue edge and the left bar stay — they are the answer's rank; the wash was a third mark for the same fact |
| Inline code | the well (`#08090a`) with `--fg-dim` text — a black chip | a translucent tint, 8% white, and the voice's own colour. One rule reads the same on the sheet's answer, the card's answer and an aside, where the well-on-well chip was invisible |
| A table | a `--rule-soft` hairline on every cell — one colour with the ground | rules between the rows only, 11% white; a 24% rule and a 4% fill on the header; no vertical lines, because a grid of small boxes turns a column that holds a paragraph into a form |

The mockup that settled it showed the same answer three ways — as it was, the
tints on the blue wash, and the tints on the card's ground — and the reviewer
chose the third.

---

## 4. The foot is the card's composer

```text
PLACES 1 · with this reply                                    new comment ›
 ▪6  Paragraph · “The Materializer validates…”   components.md         🗑
┌──────────────────────────────────────────────────────────────────────────┐
│ Reply to this thread                                                     │
└──────────────────────────────────────────────────────────────────────────┘
 ASK  ACT  NOTE  ⇧⇥                              ⌄ Fable   ⌄ Concise   Send ctrl↵
```

The card's reply block — the pending strip (spec 24 §3.2), the grip, the box,
the row with the mode switch, the model, the style and the button, and the
*"This edits …"* line under ACT — is lifted into one component, `Composer`,
and drawn by the card and by the sheet. The sheet passes the same state the
card gets, so a mode picked in one is the mode the other shows: both read
`modeOf(threadId)` and both write through `setMode`. The sheet's one rule of
its own stays: inside its box the first `esc` leaves the box and the second
closes the sheet.

The box grows and the send sits **under** it, as on the card. The row that
put Send beside the box (spec 08 §6) is gone.

---

## 5. Where the code goes

| File | Change |
|:--|:--|
| `renderer/overlay/trace.ts` | `TraceEntry` gains `sent`, `model`, `style`, `what`, `fields`, `change`, `result`; `fieldsOf`, `previewOf`, `changeCounts`; `traceOf` attaches a `diff` row to its change (§3.4). Pure, so `node --test` loads it |
| `renderer/overlay/placeLine.ts` | `placesByMessage(targets)` — spec 37 §3's rule as data, shared by the card and the sheet |
| `renderer/overlay/Composer.tsx` | **new** — §4, lifted out of `CommentCard.tsx` |
| `renderer/overlay/CommentCard.tsx` | draws `Composer`; `placesOf` reads `placesByMessage`; `PendingStrip` moves to `Composer.tsx` |
| `renderer/overlay/TraceSheet.tsx` | §2 the head; §3 the blocks and the rows; §4 the foot |
| `renderer/overlay/StepStrip.tsx` | `RunNums` draws `✓N` (§2.1) |
| `renderer/overlay/App.tsx` | the sheet gets the card's `targetPlaces`, `targetStates`, `openDocumentId`, `models`, `model`, `style`, `mode`, `pending` and their handlers |
| `renderer/overlay/overlay.css` | the rows, the fields grid, the change, the places under `YOU`, the foot; `.rex-trace-line`, `.rex-trace-folds`, `.rex-trace-toggle`, `.rex-trace-mode-line`, `.rex-trace-note`, `.rex-trace-summary`, `.rex-trace-reply`, `.rex-trace-send` deleted |
| `test/trace.spec.ts` | **new** — the fields, the previews, the counts, a diff attached to its Edit and one left alone, the mode and model on the entries, places by message |
| `package.json` | `test:trace` |

---

## 6. What this does not change

- **What a comment stores.** No column, no channel. Every fact drawn here has
  been in `message` and `thread_target` since spec 12, 24, 25 and 31.
- **The card's blocks.** Its `YOU` pills stay pills; the cells are the sheet's
  and the head's.
- **The step bars.** One bar per call, as spec 08 §5.4 drew them.
- **`totalsOf`.** The head reads the same helper the card head does.
- **The debug report.**

---

## 7. Milestones

**0 — the data, with tests.** `trace.ts`, `placesByMessage`,
`test/trace.spec.ts`. *Done when:* `npm run test:trace` and
`npm run test:place-line` are green.

**1 — the composer.** `Composer.tsx` lifted; the card draws it and looks
exactly as it did. *Done when:* `npm run typecheck` passes.

**2 — the sheet.** §2, §3, §4 in `TraceSheet.tsx`; `RunNums`; `App.tsx`.
*Done when:* `npm run typecheck` passes.

**3 — the stylesheet.** *Done when:* `nvim-tools --json --all` adds no finding.

**4 — driven in a live window.** Comment 4's trace: a `YOU` with places, a
`Read` with its `INPUT`, a failed `Read`, the `Edit` with its `CHANGE`, the
answer's foot, the head, the composer. *Done when:* §8 is checked by eye.

---

## 8. Acceptance

- [ ] The head reads `④ TRACE Work item states`, then the bars, `72 steps ✓68 ⚠4 · 32 turns · 17m · $12.043`, `debug`, `close esc`. No note, no mode line, no pill.
- [ ] The card head and the list row show `✓68` beside `⚠4`.
- [ ] A `YOU` block wears its mode pill; one sent before the mode was recorded wears none.
- [ ] The first `YOU` block lists the places the comment started with, in cells with `go to ›`; a later reply with new places lists its own.
- [ ] A `READ` block has an `INPUT` row whose preview is the path and whose open state lists `file_path` and, when given, `offset` and `limit`.
- [ ] A `BASH` block's head carries its `description`; its `INPUT` row's preview is the command.
- [ ] An `EDIT` block has `INPUT`, `CHANGE` and `OUTPUT` rows in that order, and no `DIFF` block follows it. `CHANGE` previews `−a +b` and opens to the diff.
- [ ] A failed `READ` opens its `OUTPUT`; a denied call opens its `INPUT`.
- [ ] Every answer's foot reads the model and the style, and nothing else.
- [ ] The sheet's answer sits on the card's ground with the lit blue edge; a citation is a light chip in the prose's own colour; a table shows a rule under its header and between its rows, and none between its columns.
- [ ] The sheet's foot is the box, then the mode switch, the model, the style and Send. Switching the mode in the sheet switches it on the card.
- [ ] `npm run test:trace`, `npm run test:place-line`, `npm run test:tool-rows`, `npm run typecheck` pass; `nvim-tools --json --all` adds no finding.

---

## 9. Rejected

**The run's numbers in the answer's foot.** `Fable · Concise · 28 steps ·
6.2m · $4.113` was the first mockup. The reviewer sent them to the head:
*"I think we should show it in the top bar and not in the last answer."* Spec
36 had made the same move on the card the same day.

**Only `68 ok · 4 failed`, no total.** The card's line says `72 steps`, and the
sheet's head is that line. The marks were added beside it rather than
replacing it, so the two surfaces stay one component.

**The quote under a `YOU` place.** Spec 35 §1.2 took the quote off the head
because a head is not where anyone reads a document, and the same holds one
pane wider. The cells say where and how big; the paper says what.

**A second composer for the sheet.** Two reply blocks with two sets of
controls drift, and spec 08 §6 already learned that the sheet's box and the
card's box must send through one handler. One component finishes the thought.

**`old_string` and `new_string` in `INPUT`.** They are the change, and the
`CHANGE` row draws them as one.

**The tints on the blue wash** (1.1). The same code and table fix with the
answer's ground kept. It reads, but the answer is then the one block whose
fill says a thing its edge already says, and the card's answer — the same
text — sits on the neutral ground. One ground for one answer.

---

## 10. What the live run showed

Run on 2026-09-02 on an isolated REX (port 9444, a clone of the reviewer's
database with the documents copied to scratch and repointed), on comment 4,
*Work Item states* — 72 steps, 32 turns, 16 `YOU` blocks, 11 `Edit` calls,
four failed calls — with the explorer and the card open, so the sheet had a
700px pane.

| Surface | What it said |
|:--|:--|
| The head | `④ TRACE Work Item states`, the bars, `72 steps ✓68 ⚠4 · 32 turns · 17m · $12.043`, `debug`, `close esc` |
| The card head and the list row | `72 steps ✓68 ⚠4` |
| The blocks | 113: 16 `YOU`, 16 `ANSWER`, four `FAILED`, no `DIFF` — every one of the 11 diffs became its `Edit`'s `CHANGE` row |
| The rows | 72 `INPUT`, 11 `CHANGE`, 72 `OUTPUT` |
| The first `YOU` | the `ASK` pill, then `PLACES 3`: `1 user-interaction-flow.md │ whole file`, `2 components.md`, `3 overview.md` — the places it started with |
| Two later `YOU`s, sent as `ACT` | the red `ACT` pill and one place each, the ones those messages brought |
| A `READ` | `INPUT /Users/…/user-interaction-flow… 1 field`, shut; open, `file_path` and the path. `OUTPUT 1 # User Interaction Flow 102 lines` |
| A `BASH` | `BASH List architecture docs` in the head; `INPUT ls -la /Users/…` below it |
| The `EDIT` | `INPUT … 2 fields`, `CHANGE −40 +1 41 lines`, `OUTPUT The file … 198 chars`; the change opened to red and green lines |
| A failed `BASH` | `BASH · FAILED`, its `OUTPUT` open on `Exit code 1` |
| Every answer's foot | `Default (recommended) · Concise` |
| The foot | the box, then `ASK ACT NOTE ⇧⇥ … ⌄ Default (recommended) ⌄ Concise Send ctrl↵`. `ACT` pressed in the sheet turned the card's switch to `ACT`, both buttons to `Change`, and drew *"This edits …"* under both; `ASK` pressed on the card turned the sheet back |

One thing the run taught: **`flex: 1` is a basis of zero.** The name was
drawn as nothing on the first launch, because the bars beside it had a real
basis and it had none. §2.3 now says the order, and the stylesheet gives the
bars a shrink of four, the numbers two, and the name a floor.
