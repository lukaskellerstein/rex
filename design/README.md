# REX shell redesign — design sources

The artboards behind the **Workbench** redesign of the REX shell. These files
are the source of truth; the published canvas is built from them and can always
be rebuilt.

Nothing here ships. It is a design record you can edit, extend and re-publish.

## Four things here are proposals, not records

Everything else on these boards is drawn from the code as it stands. These four
are not. Nothing in `src/` was changed for any of them, and spec 05 has not been
amended.

### 1. The sidebar is two tabs

The app still stacks the selection panel above the comments, which is what spec
05 §3 and §3.3 ask for. The boards draw them as `Selection` and `Comments` tabs
instead, because stacking them read as one confusing column.

What it costs, stated plainly: §3.3 put the panel above the comments so that
"the comments are how you check you are not asking something already asked".
Tabs hide them while you build a selection, and a count on the tab does not
replace reading them. What it buys: the selection list stops needing its `34vh`
cap — that cap existed only to stop twenty places pushing the comments off the
bottom — and the note and `Ask` sit at the foot of a full column. The places
themselves stay outlined in the document either way, so switching to Comments
loses the list, not the marks.

**The bar is on every screen that shows the comments column**, whatever is in
it. An empty selection dims the tab and reads `0`. A control that comes and goes
is its own kind of confusing, which is the fault this set out to fix.

### 2. Pick element is not in the top bar

It was the only **mode** in a row that otherwise holds facts about the document
and actions on it. It now sits at the foot of the paper as a quiet chip reading
`⌥ pick element`, in the same strip the path bar uses: hold `⌥` (250ms) or press
`P` and that strip becomes the path bar. One place, one meaning, and the mode
control sits where the mode acts. Nothing else changed — `P` and `⌥` are the
same keys the code already binds.

> **`ctrl` cannot be the key, on macOS.** `ctrl`-click *is* a right-click; the
> OS takes the gesture before the page sees it. That is fault 1 of spec 05 §1
> and the reason §3.1 carries a warning against a held modifier. It is the
> *hold plus click* that dies, not the key — a tap of `ctrl` as a toggle would
> work, but that is only a second `P`, on a key that is half of many chords.
> `⌥` is free precisely because ⇧, `ctrl` and `⌘` stopped being selection
> modifiers and `⌥` never was one.

### 3. The chat, split by what the content needs

The card in the sidebar shows a flat run of paragraphs and one collapsed
monospace row. It becomes:

- a **meta strip** — `read · 2 turns · 6 steps · 12.4s · $0.031`, with the read
  profile's shield;
- **turns as blocks** — yours dim and ruled, the agent's body text at full
  contrast;
- a **step strip** — one neutral bar per tool call so the shape of the run reads
  at a glance, `1 denied` in red beside it, and `show trace ›`.

The machinery moves to a **sheet over the document pane** — `screens/Trace.dc.html`.
Bash lines, paths and diffs are wide, and 384px wraps them into mush; that is
what Vex's per-tool renderers exist to avoid. The sheet covers the document and
nothing else, so the comment card stays beside it and you always see which
comment you are auditing. `esc` closes it.

It is a sheet rather than a third `Document | Graph | Trace` centre: that segment
is a **workspace** switch and a trace belongs to one comment, so the button would
come and go and leaving it would need a decision. Apply's review bar settled the
same question the same way.

The reasoning in one line, and it is REX's own: **the answer outranks the
machinery.** An answer is about a passage, so it stays beside the passage. The
machinery has nothing to do with the document being on screen, so it is the only
part worth leaving the document for.

Colour in the trace distinguishes **kind**, and invents no meanings: steel is you
and the answer, neutral is machinery, faint is thinking, red is the
write-capable agent being refused.

**No new data is needed.** `Message` already stores `costUsd`, `durationMs`,
`inputTokens`, `outputTokens`, `createdAt` and `seq`; `Thread` already stores
`profile`, `model` and `sessionId`. And `thinking`, `diff` and `completed`
messages are stored today and **thrown away** — `conversation()` in
`CommentCard.tsx` keeps only `text` and `error`. Thinking is drawn in the trace
and nowhere else.

### 4. A comment can take you to its places

A comment card gains `go to ›` beside its documents line: it opens the document
of its **first** place and scrolls there. Below it, every place is a row you can
point at — the row lights, and its mark in the document takes the same number,
in the violet the open comment is painted in. A place in a document that is not
open has nothing to light; that row says which document it is in and opens it.

This is what makes a workspace-wide comment list usable: a comment you can read
here may be about a document that is not on screen, and a gutter marker can only
reach the one that is.

It needs no new plumbing. `doc:open` and `scrollToAnchor` are what the selection
panel already uses, including the wait-for-the-DOM step in `onSurfaceReady` that
makes the cross-document jump work, and `repaintActive()` already paints the open
comment violet.

Affected boards: `screens/Main.dc.html`, `screens/Threads.dc.html`,
`screens/Select.dc.html`, `screens/Apply.dc.html`, `selection/Hover.dc.html`,
`selection/Escalate.dc.html`, `selection/Region.dc.html`, and the control on
`system/Components.dc.html`.

## Pages and artboards — not the same thing

Two words that both sound like "page":

- An **artboard** is one `.dc.html` file: one screen, drawn once. There are
  thirteen.
- A **page** is a tab in the canvas's page menu, holding as many artboards as
  you like. There are five.

So a page is a grouping, not a file — the Screens page holds six artboards
because REX has six states worth drawing. **There is no entry file per page.**
The one special name is `Main.dc.html`, the entry artboard for the *document*,
used when the canvas opens focused on a single board rather than on the canvas.

The subfolders below mirror the pages so the tree is browsable, but
`canvas.json` is the authority: an artboard's `page` field decides where it
appears, and moving a file between folders changes nothing on its own. If
someone re-pages an artboard in the editor, move the file to match.

## Layout

```text
design/
├── canvas.json          pages, positions, sticky notes, launch page
├── screens/             the app doing its job
├── selection/           how you point at something
├── document/            the paper REX draws documents on
├── cards/               the comment card, explored
└── system/              tokens, controls, states
```

| Page | Artboard | Shows |
|:--|:--|:--|
| Screens | `screens/Main.dc.html` | Document open, one thread expanded. Entry artboard. |
| Screens | `screens/Threads.dc.html` | The workspace-wide comment list, filters working. |
| Screens | `screens/Select.dc.html` | The selection panel: three places, two documents, Ask. |
| Screens | `screens/Graph.dc.html` | The reference graph and its side panel. |
| Screens | `screens/Apply.dc.html` | The Apply review bar over the changed document, and the re-anchor result. |
| Screens | `screens/Trace.dc.html` | How the agent got there — the trace, over the document pane. |
| Selection | `selection/Hover.dc.html` | Hovering to pick an element, path bar, anchor strength. |
| Selection | `selection/Escalate.dc.html` | Widening a text selection to cell, row, table. |
| Selection | `selection/Region.dc.html` | Figures, and dragging a region inside one. |
| Selection | `selection/Kinds.dc.html` | The five anchor kinds — the implementation reference. |
| Document | `document/Paper.dc.html` | Markdown rendered: alerts, code, tables, figures, maths. The paper palette. |
| Cards | `cards/Cards.dc.html` | Four comment-card treatments; **C · Wash** is the one built. |
| System | `system/Components.dc.html` | Tokens, type ramp, metrics, controls, anchor states. |

## Working on it

The canvas is assembled by the `design` skill in Claude Code, which wraps these
files in the Claude Design editor and publishes the result as an Artifact.

- To change a screen, edit its `.dc.html` and re-seed. Never hand-edit the
  published output — it is a 2.4 MB bundle and is regenerated every time.
- To add a screen, write a new `.dc.html` in the right folder, add it to
  `canvas.json`, re-seed.
- To add a page, add it to `canvas.json`'s `pages`, give the new artboards that
  `page` id, and make a folder to match.
- To move things around, edit `canvas.json` alone.

**The mark is a real image, not a letter in a box.** Every screen's top bar
carries `docs/logo/mark/rex-mark-color-128.png`, exactly as `TopBar.tsx` does —
the kit is the one source of truth for the brand. It is passed to the seeder as
`--image docs/logo/mark/rex-mark-color-128.png` and referenced from the artboards
by its bare filename. It is the only image in the canvas; everything else is
drawn.

**Folders are passed as paths; `canvas.json` uses bare filenames.** The seeder
flattens `--artboard selection/Hover.dc.html` to `Hover.dc.html`, which is the
artboard's identity in the published canvas — so stems must stay unique across
every folder, and `canvas.json` must never carry a directory in its `file`
field. Verified by rebuilding: the subfolder layout produces a canvas
byte-identical to the flat one.

Run `/design` and ask for the canvas to be rebuilt from `design/`. The skill
supplies its own seeding helper and template; the paths are session-local, so
there is no build script to keep here.

The published canvas lives at
`https://claude.ai/code/artifact/f8bf24e6-58a3-4b8b-afa8-484725bdbd71` — private
to its owner. Hand that URL to `/design` when re-publishing, or a new artifact
is created beside it instead of the existing one being updated.

The seeded canvas is deliberately **not** committed: 2.4 MB of bundled editor
code against 240 KB of sources, and it is fully derived.

## The `.dc.html` format, briefly

Enough to edit one without rediscovering the rules.

- Keep the `<script src="./support.js">` head line exactly — the editor swaps in
  its runtime there.
- Page content goes inside `<x-dc>`; `<helmet><style>` holds anything that must
  be a stylesheet, including the Google Fonts link.
- Prefer inline `style="…"` over classes: the editor's properties panel edits
  inline styles, so that is what stays adjustable by hand later.
- `{{ name }}` binds a value from `renderVals()` in the `<script data-dc-script>`
  block. Attribute and style bindings are fine; **avoid text bindings** — the
  editor shows the binding, not the value, so copy becomes uneditable. Use
  `<sc-if>` with literal text instead, which is why several boards carry paired
  `<sc-if>` blocks that differ only in wording.
- `<sc-if value="{{ flag }}" hint-placeholder-val="{{ true }}">` branches;
  `<sc-for list="{{ xs }}" as="x">` repeats. Always set the `hint-*` attribute.
- Events are JSX-cased whole-value attributes: `onClick="{{ handler }}"`.
- Logic is plain classic JS, `class Component extends DCLogic`, no imports.

## Decisions these files encode

Changing any of these changes the design, not just a pixel.

- **Colour means state.** Steel `#2f5da8` ok, amber `#f0b429` moved, red
  `#d2402f` orphaned, green `#4a9d7a` resolved. The mark's red is spent only on
  a lost anchor and on the write-capable agent.
- **Violet `#7a4fa3` is the one exception, and it outranks state.** The passages
  of the comment whose card is open are painted violet in the document
  (`activeBg #ece1f7`). A reviewer with a card open is asking "where is this
  one?", not "what state is it in" — the card already says the state in words.
  It is a fourth colour rather than a brighter blue because the selection panel
  can be half-built at the same time, and its places are blue.
- **Cards carry their state as a wash** with a matching border, and selection
  deepens that same wash rather than changing hue. Full pairs are on the System
  page.
- **The answer outranks the machinery.** Tool steps collapse to one row and keep
  a monospace register when opened; a denied write stays visible in red.
- **IBM Plex Sans and Plex Mono** for chrome, **Newsreader** for quoted document
  text only, so a quote never reads as REX's own voice.
- **The document measure (620px at 15/1.68) applies only to Markdown REX renders
  itself.** Sanitised author HTML and `<webview>` URLs keep their own styles —
  the design must survive a document looking like anything at all.
- **The sidebar does one job at a time.** `Selection` and `Comments` are two
  tabs, drawn with the same segmented control the top bar uses for
  Document / Graph — REX has one control that means "switch what this pane
  shows", and this is the same kind of choice. The bar is always there, on every
  screen that shows the comments column; an empty selection dims its tab and
  reads `0`. Each tab carries its own count. `clear` sits **inside** the
  Selection tab, not beside the tabs: it acts on the selection only, so it lives
  with the selection, and it stays away from `Ask` at the foot — a destructive
  action next to the primary one is a slip waiting to happen. **Proposed, not
  built** — see the top of this file.
- **A mode control belongs where the mode acts.** `Pick element` left the top
  bar for the foot of the paper, in the strip that becomes the path bar the
  moment pick mode is on. The keys are unchanged: `P` toggles, holding `⌥` for
  250ms turns it on while held. **Proposed, not built.**
- **The answer outranks the machinery — so they live in different places.** The
  sidebar keeps the conversation, beside the document it is about. The trace
  gets a sheet over the document pane, where a bash line can be read. The
  sidebar keeps a step strip so the shape of a run is visible without opening
  anything. **Proposed, not built.**
- **A comment points back at its places.** `go to ›` opens the first place's
  document and scrolls there; pointing at a place row lights it and draws its
  number on the mark in the document, in the open comment's violet. Across
  documents too — a place elsewhere has nothing to light, and its row opens the
  document instead. **Proposed, not built.**
- **Selecting is a phase, and it has a place on screen.** The panel accumulates
  by default and is gone when empty. It
  replaced a floating composer whose three faults were one fault: a transient
  card is the wrong home for something built up over time. **There is no held
  modifier and there must never be one** — on macOS ctrl-drag is a right-drag
  and the OS takes it before the page sees it.
- **The comment list is the workspace's, not the document's.** So every row and
  every card names the documents it is about, always, and a comment about two
  files is one row seen from either of them.
- **`not checked here` is not `orphaned`.** A target in a document that has not
  been open gets the muted grey the design uses for absence, never red, and is
  never counted as an orphan. An orphan means the text is gone; this means
  nobody looked.
- **Apply's changed sections are outlined in red, in the document.** Red is the
  second and last thing that colour is spent on. Mid-Apply a reviewer must not
  have to work out which marks are their own selection and which are the
  agent's edit, so the selection's blue is never used for a change.

## Open questions the design raised — and how they were settled

All four calls were taken and built. The record is here rather than in a commit
message because each changed the design, not just the code.

- **`anchorStateFor()` was reporting `moved` for everything below layer 1**, so
  every element anchor showed amber on an untouched document. Settled: a layer-3
  match reports `ok` when the element was found *by name* on an unchanged
  document, and `moved` only when it was found by a positional path.
  `resolveElement()` now reports which of the two it was.
  **Wider than the proposal**, deliberately: the proposal said "via a stable id",
  but `create.ts` prefers `aria-label`, `data-testid`, `name` and `title` over a
  positional path and verifies each matches exactly one element. Those name the
  element as surely as an id does, and every inline diagram in the test corpus is
  keyed that way — under the literal rule the whole Selection page would have
  shipped permanently amber.
- **A region anchor is geometry, so it always resolves.** Settled: `RegionRef`
  carries an optional `fingerprint` of the element's rendered content, and a
  mismatch reports `orphaned` with the comment and its quote kept. `test:anchor`
  has a case for it — a redrawn figure must orphan while its untouched
  neighbour still resolves — because this is the one kind that can fail
  silently. Its limit is recorded in `create.ts`: a raster replaced at the same
  URL and the same dimensions is not detected.
- **Element and region picking** are built. `DocumentSurface` gained
  `probeAt()`, `anchorFromScope()` and `anchorFromRegion()`, and the tier 2
  preload implements the same four calls so a `<webview>` picks identically.
  The outline, badge and marquee are drawn in the overlay over the pane, never
  on the document — REX does not mutate what it is reviewing, and §6.7 already
  refuses the same trick for highlights.
- **Bundling the typefaces** cost 152 KB, not 400: only the Latin subsets ship,
  at the five weights and one italic the design actually uses. They are loaded
  at document level, because `@font-face` inside a shadow root is ignored.

- **PDF and DOCX open now.** They were "tier 3, not scheduled" when these boards
  were drawn. DOCX goes through mammoth in main and takes the Markdown path;
  PDF is drawn by PDF.js in the renderer's own document and crosses into the
  iframe as an `<img>`, because Chromium never composites a `<canvas>` inside a
  frame sandboxed without `allow-scripts`. The explorer no longer greys either
  out. **Apply stays off for both** — there is no honest source line to write a
  prose edit back to — and a comment whose places include one still applies to
  the Markdown beside it, with the PDF named as skipped.

Still open, and unchanged by this pass:

- The workspace tree's selected-file marker is untouched, and is the one place
  a left-edge accent survives.
- `tbody` is walked through rather than offered as a scope. It is not a thing
  anyone comments on, and offering it put two chips reading "table" side by side.
- **The review bar's pencil sits in a 30px square filled with the same tint as
  the bar behind it** (`--write-bg` for both), so the square is invisible and
  only the pencil reads. Drawn as it is rather than as it was meant to be. It is
  a one-line fix in `overlay.css` if the square is wanted.

## Not drawn yet

The empty state, the truncated-tree warning, the URL-open path, the
synthesis-thread builder, and the comments column reappearing over the graph
while the selection panel holds something. All inherit the tokens on the System
page.
