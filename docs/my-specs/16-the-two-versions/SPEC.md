# REX 16 — the two versions, and what you can do in each

**Version:** 1.0 · 2026-08-26
**Status:** proposed.

**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §4 (the anchor
shape), §6 (resolution, and the four layers) and §9 (`anchor_json` is a blob),
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md) §5.1
(a comment is a list of targets) and §5.4 (a target in a document that is not
open is not orphaned), [`06-document-section-and-pen/SPEC.md`](../06-document-section-and-pen/SPEC.md)
§4.3 (how `extent` was added without a migration — this spec copies the trick
twice), and [`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md), which
this spec finishes.

> [!note]
> **Spec 15 put two documents on screen and left three questions open.** It said
> the left-hand pane is read-only and stopped there, which was the right place to
> stop for one spec and the wrong place to leave it: a reviewer looking at a
> paragraph the change deleted has no way to say *"put that back"*. This spec
> answers what a gesture **means** in each pane, adds the one place REX cannot
> currently name — the gap between two blocks — and settles when the two panes
> exist at all.

> [!important]
> **No migration.** Spec 01 §9 stores every anchor as a JSON blob, which is what
> let spec 06 add `extent` with no new column and no changed query. Both of this
> spec's new fields ride in the same blob, and an anchor written before today
> reads as `version: undefined` — the version under review, which is what every
> existing comment is about.

---

## 1. Why

### 1.1 Three things the reviewer asked for

Measured on 2026-08-26, reading spec 15's first build:

| # | Asked for | Answered by |
|:--|:--|:--|
| 1 | *"The lines should be positioned on the most left side of the document, and as wide as the number of the comment."* | spec 15 §8.2, revised — see §7.1 |
| 2 | *"I should be able to pick element in the old version of the file."* | §4, §5 |
| 3 | *"Select a space between elements with Add, then write what I want to add."* | §6 |

### 1.2 And one fault the build showed

A comment was written on a paragraph, an ACT run removed that paragraph, and the
comment immediately read **anchor lost**. It fell out of the `open` list, and
answering *"actually, put it back"* meant finding it under the `orphaned` chip
first.

Nothing there is a bug in the code. It is a bug in the **model**: the comment was
about a passage that still exists — on disk, in the pane the reviewer is looking
at — and REX called it lost because it was resolving every comment against one
version. §5 is the fix, and it is what makes §1.1's item 2 worth having: the
reason to select in the left pane is to talk about what the change did to it.

### 1.3 The question underneath all three

**What is the reviewer looking at, and what does a gesture mean there?** Spec 15
answered the first half — one pane, or two when a proposal exists — and left the
second. Every decision below follows from one rule, so §2 states it once.

---

## 2. The model

> **A comment belongs to the version its text lives in, and the reason to touch
> the new-version pane is that the thing you are pointing at exists nowhere
> else.**

Four things fall out, and they are the whole spec:

1. **Comparing is a consequence of a proposal, never a mode you switch on.** §3.
2. **The left pane takes a comment on anything; the right pane takes one only on
   a block the change added or altered.** §4. Everything the change left alone is
   the document, and the document is the left pane.
3. **Which version a comment is about is derived, never stored** — it is
   wherever the anchor resolves. §5.
4. **Add names a place in the version under review, and only there.** §6.

---

## 3. Reading and Comparing

| Mode | When | On screen |
|:--|:--|:--|
| **Reading** | no working copy for this document | the file. One pane, exactly as REX has always been |
| **Comparing** | a working copy exists | the original beside the new version, and the `Original / Both / New` control |

There is no button that starts Comparing, and that is a decision rather than an
omission. A diff of a file nobody has proposed a change to answers *"changed
since when?"* — which is git's question. It needs a version to compare against, a
picker to choose it, and an answer for the untracked file that has no history at
all. That file is the one spec 15 §1 was about, so the feature that cannot serve
it is the wrong feature. §10 records the two forms that were considered.

`Original` and `New` remain what spec 15 §6.1 made them: which of the two panes
is on screen, not which one is under review. Reviewing on `Original` alone is
possible and is exactly §5's case.

---

## 4. What each pane allows

**The reason to touch the right pane is that the thing you are pointing at only
exists there.** Everything the change did not touch is the document, and the
document is the left pane.

| Gesture | Original (left) | New version (right) | Reading (one pane) |
|:--|:--|:--|:--|
| read, scroll, copy, zoom | yes | yes | yes |
| select text → comment | **any text** | **only a block the change added or altered** | any text |
| pick element, widen scope | any element | only inside such a block | any element |
| pen / ink | anywhere | only over such blocks | anywhere |
| **Add** — a gap (§6) | **no** | yes | yes |
| the comment runs ASK / ACT / NOTE | all three | **all three** | all three |

Two rows deserve their reasons.

**Why the right pane is narrow.** Unchanged text exists in both panes, so a
comment on it could be made twice and would mean the same thing once. Two ways
to say one thing is the ambiguity that produced §1.2, and the narrow rule
removes it at the source: there is exactly one place to comment on any given
passage, and REX never has to ask which version you meant.

**Why all three modes are still offered on the right.** A block the agent just
wrote is exactly what *"I do not like that, make it shorter"* is about, and that
sentence is spec 15's whole reason for keeping a working copy alive across runs.
Taking ACT off the new version would leave the iteration loop with nowhere to
happen.

### 4.1 What "the change added or altered" means, exactly

The live blocks are the ones spec 15 §6.2 **already outlines in green**:
`WorkingCopyView.added` is a list of line ranges, and `changedBlocks` in
`pick.ts` turns those into elements. The set is recomputed whenever the working
copy moves — a new revision, an undo, an approve, a discard.

So the affordance needs no new furniture: **what is outlined is what responds.**
A reviewer who tries a selection on unchanged text and gets nothing is looking
at a pane where the live blocks are already drawn in a different colour.

A selection, a pick or a drawing that lands outside every live block produces
**nothing, silently** — `selectionMade` returns null, exactly as it already does
for the many mouse-ups that select nothing at all (`anchoring.ts`). No panel, no
notice, no refusal to dismiss.

> [!warning]
> **A document with no `data-src-line` stamps has no live blocks at all.** A
> plain HTML file is rendered as its author wrote it (spec 01 §5.4 point 3) and
> carries no source lines, so REX cannot say which blocks the change touched —
> which is why spec 15 §6.2 already refuses to tint them. Its right pane is
> therefore a picture of the proposal and nothing more: no comments, no Add.
> Every comment on such a document goes on the left, which is where it would
> have gone anyway.

### 4.2 Spec 15 §6.1 is reversed

Spec 15 said of the left pane:

> Read-only in the strongest sense the design allows. It hands up no surface, so
> no anchor is ever created or resolved against it.

It gets a surface. What stays true is the second half — the left pane is not a
second document under review, and nothing typed against it ever edits it. The
original is what is on disk, and the only thing that changes it is approving the
proposal.

**Add is the one gesture the original never gets** (§6.4): you cannot add to a
version that is already fixed.

---

## 5. Which version a comment is about

### 5.1 It is derived, never stored

A comment is about the version its text lives in, and REX can see that without
being told:

| The anchor resolves in | What the comment is about | Bars draw in |
|:--|:--|:--|
| **both panes** | the document — text the change left alone | both lanes |
| **the original only** | what the change removed | the left lane |
| **the new version only** | what the change added | the right lane |
| **neither** | orphaned | nowhere |

No field, no migration, and nothing to stamp at creation. An earlier draft of
this spec put a `version` on the anchor and had each surface write it; the rule
in §4 makes that unnecessary, because the only text you *can* comment on in the
right pane is text that exists nowhere else. Where it resolves **is** what it is
about.

That also removes a class of bug that field would have created: an anchor whose
stored version disagreed with where its text actually turned out to be.

### 5.2 So a target resolves in every pane it can

Each pane's surface resolves the **whole** thread list — no partition, no
filter. Two sweeps, two `ResolvedThread[]`, and each pane's `MarginBars` draws
from its own.

> [!warning]
> **Merging the two is the trap in this section.** Per target, take the **best**
> of the two panes; per thread, take the **worst** across its targets, which is
> what `worstState` already does.
>
> Best per target, because a target that resolved on the left and not the right
> is *found*, not lost — and applying `worstState` across panes would report
> every comment on unchanged text as orphaned the moment a working copy existed.
> That is §1.2 rebuilt with more machinery.
>
> Order for "best": `ok` beats `moved` beats `orphaned`. One `anchor:restate`
> per target, carrying the merged state, so the database never holds a state one
> pane invented.

`documentChanged` differs per pane, and that matters:

| Pane | `documentChanged` |
|:--|:--|
| new version | as today — `OpenedDocument.contentChanged` |
| original | **always false** |

The original pane shows `base` — the file exactly as it was when the working
copy was forked — so nothing in it can have moved under an anchor written
against it. Passing the document's own `contentChanged` here would report every
comment on unchanged text as `moved` the moment any working copy existed, which
is the loudest possible wrong answer.

The two sweeps return two `AnchorSummary` values. `__rexReanchor` merges them
per target before summing, so spec 01 §8.7 step 7's report still counts every
checked target exactly once.

### 5.3 What happens when the proposal ends

| Event | A comment on text only the new version has | on text only the original has | on text both have |
|:--|:--|:--|:--|
| a later run removes that text | orphaned | untouched | becomes "original only" |
| **approve** | resolves against the file | **orphaned** | resolves against the file |
| **discard** | **orphaned** | resolves against the file | resolves against the file |
| **undo last run** | re-resolved against the previous revision | untouched | untouched |

The mechanism is one rule, and it is why the table needs no special case:

> **Approving or discarding re-resolves every target of that document against
> the file, once. Whatever that sweep finds is the target's last word.**

Afterwards there is one version, so no later sweep can add anything, and the
target keeps that state. The middle column's `orphaned` is a comment about a
paragraph that no longer exists anywhere — which is exactly what orphaned has
always meant.

`confirmApply` already calls `context.reanchor([documentId])` (spec 01 §8.7
step 6), and `work:approve` and `work:discard` already call it. What changes is
that by then there is one frame, so the merge in §5.2 has one input.

### 5.4 What the agent is told

A comment on text only the original has is the one that needed this section, so
its prompt says plainly what it is:

```text
## The passages under discussion

1. In the ORIGINAL version of docs/components.md — the version on disk, which
   the change you have already made removes:
   “LUKAS question: is a web UI possible here?” — line 8 of the original

The reviewer is looking at that passage in the original and asking for a change
to the current version. The current version is the file you may edit.
```

Which wording a passage gets is decided the same way everything else here is —
by where it resolved. A passage that resolved in both is named once, with the
current version's line, because that is the copy the agent will open.

The agent is given the original as a **readable path** — the working copy's
`base` — so it can see what the reviewer is pointing at without being able to
write to it. It is not on the "files you may edit" list, and spec 15 §4.3 puts
back anything written outside that list.

### 5.5 The live-block set, in code

`FrameSurface` gains one field, and it is the whole of §4.1:

```ts
/**
 * Spec 16 §4.1 — the blocks a gesture may land on, or null for "all of them".
 *
 * Null in the original pane and in Reading mode: everything is live there.
 * A non-null EMPTY array is not the same thing — it means this pane has a
 * change to show and no way to say which blocks it touched (§4.1's warning),
 * so nothing is live.
 */
readonly liveBlocks: Element[] | null;
```

Set by `DocumentView` from `doc.working.added` through `changedBlocks`, and
re-set whenever that list changes. Four entry points consult it and return null
outside it — `selectionMade`, `scopesAt` (the pick probe), `regionWithin`, and
the lasso's `blocksInDrawing`, which filters its result rather than refusing
outright so that a drawing crossing one live block still makes a comment about
that block.

---

## 6. Add — a place between two blocks

### 6.1 The gesture

Hovering the gap between two blocks in the version under review draws a 1px rule
across the text column with a `+ Add` pill at the lane end. Clicking it puts a
place in the selection panel labelled:

```text
Add here — after “Every Drafting Table shares it…”
```

Then the panel behaves exactly as it does for any other place: type the note,
pick the mode, send. **Add names a place; it does not decide what happens
there** — that is still §12's switch, and all three modes are meaningful:

| Mode | What Add means |
|:--|:--|
| NOTE | *"an example belongs here"* — recorded, nothing runs |
| ASK | *"what should go here?"* — the agent answers, and writes nothing |
| ACT | *"put an example here"* — the agent inserts at that point |

### 6.2 The anchor

A gap has no text, so it cannot be a quote, and no element, so it cannot be an
element ref. It is defined by **its neighbours**:

```ts
/** Spec 16 §6.2 — a place BETWEEN two blocks, rather than one of them. */
export interface GapRef {
  /** The block above, as the same quote+element pair every anchor already uses. */
  after: { quote: TextQuote | null; element: ElementRef | null } | null;
  /** The block below. Null at the end of the document, as `after` is at the top. */
  before: { quote: TextQuote | null; element: ElementRef | null } | null;
  /** Where the gap is in the source, when REX rendered the document (§5.3). */
  line: number | null;
}

export interface Anchor {
  // …
  gap?: GapRef;
}
```

Both neighbours, never one. A gap identified only by "after paragraph 4" moves
the moment paragraph 4 is edited, and a gap identified only by a line number
moves the moment anything above it changes. Two neighbours is what makes it
survive an edit to either.

### 6.3 Resolving it, and failing loudly

Resolution runs before the four layers, exactly as `region` and `extent` do:

1. Resolve `after`. Found → the place is immediately below its box, and the
   state is `ok` unless the document changed (§6.6).
2. Not found → resolve `before`. Found → the place is immediately above its box,
   and the state is **`moved`**, never `ok`: one of the two things that defined
   this place has gone, and a reviewer must be told that.
3. Neither found → **orphaned**. Not "somewhere near where it used to be".

> [!warning]
> **The gap is the anchor kind most able to fail silently**, because a gap looks
> the same everywhere. A quote that resolves to the wrong paragraph is visibly
> wrong; a gap that resolves three paragraphs late looks exactly like a gap. So
> rule 2 downgrades to `moved` on a single-sided match rather than reporting
> `ok`, and `test/anchor.spec.ts` gains gap cases against both hostile
> documents. This is Milestone 0's rule and it applies to every anchor kind
> added afterwards.

### 6.4 Where it is not offered

- **Not in the original pane** (§4).
- **Not inside a table, a code block or a figure.** Those have an inside REX
  cannot address as a sequence of blocks, and a gap in the middle of one is a
  place no edit can honestly be made at. The affordance appears between
  top-level blocks of the content root only.
- **Not on a format that stamps no `data-src-line`** — a PDF, a DOCX, a PPTX or
  a hand-written HTML file. Only the Markdown renderer stamps, and a gap is
  measured between two stamped blocks.

  **The test is the gap list, not the file's extension**, and not `applyEnabled`
  as an earlier draft of this section said. `applyEnabled` is a different
  question with a different answer: a PPTX that parsed can be written to
  (spec 11 §7) and still offers no gap, because REX has no line in it to insert
  at. Reading the measured list keeps the control honest by construction — the
  strip offers Add exactly when there is somewhere to add, and nothing has to be
  kept in step with what each renderer stamps.

  This was drawn as a live button until 2026-08-26: on a 27-slide deck the
  strip showed `⇧ add` over a gap list of length 0, ⇧ armed a mode with nothing
  in it, and `A` fell through `addAtNearestGap`'s null. Three dead controls, all
  silent.

### 6.4.1 A format REX cannot write to says so

`applyEnabled` is false for a PDF and a DOCX (spec 01 §5.2), and the sentence
saying why has always existed in `main/render/formats.ts`. Until 2026-08-26 its
only home was the tooltip of the greyed-out ACT segment, which is legible only
to a reviewer who has already selected text, written a comment, opened the card
and hovered the one control that will not work.

It is a fact about the document, so it belongs beside the document's name: a
quiet grey `READ ONLY` pill in the top bar, carrying the sentence on hover.
Grey and not amber — a PDF that cannot be written to is the format being a PDF,
and it never becomes an event. Amber stays `FILE CHANGED`, which is one.

### 6.5 The resolver gains a fourth kind

`Resolution` is a three-variant union today — `range`, `element`, `run` — and a
gap is none of them. It gains a fourth:

```ts
| {
    kind: "gap";
    /** The block above, when this resolution found it. */
    after: Element | null;
    /** The block below, when it found that. */
    before: Element | null;
    layer: AnchorLayer;
  }
```

At least one of `after` and `before` is non-null; a resolution that found
neither is not returned at all, it is `null`, which is what `anchorStateFor`
already turns into `orphaned`.

`anchorStateFor` gains one branch, **before** the layer tests, because §6.3's
rule is about which neighbours matched rather than about which layer found them:

```ts
if (resolution.kind === "gap") {
  if (documentChanged) return "moved";
  return resolution.after && resolution.before ? "ok" : "moved";
}
```

**Sixteen sites switch on `resolution.kind`**, across `renderer/anchor/resolve.ts`,
`renderer/anchor/pick.ts` and `renderer/overlay/anchoring.ts`. Every one is a
compile error until it handles `gap`, which is the point — `tsc` finding them is
cheaper than a reviewer finding them. What each owes:

| Site | What a gap gives it |
|:--|:--|
| `resolveAgainst` in `anchoring.ts` | a `CheckedTarget` with `box: null` (there is nothing to outline), `mark` and `bar` from §7.4's rule, and **no `HighlightHit`** — there is no range to paint |
| `describeResolved` | §6.7's label |
| `sourceLineOf` | the `data-src-line` of `before` when it resolved, else `after`'s plus its block's line count. Null when neither is stamped |
| `scrollToAnchorIn` | scrolls to `after ?? before`, a third of the way down as every other kind does |
| `rectOfRun`, the run-only helpers in `pick.ts` | nothing — they are not reached, and the branch is an explicit `never` rather than a fallthrough |

### 6.6 Finding a gap in the DOM

The blocks are the ones the rest of REX already agrees on: **the elements
carrying `data-src-line`**, in document order, filtered to those that contain no
other stamped element — the same set `changedBlocks` in `pick.ts` builds and for
the same reason. A document with no stamps has no gaps to offer, and the
affordance simply never appears (§6.4's third case, by construction).

The gap between blocks *i* and *i+1* is hit when the pointer's y is within
**8px** of the midpoint between the bottom of *i* and the top of *i+1*, and the
pointer is inside the content column's x range. Two gaps can never be hit at
once: the bands are clamped so they never overlap, and where two blocks are less
than 16px apart the band is whatever room there is.

`GapLayer` is mounted on the same terms as `ModeStrip`: **only when neither pick
nor pen mode is on**. Both of those capture the pointer for their own purposes
(spec 06 §5.1, spec 08 §4), and a third layer competing for a hover would make
all three unreliable. The layer takes pointer events **only inside the band it
is currently offering** — everywhere else it is `pointer-events: none`, so
selecting text across a gap still works.

### 6.7 The label, and what the agent is told

`place.ts` decides what a place is called. A gap's label, in order of what
resolved:

| Case | Label |
|:--|:--|
| both neighbours | `Add here — after “<first six words of the block above>”` |
| only `before` | `Add here — before “<first six words of the block below>”` |
| only `after` | `Add here — after “…”`, and the card reads `moved` (§6.3) |

The ACT prompt names both sides and the lines, because "insert here" is the one
instruction where the agent cannot see what the reviewer pointed at:

```text
## The passages under discussion

1. A NEW passage, to be inserted in docs/components.md between line 12 and
   line 14 — after “Every Drafting Table shares it, which is what makes a
   harness swappable at all.” and before “3. Adapter — A thin layer over
   whichever work-management backend is chosen.”
   Nothing is there now. The reviewer is asking you to write it.
```

ASK gets the same passage section with the same wording — a read agent that
knows *where* answers "what should go here?" better than one that does not — and
NOTE sends nothing anywhere.

---

## 7. The marks

### 7.1 The lane

Revised in spec 15 §8.2, and summarised here because §7.2 depends on it: the
bars move out of each block's own left edge into **one fixed lane down the left
of the pane**, so every bar starts at the same x whatever the block's indent,
and each bar is **wide enough to carry its number inside it** rather than under a
chip that overlaps its neighbour.

### 7.2 Two lanes, one per pane

Each pane draws the bars for the targets that resolved **in it** (§5.1), under
the same number, so the lanes read as a diff of the review as well as of the
text:

| The bar appears | What it says |
|:--|:--|
| in both lanes, level | a comment on text the change left alone |
| on the left only | a comment on something the change **removed** |
| on the right only | a comment on something the change **added** |

Nothing computes that. It is what the two sweeps found, drawn.

### 7.3 The gap's own mark

A gap has no height, so it cannot have a bar that spans its block. It gets:

- a **short bar**, one line-height tall, at the gap's y in the lane, carrying its
  number like every other; and
- a **1px rule** across the text column at the insertion point, in the same
  colour, so the reviewer can see *where* rather than only *that*.

The rule is drawn in the overlay, over the pane. Nothing is inserted into the
document — spec 01 §6.7, which this spec does not bend for a horizontal line any
more than for a `<mark>`.

### 7.4 The gap's bar, exactly

`CheckedTarget.bar` is the box a bar spans, and for every other kind it is the
block's own rect. A gap has no block, so it gets one built:

```ts
bar  = { x: <content column left>, y: <gap y> - 10, w: 0, h: 20 }
mark = the same
```

20px — one line-height at the paper's base size — centred on the gap. Short
enough to read as a point rather than a passage, tall enough to carry the number
inside it (§8.2 of spec 15, as revised).

---

## 8. What this adds

| | |
|:--|:--|
| Dependencies | **none** |
| IPC channels | **none** |
| Tables | none |
| Columns | **none** — both new fields ride in `anchor_json` (§5.1) |
| Shapes | `Anchor.gap` and `GapRef` (§6.2); `FrameSurface` gains `liveBlocks` (§5.5); the App keeps two resolved lists and merges them per target (§5.2). **No `version` field** — §5.1 |
| New files | `renderer/anchor/gap.ts` (create and resolve a gap), `renderer/overlay/GapLayer.tsx` (the hover affordance and the rule) |
| Changed | `shared/types.ts`, `renderer/anchor/create.ts`, `renderer/anchor/resolve.ts`, `renderer/anchor/pick.ts`, `renderer/overlay/anchoring.ts`, `renderer/overlay/App.tsx`, `renderer/overlay/DocumentView.tsx`, `renderer/overlay/OriginalPane.tsx`, `renderer/overlay/MarginBars.tsx`, `renderer/overlay/SelectionPanel.tsx`, `renderer/overlay/place.ts`, `main/agent/prompts.ts`, `main/apply.ts`, `main/ipc.ts`, `renderer/overlay/overlay.css`, `test/anchor.spec.ts` |
| Scripts | none new — `npm run test:anchor` gains the gap cases |

### 8.1 Where each piece goes

| File | What it gains |
|:--|:--|
| `shared/types.ts` | `Anchor.gap` and `GapRef`. Nothing else — §5.1 |
| `renderer/anchor/gap.ts` | **new** — `createGapAnchor(after, before)` and `resolveGap(index, anchor)`, the two halves of §6.2 and §6.3 |
| `renderer/anchor/resolve.ts` | the fourth `Resolution` variant, the `gap` branch at the top of `resolveAnchor` (before the four layers, beside `region` and `extent`), and `anchorStateFor`'s branch |
| `renderer/anchor/create.ts` | unchanged — §5.1 removed the reason to touch it |
| `renderer/anchor/pick.ts` | exports the stamped-block list §6.6 needs; its `kind` switches gain their `never` branch |
| `renderer/overlay/anchoring.ts` | `FrameSurface` takes `liveBlocks` and refuses outside it at four entry points (§5.5); `resolveAgainst` handles `kind: "gap"` |
| `renderer/overlay/GapLayer.tsx` | **new** — the hover band, the rule, the `+ Add` pill |
| `renderer/overlay/OriginalPane.tsx` | hands up a surface with `liveBlocks: null`, mounts `MarginBars`, `PickLayer`, `PenLayer` and `ModeStrip`, mounts no `GapLayer` |
| `renderer/overlay/DocumentView.tsx` | mounts `GapLayer` under the pick/pen rule of §6.6 |
| `renderer/overlay/App.tsx` | two surfaces, two sweeps, two resolved lists; the per-target **best**, per-thread **worst** merge of §5.2; `__rexReanchor` merges before summing |
| `renderer/overlay/place.ts` | §6.7's label |
| `renderer/overlay/MarginBars.tsx` | the lane geometry of spec 15 §8.2 as revised, and the gap's short bar |
| `main/agent/prompts.ts` | §5.4's original-side wording and §6.7's gap wording, both inside `passageSection`. Which one a passage gets is decided by where it resolved, not by a stored field |
| `main/apply.ts` | hands the write agent the working copy's `base` as a readable path when any target resolved only in the original |
| `test/anchor.spec.ts` | the gap cases, against both hostile documents |

Invariant I1 holds and is exercised harder: two live DOMs are now resolved
against, both in the renderer, and §6.3 is written to make the new kind fail
loudly rather than plausibly. I2 holds — the original pane reads a path main
chose (spec 15 §6.1), and the renderer still names a version rather than a file.
I3 holds — no new channel.

---

## 9. Acceptance

The fixture is spec 15 §11's: a scratch git repository with one committed file
and one untracked directory holding a Markdown document.

### 9.1 The lane (spec 15 §8.2, revised)

- [ ] Every bar in a pane starts at the same x, whatever its block's indent. This
      is §1.1 item 1, and the list in the reviewer's screenshot is the case.
- [ ] The number is **inside** the bar, and two stacked bars show two readable
      numbers.
- [ ] The lane does not overlap the paper's text at any window width down to
      1200px with both panes open.

### 9.2 What each pane accepts

- [ ] With a working copy open, selecting text in the left pane offers the
      selection panel for **any** paragraph, changed or not.
- [ ] `pick element` widens a scope in the left pane exactly as it does in the
      right. §1.1 item 2.
- [ ] Selecting text in the right pane on a block the change **added or altered**
      offers the panel, and ASK, ACT and NOTE are all available on it.
- [ ] Selecting text in the right pane on an **unchanged** paragraph produces
      **nothing at all** — no panel, no notice. §4.1.
- [ ] The blocks that respond in the right pane are exactly the ones drawn with
      the green outline, with no third state in between.
- [ ] A pen drawing in the right pane that crosses one changed block and two
      unchanged ones makes a comment about **the changed one only**. §5.5.
- [ ] A plain HTML document with a working copy accepts nothing in its right
      pane, and everything in its left. §4.1's warning.

### 9.2.1 The version, derived

- [ ] A comment on a paragraph the change **removed** reads as anchored, not
      orphaned, and stays in the `open` list. **This is §1.2.**
- [ ] Replying to it in ACT mode reaches the agent with the original's passage
      quoted and the working copy as the file it may edit.
- [ ] A comment on text **both** versions have draws a bar in both lanes, level,
      under one number.
- [ ] That same comment reads `ok`, not `orphaned` and not `moved` — the
      per-target **best** merge of §5.2. Getting this wrong marks every comment
      on untouched text as lost the moment a working copy exists.
- [ ] On **approve**, a comment about removed text orphans, and the §8.7 step 7
      report says so.
- [ ] On **approve**, a comment on text the change **left alone** does *not*
      orphan — it resolves against the file. §5.3's "re-resolve everything once".
- [ ] On **discard**, a comment on added text orphans and one on unchanged text
      does not.

### 9.3 Add

- [ ] Hovering between two blocks in the new version shows the rule and the
      `+ Add` pill; hovering in the original shows nothing. §6.4.
- [ ] Clicking it adds a place labelled `Add here — after “…”`.
- [ ] NOTE saves it, ASK answers it, ACT inserts at that point.
- [ ] The insertion lands **between** the two named blocks, not at the end of
      the file and not inside the block above.
- [ ] Editing the block above leaves the gap resolving to the same place, via
      `before`, and the card reads `moved` rather than `ok`. §6.3.
- [ ] Removing both neighbours orphans it. It never resolves to "nearby".
- [ ] `npm run test:anchor` passes with the gap cases added, against both
      hostile documents.
- [ ] No gap affordance inside a table, a code block or a figure.
- [ ] The affordance does not appear while pick mode or pen mode is on, and text
      can still be selected across a gap. §6.6.
- [ ] A document with no `data-src-line` stamps offers no gaps at all, and says
      nothing about it — there is nothing to offer. §6.6.

### 9.4 The wiring

- [ ] `sqlite3 ~/.rex/rex.db ".schema thread_target"` is **unchanged** — no
      column, and no `version` anywhere in `anchor_json` either. §5.1.
- [ ] A comment written before this spec reads back unchanged and resolves in
      whichever pane its text is in.
- [ ] A comment on unchanged text reports `ok` while a working copy exists —
      the `documentChanged: false` rule of §5.2, and the one that fails loudly.
- [ ] `__rexReanchor` merges the two sweeps per target before summing, so a
      target that resolved in both panes is counted once.
- [ ] One `anchor:restate` per target per sweep, carrying the merged state.
- [ ] `tsc --noEmit` is clean, which means all sixteen `resolution.kind` sites
      handle `gap`. §6.5.

### 9.5 Nothing else moved

- [ ] Reading mode is unchanged for a document with no working copy: one pane,
      one lane, and every spec 15 acceptance point still passes.
- [ ] `npm run test:work`, `test:comments` and `test:pptx-edit` pass unchanged.
- [ ] `nvim-tools --json --all` adds no finding.

---

## 10. Non-goals

| Not doing | Why |
|:--|:--|
| A `Compare` button with no proposal | §3 — it answers "changed since when?", which needs a version picker and has no answer at all for an untracked file. That file is what spec 15 §1 was about |
| Comparing against `git HEAD` | Same, plus it is a question `git diff` already answers better, in a terminal the reviewer already has |
| Keeping a baseline copy of every document opened | The cost of the previous two: REX would copy every file anybody looked at, to serve a comparison nobody asked for |
| Editing the original in REX | It is the reviewer's file. Their editor writes it; REX proposes changes to it |
| A gap inside a table — "add a row here" | A real wish and a different anchor: rows are addressable, gaps between them are a table operation, and it belongs with whatever spec takes on table editing |
| Dragging a comment from one version to the other | "This comment is about the other version now" is a rewrite of what it is about, and re-selecting says it exactly |
| Word-level diff marks in either pane | Spec 15 §12 already refused it, for the same reason: `data-src-line` supports blocks honestly and characters not at all |
