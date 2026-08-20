# REX

*Review EX* — a desktop app for commenting on documents and discussing each
comment with an AI agent. Third in the family after **VEX** and **DEX**.

Select text → write a comment → **Ask**. One agent answers that one comment.
Keep chatting in the thread. When the discussion concludes, **Apply** lets a
second, write-capable agent make the change in the source document.

Comments persist. Reopening a document shows every comment, open and resolved,
still attached to the right place in the text — even after the document has
been edited underneath them.

Open a **folder** instead of a file and REX shows an explorer down the left,
with each document's comment counts beside it, and a **reference graph** of how
the documents link to each other — with the review data drawn on top, so it
shows where the unfinished discussion is.

The specs are the authority on everything below:
[01 — the app](docs/my-specs/01-initial/SPEC.md),
[02 — workspace and graph](docs/my-specs/02-workspace-and-graph/SPEC.md).

## Running it

```bash
npm install                # postinstall is not used; rebuild explicitly
npm run rebuild            # better-sqlite3 against Electron's ABI
npm run build
npx electron .             # empty
npx electron . doc.md      # one document
npx electron . docs/       # a folder, as a workspace
```

`npm run dev` runs the same app through electron-vite with hot reload.

Comments live in `~/.rex/rex.db` — outside every repository, so they can never
be committed by accident.

## Commands

| Command | What it does |
|:--|:--|
| `npm run dev` | electron-vite dev server |
| `npm run build` | build main, preload and renderer into `out/` |
| `npm run rebuild` | rebuild `better-sqlite3` for the current Electron |
| `npm run typecheck` | `tsc --noEmit` over everything |
| `npm run test:anchor` | the milestone 0 anchor gate, against two real documents |
| `npm run test:gate` | the read profile's deny gate |
| `npm run test:links` | link extraction and resolution, for the graph |
| `npm run export -- <doc>` | a document's threads as Markdown (`--json`, `--out`) |

## The tests, and why these ones

They cover the components that **fail silently** — where a regression looks
exactly like working code until a human notices something wrong.

**`test:anchor`** resolves ten anchors across
`2026-08-20-architecture-explained.html` and `components.md`, applies three
realistic edits (insert a paragraph, reword a sentence, delete a section), and
re-resolves. It does not assert that resolution *succeeded* — it prints what
each anchor landed on and fails when an anchor reports success while sitting on
text it was never created from. A comment that quietly moves to the wrong
paragraph is the failure mode this exists to catch.

**`test:gate`** checks that a `read` agent cannot write, against the write
vectors spec 01 §8.4 names — `python -c`, `tee`, `sh -c`, a plain redirect —
and against redirects appended to otherwise-allowed commands.

**`test:links`** checks the half of the reference graph that has a right
answer. A link inside a fenced code block is not a link, a reference-style link
resolves to its definition, a fragment does not create a second node, and an
ambiguous wikilink is reported rather than guessed at. The drawing is judged by
eye; this is judged by assertion.

## Architecture

Electron, two processes, talking over IPC only. Three invariants shape
everything (`SPEC.md` §3):

| # | Invariant |
|:--|:--|
| I1 | The anchor resolver runs **in the renderer, on the live DOM**. Main stores anchors and never resolves them. |
| I2 | Only main touches SQLite and the Agent SDK. The renderer displays untrusted document content. |
| I3 | Commands are `ipcRenderer.invoke`; agent output is `webContents.send`. No HTTP server, no broker, no listening port. |

```text
src/
├── main/        SQLite, the Agent SDK, document renderers, Apply
│   └── workspace/  the folder scan and the reference graph
├── renderer/    the document view, the shadow-root overlay, the anchor resolver
├── preload/     the contextBridge surface, and the tier 2 webview resolver
├── shared/      types.ts and channels.ts — the contract between the two
└── cli/         rex export
```

## Anchoring

A CSS selector breaks the instant a paragraph is inserted above it, and REX
ships a feature that edits documents — so anchors are invalidated by the tool's
own normal operation. Anchors therefore degrade in layers (`SPEC.md` §6):

| Layer | Resolves by | Survives |
|:--|:--|:--|
| 1 | the quoted text, disambiguated by its surrounding 32 characters | reflow, restyling, most edits |
| 2 | a bounded fuzzy search, verified over the whole quote | small rewordings |
| 3 | an element's identity — its id, or a selector built from what identifies it | images, SVG, anything with no text |

When every layer fails the thread is **orphaned**, which is a normal outcome
rather than an error: it keeps its note and its original quote in the orphan
tray. Nothing is ever deleted, and nothing is ever silently re-attached
somewhere else.

Highlights are painted with the CSS Custom Highlight API and the stylesheet is
adopted rather than inserted, so the document under review is never mutated —
no `<mark>`, not one node.

## The reference graph

Links come out of `markdown-it`'s token stream rather than a pattern, so a link
inside a code fence is not counted and a reference-style link resolves to its
definition. HTML uses a pattern, which is honest for a navigational aid.

What is drawn, and what is only counted:

| | |
|:--|:--|
| a document in the workspace | drawn |
| a document outside it that exists | drawn, as `external` |
| a link target that does not exist | drawn as `missing`, and listed as a broken link with its line |
| `http(s)` and `mailto` | counted — drawing them buries the structure |
| a PDF, an image, any non-document | counted — the explorer will not open it, so the graph does not offer to |

Node size is the count of open comments and colour is their state, so the graph
shows where review attention is concentrated and which documents REX's own
Apply has orphaned anchors in. Edge thickness is how many times one document
references another.

Selection is one idea shared by both views: pick a file in the explorer and its
node lights up with everything it links to; pick a node and the explorer follows
it. A single click never navigates away from the graph — seeing the connections
is what the click asked for — so double-click opens the document instead.

The simulation stays live. Drag a node and its neighbours follow, drag the
background to pan, scroll to zoom, and **fit** re-frames.

Ranking is by **total incoming links**, not in-degree. Measured on a real docs
folder: five documents that all cite each other have an in-degree of 4 apiece
and the hub is invisible, while link count puts it first with 19.
