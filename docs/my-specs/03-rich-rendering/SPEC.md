# REX 03 — rich document rendering

**Version:** 1.0 · 2026-08-20
**Status:** specified, not implemented
**Depends on:** [`01-initial/SPEC.md`](../01-initial/SPEC.md) and
[`02-workspace-and-graph/SPEC.md`](../02-workspace-and-graph/SPEC.md), both
implemented and passing.

> [!note]
> This document extends specs 01 and 02. It does not restate them. Where they
> touch, §2 says exactly what changes; everywhere else spec 01 still governs,
> including all three invariants and the whole anchoring model.

---

## 0. How to use this document

Read §1 to §4 first. §4 is the one architectural decision here — everything
after it is an application of it. Then work the four milestones in §11, in
order.

**Four rules for the implementer:**

1. **Neither format nor plugin may weaken the three invariants of spec 01 §3.**
   No renderer added here opens a port, none gives the renderer process a
   database handle, and none moves anchor resolution out of the renderer.
2. **The document iframe never runs script.** Spec 01 §5.4 step 2 puts the
   document in `<iframe sandbox="allow-same-origin">` with no `allow-scripts`,
   and that does not change. When drawing needs JavaScript, the *renderer
   process* reaches into the iframe and draws. §4 is that mechanism.
3. **Use the call shapes in §13, not the ones you remember.** PDF.js removed
   `renderTextLayer` in version 5 and deprecated `canvasContext` in version 6.
   Both still appear in most tutorials and in most model training data, and both
   fail at runtime rather than at compile time. §13 records what was verified,
   when, and against what.
4. **Where this document is silent, prefer the simplest thing that works.**
   §12 lists what is deliberately out of scope.

---

## 1. What this adds

Three things, and one seam that carries all of them.

**Markdown that renders what people actually write.** Today REX runs plain
`markdown-it` with no plugins, so a normal README loses most of itself: GitHub
alerts, task lists, footnotes, heading ids, math, diagrams and code colour all
fall through as literal text. §5.

**PDF and DOCX.** Spec 01 §5.2 listed both as tier 3, "not scheduled". They are
scheduled now. §7 and §8.

**The enrichment seam.** PDF needs a canvas and Mermaid needs a live DOM, and
neither can run inside a script-free iframe. One place in the renderer draws
what static HTML cannot express, and the anchor resolver runs after it. §4.

### 1.1 The finding that started this

`sample-files/sample-document.md` was written to exercise a renderer. Measured
in the running app on 2026-08-20, nine things were wrong:

| # | The source has | REX drew | Cause |
|:--|:--|:--|:--|
| 1 | 3 shields.io badges | broken-image icons | page CSP blocks `https:` images |
| 2 | `> [!TIP]`, `> [!WARNING]` | a plain quote, with the literal text `[!TIP]` | no alert rule |
| 3 | `- [x]` task lists | the literal text `[x]` and `[ ]` | no task-list rule |
| 4 | a Mermaid flowchart | the diagram source, as a code block | no Mermaid |
| 5 | `$$…$$` and `$w$` | the LaTeX as literal text | no math |
| 6 | `[^1]` footnote | literal `[^1]`, and the note as a stray paragraph | no footnote rule |
| 7 | 9 table-of-contents links | **9 dead links — no heading carries an `id`** | no anchor rule |
| 8 | fenced code in 5 languages | correct, but no colour | no highlighter |
| 9 | an image with a caption | an image, then an italic paragraph | nothing emits `<figure>`, so the `figure` and `figcaption` rules already in the stylesheet are dead code |

Headings, tables with column alignment, ordered and nested lists, `<details>`,
`<sub>` and horizontal rules were all correct and stay as they are.

### 1.2 What stays the same

- **The anchoring model.** Spec 01 §6 is untouched. Every format added here
  ends up as DOM in the same iframe, and the resolver does not learn a fourth
  format — it learns nothing at all.
- **Apply.** Still Markdown and HTML only. PDF and DOCX have no source line to
  write back to, exactly as spec 01 §5.2 says.
- **No database migration.** Nothing here stores anything.
- **No port.** `pdfjs-dist` ships a *Web Worker*, which is a thread, not a
  server. Invariant I3 is about listening sockets and is not touched.

---

## 2. Changes to specs 01 and 02

| Spec | Change |
|:--|:--|
| 01 §3.2 Dependencies | Adds the eight packages in §3. |
| 01 §5.2 Format tiers | PDF and DOCX move from "not scheduled" to milestones 13 and 14. DOCX moves from tier 3 to **tier 1** — see §8. |
| 01 §5.3 Markdown rendering | Extended by §5. `data-src-line` is unchanged and still stamped on every block. |
| 01 §5.4 HTML rendering | **Bug fix.** Point 3 requires a local HTML file's own `<link rel=stylesheet>` to survive. Today `style-src 'self' 'unsafe-inline'` blocks it. §6. |
| 01 §4 Shared types | `OpenedDocument.html` is replaced by `presentation` (§9). This is the one breaking type change. |
| 01 §6 Anchoring | **Unchanged in code.** §7.3 records that the four layers keep working in a PDF but change which one leads. |
| 01 §7 Overlay | Unchanged. |
| 01 §9 Database | **Unchanged.** No new tables, no migration. |
| 01 §10 IPC | **Unchanged.** No new channels. |
| 02 §4.1 What is a document | `isDocumentPath` gains `.pdf` and `.docx`; `unopenableReason` loses them. |

---

## 3. Dependencies

Added to spec 01 §3.2. The **Where** column is the point of this table: a
package that needs a DOM cannot live in main, and a package that needs the
filesystem cannot live in the renderer.

| Package | Version | Where | Purpose |
|:--|:--|:--|:--|
| `markdown-it-anchor` | `^9.2.1` | main | heading `id`s (§5.5) |
| `markdown-it-footnote` | `^4.0.0` | main | footnotes (§5.1) |
| `@vscode/markdown-it-katex` | `^1.1.2` | main | finds the math delimiters |
| `katex` | `^0.16` | main | renders the math. Synchronous, needs no DOM |
| `highlight.js` | `^11.12.0` | main | code colour. Synchronous |
| `mermaid` | `^11.17.0` | **renderer** | diagrams. Needs a live DOM |
| `pdfjs-dist` | `^6.2.108` | **renderer** | PDF. Needs a `<canvas>` |
| `mammoth` | `^1.12.1` | main | DOCX → HTML. Needs no DOM |

Three features get a **local rule instead of a dependency** — GitHub alerts
(§5.2), task lists (§5.3) and figures (§5.4). Each is about forty lines, and
each needs control over its markup for a reason §5 gives.

> [!warning]
> **`katex` is pinned to `^0.16` on purpose.** `@vscode/markdown-it-katex`
> declares `katex: ^0.16.4` as its peer range. KaTeX 0.18 is current and would
> work, but installing it makes every `npm install` print a peer conflict, and
> a warning nobody can act on is a warning everybody learns to ignore. Raise the
> pin when the plugin raises its range.

Still forbidden, from spec 01 §12 and §3.2: any message broker, any HTTP server
framework, `nats.ws`, any Python runtime.

### 3.1 TypeScript types — do not install `@types/markdown-it`

This repo type-checks. `tsc` is `ok` today and must stay `ok`, so read this
before running `npm install`.

Of the eight packages, seven ship their own types. **`markdown-it-footnote`
ships none.** The obvious fix is the wrong one:

```bash
npm i -D @types/markdown-it-footnote    # ← pulls in @types/markdown-it
```

`@types/markdown-it-footnote` depends on `@types/markdown-it`, which is
version 14 and describes markdown-it 14. This repo runs **markdown-it 15, which
bundles its own types**. Installing both puts two structurally different
`MarkdownIt` types in the project, and `md.use(plugin)` then fails to compile
with a message about two identically-named types from different files —
an error that reads like a bug in your code and is not.

`markdown-it-anchor` makes the same pull: its `peerDependencies` name
`@types/markdown-it: *`. That is a stale range, not a requirement. Ignore the
peer warning; do not satisfy it.

**Do this instead** — one local declaration file, `src/types/markdown-it.d.ts`.
Note the shape: markdown-it 15 has **no `PluginSimple` export**. That name comes
from `@types/markdown-it` and does not exist here. Version 15 types `use` as
`use<Params>(plugin: (md: this, ...params: Params) => void, ...params: Params)`,
so a plugin is just a function:

```ts
declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
```

`tsconfig.json` already includes `src/**/*.ts`, which matches a `.d.ts`. No
config change is needed.

The other seven packages ship their own types and need no declaration. If one of
their bundled types was written against `@types/markdown-it` and disagrees with
version 15 at the `md.use(...)` call site, declare that module here the same
way rather than installing the `@types` package. `skipLibCheck: true` is already
on, so a disagreement *inside* a `.d.ts` is not an error — only the call site
is.

---

## 4. The enrichment seam

### 4.1 Why it must exist

Spec 01 §5.4 step 2 puts every tier 1 document in an iframe with
`sandbox="allow-same-origin"` and no `allow-scripts`. That is not negotiable —
it is what stops a local HTML file's scripts from running.

But three of the things this spec adds *are* drawing programs:

| Feature | Needs | Can it run in the iframe? |
|:--|:--|:--|
| Mermaid | a live DOM to measure text | no — no script |
| PDF.js | a `<canvas>` 2D context | no — no script |
| KaTeX | nothing. Pure string in, HTML out | it does not need to. Main renders it |
| mammoth | nothing. Bytes in, HTML out | it does not need to. Main renders it |

So the split is not "hard formats and easy formats". It is: **can this thing
produce its output as a string, or does it need to measure and paint?** The
first kind runs in main and arrives as static HTML. The second kind runs in the
renderer process and reaches into the iframe.

Reaching in is safe and needs no new privilege. The iframe is `allow-same-origin`,
so the renderer can already create elements inside it and hold a canvas
context — that is the same access the anchor resolver has used since milestone 0.
**No script runs inside the iframe. The renderer draws, from outside.**

### 4.2 The contract

One new module, `src/renderer/overlay/enrich.ts`:

```ts
/** One drawing job against the document's live DOM. */
export type EnrichPass = (doc: Document, source: OpenedDocument) => Promise<void>;

/** Runs every pass that applies to this document, in order. */
export async function enrichDocument(doc: Document, source: OpenedDocument): Promise<void>;
```

Six rules, each of which exists because breaking it produces a bug that is hard
to see:

1. **Passes run in order, each awaited.** Never in parallel. Two passes writing
   the same DOM is a race that reproduces once a week.
2. **A pass that throws is caught, logged, and skipped.** The document still
   opens. A diagram that will not draw must never cost the reviewer the
   document.
3. **A failed pass leaves its fallback in place.** A Mermaid block that does not
   render stays readable as its own source. Failing loudly on screen beats an
   empty box.
4. **No pass may run after `onSurfaceReady`.** §4.3.
5. **A pass may create elements in the iframe. It may not run script in it.**
6. **Every element a pass creates that holds no text carries a stable `id`.**
   An SVG diagram and a PDF page have nothing for a quote to match, so they are
   reached by spec 01 §6.2 layer 3, which needs an `id`.

### 4.3 The ordering rule

This is the rule that keeps anchoring honest:

```text
srcdoc set → iframe "load" → enrichDocument() → onSurfaceReady() → buildTextIndex()
                             ^^^^^^^^^^^^^^^^
                             the DOM must be final when this returns
```

Spec 01 §6.3 says to rebuild the text index whenever the document is
re-rendered. An anchor created against a half-drawn document records offsets
into text that is about to move. It resolves. It reports `ok`. It points at the
wrong place — which is the exact silent failure `rules/06-testing.md` exists to
catch.

`DocumentView.tsx` therefore awaits `enrichDocument` inside its `load` handler
and calls `onSurfaceReady` only after it resolves.

A pass that genuinely cannot finish up front — a 300-page PDF is the real
case — must still build its **final DOM structure** up front and fill in only
pixels later. §7.2.

---

## 5. Markdown fidelity

### 5.1 What is added

| Feature | How | Text it adds to the index |
|:--|:--|:--|
| Heading `id`s | `markdown-it-anchor`, GitHub slug (§5.5) | none |
| Footnotes | `markdown-it-footnote` | the note text, which is the author's |
| GitHub alerts | local rule (§5.2) | **none** — the label is CSS |
| Task lists | local rule (§5.3) | **none** — the box is an `<input>` |
| Figures | local rule (§5.4) | none |
| Math | `@vscode/markdown-it-katex` + `katex` (§5.6) | none |
| Code colour | `highlight.js` (§5.7) | none |
| Mermaid | fence → `<pre>`, drawn by pass 1 (§5.8) | the diagram source, until it draws |

The right-hand column is not decoration. Every character REX invents and puts
in the document shifts every anchor offset after it (spec 01 §6.3), so a
feature that adds text is a feature that can move a comment.

### 5.2 GitHub alerts — a local rule, and why

`markdown-it-github-alerts` exists and works. It is **not** used, because it
emits the label as real text:

```html
<p class="markdown-alert-title">Tip</p>
```

That word enters the anchor text index, and every offset in the rest of the
document shifts by a word REX invented. It is the same reason
`data-rex-overlay` exists — REX's own text is never in the index.

The token shape to match:

```text
blockquote_open
  paragraph_open
    inline          ← children[0] is text "[!TIP]", children[1] is a softbreak
```

> [!warning]
> **Hook the rule after `inline`, not after `block`.** The core chain runs
> `normalize → block → inline → linkify → replacements → smartquotes →
> text_join`. After `block` an `inline` token has its `content` but its
> `children` is still `null` — the `inline` rule is what parses them. A rule
> registered `after("block")` therefore reads `children` as null, matches
> nothing, and fails **silently**: no error, no alert, and nothing to debug.
> All three local rules in §5.2 to §5.4 hook after `inline` for this reason.

`src/main/render/alerts.ts`, complete:

```ts
import type { MarkdownIt, StateCore } from "markdown-it";

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/;

/** GitHub alerts. The label is drawn by CSS, never added to the DOM (§5.2). */
export function alerts(md: MarkdownIt): void {
  md.core.ruler.after("inline", "rex_alerts", (state: StateCore): void => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      if (tokens[i + 1].type !== "paragraph_open") continue;

      const inline = tokens[i + 2];
      if (inline.type !== "inline" || !inline.children?.length) continue;

      const first = inline.children[0];
      if (first.type !== "text") continue;
      const match = MARKER.exec(first.content.trim());
      if (!match) continue;

      tokens[i].attrSet("data-alert", match[1].toLowerCase());

      // Drop the marker, and the line break that followed it.
      const drop = inline.children[1]?.type === "softbreak" ? 2 : 1;
      inline.children.splice(0, drop);
      inline.content = inline.content.slice(first.content.length).replace(/^\n/, "");

      // An alert whose whole first paragraph was the marker leaves an empty
      // paragraph behind. Remove the triple, not just the text.
      if (inline.children.length === 0) tokens.splice(i + 1, 3);
    }
  });
}
```

Three details that are easy to lose and each cost a visible bug:

- **`data-src-line` stays on the blockquote**, because the rule never touches
  `blockquote_open`'s other attributes. Apply still knows which line to edit.
- **The loop does not `break`.** A document has many alerts; the sample has two.
- **Splicing shortens `tokens`**, so the bound is re-read each pass. Do not hoist
  `tokens.length` into a variable.

The label is drawn by CSS, from the attribute:

```css
blockquote[data-alert]::before { content: attr(data-alert); }
```

Generated content is never in the DOM text, never selectable, and therefore
never in the index. §5.10 has the colours.

### 5.3 Task lists — a local rule

`markdown-it-task-lists` was last published in 2022 and is CommonJS in an ESM
project. The rule is thirty lines, so write it.

`src/main/render/tasks.ts`, complete:

```ts
import type { MarkdownIt, StateCore } from "markdown-it";

const BOX = /^\[([ xX])\]\s+/;

/** GitHub task lists. A checkbox holds no text, so the index is untouched. */
export function tasks(md: MarkdownIt): void {
  md.core.ruler.after("inline", "rex_tasks", (state: StateCore): void => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "list_item_open") continue;
      if (tokens[i + 1].type !== "paragraph_open") continue;

      const inline = tokens[i + 2];
      if (inline.type !== "inline" || !inline.children?.length) continue;

      const first = inline.children[0];
      if (first.type !== "text") continue;
      const match = BOX.exec(first.content);
      if (!match) continue;

      const done = match[1] !== " ";
      first.content = first.content.slice(match[0].length);
      inline.content = inline.content.slice(match[0].length);

      const box = new state.Token("html_inline", "", 0);
      box.content = `<input type="checkbox" disabled${done ? " checked" : ""}> `;
      inline.children.unshift(box);

      tokens[i].attrJoin("class", "rex-task");
      // The parent <ul> drops its bullet. It is the token before the item.
      const list = tokens[i - 1];
      if (list?.type === "bullet_list_open") list.attrJoin("class", "rex-task-list");
    }
  });
}
```

Four details:

- **`state.Token`, not an imported `Token`.** `StateCore` carries the
  constructor, and using it keeps the rule free of a second import path.
- **`html_inline` is the token type that emits raw markup.** `md` is created
  with `html: true` already (spec 01 §5.3), so it renders. A `text` token would
  escape the tag and print it.
- **`tokens[i - 1]` is only the list on the *first* item.** Later items are
  preceded by the previous `list_item_close`, so `attrJoin` on the list runs
  once and the guard is what makes that safe.
- **`[X]` uppercase counts as done.** GitHub accepts it and real documents use
  it.

> [!note]
> `dompurify` must keep `input`, `type`, `checked` and `disabled`. Verify it
> does rather than assuming — `src/renderer/overlay/sanitise.ts` already carries
> an `ADD_ATTR` list for exactly this reason.

### 5.4 Figures and captions

The stylesheet in `src/main/render/index.ts` already styles `figure` and
`figcaption`. Nothing has ever emitted them, so those rules are dead code.
Either emit figures or delete the rules; this spec emits them.

A `core` rule matching:

```text
paragraph_open, inline (one image child, nothing else), paragraph_close
[ paragraph_open, inline (one em wrapping all of it), paragraph_close ]
```

becomes:

```html
<figure data-src-line="138">
  <img src="./scaling.png" alt="…">
  <figcaption data-src-line="140">Figure 1 — …</figcaption>
</figure>
```

The caption keeps **its own** `data-src-line`, so a comment on the caption still
resolves to the caption's line in the Markdown and not to the image's. If no
italic paragraph follows, emit the `<figure>` with no `<figcaption>`.

`src/main/render/figures.ts` works by **retagging tokens rather than replacing
them**, which is what preserves `data-src-line` for free — the attribute is
stamped by the renderer rules in `markdown.ts` from `token.map`, and `map`
survives a tag change:

```ts
import type { MarkdownIt, StateCore, Token } from "markdown-it";

const isLone = (inline: Token, type: string): boolean =>
  inline.children?.length === 1 && inline.children[0].type === type;

/** An image-only paragraph becomes a <figure>; an italic one after it, its caption. */
export function figures(md: MarkdownIt): void {
  md.core.ruler.after("inline", "rex_figures", (state: StateCore): void => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "paragraph_open") continue;
      if (!isLone(tokens[i + 1], "image")) continue;

      tokens[i].tag = "figure";
      tokens[i + 2].tag = "figure";           // the paragraph_close
      tokens[i].attrJoin("class", "rex-figure");

      // An italic-only paragraph immediately after becomes the caption.
      const c = i + 3;
      if (
        tokens[c]?.type === "paragraph_open" &&
        tokens[c + 1]?.children?.[0]?.type === "em_open" &&
        tokens[c + 1].children.at(-1)?.type === "em_close"
      ) {
        tokens[c].tag = "figcaption";
        tokens[c + 2].tag = "figcaption";
        tokens[c + 1].children = tokens[c + 1].children.slice(1, -1);  // drop the <em>

        // Move figure_close past the caption, so the caption sits inside the
        // figure. Removing it at i+2 shifts everything after down by one, so
        // the caption now ends at i+4 and the reinsertion point is i+5 — which
        // is c+2. Getting this wrong nests figcaption outside figure, and the
        // browser silently reparents it.
        const [close] = tokens.splice(i + 2, 1);
        tokens.splice(c + 2, 0, close);
      }
    }
  });
}
```

> [!warning]
> **Do not build the `<figure>` by emitting raw HTML.** A `html_block` token
> carries no `map`, so `data-src-line` disappears and Apply loses the line for
> every image in the document. Retagging keeps `map`, and therefore keeps Apply
> precise — which spec 01 §5.3 calls the feature to get right.

### 5.5 Heading ids and the slug

The slug must match GitHub's, or the table of contents in every real README
stays dead — which is finding 7, and it is the one a reviewer notices first.

`markdown-it-anchor`'s default slugify is
`encodeURIComponent(s.trim().toLowerCase().replace(/\s+/g, "-"))`, which does
**not** strip punctuation. GitHub does. So `## Quick start` agrees by luck and
`## What's next?` does not — it becomes `what's-next%3F` where GitHub writes
`whats-next`, and the link is dead.

Supply GitHub's algorithm:

```ts
md.use(anchor, {
  tabIndex: false,          // do not add tabindex to headings
  slugify: (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N} -]/gu, "")   // keep letters, digits, space, hyphen
      .replace(/ /g, "-"),
});
```

`\p{L}` and `\p{N}` with the `u` flag rather than `a-z0-9`, so a heading in
Czech keeps its diacritics — GitHub does the same, and this repo's corpus is not
all English.

Collisions need no handling here: `markdown-it-anchor` tracks slugs it has
already emitted and appends `-1`, `-2` itself.

Leave `permalink` at its default, which is off. A clickable anchor link beside
each heading would add text to the index (§5.1) and put a control in a document
REX must not make interactive.

### 5.6 Math

`@vscode/markdown-it-katex` finds `$…$` and `$$…$$` — including the cases a
naive regular expression gets wrong, such as `$100 and $200` and a `$` inside a
code span. `katex.renderToString` turns each into HTML. Both are synchronous, so
`renderDocument` stays synchronous.

Set `throwOnError: false`. A malformed formula then renders as its own source in
red, and one bad `\frac` never costs the reviewer the page.

KaTeX needs its stylesheet and its woff2 fonts. Serve `katex/dist` over
`rex-doc://` by adding it as an allowed root in `src/main/protocol.ts`, and link
it from the page head. `readFile` works inside `app.asar`, so this survives
packaging. The CSS's own relative font URLs resolve against the stylesheet's
URL, so the fonts come from the same root. This is what forces `style-src`
in §6.

> [!note]
> **`markdown-it-mathjax3` was considered and rejected.** Its current major
> depends on `@se-oss/deasync`, a **native** module — a second `electron-rebuild`
> target beside `better-sqlite3`, and a synchronous block of the main process.
> Its previous major avoids that but is two majors behind. KaTeX renders the
> same formulas, faster, with no native code.

### 5.7 Code colour

`highlight.js`, through `markdown-it`'s own `highlight` option, so it stays
synchronous.

Two rules:

1. Ask `hljs.getLanguage(info)` first. An unknown language falls back to no
   highlighting — never to a guessed grammar, which colours the code
   confidently and wrongly.
2. Skip `mermaid` fences. They belong to §5.8.

Write the theme from the `PAPER` tokens in `src/shared/tokens.ts` rather than
shipping one of highlight.js's stylesheets. That file exists precisely so the
document's colours and REX's chrome cannot drift apart, and a stock theme is a
second, unowned palette.

### 5.8 Mermaid — the first enrichment pass

A `mermaid` fence renders in main as a `<pre>` holding its own source:

```html
<pre class="rex-mermaid" id="mermaid-155" data-src-line="155">flowchart LR …</pre>
```

The pass in `src/renderer/overlay/mermaid.ts` finds each one, calls
`mermaid.render`, and replaces the content with the returned SVG, marking the
element `data-rendered`. On failure the source stays visible (rule 3 of §4.2).
The `id` is what a layer-3 element anchor binds to (rule 6).

Load `mermaid` with a dynamic `import()`, so a document with no diagram never
pays for roughly three megabytes.

The whole pass, verified against mermaid 11.17 (§13):

```ts
export async function mermaidPass(doc: Document): Promise<void> {
  const blocks = [...doc.querySelectorAll<HTMLElement>("pre.rex-mermaid")];
  if (blocks.length === 0) return;                       // never load the 3 MB

  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  });

  for (const block of blocks) {
    try {
      const { svg } = await mermaid.render(`${block.id}-svg`, block.textContent ?? "");
      block.innerHTML = svg;
      block.dataset.rendered = "true";
    } catch (error) {
      console.warn(`[rex] mermaid: ${block.id} did not render`, error);
      // Rule 3 of §4.2 — the source stays on screen. Do not clear the block.
    }
  }
}
```

Two things that bite:

- **`mermaid.render` draws into the *renderer's* `document.body`**, not the
  iframe's, and needs a real layout to measure text. It appends a temporary
  element and removes it. That is why this cannot be moved into main, and why
  the id passed to `render` must not collide with anything on REX's own page —
  hence the `-svg` suffix on an id that is already unique.
- **The `<pre>` keeps `white-space: pre` and a monospace font**, so the SVG
  inherits both and draws wrong. §5.10 resets them on `[data-rendered]`.

### 5.9 The paper stylesheet

`MARKDOWN_STYLESHEET` in `src/main/render/index.ts` roughly doubles. Move it to
`src/main/render/stylesheet.ts`. It keeps taking its colours from
`src/shared/tokens.ts` and stays light-only, for the reason its current comment
gives.

### 5.10 Colours and the new CSS

The colours are specified, not left to taste. `src/shared/tokens.ts` exists
because the document's palette is written in main and the highlights painted on
it are written in the renderer, and a drift between the two shows up as a
highlight that cannot be read against the page it sits on. A palette invented at
the keyboard is that drift.

Add one group to `src/shared/tokens.ts`, beside `PAPER` and `HIGHLIGHT`:

```ts
/** GitHub alert callouts (§5.2). Each is a rule colour and the wash behind it. */
export const ALERT = {
  note:      { rule: "#2f5da8", bg: "#eef3fb", label: "Note" },
  tip:       { rule: "#2f7d63", bg: "#eef6f2", label: "Tip" },
  important: { rule: "#7a4fa3", bg: "#f4eff8", label: "Important" },
  warning:   { rule: "#c08a12", bg: "#fbf4e4", label: "Warning" },
  caution:   { rule: "#b03a2e", bg: "#fbeeec", label: "Caution" },
} as const;
```

`note` reuses `PAPER.link` and `warning` reuses `HIGHLIGHT.movedRule`, on
purpose: a warning callout and a moved anchor are the same amber, so the page
carries one meaning per colour.

The CSS that goes with the four features. `${…}` reads from the token groups:

```css
/* Alerts (§5.2) — the label is generated, so it is never in the text index. */
blockquote[data-alert] {
  margin-left: 0;
  padding: 10px 14px;
  border-left: 3px solid;
  border-radius: 0 4px 4px 0;
  color: ${PAPER.inkBody};
}
blockquote[data-alert]::before {
  display: block;
  margin-bottom: 4px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: inherit;
}
blockquote[data-alert] > :last-child { margin-bottom: 0; }
/* one block per kind, generated from ALERT */
blockquote[data-alert="tip"] {
  border-color: ${ALERT.tip.rule};
  background: ${ALERT.tip.bg};
}
blockquote[data-alert="tip"]::before {
  content: "${ALERT.tip.label}";
  color: ${ALERT.tip.rule};
}

/* Task lists (§5.3) */
ul.rex-task-list { list-style: none; padding-left: 20px; }
li.rex-task { position: relative; }
li.rex-task input[type="checkbox"] {
  position: absolute;
  left: -20px;
  top: 0.35em;
  margin: 0;
  accent-color: ${PAPER.link};
}

/* Figures (§5.4) — these rules already exist and finally have elements */
figure.rex-figure { margin: 0 0 18px; }

/* Mermaid (§5.8) — a <pre> that is no longer holding code */
pre.rex-mermaid[data-rendered] {
  white-space: normal;
  font-family: inherit;
  text-align: center;
  background: none;
  padding: 0;
}
pre.rex-mermaid[data-rendered] svg { max-width: 100%; height: auto; }
```

For code colour, map highlight.js's classes onto the paper palette rather than
shipping one of its stylesheets. Nine classes cover every language REX will
meet; anything unmapped inherits `PAPER.inkBody`, which is readable by
construction:

| highlight.js class | Colour |
|:--|:--|
| `hljs-keyword`, `hljs-built_in` | `#7a4fa3` |
| `hljs-string`, `hljs-regexp` | `#2f7d63` |
| `hljs-comment`, `hljs-quote` | `${PAPER.inkMuted}`, italic |
| `hljs-number`, `hljs-literal` | `#b03a2e` |
| `hljs-title`, `hljs-section` | `${PAPER.link}` |
| `hljs-attr`, `hljs-attribute` | `#8a6d1f` |
| `hljs-meta` | `${PAPER.inkMuted}` |

### 5.11 How it all wires into `markdown.ts`

Order matters in two places, so here is the whole construction:

```ts
const md = createMarkdownIt({
  html: true,
  linkify: true,
  highlight: (code, info) => {
    if (info === "mermaid") return "";              // §5.8 owns these
    if (!info || !hljs.getLanguage(info)) return ""; // never guess a grammar
    return hljs.highlight(code, { language: info }).value;
  },
})
  .use(anchor, { /* §5.5 */ })
  .use(footnote)
  .use(katex, { throwOnError: false })
  .use(alerts)      // §5.2 ─┐
  .use(tasks)       // §5.3  ├ all three hook after "inline"
  .use(figures);    // §5.4 ─┘

// then the existing data-src-line rules from spec 01 §5.3, unchanged
```

Two collisions to know about:

1. **`highlight` returning `""` means "not highlighted", not "empty".**
   markdown-it then escapes the code itself. Returning the raw code instead
   would double-escape it.
2. **The `mermaid` fence needs its own renderer rule**, because the existing
   `fence` rule in `markdown.ts` stamps `data-src-line` by rewriting the emitted
   `^<pre`. A mermaid block emits a different `<pre>`, so handle `info ===
   "mermaid"` inside that same rule and emit both attributes at once:

   ```ts
   if (token.info.trim() === "mermaid") {
     const line = token.map ? token.map[0] + 1 : 0;
     return `<pre class="rex-mermaid" id="mermaid-${line}" data-src-line="${line}">${
       escapeHtml(token.content)
     }</pre>`;
   }
   ```

   The id is derived from the source line, which is what makes it stable across
   reloads — and a layer-3 element anchor on `#mermaid-155` is only worth
   anything if it is the same `#mermaid-155` next time.

---

## 6. Content Security Policy

Three changes, all in `src/renderer/index.html`. A `srcdoc` iframe inherits the
embedding page's policy, so this file is the only place any of it is set.

| Directive | Today | After | Why |
|:--|:--|:--|:--|
| `img-src` | `'self' data: rex-doc:` | add `https:` | badges and other remote images (finding 1) |
| `style-src` | `'self' 'unsafe-inline'` | add `rex-doc:` | KaTeX's stylesheet (§5.6) — **and a bug fix**: spec 01 §5.4 point 3 requires a local HTML file's own `<link rel=stylesheet>` to survive, and today this blocks it |
| `connect-src` | `'self'` | add `rex-doc:` | PDF.js fetches the file over `rex-doc://` (§7) |

The whole `content` attribute afterwards, so there is nothing to reconstruct:

```text
default-src 'self';
style-src 'self' 'unsafe-inline' rex-doc:;
img-src 'self' data: rex-doc: https:;
font-src 'self' data: rex-doc:;
frame-src 'self' rex-doc:;
connect-src 'self' rex-doc:
```

It is written on one line in the file. `script-src` is deliberately still
absent, so it falls back to `default-src 'self'` — the document iframe runs no
script either way (§0 rule 2), and the renderer's own bundle is same-origin.

> [!warning]
> **`img-src https:` is a deliberate privacy trade, decided by the user on
> 2026-08-20.** Opening a document now tells whatever host the author named that
> the document was opened, and when — a badge is a tracking pixel that happens
> to be shaped like a badge. It is accepted because a README whose badges are
> broken images reads as a broken README. Revisit it if REX is ever pointed at
> documents from people the reviewer does not trust.

`worker-src` needs nothing: PDF.js's worker is bundled as a same-origin asset,
which `default-src 'self'` already covers. Do not switch it to a blob worker —
that would need `blob:` here.

---

## 7. Tier 3 — PDF

### 7.1 Why PDF is a renderer job

PDF.js draws to a `<canvas>`, and the document iframe runs no script. So the
renderer draws.

Because the iframe is `allow-same-origin`, the pass creates the canvas **inside
the iframe's document** and holds its 2D context from outside. Nothing is copied
between documents and no bitmap is serialised. It is the §4.1 mechanism, applied
a second time.

Main does not read the bytes. It returns a `rex-doc://` URL (§9) and PDF.js
fetches it by range request — which is why `connect-src` gains `rex-doc:`, and
why `.pdf` joins the MIME table in `src/main/protocol.ts`.

### 7.2 What is drawn

Per page:

```html
<div class="rex-pdf-page" id="page-3" data-page="3" style="width:…;height:…">
  <canvas></canvas>
  <div class="rex-pdf-text"><!-- absolutely positioned spans --></div>
</div>
```

**Structure first, pixels later.** Every page's box and text layer is built
before `enrichDocument` returns. Only the canvas bitmaps are painted lazily,
under an `IntersectionObserver`, as the reviewer scrolls.

This is not an optimisation, it is §4.3. A page whose *structure* appeared
during scrolling would change the text index under anchors that had already
resolved. Pixels arriving later change nothing the resolver can see.

The shape of the pass, using the API verified in §13:

```ts
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;      // a bundled same-origin asset

const pdf = await getDocument({ url }).promise;
if (pdf.numPages > MAX_PAGES) throw new Error(`…${pdf.numPages} pages…`);

for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale: 1 });

  const box = doc.createElement("div");         // created IN the iframe document
  box.className = "rex-pdf-page";
  box.id = `page-${n}`;
  box.dataset.page = String(n);
  box.style.width = `${viewport.width}px`;
  box.style.height = `${viewport.height}px`;
  box.style.setProperty("--scale-factor", "1");   // ← see the warning below

  const canvas = doc.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const text = doc.createElement("div");
  text.className = "textLayer rex-pdf-text";
  box.append(canvas, text);
  doc.body.append(box);

  await new TextLayer({ textContentSource: await page.getTextContent(), container: text, viewport }).render();
  // The bitmap comes later, from the IntersectionObserver:
  //   page.render({ canvas, viewport })
}
```

> [!warning]
> **Three things here fail at runtime, not at compile time, and every one of
> them is what an older tutorial tells you to write.**
>
> 1. **`--scale-factor` must be set on the text layer's container.** PDF.js
>    positions every span with `calc(var(--scale-factor) * …px)`. Without the
>    property, every span collapses to zero size — the text is *there*, so
>    `getTextContent` looks fine and the DOM looks fine, but nothing can be
>    selected. This is the single most common PDF.js integration bug.
> 2. **`renderTextLayer()` does not exist.** It was removed in PDF.js 5. Use the
>    `TextLayer` class, and `await …render()`.
> 3. **`page.render({ canvasContext })` is deprecated in 6.** Pass `canvas`.
>    `canvasContext` still works only when `canvas` is explicitly `null`.
>
> The text layer also needs PDF.js's own `.textLayer` CSS rules — copy them from
> `pdfjs-dist/web/pdf_viewer.css` into `stylesheet.ts` rather than linking the
> whole viewer stylesheet, which also restyles the page around it.

### 7.3 Anchoring in a PDF

Spec 01 §6.2's four layers all still work. Which one leads inverts:

| Layer | In Markdown and HTML | In a PDF |
|:--|:--|:--|
| 1 `quote` | primary | **unreliable** — see below |
| 2 `position` | disambiguates a repeated quote | unreliable, for the same reason |
| 3 `element` | images, SVG, tables | **primary** — `id="page-N"` |
| 4 `region` | a spot inside a diagram | **primary** — a box on a page |

Why a quote cannot lead in a PDF, all three being properties of the format and
not of PDF.js:

- `getTextContent()` returns items in **content-stream order, not reading
  order**. A two-column page interleaves its columns.
- **Word spaces are often absent** from the strings and implied only by glyph
  positions.
- **Ligatures** arrive as one glyph, so `find` becomes `ﬁnd`.

So the same sentence can normalise to two different strings on two runs, and a
quote anchor that reports `ok` may be pointing anywhere. That is precisely the
silent failure REX is built to avoid.

**Therefore a PDF anchor is a region of a page.** `Anchor.element` is
`#page-N`, `Anchor.region` is the fraction box inside it, and `quote` is
recorded as a *hint* when a text selection produced one — but the resolver never
leads with it for a PDF. This is how Acrobat has always worked, and it is
honest: point at a place on a page.

`Anchor.source` is `null`, so Apply is off, with the reason shown on hover
(spec 01 §5.2).

### 7.4 Limits

- **Refuse above 500 pages**, with a message saying so. Spec 02 §4.2 already
  sets the precedent: report `truncated`, never show a partial thing silently.
- **A scanned PDF has no text layer.** Draw it, allow region anchors, and say in
  the UI that it holds no text. No OCR (§12).
- Loading is not instant on a large file. Show progress; do not block the
  window.

---

## 8. Tier 3 — DOCX

### 8.1 mammoth, in main

`mammoth` converts a `.docx` to semantic HTML — headings, paragraphs, lists,
tables — from bytes, with **no DOM**. So it runs in **main**, on the same path
as Markdown: static HTML, straight into the iframe, no enrichment pass at all.

DOCX is therefore the cheapest of the three formats to add, which is the
opposite of what spec 01's tier table implies. It is tier 1 in everything but
the ability to write back.

- Embedded images convert to `data:` URIs, which `img-src data:` already allows.
- `contentHash` is the sha256 of the `.docx` bytes, unchanged from spec 01 §5.1.
- `Anchor.source` is `null`, so Apply is off.
- Anchoring is ordinary layer 1 and 2 work — real text in a real DOM, which is
  the case the resolver was built for.

The call, and the two things about it that are not obvious:

```ts
import { convertToHtml } from "mammoth";

const { value, messages } = await convertToHtml({ path });
```

- **`convertToHtml` is asynchronous**, so `renderDocument` — synchronous today —
  either becomes `async` or gains a separate DOCX path. Prefer making it async:
  it is called from an IPC handler that already awaits.
- **`messages` is not noise.** It lists every style mammoth did not recognise.
  Log it once per document. When a DOCX renders as a wall of undifferentiated
  paragraphs, the reason is in there — usually that the author used direct
  formatting instead of Word's built-in heading styles, which mammoth cannot
  map because there is nothing to map.

`title` comes from the first `<h1>` in the output, falling back to the file
name — the same rule `markdownTitle` follows.

### 8.2 What is lost

Page layout, headers and footers, fonts and colours, text boxes, tracked
changes and Word comments.

That is acceptable because REX anchors on **text**, and a comment's unit is a
passage, not a page. Reviewing a Word file in REX means reviewing its prose.
`docx-preview` renders near-Word fidelity instead, and is rejected in §12 with
the reason.

---

## 9. Shared types

Added to `src/shared/types.ts`.

```ts
/** How the renderer is meant to present this document. */
export type DocumentPresentation =
  | { kind: "html"; html: string }   // Markdown, HTML, DOCX — main rendered it
  | { kind: "pdf"; url: string }     // a rex-doc:// URL; the renderer draws it
  | { kind: "url" };                 // tier 2 — a <webview>
```

`OpenedDocument.html: string | null` and `RenderedDocument.html: string | null`
are **replaced** by `presentation`.

The reason is not tidiness. Today `html === null` means "this is a webview" — an
overload of a nullable field that was unambiguous while there were two cases and
is ambiguous now there are three. A discriminated union makes the renderer's
`switch` exhaustive, so `tsc` finds the branch anybody forgets.

Everything else on `OpenedDocument` — `documentId`, `ref`, `contentHash`,
`title`, `baseDir`, `applyEnabled`, `applyDisabledReason` — is unchanged.

**Every call site that breaks**, listed so nobody has to hunt for them. Measured
on 2026-08-21:

| File | Line | Today | Becomes |
|:--|:--|:--|:--|
| `src/shared/types.ts` | 244 | `html: string \| null` | `presentation: DocumentPresentation` |
| `src/main/render/index.ts` | 13 | `html: string \| null` | the same, on `RenderedDocument` |
| `src/main/render/index.ts` | 136 | `html: null` (the URL branch) | `presentation: { kind: "url" }` |
| `src/main/render/index.ts` | 152 | `html: markdownPage(...)` | `presentation: { kind: "html", html: ... }` |
| `src/main/render/index.ts` | 164 | `html: loaded.source` | the same, wrapped |
| `src/main/ipc.ts` | 276 | `html: rendered.html` | `presentation: rendered.presentation` |
| `src/renderer/overlay/DocumentView.tsx` | 79 | `doc.html === null` → is a webview | `doc.presentation.kind === "url"` |
| `src/renderer/overlay/DocumentView.tsx` | 85, 102 | the tier 1 effect guard, and `frame.srcdoc` | narrow on `kind === "html"` |
| `src/renderer/overlay/DocumentView.tsx` | 113 | `doc.html !== null` → not a webview | `kind === "url"` |

`DocumentView` gains a third branch for `kind === "pdf"`, which renders an empty
iframe and lets the §7 pass fill it. `noFallthroughCasesInSwitch` is already on
in `tsconfig.json`, so a missed branch is a compile error rather than a blank
pane.

---

## 10. Where the code goes

```text
src/
├── main/
│   ├── render/
│   │   ├── markdown.ts      + plugins, math, code colour, the mermaid fence
│   │   ├── alerts.ts        new — §5.2
│   │   ├── tasks.ts         new — §5.3
│   │   ├── figures.ts       new — §5.4
│   │   ├── docx.ts          new — §8, mammoth
│   │   ├── stylesheet.ts    new — the paper stylesheet, moved out of index.ts
│   │   └── index.ts         dispatch, now four formats
│   └── protocol.ts          + .pdf MIME, + the katex/dist root
├── renderer/
│   ├── index.html           CSP — §6
│   └── overlay/
│       ├── enrich.ts        new — the seam, §4.2
│       ├── mermaid.ts       new — pass 1, §5.8
│       ├── pdf.ts           new — pass 2, §7
│       ├── sanitise.ts      + the attributes §5.3 and §5.6 need
│       └── DocumentView.tsx awaits enrichment before onSurfaceReady, §4.3
├── shared/types.ts          DocumentPresentation — §9
├── types/markdown-it.d.ts   new — §3.1
└── ../test/
    └── markdown.spec.ts     new — §10.1
```

`alerts.ts`, `tasks.ts` and `figures.ts` are separate from `markdown.ts` and
must not import each other. Each is a pure token-stream transform with one right
answer, which makes each testable without Electron — the same reason spec 02
§8 keeps `links.ts` away from `graph.ts`.

### 10.1 The test

`test/markdown.spec.ts`, run by `node --test`, registered in `package.json` as
`"test:markdown": "node --test test/markdown.spec.ts"` — the same shape as the
existing `test:gate` and `test:links`.

It imports `renderMarkdown` and asserts on the HTML string. No Electron, no DOM,
no fixtures beyond short inline strings. It must cover, at minimum:

| Case | Asserts |
|:--|:--|
| `> [!TIP]\n> text` | `data-alert="tip"`, and **the string `[!TIP]` is absent** |
| `> plain quote` | no `data-alert` — the rule does not fire on every blockquote |
| `> [!TIP]` alone on its line, then a paragraph | no empty `<p></p>` survives |
| `- [x] a` and `- [ ] b` | `checked` on the first only, no literal `[x]` |
| `- [X] a` | uppercase counts as done |
| `- not a task` | untouched, still a bullet |
| an image-only paragraph | `<figure>`, and `data-src-line` still present |
| image, then an italic paragraph | `<figcaption>` inside the `<figure>` |
| image, then a normal paragraph | `<figure>` with **no** caption, paragraph intact |
| `## What's next?` | `id="whats-next"` — the punctuation case §5.5 exists for |
| two headings named the same | ids `x` and `x-1` |
| `$$…$$` | KaTeX output, not the literal `$$` |
| a fenced `mermaid` block | `<pre class="rex-mermaid" id="mermaid-N">`, source intact |
| every case above | `data-src-line` on the block, matching the input line |

That last row is the one that matters most. Every rule in §5 rewrites tokens,
and `data-src-line` is what Apply edits by (spec 01 §5.3). A rule that silently
drops it breaks Apply for that block, and nothing on screen looks wrong.

---

## 11. Milestones

Numbering continues from spec 02, which ended at 10.

Every milestone is verified in the **running app**, against the fixtures in
`sample-files/`, which exist for this: `sample-document.md` (263 lines),
`sample-document.pdf` (8 pages), `sample-document.docx`, and `scaling.png`.

### Milestone 11 — Markdown fidelity

Everything in §5 except Mermaid, plus the `img-src` change from §6.

**Accept when**, with `sample-files/sample-document.md` open:

1. The three badges load and draw as badges.
2. `[!TIP]` and `[!WARNING]` draw as labelled callouts. **The strings `[!TIP]`
   and `[!WARNING]` appear nowhere on screen**, and neither they nor the words
   REX draws in their place are in the text index. Check it, do not assume it —
   attach over CDP on port 9334 and run, in the renderer:

   ```js
   const d = document.querySelector("#rex-root").shadowRoot
     .querySelector("iframe.rex-frame").contentDocument;
   const t = d.body.innerText;
   [t.includes("[!TIP]"), t.includes("Tip"), t.includes("Warning")];
   // must be [false, false, false]
   ```

   `innerText` is the right check precisely because it excludes `::before`
   content, which is what §5.2 relies on.
3. The six roadmap items draw checkboxes, three of them ticked. No literal `[x]`
   or `[ ]` anywhere.
4. All nine table-of-contents links jump to their heading. Checked by clicking
   every one, not by reading the HTML.
5. The `$$…$$` block and the inline `$w$` draw as math, with KaTeX's fonts
   loaded — not as fallback glyphs.
6. `[^1]` is a superscript link; clicking it reaches the note at the foot; the
   back-link returns.
7. The five fenced code blocks are coloured, and `console` — which is not a
   language of its own — is not coloured wrongly.
8. `scaling.png` sits in a `<figure>` with the italic line below it as its
   `<figcaption>`.
9. **Anchoring is unbroken.** Create a comment on a paragraph, on a table cell,
   on the image, and on text inside a callout. All four resolve `ok` after a
   reload, and each highlight lands on the text it was made on — read by eye,
   because `ok` alone proves nothing (`rules/06-testing.md`).
10. `npm run test:markdown` passes, covering every row of the table in §10.1.
11. `npm run test:anchor` still passes. It is the regression net for the one
    component that fails silently, and every rule in §5 changed the DOM it
    indexes.
12. `nvim-tools --json --all` adds no finding over the baseline — which on
    2026-08-21 was **5 findings, all markdownlint, all in
    `docs/my-specs/01-initial/SPEC.md`** (4 × MD040, 1 × MD029). `tsc` was `ok`,
    so a type error introduced here is yours.

### Milestone 12 — the seam, and Mermaid

`enrich.ts`, and Mermaid as its only pass.

**Accept when:**

1. The flowchart in `sample-document.md` draws as a diagram.
2. A deliberately broken diagram leaves its source on screen, logs once, and
   **the rest of the document still renders**.
3. A comment made on the diagram is a layer-3 element anchor on
   `#mermaid-155`, and it still resolves after a reload.
4. A comment made on a paragraph **below** the diagram resolves to the same
   text before and after the diagram draws. This is §4.3, and it is the
   milestone's real test: run it by making the comment, reloading, and
   confirming the highlight has not moved by the height of the diagram.
5. Opening a document with no Mermaid in it never loads `mermaid` — checked in
   the network panel, not assumed.

### Milestone 13 — PDF

**Accept when**, with `sample-files/sample-document.pdf` open:

1. All 8 pages draw, in order, at a readable size.
2. The explorer lists `.pdf` as openable, and `unopenableReason` no longer
   names it.
3. Apply is greyed out, and hovering says why.
4. A comment placed on a region of page 3 resolves to the same region of page 3
   after a reload, and after resizing the window.
5. Selecting text on a page produces a `quote` **hint**, and the resolver still
   leads with the region (§7.3). A PDF anchor never reports `ok` from a quote
   match alone.
6. Scrolling to page 8 paints it. Scrolling back to page 1 leaves every anchor
   on pages 1 to 7 exactly where it was.
7. A PDF above the page limit is refused with a message, not by hanging.
8. The console is free of CSP violations.

### Milestone 14 — DOCX

**Accept when**, with `sample-files/sample-document.docx` open:

1. It renders as readable HTML: headings, paragraphs, lists and tables.
2. Its text matches `sample-document.md`'s prose closely enough that a comment
   made in one can be found by eye in the other. They are the same document.
3. The explorer lists `.docx` as openable.
4. Apply is greyed out, and hovering says why.
5. A comment on a passage resolves `ok` after a reload.
6. **No enrichment pass runs.** DOCX goes through main and arrives as static
   HTML (§8.1). If a pass is needed, something has been built wrong.

---

## 12. Non-goals

Deliberately not built. Each was considered.

| Not building | Why |
|:--|:--|
| `docx-preview` for near-Word fidelity | REX anchors on text, not on page layout. Word's geometry adds a deep, fragile DOM and improves no anchor |
| Pandoc, Tika, or headless LibreOffice | Pandoc cannot read PDF at all, and it is a 150 MB native binary. The other two discard the layout they exist to preserve |
| OCR for scanned PDFs | A different product. Show the pages, allow region anchors, say there is no text |
| Word comments and tracked changes | REX has its own comment model. Importing a second one is a merge problem, not a rendering problem |
| Editing or writing back a PDF or DOCX | Spec 01 §5.2 — there is no honest way to write a prose edit into either |
| PPTX and XLSX | No document in the corpus this is built for. Add one when a real one demands it |
| Exporting the rendered document | `rex export` already produces the review; the document is already on disk |
| A paged or print view for Markdown | REX renders Markdown on a 620px measure by design. Pagination is for formats that came paginated |
| Running the document's own scripts, ever | Spec 01 §5.4. The whole seam in §4 exists so this stays true |
| A second Markdown engine, such as `remark` | `markdown-it` and `token.map` are what `data-src-line` and therefore Apply are built on. Spec 01 §5.3 |

---

## 13. Verified API surface

Spec 01 §0 carries a standing rule: verify every SDK symbol against the docs
rather than assuming the names you remember are current. This section is that
rule applied to the six libraries here.

**Everything below was read from the published type definitions on
2026-08-21**, not recalled. Where a signature changed recently, the old one is
given too, because the old one is what most documentation still shows.

| Library | Version read | Call | Note |
|:--|:--|:--|:--|
| `markdown-it` | 15.0.0 | `use<P>(plugin: (md: this, ...p: P) => void, ...p: P)` | **No `PluginSimple` export.** That name is `@types/markdown-it` only — §3.1 |
| `markdown-it` | 15.0.0 | exports `MarkdownIt`, `StateCore`, `Token`, `RendererRule` as types | all four are `export type`, so import them with `import type` — `verbatimModuleSyntax` is on |
| `mermaid` | 11.17.0 | `const { svg, bindFunctions } = await mermaid.render(id, text)` | asynchronous; needs a live DOM |
| `pdfjs-dist` | 6.2.108 | `new TextLayer({ textContentSource, container, viewport }).render()` | **`renderTextLayer()` was removed in 5.x** |
| `pdfjs-dist` | 6.2.108 | `page.render({ canvas, viewport })` | `canvasContext` is legacy in 6 and only honoured when `canvas` is `null` |
| `pdfjs-dist` | 6.2.108 | `GlobalWorkerOptions.workerSrc` | set it before the first `getDocument` |
| `katex` | 0.16.x | `renderToString(tex, { displayMode, throwOnError: false })` | synchronous, no DOM |
| `highlight.js` | 11.12.0 | `hljs.getLanguage(name)`, `hljs.highlight(code, { language })` | synchronous |
| `mammoth` | 1.12.1 | `await convertToHtml({ path })` → `{ value, messages }` | asynchronous — §8.1 |

Two version facts that are decisions, not observations, and will go stale:

- `@vscode/markdown-it-katex@1.1.2` declares `katex: ^0.16.4`. KaTeX is at
  0.18.4. §3 pins to `^0.16` deliberately.
- `markdown-it-footnote@4.0.0` was last published in 2023 and ships no types.
  It is still the official `markdown-it` organisation's plugin, and the format
  it parses has not changed. §3.1 has the declaration to write.

**Before implementing, re-read this table against the versions you actually
install.** If one has moved, fix the table in the same commit — a spec that
records a verification date is only useful while somebody keeps checking it.
