# REX 05 — selection as a phase

**Version:** 1.1 · 2026-08-21
**Status:** specified, not implemented

> [!note]
> **1.1 widened Apply.** 1.0 kept Apply on one document and listed "Apply across
> documents" as out of scope. A comment that spans three files leads to a change
> that spans three files, so §5.6 now edits every document the comment is about,
> and §5.6.1 shows the result *in* the document rather than only as patch text.
> Nothing in Apply's safety story moved — §9.
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

**If you are picking this up cold**, read in this order:

1. **§1 and §3** — the idea, and the interaction it produces. Everything else
   is a consequence of §3.
2. **§3.5 and §4.1** — the two pieces of mechanism that are not obvious from
   the idea: what a selected item *is*, and why widening is rebuilt from the
   anchor instead of remembered. Getting either wrong produces something that
   works in a demo and breaks on a reload.
3. **§5** — the one place the data model changes, and §5.8, which is the list of
   things that quietly assume one document.
4. **§5.6 and §5.6.1** — what Apply becomes. It is the only part of this
   document that writes to disk, so read it with spec 01 §8.7 open beside it.
5. **§10** — the milestones, in order, with their acceptance checks.

You also need spec 01 §6 (anchoring) and spec 04 in full; this document assumes
both and does not restate them. The code as it stands is the other input —
`anchoring.ts`, `Composer.tsx`, `App.tsx` and `queries.ts` are where nearly all
of this lands, and §8 is the file-by-file map.

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
| 01 §8.7 Apply | **Every document the comment is about**, not only `targets[0]`'s, and offered wherever the reviewer is standing. The change is then shown *in* the document rather than only as patch text. §5.6. |
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

#### What counts as a selection

`onSelectionChanged` fires on every `mouseup` in the document with a
non-collapsed selection, and people drag over a sentence while reading. Three
rules keep that from filling the panel with rubbish. They are the whole
definition — implement exactly these and nothing more:

1. **Shorter than 3 characters is ignored.** A stray click-drag of one or two
   characters is never a comment.
2. **A selection that overlaps the newest item replaces it.** Dragging out a
   sentence, letting go, then extending it is one act. Overlap is tested on the
   normalised offsets (`TextPosition`) of the two anchors in the same document;
   any intersection counts.
3. **An exact duplicate is refused, silently.** Same document, same
   `element.css`/`id`, same `quote.exact`, same `region`. Selecting the same
   cell twice is a slip. *Two different regions of one figure are not
   duplicates* and both are kept — spec 04 already treats that as legitimate.

> [!note]
> The risk this accepts, stated plainly: reading with the mouse now leaves rows
> behind. Rules 1 and 2 remove the two common cases, and `clear` plus per-row
> remove handle the rest. If it still gets in the way in practice, the fix is a
> deliberate-confirm affordance — a small `+ add` chip at the end of the
> selection — **not** a held modifier, which fault 1 rules out.

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

Two consequences for the layout, both easy to miss:

- **The right sidebar is hidden while the graph is showing** (`rex-pane-hidden`).
  It stops being hidden whenever the panel has items. Losing sight of a
  half-built selection because you went to look at the graph is the same fault
  as losing it to a stray click.
- **The panel has a maximum height and scrolls inside itself**, about a third of
  the sidebar. Twenty items must not push the comments off the bottom; the
  comments are how you check you are not asking something already asked.

### 3.4 Ask

`Ask about n` creates one thread with every item as a target, in panel order,
and empties the panel — items and note both. From there it is a thread like any
other: spec 01 §8 is unchanged.

Emptying the panel also drops the **document's own** text selection. The
browser's selection is not the panel's and does not go with it, so a passage
stayed blue in the document with nothing left in REX that was about it. `clear`
does the same, for the same reason.

The button is disabled with an empty note. The note is the question; without it
there is nothing to ask.

Removing the last item leaves the panel gone and the note **discarded**. A note
with nothing to attach it to is not a thing REX has a place for, and keeping it
invisibly to reappear later is worse than losing three words.

### 3.5 What a selected item is, in the renderer

The panel's state lives in `App.tsx` and nowhere else. One item is:

```ts
interface SelectionItem {
  /** Stable for the life of the item; the React key and the hover pairing id. */
  id: string;
  /**
   * Which gesture made it. Not derivable from the anchor — §4.1 says why, and
   * getting it wrong offers the wrong scope as the chosen one.
   */
  kind: "text" | "element";
  documentId: string;
  /**
   * The whole ref, not a path, so a row can reopen its document with the
   * `doc:open` that exists — and so a tier 2 URL document works here too.
   */
  documentRef: DocumentRef;
  /** Shown in the row: the file name, or the host for a URL. Not the whole path. */
  documentName: string;
  anchor: Anchor;
  /** The row's own words — the quote, or `Table · 7 rows × 4 columns`. */
  label: string;
  /**
   * Where it sits, in document coordinates, and the zoom that was measured at.
   * Spec 04 §4.5: the outline is redrawn from these, rescaled, and a draft
   * outlives a zoom change.
   */
  rect: ScopeRect;
  zoom: number;
}
```

`documentId`, `documentPath` and `documentName` are all known at the moment of
selection, because **an item can only be selected while its document is open**.
That is why there is no IPC call to look a document up later, and why the panel
never has to ask main anything.

There is deliberately **no live DOM reference and no `ScopeChain`** on an item.
A chain holds `Element`s: they die when the document reloads, they cannot cross
the tier 2 bridge, and a stale one is the kind of thing that resolves to
somewhere and looks fine. §4.1 says what to do instead.

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
strength meter and the `region of it` control move with them, on the expanded
row only: nine collapsed rows each carrying a strength meter is a wall.

### 4.1 Widening is re-derived, never remembered

Today `FrameSurface` keeps one `ScopeChain` — the last probe — and the composer's
chips index into it. That cannot work for a list: chips are wanted for item 4
after item 7 was added, and after the document has been reloaded.

So the chain is **rebuilt on demand from the anchor**, by a new function beside
the existing ones in `anchor/pick.ts`:

```ts
/** The chain to widen through, for an anchor already written. */
export function scopeChainForAnchor(
  index: TextIndex,
  anchor: Anchor,
  kind: "text" | "element",
): ScopeChain | null;
```

It is a few lines of glue over parts that already exist: `resolveAnchor(index,
anchor)` (spec 01 §6.5); a `range` result goes to `scopeChainForRange`, an
`element` result to the same `chainFrom` walk `scopeChainAt` uses. It returns
null when the anchor does not resolve.

> [!warning]
> **`kind` is not a convenience, and leaving it out is a wrong-place failure.**
> A text anchor and an element anchor carry the same fields — `create.ts` gives
> both a quote and an element ref — so a stored anchor cannot say which gesture
> made it, and `resolveAnchor` answers the quote first for either. Rebuilding
> without it offered `text` as the chosen scope for a comment stored on a table
> cell, and widening from there would have re-anchored the row to a text
> selection it never had. Measured on 2026-08-21 against a two-file fixture.
>
> The panel was there when the anchor was made, so the item carries a `kind`
> and hands it back. `scopesForAnchor` and `anchorFromAnchorScope` take it too.

Two things follow, and both are improvements rather than costs:

- **Widening works whenever the item's document is open**, including after a
  reload — which the remembered chain never survived.
- **Widening a row is exactly re-anchoring it.** The row's `anchor`, `label`,
  `rect` and `zoom` are all replaced by the chosen scope's. Nothing else in the
  item changes, and its position in the list is kept.

The chips are disabled, with the reason on hover, when the item's document is
not the open one. There is no DOM to walk, and inventing one is the failure
this whole spec is careful about.

### 4.2 What `DocumentSurface` becomes

`anchoring.ts` defines the interface both tiers implement — a same-origin
iframe the renderer reaches into, and a `<webview>` driven through its preload.
Every change below has to be made in **three** places: the interface,
`FrameSurface`, and `preload/webview.ts`.

```ts
/** Enough to build a SelectionItem. Replaces DraftAnchor everywhere. */
export interface Selected {
  anchor: Anchor;
  label: string;
  rect: ScopeRect;
  /** The chain to widen through, and which of it produced `anchor`. */
  scopes: PickScope[];
  active: number;
}

export interface DocumentSurface {
  resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]>;

  /** A text selection, or null when there is none worth taking (§3.1 rule 1). */
  selectionMade(): Promise<Selected | null>;

  probeAt(x: number, y: number, keep: number): Promise<Probe | null>;

  /** Commits the probe's chain at `index`. Unchanged from spec 04. */
  anchorFromScope(index: number): Promise<Selected | null>;
  anchorFromRegion(index: number, box: ScopeRect): Promise<Selected | null>;

  /** §4.1 — the chain for an item already in the panel, rebuilt from its anchor. */
  scopesForAnchor(anchor: Anchor, kind: SelectedKind): Promise<Probe | null>;
  /** Re-anchors an item to one scope of that rebuilt chain. */
  anchorFromAnchorScope(
    anchor: Anchor,
    kind: SelectedKind,
    index: number,
  ): Promise<Selected | null>;

  scrollBy(dx: number, dy: number): void;
  /** §3.3 — a panel row clicked while its document is open scrolls to it. */
  scrollToAnchor(anchor: Anchor): void;

  /**
   * §5.6.1 — the boxes to outline after an Apply, from `data-src-line`.
   *
   * Empty for a document with no source stamps, which is the honest answer for
   * an HTML file rather than a guess at which paragraph moved.
   */
  boxesForLines(ranges: Array<{ from: number; to: number }>): Promise<ScopeRect[]>;
}
```

`DraftAnchor` and its `top` field are gone: the panel does not float beside
anything, so nothing needs a vertical position any more. `Selected.rect` carries
the geometry the outline needs.

The two `…ForAnchor` methods take an `Anchor` rather than an index because the
panel's items are not the probe's chain — that is the whole point of §4.1. In
`FrameSurface` both are one call to `scopeChainForAnchor` and then the existing
`anchorFromScopeIn`; in the preload they are the same two lines behind the
`JSON.stringify` bridge.

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
`null` — the rule spec 04 §4.3 introduced, with one more case. A thread whose
every state is `null` has no overall state: it shows `not checked here` too.

#### What the sweep returns

`anchor:restate` now names a target by position (§7), so the sweep has to report
per target. `ResolvedThread` (spec 04 §4.3) changes shape:

```ts
export interface ResolvedThread {
  threadId: string;
  /** The worst state across the targets this sweep could actually check. */
  state: AnchorState | null;
  /** One entry per target *in the open document*, never for the others. */
  checked: Array<{
    /** Its index in `Thread.targets` — what `anchor:restate` needs. */
    position: number;
    state: AnchorState;
    /** Null for a text target: a range is painted, not outlined. */
    box: ScopeRect | null;
  }>;
  /** From the first checked target, for the gutter marker. Null when none was. */
  top: number | null;
  label: string | null;
}
```

`resolveAgainst` iterates `thread.targets`, skips every target whose
`documentId` is not the open document, and pushes a `checked` entry for the
rest. The renderer then calls `anchor:restate` once per checked entry.

A thread with no checked entries still appears in the list, with no gutter
marker and no outline. **It must not be dropped from the sweep's result**, or
its card loses the state it had from an earlier visit.

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

### 5.6 Apply covers every document the comment is about

A comment about A, B and C is one question, so the change it leads to is one
change. Apply therefore edits **every document the comment has a target in**,
and it is offered wherever the reviewer is standing — the button does not care
which document is on screen, because the comment does not either.

Three things follow, and each is a constraint rather than a detail.

**One agent turn per repository root.** The write agent's guarantee is `git
checkout`, and that guarantee is per repository. So the target documents are
grouped by `repositoryRoot()`, and one `write` session runs per group with that
root as its `cwd` and every file in the group named in its prompt. Two documents
in one repository are one session; two repositories are two.

**A document that cannot be edited is skipped and named.** A URL, a PDF, a DOCX,
and a file in no git repository each fail the test spec 01 §5.2 already applies —
and they now fail it *individually* rather than for the whole comment. Apply runs
on the rest and says which ones it left alone. It refuses outright in exactly two
cases: no target document can be edited at all, or a target file already has
uncommitted changes, because rejecting would discard those too (the guard spec 01
§8.7 already carries).

**The prompt names every file and every passage.** `writePrompt` groups the
passages by document exactly as `askPrompt` does (§5.5), and says plainly that
some of the files may need no change at all. A write agent handed three files and
one instruction will otherwise find something to do in each of them.

`targets[0]` keeps one job and loses the other. It still decides the thread's own
`documentId` — the cost pill, Ask's repository root, and the `## Surrounding
section` block all read it. It is no longer the only thing Apply writes to.

### 5.6.1 The change is shown in the document

A unified diff in a dialog is right for a reviewer who wants to read patch text,
and wrong for one who wants to know what the document now says. So Apply's
confirmation step happens **on the document**:

1. The agent edits the files on disk. Nothing is final — this is still spec 01
   §8.7 step 5, and `git checkout` is still what makes it reversible.
2. Main computes, for every changed file, the line ranges of the **added** lines
   in the file as it now stands, and sends them with the diff. The added lines
   only, not the whole hunk: a hunk carries three lines of context either side,
   and on a short file that reaches most of it. The renderer widens each line to
   the block that contains it, so being precise here loses nothing and stops an
   outline appearing around prose the agent never touched.
3. The renderer re-opens the document on screen, so the reviewer reads the
   changed text rather than the text it replaced, and outlines every changed
   section in it.
4. The reviewer reads. **OK** keeps the change. **Undo** reverts it with `git
   checkout` and re-opens the document again, back as it was.
5. Either way the outlines go, and the re-anchor sweep of spec 01 §8.7 step 7
   runs.

A changed document that is *not* on screen is named in the review bar with the
number of sections changed in it. Opening it while the review is still open
outlines its changes too — the ranges are keyed by file path, so this costs
nothing.

**A source line is what makes this possible, and only Markdown has one.**
`markdown.ts` stamps `data-src-line` on every block it emits (spec 01 §5.3), so a
changed line range maps to the elements those lines produced. An HTML document is
served as its own bytes and carries no such stamp; there the review bar says so
and the diff is the whole answer. That limit is stated rather than papered over,
and it is not new — Apply was always Markdown-first, because Markdown is the
format with a line to write back to.

The outline is REX's own overlay box, exactly as §6 draws every other one.
Nothing is written into the document under review, and `<mark>` is no more
allowed here than anywhere else.

### 5.7 The explorer's counts

`commentCountsByDocument` counts threads whose **`document_id`** matches. It
changes to count threads with a **target** in that document, so a document
mentioned by a comment written elsewhere is not shown as having none. The join
moves from `thread` to `thread_target`, and `DISTINCT thread_id` keeps a comment
with three targets in one document from counting three times.

The `orphaned` count reads `thread_target.anchor_state`, and a `NULL` there is
**not** orphaned (§5.4). Written as `anchor_state = 'orphaned'` that is already
true in SQL; written as `!= 'ok'` it would not be, which is the mistake to avoid.

### 5.8 Six smaller things that assume one document

Each of these reads a document from the thread today, and each needs to be told
which one. None is hard; all of them are silent if missed.

| What | Today | Becomes |
|:--|:--|:--|
| **Gutter markers** | one per resolved thread, at `top` | only for threads with a checked target — `top: null` means no marker |
| **Apply enabled** | `OpenedDocument.applyEnabled`, i.e. the *open* document | judged by the comment's **own** target documents, decided in main and carried on the thread (§7). Which document happens to be on screen decides nothing |
| **Apply's warning** | — | the card names the documents Apply will edit, and any it must skip, *before* the button is pressed |
| **Cost pill** | `documentCostUsd(db, thread.documentId)` | unchanged. It stays the *open* document's running total, and `thread.documentId` is still `targets[0]`'s |
| **Comment numbering** | position in the open document's list | position in the workspace-wide list, ordered by `created_at`. The number is shown on the card, the gutter marker and the row, and all three must agree |
| **`__rexReanchor(documentId)`** | re-renders and re-sweeps after Apply | unchanged in shape. Apply may now edit several documents; the one on screen is re-swept, and targets elsewhere are checked when their document is next opened |

`AnchorSummary` (`ok`/`moved`/`orphaned`/`total`, shown after Apply) counts
**checked targets**, not threads. It is a report on what the sweep just did, and
after a cross-document Apply what it just did is one document's worth.

---

## 6. Highlighting

Spec 04 §4.5 drew the draft's targets as numbered dashed outlines. That is kept
and becomes the selection's, with two additions:

- Only targets in the **open document** are drawn. The rest exist as rows.
- Hovering a row in the panel brightens its outline, and hovering its **number
  badge** brightens the row. The badge and not the whole box: the box lies over
  the prose, and one that takes pointer events makes the text under it
  impossible to select. Measured on 2026-08-21 — `elementsFromPoint` over an
  outline answered with the outline and never reached the document, so a
  reviewer with five places selected could no longer drag out a sixth.

A text target is painted with the Custom Highlight API and an element target as
an outline, exactly as §6.7 and spec 04 §4.3 already do. Nothing here wraps a
range in an element.

**Every box is re-measured on every sweep, and never remembered.** A row records
where its place was when it was clicked, and that is a cache, not a fact:
anything that moves the document under a fixed overlay — a window resize, a
splitter drag, the explorer appearing, a re-render after Apply — leaves it
behind, and a dashed box drawn from a stale rect names text it is not over. So
the sweep asks the surface for each place's box (`rectsForAnchors`) exactly as
it asks for each comment's, and a place whose anchor no longer resolves loses
its box rather than keeping the old one. The pane is watched with a
`ResizeObserver` and not a `window` resize listener, because a splitter drag
resizes the pane without resizing the window.

**The comment whose card is open carries its own colour.** Steel and amber say
what *state* an anchor is in; neither can also say which comment is being read,
and the ring this used to be was in the selection's own blue — so a reviewer
building a selection while reading a comment had two blues on one page meaning
two things. The open comment's places are drawn in violet, text
(`::highlight(rex-active)`) and blocks alike. It is a repaint and not a sweep:
opening a card changes no anchor's state, and a sweep would write every checked
target's state back to the database on a click.

**A third outline joins them, and it is deliberately a different one.** §5.6.1's
changed sections are drawn in the write colour — the red spec 01's design spends
on exactly two things, a lost anchor and the write-capable agent — and never in
the blue a selection uses. A reviewer looking at a document mid-Apply must not
have to work out which marks are their own selection and which are the agent's
edit. The change outlines exist only while a review is pending, and go on OK or
Undo.

---

## 7. IPC

Four channels change shape. **Nothing is added** — see the note below.

```ts
/**
 * Every comment in the workspace, not one document's. §5.3.
 *
 * `root` is the workspace root, or null when a single file was opened by path —
 * main then uses that document's own directory. `documentId` is the open
 * document, and it is not a duplicate of `root`: a tier 2 URL document sits
 * under no directory at all, and without this its comments would vanish from
 * the list the moment the list stopped being per-document.
 */
threadList(request: { root: string | null; documentId: string | null }):
  Promise<ThreadWithMessages[]>;

/** `targets[0]` decides the thread's own documentId. Order is panel order. */
threadCreate(request: {
  targets: Array<{ documentId: string; anchor: Anchor }>;
  note: string;
}): Promise<Thread>;

/** One target, named by its index in `Thread.targets`. §5.4. */
anchorRestate(request: {
  threadId: string;
  position: number;
  anchorState: AnchorState;
}): Promise<void>;

/**
 * §5.6.1 — the diff, plus what to outline in each document it changed.
 *
 * `from` and `to` are 1-indexed inclusive line numbers in the file **as it is
 * now**, which is what `data-src-line` can be matched against. `files` stays,
 * because a file with no mappable lines still has to be named.
 */
interface ApplyReadyEvent {
  applyRunId: string;
  threadId: string;
  diff: string;
  files: string[];
  regions: Array<{ file: string; from: number; to: number }>;
  /** Documents Apply could not edit, and why. §5.6. */
  skipped: Array<{ file: string; reason: string }>;
}
```

`threadCreate` loses its `documentId` field: it is `targets[0].documentId`, and
a payload that carries the same fact twice is a payload that can disagree with
itself. Main rejects an empty `targets`.

`ThreadWithMessages` gains three derived fields, because the list is now
workspace-wide and a row has to say what it is about without a second round
trip: `documentNames` (the distinct documents of its targets, in target order),
`applyEnabled`, and `applyDisabledReason`. All three are computed in main from
the document table, and none of them is stored.

> [!note]
> An earlier draft of this spec added a `doc:resolveFor` channel to look up a
> document id by path. **It is not needed and must not be built.** An item can
> only be selected while its document is open, so the renderer already holds
> the id — §3.5. Opening a document from a panel row uses the path the item
> already carries, through the `doc:open` that exists.

No new transport and no new privilege. Invariant I3 is untouched.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `src/shared/types.ts` | `AnchorTarget`; `Thread.targets` replaces `anchor`, `extraAnchors`, `anchorState` |
| `src/shared/channels.ts` | the three payloads in §7 |
| `src/main/db/schema.sql` | `thread_target` and its index |
| `src/main/db/database.ts` | the data-moving migration (§5.2) |
| `src/main/db/queries.ts` | `createThread` takes targets; `listThreads(root)`; `setTargetState`; `commentCountsByDocument` joins `thread_target` |
| `src/main/agent/prompts.ts` | `askPrompt` groups by document (§5.5); `synthesisPrompt` reads `targets[0].anchor.quote` |
| `src/main/ipc.ts` | the four channels; Apply enablement per thread (§5.8) |
| `src/main/apply.ts` | one turn per repository root; skipped documents; changed line ranges (§5.6) |
| `src/main/diff.ts` | **new** — unified diff → the `+` side's line ranges, per file (§5.6.1) |
| `src/renderer/anchor/pick.ts` | `scopeChainForAnchor` (§4.1) |
| `src/renderer/overlay/anchoring.ts` | `ResolvedThread.checked`; resolve only the open document's targets; `DraftAnchor` is gone |
| `src/renderer/overlay/SelectionPanel.tsx` | **new** — rows, chips on the expanded row, the note, Ask, clear |
| `src/renderer/overlay/Composer.tsx` | **deleted** |
| `src/renderer/overlay/Sidebar.tsx` | workspace-wide list; the documents line on each row |
| `src/renderer/overlay/ThreadRow.tsx` | the documents line |
| `src/renderer/overlay/CommentCard.tsx` | targets instead of `anchor`/`extraAnchors`; the cross-document Apply warning |
| `src/renderer/overlay/App.tsx` | `SelectionItem[]` as app state; the three add rules (§3.1); no draft |
| `src/renderer/overlay/DocumentView.tsx` | outlines from the selection, for the open document only; the change outlines; no `Composer` |
| `src/renderer/overlay/Gutter.tsx` | no marker for a thread with nothing checked here |
| `src/renderer/overlay/DiffDialog.tsx` | becomes the review bar of §5.6.1 — OK, Undo, the other files, the diff on demand |
| `src/preload/webview.ts` | the tier 2 side of `scopeChainForAnchor` and `boxesForLines` |
| `test/prompts.spec.ts` | grouped passages |
| `test/targets.spec.ts` | **new** — §10 says what it must assert |
| `test/diff.spec.ts` | **new** — added lines to line ranges, including a pure deletion |

`DraftAnchor` disappears with the composer. Everything that used it now reads a
`SelectionItem`.

---

## 9. What this deliberately does not change

- The anchoring model. Spec 01 §6 is untouched.
- The `read` / `write` profile split and the deny gate (spec 01 §8.4).
- **Apply's safety story.** It still edits first and asks second, the diff is
  still shown before anything is final, rejecting still reverts with `git
  checkout`, and a file with uncommitted changes still refuses. §5.6 widens what
  Apply reaches; it removes no guard.
- The graph, the explorer tree, and every renderer added by spec 03.

---

## 10. Milestones

Each milestone ends in something runnable. The checks are the acceptance bar,
not a suggestion — `rules/06-testing.md` applies, and anchoring is the component
that fails silently, so a green run that skipped the hostile documents proves
nothing.

**Milestone 15 — the panel, one document.** `AnchorTarget`, `thread_target`,
the migration, `scopeChainForAnchor`, the panel, the composer deleted.
Selection accumulates; the note is written in the panel; Ask creates the
thread. Every target is still in one document.

*Done when, all checked in the running app:*

- [ ] Three cells in one table become one comment; the panel empties on Ask.
- [ ] That comment shows three numbered outlines after the document is reopened.
- [ ] A stray 2-character drag adds nothing; extending a selection replaces its
      row rather than adding a second; selecting the same cell twice adds one row.
- [ ] Widening a row's chips re-anchors that row and keeps its position.
- [ ] `P`, `D`, `G` and `⇧A` still work while the panel is open and holds a note.
- [ ] Clicking in the document never empties the panel.
- [ ] **The migration:** against a copy of a real `~/.rex/rex.db`, every existing
      comment resolves to the same state and the same place it did before. Take
      the before-and-after by opening each document and reading the sweep, not
      by inspecting SQL.
- [ ] `test/targets.spec.ts` asserts: the migration turns `anchor_json` +
      `extra_anchors_json` into ordered rows; running it twice changes nothing;
      the worst-state rule ignores `null`; `null` never counts as orphaned.

**Milestone 16 — across documents.** The workspace-wide list, the documents line
on each row, `null` states, the grouped prompt, the explorer counts, Apply
enablement per thread.

*Done when:*

- [ ] A comment made of two items in `sample-document.md` and one in
      `components.md` appears, identically, from either document.
- [ ] Its third target reads `not checked here` while that document is closed,
      and resolves when it is opened — without ever being reported as orphaned.
- [ ] The Ask prompt names both files, grouped, with the paths §5.5 specifies.
- [ ] The explorer's count for `components.md` includes that comment.
- [ ] The card names the documents Apply will edit before it is pressed, and
      names any it must skip.

**Milestone 17 — the small things.** Reordering by drag, hover pairing between
row and outline, the `clear` confirmation.

*Done when:* dragging row 3 above row 1 changes which target is `targets[0]`,
and the numbers on the outlines follow.

**Milestone 18 — Apply across documents, seen in the document.** §5.6 and
§5.6.1: one turn per repository root, skipped documents named, changed line
ranges out of the diff, the change outlines, OK and Undo.

*Done when, all checked in the running app against a scratch git repository —
never against a real document until the last check has passed:*

- [ ] A comment with targets in two Markdown files in one repository produces
      one diff covering both, and both are named in the review bar.
- [ ] The document on screen re-renders to the changed text, and every changed
      section in it is outlined in the write colour.
- [ ] Opening the *other* changed document while the review is still open
      outlines its changes too.
- [ ] **Undo restores both files exactly** — `git status --porcelain` is empty
      afterwards, and the document on screen re-renders back to what it was.
- [ ] OK clears every outline, and the re-anchor sweep reports the open
      document's targets.
- [ ] A comment whose targets include a PDF edits the Markdown and names the
      PDF as skipped, rather than refusing the whole Apply.
- [ ] A target file with uncommitted changes refuses the Apply, by name, before
      the agent runs.
- [ ] `test/diff.spec.ts` asserts that only the added lines are reported and at
      their **new** numbers, that two edits separated by context stay two ranges,
      and that a hunk which only deletes yields no range.

---

## 11. Out of scope

- **A `this document` filter** on the comment list. It will be wanted; it is
  one chip and it is not needed to know whether the rest of this is right.
- **Change outlines in a document with no source lines** — an HTML file, a PDF,
  a DOCX (§5.6.1). The diff is the answer there, and guessing which paragraph an
  edit landed in is exactly the silent wrong-place failure spec 01 §6.1 refuses.
- **Editing a document Apply skipped.** A PDF and a DOCX have no honest source
  line to write back to (spec 01 §5.2), and that is unchanged.
- **A selection that survives a restart** (§3.3).
- **Selecting in the graph.** A node is a document, not a passage, and a
  comment about a whole document is a comment with no anchor.
- **Editing an existing comment's targets.** The panel builds a comment; it
  does not edit one. Adding that needs a channel and a card-side editor, and
  nothing has asked for it.
