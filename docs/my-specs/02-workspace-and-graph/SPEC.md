# REX 02 — workspace explorer and reference graph

**Version:** 1.0 · 2026-08-20
**Status:** implemented and verified against `~/Projects/Github/redhat/ProtoBot/docs`
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md), which is implemented and passing.

> [!note]
> This document extends spec 01. It does not restate it. Where the two touch,
> §2 says exactly what changes; everywhere else spec 01 still governs, including
> all three invariants and the anchoring model.

---

## 0. How to use this document

Read §1 to §3 first. Then work the two milestones in §9, in order.

**Two rules for the implementer:**

1. **Neither feature may weaken the three invariants of spec 01 §3.** The
   explorer and the graph both live in the renderer's shadow root; neither
   gets a database handle, and neither resolves an anchor.
2. **Where this document is silent, prefer the simplest thing that works.**
   §10 lists what is deliberately out of scope.

---

## 1. What this adds

Two features, and one decision they force.

**A workspace explorer.** Open a *folder* rather than a single file. A tree
down the left, VS Code shaped: directories, documents, and everything else.
Click a document and it opens in the centre pane with its comments, without
restarting the app.

**A reference graph.** Which documents link to which, drawn as a graph, with
REX's own review data on top of it — so it shows not just how the corpus is
wired but *where the unfinished discussion is*.

**The decision:** spec 01 §14 open question 3 asked "windows or tabs for
multiple open documents", noting that tabs complicate the anchor resolver's
lifecycle. This document answers it: **one window, one open document at a
time, swapped from the explorer.** The resolver lifecycle is untouched — the
existing code already tears down and rebuilds the anchor surface on every
change of the open document, which is the same path the post-Apply re-anchor
sweep uses. Tabs would mean *n* live surfaces and *n* highlight registries;
swapping means one, exactly as today.

### 1.1 What stays the same

- A document is still identified by absolute path. Threads created before a
  workspace existed keep resolving, because nothing about `DocumentRef`
  changes.
- **No database migration.** The explorer's counts are aggregates over the
  existing `thread` table; the graph is computed on demand from the files on
  disk. Neither stores anything. If a future version wants to cache the graph,
  that is a new decision, not this one.

---

## 2. Changes to spec 01

| Spec 01 | Change |
|:--|:--|
| §3.2 Dependencies | Adds `d3-force` and `@types/d3-force`. Nothing else. |
| §3.1 Repository layout | Adds `src/main/workspace/` and three overlay components (§8). |
| §10 IPC contract | Adds three commands (§7). No new events. |
| §14 open question 3 | **Answered**: one window, swap documents (§1). |
| §9 Database | **Unchanged.** No new tables, no migration. |
| §4 Shared types | Adds the types in §3. `DocumentRef` is untouched. |

`d3-force` is a layout solver, not a renderer: it takes nodes and edges and
produces coordinates. Drawing stays hand-written SVG in the overlay, and
pan/zoom is a `viewBox` transform rather than a second dependency (`d3-zoom`).

---

## 3. Shared types

Added to `src/shared/types.ts`.

```ts
// ── Workspace ───────────────────────────────────────────────

export interface WorkspaceRef {
  root: string;                       // absolute directory path
}

export type TreeEntryKind =
  | "directory"
  | "document"                        // Markdown or HTML — REX can render it
  | "other";                          // present, listed, not openable

export interface CommentCounts {
  open: number;
  resolved: number;
  orphaned: number;
}

export interface TreeEntry {
  name: string;
  path: string;                       // absolute
  kind: TreeEntryKind;
  children: TreeEntry[];              // empty for files
  /** Present only for a document REX has threads for. */
  comments: CommentCounts | null;
  /** Why this entry cannot be opened. Null for directories and documents. */
  disabledReason: string | null;
}

export interface WorkspaceTree {
  root: string;
  entries: TreeEntry[];
  /** True when the scan hit a limit in §4.2 and the tree is incomplete. */
  truncated: boolean;
}

// ── Reference graph ─────────────────────────────────────────

export type GraphNodeKind =
  | "document"                        // a renderable file inside the workspace
  | "external"                        // a file that exists outside the workspace
  | "missing";                        // a link target that does not exist

export interface GraphNode {
  id: string;                         // absolute path
  label: string;                      // path relative to the workspace root
  kind: GraphNodeKind;
  inDegree: number;                   // distinct documents linking here
  /**
   * Total incoming links, which is not the same number and is the one that
   * finds a hub: in a small corpus where everything cites everything,
   * in-degree saturates and stops discriminating.
   */
  inLinks: number;
  outDegree: number;
  comments: CommentCounts | null;
}

export interface GraphEdge {
  source: string;                     // GraphNode.id
  target: string;
  count: number;                      // how many links, not how many targets
  /** Section fragments used, e.g. "phase-3-building-autonomous". */
  fragments: string[];
}

export interface BrokenLink {
  from: string;                       // absolute path of the linking document
  href: string;                       // exactly as written in the source
  line: number | null;                // 1-indexed, when the format gives it
}

export interface ReferenceGraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  brokenLinks: BrokenLink[];
  /** Links to http(s)/mailto, counted but not drawn (§5.3). */
  externalUrlCount: number;
  /** Links to files that exist but are not documents (§5.3). */
  assetLinkCount: number;
}
```

---

## 4. The explorer

### 4.1 What is a document

The same test spec 01 §5.2 already uses: `.md`, `.markdown`, `.mdown`, `.mkd`,
`.html`, `.htm`, `.xhtml` are `document`. Everything else is `other`.

An `other` entry is **listed, shown greyed, and not clickable**, carrying
`disabledReason`. Hiding it would be worse: a reviewer needs to see that a PDF
is sitting in the folder even though REX cannot open it. The reason text is
spec 01 §5.2's — tier 3 is not scheduled — not a generic "unsupported".

### 4.2 Scanning, and refusing to scan forever

A workspace can be a whole repository. The scan therefore:

1. **Skips a denylist of directories outright**: `.git`, `node_modules`,
   `out`, `dist`, `build`, `.vite`, `.next`, `target`, `__pycache__`,
   `.venv`, `venv`, `release`, `releases`.
2. **Stops at depth 12.**
3. **Stops at 5,000 entries.**

> [!important]
> When a limit is hit, `WorkspaceTree.truncated` is true and **the UI says so**.
> A silently truncated tree reads exactly like a complete one, and a reviewer
> who cannot see a file assumes it does not exist.

Symlinks are not followed. Dotfiles other than the denylisted directories are
shown — a reviewer's `.github/` is real content.

The scan is eager and synchronous in main. On a docs tree this is a few
milliseconds; the limits above are what keep it that way on a repository.

### 4.3 Comment counts

For every `document` entry, `comments` is the aggregate over that document's
threads:

- `open` — threads with `status = 'open'` whose `anchor_state` is not `'orphaned'`
- `resolved` — threads with `status = 'resolved'`
- `orphaned` — threads whose `anchor_state = 'orphaned'`, whatever their status

A document REX has never seen has `comments: null` and shows no badge — which
is different from a document with zero comments, and the tree should not
pretend otherwise.

The counts come from one grouped query over `thread` joined to `document`, not
one query per file.

### 4.4 Behaviour

- Clicking a `document` opens it exactly as `doc:open` does today, replacing
  the centre pane. Its threads load, its anchors resolve, its highlights paint.
- Directories expand and collapse. Expansion state is per session and is not
  persisted.
- The workspace itself is **not** remembered between launches. Opening REX with
  no arguments opens nothing.
- `rex <file>` (spec 01's command line) still opens a single document with no
  workspace. `rex <directory>` opens it as a workspace.

---

## 5. The reference graph

### 5.1 Extracting links

Per format, and the method matters:

**Markdown** — parse with the `markdown-it` instance that already renders the
document (spec 01 §5.3) and walk the token stream for `link_open`, reading
`href` from the token's attributes. Not a regular expression: the token stream
already knows that a link inside a fenced code block is not a link, and a
regex does not.

The line number for a broken link comes from the enclosing block token's
`map[0] + 1` — the same source of truth `data-src-line` uses.

**Wikilinks** — `[[Target]]` and `[[Target|label]]` are extracted from text
tokens by pattern, since `markdown-it` has no concept of them. `Target`
resolves by basename against the workspace's documents; an ambiguous basename
resolves to the shallowest match, and ties are left unresolved and reported as
broken. None appear in the corpus this was designed against, so this path is
small on purpose.

**HTML** — `href` attributes, by pattern. This is a navigational aid rather
than a correctness-critical component, and the alternative is a DOM parser in
main, which spec 01 §5.4 already declined for exactly this reason.

### 5.2 Resolving a link target

```text
resolveTarget(fromFile, href) →
  1. strip and remember the "#fragment"
  2. if href is empty after stripping     → same-document link, ignore
  3. if href has a scheme (http, https, mailto, …)
                                          → count as an external URL, no node
  4. path = resolve(dirname(fromFile), decodeURI(href))
  5. if path exists and is inside root    → "document" node
     if path exists and is outside root   → "external" node
     if path does not exist               → "missing" node + a BrokenLink
```

A link to a directory resolves to that directory's `index.md` or `index.html`
if one exists, and is broken otherwise.

### 5.3 What is and is not drawn

- `http(s)` and `mailto` links are **counted, not drawn**. A docs corpus cites
  dozens of URLs and drawing them buries the structure the graph exists to
  show. The total appears as a figure beside the graph.
- **Links to files that are not documents** — a PDF, an image — are counted the
  same way and not drawn. The graph is of how *documents* reference each other,
  and an asset is a different relation.

  > [!important]
  > This is also a consistency requirement, not only a tidiness one. §4.1 has
  > the explorer list such a file greyed and unopenable; a graph node for the
  > same file would be clickable and would fail to open. Two views of one
  > workspace must not disagree about what can be opened.
- Files outside the workspace root that exist **are** drawn, as `external`.
  They are a real dependency of the corpus — `../../comparison.html` in the
  reference corpus is exactly that case.
- Missing targets **are** drawn, as `missing`, and also listed. A broken link
  in a document under review is a review finding, not a rendering nuisance.

### 5.4 Edges

One edge per ordered pair of nodes, with `count` for how many links it
represents and `fragments` for the distinct section anchors used. Four links
from A to B is one edge with `count: 4`, not four edges — otherwise a hub
document becomes an unreadable bundle.

Self-links are dropped.

### 5.5 Review data on the graph

This is what makes it REX's graph rather than a generic one.

| Visual | Driven by |
|:--|:--|
| Node radius | `comments.open` — where the unfinished discussion is |
| Node fill | `orphaned > 0` → warning; `open > 0` → accent; otherwise muted |
| Node outline | `missing` nodes are drawn dashed, in the danger colour |
| Edge thickness | `count` — a document cited seven times from one place must be visibly heavier than one cited once, not subtly so |

A node with orphaned anchors is a document REX's own Apply has edited out from
under its comments (spec 01 §6.6). Seeing those clustered is useful.

### 5.6 Layout

`d3-force`, with a link force, a many-body charge, a centring force, a weak
pull toward the origin, and a collision force sized to the *label* rather than
the node — labels are several times wider than the circles they sit under, and
a collision radius that only clears the circle still overlaps the text.

The simulation runs a fixed number of ticks **before the first paint**, so the
view opens framed and still, and then stays alive rather than being discarded:
a drag reheats it (§5.7).

Pan and zoom are a `viewBox` transform. Wheel handling must be attached
imperatively with `{ passive: false }` — React registers `wheel` listeners as
passive, where `preventDefault()` is ignored and logs on every notch.

### 5.7 Interaction

**Selection is one idea shared by both views.** The explorer and the graph show
the same selected document, whichever one it was chosen in. Selecting is not
the same as opening:

| Doing this | Selects | Opens | Changes the centre pane |
|:--|:--|:--|:--|
| clicking a file in the explorer | ✓ | ✓ | no |
| clicking a `document` node | ✓ | ✓ | no — the graph stays up |
| clicking an `external` or `missing` node | ✓ | — | no |
| double-clicking a `document` node | ✓ | ✓ | yes, to the document |

A single click on a node must **not** switch away from the graph. The point of
selecting a node is to see what it connects to, and a view that navigates away
destroys the thing the click just asked for.

**Selecting lights the neighbourhood.** The selected node is outlined, the
nodes it links to or from are outlined more lightly, everything else is faded,
and the edges touching the selection are drawn in the accent colour while the
rest drop to a fraction of their opacity.

**Dragging a node moves the graph.** Pressing on a node pins it with `fx`/`fy`,
raises `alphaTarget`, and restarts the simulation, so the neighbours follow;
releasing clears the pin and lets it settle. The dragged node's `x`/`y` are set
directly as well as pinned, so it tracks the pointer rather than waiting for
the next tick.

> [!note]
> The simulation's timer is `requestAnimationFrame`, which browsers stop
> entirely while a window is hidden or on another desktop. A drag in that state
> still moves the node it is holding — that is what the direct `x`/`y` write is
> for — and the rest of the graph catches up when the window is visible again.

**Panning must not fight dragging.** A press that lands on a node stops
propagating, so the canvas never starts a pan underneath a node drag.

### 5.8 Resizable panels

Every vertical divider is draggable: the explorer, the comments column, and the
graph's own side panel. Each has a minimum and a maximum, is a `separator` for
assistive technology, and responds to arrow keys as well as to a pointer —
a divider that only a mouse can move is not a divider everyone can move.

Widths last for the session and are not persisted, for the same reason §10
gives for the workspace itself.

---

## 6. User interface

The shell becomes three columns, all still inside the one shadow root
(spec 01 §7):

```text
┌────────────┬────────────────────────────┬──────────────┐
│ Explorer   │ Document  ·or·  Graph      │ Comments     │
│ (§4)       │ (spec 01 §7 ·or· §5)       │ (spec 01 §7) │
└────────────┴────────────────────────────┴──────────────┘
```

- The explorer is present only when a workspace is open, and is collapsible.
- The centre pane has a **Document / Graph** toggle in the top bar. The graph
  is a view of the workspace, not of the open document, so it survives
  switching documents.
- The comments column is unchanged.

---

## 7. IPC additions

Added to `src/shared/channels.ts`. All are commands; the graph and tree are
computed on demand and pushed by nothing.

| Channel | Direction | Request | Response |
|:--|:--|:--|:--|
| `workspace:pick` | → main | — | `WorkspaceRef \| null` |
| `workspace:tree` | → main | `WorkspaceRef` | `WorkspaceTree` |
| `workspace:graph` | → main | `WorkspaceRef` | `ReferenceGraph` |

`doc:initial` (spec 01's command-line document) gains one behaviour: when the
path names a directory it returns a `WorkspaceRef` instead of a `DocumentRef`.

---

## 8. Where the code goes

```text
src/
├── main/
│   ├── workspace/
│   │   ├── tree.ts          §4 — scan, denylist, limits, comment counts
│   │   ├── links.ts         §5.1, §5.2 — extract and resolve
│   │   └── graph.ts         §5.3, §5.4 — nodes, edges, broken links
│   └── ipc.ts               +3 handlers (§7)
└── renderer/overlay/
    ├── Explorer.tsx         §4 — the tree
    └── GraphView.tsx        §5.6 — d3-force + SVG
```

`links.ts` must not import from `graph.ts`, so that link extraction can be
tested on its own — it is the half of this feature that has a right answer.

---

## 9. Milestones

### Milestone 9 — the explorer

Open a directory, render the tree, swap documents from it.

**Accept when:**

1. Opening `~/Projects/Github/redhat/ProtoBot/docs` shows all 8 documents
   under `architecture/` and `review/`, and `.git` and `node_modules` are
   absent from the tree.
2. A document with threads shows its open / resolved / orphaned counts, and
   those counts match `SELECT` on the database.
3. Clicking a document opens it, its comments load, and its anchors resolve —
   verified by the highlights landing on the same text as before the swap.
4. Swapping from document A to B and back to A leaves A's anchors resolving
   exactly as they did the first time. No leaked highlight registry, no
   stale gutter markers.
5. A non-document file is listed, greyed, not clickable, and states why.
6. Pointing the explorer at a large repository either completes or reports
   `truncated` — it never silently shows a partial tree.

### Milestone 10 — the reference graph

**Accept when**, against the same `docs` folder:

1. The graph shows **8 document nodes and 1 external node**
   (`comparison.html`, which lives outside the folder).
2. `open-questions.md` is ranked **first by incoming links**, with 19, and the
   graph makes that visible without counting by hand.

   > [!warning]
   > Not in-degree. Measured on this corpus: the five `architecture/*.md`
   > documents all cite each other, so in-degree is 4 for every one of them and
   > the hub is invisible. In-degree saturates in a small densely-linked
   > corpus; total incoming links does not. Both are on `GraphNode`, and the
   > ranking uses `inLinks`.
3. Section fragments such as `user-interaction-flow.md#phase-3-building-autonomous`
   resolve to the `user-interaction-flow.md` node and appear in that edge's
   `fragments`, rather than creating a second node.
4. `http(s)` links are counted in `externalUrlCount` and appear as no node.
5. Deleting a linked file and reloading turns its node `missing` and lists
   every link to it in `brokenLinks`, with the line number of each.
6. Clicking a document node opens it in the centre pane.
7. A document with an orphaned anchor is visibly distinguished from one
   without.
8. Selecting a document in the explorer marks that node selected, its
   neighbours as neighbours, and fades the rest; selecting a node marks the
   same file in the explorer. Neither view can show a different selection from
   the other.
9. Dragging a node pins it, moves it under the pointer, and moves its
   neighbours — verifiable by pumping the simulation when the window is hidden
   and `requestAnimationFrame` is therefore stopped.
10. Edges carry at least three visibly different thicknesses on a corpus whose
    reference counts differ.
11. Every divider resizes its panel by pointer and by arrow key, and stops at
    its minimum and maximum.

---

## 10. Non-goals

Deliberately not built. Each was considered.

| Not building | Why |
|:--|:--|
| Creating, renaming or deleting files from the tree | REX is a review tool; the one thing it may write is an Apply the user accepted |
| Watching the filesystem for changes | A reviewer's document changes under them rarely; a reload button is honest and a watcher is a lifecycle problem |
| Multiple workspaces, or tabs | §1 — one window, one document, for the resolver's sake |
| A graph of headings or sections | The unit of a comment is a document; a section graph is a different product |
| A backlinks panel | The graph already answers "what points here"; two views of one fact is two things to keep correct |
| Persisting the last workspace | Explicitly declined — REX opens where you point it |
| Caching the graph in SQLite | It is milliseconds on any corpus this is for. Cache when that stops being true, not before |
| Full-text search over the tree | `message_fts` exists for comments; searching documents is the editor's job |
