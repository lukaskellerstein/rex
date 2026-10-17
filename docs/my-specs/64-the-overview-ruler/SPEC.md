# Spec 64 — the overview ruler

**Status**: built, 2026-10-17.

> [!important]
> **The strip at the right edge of a pane shows the whole document.** Where the
> reviewer is, as a band; where the comments are while reading; where the
> change is while comparing; and, as today, where a find matched. One look says
> how far down the next thing is, and one click goes there.
>
> This spec amends spec 28 §6 point 9 ("the ruler shows matches and nothing
> else") and spec 28 §5.6 (the ruler is drawn only while a find stands).

## 1. What the reviewer asked for

> "In VS Code, next to the scroll bar, there is a visual representation of the
> whole file. No matter where I scroll, it shows the whole file, including the
> range that I see in the editor. If there is an error, I immediately see in
> this bar that the error is at 75% of the file, and that what I see is the
> first 10%. I would like the same with respect to the comments. In the change
> view I need to see just where the changes are."

Spec 63 drew the change on the page, and only the visible part of the page
shows it. A one-paragraph change in a 180 KB review is somewhere in sixty
screens, and nothing says where.

## 2. What exists

Spec 28 §4.1.1 built the strip: `.rex-ruler`, 10px wide, at the right edge of
`.rex-half-body`, over the frame's scrollbar lane (`FindRuler.tsx`). Each mark
is a fraction of the document's height, it takes the pointer, and the strip
does not, so the scrollbar under it keeps working. It is drawn only while a
find has matches.

Spec 28 §6 point 9 declined comments on it: *"Comments already have the margin
bars, and a second picture of them is a second thing to keep in step."* The
margin bars show only what is on screen, which is the question they cannot
answer. And spec 63 §5 takes the bars away while comparing, so the change has
no picture at all off screen.

## 3. What the strip shows

| Mode | Marks | From |
|:--|:--|:--|
| Reading — one version | one per comment target that resolved here | the same `ResolvedThread[]` the margin bars draw from |
| Comparing — spec 16 §3 | one per changed block, red, green or yellow | the same `ChangeBox[]` the outlines draw from (spec 63) |
| either, while a find stands | one per match, as today | `FindMark[]`, unchanged |
| always | the band: the part of the document on screen | the frame's `scrollY`, `innerHeight` and `scrollHeight` |

While comparing there are no comment marks, for spec 63 §5's reason: the
reviewer is reading the change.

**One source per mark.** Every mark is a picture of something REX already
draws, from the list it is already drawn from. Nothing new is computed, so
the strip cannot disagree with the page — which is the answer to spec 28's
worry about keeping two pictures in step.

### 3.1 Comment marks

- **Colour**: the bar's colour, through the same `markerClass` the margin bars
  use. Steel for open, amber for moved, violet for the open card, and so on.
  One table of colours, so the strip and the bars cannot drift.
- **Filter**: the lane filter chips (spec 30 §5) govern the strip as they
  govern the bars. Under `open`, a note's mark is not drawn.
- **One mark per target**, so a comment on three rows shows three marks.

### 3.2 Change marks

`OUTLINE_CLASS`'s three kinds, drawn in `--removed`, the outline green and
`--rewritten`. Each pane shows its own: red and yellow in the original, green
and yellow in the new version. A block that is tall on the page is tall on
the strip.

### 3.3 The band

A translucent box from `scrollY / scrollHeight` to `(scrollY + innerHeight) /
scrollHeight`, redrawn on every scroll. It takes no pointer events: the
scrollbar under it is how the reviewer drags, as in VS Code.

## 4. Geometry

| | Value |
|:--|:--|
| strip width | 14px, up from 10 |
| lane for comments or changes | the left 8px |
| lane for find marks | the right 4px — a find and a comment at one height are both visible |
| band | the full 14px, under the marks |
| minimum mark height | 2px, as spec 28 |
| position | the block's document-pixel box over `documentElement.scrollHeight` |

Each pane draws its own strip. Both panes have one while comparing, because
each has its own scroll and its own marks.

The marks are re-measured whenever their source is: a sweep, a resize, a zoom,
a reflow, a new revision. No new trigger is added. The band follows the
frame's `scroll` event, which each pane already listens to.

## 5. What a click does

| Mark | Click |
|:--|:--|
| comment | what clicking its margin bar does: open the card and bring the place into view (`onSelectMarker`) |
| change | bring the block into view, by the rule `scrollToAnchor` uses |
| find | as today: go to that match |

A hover names the mark: `Comment 3 · AS IS process`, `Rewritten`, `Added`,
`Removed`, `Match 4 of 12`. Marks stay off the tab order, as spec 28 decided.

## 6. A ruler, not a miniature

**Decided by the reviewer on 2026-10-17: the ruler**, as the lightweight
option. The reasoning it was decided on: VS Code has both: the overview ruler
(coloured marks in the scrollbar track) and the minimap (a tiny drawing of the
text beside it). The request names the colourful lines and the visible range,
which is the ruler. A minimap of a rendered document would need a second,
scaled copy of every page, kept in step with zoom, width and paper, and it is
a second renderer for every format REX opens.

This spec builds the ruler. A miniature can follow as its own spec if the
ruler is not enough.

## 7. What this does not do

| Not done | Why |
|:--|:--|
| A miniature of the page | §6 |
| Dragging the band | The scrollbar under it already drags |
| Keys for next and previous change | Worth having; a separate gesture with its own spec |
| Comment marks while comparing | Spec 63 §5 |

## 8. Where it lives

| File | Change |
|:--|:--|
| `renderer/overlay/rulerMarks.ts` | **new** — boxes and states into marks, as fractions; pure |
| `renderer/overlay/FindRuler.tsx` | becomes `OverviewRuler.tsx`: three kinds of mark, two lanes, the band |
| `renderer/overlay/DocumentView.tsx`, `OriginalPane.tsx` | the strip in every pane, always, not only while a find stands |
| `renderer/overlay/App.tsx` | hands the comment marks and the click through |
| `renderer/overlay/overlay.css` | `.rex-ruler` at 14px, the two lanes, `.rex-ruler-band`, a class per kind |
| `test/rulerMarks.spec.ts` | **new** — `npm run test:ruler-marks` |

## 9. Acceptance

1. Reading a document with comments: one mark per resolved target, in its
   bar's colour, at its height in the whole document. The band covers the part
   on screen and moves as the page scrolls.
2. Clicking a comment mark opens that comment and scrolls to it.
3. The lane filter chips hide and show marks exactly as they do bars.
4. Comparing `index.html`: one yellow mark in each pane, no comment marks.
   Clicking it scrolls that pane to the paragraph.
5. The mixed HTML case from spec 63 §9: red and yellow in the original, yellow
   and green in the new version.
6. `⌘F` with a working copy: find marks in the right lane, change marks still
   in the left.
7. The frame's scrollbar still drags everywhere a mark is not.
8. The strip survives a zoom, `W`, a pane resize and the pane control; nothing
   is left at an old height.
9. `npm run test:ruler-marks`, `npm run test:find` and `npm run test:block-diff`
   pass.

## 10. Building it

In a worktree, so the reviewer's own REX keeps running from the main checkout.
Their `npm run dev` holds the Vite port 5334 and the CDP port 9334, so the
worktree's live checks run the built app on another CDP port, against its own
database and work store, as spec 63 §9 did.

## 11. What was built

| File | What it holds |
|:--|:--|
| `renderer/overlay/rulerMarks.ts` | `commentMarks`, `changeMarks`, `bandOf` — pure, as §8 says |
| `renderer/overlay/OverviewRuler.tsx` | the strip; it reads the page through `pageExtent` on every render, so it adds no trigger (§4) |
| `renderer/overlay/frame.ts` | `pageExtent` — `scrollY`, `innerHeight`, `scrollHeight` |
| `renderer/overlay/wash.ts` | `barClasses` — the bar's colour with the open and the pointed-at comment on top, read by `MarginBars` and the strip alike |
| `renderer/overlay/anchoring.ts` | `bringBoxIntoView` — REX's one scroll rule, for a box already in document pixels |
| `renderer/overlay/overlay.css` | the strip at 14px; `--added-outline`, the green the outline and the mark share |

Two things differ from §8:

- **`App.tsx` hands through only the find's marks.** Each pane already holds
  the comment list, the thread list and `onSelectMarker` for its margin bars,
  so the strip takes them there.
- **A comment mark under `moved` is steel, not amber**, because its bar is:
  spec 33 §3.1 took `moved` off the bar. §3.1's rule — the bar's colour,
  through `markerClass` — is what decides, and the example in it was older
  than that rule.

`DocumentView` keyed its change outlines by geometry. While the pane is hidden
every block measures 0×0, two boxes then share a key, and React left an
outline behind when the pane came back. It keys by position now, as
`OriginalPane` already did.

## 12. What was measured

2026-10-17, on an isolated REX (port 9444, its own database and work store),
against a copy of `documentation-sample/one/sample-document.md` with four
comments, and two hand-made HTML pages with seeded working copies.

| Check | Result |
|:--|:--|
| Reading, `open` chip | 4 marks at 0.376, 0.463, 0.716, 0.916 — each its bar's height and colour; the note and the resolved comment have neither |
| `note` chip, `done` chip | 1 yellow mark, then 1 grey one, each equal to its bar |
| The band | 0.154 tall (873 / 5685); 0.352 at `scrollY` 2000; 0.846 + 0.154 at the foot |
| Clicking comment 1's mark from the foot | its card opened; `scrollY` 1849, the place a third down; mark and bar violet |
| One paragraph gained a link | 1 yellow mark in each pane at 0.673; clicking it scrolled to the paragraph |
| One removed, one rewritten, two added | original: red 0.166, yellow 0.46; new version: yellow 0.444, green 0.804 and 0.877 |
| `⌘F` while comparing | 11 find marks at x 10–14, change marks at x 1–7; match 9 and the rewritten block both at 0.444 |
| Dragging the scrollbar thumb through the band, 200px | `scrollY` 0 → 1059 |
| Zoom 121%, `W`, comments hidden, pane control round trip | every strip equal to its page's outlines and bars after each |
| Markdown with comments and a working copy | no comment mark and no bar; yellow in both panes, green in the new version. After Discard, the 4 comment marks are back |

`scrollHeight` is in `scrollY`'s units under the root's CSS `zoom` (1, 1.5 and
0.75), so the band ends at the strip's foot exactly when the page does —
asserted in `test/rulerMarks.spec.ts`, with the bar colours.
