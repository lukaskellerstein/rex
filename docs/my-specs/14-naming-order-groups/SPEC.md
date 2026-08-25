# REX 14 — naming, order and groups

**Version:** 1.3 · 2026-08-25
**Status:** proposed.

| § | What | Status |
|:--|:--|:--|
| §3 | the name | **to build** |
| §4 | the order | **to build** |
| §5 | groups, nested | **to build** |
| §6 | the data | **to build** |
| §7 | the panel, drawn | **to build** |

**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §4 and §9 (the
shapes and the schema), [`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md)
§5.3 (the comment list belongs to the workspace, not to one document),
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §3.1 (the sidebar
does one job at a time) and §7.3 (a row can open what it names).

> [!note]
> **Version 1.1 made renaming visible.** Version 1.0 hid the gesture behind a
> double-click, `F2` and a `…` menu — three ways in, none of them on the screen.
> A name nobody can see how to change is a name nobody changes, which is §1's
> complaint with an extra step. §3.3 now puts a pen on the row, **on the comment
> row and on the group row alike**.
>
> **Version 1.2 settled which pen: the one REX already has.** 1.1 proposed a
> second glyph to keep rename apart from ACT's pencil. The reviewer decided one
> pen is enough — §7.5 records the decision, where `Pencil` is actually drawn
> today, and what to watch if the two ever end up side by side.
>
> **Version 1.3 said out loud that a group is draggable, and that everything in
> it travels.** 1.0 had it implied — `CommentItem` carried a `group` kind and
> `comment_group` carried a `position` — which is not the same as specified.
> §4.6 is now explicit about the move and about what it costs (one row), and
> §7.3 separates *beside* from *inside*, which is the drop the earlier table left
> ambiguous for a group dragged onto a group.

> [!note]
> **Nothing here touches an anchor, an agent or a document.** This spec changes
> how the comment *list* is read and arranged. A comment's targets, its
> transcript, its profile and its Apply path are untouched, and no rule in this
> spec can move a comment off the text it is about.

---

## 1. Why

**The comment list can only be read in the order it was written, and every row
is titled by whatever question was typed first.** Both are the same failure: the
list is a log, and a reviewer needs an agenda.

Measured against `~/.rex/rex.db` on 2026-08-25, 14 real comments:

| Fact | Number |
|:--|:--|
| comments in the database | 14 |
| average note length | 97 characters |
| longest note | 216 characters |
| notes longer than 80 characters | 8 of 14 |
| notes that fit in 40 characters | 6 of 14 |
| rows that cannot be told apart by their first 30 characters | 4 of 14 |

That last row is the whole problem in one number. Two comments read
`What is this?` and `what is this?` — the same six words, about two different
shapes on two different slides. Two more both begin
`DECIDED at the review meeting:` and stay identical for another 40 characters.
**Four of fourteen rows are unreadable in a list**, and the list is the only
place a reviewer sees them all.

### 1.1 A note is a question, not a name

`thread.note` is the first thing the reviewer typed, and it is addressed to the
agent: *"is this still true after we moved to the new auth flow?"*. It is a good
prompt and a bad title. A title says what the comment is **about**; a prompt says
what should be **done**. REX has been showing one where it needs the other since
spec 01.

### 1.2 The order is the clock, and the clock is not the agenda

`listThreads` ends `ORDER BY created_at`, so the list is the order the comments
happened in. A review has a shape the clock does not know: three comments about
the same broken diagram belong together, the blocking one belongs at the top, and
the eight small ones belong out of the way. Today the only way to express any of
that is to write the comments in that order, which means knowing the shape of the
review before doing it.

### 1.3 Fourteen fits on a screen; sixty does not

Every number above is small because REX is new. The list is workspace-wide (spec
05 §5.3) — one column holding every comment about every document under the root
— so it grows with the review, not with the file. The gesture that fixes a
14-row list is a name; the one that fixes a 60-row list is a **tree**.

---

## 2. Three things, one panel

| What | The gesture | What it stores |
|:--|:--|:--|
| **A name** | the pen on the row — type, Enter | `thread.title`, or NULL for "use the note" |
| **An order** | drag a row up or down | `thread.position` among its siblings |
| **A group** | drag a row onto a group; drag a group to reorder it, and everything in it comes along; groups nest to any depth | `comment_group`, and `thread.group_id` |

All three are the reviewer's own. **None of them changes what a comment is about,
what it asked, or what it may do.** A renamed comment sends the same prompt, a
moved comment resolves to the same text, and a grouped comment is applied exactly
as an ungrouped one is.

### 2.1 Why "group" and not "folder"

REX already draws a tree of folders in the explorer, and those folders are
**directories on disk**. This spec draws a second tree beside it, in the same
window, and its containers exist nowhere but in `rex.db`.

Calling both of them folders would invite the one wrong expectation that costs
the most: that the comment tree mirrors the directory tree, and that moving a
comment moves a file. It does neither. One word for one thing — the explorer has
folders, the comments panel has **groups**, and no glyph is shared between them.

---

## 3. The name

### 3.1 Where it comes from

One column, `thread.title`, and one rule:

| `title` | The panel shows |
|:--|:--|
| NULL | the note's first line — what REX shows today |
| a string | that string |

**NULL is not "unnamed", it is "named by the note".** Every comment that exists
today reads exactly as it reads now, with no migration writing anything into it,
and a comment nobody bothers to name never looks empty.

Typing an empty name — clearing the box and pressing Enter — writes NULL back.
That is the reset, and it costs no extra control: "delete the name" and "go back
to the note" are the same wish.

> [!note]
> **REX does not invent a name.** An agent could write one from the note and the
> answer, and that was considered and rejected in §10: a generated title is one
> more line to read and check, it changes under the reviewer when the thread is
> asked again, and the note it would be summarising is already on the row.

### 3.2 One line means one line

`commentName(thread)` lives in `src/shared/names.ts` and is the only place this
rule is written. Main, the panel, the card and `rex export` all call it, so the
four can never disagree about what a comment is called.

```text
title, trimmed        — when it is set and not empty
else: the note's first non-empty line, with runs of whitespace collapsed to one
```

No length cut in the function. The panel clips with CSS
(`text-overflow: ellipsis`), which respects the column's real width; `rex export`
prints the whole line, because a heading in a file has no column. A hard-coded 80
would be wrong in both places.

None of the 14 measured notes contains a newline, so "the first line" is today
always "the whole note". It is written this way because a pasted note is one
paste away, and a row that grows to five lines breaks the list's rhythm.

### 3.3 The gesture — a pen on the row

**A pen sits on everything that has a name** — a comment row, a group row, and
the head of an open comment card. It is the gesture, and the other two are
accelerators for someone who already knows it is there.

| Where | What |
|:--|:--|
| **the pen, on the row** | opens the name box, pre-filled with the current name |
| double-click the headline | the same |
| `F2`, on the focused row | the same |
| Enter | saves |
| Escape | cancels, and nothing is written |
| empty + Enter | writes NULL — back to the note (§3.1) |

The pen sits **beside the trash, at the row's top right**, and behaves exactly as
the trash already does: `opacity: 0` at rest, full on `.rex-thread-wrap:hover`
and on `:focus-visible`. Two reasons it is not always on: a column of 60 rows
each carrying two permanent glyphs is noise, and `rex-thread-delete` set this
pattern in spec 08 — a second control beside it that appears by a different rule
would read as a different kind of thing.

> [!warning]
> **The pen cannot go inside the row.** `ThreadRow` is a `<button>`, and HTML
> forbids a button inside a button — the trash is already outside it, in
> `.rex-thread-wrap`, for this exact reason. The pen goes in that wrapper too.
> Put it inside the row and the browser silently un-nests the markup, after which
> clicking the pen selects the comment instead of renaming it.

There is no `…` menu on a comment row. Two visible controls and three keys are
enough, and a menu holding one item is a click that buys nothing. Groups keep a
menu (§7.1) because they have three commands, not one.

Pre-filled with the **current name**, which for an unnamed comment is the note.
So the first rename is an edit of the prompt, not a blank box: the reviewer
shortens what is already there instead of retyping it from memory. That is what
"the initial prompt is filled in by default" means, and it is why `title` starts
NULL rather than being back-filled with a copy of the note — a copy would go
stale the moment the note was edited, and would double the text stored for every
comment that is never renamed.

### 3.4 Where the name shows

| Surface | Before | After |
|:--|:--|:--|
| `ThreadRow` headline | `thread.note` | `commentName(thread)` |
| `CommentCard` head | the note in the body | the name in the head, **with the same pen beside it**; the note stays in the body, in full |
| `rex export` heading | `## 3. <note>` | `## 3. <name>` |
| the gutter marker's tooltip | the note | the name |

The full note is never hidden. `CommentCard` already prints it (`rex-card-note`)
unless the conversation opens with it verbatim, and that stays exactly as it is.
The name is a label on the box, not a replacement for what is in it.

---

## 4. The order

### 4.1 A position per row

`thread.position INTEGER NOT NULL DEFAULT 0`, and `comment_group.position` beside
it. Both mean the same thing: **rank among the rows that share a parent.**

A drop renumbers that one sibling list `0…n-1` in a single transaction, and
touches nothing else.

> [!note]
> **Why an integer and a renumber, and not a fractional key.** Fractional
> indexing — give the moved row the average of its new neighbours — is the
> standard trick and it is the wrong trade here. It buys "write one row instead
> of n", and it pays with a precision cliff: about 50 consecutive drops into the
> same gap exhaust a float, after which two rows compare equal and the order goes
> quietly non-deterministic. Today's whole database is 14 comments. Renumbering
> a sibling list of tens of rows inside SQLite is microseconds, it can never
> drift, and it needs no rebalancing pass that has to be written, tested and then
> triggered by something.

### 4.2 The drop says `after`, not `index`

`comments:move` carries `{ item, parentId, after }`, where `after` is the id of
the sibling the row lands behind, and `null` means "first".

**Not an index**, and this is the bug it prevents: the panel is filtered. With
the `open` chip selected, the third row on screen can be the ninth comment in its
group, so an index computed from what the reviewer sees describes a different
place than the one they dropped onto. An id survives the filter, because it names
a row rather than counting them.

Main is the only place that computes positions. The panel sends a gesture.

### 4.3 A group and a comment never share a rank

Inside a parent: **groups first, in their order, then comments, in theirs.** Two
sequences, two tables, no shared key.

The alternative — one interleaved list — needs an ordering key valid across two
tables, and every drop then has to answer "between which two of the *combined*
rows", including the ones the filter hid. The explorer already sorts directories
before files (`byKindThenName` in `main/workspace/tree.ts`), so this is the tree
behaviour REX already has, and the reviewer learns nothing new.

It follows that a drag has one legal kind of neighbour: a group lands among
groups, a comment lands among comments. The panel draws the drop line only where
a drop is legal, so the rule is visible rather than enforced by a refusal.

### 4.4 The number in the margin follows the panel

The gutter's numbered markers, the card's token and the export's headings are all
`index + 1` over the array `thread:list` returns. So **the order is main's, not
the panel's**: `listThreads` returns its rows in the tree walk — for each parent,
its groups depth-first, then its comments — and every surface follows for free.

This is the reason the walk lives in the query rather than in `Sidebar.tsx`. A
panel that sorted its own copy would put `4` on a row whose marker in the margin
says `7`, and the margin is how a reviewer finds the row.

### 4.5 The keyboard moves rows too

Drag is a mouse gesture, and it is the only one this spec would otherwise have.

| Key | On the focused row |
|:--|:--|
| `Alt+↑` / `Alt+↓` | move up or down among its siblings |
| `Alt+→` | move into the group directly above it |
| `Alt+←` | move out, landing after its old parent |

They are the outliner keys, they reuse `comments:move` unchanged, and each is one
call. `keys.tsx` already owns the shortcut vocabulary; these go beside it, and
like every other REX shortcut they do nothing while the caret is in a text field.

### 4.6 A group moves with everything in it

**Dragging a group moves the group and everything under it** — its comments, its
subgroups, and their comments, to any depth — in one gesture, keeping their order
inside it exactly as it was.

This is not a feature that has to be built so much as one that has to not be
broken. Nothing inside a group records where the group is: a comment stores
`group_id`, a subgroup stores `parent_id`, and neither says anything about the
parent's position. So moving a group of 40 comments is **one `UPDATE` of one
row** — the group's own `parent_id` and `position` — and the 40 comments are not
read, not written, and not touched.

Two things follow, and both are worth saying out loud:

- **A collapsed group is the cheap way to move a lot at once.** Collapse
  *Blocking*, drag it to the top, and 40 rows follow it in one drag. This is the
  main reason §5.6 remembers the collapsed flag.
- **Nothing leaves the group by being moved.** A comment's `group_id` changes
  only when *that comment* is dragged. Moving its group cannot orphan it, cannot
  promote it, and cannot reorder its siblings.

The one visible consequence is the numbering. Moving a group to the top of the
list makes its comments `1, 2, 3`, and every other number shifts down — because
the number is the position in the walk (§4.4), the gutter's markers renumber with
them, and that is the point: the agenda is what the margin now counts in.

### 4.7 The filter does not reorder anything

The three chips — `open`, `resolved`, `orphaned` — hide rows. They never sort
them. A row that is filtered out keeps its position and comes back where it was,
and its number does not change, because the number comes from main's full list
(§4.4) and not from what survived the filter.

---

## 5. Groups

### 5.1 What a group is

A named container for comments, nested to any depth, belonging to a workspace
root. It holds comments and other groups. It has no meaning to any agent, appears
in no prompt, and is not written into any document.

A comment is in **one** group or in none. §10 says why two is not offered.

### 5.2 The tree

```text
▾ Blocking                                    3
    ▾ Auth flow                               2
        ⬤ 4  Token refresh races itself
        ⬤ 5  Diagram contradicts §2
    ⬤ 6  Wrong Python version
▸ Nice to have                                8
⬤ 12  What is this?
```

The count on a group is **every comment beneath it, at any depth** — the number a
reviewer wants when the group is collapsed, which is the moment it is shown.

Top-level comments sit below the top-level groups, by §4.3.

### 5.3 A group belongs to a workspace root

`comment_group.root` is the absolute workspace root, and `group:list` takes one.
Groups are not global, because a review of one repository has nothing to say
about the folders of another, and a global list would fill with names from
projects that are closed.

Two consequences, both stated rather than discovered:

- **With no workspace open** — a single URL document, `workspaceRoot === null` —
  the panel shows the flat list and hides every group control. There is no root
  to hang a group on, and inventing one would strand it.
- **A comment seen from a different root** shows at the top level. Open
  `~/docs` and a comment sits in the group *Blocking*; open `~/docs/api` as its
  own workspace and the same comment is listed ungrouped, because *Blocking*
  belongs to the other root. Its `group_id` is untouched, so it is back in
  *Blocking* the moment `~/docs` is open again.

### 5.4 Deleting a group never deletes a comment

Deleting a group **promotes everything inside it to that group's own parent** —
its comments and its subgroups, in their existing order — and then removes the
now-empty group.

Not to the top level: a subgroup two levels down whose parent is deleted should
land one level up, not at the root of a list of sixty.

> [!warning]
> **A comment is the reviewer's work, and a group is a place to put it.** Nothing
> in this spec may destroy the first while rearranging the second. The confirm
> dialog says what will happen — *"Delete the group "Blocking"? Its 3 comments
> move up to Top level."* — and there is no "delete the comments too" option,
> because deleting comments already has its own control on every row.
>
> `comment_group.parent_id` still declares `ON DELETE CASCADE` and
> `thread.group_id` still declares `ON DELETE SET NULL`. The promotion runs first
> and leaves the cascade nothing to take; the constraints are the backstop for a
> row deleted some other way, not the delete path.

### 5.5 A group cannot contain itself

Moving a group into its own descendant is refused in **main**, by walking
`parent_id` upward from the target and rejecting the move if the moved group is
met. The panel also declines to draw the drop line there, but the panel is not
where the rule lives: a cycle in `comment_group` makes the tree walk in §4.4
non-terminating, which takes the whole comments panel with it.

### 5.6 Collapsed is remembered

`comment_group.collapsed`, written by `group:update`.

Deliberately unlike spec 12 §3.3, where the mode is remembered per thread and
forgotten on restart. A mode is a decision about the next command; a collapsed
group is a statement about how the reviewer wants to read the list, and a tree
that springs fully open on every launch is a tree that has to be re-closed every
launch.

### 5.7 An empty group does not vanish

A group is shown when **either**:

- some comment beneath it, at any depth, passes the current filter, **or**
- it holds no comments at all, at any depth.

The second clause is the one that matters. Without it, making a group is a
gesture whose result disappears immediately — you create *Blocking*, it holds
nothing, the filter hides it, and there is nothing to drag a comment onto.

A group that holds four resolved comments while the `open` chip is selected *is*
hidden, and the chip count already says how many resolved comments exist.

---

## 6. The data

### 6.1 Schema

One table and three columns, appended to `main/db/schema.sql`:

```sql
-- Spec 14 §6.1 — the reviewer's own arrangement of the comment list.
--
-- Not a directory. `root` scopes a group to one workspace (§5.3); `parent_id`
-- nests it; `position` ranks it among its siblings and among them only (§4.1).
CREATE TABLE IF NOT EXISTS comment_group (
  id          TEXT PRIMARY KEY,
  root        TEXT NOT NULL,
  parent_id   TEXT REFERENCES comment_group(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_root
  ON comment_group(root, parent_id, position);
```

On `thread`:

| Column | Meaning |
|:--|:--|
| `title TEXT` | the typed name. NULL means "use the note" (§3.1) |
| `group_id TEXT REFERENCES comment_group(id) ON DELETE SET NULL` | NULL is the top level |
| `position INTEGER NOT NULL DEFAULT 0` | rank among the comments sharing `group_id` |

`position` is compared only within one parent and one workspace. Two comments in
different workspaces can both hold `position = 3`; they are never in the same
list, so nothing has to be done about it.

### 6.2 The migration must not shuffle the list

`migrateCommentOrder(db)` in `main/db/migrate.ts`, beside the two that are
already there and idempotent the same way — it asks `PRAGMA table_info(thread)`
what the table already has.

1. Add the three columns if they are absent.
2. Fill `position` from the **`created_at` rank**, over all comments at once.

Step 2 is the whole point. `ORDER BY created_at` is today's order (§1.2), so a
reviewer who upgrades and reopens REX sees the list they closed, in the order they
closed it, with a name on every row that reads as it did before. **An upgrade
that reshuffles somebody's comments has broken the feature it was shipping.**

`title` is left NULL and `group_id` is left NULL. Nothing is invented.

### 6.3 The shapes

`src/shared/types.ts`:

```ts
export interface CommentGroup {
  id: string;
  root: string;
  parentId: string | null;   // null is the top level
  name: string;
  position: number;
  collapsed: boolean;
  createdAt: string;
}

/** A row in the comments panel — the two kinds a drag can move. */
export type CommentItem =
  | { kind: "thread"; id: string }
  | { kind: "group"; id: string };

export interface CommentMove {
  item: CommentItem;
  /** The group it lands in; null is the top level. */
  parentId: string | null;
  /**
   * The sibling it lands after — always of the same kind as `item` (§4.3).
   * Null means first. An id rather than an index, because the panel is
   * filtered and an index would describe the wrong place (§4.2).
   */
  after: string | null;
}
```

`Thread` gains `title: string | null`, `groupId: string | null` and
`position: number`.

`src/shared/names.ts` holds `commentName(thread)` and nothing else (§3.2).

### 6.4 The channels

Six, all `invoke`. Invariant I3 is untouched — no port, no server, nothing new
pushed from main.

| Channel | Argument | Returns |
|:--|:--|:--|
| `thread:rename` | `{ threadId, title: string \| null }` | `void` |
| `group:list` | `{ root }` | `CommentGroup[]` |
| `group:create` | `{ root, parentId, name }` | `CommentGroup` |
| `group:update` | `{ groupId, name?, collapsed? }` | `void` |
| `group:delete` | `{ groupId }` | `void` |
| `comments:move` | `CommentMove` | `void` |

`comments:move` rather than one channel per kind: the panel has exactly one drag
gesture, and its payload differs only in a discriminator. `group:update` carries
both the name and the collapsed flag because both are "a property of this group
changed" and neither is worth a round trip of its own.

`group:delete` is separate and always will be — it is the one that moves other
people's rows around (§5.4), and a channel that deletes should never be reachable
by leaving a field off another one.

---

## 7. The panel, drawn

### 7.1 A group row

A twisty, a group glyph that is **not** the explorer's folder, the name, the
count from §5.2, then **the pen**, then a `…` menu: *New group inside*, *Delete*.

Renaming a group is the same act as renaming a comment, so it is the same
control: the same pen, in the same corner, revealed by the same hover rule,
opening the same inline box, answering to the same `F2`, Enter and Escape. The
only difference is what is written — `comment_group.name` through `group:update`,
and never NULL, because a group with no name is a row you cannot talk about.

The pen is **not** in the `…` menu. A group's name is the thing about a group
most likely to be wrong on the first try, and burying the fix one click deeper
than *Delete* gets it the wrong way round.

### 7.2 A comment row

`ThreadRow` as it is, with the headline changed to `commentName(thread)` and one
line added: when a `title` is set **and** differs from the note's first line, the
note's first line is shown under it in the dim meta colour. When there is no
title the two would be identical, so nothing is added — the row keeps exactly
today's four lines.

An indent per level of nesting, and nothing else changes: the token, the wash, the
quote, the document names and the meta line are spec 08's and stay.

In the wrapper's top-right corner the pen sits to the **left** of the trash, at
the same 22 × 22, sharing the reveal rule (§3.3). Rename before delete, reading
left to right: the safe control is the one the pointer reaches first, and the
destructive one keeps the corner it has had since spec 08 rather than shifting
under a reviewer who has learned where it is.

### 7.3 The drag

HTML5 drag events, no dependency. `SelectionPanel.tsx` already reorders its places
this way inside this same shadow root (`draggable`, `onDragStart`, `onDragOver`,
`onDrop`), so the gesture is known to work here — this is the same pattern with a
tree's drop rules instead of a list's swap.

| Drop | Means |
|:--|:--|
| on the line **between** two rows | land there, after the row above (§4.2) |
| on the **body** of a group row | land inside that group, last |
| on the panel's empty space below the tree | land at the top level, last |
| anywhere illegal | no line is drawn, and the drop does nothing |

The first two rows are the whole grammar, and the difference between them is
where the pointer is, not what is being dragged. **The line means beside; the row
means inside.** Dragging group *Auth* onto the line above group *Blocking* makes
it *Blocking*'s sibling, in front of it. Dragging *Auth* onto *Blocking*'s own
row puts *Auth* inside it. Both are drags of the same group, and the pointer
moving a few pixels is what tells them apart — so the panel draws the line and
highlights the row, and never both at once.

A drop line carries the **indent of the parent it means**, which is how a group
dragged out to the top level is told apart from one dropped at the end of a
nested list. Without the indent, the last line of a subgroup and the line before
the next top-level row are the same pixel.

`commentTree.ts` holds the tree building and the drop rules as pure functions, so
`test/comments.spec.ts` can exercise "can this land there" without a window.

### 7.4 New group

A button in the panel foot beside *Synthesis thread…*, and *New group inside* on
every group's menu. A new group is created collapsed-open, at the end of its
parent's groups, with its name box already open — naming it is the point, and a
group called "New group" that nobody renamed is worse than no group.

### 7.5 The pen is `Pencil`, the one REX already has

**One pen glyph, used for both meanings.** Decided by the reviewer on 2026-08-25,
after version 1.1 proposed a second glyph to keep them apart. No new icon.

The concern that proposed one was real and is worth writing down, because it is
what to re-open if this ever reads wrong. `Pencil` already carries spec 12's
**ACT** — *the agent may write to your files* — which is the read/write split
spec 01 §8.4 is built on. Here is where it is today, checked in the code rather
than remembered:

| Where `Pencil` is drawn now | What it says |
|:--|:--|
| the reply composer's send button, in `CommentCard.tsx`, when the mode is `act` | inside a filled button reading **Change** |
| the head of the diff dialog, in `DiffDialog.tsx`, at 16px | beside **WRITE PROFILE** in words |

**Both are inside something that already says what it means in words**, and
neither is the bare glyph this spec adds. A pen alone, in a list row's corner,
next to a name, beside a trash, is read as *edit this text* — the reading the
rest of the world has trained. A pen inside a button labelled `Change` is read
as the button's label.

The selection panel's send button — the one that reads **Ask about 1** and
**Change 1** — carries no pencil at all, and this spec does not give it one.

> [!note]
> **What to watch, if this is ever revisited.** An open comment card can show
> both at once: the name's pen in the head, and ACT's pen in the Change button
> at the foot. They are a card apart and one of them has a word attached. If a
> future layout puts them side by side, split the glyph then — that is a change
> to one import, not to this design.

---

## 8. What this adds

| | |
|:--|:--|
| Dependencies | **none** |
| IPC channels | six — `thread:rename`, `group:list`, `group:create`, `group:update`, `group:delete`, `comments:move` |
| Tables | one — `comment_group` |
| Columns | three on `thread` — `title`, `group_id`, `position` |
| Shapes | `CommentGroup`, `CommentItem`, `CommentMove`; `Thread` gains three fields; `ViewState` gains `groups` |
| Glyphs | **none** — rename reuses `Pencil` from `Icons.tsx` (§7.5) |
| New files | `shared/names.ts`, `main/db/groups.ts`, `renderer/overlay/GroupRow.tsx`, `renderer/overlay/commentTree.ts`, `test/comments.spec.ts` |
| Changed | `main/db/schema.sql`, `main/db/migrate.ts`, `main/db/queries.ts`, `main/ipc.ts`, `main/debug.ts`, `shared/types.ts`, `shared/channels.ts`, `preload/index.ts`, `overlay/App.tsx`, `overlay/Sidebar.tsx`, `overlay/ThreadRow.tsx`, `overlay/CommentCard.tsx`, `overlay/Icons.tsx`, `overlay/keys.tsx`, `overlay/overlay.css`, `cli/export.ts` |
| Scripts | `npm run test:comments` |

Invariant I1 is untouched — no anchor is created, resolved or stored differently.
I2 is untouched — `comment_group` is main's, and the renderer sends gestures. I3
is untouched — six more `invoke` channels, no port.

---

## 9. Acceptance

### 9.1 The name

- [ ] A comment with no title reads exactly as it does today — the note.
- [ ] **Hovering a comment row shows a pen beside the trash**, and clicking it
      opens the name box. Not double-click, not a key — the visible control.
- [ ] **Hovering a group row shows the same pen**, and it renames the group.
- [ ] The open card's head carries the same pen, and renaming there updates the
      row in the list without a reload.
- [ ] The pen is `Pencil` from `Icons.tsx`, and `Icons.tsx` gained no new glyph.
      ACT's send button and the diff dialog are untouched. §7.5.
- [ ] Clicking the pen does **not** select the comment as well — the proof that
      it is in the wrapper and not nested inside the row button. §3.3.
- [ ] The pen reaches keyboard focus and shows itself when it does, exactly as
      the trash does.
- [ ] Double-clicking the headline opens a box **pre-filled with the note**, and
      Enter saves the edited text as the name.
- [ ] Escape leaves the name unchanged, and `rex.db` shows no write.
- [ ] Clearing the box and pressing Enter puts the note back, and `title` is NULL
      in the database — not an empty string.
- [ ] The name shows on the row, in the card head and in the gutter tooltip, and
      **the full note is still visible in the card**.
- [ ] `npm run export` prints the name as the heading, and the note in the body.
- [ ] The two `What is this?` comments in `~/.rex/rex.db` can be told apart from
      the list after renaming one of them. This is §1's measured failure.

### 9.2 The order

- [ ] Dragging a comment up two rows puts it there, and it is still there after a
      restart.
- [ ] The number in the margin matches the number on the row, immediately after a
      drag — this is §4.4 and it is the one that catches a panel that sorted its
      own copy.
- [ ] With the `open` chip on, dragging a comment onto the third **visible** row
      lands it after that comment and not after the third comment in the group.
      This is §4.2.
- [ ] `Alt+↑` and `Alt+↓` move the focused row, and do nothing while the caret is
      in the name box.
- [ ] Switching the filter and switching back leaves the order unchanged.
- [ ] **A group dragged above another group lands there**, and it is still there
      after a restart.
- [ ] **Everything inside the moved group comes with it**, in the same order, to
      every depth — comments, subgroups, and their comments. §4.6.
- [ ] Moving a group writes **one** row: `SELECT count(*) FROM thread` is
      unchanged and no `thread.group_id` changed. §4.6.
- [ ] Moving a group to the top makes its comments `1, 2, 3`, and **the gutter's
      markers show the same numbers**. §4.4.
- [ ] Dragging a collapsed group moves its comments too, without expanding it.
- [ ] Dropping a group on the **line** between two rows makes it a sibling;
      dropping it on a group's **row** puts it inside. The panel never shows both
      the line and the highlight at once. §7.3.
- [ ] A drop line at the end of a subgroup is told apart from one before the next
      top-level row by its indent. §7.3.

### 9.3 Groups

- [ ] A new group appears with its name box open, and naming it and pressing
      Enter leaves one named group.
- [ ] Renaming a group with the pen writes `comment_group.name`, and the new name
      survives a restart.
- [ ] A group's name box cannot be emptied — Enter on an empty box keeps the old
      name rather than writing one. §7.1.
- [ ] A comment dragged onto a group lands inside it, and the group's count
      rises.
- [ ] The count on a collapsed group includes comments in its subgroups.
- [ ] A group survives a restart, collapsed if it was collapsed.
- [ ] **Deleting a group deletes no comment.** Its comments and subgroups appear
      in the deleted group's parent, in the same order, and
      `SELECT count(*) FROM thread` is unchanged. §5.4.
- [ ] Dragging a group onto its own child is refused, and calling
      `comments:move` with that pair directly is refused by main. §5.5.
- [ ] An empty group stays visible under every filter. §5.7.
- [ ] Opening a subdirectory as its own workspace lists the same comments
      ungrouped, and reopening the outer root restores the groups. §5.3.
- [ ] With no workspace open, the panel is flat and the group controls are gone.

### 9.4 The data

- [ ] `npm run test:migrate` covers `migrateCommentOrder`: run against a database
      written before this spec, the list order is **byte-identical** to
      `ORDER BY created_at`, and running it twice changes nothing.
- [ ] `npm run test:comments` covers `commentName`, the tree walk, the drop
      rules, the renumber, the cycle refusal and the promotion on delete.
- [ ] `npx tsc --noEmit` is clean and `nvim-tools --json --all` adds no finding
      against the baseline.

---

## 10. Non-goals

| Not doing | Why |
|:--|:--|
| a second pen glyph for rename | proposed in version 1.1 and rejected: ACT's pencil is always inside a control that says **Change** or **WRITE PROFILE** in words, so a bare pen next to a name reads as what it reads as everywhere else. §7.5 |
| a rename control that is always visible | a column of 60 rows, each with a permanent pen and trash, is noise. The hover-and-focus rule is spec 08's, already learned on the trash |
| an agent that names the comment | the reviewer names it. A generated title is another line to read and check, it moves under you when the thread is asked again, and it summarises a note that is already on the row |
| a comment in two groups | a node with two parents is not a tree: every count double-counts, every drag asks "from which one", and §4.4's walk stops terminating |
| a sort menu — newest, document order, by status | the order is the reviewer's now, and a sort that overrides it makes the drag meaningless. If the manual order turns out to be missed rather than used, that is a later spec with evidence behind it |
| multi-select drag | one row per gesture. A rubber band over a filtered tree is a spec of its own |
| groups that mirror the directory tree | the explorer already draws that tree, and a comment is routinely about two documents in two directories (spec 05 §5.3) — there is no one directory to put it in |
| colour or emoji on a group | naming it is what makes it findable; decorating it is what makes a second colour vocabulary competing with spec 08's four states |
| dragging a comment into another workspace's group | groups belong to a root (§5.3), and a cross-root drop would put a comment somewhere it cannot be seen |
| groups in the prompt, or shown to the agent | a group is how the reviewer reads the list. Sending it would make the arrangement change the answer |
