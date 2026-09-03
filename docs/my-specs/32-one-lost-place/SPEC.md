# REX 32 — one lost place is not a lost comment

**Version:** 1.0 · 2026-09-02
**Status:** **built, and driven in a live window.** All four milestones are in
the tree; `npm run test:targets` is 17 tests green, `npm run typecheck` passes
and `nvim-tools --json --all` adds no finding. §7 milestone 3 was run on
2026-09-02 against an isolated REX on port 9444 with its own database — §8
records what it showed.
**Depends on:** [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§5.1 (a comment is about several places), §5.4 (a thread's worst target state,
and why `null` is not orphaned), §5.7 (the explorer's counts);
[`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md) §5.2 (per place,
the best of the two panes); [`18-what-the-colours-mean/SPEC.md`](../18-what-the-colours-mean/SPEC.md)
§2 (resolved is terminal), §2.1 (`moved` is not a lane), §3 (the vocabulary);
[`30-drafts-and-the-comment-list/SPEC.md`](../30-drafts-and-the-comment-list/SPEC.md)
§2 (`laneOf`, the one rule the list and the paper share), §5.2 (one row per
place).

> [!note]
> **This spec adds no feature. It reverses one line of spec 05 §5.4.** A comment
> has been as good as its **worst** place since spec 04. It becomes as good as
> its **best** one: a comment is lost only when every place it has is lost. The
> word on the row stops being a verdict and becomes a count. Nothing new appears
> on screen and no table changes.

---

## 1. Why

### 1.1 A comment with three good places was filed as lost

Measured on 2026-09-02, on thread `75804a2a` — a comment about scenario 2, with
four places:

| # | Document | State |
|:--|:--|:--|
| 1 | `docs/scenarios/02-add-feature.md` | ok |
| 2 | `lukas-feedback.md` · section | **orphaned** |
| 3 | `docs/architecture/components.md` · section | ok |
| 4 | `lukas-feedback.md` · section | ok |

One heading was renamed. The row read **anchor lost**, the card read *"the text
it was written on is gone"*, and the comment left the `open` filter for the
`gone` lane. Three of its four places were on screen, painted, and one click
away the whole time.

The reviewer's words:

> I think I can see all of the anchors, and there is one selection where the
> anchor was lost. However, there also exist other selections where the anchors
> are still present. […] evidence of the state should only be at the selection
> level.

### 1.2 The rule is right for one place and wrong for many

`worstState` (`shared/targets.ts`) ranks `orphaned` above `moved` above `ok` and
hands the loudest one to the whole comment. It was written in spec 04, when a
comment had one anchor and "the worst of one" is that one. Spec 05 §5.1 gave a
comment many places and kept the rule unchanged, and nothing has re-read it
since.

The cost grows with the number of places, which is backwards. A comment about
six passages is the one most likely to have a place die, and the one least
likely to be lost by it.

### 1.3 The lane is the damage, not the word

A wrong word is read and discounted. A wrong lane is not read at all: the
comment is not in `open`, so the reviewer working through the open list never
sees it. Spec 18 §2 built the `gone` lane so *"a reviewer does not lose a
question they asked"*, and under the worst-wins rule the lane loses questions of
its own.

---

## 2. The rule — a comment is lost only when every place is

**Replace "the worst of its places" with "the best of its places".**

| Places, ignoring the ones nobody looked at | The comment is |
|:--|:--|
| none checked | **not checked here** — unchanged, spec 05 §5.4 |
| every one orphaned | **gone** |
| at least one found, and something is not `ok` | **open**, and it says what changed |
| every one `ok` | **open** |

`null` keeps the meaning it has had since spec 05 §5.4 and competes in neither
direction: a place nobody has looked at cannot lose a comment, and cannot save
one either. A comment with one orphaned place and three unchecked ones is gone,
because every answer anyone has is *gone*.

### 2.1 `moved` follows the same shape, one step down

A comment with one moved place out of four has never been *moved*. It has a
place that moved.

`moved` stays what spec 18 §2.1 made it — **not a lane**, a fact on the card and
an amber wash. So it takes the leftover: a comment is `moved` when it is not
gone and at least one of its places is not `ok`. A part-lost comment therefore
wears amber, which is the right loudness. It is not an alarm, and it is not
nothing.

### 2.2 The word is a count, not a verdict

One state cannot describe four places, so REX stops trying. Where the places
disagree, the row and the card print how many:

| Places | Word |
|:--|:--|
| 1 of 1 lost, or 4 of 4 | `anchor lost` |
| 1 of 4 lost | `1 of 4 lost` |
| 4 of 4 moved | `text moved` |
| 2 of 4 moved | `2 of 4 moved` |
| 1 lost and 1 moved, of 4 | `1 of 4 lost` — the loss is the louder half |
| all `ok` | nothing, as today |

The denominator is the number of places anyone has looked at, never the number
the comment has. `1 of 4 lost` with a fifth place in a file that has never been
opened would be a claim about a file nobody read.

---

## 3. What the reviewer sees

Four surfaces print the comment-level state, and each keeps its shape:

| Surface | Today, for the comment in §1.1 | After |
|:--|:--|:--|
| Row word (`ThreadRow`) | `anchor lost` | `1 of 4 lost` |
| Row lane and filter | `gone` | `open` |
| Card head line | "the text it was written on is gone" | "1 of 4 places lost" |
| Card pill | `ANCHOR LOST` | `1 OF 4 LOST` |
| Card place list | already right — one row per place | unchanged |
| Margin bars | already right — one bar per place | unchanged |
| Debug report | already right — one line per place | unchanged |

**The loss word stays grey.** Spec 18 §3 gives grey `--gone` to absence and
amber `--moved` to a thing that shifted, and a part-lost comment has both: an
amber wash under a grey word. The two are not in tension — the wash says which
lane the comment is in and the word says what happened to its places.

### 3.1 The card's place list is the answer, and it was always there

`PlaceState` has printed `anchor lost` / `text moved` / `not checked here` per
place since spec 05 §5.2. Nothing above it ever agreed with it. This spec does
not add a surface; it makes the four summaries above tell the truth the list has
been telling all along.

---

## 4. The explorer's counts

The tree's grey `?` count is the same rule written a second time, in SQL
(`commentCountsByDocument`), and it must move with the first one or the two
surfaces disagree about one comment — which is the bug spec 18 §2 was written to
fix.

Two things change there:

1. **`MAX` becomes `MIN`.** `MAX(rank) = 2` is "some place is gone"; `MIN(rank)
   = 2` is "every place is gone". `MIN` ignores `NULL` exactly as `MAX` did, so
   §2's treatment of the unchecked is unchanged.
2. **The verdict is taken over the whole comment, not over one document's share
   of it.** The inner query groups by document *and* thread today, so a comment
   with a dead place in `a.md` and a live one in `b.md` is gone for `a.md` and
   open for `b.md`. The tree then says gone about a comment the sidebar calls
   open. The comment is one thing and gets one verdict, counted against every
   file it names.

Spec 18 §4.2's other guarantee is untouched: `open`, `resolved` and `gone` stay
disjoint, and `resolved` stays terminal.

---

## 5. Where the code goes

`shared/targets.ts` keeps holding the rule, and grows a tally so the count in
§2.2 has one source:

```ts
/** How a comment's places came out. `checked` is ok + moved + orphaned. */
export interface PlaceTally {
  ok: number;
  moved: number;
  orphaned: number;
  /** Nobody looked — spec 05 §5.4. Competes in neither direction. */
  unchecked: number;
  checked: number;
}

export function tallyPlaces(states: ReadonlyArray<AnchorState | null>): PlaceTally;

/** §2 — the comment's own state, `orphaned` only when every place is. */
export function threadState(tally: PlaceTally): AnchorState | null;

/** §2.2 — the word, and which of the two colours it wears. */
export function placesWord(tally: PlaceTally): { text: string; tone: "lost" | "moved" } | null;
```

`worstState` is **deleted**, not deprecated. Four call sites read it and every
one of them wants the new rule; leaving it in the file is leaving the old rule
available to the next caller.

| File | Change |
|:--|:--|
| `shared/targets.ts` | the three functions above; `worstState` goes |
| `renderer/overlay/anchoring.ts` | both sweeps roll up with `threadState` |
| `renderer/overlay/App.tsx` | `tallyById` is the memo; `stateById` derives from it |
| `renderer/overlay/ThreadRow.tsx` | `StateWord` takes the tally and prints §2.2 |
| `renderer/overlay/CommentCard.tsx` | the head line and the pill take the tally |
| `renderer/overlay/Sidebar.tsx`, `DiffDialog.tsx` | carry the tally through |
| `main/db/queries.ts` | §4 |
| `cli/export.ts` | the export's state line takes the tally |
| `renderer/overlay/lanes.ts` | no code change — `laneOf` is handed the new state |

`wash.ts` does not change either. It takes an `AnchorState` and always did; what
that state means is decided one level up.

---

## 6. What this does not change

- **`null` is not orphaned.** Spec 05 §5.4 stands, and §2 leans on it harder
  than the old rule did.
- **Per place, the best of the two panes.** Spec 16 §5.2 is a different question
  — one place seen twice — and its rule was already "best". This spec makes the
  per-comment rule agree with it instead of contradicting it.
- **`resolved` is terminal.** Spec 18 §2. A resolved comment never enters `gone`,
  however many of its places die.
- **`moved` is not a lane.** Spec 18 §2.1.
- **The margin bars, the card's place list and the debug report.** All three are
  per place already.
- **The `gone` lane exists.** The reviewer proposed removing the comment-level
  state entirely. §9 records why it stays.

---

## 7. Milestones

**0 — the rule, with tests.** `tallyPlaces`, `threadState` and `placesWord` in
`shared/targets.ts`; `worstState` deleted; `test/targets.spec.ts` rewritten
around the new rule, including the §1.1 comment as a case.
*Done when:* `npm run test:targets` is green and names 3-ok-1-lost explicitly.

**1 — the SQL.** §4, with the disjointness test kept and a new counting case: a
comment with one dead place and one live one in the same file counts as `open`.
*Done when:* `npm run test:targets` is green.

**2 — the surfaces.** §3, plus the plumbing in §5.
*Done when:* `npm run typecheck` passes and `nvim-tools --json --all` adds no
finding.

**3 — driven in a live window.** Open a document holding a comment with several
places, kill one of them, and read the row, the card and the tree.
*Done when:* the comment stays in `open`, the row says `1 of N lost`, and the
card's place list still names the dead one.

---

## 8. What the live run showed

Run on 2026-09-02, on an isolated REX (port 9444, its own database) holding a
two-file workspace and three comments: one with four places and a dead second
place, one whose two places are both dead, and one clean single-place comment.

| Surface | What it said |
|:--|:--|
| Filter chips | `open 2 · gone 1` — the part-lost comment is open; only the all-dead one is gone |
| Its row | `1 of 4 lost`, on `rex-thread-moved` — the amber wash of an open comment |
| Its card head | `anchored in 4 places · 1 of 4 places lost` |
| Its card pill | `1 OF 4 LOST`, in `rex-pill-lost` |
| Its place list | place 2 `anchor lost`; places 1 and 3 with their new line numbers |
| Tree, `plan.md` | `2 open comments · 1 comment whose text is gone` |
| Tree, `notes.md` | `1 open comment` — §4's second rule, the comment counted whole |

One thing the run showed that the spec only implies. With `notes.md` never
opened, the row read **`1 of 3 lost`**: the fourth place had no answer, so it was
not in the fraction. Opening `notes.md` made it `1 of 4 lost` and it stayed there
after going back. That is §2.2 working — the denominator is what anyone has
looked at — and it means the number can grow as a reviewer moves through the
workspace.

---

## 9. Rejected

**Remove the comment-level state altogether**, and keep state only per place —
the reviewer's own first proposal. It is right about where the evidence lives
and wrong about what the summary is for. A comment whose every place is gone has
no highlight and no margin bar: it cannot be reached by pointing at the paper,
and the `gone` lane is the only way back to it. With no comment-level state
there is no lane, and such a comment sits in `open` looking normal and pointing
at nothing. The lane is not a summary of the places. It answers a different
question — *can I still find this comment on the paper* — and §2 is that question
written down.

**Count the places in the lane row**, as a sixth chip. The filter row already
wraps at five (spec 30 §4.4), and a partly-lost comment belongs in `open`, not
in a lane of its own.

**Keep worst-wins and only fix the words.** The word would then say `1 of 4 lost`
on a row that had dropped out of the `open` filter — a more precise label on the
same lost comment. §1.3 is why the lane is the part that had to move.
