# REX 37 — the composer is the card's foot

**Version:** 1.0 · 2026-09-02
**Status:** **built, and driven in a live window.** All three milestones are in
the tree; `npm run typecheck` passes and `nvim-tools --json --all` adds no
finding. §5 milestone 2 was run on 2026-09-02 against an isolated REX on port
9444 holding a clone of the real database — §8 records what it showed.
**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§3 (selecting is a phase, and the panel is where it stands), §3.2 (`clear`,
and the order of the rows); [`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md)
§3.2 (the panel is the tab's whole body); [`24-pointing-mid-conversation/SPEC.md`](../24-pointing-mid-conversation/SPEC.md)
§3.2 (the pending strip above the reply box), §3.4 (the places a `YOU` turn
brought with it), §5.1 (`messageId` on a target); [`26-widening-a-place/SPEC.md`](../26-widening-a-place/SPEC.md)
§4.1 (the scope chips on an expanded row); [`30-drafts-and-the-comment-list/SPEC.md`](../30-drafts-and-the-comment-list/SPEC.md)
§3 (the composer is a screen), §3.6 (its heading is its name box);
[`35-the-card-head/SPEC.md`](../35-the-card-head/SPEC.md) §2.4 (`PLACES n`),
§2.6 (the three grounds).

> [!note]
> **This spec moves one list and adds one row of pills.** The new comment's
> places move from the top of an empty screen to the foot, above the box they
> are sent with — where an open comment already keeps the places picked for its
> next reply. And the first `YOU` turn of a comment shows the places it started
> with, as every later turn already shows the places it brought. Nothing is
> stored and no channel changes.

---

## 1. Why

### 1.1 The new comment does not look like the comment it becomes

Measured on 2026-09-02. **New comment**, one place picked: the place is a row
at the top of the column under `clear`, then 900px of nothing, then the box and
the send row at the foot. Press **Ask**, and the same column is the card: a
head, the conversation, and the box at the foot with the places picked for the
next reply in a strip above it (spec 24 §3.2). The reviewer's words: *"the
visual experience is broken because, for the new comment, it looks really
different than when I send the message."*

### 1.2 The first message hides what it was about

Spec 24 §3.4 draws the places a `YOU` turn brought under its text, as pills.
Only later turns get them: the places a comment was created with have no
`messageId` (spec 24 §5.1) and hang on no turn, so the first `YOU` turn — the
one that was about them — shows none, and the second shows its two. The
reviewer's words: *"the section does not have the same pill with the selections
that I've sent."*

---

## 2. The composer

```text
‹ New comment                                              ← the header, as it is
                                                           ← the body: empty, or the hint
──────────────────────────────────────────────────────────
PLACES 3                                            clear  ← the strip head
 1  List item 4                                        🗑
    components.md
 2  Paragraph · “The Materializer validates…”          🗑
    components.md
 3  Section · “Canonical test selection”               🗑
    components.md
┌──────────────────────────────────────────────────────┐
│ What about these?                                    │
└──────────────────────────────────────────────────────┘
 ASK  ACT  NOTE  ⇧⇥         Default   default   Ask about 3
```

### 2.1 The foot is the card's foot

The composer is one screen with the card's three parts and the card's three
grounds (spec 35 §2.6): a header, a body on the panel's ground, and a foot with
a rule above it. The body holds nothing — there is no conversation yet — except
the hint that says how picking starts, while nothing is picked.

The foot is spec 24 §3.2's strip, then the box, then the send row. The strip's
head reads `PLACES n`, the words the card head uses for the same list (spec 35
§2.4), with `clear` at its right where the card's strip has `new comment ›`.
The rows are the rows the panel has today — number, label, document, remove;
click to go to it and open its widen chips (spec 26 §4.1); drag to reorder —
and they keep every one of those. The list is capped at two fifths of the
column and scrolls past it, so the box stays on screen under twenty places.

**Send needs a place.** The box is drawn with nothing picked, so the hint and
the box are on screen together, and the button stays disabled until there is a
place to send about — the composer used to draw no box at all in that state,
and a screen that changes shape when the first place lands is the discontinuity
§1.1 is about.

### 2.2 What does not move

`clear` keeps its confirm above three places (spec 05 §3.2). The name box in
the header (spec 30 §3.6), the mode switch, the model and style pickers, the
grip above the box, and the `⇧⇥` chord all stay as they are.

---

## 3. The first turn's pills

Spec 24 §3.4's rule, completed: the places with no `messageId` are the places
the comment started with, and they belong to the first `YOU` turn — the message
`threadAsk` sends verbatim as the conversation's opening (spec 08). They are
drawn under it exactly as a later turn's places are drawn under that turn:
the violet index and the file name, as pills, in target order. A comment whose
first turn is REX's own notice draws them under the first `YOU` turn there is.

The head still lists every place. The pills say which message brought which,
which for the first message was never said.

---

## 4. Where the code goes

| File | Change |
|:--|:--|
| `renderer/overlay/SelectionPanel.tsx` | §2 — the body, the strip, the foot. The rows and their handlers are unchanged |
| `renderer/overlay/CommentCard.tsx` | §3 — the places with no `messageId` go to the first `YOU` turn |
| `renderer/overlay/overlay.css` | the composer's grounds; the strip head; `.rex-selection-head` deleted; the list's cap |

---

## 5. Milestones

**0 — the card.** §3. *Done when:* `npm run typecheck` passes.

**1 — the composer.** §2. *Done when:* `npm run typecheck` passes and
`nvim-tools --json --all` adds no finding.

**2 — driven in a live window.** A new comment with three places, at 384px;
a comment opened after it was sent. *Done when:* §6 is checked by eye.

---

## 6. Acceptance

- [ ] **New comment** with nothing picked shows the header, the hint, and the box with its button disabled.
- [ ] With three places picked, the places sit above the box under `PLACES 3`, with `clear` at the right, and the body above them is empty.
- [ ] A row still opens its widen chips on click and drags to reorder.
- [ ] After **Ask**, the card's first `YOU` turn carries one pill per place the comment started with.
- [ ] A later reply with new places still carries its own pills, numbered on from the comment's places.
- [ ] `npm run typecheck` passes; `nvim-tools --json --all` adds no finding.

---

## 7. Rejected

**A head on the composer.** The card's head is the comment's name, its run
and its places, and a new comment has a name box in the header already, no run,
and places that are still being chosen. A head with the places in it would put
the list back at the top, which is where it is now.

**Pills in the composer instead of rows.** A pill is a place that is settled;
a row in the composer can still be widened, reordered and removed. The strip
above the card's reply box uses rows for the same reason (spec 24 §3.2).

---

## 8. What the live run showed

Run on 2026-09-02 on an isolated REX (port 9444, a clone of the reviewer's
database), at the panel's 385px default, with three paragraphs of
`components.md` selected in the frame one after another.

| Surface | What it said |
|:--|:--|
| **New comment**, nothing picked | the header, the hint in the body, the box, the mode switch, and `Ask about 0` disabled |
| Three places picked | `PLACES 3 · clear` above three rows — label, file, remove — then the box, then the send row reading `Ask about 3`. The body above them empty |
| Comment 4's first `YOU` turn | three pills, `1 user-interaction-flow.md · 2 components.md · 3 overview.md` — the places it started with. Its other two places were added by later messages and stay on those |

Nothing was sent: an Ask runs an agent, and the second instance has no business
spending money on `dsafadf`. The pills on a freshly sent comment are the same
code path as the ones on comment 4, whose opening places have no `messageId`
either.

One thing the build found: `opening` was already a name in the card — the
first turn, for the note check — and the first draft reused it. The places a
comment started with are `startedWith`.
