# REX 39 — a new file and a new folder

**Version:** 1.2 · 2026-09-03
**Status:** **built, and driven in a live window.** All four milestones are done
(§8). `npm run test:workspace-files` is 56 tests green (spec 40 shares the
suite), `npm run typecheck` passes and `nvim-tools --json --all` adds no
finding. §10 records the four places the build departed from what §1–§7 first
said.

> [!note]
> **1.1 replaces §5.2.** The header's two glyph buttons are gone; the workspace
> root has a right-click menu instead, opened from the empty space under the
> tree and from the header.
>
> **1.2 adds §5.5.** An empty folder can go to the Bin, which spec 23 §3.1
> refused along with every other folder. Nothing else changes in either — not
> the guards, not the channel, not the row menu.
**Depends on:** [`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md)
§4 (the tree, and what it draws),
[`10-figure-preview-and-exclusions/SPEC.md`](../10-figure-preview-and-exclusions/SPEC.md)
§3 (the tree's menu, and the skip list),
[`21-the-file-the-agent-creates/SPEC.md`](../21-the-file-the-agent-creates/SPEC.md)
§3 (what "inside the workspace" means),
[`23-renaming-and-deleting-a-file/SPEC.md`](../23-renaming-and-deleting-a-file/SPEC.md)
§2.2 (the four checks), §4.2 (the names a write refuses), §5 (the menu, the
inline box and what happens after the act).

> [!important]
> **This spec adds nothing to REX's threat model.** Spec 23 opened the door this
> walks through: the reviewer, with their hand on the mouse, changing one path
> in the open workspace. Creating is the third act at that same door, behind the
> same four checks, on the same channel shape. The agent gains no tool, no path
> and no permission.

---

## 1. Why

The tree can rename a file and it can move one to the Bin. It cannot make one.

The reviewer's words, 2026-09-03: *"I would like to be able to create a file or
create a folder in the left sidebar in the workspace."*

### 1.1 The gap is the shape of the menu

`Explorer.tsx` draws six items today. Read the column that says what each one
writes:

| Item | Acts on | Writes |
|:--|:--|:--|
| Copy path | the clipboard | nothing |
| Select file / Select folder | the selection panel | nothing |
| Rename… | the file, and every record keyed to its path | the disk, the database |
| Move to Bin | the file | the disk |
| Exclude / include | the review's scope | the database |

Every path in that table already exists. The menu can change a name and it can
take a row away, so the one act it is missing is the one that puts a row there.

### 1.2 What the reviewer does instead

They leave REX. A review produces new documents — a summary of what was found,
a `notes.md` beside the file being read, a `docs/decisions/` folder to put them
in — and today every one of them means a terminal or a Finder window, then a
trip back to press `reload`.

That is the same complaint spec 23 §1.1 answered for delete, and it has the same
answer: REX drew the tree, REX knows the absolute path of every row in it, and
REX is the only thing on screen that can put the new row in the right place and
show it immediately.

### 1.3 It is not the agent's job

REX can already ask an agent to write a file, and spec 21 exists because it does.
That is a different act with a different cost: a run, a model, a prompt, and a
gate that decides whether what came back may stay.

An empty file is not worth any of that. *"Make me an empty `notes.md` in
`docs/`"* should cost one gesture and no tokens.

---

## 2. The rule

> **The tree can create an empty file or an empty folder in any folder of the
> open workspace. REX writes the path and nothing else: no content, no template,
> and no row in the database.**
>
> Every guard spec 23 §2.2 already applies is applied here, unchanged. The two
> things that are new are both refusals — the parent must be a folder, and the
> new name must not be one REX would never draw.

### 2.1 Why this needs no transaction

Spec 23's rename is two acts that must land together: the file moves, and every
comment keyed to its old path moves with it. If the second fails the first is
undone (§4.1), because a comment attached to a name that no longer exists is
worse than no rename at all.

Creating has no second act. A path that did not exist has no comments, no
exclusion rule and no working copy, so there is nothing to keep in step. The
disk write is the whole operation, and when it fails nothing has to be put back.

### 2.2 The one case that is not empty

Spec 23 §3.2 keeps a deleted file's comments: the `document` row and every
comment on it stay, so putting the file back in the Finder brings the review
back with it.

So a reviewer can create a file at a path REX still holds comments for. REX
creates it — refusing would be refusing to make a file because of something
invisible — and says so in the notice bar:

> Created. REX still holds 3 comments written on a file with that name; they
> will show as gone until their text comes back.

That sentence is the whole handling. The comments return on the next scan and
every anchor in them orphans against an empty file, which is exactly what spec
32 draws for a lost place and needs no new machinery.

The count is **every lane**, and deliberately not the tree's. The tree's markers
count open, resolved and gone (spec 18 §4.1), so a `draft` and a `note` come
back as zero — right for a marker beside a filename, wrong for this sentence,
whose question is *is there work on this name* and for which a note somebody
wrote is work. `countThreadsFor` is that second question, and it exists because
the first one answered "no comments" about a file with a note on it.

---

## 3. What is refused

Four checks come from spec 23 §2.2 and are not restated here: the root must be
one REX has scanned this session, the parent must be inside it, no segment of
the path may be a folder REX never touches, and the parent must exist.

Three more belong to this act.

| # | Refused | Sentence |
|:--|:--|:--|
| 1 | The parent is a file, not a folder | `That is a file. A new file goes in a folder.` |
| 2 | The name holds `/`, `\` or a NUL, or is `.` or `..` | spec 23 §4.2's sentences, unchanged |
| 3 | The new **folder** is named `node_modules`, `out`, `.git` … | `REX never draws a folder called "out", so it will not make one.` |

### 3.1 Why a name, not a path

VS Code lets `docs/api/new.md` in the same box and creates the folders on the
way. REX refuses it, for spec 23 §4.2's reason: a box that accepts a path reads
as a rename and acts as a move. One gesture, one path segment, one new row —
and the reviewer who wants a nested file makes the folder first, which is one
extra Enter and no ambiguity at all.

### 3.2 Why check 3 exists

`SKIP_DIRECTORIES` is the list REX prunes from every scan (spec 02 §4.2). A
folder named `out` would be created, would not be drawn, and would look to the
reviewer exactly like a create that silently failed.

The check is on the **name of the new folder only**. A *file* called `out` is
drawn perfectly well, and spec 21 §3 makes the same distinction for the same
reason: a directory named `build` hides everything under it, a file named
`build` hides nothing.

### 3.3 Why nothing is refused for being unopenable

`notes.txt` is not a format REX renders. It is created anyway and listed grey,
like every other `other` row in the tree (spec 02 §4.1). Refusing it would make
the tree a worse file manager than the Finder for no safety gained — and a
reviewer who wants a `.gitignore` beside the document they are reading is not
doing anything REX should have an opinion about.

The one consequence is stated in §5.3: an unopenable file is created and not
opened.

---

## 4. The channel

One channel, shaped like spec 23's two.

```ts
export interface WorkspaceCreateRequest {
  root: string;
  /** The folder it goes in — never the new path itself. */
  parent: string;
  /** A basename, never a path (§3.1). */
  name: string;
  kind: "file" | "directory";
}
```

The answer is not `WorkspaceFileResult`, because a create has two things to say
that a rename and a delete do not:

```ts
export type WorkspaceCreateResult =
  | { ok: true; path: string; opens: boolean; note: string | null }
  | { ok: false; reason: string };
```

`opens` is main's answer to *is this a document REX can render* — the format
predicates live in `main/render/formats.ts` and use `node:path`, which the
renderer cannot have, so the renderer must be told rather than guess (spec 27
§5.2 made the same call for the Markdown list). `note` is §2.2's sentence, or
null.

### 4.1 The write itself

| Kind | Call | Why that one |
|:--|:--|:--|
| file | `writeFileSync(target, "", { flag: "wx" })` | `wx` fails if the path exists, so the check and the write cannot disagree |
| directory | `mkdirSync(target)` | fails if the path exists, and never `recursive` — §3.1 forbids a path |

The existence check in §3 runs first and gives the readable sentence. These two
flags are what close the gap between that check and the write, which on a folder
somebody else is also writing into is not merely theoretical.

---

## 5. What the reviewer sees

### 5.1 Two items in the menu

They go in spec 23 §5.1's second group — the acts that write — above `Rename…`,
because that group is ordered by how much it changes: create, rename, delete.

| Right-clicked | `New file…` and `New folder…` put it |
|:--|:--|
| a folder | **inside** that folder, which opens |
| a file, or an unopenable row | **beside** it, in its parent folder |
| an excluded row | not offered — the subtree was never walked |

A file's row offers them so that "another file next to this one" is one gesture.
It is the common case, and the alternative is right-clicking the parent folder,
which on a deep row means finding it first.

### 5.2 The workspace root has its own menu

The menu opens on a row, and the workspace root has no row. **Right-clicking
where the root is** opens a menu holding the two creates and nothing else —
there is no root to rename, bin, exclude, or point a comment at.

Two places open it, and both are needed:

| Right-clicked | Why it is a target |
|:--|:--|
| the empty space under the tree | it *is* the root — the same space a drag drops into for the same meaning (spec 40 §5.1) |
| the header, `WORKSPACE · REX` | a workspace whose tree fills the whole column has no empty space, and without this there would be no way to make anything at the root at all |

A row's own right-click stops the event, so the root's menu never fires by
accident from a row.

> [!note]
> **Version 1.0 put two glyph buttons in the header instead**, and they were
> wrong twice over. They said nothing — an icon-only control needs REX's own
> `data-tip`, and 1.0 used the native `title`, which never appeared — and the
> gesture people reach for at the root is the one that already works on every
> row. The reviewer, 2026-09-03: *"I cannot clearly see what they are supposed
> to mean … I should be able to do it just by right-clicking on the empty space
> in the Workspace."*

### 5.3 The box, and what follows

The name is typed in the tree, in the row the new thing will occupy, using the
same `NameBox` a rename uses (spec 23 §5.2). It opens **blank**: there is no
name to select, and a box pre-filled with `untitled.md` is a box that creates
`untitled.md` every time somebody presses Enter too quickly.

Enter creates. Escape cancels. An empty box cancels — `allowEmpty: false`
already means exactly that.

After a create that lands:

1. The tree is re-scanned, exactly as after a rename (spec 23 §5.4). The
   reference graph is dropped, because it is a view of the same scan.
2. A **folder** is left open and nothing else happens.
3. A **file** REX can render is opened in the pane. That is the point of making
   it — a new empty document nobody opens is a create the reviewer has to
   follow with a click.
4. A file REX cannot render is created, listed grey, and not opened. The notice
   says so: `Created. REX cannot open that kind of file, so it is only listed.`

### 5.4 A refusal is a sentence

Straight to the notice bar, as spec 23 §2.2 established. Nothing about a create
is an exception a dialog would serve better.

---

### 5.5 An empty folder can be binned

Spec 23 §3.1 refused every folder, and gave the reason: *"A folder holds a tree,
and one click must not be able to take a whole `docs/` with it."*

**An empty folder holds no tree**, so that sentence has nothing left to protect —
and this spec is what makes the gap matter: it lets a reviewer make a folder in
two keystrokes and left them no way to take it back. The reviewer, 2026-09-03:
*"I should be able to remove the empty folder. Now I cannot."*

So `Move to Bin` is offered on a folder whose row has no children, and refused
by main on one that turns out to hold something:

> "docs" is not empty. REX only bins a folder with nothing in it, so one click
> can never take a tree of files with it.

Three things this deliberately does not do:

| Not | Why |
|:--|:--|
| Recurse — a folder holding only empty folders is refused | One level of "empty" is a rule anybody can predict from the tree in front of them. A recursive walk means the answer depends on something not on screen |
| Treat a dotfile as nothing | The scan draws `.DS_Store` like any other file (spec 02 §4), so what the tree shows and what `readdirSync` counts agree. A folder that "looks empty but is not" would be the trap |
| Trust the tree | The renderer offers the item from `children.length`, which is a scan and can be old. Main reads the folder itself, which is the only answer that is true at the moment of the click |

The confirm loses its second line. A file's says which comments survive it
(spec 23 §3.2); an empty folder has none, and two sentences saying nothing is
worse than one.

## 6. Where the code goes

| File | Change |
|:--|:--|
| `src/shared/channels.ts` | `workspaceCreate` name, the request and result types, one line on `RexApi` |
| `src/main/workspace/files.ts` | `createEntry`, beside `renameEntry` and `deleteEntry`; `refuseTarget` gains a `"directory"` want and, in 1.2, loses its `"file"` one; `deleteEntry` takes an empty folder (§5.5) |
| `src/main/db/queries.ts` | `countThreadsFor` — §2.2's count, in every lane |
| `src/shared/paths.ts` | `parentPath` — §5.1's "beside this file" |
| `src/main/ipc.ts` | one handler, one line |
| `src/preload/index.ts` | one line |
| `src/renderer/overlay/Icons.tsx` | `FilePlus`, `FolderPlus` — the glyph in the name box's row (§5.3) |
| `src/renderer/overlay/Explorer.tsx` | two menu items, two header buttons, the inline box and where it is drawn |
| `src/renderer/overlay/App.tsx` | `createEntry`, and the open-or-notice that follows |
| `src/renderer/overlay/NameBox.tsx` | `placeholder` — §5.3's empty box |
| `src/renderer/overlay/overlay.css` | §10.4's `box-sizing` |
| `test/workspaceFiles.spec.ts` | the refusals, and the two writes |

Nothing in `db/` changes, and nothing in `agent/`.

---

## 7. What this does not do

- **No templates.** An empty file is empty. A `.md` does not arrive with a
  heading, because the first thing anybody would do is delete it.
- **No nested path in the box** — §3.1.
- **No duplicate, no move, no copy.** Each is a second gesture with its own
  questions about what follows the path, and none of them was asked for.
- **No drag and drop.** The tree has never had one, and a create is not the
  place to invent it.
- **No folder that holds anything in the Bin's place.** One click that takes a
  whole `docs/` is exactly what spec 23 §3.1 refused, and that stands. §5.5 is
  the one folder it lets through.

---

## 8. Milestones

| # | Ends in | Checked by | Result |
|:--|:--|:--|:--|
| 0 | `createEntry` and its refusals, under `node --test` | `npm run test:workspace-files` | 37 pass |
| 1 | The channel end to end: menu → main → tree | a live window, a file created in `docs/` | `docs/plan.md`, made in a **collapsed** folder, drawn and opened |
| 2 | The root's own menu, and the pane that opens | a live window, at the root | 1.0: `summary.md` from a header button. 1.1: a file from the empty space and a folder from the header, both at the root, with the row menus unchanged |
| 3 | The three refusals, seen as sentences | a live window: a name with a `/`, a name already taken, a folder called `out` | all three in the notice bar; a **file** called `out` made and listed |

Milestone 1 also proved the one interaction with spec 23: a commented
`docs/plan.md` moved to the Bin and then re-created at the same name answered
*"Created. REX still holds 1 comment written on that name; it will show as gone
until the text comes back."*, and the sidebar's `gone` filter showed 1.

---

## 9. Rejected

**A dialog.** Every other name in REX is typed where the thing is — a comment's
name, a group's name, a rename. A modal for this one would be the only one.

**Creating in the folder of the *open document* rather than the right-clicked
row.** It reads well in the one case where the reviewer has a document open and
is looking at its folder, and it is a guess in every other. The row that was
right-clicked is not a guess.

**A `+` on every row, on hover.** VS Code puts its two buttons in the header
only, and for a reason this tree shares: a per-row control has to be drawn
somewhere, and the right edge of these rows already carries the comment and
change counts (spec 18 §4.1), which are the numbers the tree exists to show.

---

## 10. Where the build departed from §1–§7

### 10.1 The workspace root is a legitimate parent

`isInsideWorkspace` answers **no** about the root itself — deliberately, because
nothing is inside itself (spec 21 §3). §5.2's header buttons pass exactly that
path, so every create at the root was refused with *"That path is not inside the
open workspace."*

`refuseTarget` now allows it, and only for the `"directory"` want. Renaming or
binning the workspace root is still refused, which is what that want is worth:
the allowance is tied to the one question that can legitimately name the root.

### 10.2 The folder has to stay open, not just open while the box is up

The create row forces its parent open so the box can be seen. That lasted
exactly as long as the box: the tree came back from the re-scan with the folder
shut and the new row inside it, which looks precisely like a menu item that did
nothing. Measured on 2026-09-03, making a folder inside a collapsed `docs/`.

`Explorer.reveal` puts the parent in the open set when the name is saved, and
takes `manual` with it for `toggle`'s reason.

### 10.3 §2.2 counts threads, not the tree's three lanes

The first build asked `commentCountsByDocument`, which is the tree's own count:
open, resolved and gone. A `draft` and a `note` are none of those, so a file
whose kept comment was a note answered *"no comments"* and the sentence never
appeared. `countThreadsFor` replaces it — every lane, both routes. §2.2 says why
the two counts are different questions.

### 10.4 A pre-existing overflow, found by the new row

`.rex-tree-row` set `width: 100%` and relied on `<button>`'s `border-box`. The
tree also draws **div** rows — an excluded row, an unopenable one, and now the
name box — and a div is `content-box`, so each of those was 24px wider than the
column and the whole explorer scrolled sideways: the header's label cut off at
the left, every row indented wrong.

Older than this spec, and reachable before it. It is fixed here because §3.3
makes an unopenable file something a reviewer can now make in two keystrokes,
and because the new-name box is the third div row.
