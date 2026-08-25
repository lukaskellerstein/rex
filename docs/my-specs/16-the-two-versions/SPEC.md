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

> **At any moment there is exactly one *version under review*: the working copy
> if one exists, otherwise the file. The original pane is a reference, and a
> comment on it is a comment about what the change did.**

Three things fall out, and they are the whole spec:

1. **Comparing is a consequence of a proposal, never a mode you switch on.** §3.
2. **A gesture means the same thing in both panes, but the place it names is in
   a different version.** §4 and §5.
3. **Add names a place in the version under review, and only there.** §6.

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

| Gesture | Original (left) | New version (right) | Reading (one pane) |
|:--|:--|:--|:--|
| read, scroll, copy, zoom | yes | yes | yes |
| select text → comment | **yes (§5)** | yes | yes |
| pick element, widen scope | **yes (§5)** | yes | yes |
| pen / ink | **yes** | yes | yes |
| **Add** — a gap (§6) | **no** | yes | yes |
| the comment runs ASK / ACT / NOTE | yes | yes | yes |

**Spec 15 §6.1 said the left pane hands up no surface. This spec reverses that**,
and the sentence it replaces is worth quoting so the change is not silent:

> Read-only in the strongest sense the design allows. It hands up no surface, so
> no anchor is ever created or resolved against it.

It gets a surface. What stays true is the second half of that paragraph — the
left pane is not a second document under review, and nothing typed against it
ever edits it. It is fixed by definition: the original is what is on disk, and
the only thing that changes it is approving the proposal.

**Add is the one gesture the original does not get**, and the reason is the same
one: you cannot add to a version that is already fixed. An `Add` on the left
would be an instruction with nowhere to go.

---

## 5. A comment on the original

### 5.1 The version is part of the place

```ts
export interface Anchor {
  // … quote, position, element, region, source, extent
  /**
   * Spec 16 §5.1 — which version of the document this place is in.
   *
   * Absent means the version under review, which is what every anchor written
   * before this spec is about and what almost every anchor written after it
   * will be. `original` is the one written by selecting in the left pane while
   * a working copy exists.
   */
  version?: "original";
}
```

In the blob, not in a column — spec 01 §9 and spec 06 §4.3. An old row reads as
`undefined`, which is correct rather than merely tolerable.

It is on the **anchor** and not on the thread, because a comment can be about
both sides at once: *"this paragraph was deleted and this one replaced it"* is
one comment with two places, one per version. Spec 05 §5.1 already made a
comment a list of places, each carrying its own document; this adds the version
to the same row.

### 5.2 Which frame a target resolves against

The sweep runs once per pane. Each target resolves against the frame its
`version` names, and against no other:

| Target | Reading | Comparing |
|:--|:--|:--|
| `version` absent | the one pane | the **new version** pane |
| `version: "original"` | **not checked** — spec 05 §5.4, and it is not orphaned | the **original** pane |

The second row is the important one. In Reading mode there is no original on
screen, so a target that names one is in exactly the state spec 05 §5.4 already
defined: *nobody looked*. It keeps whatever state it last had, it is not
orphaned, and §5.7's counts must not include it.

`ResolvedThread` gains nothing. The App keeps **two** resolved lists, one per
pane, and each pane's margin bars are drawn from its own. A thread's state in
the comment list is the worst across both, which is what `worstState` already
does.

### 5.3 What happens when the proposal ends

This is the part §1.2 got wrong, and it is worth a table because each row is a
different reviewer expectation.

| Event | A comment on the **new version** | A comment on the **original** |
|:--|:--|:--|
| the change removes the text it is about | **orphaned** — the version it is about no longer has it | **fine.** The original still has it, and it is still on screen |
| **approve** | resolves against the file, which now holds that text | **orphaned** — the original has stopped existing, and this is the honest moment for it |
| **discard** | **orphaned** — the version it is about has gone | resolves against the file, which is what it was always about |
| **undo last run** | re-resolved against the previous revision; may move, may orphan, may come back | untouched |

**A comment never silently changes which version it is about.** An orphan on
approve is reported by §8.7 step 7's sweep exactly as any other is, and its card
still says which passage it was written on.

### 5.4 What the agent is told

An ACT comment on the original is the one that needed this whole section, so its
prompt says plainly what it is:

```text
## The passages under discussion

1. In the ORIGINAL version of docs/components.md — the version on disk, which
   the change you are about to make has already edited:
   “LUKAS question: is a web UI possible here?” — line 8 of the original

The reviewer is looking at that passage in the original and asking for a change
to the current version. The current version is the file you may edit.
```

The agent is given the original as a **readable path** — the working copy's
`base` — so it can see what the reviewer is pointing at without being able to
write to it. It is not on the "files you may edit" list, and spec 15 §4.3 puts
back anything written outside that list.

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
- **Not on a PDF or a DOCX**, which have no source line to insert at — the same
  test `applyEnabled` already applies.

---

## 7. The marks

### 7.1 The lane

Revised in spec 15 §8.2, and summarised here because §7.2 depends on it: the
bars move out of each block's own left edge into **one fixed lane down the left
of the pane**, so every bar starts at the same x whatever the block's indent,
and each bar is **wide enough to carry its number inside it** rather than under a
chip that overlaps its neighbour.

### 7.2 Two lanes, one per pane

Each pane draws the bars for the targets that resolved **in it**. A comment on
the original draws on the left; an ordinary comment draws on the right; a comment
with a place in each draws in both, under the same number.

That is what makes the pair readable as a diff of the *review* as well as of the
text: a bar on the left with no twin on the right is a comment about something
the change removed.

### 7.3 The gap's own mark

A gap has no height, so it cannot have a bar that spans its block. It gets:

- a **short bar**, one line-height tall, at the gap's y in the lane, carrying its
  number like every other; and
- a **1px rule** across the text column at the insertion point, in the same
  colour, so the reviewer can see *where* rather than only *that*.

The rule is drawn in the overlay, over the pane. Nothing is inserted into the
document — spec 01 §6.7, which this spec does not bend for a horizontal line any
more than for a `<mark>`.

---

## 8. What this adds

| | |
|:--|:--|
| Dependencies | **none** |
| IPC channels | **none** |
| Tables | none |
| Columns | **none** — both new fields ride in `anchor_json` (§5.1) |
| Shapes | `Anchor.version`, `Anchor.gap`, `GapRef`; `FrameSurface` gains the version it is showing; the App keeps two resolved lists |
| New files | `renderer/anchor/gap.ts` (create and resolve a gap), `renderer/overlay/GapLayer.tsx` (the hover affordance and the rule) |
| Changed | `shared/types.ts`, `renderer/anchor/create.ts`, `renderer/anchor/resolve.ts`, `renderer/anchor/pick.ts`, `renderer/overlay/anchoring.ts`, `renderer/overlay/App.tsx`, `renderer/overlay/DocumentView.tsx`, `renderer/overlay/OriginalPane.tsx`, `renderer/overlay/MarginBars.tsx`, `renderer/overlay/SelectionPanel.tsx`, `renderer/overlay/place.ts`, `main/agent/prompts.ts`, `main/apply.ts`, `main/ipc.ts`, `renderer/overlay/overlay.css`, `test/anchor.spec.ts` |
| Scripts | none new — `npm run test:anchor` gains the gap cases |

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

### 9.2 A comment on the original

- [ ] With a working copy open, selecting text in the left pane offers the
      selection panel, and the saved comment's bar draws in the **left** lane.
- [ ] `pick element` widens a scope in the left pane exactly as it does in the
      right. §1.1 item 2.
- [ ] A comment on a paragraph the change **removed** reads as anchored, not
      orphaned, and stays in the `open` list. **This is §1.2.**
- [ ] Replying to it in ACT mode reaches the agent with the original's passage
      quoted and the working copy as the file it may edit.
- [ ] On **approve**, that comment orphans, and the §8.7 step 7 report says so.
- [ ] On **discard**, it resolves against the file and does not orphan.
- [ ] A comment with one place in each pane draws a bar in both lanes, under one
      number, and its state is the worse of the two.
- [ ] In Reading mode, a comment written on an original that no longer exists is
      **not counted as orphaned** — spec 05 §5.4.

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

### 9.4 Nothing else moved

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
