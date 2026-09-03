# REX 36 — tools in the chat, and the numbers on the head

**Version:** 1.0 · 2026-09-02
**Status:** **built, and driven in a live window.** All four milestones are in
the tree; `npm run test:tool-rows` is 5 tests green, `npm run typecheck` passes
and `nvim-tools --json --all` adds no finding. §6 milestone 3 was run on
2026-09-02 against an isolated REX on port 9444 holding a clone of the real
database — §9 records what it showed.
**Depends on:** [`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md)
§5.2 (what the thread cost, under the answer), §5.3 (a turn is a block), §5.4
(the step strip), §6 (the trace sheet); [`17-stopping-a-run/SPEC.md`](../17-stopping-a-run/SPEC.md)
§3.1 (the running row); [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
§7.3 (the model in the answer's foot); [`31-how-the-agent-writes/SPEC.md`](../31-how-the-agent-writes/SPEC.md)
§5 (the style beside it); [`33-the-comment-row/SPEC.md`](../33-the-comment-row/SPEC.md)
§2.2 (the run line); [`35-the-card-head/SPEC.md`](../35-the-card-head/SPEC.md)
§2.2 (the run line on the head); `renderer/overlay/aside.ts` (tool work ends a
turn).

> [!note]
> **This spec moves three numbers and adds one row.** The turns, the time and
> the cost of a whole chat leave the last answer's foot and join the head's run
> line. Every tool call the agent makes appears in the chat as one icon on a
> row between the turns it happened between. Nothing is stored and no channel
> changes.

---

## 1. Why

### 1.1 The whole chat's numbers sit on one answer

Spec 08 §5.2 put `32 turns · 17m · $12.043` in the last answer's foot, beside
the model and the style. Two of the five are about that answer; three are about
every answer, and they hang on whichever one happens to be last. The
reviewer's words: *"these stats should not be limited to just the last answer;
I believe they should be at the level of the whole chat."*

### 1.2 The chat hides the work

Between a question and its answer the card draws an aside and nothing else. A
run of 72 tool calls reads as *you*, *aside*, *aside*, *answer*, and the only
way to see that anything ran between them is the trace sheet, which covers the
document. The reviewer's words: *"I would like to add them to the chat in a way
that shows all the tools only as icons in one row."*

---

## 2. The numbers — on the head's run line

```text
▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  72 steps (!)4  32 turns · 17m · $12.043        show trace ›
```

Spec 35 §2.2's line gains a third group, after the step numbers and before
`show trace ›`: the spoken turns, the time and the cost, in the faint mono the
foot used. They are pinned with the bars they measure, and the trace head
already prints the same three from the same `totalsOf`. At 384px the line wraps
under the bars as one unit, as it already does.

**The answer's foot keeps the model and the style.** Those are facts about one
answer (spec 25 §7.3, spec 31 §5), and a thread whose turns ran on different
models is exactly the thread that needs each one to say so. The three numbers
are gone from it.

A thread that has not run — a draft, a note — has no run line and no numbers.

---

## 3. The tools — one icon per call, on a row

```text
◯ YOU  ACT                                             13:53
OK so then update the feedback.
   ▸ 🗎 ▸                                   ← three calls: a command, a read, a command
│ ASIDE                                                13:54
│ Merging. Item 7's third bullet already asks the ID question.
   ✎ ▦ ▦                                   ← a change, two diffs
│ ASIDE                                                13:54
│ Now removing 7b.
   ✎ ▦ ▸
✦ ANSWER                                               13:56
```

### 3.1 The row

Between two turns, the tool calls that happened between them, in order, one
icon each. The row is indented to the aside's text, carries no label and no
words, and is one button: clicking it opens the trace (spec 08 §6). Hovering an
icon names the tool and its argument — the same title the step bars carry.

A tool is drawn by what it **does**, as the trace draws it (spec 08 §5.4), with
one glyph added:

| Glyph | For |
|:--|:--|
| a file | a read — `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch` |
| a pencil | **new** — a change to a file: `Edit`, `Write`, `MultiEdit`, `NotebookEdit` |
| a terminal | a command, and any tool that is neither of the above |
| a table | a diff REX made of a change (`diff` message) |
| a red circled `!` | the call ran and failed |
| a red barred circle | the gate refused the call |

The pencil is the one change to the trace's vocabulary. `Edit` and `Bash` were
both a terminal there, which was invisible in a sheet where every block also
says its name; in a row of bare icons it made a change look like a command.
The trace draws the pencil too, so the row and the sheet agree.

### 3.2 Where a row goes

`aside.ts` already says that tool work ends a turn: two asides with a `Read`
between them are two blocks. So every tool call sits between two turns, or
after the last one, and never inside a turn. The rule for a row is the same
walk one step further: the calls since the previous turn are the row **before**
the next turn, and the calls since the last turn are the **trailing** row.

The trailing row is what a running run looks like. As calls land it grows, its
last icon pulses, and the `working…` row with **Stop** (spec 17 §3.1) sits
under it. When the answer arrives the row stops growing and the answer follows
it.

### 3.3 What a row does not do

It does not fold, expand, or show a result. The trace is one click away and
holds every input and output; the row says only *that* something ran and
*what kind* of thing it was, in the order it ran.

---

## 4. Where the code goes

| File | Change |
|:--|:--|
| `renderer/overlay/toolRows.ts` | **new** — `glyphOf(name, denied, failed)` and `toolRowsOf(messages, turnStarts)`: the rows as data. Pure, so `node --test` loads it |
| `renderer/overlay/ToolRow.tsx` | **new** — `ToolIcon` and `ToolRow` |
| `renderer/overlay/TraceSheet.tsx` | `KindIcon` draws a tool through `glyphOf`, so `Edit` is a pencil there too |
| `renderer/overlay/CommentCard.tsx` | the numbers on the run line; the foot without them; a `ToolRow` before each turn that has one and after the last |
| `renderer/overlay/overlay.css` | `.rex-turn-tools`, the pulse, `.rex-card-totals` |
| `test/toolRows.spec.ts` | **new** — the rows for a run with asides, a failed and a refused call, a diff, and a run still going |

---

## 5. What this does not change

- **The trace sheet's blocks.** Same entries, same folds; only the glyph for a
  change.
- **The step bars.** One bar per tool call, as spec 08 §5.4 drew them. A diff
  is not a call and gets no bar.
- **`totalsOf`.** The head reads the same function the foot did and the trace
  head does.
- **What a comment stores.**

---

## 6. Milestones

**0 — the data, with tests.** `toolRows.ts` and `test/toolRows.spec.ts`.
*Done when:* `npm run test:tool-rows` is green.

**1 — the card and the trace.** §2 and §3. *Done when:* `npm run typecheck`
passes.

**2 — the stylesheet.** *Done when:* `nvim-tools --json --all` adds no finding.

**3 — driven in a live window.** A finished thread with asides, a failed call
and a diff. *Done when:* §7 is checked by eye. A run in progress is not driven —
it needs an agent — so the pulse is checked in the stylesheet alone.

---

## 7. Acceptance

- [ ] The head's run line reads `72 steps (!)4 · 32 turns · 17m · $12.043 · show trace ›`.
- [ ] No answer's foot carries turns, time or cost; every answer's foot keeps its model and style.
- [ ] Between a `YOU` turn and the aside that follows it, a row holds one icon per tool call, in order.
- [ ] A failed call is the red circled `!`; a refused one the red barred circle.
- [ ] An `Edit` is a pencil, in the row and in the trace sheet.
- [ ] A `diff` message is a table glyph in the row.
- [ ] Hovering an icon names the tool and its argument; clicking the row opens the trace.
- [ ] `npm run test:tool-rows` and `npm run typecheck` pass; `nvim-tools --json --all` adds no finding.

---

## 8. Rejected

**Numbers at the top edge of the composer.** Pinned too, and close to the
button that spends the next dollar — but the bars and the step count are the
machinery's meter, and three more numbers belong on it, not on a second one.

**Tool names in the row.** `Bash · Read · Bash` is a vocabulary the reviewer
never chose to learn (spec 08 §5.4), and a run of 30 calls in words is a
paragraph. The icons say what kind of thing ran; hover says which.

**Folding the row open into the calls.** That is the trace sheet, which
exists, and a folded copy of it under every aside would be the sheet twice.

---

## 9. What the live run showed

Run on 2026-09-02 on an isolated REX (port 9444, a clone of the reviewer's
database), on comment 4 — 72 steps, 32 turns, four failed calls, one `Edit`
with its diff — at the panel's 385px default.

| Surface | What it said |
|:--|:--|
| The head's run line | `72 steps (!)4`, then `32 turns · 17m · $12.043` under the bars, then `show trace ›` |
| Every answer's foot | `Default (recommended) · Concise` — no numbers |
| The conversation | 18 tool rows. The first: `▸ 🗎 ▸ 🗎 🗎 ▸ 🗎 🗎 ▸` between the question and its aside |
| A failed call | the red circled `!` in its row, between the reads around it |
| The `Edit` | a pencil, then the diff's table glyph, on the last row before the answer |
| Clicking a row | the trace sheet opened; its `EDIT` block wears the same pencil |
| A run in progress | not driven — no agent ran. The trailing row and its pulse are exercised by `test/toolRows.spec.ts` and the stylesheet |

One thing the run did not need to teach but the tests did: a test that
numbers messages at creation time and creates the turns before the calls
walks them in the wrong order. The fixture builds a thread in arrival order,
which is what `seq` means.
