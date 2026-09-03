# REX 27 — the width of the page, and the dark paper

**Version:** 1.1 · 2026-08-31
**Status:** **built, and driven in a live window.** Milestones 0–4 are in the
tree; §7.1 was run against an isolated REX on port 9444 the same day, and §9
records the four places the build departed from version 1.0 — one of them a bug
the milestone-0 test caught before anybody looked at a screen (§9.2), and one a
bug only the live run could have caught (§9.3). §7.1 step 7 is the single check
not run: it needs a paid ACT run to make a working copy.
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) §5.4 point 3 (an
HTML document keeps the author's own styles), §5.4 step 2 (the frame runs no
script); [`03-rich-rendering/SPEC.md`](../03-rich-rendering/SPEC.md) §5.3 (the
Markdown measure), §5.2 (the alert callouts), §5.7 (the code colours), §5.8 (the
Mermaid pass), §4.3 (the DOM must be final before the surface is handed up);
[`08-shell-redesign/SPEC.md`](../08-shell-redesign/SPEC.md) §4 (a mode control
belongs where the mode acts); [`15-the-working-copy/SPEC.md`](../15-the-working-copy/SPEC.md)
§6.1 (two panes, side by side);
[`18-what-the-colours-mean/SPEC.md`](../18-what-the-colours-mean/SPEC.md) (the
colour vocabulary); [`25-choosing-the-model/SPEC.md`](../25-choosing-the-model/SPEC.md)
§6.1 (the `setting` table, and that it is not a settings system).

> [!note]
> **This spec changes one document and one only: the Markdown file REX typesets
> itself.** Nothing here touches an HTML file, a PDF, a DOCX or a deck. §3 is
> the argument for that line, and it is the whole reason this spec is small.

---

## 1. Why

REX draws a Markdown document 620px wide in a pane that is usually twice that.
The reviewer's own words, 2026-08-31:

> First of all, the markdown document is really thin. You can see in the image
> that it has a huge amount of white space on the left side and on the right
> side as well. […] If I click it, it will enable a full-width mode, where all
> the text will take up the full width of the screen. When I disable it, it will
> look like it does now.
>
> Secondly, if we could have an additional UI element that would enable or
> disable dark mode, it would provide two modes for the markdown file: dark mode
> and light mode.

### 1.1 The measurement

`MEASURE.width` is `620px` (`src/shared/tokens.ts:32`), set on `body` by
`MARKDOWN_STYLESHEET` (`src/main/render/stylesheet.ts:48`). On the reviewer's
screen, 2026-08-31, the window was 2000px and the document pane about 1300px.
620px of text therefore left roughly 340px of empty paper on each side — more
white space than text.

620px is not a mistake. It is about 75 characters at 15px, which is the measure
typography has settled on for continuous prose, and it is why the default does
not change. But a review is not always continuous prose: a wide table, a
Mermaid diagram, a code block with long lines and a side-by-side comparison all
want the pane, and today they are all squeezed into 620px while 680px of the
pane goes unused.

### 1.2 Why dark is not just taste

`stylesheet.ts:10` says, today:

> Light only, deliberately. The design draws documents on paper and REX's chrome
> in the dark around them; following the system into dark mode would make a
> Markdown file look nothing like the HTML file beside it in the explorer, and
> would put a review's two halves on different grounds.

Both halves of that reasoning survive this spec, and §2 is written so that they
do. What is rejected is only the conclusion — *therefore there is no dark
paper*. The argument is against **following the system automatically**, and the
reviewer is not asking for that. A switch they press themselves is a different
thing: the two halves move together because they read one setting, and the
Markdown file differs from the HTML file beside it only while the reviewer has
asked it to.

---

## 2. The rule

One sentence decides every row below.

> **REX may offer to change how it typesets a page it typeset itself. It never
> restyles a page whose styles are somebody else's.**

Three consequences, and they settle §3, §4.2 and §6:

1. **Markdown only.** It is the one format where the stylesheet is REX's own
   invention rather than a rendering of what the file says.
2. **Nothing is written to the file.** Both switches are how REX draws, not what
   the document is. Neither ever reaches the reviewer's disk.
3. **The document's meaning does not change.** Spec 18's vocabulary is a set of
   hues, and this spec darkens grounds and lifts inks. **Hue is the meaning;
   lightness is the mode.** A warning callout is the same amber in both.

---

## 3. Changes to specs 01, 03 and 18

| Spec | Said | Now |
|:--|:--|:--|
| 03 §5.3 | The Markdown measure is `620px`. | `620px` is the **default** measure. `data-rex-wide` on the page removes it, and nothing else does. |
| 03 §5 (`stylesheet.ts:10`) | "Light only, deliberately." | Light **by default**, and dark only under a switch the reviewer pressed. The comment is rewritten to say what it now guards: never *follow the system*, and never restyle an author's own CSS. |
| 03 §5.8 | The Mermaid pass runs once, at load, on `theme: "neutral"`. | It runs again when the paper changes, on the theme that matches. The source is kept so the second run has something to draw. |
| 01 §5.4 point 3 | An HTML document keeps its own styles. | Unchanged, and now load-bearing: it is why the two switches are not offered on one. |
| 18 | Seven facts, seven colours. | Unchanged. Each colour gains a dark-paper value at the same hue. The anchor highlights keep their light washes — §6 point 2. |

Nothing else in any spec moves. The anchors, the panes, the agent, Apply and the
working copy are untouched.

---

## 4. What the reviewer does

### 4.1 The strip, at the top right of the pane

Two buttons, drawn exactly as `ModeStrip` draws the three at the foot of the
pane — same `.rex-mode` pill, same `.rex-key` cap, same 26px height — because
they are the same kind of thing and REX has one way of drawing a control that
turns on.

| Button | Key | On means |
|:--|:--|:--|
| `wide` | `W` | the text fills the pane |
| `dark` | `T` | the paper is dark |

`W` and `T` are free. `P`, `N`, `D`, `G`, `A` and `B` are taken (`App.tsx`'s
`switch`), and `D` in particular is already the Document view — which is why the
dark switch is `T` for theme.

A button that is on is drawn in the on state the mode strip already uses, so the
strip says what the page is without the reviewer having to compare it against a
memory of the last document.

### 4.2 Only where REX owns the stylesheet

The strip is drawn only for a Markdown document. The test is the file, not the
frame: `.md`, `.markdown`, `.mdown`, `.mkd`.

| Format | Strip | Why |
|:--|:--|:--|
| Markdown | **both buttons** | REX wrote every rule on the page. |
| HTML | none | Spec 01 §5.4 point 3 — the author's CSS is the document. Restyling it is reviewing REX's opinion of the file rather than the file. |
| DOCX | none | Mammoth's HTML is a *rendering of what the file says*: the Word document's own headings, its own emphasis. REX supplies the page around it, and §2 draws the line at the page REX invented. |
| PDF | none | A picture of a page. There is no text to reflow and no ground to change without inverting somebody's artwork. |
| PPTX | none | A slide has a fixed size and its own colours, both taken from the deck. |

DOCX is the near miss, and it is deliberate. It shares `markdownPage` and
therefore shares the stylesheet, so making it follow later is a one-line change
to the test in §5.2 — but it is not this spec's to make, because the reviewer
asked for `.md` and a Word document's own colours are the author's.

### 4.3 `wide` means no measure

`max-width` goes away. The page keeps its `24px` side padding, so text never
touches the pane's edge, and it keeps every other rule. At 1300px that is about
160 characters a line, which is too long for prose and exactly right for the
table that prompted the request — which is why it is a switch and not a new
default.

### 4.4 `dark` means a second palette, same hues

`PAPER` gains a twin, `PAPER_DARK`, in `src/shared/tokens.ts`. Every value is
the light one's counterpart at the same hue and the mirrored lightness.

| Role | Light | Dark |
|:--|:--|:--|
| `bg` — the ground | `#fbfaf8` | `#24221f` |
| `ink` — headings | `#211f1c` | `#f4f2ee` |
| `inkBody` — body copy | `#3d3a36` | `#dbd7d0` |
| `inkMuted` — captions | `#6b655d` | `#9b948a` |
| `rule` — borders | `#e0ddd7` | `#3f3b35` |
| `wash` — table heads, code | `#f2f0ec` | `#2c2a26` |
| `link` | `#2f5da8` | `#7fa8e8` |

The ground is **warm**, and that is not decoration. REX's chrome is
`--bg: #0e1012` with `--panel: #191c1f`, both cool near-blacks. A cool paper on
cool chrome is one surface; a warm paper on cool chrome is still a sheet lying
on a desk, which is the whole visual idea spec 03 §5 started from.

It is also **lighter than a first reading of that sentence suggests**, and §9.2
records why: the ground this spec was first written with measured 1.10:1
against the shell and 1.02:1 against the sidebar beside it. Two dark greys are
exactly the pair nobody can judge by looking at one of them.

The callouts and the code colours follow the same rule — hue kept, lightness
mirrored:

| Callout | Light rule | Dark rule | Dark wash |
|:--|:--|:--|:--|
| note | `#2f5da8` | `#7fa8e8` | `#172032` |
| tip | `#2f7d63` | `#6cbb9c` | `#142320` |
| important | `#7a4fa3` | `#b389d6` | `#201a2b` |
| warning | `#c08a12` | `#d9ac3c` | `#2a2213` |
| caution | `#b03a2e` | `#e0796a` | `#2b1a17` |

| Code token | Light | Dark |
|:--|:--|:--|
| keyword | `#7a4fa3` | `#b389d6` |
| string | `#2f7d63` | `#6cbb9c` |
| number | `#b03a2e` | `#e0796a` |
| attr | `#8a6d1f` | `#cba94f` |
| title | `PAPER.link` | `PAPER_DARK.link` |
| comment, meta | `PAPER.inkMuted` | `PAPER_DARK.inkMuted` |

`::selection` goes from `#b6d0f2` to `#2f4a6d` — the same blue, dark enough to
read light ink through.

Every dark ink above clears 4.5:1 against `#1b1a18`; `inkBody` clears 12:1.
Contrast is checked once, here, rather than argued about later.

### 4.5 Pictures keep their paper, and Mermaid changes theme

An image is the author's, and REX does not invert it. A Mermaid diagram is drawn
by REX, and REX redraws it.

| On the page | In dark mode |
|:--|:--|
| `figure` — an image, its caption | keeps a **light** card: `PAPER.wash` ground, `PAPER.inkMuted` caption. A PNG with a transparent ground is unreadable on a dark page, and inverting somebody's screenshot is a lie about what it shows. |
| `pre.rex-mermaid[data-rendered]` — a drawn diagram | **redrawn** on Mermaid's `dark` theme, no card. It is REX's drawing, made from the fence's source, so REX may make it again. |
| `pre.rex-mermaid` that failed to draw | stays source text on the dark `wash`, exactly as any other code block. Spec 03 §4.2 rule 3 is untouched. |

The redraw needs one thing the current pass does not do: **keep the source.**
`mermaidPass` replaces the block's text with the SVG, so after the first render
there is nothing left to render again. The source moves to `data-source` before
the replacement, and the pass reads it from there on every run after the first.
A `data-` attribute is not text content, so the anchor text index does not see
it and no comment moves.

`drawDiagramPng` — the PowerPoint path, spec 11 §7.4.2 — keeps `neutral`
whatever the paper is doing. A slide is a light ground and the deck is not the
reviewer's screen.

### 4.6 Both panes, one setting

While a working copy exists there are two documents on screen (spec 15 §6.1).
Both follow the switch. Two grounds in one comparison would be the exact fault
`stylesheet.ts:10` warned about, arriving from the inside.

### 4.7 It is remembered

The two values live in the `setting` table spec 25 §6.1 built, under
`view.measure` (`narrow` | `wide`) and `view.paper` (`light` | `dark`). Absent
means the default: narrow, light. A reading preference that resets every launch
is a preference the reviewer sets every launch.

This does not make `setting` a settings system, and spec 25's warning still
stands: nothing reads a key that a spec does not name. This spec names two.

---

## 5. Where the code goes

### 5.1 The files

| File | Change |
|:--|:--|
| `src/shared/tokens.ts` | `PAPER_DARK`, `ALERT_DARK`, `CODE_DARK`, and `SELECT` for the two selection colours. |
| `src/shared/types.ts` | `PaperView = { wide: boolean; dark: boolean }`, and `PAPER_VIEW_DEFAULT`. |
| `src/shared/formats.ts` | **New (§9.1).** `extensionOf` and `isMarkdownPath`, with no `node:path`, so both processes can ask the same question. |
| `src/main/render/formats.ts` | Re-exports `isMarkdownPath` from there. One list. |
| `src/shared/channels.ts` | `paper:view` and `paper:view-set`, and the two methods on `RexApi`. |
| `src/preload/index.ts` | The two methods on the bridge. |
| `src/main/db/settings.ts` | `VIEW_MEASURE_KEY`, `VIEW_PAPER_KEY`, `paperView()` and `setPaperView()` over the two functions already there. |
| `src/main/ipc.ts` | The two handlers. |
| `src/main/render/stylesheet.ts` | Every colour becomes a custom property on `:root`; a `:root[data-rex-dark]` block redefines them; a `:root[data-rex-wide] body` rule drops the measure; the light card for figures; the header comment rewritten (§3). |
| `src/renderer/overlay/frame.ts` | `applyPaperView(inner, view)` — the two attributes, beside `applyZoom`. |
| `src/renderer/overlay/mermaid.ts` | `mermaidPass(doc, theme)`, `data-source` kept, `mermaidConfig(theme)` in place of the frozen `MERMAID_CONFIG`. |
| `src/renderer/overlay/enrich.ts` | The theme travels with the pass, so a document is drawn once in the theme it will keep. |
| `src/renderer/overlay/PaperStrip.tsx` | **New.** The two buttons. |
| `src/renderer/overlay/DocumentView.tsx` | Mounts the strip; applies the view on load and on change; re-measures. |
| `src/renderer/overlay/OriginalPane.tsx` | Applies the view on load and on change. No strip — one strip governs both panes. |
| `src/renderer/overlay/App.tsx` | The state, the keys, the load from `setting`, the save on change. |
| `src/renderer/overlay/overlay.css` | `.rex-paper` — the strip's position, and the on state. |
| `test/paper.spec.ts` | **New.** §7 milestone 0. |

### 5.2 The mechanism: an attribute, not a re-render

The stylesheet is already inside the frame. Both switches are therefore one
attribute on the frame's `documentElement`:

| Switch | Attribute | Rule |
|:--|:--|:--|
| wide | `data-rex-wide` | `:root[data-rex-wide] body { max-width: none; }` |
| dark | `data-rex-dark` | `:root[data-rex-dark] { --paper-bg: …; … }` |

Nothing is asked of main, no `srcdoc` is rewritten, and the document does not
reload — so the scroll position, the resolved anchors and any half-built
selection all survive the click. This is the mechanism `applyZoom`
(`frame.ts:50`) already uses, for the same reason.

Whether the strip is drawn at all is decided from `doc.ref.value`'s extension,
in the renderer. `isMarkdownPath` lived in main and imported `node:path`, which
the renderer's bundle does not have — so §9.1 moved the list to
`src/shared/formats.ts` and both sides import it. `test/paper.spec.ts` asserts
the pure `extensionOf` and `node:path`'s `extname` agree on every shape REX
meets, the dotfile and the `notes.md/` directory included.

### 5.3 `color-scheme` inside the page is safe, on the frame it is not

`DocumentView.tsx:470` carries a warning worth repeating, because this spec sets
`color-scheme` and the warning appears to forbid it:

> NOTHING SETS `color-scheme` ON THIS FRAME […] `color-scheme` on the embedder
> decides what `prefers-color-scheme` resolves to *inside* the frame.

That is about the **iframe element**, in REX's own document. This spec sets
`color-scheme: dark` inside the page, in a stylesheet REX wrote, under an
attribute REX put there. A page's own `color-scheme` does not feed
`prefers-color-scheme`; it decides the scrollbar and the form controls, which is
exactly what is wanted. The frame element is still never touched, and a
self-theming HTML document still resolves the media query against the reviewer's
own preference.

### 5.4 Both switches re-measure

`wide` reflows every line, so every box the overlay has drawn — outlines, place
badges, margin bars, change boxes — was measured against a layout that no longer
exists. `dark` reflows nothing on its own, but redrawing a Mermaid diagram can
change its height.

So both call the sweep, on the path the zoom already uses. `onZoomApplied`
(`App.tsx:846`) is renamed **`onReflowed`**: it is no longer only the zoom's,
and a callback named after one of its three callers is how the third one gets
forgotten.

For `dark` the sweep must run **after** the Mermaid pass settles, not beside it
— spec 03 §4.3's rule, arriving on the second render instead of the first.

---

## 6. What this gives up

1. **DOCX keeps one ground.** A Word document beside a Markdown one will differ
   while dark is on. §4.2 says why, and the fix — should the reviewer want it —
   is a one-line change to the test.
2. **The anchor highlights keep their light washes.** `HIGHLIGHT.okBg` and its
   four siblings are near-white, and `highlight.ts` already pairs each with
   `PAPER.ink`, so a highlighted passage on a dark page is a light band with
   dark ink: legible, and louder than it is on paper. Seven new highlight
   colours would be a second reading of spec 18, and spec 18 is a vocabulary
   rather than a palette. If the band reads badly in a live window, that is a
   spec 28, not a patch here.
3. **The mode pills stay light.** `.rex-mode` is `#f0eee9` on `#e2ded7`, drawn
   over the paper. On a dark page it reads as light chrome over dark paper,
   which is what it is.
4. **`wide` is all or nothing.** No second measure, no drag handle, no
   per-document memory. One switch, two states, remembered once.
5. **Nothing follows the system.** REX does not read `prefers-color-scheme` for
   its own paper, ever. §1.2 is the argument, and an automatic dark paper is the
   thing the existing comment was right to refuse.

---

## 7. Milestones

| # | Ends in | Acceptance |
|:--|:--|:--|
| 0 | The palette, and the extension test | `PAPER_DARK`, `ALERT_DARK`, `CODE_DARK` in `tokens.ts`; `npm run test:paper` asserts every light role has a dark twin, that no dark ink falls under 4.5:1 on its own ground, that the paper is not the shell, that no rule in the stylesheet still names a colour, and that `extensionOf` agrees with `node:path`. 16 tests, `node --test` green. |
| 1 | The width switch | `data-rex-wide` drops the measure; `PaperStrip` drawn top right for a `.md` document and for nothing else; `W` toggles it; the sweep runs after and every outline still sits on its own paragraph. |
| 2 | The dark paper | `data-rex-dark` repaints the page; `T` toggles it; headings, body, links, tables, code, all five callouts and the selection all read; figures keep a light card. |
| 3 | Mermaid follows | The source survives the first render; the pass runs again on `dark`; `drawDiagramPng` still draws `neutral`; the sweep runs after the redraw. |
| 4 | Remembered, and live | §7.1. |

### 7.1 How milestone 4 is checked

In an agent REX (`.claude/hooks/playwright-launch.sh npm run dev`), with this
repository opened as the workspace — its own specs carry Mermaid diagrams,
callouts, tables and code, which no other document to hand does.

1. Open `docs/my-specs/01-initial/SPEC.md`. Done when: the strip is at the top
   right, both buttons off, and the text is 620px wide.
2. Press `W`. Done when: the text fills the pane, the button reads on, and the
   side padding is still there.
3. Take a comment on a paragraph, then press `W` twice. Done when: the outline
   is still on that paragraph in both widths, and the comment still says
   `anchored · resolved exactly`.
4. Press `T`. Done when: the ground is dark, every heading, link, table border,
   code token and callout reads, the Mermaid diagrams are drawn in Mermaid's
   dark theme, and any image sits on a light card.
5. Open an HTML file, a PDF and a `.pptx` from this workspace. Done when: no
   strip is drawn on any of them, and each renders exactly as it did before.
6. Quit REX and start it again. Done when: the Markdown document comes back
   wide and dark, without the strip being touched.
7. Run an ACT so a working copy exists, and set the pane control to `Both`. Done
   when: both panes are dark and both are wide.
8. `git status --porcelain` in the workspace shows only what the ACT wrote. The
   two switches write no file.
9. `nvim-tools --json --all` adds no finding against the baseline.

---

## 8. Rejected

| Idea | Why not |
|:--|:--|
| Follow `prefers-color-scheme` automatically | §1.2. It is the thing `stylesheet.ts:10` refused, and it refused it correctly: the reviewer's OS theme is not a statement about the document they are reading. |
| A slider, or three or four measures | §6 point 4. Two states are a switch a hand learns; four are a setting a reviewer thinks about. Obsidian ships exactly one such toggle and this is the same one. |
| Put the switches in the top bar | Spec 08 §4 — a control belongs where it acts. These act on the paper, so they sit on the paper, in the corner opposite the modes for the same reason the modes are at the foot. |
| Set `color-scheme` on the iframe element and let the page follow | Measured, and it broke rendering: it decides `prefers-color-scheme` inside the frame, and it stuck to the element across loads. `DocumentView.tsx:470` records it in full. |
| Invert images with a CSS filter in dark mode | It lies about what a screenshot shows, and a photograph becomes a negative. §4.5 gives them a light card instead. |
| Re-render the document in main when the switch flips | A reload throws away the scroll position and every resolved anchor, to change two colours. §5.2 is one attribute. |
| Give DOCX, PDF and PPTX the switches too | §4.2. Each would mean restyling something that is not REX's — a Word document's own colours, somebody's artwork, a deck's design. |
| Store the two values per document | A reading preference is about the reader, not the file. Per-document memory means opening ten files and setting ten switches. |
| A third switch for the font size | The zoom already does this, with `⌘+`, `⌘−` and `⌘0`, and it is in every reader's hands already. |

---

## 9. Where the build departed from version 1.0

### 9.1 One extension list, not two and a test that they agree

§5.2 of version 1.0 accepted a **copy** of the Markdown extension set in the
renderer, because `render/formats.ts` imports `node:path` and the renderer's
bundle has no such module. It planned a test asserting the copy still matched.

That test only exists because the duplication does. The list moved instead to
`src/shared/formats.ts` — `extensionOf` written with `slice` and
`lastIndexOf` rather than `extname`, and `isMarkdownPath` over it — and
`render/formats.ts` now imports and re-exports it. Every existing caller keeps
importing `isMarkdownPath` from where it always did.

`test/paper.spec.ts` still tests the boundary, but it now tests a real one:
that `extensionOf` and `node:path`'s `extname` agree on thirteen shapes,
including `.md` as a whole filename (both answer `""` — a leading dot names the
file, not its type) and `notes.md/a.pdf`, where the directory is not the
document.

### 9.2 The dark paper was too dark, and arithmetic said so first

Version 1.0's ground was `#1b1a18`. Against REX's own shell — `--bg: #0e1012`,
`--panel: #191c1f` — it measured **1.10:1 and 1.02:1**. The document would have
stopped being a separate surface at all, and the sidebar beside it would have
been the same colour as the page.

Nobody was going to catch that by looking, which is the point: a person judging
one dark grey has nothing to judge it against. `test/paper.spec.ts` asserts the
paper clears the shell's own ground-to-panel step of 1.11:1, and it failed on
the first run. The ground is `#24221f`, `wash` is `#2c2a26` and `rule` is
`#3f3b35`; every ink still clears 4.5:1, and `inkBody` clears 11:1.

### 9.3 Two blank white boxes, which only the live run could show

`.rex-key` — the cap that draws `W` and `T` — is white and states **no colour of
its own**, so it inherits the button's. On `.rex-mode-on`'s solid pill that is
`#fbfaf8`: white letters on a white cap. Both switches, when on, drew two blank
boxes.

Every assertion in this spec passed while that was true, and reading the CSS
would not have found it either — the rule that broke it is the rule that was not
written. The fix is `.rex-mode-on .rex-key { color: #211f1c; }`, placed **after**
the base `.rex-key` rule rather than beside `.rex-mode-on`: the other order puts
a (0,1,0) selector after a (0,2,0) one for the same element, which reads
correctly today and silently stops the moment either moves. Biome's
`noDescendingSpecificity` is the check, and it fired.

### 9.4 The theme travels with the enrichment pass

Version 1.0 said the Mermaid pass "runs again when the paper changes". It does —
but a document opened with `dark` already remembered would then have drawn every
diagram light and redrawn it a moment later: a flash, and a whole-document
re-measure for nothing.

So `enrichDocument(doc, source, theme)` takes the theme and hands it to the
pass, and both panes apply the paper **before** they enrich. A remembered dark
paper draws its diagrams dark on the first render. The second run happens only
when the reviewer presses `T`.

### 9.5 How it was tested

The reviewer's own REX held port 9334, so it was neither driven nor disturbed.
The run used a second instance on its own port and its own database —
`PW_CDP_PORT=9444 REX_CDP_PORT=9444 REX_DB_PATH=…` through
`.claude/hooks/playwright-launch.sh` — driven over raw CDP, because the
Playwright MCP is pinned to 9334.

| Check | Result |
|:--|:--|
| The strip, on a Markdown document | Both buttons drawn, top right, 620px measure |
| `W` | `data-rex-wide` set, `max-width: none`, body 620px → 999px in a 1014px pane, the 24px padding kept |
| A place taken with pick, then `W` | The outline moved from (367, 584) to (338, 641) and still sat on its own `li`. The sweep ran |
| `T` | Ground `#24221f`, body `#dbd7d0`, headings `#f4f2ee`, links `#7fa8e8`, table heads and code on `#2c2a26`, `color-scheme: dark`, 18 code blocks with `#b389d6` keywords |
| The diagram, light → dark → light | Node fill `#fcfcfc` → `#474949` → `#fcfcfc`, and `data-source` survived every pass |
| A `.pptx` and an `.html` | No strip on either, both render exactly as before |
| Quit and start again | Came back wide and dark, from `view.measure` and `view.paper` in the database, with the diagram drawn dark on the FIRST render |
| Another Markdown document, opened after | Inherited the setting without being asked |

Not run: §7.1 step 7, the two panes. It needs a working copy, which needs a paid
ACT run. §4.6 is built and read in code — one `paper` prop, `OriginalPane`
applying it on load and on change — and it has not been seen on a screen.
