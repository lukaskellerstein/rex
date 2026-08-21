# REX 05 — selection as a phase

**Version:** 1.0 · 2026-08-21
**Status:** specified, not implemented
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md),
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md),
[`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md) and
[`04-selection-and-shortcuts/SPEC.md`](../04-selection-and-shortcuts/SPEC.md).

> [!note]
> This document extends specs 01 to 04. It does not restate them. §2 says
> exactly what changes; everywhere else the earlier specs still govern,
> including all three invariants of spec 01 §3 and the whole anchoring model.

---

## 0. How to use this document

Read §1 and §3 first. §3 is the whole idea and everything else is a consequence
of it. Then §5, which is the one place the data model changes, and then work
the milestones in §10.

**Three rules for the implementer:**

1. **Nothing here weakens the three invariants of spec 01 §3.** No listening
   port, no database handle in the renderer, and anchor resolution stays in the
   renderer, on the live DOM.
2. **An anchor is still an anchor.** Spec 01 §6 is untouched: same four layers,
   same creation, same resolution. What changes is how many of them a comment
   has and which documents they come from.
3. **A held modifier is not a mode.** §3.1 explains why the whole feature is
   built without one, and why re-introducing one would bring back the bug it
   was meant to fix.

---

## 1. What is wrong

Spec 04 gave a comment more than one target, but left selecting them as
something that happens *inside* a floating card. Measured against the running
app on 2026-08-21, that produced four faults and one hard limit.

| # | Symptom | Cause |
|:--|:--|:--|
| 1 | Holding ctrl and dragging out a text selection catches a few characters and stops | On macOS ctrl-drag **is** a right-drag. The OS owns the gesture; no application can have it back |
| 2 | The composer takes focus, so `P`, `D`, `G` stop working while it is open | The note field is focused on open and the shortcuts are correctly suppressed while a field has focus (spec 04 §6) |
| 3 | Clicking outside the composer throws the draft away with no warning | A click in the document with no selection clears the draft |
| 4 | A new selection inherits the previous one's extra targets | The draft is replaced but the extras are not, unless the code happens to reset them |
| 5 | A comment cannot be about two documents | `Thread` has one `documentId` and the comment list is scoped to the open document |

Faults 2, 3 and 4 are all the same fault: **a transient card is the wrong home
for something that is being built up over time.** Selecting three cells across
two documents is a task with a beginning and an end, and it needs somewhere to
stand while it is happening.

---

## 2. Changes to specs 01 to 04

| Spec | Change |
|:--|:--|
| 01 §4 Shared types | `Thread.anchor` and `Thread.extraAnchors` are replaced by `Thread.targets: AnchorTarget[]`. §5.1. |
| 01 §6 Anchoring | **Unchanged in code.** A target in a document that is not open is simply not resolved, and says so. §5.4. |
| 01 §7 Overlay | The floating composer is removed. The note is written in the selection panel. §4. |
| 01 §8.6 Prompts | The Ask prompt lists every target under the document it came from. §5.5. |
| 01 §8.7 Apply | **Unchanged and still single-document**: it writes back through `targets[0]` only. §5.6. |
| 01 §9 Database | New `thread_target` table; `thread.anchor_json`, `extra_anchors_json` and `anchor_state` retire into it. §5.2. |
| 01 §10 IPC | `thread:list` takes a workspace root, not a document id. `anchor:restate` restates one target. §7. |
| 02 §4.1 Explorer counts | A document's count includes every comment with a target in it, not only comments that started there. §5.7. |
| 04 §4 Multi-target comments | Kept whole. The `+ another place` button and the ⇧/ctrl/⌘ modifiers are removed, because §3.1 makes them unnecessary. |
| 04 §4.5 Draft outlines | Kept, and extended: the outlines are now the selection's, not a draft's, and they are numbered to match the panel. |

---

## 3. Selection is a phase

Reviewing has three steps, and REX only ever named two of them.

1. **Select** — build up what the question is about. One passage, or nine cells,
   or a table here and a paragraph in another document.
2. **Ask** — say what you want to know about all of it.
3. **Discuss** — the thread, exactly as it is today.

Step 1 gets its own place on screen: the **selection panel**, at the top of the
right sidebar, above the comments. It appears when the first item is selected
and is gone when there is nothing in it.

```text
┌ SELECTION · 3 ─────────────────────── clear ┐
│ 1  “the retry budget is 3”                × │
│    sample-document.md                       │
│ 2  Table · 7 rows × 4 columns             × │
│    sample-document.md                       │
│ 3  Cell · row 2, “Default”                × │
│    components.md                            │
├─────────────────────────────────────────────┤
│ What about these?                           │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│ [ Ask about 3 ]                             │
└─────────────────────────────────────────────┘
┌ open 6 · resolved 0 · orphaned 1 ───────────┐
│ … the comments …                            │
```

### 3.1 Everything selected is added. There is no modifier

Select a run of text, or pick an element: it goes into the panel. Select
another: that goes in too. Nothing replaces anything.

This is the whole reason the panel exists, and it is also the fix for fault 1.
**A held modifier cannot be part of this.** `ctrl`-drag is a right-drag on
macOS and the operating system takes it before the page sees it — that is not
a bug REX can fix, and spec 04 §4.6 already had to route ctrl-click through
`contextmenu` for the same reason. With the panel accumulating by default, no
modifier is needed for anything, so ⇧, ctrl and ⌘ stop being selection
modifiers entirely.

The cost is that you must remove what you did not mean, rather than replace it.
That is one click on a row you can see, against a gesture the OS breaks.

> [!warning]
> Do not add "hold X to add" back later. It reads as a small convenience and it
> reintroduces fault 1 on macOS the moment the gesture is a drag rather than a
> click.

### 3.2 What the panel holds

One row per selected item, numbered, in the order they were selected:

- the **number**, which is the same number drawn on the item in the document
  (spec 04 §4.5) — the only thing tying a box in a table to a row in a list;
- what it is: the quote for a text selection, the description for an element
  (`Table · 7 rows × 4 columns`);
- **which document it came from**, always, not only when it differs — a list
  where the document appears sometimes is a list you have to read twice;
- a **remove** control.

Rows can be reordered by dragging. The order is the order the agent is given
them in, and `targets[0]` is what Apply writes back through (§5.6), so it is not
decoration — but nothing else depends on it, and a reviewer who never reorders
loses nothing.

**`clear`** empties the panel. It asks first when there are more than three
items or a note has been typed: everything in it was picked by hand.

### 3.3 It survives switching documents

The panel is the reviewer's, not the document's. Opening another document, or
the graph, leaves it exactly as it was. That is what makes a question about two
documents possible at all.

Items whose document is not the open one keep their row and their number. They
have no outline to draw, because their document is not on screen; the row says
which document it is in, and clicking the row opens that document and scrolls
to the item.

**Session-only.** The panel is not written to the database and does not survive
a restart. It is a scratchpad for one sitting, and a half-built selection
restored three days later is a puzzle, not a help.

### 3.4 Ask

`Ask about n` creates one thread with every item as a target, in panel order,
and empties the panel. From there it is a thread like any other: spec 01 §8 is
unchanged.

The button is disabled with an empty note. The note is the question; without it
there is nothing to ask.

---

## 4. The floating composer is removed

`Composer.tsx` goes. Its three faults were all the same fault (§1), and the
panel does not have them:

- **It cannot steal a shortcut.** The note field is in the sidebar and is
  focused only when clicked. `P`, `D` and `G` keep working while a selection is
  being built, which is what makes picking a third element possible at all.
- **It cannot be dismissed by accident.** Nothing but `clear`, or Ask, empties
  the panel. A click in the document adds to it.
- **It cannot inherit.** There is no draft to leak: there is one panel, its
  contents are visible, and they change only when the reviewer changes them.

The scope chips — `cell · row · table`, spec 03's widening — move onto the
**panel row**, so the reviewer can still widen a selection after making it. The
strength meter and the `region of it` control move with them.

---

## 5. A comment spans documents

### 5.1 The type

```ts
/** One place a comment is about. */
export interface AnchorTarget {
  documentId: string;
  anchor: Anchor;
  /**
   * The last resolution, or null when this document has not been open since
   * the target was written. Null is not orphaned — §5.4.
   */
  state: AnchorState | null;
}

export interface Thread {
  id: string;
  /**
   * Where the comment started: `targets[0]`'s document. Apply writes back
   * through it and the agent's repository root comes from it.
   */
  documentId: string;
  targets: AnchorTarget[];   // empty for a synthesis thread
  // anchor, extraAnchors and anchorState are gone — they live in targets now
  …
}
```

`Thread.anchor`, `Thread.extraAnchors` and `Thread.anchorState` are removed.
Spec 04 introduced `extraAnchors` as the smallest change that could work; a
target that carries its own document cannot be an `Anchor`, so the pair
collapses into one list.

### 5.2 The database

```sql
CREATE TABLE IF NOT EXISTS thread_target (
  thread_id     TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  document_id   TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  anchor_json   TEXT NOT NULL,
  anchor_state  TEXT CHECK (anchor_state IN ('ok','moved','orphaned')),
  PRIMARY KEY (thread_id, position)
);

CREATE INDEX IF NOT EXISTS idx_target_document ON thread_target(document_id);
```

The index is what makes §5.7 and the workspace-wide list cheap.

**The migration moves data, which spec 04 §4.2's did not.** `openDatabase`
already walks a table of expected columns; it gains a step that, for every
thread with an `anchor_json` and no `thread_target` rows, writes the primary
anchor as position 0 and each `extra_anchors_json` entry after it, all with the
thread's own `document_id` and its `anchor_state`. The old columns are left in
place and stop being read: dropping a column rewrites the table, and a
half-finished rewrite of somebody's comments is not worth the tidiness.

### 5.3 The comments list is the workspace's, not the document's

Today the right sidebar lists the open document's comments. It stops doing
that. It lists **every comment in the workspace**, and each row names the
document or documents it is about:

```text
  4   do these two disagree?
      sample-document.md · components.md
  5   is 1024 still the right default?
      sample-document.md
```

A comment about two documents is one row, seen from either of them, which is
what a comment about two documents is. There is no "which document am I looking
at" rule to learn, and none to get wrong.

`thread:list` therefore takes a **workspace root** instead of a document id and
returns every thread with a target in a document under it, plus every synthesis
thread that references one. With no workspace open — a single document opened
by path — it takes that document's own directory, so the behaviour with one
file is what it was.

> [!note]
> A long list is the obvious risk. A `this document` filter chip beside
> `open / resolved / orphaned` is the answer, and it is **out of scope** here
> (§11) rather than guessed at now.

### 5.4 Resolution, when only one document is open

Invariant I1 puts resolution in the renderer, on the live DOM. A target in a
document that is not open has no live DOM, so it is **not resolved and not
guessed at**.

- The sweep resolves only targets whose `documentId` is the open document, and
  restates only those.
- Every other target keeps the state it last had, or `null` if it has never
  been open.
- `null` renders as `not checked here`, in the muted grey the design uses for
  absence. It is **not** orphaned, and it must never be counted as one: an
  orphan means "the text is gone", and this means "nobody looked".

A thread's overall state is the worst of the states it actually has, ignoring
`null` — the rule spec 04 §4.3 introduced, with one more case.

### 5.5 The prompt

`askPrompt` groups the targets by document and names each one:

```markdown
## Highlighted passages

### sample-document.md
1. the retry budget is 3
2. Table · 7 rows × 4 columns  (no text — an element anchor)

### ../shared/components.md
3. Retries are capped at five.

## Comment
Do these disagree?
```

Paths are relative to the repository root of `targets[0]`'s document. A target
outside that root is written absolute, because a relative path that climbs out
of the tree tells the agent less than the real one.

The `## Surrounding section` block (spec 01 §8.6) is emitted for `targets[0]`
only. Emitting it for nine targets would bury the question.

### 5.6 Apply is unchanged, and still single-document

Apply writes back through `targets[0]` and nothing else. It was already
disabled without a source line (spec 01 §5.2), and a diff that edits three
files from one comment is a different feature with a different confirmation
step. The card says so plainly when the thread has targets in more than one
document.

### 5.7 The explorer's counts

`commentCountsByDocument` counts threads whose **`document_id`** matches. It
changes to count threads with a **target** in that document, so a document
mentioned by a comment written elsewhere is not shown as having none. The join
moves from `thread` to `thread_target`, and `DISTINCT thread_id` keeps a comment
with three targets in one document from counting three times.

---

## 6. Highlighting

Spec 04 §4.5 drew the draft's targets as numbered dashed outlines. That is kept
and becomes the selection's, with two additions:

- Only targets in the **open document** are drawn. The rest exist as rows.
- Hovering a row in the panel brightens its outline, and hovering an outline
  brightens its row. It is the cheapest way to answer "which one is number 6"
  and it costs one class name.

A text target is painted with the Custom Highlight API and an element target as
an outline, exactly as §6.7 and spec 04 §4.3 already do. Nothing here wraps a
range in an element.

---

## 7. IPC

| Channel | Change |
|:--|:--|
| `thread:list` | takes `{ root: string }` (a workspace root or a document's directory) instead of a document id |
| `thread:create` | takes `targets: Array<{ documentId, anchor }>` instead of `anchor` + `extraAnchors` |
| `anchor:restate` | takes `{ threadId, position, anchorState }` — one target, not a thread |
| `doc:resolveFor` | **new.** Given a path, returns its `documentId` without opening it, so the panel can hold a target for a document that is merely known |

No new transport, no new privilege: three existing channels change shape and
one is added. Invariant I3 is untouched.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `src/shared/types.ts` | `AnchorTarget`; `Thread.targets` |
| `src/shared/channels.ts` | the four channels in §7 |
| `src/main/db/schema.sql` | `thread_target` |
| `src/main/db/database.ts` | the data-moving migration |
| `src/main/db/queries.ts` | targets, the workspace-wide list, the counts |
| `src/main/agent/prompts.ts` | grouped passages |
| `src/main/ipc.ts` | the changed channels |
| `src/renderer/overlay/SelectionPanel.tsx` | **new** — the panel, its rows, the note |
| `src/renderer/overlay/Composer.tsx` | **deleted** |
| `src/renderer/overlay/Sidebar.tsx` | workspace-wide list, documents per row |
| `src/renderer/overlay/App.tsx` | the selection is app state, not draft state |
| `src/renderer/overlay/DocumentView.tsx` | outlines for the open document's targets |
| `src/renderer/overlay/anchoring.ts` | resolve only the open document's targets |
| `test/prompts.spec.ts` | grouped passages |
| `test/targets.spec.ts` | **new** — the migration, and the worst-state rule with `null` |

---

## 9. What this deliberately does not change

- The anchoring model. Spec 01 §6 is untouched.
- The `read` / `write` profile split and the deny gate (spec 01 §8.4).
- Apply (§5.6).
- The graph, the explorer tree, and every renderer added by spec 03.

---

## 10. Milestones

**Milestone 15 — the panel, one document.** `AnchorTarget`, `thread_target`,
the migration, the panel, the composer deleted. Selection accumulates, the note
is written in the panel, Ask creates the thread. Targets are still all in one
document. *Done when:* three cells in one table become one comment, the panel
clears, the comment shows three outlines after a reload, and the migration
leaves every existing comment resolving exactly as it did.

**Milestone 16 — across documents.** `doc:resolveFor`, the workspace-wide list,
per-document rows, `null` states, the grouped prompt, the explorer counts.
*Done when:* a comment made of two items in `sample-document.md` and one in
`components.md` appears from both documents, shows `not checked here` for the
one that is not open, and the prompt names both files.

**Milestone 17 — the small things.** Reordering, hover pairing between row and
outline, the `clear` confirmation.

---

## 11. Out of scope

- **A `this document` filter** on the comment list. It will be wanted; it is
  one chip and it is not needed to know whether the rest of this is right.
- **Apply across documents** (§5.6).
- **A selection that survives a restart** (§3.3).
- **Selecting in the graph.** A node is a document, not a passage, and a
  comment about a whole document is a comment with no anchor.
- **Editing an existing comment's targets.** The panel builds a comment; it
  does not edit one. Adding that needs a channel and a card-side editor, and
  nothing has asked for it.
