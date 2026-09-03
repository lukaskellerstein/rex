# REX 35 — the card head

**Version:** 1.0 · 2026-09-02
**Status:** **built, and driven in a live window.** All four milestones are in
the tree; `npm run test:place-line` is 10 tests green, `npm run test:markdown`
29, `npm run typecheck` passes and `nvim-tools --json --all` adds no finding.
§7 milestone 3 was run on 2026-09-02 against an isolated REX on port 9444
holding a clone of the real database — §9 records what it showed.
**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§3.2 (one row per place), §5.4 (`null` is not orphaned);
[`06-document-section-and-pen/SPEC.md`](../06-document-section-and-pen/SPEC.md)
§4.3 (a section or a whole document as a place), §4.4 (a run of blocks);
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §5.4 (the step
strip), §7.2 (a place is a row with two lines); [`14-naming-order-groups/SPEC.md`](../14-naming-order-groups/SPEC.md)
§3.4 (the name is the headline); [`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md)
§6.5 (a gap's line); [`32-one-lost-place/SPEC.md`](../32-one-lost-place/SPEC.md)
§2.2 (the word is a count); [`33-the-comment-row/SPEC.md`](../33-the-comment-row/SPEC.md)
§2.2 (the run line), §2.3 (the corner word), §3 (one hue per lane).

> [!note]
> **This spec redraws the pinned head of the comment card.** It stops quoting
> the document, stops saying in three places that one place is lost, folds the
> step strip into the head, and puts the head on its own ground so the chat
> stops reading as more of it. One new fact reaches the renderer — the last
> source line of a place — and it comes off the DOM the sweep already reads.

---

## 1. Why

Measured on 2026-09-02 on comment 4, *Work item states*: five places in four
files, one lost, 72 steps.

### 1.1 The head is a scrolling box, and the title scrolls out of it

`rex-card-places` caps the washed block and scrolls it, title included. Opened
on a five-place comment the card's first line is half a title, cut by the cap.
The reviewer's words: *"the work item states also look kind of not great."*

### 1.2 Five places take ten lines and quote the document

Each place is two lines: the address, then a quote in italic serif or a black
chip naming the block. Three of the five chips say **The whole document**. The
quote for place 4 is a 96-character heading, cut at the panel's edge. The
reviewer's words: *"I don't care, I don't have time to read it. It's still not
visible fully so that part should be gone for sure."*

### 1.3 One fact, said three times

`● 1 OF 5 LOST` in the header, *anchored in 5 places · 1 of 5 places lost*
under the title, and `anchor lost` on place 5. Spec 33 took the word off the
list row and left the card saying it three times.

### 1.4 The strip is a bar, and the chat is not a room

The step strip is a bordered bar under the head, on the head's ground. The
conversation then starts on the app's ground one hairline later, and the two
read as one column that happens to move in the middle.

---

## 2. The head

```text
④ Work item states                                       ✎    resolved
▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  72 steps (!)4                    show trace ›
▾ PLACES 5
 ▪1 user-interaction-flow.md   │ whole file │ 1018 lines             go to ›
 ▪4 lukas-feedback.md          │ L794–812   │ 19 lines │ section     go to ›
 ▪5 lukas-feedback.md ?        │ L954       │ 1 line   │ table row   go to ›
```

The head is the list row, opened. Three parts, in the washed block spec 08
drew, and only the third can scroll.

### 2.1 The title row

The token, the name, the pen — and at the right the lane word spec 33 §2.3
gives the row's corner: `resolved`, `note`, `draft`, `anchor lost`, `stopped`,
`error`, or nothing. `cornerWord` decides it for both surfaces, so the card and
the row cannot disagree about one comment. The head no longer says *anchored in
5 places* or counts the lost ones: the places below say it, one line each.

### 2.2 The run

Spec 33 §2.2's line, verbatim: the bars, `72 steps`, the two red marks with
their counts, and `show trace ›` at the right end — `showing` while the trace
is up. The bordered strip under the head is gone. `RunNums` is one component
drawn by the row and the head, so the two cannot count differently.

### 2.3 The places — one line each, in cells

```text
 ▪4  lukas-feedback.md  │ L794–812 │ 19 lines │ section │ was L790     go to ›
```

| Cell | Holds | Colour |
|:--|:--|:--|
| number | the place's index, a **square** | violet, as on the paper |
| file | the file name, and the grey `?` when the place is lost | `--fg`, mono, medium |
| where | `L794–812`, `L954`, `page 3`, `slide 4` as a raised badge — or `whole file`, outlined | `--fg-dim` |
| size | `19 lines`, `1 line`, `1018 lines` | `--fg-dim` |
| kind | `section`, `table row`, `code block`, `passage`, `figure`, `gap`… | `--muted` |
| was | `was L790`, when the place is somewhere else than it was written | `--muted` |
| not checked | `not checked here`, when nobody has looked (spec 05 §5.4) | `--faint` |

A hairline stands between the cells. The where and size cells have a minimum
width, so the hairlines line up down the list. **No quote and no heading
text**: the head says where a place is and how big, never what it says — the
paper says that, one `go to` away.

At the panel's default width the cells sit under the file name as one line,
indented to it, with the first hairline dropped. From about 480px they sit
beside it. A container query on the head decides, so dragging the splitter
moves them.

A comment about one file still lists it. A synthesis comment lists `synthesis
of N comments` and nothing else.

### 2.4 The list folds

`▾ PLACES 5` above the list toggles it. Open by default for one or two places,
folded above that: the ones with a long list are the ones where the run and
the name say enough, and the list is one click away. The choice lasts while
the card is open on that comment and resets on the next one.

Only the list scrolls past a cap. The title and the run never do.

### 2.5 The header loses its pills

`● 1 OF 5 LOST` and `● RESOLVED` go. The `?` on the file cell carries the
loss; the lane word on the title row carries `resolved`; the button beside them
already says *Reopen*. Resolve, debug and delete stay.

### 2.6 The head is a room of its own

The head moves to the `--well` ground with a shadow onto the chat, and the chat
moves up from `--bg` to `--panel`. The composer keeps its ground and its rule.
Three surfaces, stepped: the darkest is pinned, the middle one scrolls, the
panel's own holds the box you type in.

---

## 3. Where a place's last line comes from

The Markdown renderer stamps every block with the line it **starts** on
(spec 01 §5.3). The line a block ends on is the next stamped block's start
minus one — the rule `blockLineCount` in `anchoring.ts` already applies to
gaps (spec 16 §6.5). This spec applies it to every place:

| Resolution | First line | Last line |
|:--|:--|:--|
| a range | the block its start is in | the block its end is in, to that block's end |
| an element | its stamped block | the same block's end |
| a diagram part | the part's own line (spec 29 §5.4) | the same line |
| a run — a section, a whole file | `first` | `last`, to its end |
| a gap | its lower neighbour's line | none — a gap has no extent |

**The last block in a file has no next block.** `blockLineCount` returned 1 for
it, which was honest for a gap and wrong for a 30-line closing section. The
renderer now writes the file's line count on `<body data-src-lines>`, and the
last block ends there. A DOCX page carries no stamp and no count, as before.

`CheckedTarget` gains `lineEnd: number | null`, `App.tsx` carries it to the card
beside `line`, and nothing is stored: a place in a file that is not open shows
its stored start line and `not checked here`, exactly as today.

---

## 4. Where the code goes

| File | Change |
|:--|:--|
| `renderer/overlay/placeLine.ts` | **new** — `placeCells(anchor, facts, state)`: §2.3's cells as data. Pure, so `node --test` loads it |
| `renderer/overlay/anchoring.ts` | `lineEnd` on every checked target; `sourceLineEndOf`; `blockLineCount` reads `data-src-lines` for the last block |
| `main/render/markdown.ts` | `sourceLineCount(source)` |
| `main/render/index.ts` | `markdownPage` stamps `data-src-lines` on `<body>` for Markdown |
| `renderer/overlay/App.tsx` | `targetPlacesById` carries `lineEnd` |
| `renderer/overlay/StepStrip.tsx` | `RunNums`, shared by the row and the head; `StepStrip` deleted |
| `renderer/overlay/ThreadRow.tsx` | draws `RunNums` |
| `renderer/overlay/CommentCard.tsx` | §2: the title row, the run, the cells, the fold; `PlacesPill`, `PlaceState`, `anchoredIn` and the head sentence deleted; both header pills deleted |
| `renderer/overlay/overlay.css` | the head's ground and shadow; the chat on `--panel`; the cells; the fold; `.rex-place-index` square; `.rex-steps*`, `.rex-pill-ok`, `.rex-pill-lost`, `.rex-place-kind`, `.rex-quote-small` deleted |
| `test/placeLine.spec.ts` | **new** — the cells for a section, a row, a whole file, a page, a moved place, an unchecked one, a lost one |
| `test/markdown.spec.ts` | `sourceLineCount` |

---

## 5. What this does not change

- **The composer.** The box, the mode switch, the model and style pickers, Send.
- **The conversation.** Turns, asides, the answer block, the stop row.
- **The place list on the paper.** Outlines, numbers, margin bars.
- **What a comment stores.** No column, no channel.
- **The trace sheet.** It keeps its own head with the same bars.

---

## 6. Milestones

**0 — the data, with tests.** `placeCells`, `sourceLineCount`, `lineEnd` in the
sweep. *Done when:* `npm run test:place-line` and `npm run test:markdown` are
green and `npm run typecheck` passes.

**1 — the head.** §2 in `CommentCard.tsx`, `RunNums` shared with the row.
*Done when:* `npm run typecheck` passes.

**2 — the stylesheet.** §2.3's cells, §2.6's grounds, the dead rules gone.
*Done when:* `nvim-tools --json --all` adds no finding.

**3 — driven in a live window.** A five-place comment at 384px and at 700px; a
resolved one; a one-place one. *Done when:* §7 is checked by eye.

---

## 7. Acceptance

- [ ] The title is the first line of the head and never scrolls.
- [ ] No quote and no heading text appears in the head.
- [ ] Place 4 reads `lukas-feedback.md │ L794–812 │ 19 lines │ section`.
- [ ] A whole-file place reads `whole file │ N lines`, N being the file's line count.
- [ ] A lost place carries the grey `?` after its file name and its stored line.
- [ ] At 384px the cells sit under the file name; at 700px beside it.
- [ ] `▾ PLACES 5` folds and unfolds the list; a two-place comment opens unfolded, a five-place one folded.
- [ ] The run line ends in `show trace ›`, and no bordered strip is drawn under the head.
- [ ] The header shows no pill in any lane.
- [ ] The head is darker than the chat; the chat is lighter than it was.
- [ ] `npm run test:place-line`, `npm run test:markdown`, `npm run typecheck` pass; `nvim-tools --json --all` adds no finding.

---

## 8. Rejected

**Keep the file chips on the card.** They were the first pass, and the
reviewer's answer was plain: *"the whole line with listing files and the number
next to it is useless."* The list row keeps them; the head has the places.

**The quote, shortened.** Any length of it is text the reviewer does not want
to read in a head, and a shorter one says less while taking the same line.

**A round place number.** It was the comment token's shape in a second colour,
and two round numbered discs on one row read as the same kind of thing.

**The head stays on the panel and the chat stays on `--bg`.** That is today,
and it is what the reviewer called blended. The stepped order is the fix, not
the hairline between them.

---

## 9. What the live run showed

Run on 2026-09-02 on an isolated REX (port 9444, a clone of the reviewer's
database with every document repointed at scratch copies), at the panel's
385px default and at 721px.

| Surface | What it said |
|:--|:--|
| Comment 4, nothing open | the title row, `72 steps (!)4 · show trace ›`, `▸ PLACES 5` folded. No pill in the header |
| The list, opened | five lines, the cells under each file name; places 1–3 `whole file`, place 4 `L794 · section`, place 5 `? · L954 · table row` — stored lines, nothing swept |
| After `go to` on place 4 | `lukas-feedback.md │ L736–827 │ 92 lines │ section │ was L794` — the file changed since the comment was written, and the head says so |
| After `go to` on place 1 | `user-interaction-flow.md │ whole file │ 1130 lines`; place 4 back to its stored `L794` |
| At 721px | the cells beside the file names, one row each, the hairlines lined up |
| Folded | one line: `▸ PLACES 5` |
| A resolved comment | green wash, `resolved` at the right of the title row, `Reopen` in the header |
| A one-place comment | the list open by default: `lukas-feedback.md │ whole file` |

Two things the run taught that the spec did not say:

1. **A whole-document run can end on an unstamped block.** `data-src-line`
   goes on list items, not on the `<ul>` around them, and a file that ends
   with a list ends on that `<ul>`. `closest` found no stamp above it and the
   head said `whole file` with no length. `stampedBlockAt` now reads the
   first or last stamped block inside an unstamped one, or the nearest one
   before or after it, for both ends of every resolution.
2. **A long cell line clips at 385px.** `92 lines │ section │ was L794` did
   not fit beside the badge and was cut mid-word. The cells wrap now, and a
   cell that wraps keeps its hairline.
