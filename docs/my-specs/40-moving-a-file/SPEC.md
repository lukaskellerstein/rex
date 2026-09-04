# REX 40 — moving a file

**Version:** 1.0 · 2026-09-03
**Status:** **built, and driven in a live window.** All four milestones are done
(§7). `npm run test:workspace-files` is 52 tests green, `npm run typecheck`
passes and `nvim-tools --json --all` adds no finding. §9 records the four places
the build departed from what §1–§6 first said.
**Depends on:** [`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md)
§4 (the tree),
[`10-figure-preview-and-exclusions/SPEC.md`](../10-figure-preview-and-exclusions/SPEC.md)
§3 (exclusions, and the skip list),
[`14-naming-order-groups/SPEC.md`](../14-naming-order-groups/SPEC.md) §7.3 (the
comment list's own drag, and what a drop means),
[`23-renaming-and-deleting-a-file/SPEC.md`](../23-renaming-and-deleting-a-file/SPEC.md)
§2.2 (the four checks), §4.1 (the five records that move), §5.4 (what catches up
after the act),
[`39-a-new-file-and-a-new-folder/SPEC.md`](../39-a-new-file-and-a-new-folder/SPEC.md)
§5.1 (a file row means its parent), §7 (which ruled this out).

> [!important]
> **Spec 23 §8 said a rename is not a move, and this does not take that back.**
> The rename box still refuses a path, and for the same reason: a box that
> accepts `../x.md` reads as one act and performs another. A move is a
> *different gesture* — a hand dragging a row onto a folder — and it gets its
> own channel, its own guards and its own word.

---

## 1. Why

The tree can make a file, rename it and bin it. It cannot move one.

The reviewer's words, 2026-09-03: *"I should also be able to drag and drop the
files and folders so I can move them around. If I drag some folder or file in
the explorer in the workspace, I should be able to move it to another folder."*

### 1.1 Spec 39 §7 ruled this out, and was right to

*"No drag and drop. The tree has never had one, and a create is not the place to
invent it."* That is still the right call for a spec about creating. It is not
an argument against the act — only against smuggling it in.

### 1.2 The cost is the one spec 23 §1.2 already named

A file moved outside REX takes every comment on it. `document` is keyed by path
(`kind`, `value`), so `docs/guide.md` dragged into `docs/api/` in the Finder
becomes a row nothing points at, plus a fresh row with no comments the first
time it is opened. The comments are not deleted, they are invisible.

That argument does not weaken with the third act. It is the same argument, and
it is why the move belongs inside REX: the disk act and the database act have
to be one act, and REX is the only thing that can make them one.

---

## 2. The rule

> **A row dragged onto a folder moves there, with every record REX keys on its
> path. One row at a time, inside the open workspace, in the same transaction
> spec 23 §4.1 already uses.**
>
> Apply is untouched, the agent gains nothing, and no new kind of write exists:
> `renameSync` is what both a rename and a move call. The only new question is
> *is this destination legal*, and §3 is the whole of it.

### 2.1 A move is a rename with a different parent

Spec 23 §4.1 moves five records when a path changes: the file, the `document`
rows at and under it, the `workspace_rule` rows, the working copies, and — for
free, because they key on `document.id` — every comment, target and message.

None of that cares whether the last path segment changed or the ones before it.
`movedPath` already answers for a path and everything under it, which is what
makes a folder rename carry forty documents, and it makes a folder *move* carry
them for exactly the same reason.

So this spec adds no record-moving. It extracts what spec 23 wrote into one
function, `relocate`, and calls it from both acts (§6). Two copies of a
disk-then-database sequence with a rollback is one copy too many: the thing that
would rot is the rollback, and the rollback is the part that matters.

---

## 3. What is refused

Two kinds, and which kind a refusal is decides how it is said.

### 3.1 Refused in the tree, with no sentence at all

The drag never calls `preventDefault`, so nothing lights up and the pointer
shows the platform's own "no drop" cursor. Spec 14 §7.3 established this for the
comment list, and it is better than a dialog after the fact: the answer arrives
while the hand is still moving, and an illegal drop cannot be performed at all.

| # | Refused | Why |
|:--|:--|:--|
| 1 | Onto the folder it is already in | Nothing to do, and a "moved" notice for a file that did not move is a lie |
| 2 | A folder onto itself | — |
| 3 | A folder into its own descendant | **The one that matters.** `renameSync` would take the subtree with it and the reviewer would lose the lot |
| 4 | Onto an excluded folder | The review would silently lose the file, and the subtree was never walked |
| 5 | Onto a folder REX skips — `node_modules`, `out`, `.git` | The file would be moved somewhere the tree never draws (spec 39 §3.2's rule, in a second place) |

Checks 1 to 3 are the renderer's, because they are questions about the tree it
drew and the answer has to arrive before the drop. Main asks 4 and 5 again
anyway — it asks *every* one of them again — because the renderer displays
untrusted document content (invariant I2) and a guard that only exists there is
not a guard.

### 3.2 Refused by main, with a sentence

Straight to the notice bar, as spec 23 §2.2 established.

| Refused | Sentence |
|:--|:--|
| Spec 23 §2.2's four checks, on the source **and** on the destination | its own sentence, unchanged |
| The destination already holds that name | `There is already something called "guide.md" in that folder.` |
| REX still holds comments written on the destination path | spec 23 §4.2's sentence, unchanged |

### 3.3 No confirm

A move is undone by dragging it back. That is what makes it unlike the Bin,
which moves a file to a different place under different rules and earns spec 23
§3.2's dialog.

What it gets instead is a notice that names **both ends** — `Moved "guide.md"
into "api".` — so a drag nobody meant is legible the moment it happens rather
than the next time somebody looks for the file.

---

## 4. The channel

```ts
/** Spec 40 §2 — one row, into one folder. `parent` is a folder, never a path
 *  under it, and never the new path itself. */
export interface WorkspaceMoveRequest {
  root: string;
  path: string;
  parent: string;
}
```

The answer is `WorkspaceFileResult` — spec 23's, unchanged. A move has nothing
extra to say: it opens nothing, and a destination that still holds comments is a
refusal here rather than a note, because unlike spec 39 §2.2 there is a second
copy of the work at stake.

---

## 5. What the reviewer sees

### 5.1 What can be dragged, and where it lands

Every row is a drag source except an excluded one, and except while a name box
is open — dragging a row out from under the caret is never what somebody
halfway through typing meant (spec 14 §7.3's own rule).

| Dropped on | Lands in |
|:--|:--|
| a folder row | that folder |
| a file row, or an unopenable one | its parent folder |
| the empty space under the tree | the workspace root |

The second line is spec 39 §5.1's rule, deliberately reused: `New file…` on a
file row already means "beside this file", so a drop on a file row meaning
"beside this file" is the same sentence. One vocabulary, two gestures.

### 5.2 The receiving folder lights up, not the row under the pointer

Drop on `guide.md` and **`docs/`** lights. The highlight is the wash a comment
group already wears when a drag would land inside it (spec 14 §7.3), so "this is
where it goes" looks the same everywhere in REX.

When the destination is the workspace root there is no row to light, so the tree
itself takes a soft outline. A drop with no feedback at all is the one thing
this rule exists to prevent.

### 5.3 After it lands

`afterFileAct` — spec 23 §5.4, already written and already tested. The open
document follows the move if it was the thing that moved or sat under it, the
tree is re-scanned, the reference graph is dropped, and the threads and working
copies are refreshed.

### 5.4 What this does not do

- **No spring-loaded folders.** VS Code opens a collapsed folder after half a
  second of hovering. A collapsed folder is a drop target here as it is, which
  covers the need without a timer that fires while the hand is still moving.
- **No multi-select drag.** The tree has no selection model, and inventing one
  for this is a bigger change than the act being asked for.
- **No dragging in from the Finder, and none out.** Both are a copy across a
  boundary REX does not own.
- **No reordering.** The tree's order is the disk's — folders first, then
  alphabetical (spec 02 §4). There is no order to hold, so a drop has one
  meaning and needs no before/after line.

---

## 6. Where the code goes

| File | Change |
|:--|:--|
| `src/shared/channels.ts` | `workspaceMove`, the request type, one line on `RexApi` |
| `src/main/workspace/files.ts` | `moveEntry`; `relocate` extracted from `renameEntry` and shared by both |
| `src/main/ipc.ts` | one handler |
| `src/preload/index.ts` | one line |
| `src/renderer/overlay/Explorer.tsx` | the drag, the drop, the legality test and the highlight |
| `src/renderer/overlay/App.tsx` | `moveEntry`, ending in the existing `afterFileAct` |
| `src/renderer/overlay/overlay.css` | the receiving-folder wash, and the root outline |
| `test/workspaceFiles.spec.ts` | the refusals, the records that follow, and the descendant case |

Nothing in `db/` changes — §2.1 is why. Nothing in `agent/` changes.

---

## 7. Milestones

| # | Ends in | Checked by | Result |
|:--|:--|:--|:--|
| 0 | `moveEntry`, `relocate`, and every refusal | `npm run test:workspace-files` | 52 pass |
| 1 | A file dragged onto a folder, in a live window | the file is there, the tree redraws, the notice names both ends | `guide.md` → `archive/`, only `archive` lit, *Moved "guide.md" into "archive".* |
| 2 | A folder dragged into a folder, carrying a commented document | the comment is still on the moved file, under its new path | `docs/` → `archive/`; the `document` row moved to `archive/docs/notes.md` keeping its thread id |
| 3 | The silent refusals | no highlight, no move | four tried — a folder onto itself, into its own child, into a file it holds, and a row onto its own parent — all lit nothing and moved nothing |

Two more were driven beyond the milestones: a drop on the empty space moved a
file to the workspace root and the tree took the outline; and a drop onto a
folder that already held that name lit up (the tree cannot know) and was then
refused by main with *There is already something called "README.md" in that
folder.* — with neither file overwritten.

> [!note]
> **How the drag was driven.** The MCP is pinned to 9334, which the reviewer's
> own REX holds, so the window ran on 9444 under raw CDP and the drag was
> synthetic `DragEvent`s carrying a real `DataTransfer`. That exercises every
> handler and the highlight, but not Chromium's own decision to *start* a drag —
> which is why `draggable="true"` was asserted on all five row kinds first.

---

## 8. Rejected

**A `Move to…` menu item with a folder picker.** It is more accurate and nobody
would use it. The gesture being asked for is the drag.

**Reusing `workspace:rename` with a path in `name`.** It is one less channel and
it breaks spec 23 §4.2's rule that a name is not a path — which exists because
that rule is what makes the rename box safe. Two acts, two channels, two sets of
guards.

**A trash-style "are you sure".** §3.3.

**Letting a drop reorder.** §5.4. The tree draws what the disk holds, and a
reorder would be a lie about it.

---

## 9. Where the build departed from §1–§6

### 9.1 The tree had to be told to fill the column

`.rex-tree` was as tall as its rows, so "the empty space under the tree" was
whatever was left over — often nothing, and never a target you could aim at.
`flex: 1` inside the scroll column makes the space below the last row belong to
the tree, which is what §5.1's third line needs to be true.

### 9.2 A row's drag-over has to stop propagating

Without `stopPropagation` the container's own handler runs afterwards — events
bubble child to parent — and relabels every hover as "into the workspace root",
including the ones the row had just refused. The drop already stopped; the
drag-over is the one that decides what lights up, so it matters more.

### 9.3 Chromium will not start a drag with an empty transfer

`dataTransfer.setData` is called with the row's path. It is never read back —
the row being dragged is component state, not payload — but without any data
set the drag never begins.

### 9.4 The highlight is a `box-shadow`, not a border

`.rex-group-into` sets `border-color`, which works because a comment group's row
already has a border to colour. A tree row has none, and adding one moves every
row by a pixel the moment a drag starts. An inset `box-shadow` draws the same
1px edge inside the box and shifts nothing.
