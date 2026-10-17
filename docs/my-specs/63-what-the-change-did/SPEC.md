# Spec 63 — what the change did, in every format

**Status**: built, 2026-10-17.

> [!important]
> **While two versions are compared, the outlines are the change's.** Every
> block the change touched is outlined, in every format that renders to a page,
> and in one of three colours: red for a block only the original has, green for
> one only the new version has, yellow for one the change rewrote. Comment
> marks step aside until the comparison ends.
>
> This spec amends spec 15 §6.1 (the original is unloaded on `New`), spec 15
> §6.2 (the note on documents with no source lines, and the "changed" row), spec
> 16 §4.1 (the warning) and §5.5, and spec 16 §7 (which outlines a pane draws
> while comparing).

## 1. The report

`agentic-SDLC/docs/mami-review/index.html`, open in REX with a working copy:
316 lines added and 36 removed. The reviewer saw both panes and no change at
all, and an outline round every commented block in both. "It worked like that
before" — on Markdown, where it did.

## 2. Why

Two causes, both written down as decisions.

- **No tint.** A changed line reaches a rendered block through `data-src-line`
  (spec 05 §5.6.1). Only REX's Markdown renderer writes that stamp. A plain
  HTML file is rendered as its author wrote it, and a Word document goes
  through mammoth, so neither has one. Spec 15 §6.2 refused to guess, because a
  wrong outline is worse than none. The side effect was spec 16 §4.1's warning:
  the new-version pane of such a document had no live blocks, so nothing on it
  could be commented on.
- **Comment outlines in both panes.** Spec 16 §5.1 resolves every comment in
  both panes, and a comment on unchanged text resolves in both. Its outline is
  drawn twice, and with no change tint beside it, it is the only thing on the
  page.

## 3. A page with no source lines is compared block by block

The rule spec 15 kept — never a wrong outline — still holds. What changes is
the evidence. Without source lines, REX compares the two rendered pages
themselves.

### 3.1 What a block is

An element whose tag is block-level (`p`, `h1`–`h6`, `li`, `td`, `th`, `pre`,
`blockquote`, `div`, `section` and the rest of the list in `changes.ts`) and
which has content of its own.

Its **own content** is its markup with every nested block left out: the text,
and each inline element with its attributes (`<a href>`, `<strong>`, `<img
src>`). The block's own tag and attributes come first. Whitespace collapses to
one space, so reflowing the source changes nothing.

A `<section>` that only wraps paragraphs has no own content and is not a block;
its paragraphs are. So a paragraph added to a section outlines the paragraph,
not the section.

### 3.2 Unchanged means identical

Two blocks are the same block when their own content is identical. The two
lists are aligned by their longest common subsequence, the same alignment
`git diff` makes over lines. What is not aligned is what changed, and an
identical block is unchanged for certain.

That is why this is not the guess spec 15 refused: no block is outlined because
it is *near* a change, only because its own content is not in the other
version.

### 3.3 The three kinds

Between two aligned blocks lies a gap. What the gap holds decides the colour of
everything in it:

| The gap holds | Kind | Drawn |
|:--|:--|:--|
| only blocks from the original | removed | red, in the original |
| only blocks from the new version | added | green, in the new version |
| blocks from both | rewritten | yellow, in both |

Markdown follows the same rule through the patch: a run of added lines that
sits against removed lines, with no context line between, is rewritten, and so
is a run of removed lines that sits against added ones. `changedRegions` marks
such a run `changed`.

### 3.4 Where it is too big to compare

The alignment costs the product of the two lists' unchanged-trimmed lengths.
Past four million pairs REX draws no tints for that document, by spec 15's rule,
and the patch below the panes still carries every change.

### 3.5 The original stays loaded on `New`

The comparison needs both pages, so the original pane is loaded whenever a
working copy exists and only hidden while the pane control is on `New`. Spec
15 §6.1 unloaded it there. A side effect is that its sweep keeps running, so a
comment on removed text keeps its best state on `New` too (spec 16 §5.2).

### 3.6 What it gives the new-version pane

The added and rewritten blocks are the pane's live blocks (spec 16 §4.1). A
plain HTML file or a Word document now takes a comment on what the agent wrote,
like Markdown always did. Spec 16 §4.1's warning is withdrawn.

## 4. The colours

| Kind | Token | Value |
|:--|:--|:--|
| removed | `--removed` | `#d05744`, as before |
| added | `--added` family | `#4f9d57` border, as before |
| rewritten | `--rewritten` | `#c9c21a` |

Spec 15 §6.2 drew a changed block as red on the left and green on the right.
Yellow on both sides says it in one colour and pairs the two halves by eye.

Two yellows already exist. `--moved` is gold and marks a comment whose text
moved; `--find` is lemon and paints a find on text. `--rewritten` is greener
than either, and it is a box round a block, never a wash on text.

## 5. Comment marks while comparing

While a working copy exists — Comparing, spec 16 §3, in every position of the
pane control — neither pane draws a comment's marks: no outline round a
commented block and no bar in the margin, the open comment's included. Every
comment is still in the panel, and opening one still scrolls to it.

The first build kept the bars and the open comment's outline. The reviewer
read both as comments still on the page, which is what this section exists to
stop, so both went (2026-10-17).

The reviewer's own selection in progress is not a comment and keeps its
outline.

Reading mode — one version — is unchanged.

## 6. What this does not do

| Not done | Why |
|:--|:--|
| A word-level diff inside a block | Spec 15 §12 already declined it; the patch carries the exact characters |
| Detecting a block that moved | A move reads as removed here and added there, as in `git diff` |
| Aligning the panes' scroll on changed HTML blocks | `syncPanes` still needs source lines and stays proportional |
| A changed `<head>` or stylesheet | Not a block; the patch shows it |

## 7. Where it lives

| File | Change |
|:--|:--|
| `renderer/overlay/blockDiff.ts` | **new** — the alignment and the three kinds, pure |
| `renderer/overlay/changes.ts` | **new** — the blocks of a page, and which ones a pane's change touched, by either route |
| `main/diff.ts` | `changedRegions` marks a rewritten run |
| `shared/types.ts` | `ChangedRegion.changed` |
| `renderer/overlay/anchoring.ts` | the surface takes a pane's changes instead of line ranges |
| `renderer/overlay/App.tsx`, `DocumentView.tsx`, `OriginalPane.tsx` | wiring, and the yellow outline |
| `renderer/overlay/PaneMarks.tsx` | §5 |
| `renderer/overlay/overlay.css` | `--rewritten`, `.rex-rewritten-outline` |

## 8. Acceptance

1. `index.html` in `agentic-SDLC` with its working copy: red outlines in the
   original, green in the new version, yellow in both for a rewritten block.
   No outline on a block whose content is the same in both.
2. A Markdown document with a working copy: tints as before, with a rewritten
   paragraph yellow in both panes instead of red and green.
3. While comparing, no comment outline and no margin bar in either pane, with
   a card open or not. In Reading mode both are back.
4. A selection on an added HTML block opens the panel; one on unchanged text in
   the new version does nothing, as spec 16 §4.1 says.
5. On `New`, the HTML document still has its outlines and its live blocks.
6. `npm run test:block-diff`, `npm run test:diff` and `npm run test:work` pass.

## 9. What was measured

2026-10-17, on an isolated REX (port 9444, its own database and work store)
holding a clone of the reviewer's case:

| Case | Original pane | New version pane |
|:--|:--|:--|
| `index.html`, one paragraph gained a link | 1 yellow | 1 yellow, same height |
| hand-made HTML: one removed, one rewritten, two added | 1 red, 1 yellow | 1 yellow, 2 green |
| `sample-document.md`: one removed, one rewritten, one added | 1 red, 1 yellow | 1 yellow, 1 green |
| `index.html` on `New` | hidden | 1 yellow |

- Comment marks on `index.html` while comparing, after the §5 correction: 0
  outlines and 0 bars in both panes, with the "AS IS process" card open or
  not. In Reading mode after a discard: 13 outlines and 13 bars.
- A selection on unchanged text in the new version added no place; one inside
  the rewritten paragraph added one.

The reviewer expected several changes in `index.html`. The working copy holds
one: `git diff` against `HEAD` shows 316 lines, because the file on disk
already carries earlier approved changes, and REX compares the working copy
with the file on disk.
