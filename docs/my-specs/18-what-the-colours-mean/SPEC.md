# REX 18 — what the colours mean

**Version:** 1.0 · 2026-08-26
**Status:** proposed
**Depends on:** [`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md)
§4.3 (the tree's comment counts),
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md) §5.4 and
§5.7 (a thread's worst target state, and why `null` is not orphaned),
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §3 (the card washes
and the filter chips), and
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §4 and §6.2 (the
blocks a change added, and the blocks it removed).

> [!note]
> **This spec adds no feature.** It fixes a vocabulary. REX draws seven different
> facts and has been spending one colour on three of them, which is why the
> workspace tree could not be read at a glance. Nothing new appears on screen
> except one glyph and two counts that were already computed.

---

## 1. Why

**Red means three different things, and two of them sit in the same row.**

Measured on 2026-08-26, reading a workspace tree beside the two-version panes:

| Fact | Colour today | Family |
|:--|:--|:--|
| a comment whose text is gone | red `--lost` | the comment |
| a block only the original has | red `--lost` | the document |
| a delete button, a denied tool call, a stopped run | red `--lost` | neither |

The reviewer asked for four counts on every file row — comments, comments whose
text is gone, blocks added, blocks removed. Three of the four already had a
colour. Two of those three were the same red, so the row could not be written at
all without inventing one.

The second problem is smaller and older. A comment that is **resolved** and whose
text is **gone** is counted twice by the tree and put in the wrong lane by the
sidebar, so the two disagree about the same comment.

## 2. The rule — resolved is terminal

**A comment is in exactly one of three lanes, and `resolved` is the last one it
can enter.**

| Lane | Meaning |
|:--|:--|
| open | waiting on the reviewer. Its text is there, or it was re-found elsewhere |
| gone | waiting on the reviewer, and the text it was written on no longer exists |
| resolved | dealt with. Terminal — nothing that happens to the document changes it |

A resolved comment whose text is later removed **stays resolved**. It never
enters the gone lane and never appears in the gone count. Its highlight simply
stops being drawn, because there is nothing left to draw it on.

Why: the gone lane exists so a reviewer does not lose a question they asked. An
answered question cannot be lost. Flagging one is noise, and noise in the lane
that exists to catch real losses is what makes the lane worth ignoring.

This rule is not new. `renderer/overlay/wash.ts` has tested status ahead of
anchor state since spec 08 — *"Status first, because a resolved comment is not an
alarm"* — and the card, the numbered token and the margin bar have always obeyed
it. §5 lists the two places that never did.

### 2.1 `moved` is not a lane

A comment whose text was re-found somewhere else is **open**. It counts as open,
it is drawn as open in the tree, and the fact that it moved is a line on its card
(`components.md · L41 was L37`) and an amber pill when it is opened.

It gets no marker of its own in the tree. Nothing is wrong with it, it is one
click away, and a fifth marker on a 272px row buys nothing.

## 3. The vocabulary

Two families. One meaning per colour, and no colour appears in both families.

**The document — what the change did to the text:**

| Meaning | Marker | Colour |
|:--|:--|:--|
| a block the new version added or altered | filled dot | green `--added` |
| a block only the original has | filled dot | red `--removed` |

**The comment — what happened to one comment:**

| Meaning | Marker | Colour |
|:--|:--|:--|
| open | filled dot | blue `--action` |
| open, text re-found elsewhere | *no tree marker* — a card pill | amber `--moved` |
| open, text gone | **`?`** | grey `--gone` |
| resolved | filled dot | white `--done` |

Three notes on why each is what it is:

1. **Gone is a glyph, not a colour.** It is the one state that has to be visible
   beside four coloured dots, and taking it off the colour axis is what leaves
   red and green free to mean one thing each. `?` also says what the state *is* —
   the text this was about is a question nobody can answer any more.
2. **Gone is grey, not red.** Under §2 it is not an alarm: REX's own ACT run
   creates orphans as normal operation, and the comment is not lost — it keeps
   its quote. Grey is the colour this design already uses for absence.
3. **Red keeps its other jobs.** `--lost` stays exactly as it is for deletes,
   denied tool calls, errors, stopped runs and the write-capable agent's tint.
   `--removed` is a new name for the same value, used only by the diff, so the
   two can move apart later without a rename.

## 4. The workspace tree

### 4.1 What a row shows

```text
overview.md        ● 2   ? 1   ● 3   ● 4   ● 2
                  blue  grey  white green  red
```

- **blue** — open comments on this file
- **grey `?`** — open comments whose text is gone
- **white** — resolved comments
- **green** — blocks the new version added or altered
- **red** — blocks only the original has

**Every count the file has earned is drawn.** An earlier draft hid the resolved
dot unless nothing was open, to hold a row to three markers. That is the wrong
trade: it makes a file with one open comment and twelve resolved ones look
exactly like a file with one open comment, so the work done disappears and only
the clutter is saved. A row carries at most five markers, and the number a
reviewer cannot see is worth more than the pixels it costs.

Green and red appear only while the file has a working copy (spec 15 §3). Their
presence is the signal: *this file has an old version and a new one.*

### 4.1.1 The number carries its dot's colour

A count is drawn in the colour of the marker beside it, so a row reads as pairs
rather than as five numbers in a grey line.

The open count is `--link` and not `--action`. `--action` is a border and fill
colour in this design and is never text: at 11px on `--panel` it measures 3.6:1,
under the 4.5:1 a number that small needs. `--link` is the same blue made
legible, and is already how every other piece of blue text in REX is drawn.

The resolved count is the one exception. It stays `--muted`, because `--done` is
within a shade of `--fg` and a white number reads as part of the file name. The
white dot carries the meaning; the number only has to be readable.

### 4.2 The counts are disjoint

`open + gone + resolved` is every comment on the file, counted once. The tree,
the sidebar chips and the sidebar list all read the same three numbers, and a
comment that is resolved and whose text is gone counts once, as resolved.

### 4.3 Where the block counts come from

The renderer already holds every working copy (`work:list`, spec 15 §7.1), and
each carries the two region lists spec 16 §6.2 defines. The tree reads its green
and red numbers from that list, keyed by absolute path.

**No new IPC, and no change to the scan.** A block count is a fact about a
working copy, not about a directory entry, and it changes when a run finishes
rather than when the tree is rescanned — so putting it in `TreeEntry` would make
it stale exactly when it matters.

The unit is a **run of changed lines**, which is what `changedRegions` already
produces and what the panes already outline. It is not a count of paragraphs and
not a count of lines. The row's tooltip says so in words, because a number whose
unit is guessed is worse than no number.

### 4.4 Colour is never the only signal

Every count is a number, every row's tooltip names all four in words, and the
gone marker is a glyph rather than a hue. A reviewer who cannot separate the
green from the red still reads the row.

## 5. What this changes

| File | Change |
|:--|:--|
| `main/db/queries.ts` | `commentCountsByDocument` — `orphaned` gains `status = 'open'`, making the three counts disjoint. **This is the double-count bug** |
| `renderer/overlay/Sidebar.tsx` | `belongsTo` — the gone lane is open-only, so a resolved comment stays in `resolved`. **This is the wrong-lane bug.** The orphan strip at the foot of the list is deleted. The chips read `gone` and `file` (§5.2) |
| `renderer/overlay/Explorer.tsx` | `Counts` — the `?` marker, the white resolved dot drawn whatever else the row carries, the green and red block counts, and the tooltip that names all four |
| `renderer/overlay/App.tsx` | the working-copy list, reduced to a map of path → block counts, passed to the tree |
| `renderer/overlay/GraphView.tsx` | a node with gone comments is grey, not red |
| `renderer/overlay/overlay.css` | `--gone`, `--done`, `--added`, `--removed` and the gone wash; every orphan-comment rule repointed at them; `.rex-count-open` draws the open count in `--link` (§4.1.1) |
| `test/targets.spec.ts` | the three counts are disjoint, and a resolved comment with a dead anchor is counted once |

### 5.1 The orphan strip is deleted

The foot of the comments list carried a red strip — *"1 comment lost its
anchor — show"*. The `orphaned` chip at the top of the same panel carries the
same number, is always visible, and is one click from the list. The strip was a
second copy of a fact that was never hidden.

### 5.2 The filter row fits one line

Four chips and a divider did not fit the comments column, so `this file` wrapped
its own text inside its 24px pill — two lines of 12px text in a one-line
control. Measured on 2026-08-26: the row needs 410px of the 356px it has.

Three changes, and the first is the one that matters:

1. **The `orphaned` chip reads `gone`.** `orphaned` is the anchor state's name.
   It belongs in the database, the types and the IPC payloads, and it stays
   there. It does not belong on a chip a reviewer reads — the tree's own tooltip
   already says *"comments whose text is gone"*, so the two surfaces named one
   lane with two words. It is also the widest word in the row, and worth 26px.
2. **`this file` reads `file`.** The hairline to its left already says the row
   has two halves, and the tooltip names the document. Worth 28px.
3. **A chip's side padding is 9px, not 11px.** Worth 16px over four chips.

That leaves the row at 314px of 356px with single-digit counts, and 338px with
double-digit ones.

| Row | Needs | Of 356px |
|:--|--:|:--|
| `orphaned` · `this file` · 11px | 410px | wraps |
| `gone` · `this file` · 11px | 384px | wraps |
| `gone` · `file` · 9px, counts `1` | 314px | fits |
| `gone` · `file` · 9px, counts `13` | 338px | fits |

None of that is load-bearing, though. The sidebar is draggable, so the row can
always be made too narrow. Whole chips now move to a second line and the head
grows to hold them — a chip never wraps the text inside itself, at any width.

## 6. Acceptance

- [ ] A file with 2 open comments, 1 whose text is gone, 4 added blocks and 2
      removed blocks draws exactly `● 2  ? 1  ● 4  ● 2`, in that order.
- [ ] Hovering that row names all four in words.
- [ ] A file with 1 open comment and 3 resolved ones draws both — `● 1  ● 3`,
      blue then white. The resolved dot is never hidden by an open one.
- [ ] Each count is the colour of its own dot: open blue, resolved grey beside a
      white dot, gone grey, added green, removed red.
- [ ] Resolving the gone comment moves it from `? 1` to the resolved count. It
      does not stay in `? 1`, and it is not counted in both.
- [ ] The sidebar chips and the tree agree on all three numbers for the open
      document.
- [ ] `open + gone + resolved` equals the number on the `Comments` tab.
- [ ] No red appears anywhere in a tree row except a removed-block count.
- [ ] Discarding a working copy removes the green and red counts from its row.
- [ ] The foot of the comments list carries no orphan strip.
- [ ] The four filter chips fit one line at the default sidebar width, and no
      chip ever wraps its own text. Dragging the sidebar narrow moves whole
      chips to a second line instead.
- [ ] `npm run test:targets` and `npm run test:comments` pass.

## 7. What this spec does NOT do

- **It does not detect a moved block.** `git diff --no-index` reports a moved
  paragraph as a removal here and an addition there, and REX shows it that way.
  An amber "moved block" needs move detection, which is a feature and not a
  colour.
- **It does not add an editor.** REX has no way to drag a section up or down,
  and this spec adds none. The agent writes the file; the reviewer approves it.
- **It does not stop the agent removing commented text.** That was considered
  and rejected: rewriting a passage somebody commented on is the main thing REX
  does, so a guard against it would forbid the core loop. The gone lane exists
  precisely because that operation is normal.
- **It does not change the resolved card's wash.** Only the tree's resolved dot
  turns white. The card wash is quiet already and has no diff colour beside it
  to collide with.
