# REX 33 — the comment row

**Version:** 1.0 · 2026-09-02
**Status:** **built, and driven in a live window.** All four milestones are in
the tree; `npm run test:comments` is 55 tests green, `npm run typecheck` passes
and `nvim-tools --json --all` adds no finding. §7 milestone 3 was run on
2026-09-02 against an isolated REX on port 9444 holding a copy of the real
database — §9 records what it showed.
**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§5.1 (a comment is about several places), §5.3 (the list is the workspace's,
so every row names its documents), §5.4 (`null` is not orphaned);
[`06-document-section-and-pen/SPEC.md`](../06-document-section-and-pen/SPEC.md)
§4.3 (a section or a whole document as a place);
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §5.4 (the step
strip: one bar per tool call); [`12-ask-and-act/SPEC.md`](../12-ask-and-act/SPEC.md)
§3.3 and §7.1 (the mode's colour on the switch and the `YOU` pill);
[`14-naming-order-groups/SPEC.md`](../14-naming-order-groups/SPEC.md) §3.4 (the
headline is the name); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md)
§3.2 (`stopped` on the row); [`18-what-the-colours-mean/SPEC.md`](../18-what-the-colours-mean/SPEC.md)
§2.1 (`moved` is not a lane), §3 (the vocabulary);
[`30-drafts-and-the-comment-list/SPEC.md`](../30-drafts-and-the-comment-list/SPEC.md)
§2 (five lanes), §6 (a shape, not a hue);
[`32-one-lost-place/SPEC.md`](../32-one-lost-place/SPEC.md) §2 (a comment is
lost only when every place is), §2.2 (the word is a count).

> [!note]
> **This spec redraws one component and moves one colour.** The comment list
> row stops quoting its first place and starts counting all of them, per file.
> The wash a row wears follows its lane and nothing else. Yellow stops meaning
> "a place moved" and starts meaning "a note". No table changes and no channel
> changes: every fact the new row prints is already in the renderer.

---

## 1. Why

Measured on 2026-09-02, on the reviewer's own list of thirteen open comments
over four documents.

### 1.1 The row shows one place of five

`ThreadRow` quotes `thread.targets[0]` and only it. Comment 4 is about five
places in four files; its row says **The whole document** — the first place —
and nothing about the other four. Comment 14 is about six whole files and its
row says the same three words. Spec 05 §5.1 gave a comment many places two
months ago, and the row never caught up.

### 1.2 The prompt repeats the name

Spec 14 §3.4 made the name the headline. The row still prints the note under it
whenever the two differ, so a named comment is five lines: name, prompt, place,
files, meta. The reviewer's words: *"the first prompt … is not needed anymore
because the name represents what the comment stands for."*

### 1.3 Amber is the loudest wash for the least important fact

A comment with one lost place out of five washes amber (spec 32 §2.1), and
amber is the most saturated wash on the panel. So the row a reviewer's eye
lands on first is the one whose only news is that a heading was renamed. The
reviewer's words: *"we are highlighting the comments that has some lost
selections which I don't think is that important."*

The fact is worth printing. It is not worth a colour.

---

## 2. The row — three lines

```text
④ Work Item states
  user-interaction-flow.md [whole]   components.md [2] [?1]   overview.md [1]   lukas-feedback.md [1]
  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  72 steps  (!)2  (⊘)1                                   answered
```

The token and the name stay exactly as spec 14 §3.4 drew them. Everything
under the name is replaced.

### 2.1 The files — one chip per file, every place counted

One chip per **distinct file**, in target order, each carrying the file name in
the same monospace the old line used and one or two marks after it:

| Mark | Meaning |
|:--|:--|
| `2` | two places in this file |
| `whole` | a place that is the whole file — `anchor.extent === "document"` |
| `whole` `+2` | the whole file, and two more places in it |
| `?1` | one place in this file is lost. Grey, the tree's own glyph for gone (spec 18 §3) |

The chips wrap. A six-file comment takes three lines at the sidebar's default
width and six at its minimum, which is the honest height of a comment about six
files.

**A moved place gets no mark.** Spec 18 §2.1 already gives it none in the tree:
it is one click away and nothing is wrong with it. The card still says
`L41 was L37` per place.

**The denominator is not printed.** `?1` beside `2` on `components.md` means one
of that file's two places is lost; a reviewer who wants the fraction has it.
Spec 32 §2.2's `1 of 4 lost` stays on the card head and its pill, where there is
room for the sentence.

### 2.2 The run — the card's own bars

The third line is the step strip spec 08 §5.4 drew on the card: one bar per tool
call, in order, red where a call failed, red and taller where the gate refused
one. Beside it the count, and beside the count the two failure kinds as the
trace's own marks — a circled `!` for a call that failed, a barred circle for a
call the gate refused — each with its number, in red. Hovering either names it
in words.

The marks replace `2 failed · 1 denied` because the words did not fit. At the
sidebar's 300px minimum, `72 steps · 2 failed · 1 denied` broke inside itself
and put `denied` on a line of its own, under nothing.

Three rules keep the line whole at every width:

1. **The bars shrink before anything wraps.** Each bar is 3px wide and may
   shrink to 1px. A 72-step run is 287px at rest and 143px at the narrowest,
   and it is never clipped — a truncated strip is a picture of a shorter run,
   and the bar it drops may be the red one.
2. **The numbers never break inside themselves.** They are one non-wrapping
   unit.
3. **When bars and numbers do not fit one line, the numbers move under the
   bars**, as a unit, and the bars take the line they had. The corner word
   moves with the numbers.

A draft and a note have no run and draw no third line. An open comment whose
run has not produced a tool call yet draws none either.

### 2.3 The corner word — only what is not the normal case

The right end of the last line carries one word, or nothing:

| Row | Corner |
|:--|:--|
| open, answered | *nothing* |
| open, running | `working…` with the spinner |
| open, last run stopped by the reviewer | `stopped` — red, spec 17 §3.2 |
| open, last run ended in an error and nothing answered | `error` — red |
| draft | `draft` — blue |
| note | `note` — yellow |
| resolved | `resolved` — green |
| gone, every place lost | `anchor lost` — grey |
| synthesis | `synthesis of N` |

`answered` is gone. The bars already say the run happened, and a list of
thirteen answered comments each saying `answered` was a column of one word.
`not asked` is gone too: since spec 30 an open comment has always been sent, so
the words were never true of one.

### 2.4 What leaves the row

- The note under the name (`rex-thread-prompt`). The name is the headline.
- The first place's quote or kind block. Every place is now counted.
- The joined document line. The chips name the files.
- The state word before the progress — `1 of 4 lost`, `text moved`. It is a
  mark on a chip now, and the card keeps the sentence.

---

## 3. The colours — one hue per lane

### 3.1 The wash follows the lane, never a place

`wash.ts` keeps deciding the row, the token and the margin bar in one place. Its
`moved` branch goes from all three functions: a comment with a moved or a
part-lost place wears the plain open look, blue token and all.

| Lane | Wash | Token | Was |
|:--|:--|:--|:--|
| draft | none, dashed blue edge | dashed blue | same |
| open | plain | filled blue | same |
| open, a place moved or lost | plain | filled blue | **amber wash, amber token** |
| note | **yellow** | hollow yellow | slate |
| resolved | green | hollow, green edge | same |
| gone | grey | filled grey | same |

`gone` keeps its wash. It is the one lane a reviewer cannot reach from the
paper (spec 32 §9), and grey is the quietest colour on the panel.

### 3.2 `moved` has no colour anywhere

With the row, the token and the margin bar gone, what is left of amber-for-moved
is a handful of words on the card and three marks on the paper. They lose the
colour too, so the word means one thing:

| Where | Was | Becomes |
|:--|:--|:--|
| card head, `re-found after the file changed` / `2 of 4 places re-found` | amber | `--muted` |
| card place row, `text moved` | amber | `--muted` |
| card place row, `was L37` | amber | `--muted` |
| card head pill, `TEXT MOVED` / `2 OF 4 MOVED` | amber pill | the quiet grey pill |
| diagram source line for a moved place (spec 29) | amber rule | the open comment's blue |
| lightbox mark for a moved place (spec 29) | amber stroke | the open comment's blue |
| Apply result, the `moved` count | amber number | `--fg-dim` |

The **`FILE CHANGED`** pill in the top bar, the notices, the warnings and the
strength meter's *fair* level stay amber. Those are warnings — a third
vocabulary beside spec 18's two — and this spec does not touch it.

### 3.3 Yellow means note, and ACT moves to red

A note is a sticky note, and the reviewer asked for it to look like one. Amber
is free on the lanes as of §3.1, so `--note`, `--note-text` and the four
`--wash-note*` tokens take the amber values. Every surface that reads them
changes with them: the row, the hollow token, the margin bar, the `note` chip's
count, the NOTE segment of the mode switch, the `NOTE` pill on a `YOU` turn, and
the Save button.

That collides with **ACT**, whose segment and pill are the same `#d9b23a`
(spec 12 §7.1: *"ACT is warm"*). Two of the three modes cannot share a colour —
spec 12 §3.3 is explicit that the switch reads back *"the same three names in
the same three colours"* — so ACT takes the write agent's red. Spec 18 §3 lists
*"the write-capable agent's tint"* among red's jobs already, and the **Change**
button has worn it since spec 12. The mode switch and the `YOU` pill catch up
with the button they sit beside.

| Mode | Segment and pill, was | Becomes |
|:--|:--|:--|
| ASK | `#4d84e8` | same |
| ACT | `#d9b23a` | `--lost` |
| NOTE | slate `--note` | yellow `--note` |

The number inside a note's margin bar turns dark, as the amber token's number
already is: white on `#d9b23a` does not read.

### 3.4 Resolved keeps its green, and says so

The reviewer likes the green. The wash, the green-edged hollow token and the
list's `done` chip stay. The row's corner says `resolved`, in the same green.

---

## 4. Where the code goes

| File | Change |
|:--|:--|
| `renderer/overlay/files.ts` | **new** — `filesOf(thread, states)`: the chips, as data. Pure, so `node --test` loads it |
| `renderer/overlay/ThreadRow.tsx` | §2. Takes `states: Array<AnchorState \| null>` instead of `tally` and `label`. `progressOf` becomes the corner word's rule. `StateWord` moves to `DiffDialog.tsx`, its only remaining reader |
| `renderer/overlay/wash.ts` | §3.1 — the `moved` branch goes from all three functions |
| `renderer/overlay/Sidebar.tsx` | carries `statesById` to the rows; `laneFor` tallies from it. `labelById` goes |
| `renderer/overlay/App.tsx` | hands `targetStatesById` down. `labelById` goes |
| `renderer/overlay/CommentCard.tsx` | the moved pill is the quiet pill (§3.2) |
| `renderer/overlay/overlay.css` | the row's chips and run; the note tokens repointed; ACT's two rules; every moved rule in §3.2; the dead `rex-thread-moved`, `rex-token-moved`, `rex-margin-moved` rules deleted |
| `test/comments.spec.ts` | `washClass("open", "moved")` is `""`; `filesOf` counts, dedupes, names the whole file and the lost |

The bars shrink through one change to `.rex-strip-bars i` — `flex: 0 1 3px;
min-width: 1px` — which the card strip and the trace head also read. Neither
exercises it: the card strip drops bars that do not fit (spec 08 §5.4) and the
trace head is a pane wide.

---

## 5. What this does not change

- **`shared/targets.ts`.** `tallyPlaces`, `threadState` and `placesWord` are
  unchanged; the lane rule from spec 32 stands. The row simply stops printing
  `placesWord`.
- **The card's place list.** One row per place, `L41 was L37`, `anchor lost`,
  `text moved` — all still there, in quieter colours.
- **The tree.** Spec 18 §4's five markers, untouched.
- **The gone lane.** Spec 32 §9.
- **Warnings.** §3.2's last paragraph.
- **What a comment stores.** No column, no channel.

---

## 6. Milestones

**0 — the data, with tests.** `filesOf` in `files.ts`; `wash.ts` loses its
`moved` branches; `test/comments.spec.ts` covers both.
*Done when:* `npm run test:comments` is green.

**1 — the row.** §2 in `ThreadRow.tsx`, the plumbing in `Sidebar.tsx` and
`App.tsx`, `StateWord` moved to `DiffDialog.tsx`.
*Done when:* `npm run typecheck` passes.

**2 — the colours.** §3 in `overlay.css` and the card's pill.
*Done when:* no rule in `overlay.css` reads `--moved` for a comment's state, and
`nvim-tools --json --all` adds no finding.

**3 — driven in a live window.** A workspace holding a part-lost comment, a
note, a resolved comment and a run with a failed call, at 384px and at 300px.
*Done when:* §7 is checked by eye.

---

## 7. Acceptance

- [ ] A comment about five places in four files draws four chips, in target
      order, and the counts sum to five.
- [ ] A whole-document place draws `whole`, not `1`.
- [ ] A file with two places, one lost, draws `2` `?1`. The row keeps the plain
      open wash and the blue token.
- [ ] No row, token or margin bar is amber for a moved or a part-lost comment.
- [ ] A note's row, token and margin bar are yellow, and its corner says `note`.
- [ ] The NOTE segment of the mode switch is yellow; the ACT segment is red.
- [ ] A resolved row keeps its green and its corner says `resolved`.
- [ ] A 72-step run with two failed calls and one refused draws 72 bars, two
      red, one red and taller, and `72 steps (!)2 (⊘)1`.
- [ ] At 300px the numbers sit under the bars on their own line, whole.
- [ ] No row prints the note, a quote, a kind block, or `answered`.
- [ ] `npm run test:comments` and `npm run typecheck` pass; `nvim-tools --json --all`
      adds no finding.

---

## 8. Rejected

**One line per file.** Read best of the three layouts tried, and a six-file
comment cost nine lines. The chips carry the same facts in three.

**Four stat tiles — files, places, steps, failed.** Always the same height, and
it says *how much* without *which file*. The file names went back to a faint
line under the tiles, which is the line this spec exists to replace.

**Keep `answered`.** See §2.3.

**Keep the note slate and give the row alone a yellow.** The Save button, the
NOTE segment and the `NOTE` pill would then disagree with the row they produce,
which is the disagreement spec 12 §3.3 was written to prevent.

**A second yellow for the note, so ACT keeps its amber.** Two yellows on one
panel are one yellow to a reader. §3.3.

**Time and cost on the row.** Tried in the mockup's wide column. Left off: it is
on the card's answer footer and the trace head, and the row is scanned, not
read.

---

## 9. What the live run showed

Run on 2026-09-02 on an isolated REX (port 9444, its own database — a clone of
the reviewer's, with every document repointed at scratch copies of the files),
driven over CDP with `playwright-core`, at the panel's default width, its 300px
minimum and 685px.

| Surface | What it said |
|:--|:--|
| Comment 4, five places in four files | `user-interaction-flow.md whole · components.md whole · overview.md whole · lukas-feedback.md 2 ?1`, then 72 bars with four red and `72 steps (!)4`. Plain wash, blue token |
| The same row at 300px | the bars alone on their line, `72 steps (!)4` under them, whole. Long file names ellipsised inside their chip |
| Comment 2, thirteen places | `components.md 12 · user-interaction-flow.md 1` — the count the old row could not show |
| The `open` lane's corners | nothing on any of the thirteen rows — every one is answered |
| The `note` lane | yellow wash, hollow yellow token, `note` in yellow at the corner. Its margin bar on the paper: `rgb(217, 178, 58)` with a dark number |
| The `draft` lane | dashed blue, `draft` at the corner; dashed blue margin bars, unchanged |
| The `done` lane | green wash, `resolved` in green; one row carries `?1` on its chip and keeps the green |
| The `gone` lane | grey wash, `anchor lost` at the corner, `?1` on the chip |
| The card's mode switch | ASK blue, **ACT red**, **NOTE yellow**; the Save button yellow-tinted |
| The card head | `anchored in 5 places · 1 of 5 lost` in grey, the place list unchanged |

Two things the run taught that the spec did not say:

1. **`rex-file` was taken.** The first build named the chips `.rex-file`, which
   is the diff dialog's file row, and every chip inherited its box. The row's
   parts are `rex-thread-file`, `rex-thread-file-name` and `rex-thread-mark`,
   in the row's own family. Grep `overlay.css` for a class before naming one.
2. **A planted `orphaned` state does not survive its document being opened.**
   The gone comment for the test was made gone by an `UPDATE` in the copy;
   opening its document re-swept it back to `ok` and `gone` went to `0`. That
   is spec 05 §5.4 working. Plant one on a document the test will not open.
