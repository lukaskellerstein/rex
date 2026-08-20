# REX shell redesign — design sources

The artboards behind the **Workbench** redesign of the REX shell. These files
are the source of truth; the published canvas is built from them and can always
be rebuilt.

Nothing here ships. It is a design record you can edit, extend and re-publish.

## Pages and artboards — not the same thing

Two words that both sound like "page":

- An **artboard** is one `.dc.html` file: one screen, drawn once. There are
  eleven.
- A **page** is a tab in the canvas's page menu, holding as many artboards as
  you like. There are four.

So a page is a grouping, not a file — the Screens page holds five artboards
because REX has five states worth drawing. **There is no entry file per page.**
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
├── cards/               the comment card, explored
└── system/              tokens, controls, states
```

| Page | Artboard | Shows |
|:--|:--|:--|
| Screens | `screens/Main.dc.html` | Document open, one thread expanded. Entry artboard. |
| Screens | `screens/Threads.dc.html` | The comment list, filters working. |
| Screens | `screens/Compose.dc.html` | Selection → Ask, and the thread mid-flight. |
| Screens | `screens/Graph.dc.html` | The reference graph and its side panel. |
| Screens | `screens/Apply.dc.html` | The Apply diff gate, and the re-anchor result. |
| Selection | `selection/Hover.dc.html` | Hovering to pick an element, path bar, anchor strength. |
| Selection | `selection/Escalate.dc.html` | Widening a text selection to cell, row, table. |
| Selection | `selection/Region.dc.html` | Figures, and dragging a region inside one. |
| Selection | `selection/Kinds.dc.html` | The five anchor kinds — the implementation reference. |
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

## Open questions the design raises

Each of these needs a call before it can be built.

- `anchorStateFor()` reports `moved` for everything below layer 1, so every
  element anchor would show amber on an untouched document. Proposal: report
  `ok` for a layer-3 match via a stable id on an unchanged document, keep
  `moved` for `css`-path-only matches.
- A region anchor is geometry. Redraw a chart and it still resolves, onto
  different content, reporting success. Proposal: fingerprint the element's
  rendered content on `RegionRef` so a changed figure reports `orphaned`.
- Element and region picking needs `anchorFromElement()` and
  `anchorFromRegion()` on `DocumentSurface`. The anchor creation and resolution
  already exist in `src/renderer/anchor/`.
- PDF and DOCX cannot be selected because they cannot be opened — tier 3, not
  scheduled. Every anchor kind here works on a DOM and does not care where the
  DOM came from.
- Bundling the two typefaces adds roughly 400 KB to the app.
- The workspace tree's selected-file marker is untouched, and is the one place
  a left-edge accent survives.

## Not drawn yet

The empty state, the truncated-tree warning, the URL-open path, and the
synthesis-thread builder. All inherit the tokens on the System page.
