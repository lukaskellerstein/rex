# REX 04 — selection, shortcuts, and the PDF that would not draw

**Version:** 1.0 · 2026-08-21
**Status:** implemented
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md),
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md) and
[`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md).

> [!note]
> This document extends specs 01 to 03. It does not restate them. §2 says
> exactly what changes; everywhere else the earlier specs still govern,
> including all three invariants of spec 01 §3 and the whole anchoring model.

---

## 0. How to use this document

Nine things were reported against the running app on 2026-08-21, in two
rounds. §1 lists them all. §4 is the only architectural change here — a comment
can now be about more than one place — and §5 is the finding that everything
about PDF drawing rests on.

**Two rules for anyone changing this area:**

1. **Nothing here weakens the three invariants of spec 01 §3.** No listening
   port, no database handle in the renderer, and anchor resolution stays in the
   renderer on the live DOM.
2. **The document iframe still runs no script.** Spec 01 §5.4 step 2 stands.
   §5 below is a *consequence* of that rule, not an argument against it.

---

## 1. What was wrong, and what is added

| # | Reported | Cause | Section |
|:--|:--|:--|:--|
| 1 | Picking a whole table did nothing useful | A probe fires on every pointer move and reset the widened scope to the narrowest, so the click anchored the cell | §3 |
| 2 | No keyboard shortcuts | — | §6 |
| 3 | The document would not scroll in pick mode | The pick layer swallows the wheel and the frame is its sibling, so nothing chained | §3.2 |
| 4 | One comment could only be about one element | By design until now | §4 |
| 5 | A PDF drew as blank paper | **Chromium never paints a `<canvas>` inside a frame sandboxed without `allow-scripts`** | §5 |

A second round, reported against the same build:

| # | Reported | Cause | Section |
|:--|:--|:--|:--|
| 6 | Only the list showed the extra targets, not the document | Nothing drew a draft | §4.5 |
| 7 | Ctrl-click should add a target | On macOS ctrl-click **is** a right-click, so no `click` ever fired | §4.6 |
| 8 | No way to zoom the document | — | §6.1 |
| 9 | The graph held a node labelled with binary noise | The graph read **every** document as UTF-8, and spec 03 made `.docx` and `.pdf` documents | §7 |

---

## 2. Changes to specs 01 to 03

| Spec | Change |
|:--|:--|
| 01 §4 Shared types | `Thread` gains `extraAnchors: Anchor[]`. §4.1. |
| 01 §6 Anchoring | **Unchanged in code.** A thread now resolves several anchors instead of one, each through the same four layers. Its state is the worst of them. §4.3. |
| 01 §8.6 Prompts | The Ask prompt gains an `## Also highlighted` section when the comment has extra anchors. §4.4. |
| 01 §9 Database | `thread` gains a nullable `extra_anchors_json TEXT`. First migration in the project — §4.2. |
| 01 §10 IPC | `ThreadCreateRequest` gains an optional `extraAnchors`. No new channel. |
| 03 §7.2 What is drawn | **Corrected.** The page is no longer a `<canvas>` plus a text layer. §5.2. |
| 03 §7.3 Anchoring in a PDF | Unchanged in behaviour; §5.3 records what keeps it true. |
| 02 §5.1 Link extraction | Reads only Markdown and HTML. `isTextDocumentPath` is the new predicate — §7. |

---

## 3. Picking

### 3.1 Widening must survive the pointer moving

`probeAt` runs on every `pointermove` and used to answer with the chain alone,
so the surface above it reset the chosen scope to the narrowest each time.

Measured on 2026-08-21 against `sample-files/sample-document.md`: hover a cell,
press ↑ twice to reach `table`, move the mouse one pixel, click — and the
composer opens on `Cell · row 3`. A human moves the mouse a pixel on the way to
clicking almost every time, so the widening was unreachable in practice.

A probe now answers with **which scope to show as chosen**:

```ts
interface Probe {
  scopes: PickScope[];
  active: number;
}
probeAt(x: number, y: number, keep: number): Promise<Probe | null>;
```

The rule is *element identity*, not position: if the element the reviewer had
chosen is still somewhere in the new chain, that element stays chosen at its
new index; otherwise the answer is 0.

This gives the behaviour a reviewer expects without any extra state. Moving
across the cells of one table keeps `table` chosen, because the table is still
in the chain. Moving to a paragraph elsewhere does not, and there the narrowest
scope is the right answer again.

Both surfaces implement it — `FrameSurface` in the renderer and the tier 2
preload — because invariant I1 puts the chain on whichever side owns the DOM.

### 3.2 The wheel

The pick layer sits over the frame and takes pointer events, which is what
stops a pick-mode drag from starting a text selection underneath. The frame is
its **sibling**, not its ancestor, so the browser had nothing to chain a scroll
to and the document simply froze.

`DocumentSurface` gains `scrollBy(dx, dy)`, and the layer forwards the wheel to
it. After the scroll it probes again at the last pointer position: the document
moved under a cursor that did not, so the outline would otherwise name an
element that is no longer there.

### 3.3 The composer stays inside the pane

`.rex-doc` is `overflow: hidden` and the composer opens level with what it is
anchored to. Anchor near the bottom and the note field and the Ask button were
below the edge — indistinguishable from the click having done nothing.

The card measures itself once it exists and lifts back inside, never past the
top of the pane, and `max-height` lets a tall one scroll internally.

---

## 4. A comment about several places

Selecting text inside a table already offered the enclosing structure
(spec 03's chips), which answers "I meant the table, not the cell". It does not
answer "these three rows disagree with each other" — one question about three
places, which was three comments and three agent sessions.

**`+ another place`, in the composer.** A plain click in pick mode opens the
composer as before. The card then offers `+ another place`, which turns pick
mode back on and makes every click *add* rather than replace, until `esc`. The
targets are listed under `AND ALSO · n`, each removable.

The button is not a convenience, it is the only way in. The note field takes
focus the moment the card opens, and §6 suppresses every bare-letter shortcut
while a field has focus — so `P` cannot re-enter pick mode from there. A
shift-click also adds, for anyone who has learnt it, but nothing in the app
teaches it and nothing should depend on it.

### 4.1 The type

```ts
interface Thread {
  anchor: Anchor | null;
  extraAnchors: Anchor[];   // empty for the ordinary one-target comment
  anchorState: AnchorState | null;  // the worst across all of them
}
```

`anchor` keeps every meaning it had: it is what Apply writes back through, what
the gutter marker sits beside, and what the card quotes. The extras are
additional evidence for the same question, never a second question.

### 4.2 The database, and the first migration

`thread` gains `extra_anchors_json TEXT`, nullable. NULL and `'[]'` both mean
"one target", which is what every row written before this column existed was.

`schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so a column added to that file
reaches a fresh database and no existing one. `openDatabase` therefore walks a
small table of expected columns and `ALTER TABLE`s in whatever is missing.
**Every column added this way must be nullable and must have a meaning when
absent**, because old rows will not have it.

### 4.3 Resolution

Every anchor of a thread is resolved through spec 01 §6.5 unchanged. The
thread's state is the worst of the results — `orphaned` beats `moved` beats
`ok` — because a comment is only as trustworthy as its weakest target. Each
anchor is painted with its **own** state, so a thread showing `moved` names
which of its places moved.

`ResolvedThread.box` becomes `boxes: ScopeRect[]`, one per element or region
anchor. `top` and `label` still come from the primary anchor alone.

### 4.4 The prompt

An agent handed only the first passage answers about the first passage, and
sounds certain doing it. `askPrompt` therefore emits an `## Also highlighted`
list after the primary passage. An extra with no quote of its own is left out
rather than listed blank. `test/prompts.spec.ts` asserts all three cases.

### 4.5 Every place is outlined while the comment is being written

A list of nine cells in the card does not say *which* nine, and the whole
reason to comment on nine cells is that their arrangement matters.

Each target is outlined in the document as it is added — dashed and tinted, so
it reads as "not saved yet" beside the solid outline of a real thread — and
numbered. The card carries the same numbers: `1` on the primary, `2`, `3` … in
the list. The number is the only thing that ties one box in a table to one row
in a card, and both are useless without it.

The box comes from the rect captured at the click, not from resolving the
anchor: nothing exists to resolve until the comment is created, and the scope
chain the rect came from is replaced by the next probe.

Every rect is recorded with the **zoom it was measured at** (§6.1) and rescaled
when drawn. Reading a table more closely before deciding whether the fourth row
belongs in the comment is exactly when someone zooms, and without this the
outlines would slide off what they name.

### 4.6 ⇧, ctrl and ⌘ all add — and ctrl needs its own path

`isAdditive` accepts all three, because all three are somebody's habit: ⌘ from
every macOS list, ctrl from every Windows one, ⇧ from the design.

Ctrl needed more than a flag. **On macOS ctrl-click is a right-click**: the
system turns it into button 2, so no `click` event is ever produced and the
modifier check never ran. It arrives as `contextmenu` instead, and that is
where it is handled — `preventDefault` always, so no system menu appears over
the pick layer, and an additive commit only when `ctrlKey` is set. A plain
right-click carries `ctrlKey: false` and is swallowed, which is what should
happen over a pick layer anyway.

---

## 5. The PDF that would not draw

### 5.1 The finding

Spec 03 §7.1 has the renderer create a `<canvas>` inside the document iframe
and hold its 2D context from outside. The bitmap really is drawn —
`getImageData` reads back every glyph, the element reports `display: block`, a
correct box and full opacity — and **nothing appears on screen**.

Measured on 2026-08-21 with three iframes side by side, each handed an
identical orange square drawn from the parent realm:

| `sandbox` | Square visible |
|:--|:--|
| attribute absent | yes |
| `allow-same-origin allow-scripts` | yes |
| `allow-same-origin` | **no** |

The third row is exactly what spec 01 §5.4 step 2 requires the document iframe
to be. Chromium does not composite a canvas in a frame that cannot run scripts.

Adding `allow-scripts` is not an option — it is the protection that stops a
local HTML file's own scripts from running. So the canvas has to leave the
iframe.

### 5.2 What is drawn now

The canvas is created in the **renderer's own document**, where it composites
like any other, and only the finished picture crosses into the iframe as an
`<img>`, which a sandboxed frame draws perfectly well.

```html
<div class="rex-pdf-sheet" style="width:…;height:…">
  <img class="rex-pdf-bitmap" data-rex-overlay alt="">   <!-- painted lazily -->
  <div class="rex-pdf-page" id="page-3" data-page="3">
    <div class="textLayer rex-pdf-text"><!-- positioned spans --></div>
  </div>
</div>
```

The sheet is the flex item and carries the paper and its shadow. The bitmap and
the page both cover it with `position: absolute; inset: 0`, so `#page-N` has
exactly the box it had before and a region stored as fractions of it still
lands where it was drawn.

**Structure first, pixels later** is unchanged and is still §4.3 of spec 03:
every page's box and text layer exists before `enrichDocument` returns, and
only `img.src` is filled in later under the `IntersectionObserver`.

Bitmaps are drawn at the screen's pixel density, capped at 2× — the page is laid
out at scale 1 so the text layer keeps lining up with the glyphs, but the
picture behind it can carry more pixels than that. PNG, not JPEG: this is text.

### 5.3 Why the `<img>` is outside `#page-N`

A region anchor stores a fingerprint of the element it was cut from, and
`create.ts` takes that fingerprint from `outerHTML` plus the `src` and natural
size of any `img`, `canvas` or `video` inside.

Put the bitmap inside the page and a page's fingerprint would depend on whether
it happened to be painted — so every region on it would orphan or not depending
on how far the reviewer had scrolled when the anchor was written. Keeping the
picture in the sheet leaves `#page-N` holding the text layer and nothing else,
and its markup is byte-identical before and after painting.

Verified on 2026-08-21: all four pages of `sample-files/sample-document.pdf`
hashed identically before and after scrolling, including page 4, which was
unpainted at the first reading and painted at the second.

### 5.4 One-off cost of the change

A region anchor written against the **old** page markup — the one containing
`<canvas>` — no longer matches, and orphans on first open. That is spec 01 §6.6
working as intended: the comment, its quote and its history are kept, and a
wrong-place resolution is never reported as `ok`. It affects development
threads only, since the app is not released.

---

## 6. Shortcuts

Bare letters, because each is something a reviewer does dozens of times a
session and a chord is slower than the mouse. All of them are suppressed while
a text field has focus, so typing a word into a comment never moves a pane.

| Key | Does | Available when |
|:--|:--|:--|
| `P` | Pick element on / off | a document is open and the centre pane shows it |
| `D` | Show the document | always |
| `G` | Show the reference graph | a workspace is open |
| `⇧A` | Ask all | always |
| `⌥` held | Pick element while held | as `P` |
| `↑` `↓` | Widen / narrow the scope | in pick mode |
| `⇧`-click | Add this element to the comment | in pick mode |
| `esc` | Leave pick mode | in pick mode |

`P` replaces the earlier `E`. `⇧A` rather than `A`: a bare letter that starts a
fan-out of paid sessions is one keystroke away from an accident, and spec 01
§8.8 point 4 already treats that fan-out as worth confirming.

### 6.1 Zooming the document

| Gesture | Does |
|:--|:--|
| `⌘` / `ctrl` + wheel | zoom by one notch |
| `⌘` / `ctrl` + `+` or `=` | zoom in |
| `⌘` / `ctrl` + `-` | zoom out |
| `⌘` / `ctrl` + `0` | back to 100% |
| the `nnn%` button in the bar | back to 100% |

Bounded to 0.4× – 3×, in steps of 1.1. The bar shows the figure only when it is
not 100%: a zoom you set and forgot explains a lot of later confusion about a
document that "looks wrong", and a control that appears only when it means
something costs no width the rest of the time.

**It is the document's zoom, not REX's.** Electron's `setZoomFactor` would
scale the whole window and grow the comment cards along with the prose. This
scales only what is under review.

**CSS `zoom`, not `transform: scale`.** `zoom` takes part in layout, so
`getBoundingClientRect()` and `scrollY` inside the frame both report the scaled
geometry and keep agreeing with each other — which is the only reason the
overlay's boxes still land on the right things. `transform` would leave layout
at 1× and every rect the resolver reads would be a lie. It also reflows a
Markdown document to the new width instead of letting a scaled page run off the
side.

Two consequences follow, and both are implemented:

- **A zoom re-resolves**, exactly as a resize does. Every box the overlay draws
  was measured at the old size.
- **The listeners live inside the frame.** An event that happens in an iframe
  never reaches the parent, so a wheel over the prose is invisible to the
  overlay. The wheel listener is registered non-passive, because a passive one
  cannot `preventDefault` and Chromium would apply its own page zoom on top.

A `<webview>` gets the same one line of CSS executed inside it, for the same
reason: `setZoomFactor` is a different thing.

---

## 7. The graph node made of binary

Spec 03 §2 added `.pdf` and `.docx` to `isDocumentPath`, which is the test the
explorer, the renderer dispatch **and the reference graph** all share. The graph
reads every document it lists with `readFileSync(from, "utf8")`.

A DOCX is a zip and a PDF is a binary object graph. Decoded as UTF-8 both
become mojibake, and the mojibake still matches `href="…"` and `[[…]]` — so
`sample-document.docx` acquired an outgoing link to a node whose label was a
run of replacement characters, drawn in the graph as a missing target.

`isTextDocumentPath` — Markdown or HTML — is the predicate the graph needed all
along, and `isDocumentPath` is the wrong one for it. It is applied twice:

- `graph.ts` skips reading a file that is not text at all, so a large PDF is
  never decoded in full on every graph build for nothing.
- `extractLinks` returns `[]` for one, because the caller is the thing that
  gets forgotten and this half is the one with a unit test.

Both formats can hold real hyperlinks. Reading them out would mean unzipping
and running mammoth inside the graph scan, and spec 02 §1.1 rules that out —
the graph is computed on demand and must stay in milliseconds. So they are
nodes with no outgoing links, which is honest, and never a source of invented
ones. `test/links.spec.ts` covers it.

---

## 8. Where the code goes

| File | Change |
|:--|:--|
| `src/shared/types.ts` | `Thread.extraAnchors` |
| `src/shared/channels.ts` | `ThreadCreateRequest.extraAnchors` |
| `src/main/db/schema.sql` | `extra_anchors_json` |
| `src/main/db/database.ts` | `addMissingColumns` — the migration walk |
| `src/main/db/queries.ts` | reads and writes the column |
| `src/main/agent/prompts.ts` | `## Also highlighted` |
| `src/renderer/overlay/anchoring.ts` | `Probe`, `keptIndex`, `scrollBy`, `boxes[]`, worst-state |
| `src/preload/webview.ts` | the same probe contract for tier 2 |
| `src/renderer/overlay/PickLayer.tsx` | the wheel, and the additive commit |
| `src/renderer/overlay/Composer.tsx` | the extras list, and the lift |
| `src/renderer/overlay/App.tsx` | shortcuts, extras state, sticky scope, zoom |
| `src/renderer/overlay/DocumentView.tsx` | draft outlines, and the zoom applied to the frame |
| `src/renderer/overlay/TopBar.tsx` | the zoom readout |
| `src/renderer/overlay/pdf.ts` | paint in the renderer, hand over an `<img>` |
| `src/renderer/overlay/pdfStylesheet.ts` | `.rex-pdf-sheet`, `.rex-pdf-bitmap` |
| `src/main/render/formats.ts` | `isTextDocumentPath` |
| `src/main/workspace/graph.ts`, `links.ts` | never read a binary document |
| `test/prompts.spec.ts` | new — the multi-anchor prompt |
| `test/links.spec.ts` | a PDF or DOCX yields no links |

---

## 9. Out of scope

- **Apply against several anchors.** Apply still writes back through the
  primary anchor only. A comment about three rows is answered as one question;
  editing three places from one diff is a separate problem.
- **Adding a target to a comment that already exists.** The extras are chosen
  while the comment is being written. Editing an anchored comment's targets
  afterwards needs an IPC channel and a card-side editor, and nothing has asked
  for it yet.
- **A gutter marker per extra anchor.** One comment, one marker, beside its
  primary anchor. Several markers for one comment would double-count the
  document's margin.
