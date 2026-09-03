# REX 29 — the parts of a diagram, and its source

**Version:** 1.1 · 2026-09-01
**Status:** **built, and driven in a live window.** Milestones 0–4 are in the
tree; `npm run test:diagram` is 14 tests green; §7.1 was run against an isolated
REX on port 9444 the same day, and §10 records the eleven places the build
departed from version 1.0 and the two steps it did not run.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §6.2 (the four
layers), §6.4 (what an anchor records), §6.5 (the order the layers are tried
in), §6.6 (orphaned is a normal outcome); [`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md)
§4.2 (the six rules of an enrichment pass), §4.3 (the DOM is final before the
surface is handed up), §5.8 (the Mermaid pass);
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md) §3.1
(every plain click adds), §4.1 (widening rebuilds the chain from the anchor);
[`06-document-section-and-pen/SPEC.md`](../06-document-section-and-pen/SPEC.md)
§4.1 (the wide end of the chain); [`10-figure-preview-and-exclusions/SPEC.md`](../10-figure-preview-and-exclusions/SPEC.md)
§2 (the lightbox), §2.2 (nothing in the document is mutated);
[`11-powerpoint/SPEC.md`](../11-powerpoint/SPEC.md) §5.2 (a fingerprint on an
id that is really an index); [`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md)
§8.4 (violet is the thing being pointed at); [`16-the-two-versions/SPEC.md`](../16-the-two-versions/SPEC.md)
§6 (a place read before the four layers, and the strictest resolution in REX);
[`24-pointing-mid-conversation/SPEC.md`](../24-pointing-mid-conversation/SPEC.md)
§3.1 (the duplicate rule); [`26-widening-a-place/SPEC.md`](../26-widening-a-place/SPEC.md)
§4.6 (the words a scope is offered in); [`27-width-and-dark-paper/SPEC.md`](../27-width-and-dark-paper/SPEC.md)
§4.5 (a diagram is redrawn when the paper changes, and the source is kept);
[`28-find-and-search/SPEC.md`](../28-find-and-search/SPEC.md) §5.2 (a redraw
collapses every `Range` inside the diagram); [`../FORMATS.md`](../../FORMATS.md)
§1 rule 3 (no manual editing of document content).

> [!note]
> **A diagram is its source.** Every decision below follows from one sentence:
> a Mermaid diagram is a piece of text that REX draws, and a comment on a part of
> it names that part **in the text**. The drawing is one view of the text and the
> source pane is the other. Both take places. Neither is where the place lives.
> §2 is the argument, §5.4 is what it costs, and §8's first row is what it
> replaces.

> [!note]
> **Nothing in the document is mutated, no channel changes, no schema changes,
> no new colour.** The anchor gains one optional field in the same JSON blob
> every other optional field rides in (§5.2). The source pane is REX's own chrome
> inside the lightbox (§4.2). Every colour is one spec 18 already has (§4.4).

---

## 1. Why

The reviewer's words, 2026-09-01:

> I would like to design a specification that will allow me, in the Rex, to add
> comments to the Mermaid diagrams. I should be able to see the source code or
> the text format of the Mermaid as well and be able to add comments to the
> specific parts of the Mermaid.

Two asks. **See the source**, and **comment on a part**. REX does neither today,
and what it does instead was measured on 2026-09-01 — in a headless Chromium,
with `pick.ts` bundled the way `test/anchor.spec.ts` bundles it, against a
seven-line flowchart drawn by mermaid 11.17.0 exactly as `mermaidPass` draws it.

### 1.1 What pick mode offers inside a drawing

Pointing at the node `B{Has comment?}` offers this chain, narrow to wide:

```text
p · Paragraph · fair
span · Line · “Has comment?” · fair
div · Block · fair
foreignobject · foreignobject · “Has comment?” · fair
g · g · “Has comment?” · fair
g#mermaid-5-svg-flowchart-B-1 · g · “Has comment?” · durable
section “A page”
document
```

Six of the eight scopes are the plumbing Mermaid draws a label with — a `<p>`
in a `<div>` in a `<foreignObject>` in two `<g>`s — and none of them is a thing
a reviewer means. The `<svg>` and the `<pre>` that holds the diagram never
appear: `MAX_SCOPES` is six, and six is spent before the walk reaches them.

Pointing at the edge `B -- yes --> C` lands on its label and offers the same six
words with `“yes”` in them. The edge itself — a two-pixel stroke — is never hit
and never offered. An edge with no label cannot be pointed at at all.

Pointing at the subgraph offers a `<g>` whose quote is
`“The engineyesnoReviewerHas comment?Ask agentRead onrex.db”`: every label in
the diagram, run together, because the labels sit in adjacent `<foreignObject>`s
with no whitespace between them and spec 01 §6.3 collapses what is not there.
That string is also what `⌘F` (spec 28) and a text quote see.

### 1.2 The one durable chip is not durable

`g#mermaid-5-svg-flowchart-B-1` reads `durable` because `isStableId` accepts
it, and `create.ts` stores it as `element.id`. Two things are wrong with it.

- **The id is a counter on some diagram types.** A sequence diagram's lifelines
  are `actor0` and `actor1` on the first render of a source and `actor2` and
  `actor3` on the second render **of the same source** — measured on
  2026-09-01: two calls to `mermaid.render` with identical text produced markup
  that differed at byte 895, and only there. Spec 27 §4.5 redraws every
  diagram when the paper changes, so an anchor on such an id is orphaned by the
  dark-paper switch. Flowchart and state ids are stable across two renders; the
  rule that says which kinds are and which are not is Mermaid's, not REX's.
- **The prefix is the fence's line.** `mermaid-5` is `id="mermaid-${line}"`
  (`markdown.ts`, spec 03 §5.8), so a paragraph inserted above the fence
  renames every id in the diagram. Spec 03 called the id "stable across
  reloads", and it is — of an unchanged file.

### 1.3 The agent is told nothing it can use

A place on a node reaches the agent as its label, `Has comment?`, with
`source.line = 5` — the fence's opening line, from the `<pre>`'s
`data-src-line`. That is findable, by luck: the label happens to be in the
source too. A place on an edge has no text, so `describeTarget` writes
`(no text — an element anchor: #mermaid-5-svg-L_B_C_0)`, which appears in no
file on the machine. And neither says the words *this is a node in a Mermaid
diagram*, so a reviewer who asks "why does this arrow go to C?" is asking about
a selector.

### 1.4 The source is not on screen

`mermaidPass` replaces the fence's text with the SVG and keeps the source on
`data-source` (spec 27 §4.5), where no reader sees it. The only time a reviewer
reads a diagram's source in REX is when Mermaid refuses to draw it (spec 03
§4.2 rule 3).

### 1.5 What REX already has

| Needed here | Already there | Since |
|:--|:--|:--|
| the source of every drawn diagram, kept beside the drawing | `block.dataset.source` | spec 27 §4.5 |
| the file line the fence starts on | `data-src-line` on `pre.rex-mermaid` | spec 03 §5.3, §5.8 |
| a place that is read **before** the four layers and resolved its own way | `extent`, `region`, `gap` | spec 06, 01, 16 |
| a content check that turns "still resolves" into "still the same" | `RegionRef.fingerprint`, `ElementRef.fingerprint` | spec 01, 11 §5.2 |
| a room where one figure is drawn large, in REX's own chrome | the lightbox | spec 10 §2 |
| a chain of scopes with words a reviewer chooses between | `pick.ts`, `SCOPE_WORDS` | spec 05, 26 §4.6 |
| a rule that refuses a duplicate place and needs a key for places the four nulls cannot tell apart | `isDuplicate`, `gapKey` | spec 24 §3.1, 16 §6.2 |
| a way to describe a place to the agent in words and lines | `describeTarget`, `locatePassage` | spec 06 §7.1, 16 §5.1 |

Nothing here needs a new process boundary, a new table or a new colour. What is
new is a **parser** for the text REX already keeps, a **map** from that text to
the drawing REX already draws, and a **pane** in a room REX already has.

---

## 2. The rule

> **A Mermaid diagram is its source. A comment on a part of one names that part
> in the source — a node, an edge, a subgraph, or a run of lines — with the lines
> it is stated on and their text. The drawing is a view of the source. So is the
> source pane. Places are taken in both and stored in neither.**

Three consequences, and they settle §5.2, §5.4 and §5.8:

1. **The anchor is text-shaped.** It records which fence, which part, which
   lines, what those lines said, and a fingerprint of the whole fence. It never
   records an SVG id. That is what makes it survive the dark-paper redraw, an
   insertion above the fence, and a Mermaid upgrade that renames every
   `<g>`.
2. **The drawing is a lookup, not an identity.** After each draw REX works out
   which SVG element each part became, from the ids Mermaid derives from the
   source (§5.5). A part the lookup cannot find in the drawing is **still a
   part** — it resolves, it reaches the agent, and it is outlined as the whole
   diagram until the lookup learns the shape. A drawing detail never orphans a
   comment about the text.
3. **The agent is told the part in the words of the source.** `the node B,
   labelled "Has comment?", declared on line 157: B{Has comment?}` — a sentence
   it can act on with the tools it has, in the file it may edit.

---

## 3. Changes to earlier specs

| Spec | Said | Now |
|:--|:--|:--|
| 01 §6.5 | Four layers, tried in order; `extent`, `region` and `gap` are read first. | A **fourth thing read first**: `diagram`. Read before `extent`, because a diagram part is narrower than any extent and never has one. §5.4. |
| 01 §6.4 | An anchor on an element records its id and CSS path. | An anchor on a **part of a drawn diagram** records the part in the source instead (§5.2). The `<pre>`'s own element ref is kept as the way to find the diagram, never the part. |
| 03 §4.2 rule 6 | Every element a pass creates with no text carries a stable id, so layer 3 can reach it. | Still true of the `<pre>`. **No anchor may bind to an id inside the drawing.** §1.2 is why, and §5.5 is what the ids are used for instead: a lookup, rebuilt on every draw. |
| 03 §5.8 | The pass replaces the fence's text with the SVG. | Unchanged. The pass writes nothing new into the document — the part map is computed in the renderer from the drawing, on demand, and stored nowhere in the DOM (§5.5). |
| 05 §3.1 | Every plain click in pick mode adds a place. | A plain click **in the lightbox's diagram view** adds a place too, by the same rule — on a part in the drawing, or on a line in the source. §4.2. |
| 10 §2.3 | The lightbox shows one figure, pannable and zoomable. | For a Mermaid drawing it shows the figure **and its source**, under a `Drawing · Source · Both` control, and takes places. §4.2. Every other figure is as it was. |
| 24 §3.1 | The duplicate rule compares document, extent, gap, element, quote and region. | It also compares **the diagram part**. Two nodes of one diagram share the same `<pre>` element ref and the same four nulls, exactly as two gaps did. §5.7. |
| 26 §4.6 | `SCOPE_WORDS` names cells, rows, tables, paragraphs. | Gains `node`, `edge`, `subgraph`, `lines` and `diagram`. §4.1. |
| 16 §5.1, 06 §7.1 | `locatePassage` finds a passage by its quote; `describeTarget` writes a quote or a selector. | Both gain a **diagram branch**: the part is located by its lines' text inside the fence, and described as a part. §5.8. |
| 01 §9, §10 | The schema; the channel list. | **Nothing moves.** `anchor_json` is a blob; the surface method is renderer-internal. |
| 18 | Seven meanings, seven colours; 28 adds an eighth. | **No new colour.** §4.4. |

---

## 4. What the reviewer does

### 4.1 Pointing at a part in the page

Pick mode — `P`, or ⌥ held — over a drawn diagram now offers the parts, and
nothing that is not one:

```text
node “Has comment?”  ›  subgraph “The engine”  ›  diagram  ›  section “A page”  ›  document
```

| Pointer over | Narrowest scope | Chip and crumb | Card title |
|:--|:--|:--|:--|
| a node's box or its label | the node | `node “Has comment?”` | `Node B · “Has comment?”` |
| an edge's label, or within 6px of its stroke | the edge | `edge B → C “yes”` | `Edge B → C · “yes”` |
| a subgraph's title or its empty ground | the subgraph | `subgraph “The engine”` | `Subgraph engine · “The engine”` |
| the diagram's empty ground outside every part | the diagram | `diagram` | `Diagram · flowchart · 5 nodes, 4 edges` |

Above the narrowest scope the chain widens **through the subgraphs it is in**,
then to the diagram, then as every chain does: the section, the document (spec
06 §4.1). The plumbing of §1.1 is gone: inside a drawn diagram the walk offers
parts and nothing else, so `MAX_SCOPES` is spent on things a reviewer means.

**The badge and the detail line** use the same words. The detail says what is
stored — `diagram.part = node B · line 157 · fingerprint 3a91…` — the way it
says `element.id = "retry-policy"` for a heading, so a reviewer can see that the
anchor is the text and not the picture.

**Strength is `durable`** for every named part, with the note *named in the
source — survives a redraw, a move, and an edit elsewhere in the diagram*. That
is a stronger claim than a hand-written id earns, and it is true for the same
reason a heading's slug is: a Mermaid id is written by the author, and the
anchor also carries the line's text and a fingerprint to catch the id being
reused for something else (§5.4). A `lines` part is `fair` — *the lines' own
text carries it; a rewrite of those lines orphans it* — because it has no id.

**An edge is hit by its stroke, not only by its label.** `elementFromPoint`
finds a two-pixel path about never (§1.1). The probe therefore also asks each
edge path how far the pointer is from it — the nearest of a few dozen points
along the path, from `getPointAtLength` — and an edge within 6 CSS pixels wins
over the ground it is drawn on. A label always wins over a stroke, because a
label has a box and a box is what the reviewer aimed at.

**A text drag over a label stays a text selection.** Spec 05 §3.1 says a drag
is a selection, and a quote inside a label resolves today through the text
index and survives a redraw, because the redraw puts the same words back. So
scope 0 is still `text`, and **the chain above it is the part chain**: one `↑`
(spec 26 §5.4) widens the dragged words to their node. The run-together text
of §1.1 is not fixed here — §6 point 4.

**A diagram that did not draw** is its own source, as spec 03 §4.2 rule 3
requires, and that source is ordinary text: a drag over a line is a text
anchor, a pick offers `Code block` as it does for any `<pre>`. Nothing in this
spec applies until the diagram draws, and nothing has to.

**Which documents.** A `pre.rex-mermaid` exists only where REX rendered a
Markdown fence (spec 03 §5.8). An author's own HTML that carries a Mermaid
`<script>` is not drawn by REX and has no parts; a DOCX, a PPTX and a PDF have
no fence. So this is Markdown, in either pane (spec 15 §6.1), and a place is
taken in the pane it was pointed at in (spec 16 §4).

### 4.2 Reading the source — the lightbox

A click on a drawn diagram opens the lightbox, exactly as spec 10 §2.1 has it
open for any `<svg>`. For a Mermaid drawing the lightbox is wider than a
picture:

```text
┌─────────────────────────────────────────────┬──────────────────────────────────────┐
│                                             │ SPEC.md · lines 156–162 · flowchart  │
│     ┌──────────┐      ┌──────────────┐      │ 156  flowchart LR                    │
│     │ Reviewer │─────▶│ Has comment? │      │ 157  A[Reviewer] --> B{Has comment?} │
│     └──────────┘      └──────┬───────┘      │ 158  B -- yes --> C[Ask agent]       │
│                       yes │  │ no           │ 159  B -- no --> D[Read on]          │
│                  ┌────────▼┐ ▼              │ 160  subgraph engine [The engine]    │
│  ┌ The engine ───┤Ask agent├─┐ Read on      │ 161    C --> E[(rex.db)]             │
│  │               └────┬────┘ │              │ 162  end                             │
│  │              ┌─────▼────┐ │              │                                      │
│  │              │  rex.db  │ │              │                                      │
│  └──────────────┴──────────┴─┘              │                                      │
├─────────────────────────────────────────────┴──────────────────────────────────────┤
│ The engine    [ Drawing ][ Source ][ Both ]   2 places        100%  −  +  ⤢  ×    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**One control, three views.** `Drawing · Source · Both`, drawn with the
`.rex-segment` row spec 08 §3.1 gave REX for "switch what this pane shows".
`Both` is the default — the reviewer asked to see the source *as well*, and a
pane that opens on the picture alone makes them find the switch first. The
choice is remembered for the session and not persisted; a preference about one
figure is not a setting. `s` cycles the three, because the lightbox already owns
the keyboard (spec 10 §2.3) and a control with a key is a control that gets
used.

**The source pane** is REX's own `<pre>` inside the shadow root: IBM Plex Mono,
which is already a dependency, on the lightbox's dark ground. Its gutter shows
**file line numbers** — `157`, not `2` — because `file:line` is how the agent
answers and how the reviewer will name a line in a reply. The header names the
file, the fence's line range and the diagram kind. The text is exactly
`data-source`, untouched: no reformatting, no syntax colour beyond what a code
block gets. **It is read-only, and there is no caret.** `docs/FORMATS.md` §1
rule 3 is a boundary and this pane is inside it: the agent changes the source;
the reviewer says what should change. Selecting text to copy it works, as it
does in any `<pre>`.

**The two halves point at each other.** Hovering a part in the drawing washes
its lines in the source; hovering a line washes its part in the drawing. Both
in `HIGHLIGHT.hoverBg`, spec 15 §8.4's violet, because "the thing being pointed
at" is exactly what that colour means. A node washes its declaring line
strongly and every other line that mentions it lightly, so a reviewer sees at
once that `B` appears on lines 157, 158 and 159. **No badge follows the
pointer here** — the lit lines already say what is under it, in the source's
own words, and a label over the drawing hid the node it named (§10 point 10).

**A click takes a place.** On a part in the drawing, or on a line in the
source — spec 05 §3.1's rule, in a room it did not reach before. The place goes
where a pick would send it: the selection panel, or the open comment's pending
strip (spec 24 §3.2, 26 §4.3). It is outlined in **both halves** in the
selection's blue with the number the panel gives it, so a reviewer who takes the
node and its two edges sees `1` `2` `3` on the drawing and on lines 157–159.
Drag down the gutter and the run of lines becomes one `lines` place. Click a
line that declares no part — the `flowchart LR` header, an `end`, a `classDef`,
a comment — and it is a `lines` place of one line. Click a part already taken
and nothing happens; spec 24 §3.1's duplicate rule, which §5.7 teaches to see
parts.

**The bar says how many.** `2 places`, dim at zero. `esc` closes the lightbox
and the panel has them — one press further than a pick in the page, and the
price of a room big enough to read the diagram in. Places already in the panel
for this diagram are drawn the moment the lightbox opens; comments that already
exist on its parts are outlined the way the page outlines an element
resolution, so the reviewer sees where the discussion already is.

**Everything spec 10 §2.3 gives is kept.** Pan, zoom about the pointer, fit,
`esc`, the scrim, the caption. A drag pans; a click on empty ground does
nothing; only a click on a part or a line takes a place, so the gesture that
used to do nothing is the one that gained a meaning.

**Every other figure is untouched.** An `<img>`, an author's inline `<svg>`, a
diagram that failed to draw: the lightbox opens as it did, with no segmented
control and no source pane, because there is no source REX holds for them.

### 4.3 What a part is

REX reads the source with a **line-based scanner**, not a Mermaid grammar
(§5.3). Every statement Mermaid accepts is on one line, and the scanner asks one
line one question: *what does this line declare or mention?*

For a `flowchart` or `graph` — every diagram in this repository's own docs, 14
of 14 measured on 2026-09-01:

| Part | Identity in the source | Its lines | Its label |
|:--|:--|:--|:--|
| **node** | its id — `B` in `B{Has comment?}` | the line that first gives it a label; failing that, its first mention. Every other line that mentions it is *related* (§4.2's light wash) | the text inside the brackets, quotes stripped |
| **edge** | `from`, `to`, and its ordinal among edges from the same `from` to the same `to`, in source order | the one line that states it | the text on the arrow — `-- yes -->`, `-->\|yes\|` |
| **subgraph** | its id when it has one — `subgraph engine [The engine]`; else `subGraph<n>`, the nth id-less subgraph, which is the name Mermaid gives it too | from `subgraph` to its `end` | the bracketed title, else the id |
| **lines** | none — a run of lines the reviewer chose in the source pane | as chosen | the first line's text |

A line can state several parts: `A --> B --> C` is two edges, `A & B --> C` is
two, and `A[Start] --> B[Next]` declares two nodes and an edge. All of them are
offered where they are hit (§4.1), and a click in the source on such a line
takes the **whole line** as `lines` — the source pane deals in lines, the
drawing deals in parts, and a reviewer who wants one edge of a chain points at
it in the drawing.

`classDef`, `class`, `style`, `linkStyle`, `click`, `direction`, `%%`
comments, the `flowchart LR` header and a `---` front-matter block declare no
part. They can be taken as `lines`.

**Every other diagram kind** — `sequenceDiagram`, `stateDiagram-v2`,
`classDiagram`, `erDiagram`, `gantt`, `pie`, `mindmap`, and the rest — has
**`lines` and `diagram`** in this version. The source pane works for all of
them, the drawing offers the whole diagram, and pick mode never offers a
`<g>`. Named parts for a sequence diagram's participants and messages, and a
state diagram's states and transitions, are §6 point 1: each is its own small
grammar and its own map, and the corpus has none of them yet.

### 4.4 The colours — none new

| Meaning | Where | Colour | Already means this since |
|:--|:--|:--|:--|
| the part or line being pointed at | both halves of the lightbox; the badge's outline in the page | `HIGHLIGHT.hoverBg` violet | spec 15 §8.4 |
| a place taken, numbered | both halves; the page | the selection's blue outline | spec 05 §6 |
| a comment that already exists on a part | both halves; the page | the element-resolution outline in its state's colour | spec 15 §8.4, 18 |
| the source pane's text | the lightbox | `PAPER_DARK.ink` on the lightbox ground | spec 27 §4.4 |

A part is an element resolution (§5.4), so on the page it is **outlined and
never filled**, as every element resolution has been since 2026-08-26
(`resolve.ts`, `blockPickedBy`). A wash over a node's label would say "these
words", and the comment is about the node.

---

## 5. Where the code goes

### 5.1 The files

| File | Change |
|:--|:--|
| `src/shared/diagram.ts` | **New.** `diagramKind(source)`, `scanFlowchart(source)` → `DiagramParts`, `partOnLine`, `linesOf(part)`, `fingerprintSource`, `partKey`, `describePart`. Pure strings — both processes and `node --test` import it. |
| `src/shared/types.ts` | `DiagramPart`, `DiagramRef`, `Anchor.diagram`. |
| `src/renderer/anchor/diagram.ts` | **New.** `partElements(svg, parts)` — the part map (§5.5); `partAt(block, x, y)` — the hit test with the edge tolerance; `diagramOf(el)` — the enclosing `pre.rex-mermaid[data-rendered]`, or null. Pure DOM, runs in the frame. |
| `src/renderer/anchor/pick.ts` | `chainFrom` offers the part chain inside a drawn diagram (§5.6); `describeDiagram` for the `<pre>`; `SCOPE_WORDS` gains the five words; `PickScope.part`. |
| `src/renderer/anchor/create.ts` | `createDiagramAnchor(index, block, part, sourceFile)`. `hash` is exported for `fingerprintSource` to share — one FNV-1a, not two. |
| `src/renderer/anchor/resolve.ts` | `resolveDiagram`, read before `extent` (§5.4). |
| `src/renderer/anchor/index.ts` | Exports the three new names, so `test/anchor.spec.ts`'s bundle and `test/diagram.spec.ts`'s see them. |
| `src/renderer/overlay/anchoring.ts` | `anchorFromDiagramPart(blockId, part)` on `DocumentSurface`; `scopeChainForAnchor` rebuilds a diagram anchor's chain through the part (§5.6). |
| `src/renderer/overlay/selection.ts` | `isDuplicate` compares `partKey` (§5.7). |
| `src/renderer/overlay/preview.ts` | `PreviewFigure` gains `{ kind: "diagram"; svg; source; blockId; file; fenceLine; pane; caption; backdrop }`, built when the clicked `<svg>` sits in a `pre.rex-mermaid`. |
| `src/renderer/overlay/Lightbox.tsx` | The segmented control, the two-half layout, the hover linking, the numbered outlines, `onPick`. |
| `src/renderer/overlay/DiagramSource.tsx` | **New.** The source pane: gutter, lines, hover, click, the gutter drag. |
| `src/renderer/overlay/App.tsx` | `onPick` from the lightbox → `surface.anchorFromDiagramPart` → `addSelectionItem`, into the panel or the pending strip; the places and resolved threads handed to the lightbox. |
| `src/renderer/overlay/overlay.css` | `.rex-lightbox-split`, `.rex-lightbox-source`, `.rex-source-gutter`, `.rex-source-line`, the hover wash, the numbered outline inside the lightbox. |
| `src/main/agent/prompts.ts` | `describeTarget` and `passageSection` gain the diagram branch (§5.8). |
| `src/main/apply.ts` | `locatePassage` gains the diagram branch (§5.8). |
| `test/diagram.spec.ts` | **New.** §7 milestone 0 — the scanner under `node --test`, and the part map in a headless Chromium the way `anchor.spec.ts` runs. |
| `package.json` | `test:diagram`. |

### 5.2 The anchor

```ts
/** Spec 29 §4.3 — one part of a Mermaid diagram, named in its source. */
export type DiagramPart =
  | { kind: "node"; id: string }
  | { kind: "edge"; from: string; to: string; ordinal: number }
  | { kind: "subgraph"; id: string }
  /** 1-indexed inside the fence, inclusive — §10 point 2. */
  | { kind: "lines"; from: number; to: number };

/**
 * Spec 29 §5.2 — where in a Mermaid fence a comment points.
 *
 * Read before the four layers, exactly as `region`, `extent` and `gap` are, and
 * for the same reason: the thing it names is not on the page as text. The page
 * holds a drawing; this names the text the drawing was made from.
 */
export interface DiagramRef {
  /** `flowchart`, `sequenceDiagram`, … — the first word of the source. */
  type: string;
  part: DiagramPart;
  /** The lines that state the part, 1-indexed inside the fence, inclusive. */
  lines: { from: number; to: number };
  /** Those lines, trimmed and joined with `\n` — the quote that finds the part when the fence moves. */
  text: string;
  /** FNV-1a of the whole fence's source, whitespace-normalised. Equal means untouched. */
  fingerprint: string;
}

export interface Anchor {
  // …
  diagram?: DiagramRef;
}
```

What the rest of the anchor holds for a diagram part:

| Field | Value | Why |
|:--|:--|:--|
| `quote`, `position` | **null** | the quote layer matches the page's text, and the source is not on the page. A quote would be the SVG label — the thing §1.2 stops binding to |
| `element` | the **`<pre>`**'s ref: `id: "mermaid-155"`, `css: "#mermaid-155"` | the way to find the diagram, never the part. It is a hint, not an identity: the id moves with the fence (§1.2), and §5.4 says what is tried when it does |
| `region` | null | |
| `source` | `{ file, line: fenceLine + lines.from }` | the part's **own** file line, so `locatePassage`'s last-resort fallback lands on the part and not on the fence |
| `extent`, `gap` | absent | a part is narrower than any extent |

`anchor_json` is a blob (spec 01 §9), so an anchor written before this spec
reads `diagram: undefined` and resolves exactly as it did. No migration.

### 5.3 The scanner

`scanFlowchart(source)` in `src/shared/diagram.ts` walks the fence line by
line, after dropping a `---` front-matter block and everything after `%%` on a
line, and returns:

```ts
interface DiagramParts {
  type: string;
  nodes: Map<string, { label: string | null; declared: number; mentions: number[] }>;
  edges: Array<{ from: string; to: string; ordinal: number; label: string | null; line: number }>;
  subgraphs: Map<string, { title: string | null; from: number; to: number }>;
  /** Line → the parts it states, in the order they appear on it. */
  byLine: Map<number, DiagramPart[]>;
}
```

The rules, and the reason each is a rule rather than a grammar:

- **A node id** is `[\p{L}\p{N}_-]+` immediately followed by a shape opener
  (`[`, `(`, `{`, `>`, `[[`, `((`, `[(`, `{{`, `[/`, `[\`), by an arrow, by
  `&`, by `:::`, or by the end of the statement. Mermaid's own grammar is
  wider, and where it is wider REX offers `lines` — a node the scanner cannot
  name is still a line the reviewer can click.
- **A label** is what sits between the opener and its closer, with a
  surrounding pair of `"` removed. Mermaid's markdown-string labels
  (`` "`bold`" ``) keep their backticks; they are the author's text.
- **An arrow** is any run of `-`, `.`, `=`, `>`, `<`, `x`, `o`, `~` of length
  ≥ 2 that Mermaid draws as a link, with an optional `|text|` after it or a
  `-- text --` inside it. `A --> B --> C` yields two edges; `A & B --> C`
  yields two; both on one line.
- **An edge's ordinal** counts, in source order, the edges already seen with
  the same `from` and `to`. It is REX's number, not Mermaid's — §5.5 says why
  Mermaid's cannot be used.
- **A subgraph** opens at `subgraph <id> [<title>]` or `subgraph <title>` and
  closes at the matching `end`, nesting allowed. An id-less subgraph is named
  `subGraph<n>` — the nth id-less one, from 0 — which is the id Mermaid gives
  it (measured 2026-09-01: `subgraph The engine` drew as `g.cluster#r-subGraph0`).
- **Everything else declares nothing** and is `lines`.

`fingerprintSource(source)` is FNV-1a over the source with every whitespace run
collapsed to one space and trailing spaces dropped — the same hash `create.ts`
uses for an element, exported so there is one. A fence re-indented by a
formatter keeps its fingerprint; a fence with one label changed does not.

### 5.4 Resolving

`resolveDiagram(index, anchor)` runs first in `resolveAnchor`, before `gap` and
`extent`, and never falls through to the layers below it.

**Step 1 — find the diagram.** In this order, stopping at the first hit:

1. every `pre.rex-mermaid` whose `data-source` fingerprint **equals** the
   stored one — the fence is byte-for-byte what it was, wherever it moved to;
2. the `<pre>` the element ref names (`getElementById`, then the CSS path),
   **if** it is a `pre.rex-mermaid` and **still holds the part** — by its id,
   its two ends or its subgraph id, or for `lines` by its text (`findPart`,
   §10 point 3) — the fence changed, but this is still the place and the part
   is still in it;
3. every `pre.rex-mermaid` that still holds the part — the fence moved *and*
   changed; exactly one candidate is accepted, two is a tie REX does not break;
4. none → **orphaned**.

**Step 2 — find the part** in that diagram's source, by kind:

| Part | Found when | Not found → |
|:--|:--|:--|
| node | its id is declared or mentioned | orphaned. A renamed id is a new node (§6 point 6) |
| edge | an edge with the same `from` and `to` exists; the one at `ordinal` if there are that many, else the last | orphaned |
| subgraph | its id (or `subGraph<n>`) opens a subgraph | orphaned |
| lines | a run of lines whose trimmed text equals `text` — the first such run at or after the stored `lines.from`, else the first anywhere | orphaned. **Never** the stored line numbers alone: a line number always resolves to *something*, and that is the wrong-place failure spec 01 §13 exists to catch |

**Step 3 — the element.** The part's SVG element from the part map (§5.5), or
the `<pre>` itself when the map has no entry for it. The resolution is an
ordinary element resolution — `{ kind: "element", element, layer, matchedBy }`
— so every consumer that outlines, measures, scrolls to or lists an element
place works unchanged.

**The state**, through `anchorStateFor` as it stands:

| Outcome | `layer` · `matchedBy` | State |
|:--|:--|:--|
| fingerprint equal, part found | 1 · `identity` | `ok` — or `moved` when the file changed elsewhere, as for every anchor |
| fingerprint differs, part found by id in the diagram the ref names | 3 · `identity` | `ok` — see the paragraph below |
| fingerprint differs, part found by id, diagram found by search | 2 · `identity` | `moved` |
| `lines` found by text, diagram changed | 2 · `identity` | `moved` |
| part not found | — | `orphaned` |

Row two is deliberately **`ok`**: a node whose label was edited two lines away
from it is the same node, and a badge on every diagram edit trains people to
ignore badges (`resolve.ts`, the note on `anchorStateFor`). A `lines` part
found by text in a changed fence is `moved`, because nothing but the text named
it and the text now sits among different neighbours.

**What can never happen:** a part resolving onto a *different* part and
reporting `ok`. A node resolves by its id, an edge by its ends, a subgraph by
its id, lines by their text — and none of those is a position.

### 5.5 The part map

`partElements(svg, parts)` returns `Map<string, Element>` keyed by `partKey`,
computed **on demand** from the drawn SVG and stored nowhere — not on the
elements, not in a cache. Spec 27 §4.5 redraws the diagram when the paper
changes, and a map computed at that moment is a map that is right.

The ids Mermaid 11.17.0 derives from the source, measured on 2026-09-01:

| Part | Where Mermaid puts the identity | Lookup |
|:--|:--|:--|
| node | `g.node` with `id="<svgId>-flowchart-<nodeId>-<n>"`; `<n>` is a counter | `[id^="<svgId>-flowchart-<nodeId>-"]` whose remainder is digits. Prefix-matched from the **known** id, never parsed out of the element id: `my-node` draws as `flowchart-my-node-0`, and a hyphenated id cannot be split back reliably |
| edge | `path[data-edge][data-et="edge"]` with `data-id="L_<from>_<to>_<n>"` | the **nth in DOM order** among `path[data-edge][data-id^="L_<from>_<to>_"]`, where n is REX's ordinal. Mermaid's own `<n>` is not an ordinal: two edges `my-node --> B` drew as `L_my-node_B_0` and `L_my-node_B_2` |
| edge label | `g.label[data-id="L_<from>_<to>_<n>"]` around the `<foreignObject>` | the label's `data-id`, matched the same way, so a hit on the label is a hit on its edge |
| subgraph | `g.cluster` with `id="<svgId>-<subgraphId>"` | `#<svgId>-<subgraphId>` |
| state diagram node | `g.node` with `id="<svgId>-state-<stateId>-<n>"` | not used in this version (§4.3) — recorded so milestone 0's fixture pins the shape |
| sequence participant | `g[data-et="participant"][data-id="<alias>"]` | not used in this version — recorded because its neighbours (`actor0`, `root-0`) are the counters §1.2 measured |

Three shapes and one date. A Mermaid upgrade can change any of them, and when
it does **the map returns fewer entries and nothing else breaks**: §5.4 step 3
falls back to the `<pre>`, the place resolves, the agent is told the part, and
the outline is the whole diagram until the lookup is taught the new shape.
`test/diagram.spec.ts` pins the three so the change is found by a test rather
than by a reviewer.

### 5.6 The chain

`chainFrom` in `pick.ts` gains one branch. When the element under the pointer
is inside a `pre.rex-mermaid[data-rendered]` — `diagramOf(el)` — the walk does
not climb the SVG. It asks `partAt(block, x, y)` for the part, then:

1. the part's scope — `describePart`, with `PickScope.part` set;
2. one scope per **enclosing subgraph**, innermost first, from the scanner's
   nesting;
3. the diagram — `describeDiagram(block)`: `Diagram · flowchart · 5 nodes, 4
   edges`, `regionCapable` true, as an `<svg>` was;
4. then the ordinary walk from the `<pre>`'s parent, and `appendWideScopes` as
   for every chain.

`scopeChainForAnchor` — the rebuild spec 05 §4.1 does when a place is widened
— builds the same chain from `resolveDiagram`'s part rather than from a range
or an element, so a place taken from the lightbox widens through the same
crumbs as one taken in the page.

`anchorFromScope(index)` creates `createDiagramAnchor` when the chosen scope
carries `part`, and `createElementAnchor` on the `<pre>` when it is the
`diagram` scope — the anchor a click on the drawing's ground made before this
spec, unchanged.

### 5.7 Duplicates

`isDuplicate` in `selection.ts` compares `partKey(anchor.diagram)` beside
`gapKey`. Without it every part of one diagram is a duplicate of every other:
they share the `<pre>`'s element ref and the same four nulls, exactly as two
gaps shared theirs (spec 16 §6.2, measured 2026-08-26). `partKey` is
`node:B`, `edge:B>C#0`, `subgraph:engine`, `lines:157-158`, prefixed with the
fence's stored id so two diagrams in one file do not collide.

### 5.8 The agent

`describeTarget` gains the branch before the quote:

```text
3. In the Mermaid diagram (flowchart) at lines 156–162 of docs/SPEC.md:
   the node B, labelled "Has comment?" — declared on line 157:
       B{Has comment?}
   It is also mentioned on lines 158 and 159.
```

```text
4. In the Mermaid diagram (flowchart) at lines 156–162 of docs/SPEC.md:
   the edge from B to C, labelled "yes" — line 158:
       B -- yes --> C[Ask agent]
```

```text
5. In the Mermaid diagram (flowchart) at lines 156–162 of docs/SPEC.md:
   lines 160–162:
       subgraph engine [The engine]
         C --> E[(rex.db)]
       end
```

The lines are the version's, not the stored ones. `locatePassage` gains a
branch that finds the fence in the copy (the first ```` ```mermaid ```` block
whose fingerprint matches; else the one that contains `text`), scans it, and
returns the part's line by §5.4's rules — `version: "current"` when the copy has
it, `"original"` when only the base does, exactly as a quote is located (spec
16 §5.1). The stored `source.line` is the last resort, as it is for every
anchor.

Nothing about ACT changes. The fence is Markdown text; the agent edits it with
the tools it has; the working copy re-renders; `mermaidPass` draws the new
fence; the anchor re-resolves through §5.4. A comment that said *"make B a
rounded box"* comes back with `B(Has comment?)` on line 157 and the same place
still outlined — the fingerprint differs, the id is found, the state reads
`ok`.

---

## 6. What this gives up

1. **Named parts for flowcharts only.** Every other kind has `lines` and the
   whole diagram. Sequence and state diagrams each want a scanner of their own
   and a row in §5.5's table; this repository's corpus has neither, so neither
   has a test. The shape of the extension is fixed — a scanner in
   `shared/diagram.ts`, a lookup in `anchor/diagram.ts`, two rows in a table —
   and the `DiagramPart` union grows by `participant`, `message`, `state`,
   `transition` when it does.
2. **No editing in the source pane.** `docs/FORMATS.md` §1 rule 3. The agent
   changes the diagram.
3. **A region on a drawing is as it was**, and as fragile as it was: a box cut
   from a Mermaid `<svg>` carries `fingerprintElement`'s hash of the markup,
   and spec 27 §4.5's dark redraw changes that markup. Read off `create.ts`,
   not measured; milestone 1 measures it and §9 records the answer. A part
   anchor is the replacement for most of what a region on a diagram was for.
4. **The text index still runs the labels together.** `“The engineyesnoReviewer…”`
   is what a quote and `⌘F` see inside a diagram (§1.1). Fixing it means a
   boundary rule in spec 01 §6.3's walk, which shifts every offset below every
   diagram and belongs to a spec about the index.
5. **A part the map cannot find is outlined as the diagram.** §5.5. Loud
   enough to notice, honest about what it knows, and never wrong about where
   the comment is.
6. **A renamed id is a new node.** `B` renamed to `Decision` on every line
   orphans a comment on `B`, because the id is the name and the lines' text
   changed with it. The comment and its quote are kept (spec 01 §6.6), and
   the orphan tray says which diagram it was in.
7. **An author's HTML with a Mermaid `<script>`** is not drawn by REX and has
   no parts. Spec 03 §5.8 draws fences; this spec follows it.
8. **The source is read in the lightbox and nowhere else.** §8 says why not
   in the page.
9. **Mermaid's markup is pinned by a test, not by a contract.** §5.5's three
   shapes were measured against 11.17.0. An upgrade that moves them makes
   `test:diagram` fail and the outline widen; it does not lose a comment.

---

## 7. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 0 | The scanner and the map | `npm run test:diagram`. Under `node --test`: `scanFlowchart` names every node, edge and subgraph of the three fixtures — the §1 flowchart, the `my-node`/`&`/id-less-subgraph probe of §5.5, and the largest diagram in `docs/my-specs/` — with the right lines, labels, ordinals and `subGraph<n>` names; `A --> B --> C` and `A & B --> C` each yield two edges; `%%` and front-matter declare nothing; `fingerprintSource` ignores indentation and sees a changed label. In a headless Chromium with mermaid 11.17.0: `partElements` finds an element for **every** part of all three, including both `my-node → B` edges in source order and the id-less cluster; `resolveDiagram` on a bundled `resolve.ts` gives `ok` on the same source, `ok` after a label edit elsewhere, `moved` after the fence is moved and changed, `orphaned` after the node's id is renamed, and **never** an element other than the part's. |
| 1 | Picking a part in the page | Pick mode over a flowchart in `docs/my-specs/01-initial/SPEC.md` offers `node › subgraph › diagram › section › document` and no `g`, `div` or `foreignobject`; the badge reads `node “…”`; an edge is hit by its stroke and by its label; the chip in the panel says the same words; the stored anchor has `diagram` set, `quote` null, `source.line` the part's line; `↑` from a text drag over a label widens to the node; the place survives `W`, a zoom, the dark paper and a reload; a paragraph inserted above the fence leaves it `ok`; the same node picked twice yields one row; a region cut from the drawing before and after the dark switch is measured and §9 records what happened. |
| 2 | The source pane | Click a drawn diagram: the lightbox opens on `Both`, the source pane shows the fence with file line numbers and the header; `s` cycles the three views; hovering a node washes its lines and hovering a line washes its part; a click on a node, an edge, a subgraph and a bare line each adds a numbered place, outlined in both halves; a gutter drag adds a `lines` run; a second click on a taken part adds nothing; `2 places` is on the bar; `esc` closes and the panel holds them; an `<img>` and an author's `<svg>` open exactly as spec 10 had them; a diagram in the original pane takes places in the original pane. |
| 3 | The agent | ASK on a node reaches the agent as §5.8's sentence and the answer names the line; ACT that changes the node's label comes back with the place `ok` on the changed fence in the working copy, in both panes; ACT that moves the fence down a paragraph comes back `ok`; a comment on an edge has no selector in its prompt; `git status --porcelain` in the workspace shows only the working copy REX wrote. |
| 4 | Live, and clean | §7.1. |

### 7.1 How milestone 4 is checked

In an agent REX (`.claude/hooks/playwright-launch.sh npm run dev`), with this
repository opened as the workspace — its specs carry 14 flowcharts, and
`docs/my-specs/01-initial/SPEC.md` has one with a subgraph.

1. Open that spec, scroll to its diagram, press `P`, hover the node with the
   longest label. Done when: the badge reads `node “…”` with the label, the
   outline is the node's box and nothing else, and `↑` walks
   `subgraph › diagram › section › document` with no other word.
2. Hover the middle of an unlabelled edge's stroke. Done when: the badge reads
   `edge X → Y` and the outline is the stroke's box.
3. Click the node, then click it again. Done when: the panel holds one row,
   `node “…”`, with a numbered outline on the drawing.
4. Press `B` (spec 13) and read the report's selection row. Done when: the
   anchor shows `diagram.part`, no quote, and a `source.line` that is the
   node's line in the file — check it against the file.
5. Toggle the dark paper. Done when: the diagram is redrawn dark and the
   numbered outline is still on the same node.
6. Insert a paragraph above the fence in the file, reload. Done when: the
   place is still on the node and reads `ok`.
7. Click the drawing outside pick mode. Done when: the lightbox opens on
   `Both`; the source pane shows the fence with file line numbers that match
   the file; hovering the node washes its declaring line strongly and its
   other mentions lightly; hovering a line washes its part.
8. Click an edge's label in the drawing, then click the `end` line in the
   source, then drag down two lines of the gutter. Done when: three more
   places, numbered `2` `3` `4`, outlined in both halves; the bar reads
   `4 places`.
9. `esc`, write *"why does the edge from X to Y exist?"*, ASK. Done when: the
   agent's answer names the line the edge is on, and the trace shows the
   prompt carrying §5.8's sentence for each of the four places.
10. Send *"rename the node's label to 'Decision'"* with ACT. Done when: the
    working copy has the new label on the same line, both panes draw the new
    diagram, and the place is `ok` on the renamed node in both.
11. Open `sample-files/` or any document with a sequence diagram (write one if
    none is there). Done when: pick mode offers `diagram` and nothing inside
    the drawing; the lightbox shows the source; a click on a line adds a
    `lines` place; a click on a participant adds nothing and the badge says
    `diagram`.
12. Open a document whose diagram fails to draw. Done when: the source is on
    the page as text, a drag over it is a text place, and the lightbox does
    not offer a source pane.
13. `npm run test:diagram`, `npm run test:anchor`. Done when: both green.
14. `git status --porcelain` in the workspace: only the working copy of
    step 10.
15. `nvim-tools --json --all` adds no finding against the baseline.

---

## 8. Rejected

| Idea | Why not |
|:--|:--|
| **Anchor to the SVG element, as today** | §1.2. A sequence diagram's ids are counters that change on every render of the same source — measured — and spec 27 redraws on every paper change. The `<pre>`'s id moves with the fence. And the anchor reaches the agent as a selector that exists in no file. The drawing is REX's, made from the author's text; the text is the thing. |
| **Show the source in the page** — a toggle that swaps the drawing for the fence in place | The source would have to enter the document's DOM after `onSurfaceReady`, and spec 03 §4.3 forbids exactly that: the text index would gain several hundred characters at the diagram and every anchor below it would record offsets into text that has moved. Spec 10 §2.2 is the same rule from the other side. The lightbox is REX's own chrome and can hold anything. |
| **Show the source in the sidebar** — a third tab beside `Selection` and `Comments` | The right column is about comments; the left about files. A pane about one figure's text belongs with the figure, and spec 10 already built the room. |
| **Use Mermaid's own parser** (`mermaidAPI.getDiagramFromText`, the diagram `db`) for the parts | It gives vertices and edges with no line numbers, its model differs per diagram kind, it is not the public API, and it runs only where Mermaid runs — the renderer. §5.3's scanner is 150 lines of string code both processes share, and the part it cannot name is still a line. |
| **A `RegionRef` on the drawing for each part** — cut the node's box as a region | Geometry. A re-layout moves every box, and `fingerprintElement` orphans the region on the dark redraw. §6 point 3. |
| **A new `SelectedKind`** — `"diagram"` beside `"text"` and `"element"` | Derivable: the anchor carries `diagram`. `SelectedKind` exists because a text anchor and an element anchor cannot be told apart from their fields; a diagram anchor can. |
| **Parse the node id back out of Mermaid's element id** | `flowchart-my-node-0` cannot be split reliably. §5.5 prefix-matches from the ids the scanner already knows. |
| **Use Mermaid's edge suffix as the ordinal** | `L_my-node_B_0` and `L_my-node_B_2` for the first and second edge between the same nodes, measured. DOM order among same-pair edges is what the scanner's ordinal maps to. |
| **Name a subgraph by its title** when it has an id | The id is what Mermaid draws (`g.cluster#r-sg2`) and what an author refers to. The title is the label. |
| **Resolve `lines` by line number when the text is gone** | A line number always resolves to something. That is the silent wrong-place failure the whole anchor design exists to prevent, and orphaning costs nothing. |
| **Fix the run-together label text in the index** | Belongs to the index, shifts every offset below every diagram, and is not what was asked for. §6 point 4. |
| **Edit the source in the lightbox** | `docs/FORMATS.md` §1 rule 3. REX does not edit document content by hand, in any format. |
| **Every diagram kind in version 1** | The corpus is 14 flowcharts and nothing else. A scanner without a fixture is a scanner nobody has run. `lines` covers every kind today; §6 point 1 fixes the shape of the extension. |
| **Write the part map into the DOM** as `data-rex-part` attributes on the SVG | Spec 10 §2.2: an added attribute changes `outerHTML`, and `fingerprintElement` hashes `outerHTML` — every region on the diagram would orphan. On demand costs a few `querySelectorAll`s per probe and stores nothing. |
| **Open the lightbox from pick mode, or take places from the page's badge** | Two rooms for one act. The page has pick mode; the lightbox has the click. A reviewer who wants to read the diagram before pointing opens it and points there. |
| **Persist the `Drawing · Source · Both` choice** | A setting about one figure's view is not a setting about REX (spec 25 §6.1's warning about what the database is about). The session remembers it. |

---

## 9. Open questions

1. **Does a region cut from a Mermaid drawing survive the dark-paper redraw?**
   Read off `create.ts` (§6 point 3), it should not. **Not measured by the
   build** — the second unrun step in §10. If it does not, the fix — a fingerprint that ignores
   `<style>` and presentation attributes — belongs to spec 27 or a small spec of
   its own, and this line records which.
2. **Mermaid's ids, next version.** §5.5 is measured against 11.17.0, and
   `test/diagram.spec.ts` pins the three shapes. When `npm update` moves them,
   the test says so before a reviewer does; this line records what moved.

---

## 10. What the build changed

Version 1.1, written after the build on 2026-09-01. Eleven places where the
code departs from version 1.0, and why each was the right call; then the two
steps of §7.1 that were not run.

1. **The hash lives in `src/shared/hash.ts`, not in `create.ts`.** §5.1 said
   `create.ts` would export it for `fingerprintSource`. It cannot: `src/shared/`
   may not import from `renderer/` (spec 01 §3.1). One FNV-1a, `fnv1a`, in
   shared; `create.ts` imports it.
2. **A `lines` part carries its own numbers.** §5.2 wrote it as
   `{ kind: "lines" }` with the span on `DiagramRef.lines`. The scope chain and
   the source pane hand a part around **before** a ref exists, and a `lines`
   part with no numbers is nothing. So it is `{ kind: "lines"; from; to }`, and
   `DiagramRef.lines` is what resolution found — equal to it at creation.
3. **The diagram is found by the part, not by its text.** §5.4 steps 2 and 3
   said "if its source contains the part's `text`". Written that way, a node's
   text is its whole declaring line — `A[Reviewer] --> B{Has comment?}` — so
   relabelling B orphaned a comment on A. A named part is looked for **by what
   names it** (`findPart`: its id, its two ends, its subgraph id); only a
   `lines` part is looked for by its text. `locateFence` in main does the same.
   `test/diagram.spec.ts` covers exactly that edit.
4. **The fence's closing newline is dropped.** markdown-it hands a fence's
   content over with it, so the source pane counted an empty eighth line on a
   seven-line diagram — measured live, the gutter read `6–13`. `fenceText`
   removes one trailing newline wherever the block's source is read, and the
   renderer and main agree on every line number. The fingerprint never saw it:
   it drops blank lines.
5. **The agent's sentence does not repeat the file's name.** §5.8's example
   read `at lines 156–162 of docs/SPEC.md`. `passageSection` already names the
   document once — at the head of the prompt, or as a `### file.md` heading
   (spec 24 §6.1) — so the sentence reads `In the Mermaid diagram (flowchart)
   at lines 6–12:` and nothing is said twice. The stored line is not appended
   after it either: the description carries its own lines.
6. **A stored place is named from its ref.** §4.1 did not say how a card names
   a diagram place whose document is not open. `describeRef` scans the ref's
   own `text` under the diagram's header and gets the node its label back;
   `place.ts` uses it, and so does the agent's prompt when the fence is gone.
7. **Every place number on a source line is shown.** `A[Reviewer] -->
   B{Has comment?}` is two nodes on one line, and two places on it read
   `1, 3` in the gutter rather than the first alone.
8. **`s` cycles the three views.** §4.2 named the control and the key; the
   order is `Drawing → Source → Both → Drawing`, and the choice is a module
   variable — remembered for the session, persisted nowhere, as §4.2 said.
9. **Both halves stay mounted; a view hides one.** The first build unmounted
   the half a view did not show. The SVG copy is put into its host once, by a
   layout effect, so an unmounted host came back empty: `Source`, then
   `Drawing`, left a white rectangle where the diagram had been for the rest
   of the preview. Reported by the reviewer on 2026-09-01, reproduced over CDP
   (`svg in host: 0` after the first switch), fixed with `hidden` on the half
   rather than a conditional render, and checked the same way. The attribute
   needed a stylesheet rule beside it: `.rex-lightbox-source` sets `display:
   flex`, and an author rule beats the browser's `[hidden] { display: none }`,
   so `Drawing` showed the source pane stacked under the drawing until
   `.rex-lightbox-source[hidden] { display: none }` was stated after it.
   Reported the same day; measured as `1400×334` over `1400×542` before, and
   `1400×876` with the source pane not visible after.
10. **No badge in the lightbox, and a stronger hover.** Version 1.0 had the
    pick-mode badge follow the pointer over the copy. The reviewer asked for it
    to go (2026-09-01): in `Both` the lit source lines already name the part,
    and in `Drawing` the label sat over the node it named. The violet hover is
    a third stronger than the first build — 34% and 16% washes, the violet in
    the strong line's left border, an 18% fill and a 2.5px stroke on the
    drawing's mark — because without the badge it was the only answer to
    "what am I on", and it read as too quiet. Checking that exposed a second
    fault: the marks on the copy were **invisible** from the first build. Their
    class was `rex-mark`, which `overlay.css` already uses for the margin
    marks with `height: 24px; width: auto`, and CSS `width`/`height` are
    geometry on an SVG `<rect>` — every mark drew 0px wide (measured:
    `rectOnScreen [229, 365, 0, 25]` over a 173×173 node). The classes are
    `rex-dmark…` now, and the marks show.
11. **No hover mark in `Drawing`.** The reviewer asked (2026-09-01): the hover
    exists to say which line the part is, and `Drawing` has no lines on
    screen to say it with. In `Drawing` a hover draws nothing; places and
    existing comments are still marked. `Both` keeps the hover in both halves.

Two things §7.1 asks for were **not run**:

1. **Steps 9 and 10 — a real ASK and ACT.** Both spend money on an agent run,
   and neither was started without asking. What they would check is covered
   without one: `test/diagram.spec.ts` asserts the exact sentences
   `passageSection` writes for a node, an edge and a run of lines, against a
   file, and again after the fence moved and a label changed; `locatePassage`'s
   diagram branch is the same two shared functions the test exercises.
2. **Milestone 1's last clause — a region cut from the drawing, before and
   after the dark switch** — §9 point 1. Not measured; the question stands.

What was run, and what it showed: pick mode over `flow.md` offered `node “Has comment?”`, `edge B → C
“yes”`, `edge A → B` on a bare stroke and `subgraph “The engine”`, with the
path bar reading `document › section › diagram › node`; the lightbox opened on
`Both` with the gutter at `6–12`, hovering node B lit line 7 strongly and lines
8–9 lightly, three clicks made three numbered places and a fourth on a taken
node made none; saved as a NOTE, the three anchors read `diagram.part`, `quote:
null` and `source.line` 7, 8 and 12; the dark paper left all three `ok`; two
paragraphs above the fence and a relabelled B left them `moved` at L11, L12 and
L16 with the card reading `Node B · “Decision?”`; renaming `B` to `Decision`
orphaned the node and the edge and left the `end` line `moved`; a sequence
diagram offered `diagram` and nothing inside it, its lightbox showed the source
and a click on a participant took nothing; a diagram that did not draw was its
own text on the page; and `git status --porcelain` in the workspace was empty.
