# REX 10 — the figure preview, and what is not part of the review

**Version:** 1.0 · 2026-08-24
**Status:** implemented; every acceptance criterion in §5 was run against the two
documents `rules/06-testing.md` names.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md),
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md),
[`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md),
[`04-selection-and-shortcuts/SPEC.md`](../04-selection-and-shortcuts/SPEC.md) and
[`05-selection-as-a-phase/SPEC.md`](../05-selection-as-a-phase/SPEC.md).

> [!note]
> **Two unrelated features, in one spec because they were asked for together.**
> §2 is a way of reading one figure. §3 is a way of narrowing a workspace.
> Neither depends on the other, and they touch no common file except `App.tsx`.

> [!warning]
> **§2 must not write to the document under review, and that is the constraint
> that shapes it.** `create.ts` fingerprints an element from its `outerHTML` for
> a region anchor, so a single added attribute would orphan every region cut
> from that image — silently, at the next open. The affordance is therefore a
> stylesheet and the preview is a sanitised *copy*. §2.2 is the whole argument.

> [!note]
> **§3 adds one table and one IPC channel.** Nothing else is persisted, no
> database is recreated, and nothing is written into the repository under
> review — REX writes files there only through Apply's diff gate, and a
> preference about what to look at is not a change to what is being looked at.

---

## 1. Why

**A diagram drawn into a 620px measure cannot be read**, and that is most of
what a Mermaid flowchart or an architecture SVG is for. The document's own zoom
(spec 04) scales the whole page, so reading one diagram costs the reader their
place in the prose and a second gesture to get it back.

**A workspace is a folder, and a folder is rarely all review material.** Spec 02
§4.2 already skips build output and dependency trees by name. That list is
fixed, unwritable, and — until this spec — unreadable: there was no way to see
what it had skipped, and no way to review a folder it had decided against. In
the other direction there was no way to say "not this one" about an archive, a
vendored copy, or a directory of generated pages.

---

## 2. The figure preview

### 2.1 What opens one

A click on an `<img>` or an `<svg>` in the document, delegated from a listener
the renderer attaches to the iframe — beside the two that already live there,
`jumpToFragmentsInsteadOfNavigating` and `zoomFromInside`.

Three things are **not** figures:

| Not a figure | Why |
|:--|:--|
| anything under `[data-rex-overlay]` | REX's own, a PDF page bitmap most of all. A page *is* the document, and the document already zooms. |
| anything inside `a[href]` | a README's badges are all of them, and a lightbox of a 20px "build passing" is nobody's idea of a bigger preview. |
| anything `aria-hidden="true"` | decoration, by the author's own declaration. |

A click is also ignored while a text selection is open: a drag that started in
the prose and ended on an image fires `click` on the image, and that gesture was
a selection.

Pick and pen mode need no guard. Both layers cover the frame and swallow the
pointer, so a click in either never reaches the document at all.

> [!note]
> **There is no size threshold, and the first version's was a mistake.** It
> excluded an `<svg>` under 80px to keep a lightbox off an inline chevron.
> Nothing in CSS can express "80px", so the cursor could not agree with the rule
> and every small icon advertised a preview that never arrived. A cursor that
> lies is worse than a lightbox over a 16px glyph. `aria-hidden` replaced it
> because it is a signal the document actually declares, and because CSS and
> JavaScript can both read it.

### 2.2 Nothing in the document is mutated

No attribute, no inline style, no wrapper. The reasons are §6.7's for
highlights, and the one `pdf.ts` records at its head for its page bitmaps.

So the `cursor: zoom-in` affordance arrives as one injected
`<style data-rex-overlay>` holding cursor rules and nothing else. It adds no
node to the rendered tree, changes no element's markup, and sets no colour, size
or spacing — a local HTML file still looks exactly as its author wrote it (spec
01 §5.4 point 3). Its selectors are the rule in §2.1, one for one.

### 2.3 The lightbox

Over everything REX draws, inside the shadow root, at z-index 50.

| | |
|:--|:--|
| Zoom | the wheel about the pointer, `+` `−`, and buttons. 0.1× to 12× |
| Pan | pointer drag |
| Fit | `0`, a double-click, or the button |
| Close | Escape, the scrim, or the button |
| Caption | the figure's `<figcaption>`, else the `alt` |

`transform: scale()`, not the CSS `zoom` that `DocumentView` insists on. `zoom`
is required *there* because the anchor resolver reads `getBoundingClientRect()`
off the document and those rects must keep agreeing with the layout under them.
Nothing anchors into the lightbox: it is REX's own chrome holding a copy of a
figure rather than the figure.

**Zoom is about the pointer.** Without it the figure creeps away from whatever
is being examined and every notch of the wheel has to be paid back with a drag.

**The opening view fills the window**, capped at 4×. Opening at 1:1 was built
first and was wrong: a 346×546 diagram in a 1600×1000 window came up as a small
square in the middle of a lot of black — the size it already was in the
document, which is the one thing the reviewer opened it to stop looking at.

**The lightbox owns the keyboard while it is up.** Its listener is capture-phase
on `document` and stops every key, because REX's single-letter bindings (`p`,
`n`, `d`, `g`, `⇧A`) are on `document` too. `stopPropagation` and not
`preventDefault`, so `⇥` still moves focus and `↩` still presses a button.

**It must also take focus to receive them at all**, and that is not a detail:
a preview is opened by clicking a figure *inside the document iframe*, which
leaves focus in the iframe, so every key after it goes to the document under
review and never reaches the renderer's `document`. Escape did nothing.

> [!warning]
> **This passed every automated check while being broken in the app.** A
> dispatched click moves no focus; a real one does. Any test of a key binding
> here has to put focus inside the frame first, or it is testing nothing.

Focus is restored on close, followed down through shadow roots on the way in —
from the outer document, focus anywhere inside REX reads as the host, and
restoring *that* would put the caret nowhere. What comes back is the iframe, so
the reader carries on scrolling the document they were reading.

### 2.4 Two things travel with the figure

Both were found by running it, and both make the difference between a legible
diagram and a wrong one.

**Its appearance.** A drawing lifted out of its document loses its document's
stylesheet, and for SVG that is not cosmetic: `fill` falls back to black, so a
figure of outlined boxes becomes a figure of solid black rectangles. Measured
against a reviewed architecture page, whose diagrams are drawn with classes
(`.d-box-in { fill: var(--paper) }`) rather than presentation attributes. So the
**computed** value of ~38 presentation properties is copied onto a detached
clone before it leaves. Computed is the trick: it has already resolved the
custom properties, the inheritance and `currentColor`, so none of the document's
CSS travels with the figure and none of it can reach REX's own controls.

**Its backdrop.** The nearest ancestor with a non-transparent background. REX's
own paper is right for the two documents it is developed against and wrong the
first time somebody opens a dark one, where a diagram drawn in pale strokes
would disappear on white.

### 2.5 The SVG is sanitised on the way out, and how matters

The iframe is sandboxed without `allow-scripts` (spec 01 §5.4 step 2), so
whatever a document carries is inert *there*. The lightbox is in the renderer,
where script does run, and an `<svg>` moved across that line brings its
`<script>` children and its `onload=` attributes with it. The document was
purified once on the way in (`sanitise.ts`), so this pass should find nothing —
a boundary that is only safe because of what happened upstream is one refactor
away from not being safe at all.

**The node is sanitised, not its `outerHTML`.** DOMPurify duck-types its input,
so a node from the iframe's realm is handled as a node, and importing it keeps
the two namespaces a diagram is built from.

**`HTML_INTEGRATION_POINTS` gains `foreignobject`**, and that is a deliberate
loosening worth stating plainly. Mermaid draws every node label into a
`<foreignObject>` holding an HTML `<div>`; DOMPurify's default integration
points are `['annotation-xml']` alone, so HTML inside a `foreignObject` fails
its namespace check. Measured on 2026-08-24 against `components.md`: all seven
labels came back as `<foreignObject width="64.125" height="24"></foreignObject>`
and the diagram drew as a column of empty boxes — a failure that reads as a
styling bug and logs nothing.

That default guards against mXSS, where sanitised output is **re-serialised and
re-parsed** and the parser resolves the namespaces differently the second time.
That round trip does not happen here: DOMPurify returns a DOM fragment and the
lightbox inserts it as one. The tag and attribute allow-lists are untouched
either way, so `<script>` and every `on*` handler are still removed — the
property that actually matters at this boundary. Verified by inspection of the
inserted subtree: zero `<script>` elements, zero `on*` attributes.

---

## 3. Excluding a folder or a file from the review

### 3.1 Three states, one rule

Resolved per path, exact match first, then the built-in list:

```text
rule = 'exclude'                  → excluded, subtree pruned and never walked
rule = 'include'                  → in review, overriding the built-in skip list
no rule, name in SKIP_DIRECTORIES → skipped by default
otherwise                         → in review
```

The built-in list is unchanged and still matches by **directory name at any
depth**; a rule names one **absolute path** and beats it.

> [!note]
> **Exclusion is absolute.** An `include` rule under an excluded folder is never
> reached, because the walker never descends. That is a deliberate limit and not
> an oversight: descending into a pruned subtree to look for a nested include
> would cost the prune its whole point, which is that it is free.

> [!important]
> **An excluded entry is pruned, not hidden.** Its subtree is never walked, and
> the row itself stays in the tree, marked. Those are two different things and
> only the first one is what makes an exclusion cheap. §3.5 is why the row stays.

### 3.2 Where the rules live

`~/.rex/rex.db`, one new table:

```sql
CREATE TABLE IF NOT EXISTS workspace_rule (
  root        TEXT NOT NULL,
  path        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('exclude','include')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (root, path)
);
```

Keyed by root as well as path, so the same folder opened as its own workspace
and as part of a larger one can be scoped differently. `IF NOT EXISTS`, like
every other table, so no database is recreated and nothing migrates.

### 3.3 How far it reaches

| Surface | How |
|:--|:--|
| the explorer | it is the scan |
| the reference graph | built from `documentPaths(scanWorkspace(…))`, so it follows for free |
| **Ask all** | `WorkspaceTree.excluded` carries the pruned paths, and the fan-out skips a comment about nothing but those |

"Ask all" needs the list because it works from the loaded thread list rather
than from the tree. The rule (`outOfReviewScope`, in `shared/targets.ts`) is
strict in two directions, because both loose readings lose work:

- **Every** file target must be excluded, not merely one. A comment spanning an
  excluded appendix and a chapter still in review is a comment about the chapter.
- A comment with no file target — a synthesis comment, or one on a URL document,
  which sits under no directory — is never out of scope.

**A skip is silent; a skipped ask is not.** The fan-out reports how many
comments it did not send, in the notice bar.

**Comments are never touched.** A comment on an excluded document stays in the
database, stays in the list, and can still be asked on its own. Excluding
narrows what REX *looks at*, never what it *holds*.

Only **user** rules reach this list. A default skip is a scan-cost decision, not
a statement about scope.

### 3.4 The gesture

One item in the tree's context menu, below a rule that separates acting on a
path from changing what REX looks at.

It is a **toggle against the default**, not a setter — which is what keeps the
table holding only genuine departures and leaves nothing behind to clean up:

| Menu | Effect |
|:--|:--|
| *Exclude from review* | deletes an `include` rule if there is one, else writes `exclude` |
| *Include in review* | deletes an `exclude` rule if there is one, else writes `include` |

The renderer says which of the two words the reviewer chose. **Main decides what
that means**, because only main knows the rule the path currently carries; a
renderer that predicted it would be right until the first time it was not.

### 3.5 What an excluded row looks like, and why it is still there

**A rule the reviewer wrote is always drawn.** Excluding is a decision, it is
reversible, and a decision that hides its own undo is a trap. A row that
disappears also says nothing about *why* it disappeared: "did I exclude that, or
has it been deleted?" is a question the tree should never provoke.

**The built-in skip list is the opposite case**, and stays behind a `skipped`
link in the header. It is not the reviewer's decision, there are a dozen of its
names in a typical repository, and drawing `.git`, `node_modules`, `out` and
`dist` in every tree is the noise spec 02 §4.2 removed. The link is the only way
in — until it existed there was no way at all to review a folder REX had decided
to skip. It is view state and is not persisted.

**Excluded is not the same absence as `other`, and must not look like it.** The
tree draws both at once:

| Row | Colour | Marks | What it means |
|:--|:--|:--|:--|
| in review | `--fg-dim` | — | a document REX can open |
| **excluded** | `--muted` | strike + eye-off glyph | *you* took it out of the review |
| skipped by default | `--muted` | eye-off glyph | REX leaves it out unless asked |
| `other` | `--faint` | — | REX cannot open this file at all |

`other` is a fact about the file — nothing can be done about a `.zip`, so
`--faint` lets it recede. An exclusion is a decision about the review, undone by
a right-click, and **an excluded folder is usually full of documents REX reads
perfectly well**. Drawing it in the same grey said "unsupported", which is the
one thing it does not mean.

So excluded is the *lighter* of the two, and the tree reads as one scale: in
review, then excluded, then unopenable. The actionable row is the legible one —
nobody needs to read a row they can do nothing with, and everybody needs to find
the one they want back.

The strike marks a decision, so only a user rule carries it: `node_modules` was
never in the review and there is nothing to cross out. **No hue is used.** Amber,
red, green and steel mean anchor state everywhere else in REX, and an exclusion
is not a state a comment can be in — the three cues are lightness, a strike and
a glyph.

**An excluded document still shows its comment counts.** §3.3 keeps every
comment, and the number of comments about to be left behind is exactly what
somebody needs to judge whether the exclusion was right. An excluded *folder*
shows none, because its subtree was not walked and it honestly cannot say.

**No excluded row is expandable**, folder or not. The subtree was never walked,
which is what makes an exclusion free — a folder that could be opened up would
be excluded in name only.

---

## 4. Beside the document is chrome; over it is paper

> [!warning]
> **This narrows spec 08 §4.1 rather than reversing it.** Only the gutter moves
> to the chrome palette. The mode chips, the path bar and the pen bar keep their
> paper colours, and nothing about the modes, the keys or the layout changes.

Spec 08 drew the whole pane as one sheet — the 32px gutter, the resting chips,
the path bar and the pen bar all in paper colours — so that the page and its
margin read as a single object.

**That held only for Markdown.** REX renders a local HTML file untouched (spec
01 §5.4 point 3), and one with a dark theme of its own put a near-black page
inside a bone-white frame, with a white gutter down the side of it.

The line that survives is about *where a thing is drawn*, not what it is:

> **Beside the document, REX's own rail — chrome. Over the document, floating on
> the page — paper, because there is no fixed ground to match.**

| Surface | Where | Palette |
|:--|:--|:--|
| `.rex-doc` ground, `.rex-gutter`, `.rex-marker-done` | beside | **chrome** — `--bg`, `--panel` on `--rule-soft`, `--sunk` on `--rule` |
| `.rex-mode` chips, `.rex-pathbar`, `.rex-pentool`, `.rex-key` | over | paper, unchanged from spec 08 |
| `.rex-draft-remove` | over | paper, unchanged |

### 4.1 REX does not set the document's colour scheme

A build of this spec measured the document's ground and set a matching
`color-scheme` on the iframe element, so that a dark document would get a dark
scrollbar. **It was wrong and is removed.** It is recorded here because the idea
is an attractive one and will occur to whoever reads this next.

`color-scheme` on an embedder decides what `prefers-color-scheme` resolves to
*inside* the frame. All three HTML review documents this was measured on theme themselves with
exactly that media query and carry no theme script — and the sandbox runs none
(spec 01 §5.4 step 2), so the media query is the only theme they have. Setting
the property therefore does not describe the document, it **overrides** it.

Worse, the value stuck to the element across loads, because the load effect
rewrites `srcdoc` and never cleared it. Open a Markdown file, then one of those
HTML documents, and the second inherited the first's `light` and rendered light
on a dark-mode machine — a document restyled by whichever document preceded it.

Left alone, the frame inherits the reader's own preference, the document's own
media query decides, and REX renders rather than restyles. The document's
scrollbar follows from that, which is the browser's answer and not REX's.

### 4.2 Every scrollbar REX *does* own

`scrollbar-color: var(--rule) transparent` and `scrollbar-width: thin`, on
`.rex-shell` and in `index.html`. Two things it is deliberately not:

- **Not `::-webkit-scrollbar`.** Styling those forces classic, always-visible
  scrollbars on every platform, so a reader whose system draws overlay bars
  would gain permanent ones and lose the width they sit in. `scrollbar-color`
  recolours what the platform already draws. The two cannot be combined —
  Chromium ignores the pseudo-elements once `scrollbar-color` is set.
- **Not `color-scheme: dark`.** It is inherited by the document iframe, and a
  local HTML file with no scheme of its own would flip theme. `scrollbar-color`
  cannot: CSS inheritance stops at the browsing-context boundary.

`scrollbar-color` is inherited; `scrollbar-width` is **not** — measured, so the
latter is applied through `.rex-shell *`.

### 4.3 The mode chips clear the scrollbar

Spec 08 §4.1 inset them 48px, "clear of the 32px gutter" — 32 plus a 16px gap.
The arithmetic left out the document's own scrollbar, ~15px wherever the system
draws classic bars, so the gap collapsed to a hairline. Now 72px: 32 for the
gutter, 15 for the widest scrollbar, 25 of clearance.

## 5. What this adds

| | |
|:--|:--|
| Dependencies | **none** |
| IPC channels | one — `workspace:exclude`. `workspace:tree` gains a `reveal` argument |
| Tables | one — `workspace_rule` |
| Shapes | `TreeEntry.exclusion`, `WorkspaceTree.excluded`, `PreviewFigure` |
| New files | `renderer/overlay/preview.ts`, `renderer/overlay/Lightbox.tsx`, `test/workspace.spec.ts` |

Invariants I1, I2 and I3 are untouched. The resolver still runs in the renderer;
only main touches SQLite; there is no port.

---

## 6. Acceptance

Run against the two documents `rules/06-testing.md` names, at 1600×1000.

- [x] A Mermaid diagram opens with **every label legible** — the `foreignObject`
      case, and the one that fails silently.
- [x] An inline SVG in `2026-08-20-architecture-explained.html` opens **drawn as
      the document draws it**: fills, connector colours, arrowheads, fonts.
- [x] A Markdown image opens; its `<figcaption>` is the preview's caption.
- [x] A **linked** image does not open one.
- [x] The opening view fills the window; the wheel zooms about the pointer; a
      drag pans; `0` refits; Escape closes.
- [x] `p` pressed over an open preview does **not** toggle pick mode.
- [x] The sanitised subtree holds no `<script>` and no `on*` attribute.
- [x] Excluding a folder **leaves its row in the tree**, marked, with its
      subtree pruned and its documents gone from the graph. Siblings untouched.
- [x] An excluded row is told apart from an unopenable one at a glance, and an
      excluded document still shows its comment counts.
- [x] `skipped` reveals the built-in list and nothing else, and **its subtrees
      are still not walked**.
- [x] *Include in review* on a default-skipped folder brings it back **with its
      children**.
- [x] Both toggles round-trip to zero rows in `workspace_rule`.
- [x] An exclusion survives a restart; the reveal toggle does not.
- [x] An HTML document that themes itself with `prefers-color-scheme` renders
      dark on a dark-mode machine — **and still does after a light document has
      been opened in the same window**, which is the ordering that broke it.
- [x] The gutter is chrome against either kind of document; the mode chips and
      both pane bars are unchanged from spec 08.
- [x] The mode chips clear the document's scrollbar.
- [x] No scrollbar REX draws is light; the window itself has none at all.
- [x] Dragging to pan a Mermaid diagram in the preview selects no text.
- [x] Escape closes the preview **after zooming and panning, opened by a real
      click on a figure inside the document** — the case a dispatched click
      cannot reproduce. `+` reaches it too, `p` does not leak to pick mode, and
      focus returns to the frame on close.
- [x] `test/anchor.spec.ts` and the other nine suites pass;
      `nvim-tools --json --all` adds no finding.
