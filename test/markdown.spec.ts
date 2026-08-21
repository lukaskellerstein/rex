// Spec 03 §10.1 — the Markdown rules, judged by assertion.
//
// Every rule in spec 03 §5 rewrites the token stream, and three of them were
// written locally rather than installed. They are pure transforms with one
// right answer, so they are tested without Electron, without a DOM and without
// fixtures — short inline strings and the HTML string that comes back.
//
// The row that matters most is `data-src-line`. Apply edits by it (spec 01
// §5.3), so a rule that silently drops it breaks Apply for that block and
// nothing on screen looks wrong.
//
// Run: npm run test:markdown

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderMarkdown } from "../src/main/render/markdown.ts";
import { MARKDOWN_STYLESHEET } from "../src/main/render/stylesheet.ts";

// ── The stylesheet's one hard rule ──────────────────────────────

test("the stylesheet contains no angle bracket, comments included", () => {
  // DOMPurify's mXSS guard deletes any element whose text matches /<[/\w!]/,
  // and a <style> holding CSS is exactly that shape. Measured on 2026-08-21: a
  // CSS comment mentioning a tag name in angle brackets deleted the whole
  // stylesheet, the document rendered completely unstyled, and nothing logged
  // anything. This assertion is cheaper than noticing it a second time.
  const at = MARKDOWN_STYLESHEET.indexOf("<");
  assert.equal(
    at,
    -1,
    at === -1 ? "" : `"<" at ${at}: ${MARKDOWN_STYLESHEET.slice(Math.max(0, at - 70), at + 30)}`,
  );
});

// ── GitHub alerts (§5.2) ────────────────────────────────────────

test("an alert marker becomes an attribute, never text", () => {
  const html = renderMarkdown("> [!TIP]\n> Tile size matters more than worker count.");

  assert.match(html, /<blockquote[^>]*data-alert="tip"/, "the kind is an attribute");
  assert.ok(!html.includes("[!TIP]"), "the marker is gone from the output entirely");
  assert.ok(html.includes("Tile size matters"), "the author's own text survives");
  // The label is drawn by CSS `::before`, so the word must not be in the HTML.
  assert.ok(!/>\s*Tip\s*</.test(html), "no element holds the label as text");
});

test("every alert kind is recognised", () => {
  for (const [marker, kind] of [
    ["NOTE", "note"],
    ["TIP", "tip"],
    ["IMPORTANT", "important"],
    ["WARNING", "warning"],
    ["CAUTION", "caution"],
  ]) {
    const html = renderMarkdown(`> [!${marker}]\n> body`);
    assert.match(html, new RegExp(`data-alert="${kind}"`), `${marker} recognised`);
  }
});

test("a plain blockquote is left alone", () => {
  const html = renderMarkdown("> Tilecat reprojects rasters that do not fit in memory.");
  assert.ok(!html.includes("data-alert"), "the rule does not fire on every blockquote");
  assert.match(html, /<blockquote/);
});

test("an alert with the marker alone on its line leaves no empty paragraph", () => {
  const html = renderMarkdown("> [!WARNING]\n>\n> Keep at least 16 pixels of halo.");

  assert.match(html, /data-alert="warning"/);
  assert.ok(!/<p[^>]*>\s*<\/p>/.test(html), "no empty paragraph survives");
  assert.ok(html.includes("Keep at least 16 pixels"), "the body is intact");
});

test("more than one alert in a document is converted", () => {
  const html = renderMarkdown("> [!TIP]\n> one\n\ntext\n\n> [!WARNING]\n> two");
  assert.match(html, /data-alert="tip"/);
  assert.match(html, /data-alert="warning"/);
});

test("an alert keeps data-src-line on its blockquote", () => {
  const html = renderMarkdown("# Title\n\nprose\n\n> [!TIP]\n> body");
  assert.match(html, /<blockquote[^>]*data-src-line="5"/, "line 5 is where the quote starts");
});

// ── Task lists (§5.3) ───────────────────────────────────────────

test("task list items become checkboxes and lose their brackets", () => {
  const html = renderMarkdown("- [x] Tiled scheduler\n- [ ] GPU resampling path");

  assert.ok(!html.includes("[x]"), "no literal [x]");
  assert.ok(!html.includes("[ ]"), "no literal [ ]");
  assert.equal((html.match(/<input type="checkbox"/g) ?? []).length, 2, "two checkboxes");
  assert.equal((html.match(/checked/g) ?? []).length, 1, "only the first is ticked");
  assert.match(html, /<ul[^>]*class="rex-task-list"/, "the list drops its bullet");
  assert.equal((html.match(/class="rex-task"/g) ?? []).length, 2, "both items are marked");
});

test("an uppercase [X] counts as done", () => {
  const html = renderMarkdown("- [X] Zstd compression");
  assert.match(html, /<input type="checkbox" disabled checked>/);
});

test("an ordinary bullet is left alone", () => {
  const html = renderMarkdown("- not a task\n- also not");
  assert.ok(!html.includes("<input"), "no checkbox");
  assert.ok(!html.includes("rex-task"), "no class");
});

test("a task item keeps data-src-line", () => {
  const html = renderMarkdown("# Roadmap\n\n- [x] done\n- [ ] open");
  assert.match(html, /<li[^>]*data-src-line="3"/);
  assert.match(html, /<li[^>]*data-src-line="4"/);
});

// ── Figures (§5.4) ──────────────────────────────────────────────

test("an image-only paragraph becomes a figure and keeps its line", () => {
  const html = renderMarkdown("# T\n\n![Speed-up against thread count](./scaling.png)");

  assert.match(html, /<figure[^>]*class="rex-figure"/);
  assert.match(html, /<figure[^>]*data-src-line="3"/, "data-src-line survives the retag");
  assert.ok(!/<p[^>]*>\s*<img/.test(html), "the paragraph is gone, not wrapped");
});

test("an italic paragraph after an image becomes its caption, inside the figure", () => {
  const html = renderMarkdown("![alt](./scaling.png)\n\n*Figure 1 — the tiled scheduler scales.*");

  assert.match(html, /<figcaption/);
  assert.ok(html.includes("Figure 1 — the tiled scheduler scales."), "the caption text survives");
  assert.ok(!html.includes("<em>"), "the emphasis wrapper is dropped");

  // The caption must sit INSIDE the figure, and carry its OWN line.
  const figure = html.slice(html.indexOf("<figure"), html.indexOf("</figure>"));
  assert.ok(figure.includes("<figcaption"), "figcaption is inside figure");
  assert.match(figure, /<figcaption[^>]*data-src-line="3"/, "the caption keeps its own line");
});

test("an image followed by a normal paragraph gets no caption", () => {
  const html = renderMarkdown("![alt](./scaling.png)\n\nNote the last row of the table.");

  assert.match(html, /<figure/);
  assert.ok(!html.includes("<figcaption"), "a plain paragraph is not a caption");
  assert.match(html, /<p[^>]*>Note the last row/, "the paragraph is intact");
});

test("a paragraph with an image and text beside it is not a figure", () => {
  const html = renderMarkdown("Text with an ![inline](./x.png) image in it.");
  assert.ok(!html.includes("<figure"), "only a lone image becomes a figure");
});

// ── Heading ids (§5.5) ──────────────────────────────────────────

test("the slug strips punctuation, the way GitHub does", () => {
  const html = renderMarkdown("## What's next?");
  assert.match(html, /<h2[^>]*id="whats-next"/);
  assert.ok(!html.includes("%3F"), "no percent-encoding");
});

test("the slug keeps non-English letters", () => {
  const html = renderMarkdown("## Jak to funguje");
  assert.match(html, /id="jak-to-funguje"/);
  const czech = renderMarkdown("## Příliš žluťoučký");
  assert.match(czech, /id="příliš-žluťoučký"/, "diacritics survive, as on GitHub");
});

test("repeated headings get distinct ids", () => {
  const html = renderMarkdown("## Options\n\ntext\n\n## Options");
  assert.match(html, /id="options"/);
  assert.match(html, /id="options-1"/);
});

test("a heading keeps data-src-line beside its id", () => {
  const html = renderMarkdown("# Title\n\n## Quick start");
  assert.match(html, /<h2[^>]*data-src-line="3"/);
  assert.match(html, /<h2[^>]*id="quick-start"/);
});

test("no permalink control is added to a heading", () => {
  const html = renderMarkdown("## Benchmarks");
  assert.ok(!html.includes("header-anchor"), "permalink stays off — it would add text");
});

// ── Math (§5.6) ─────────────────────────────────────────────────

test("a display formula renders as KaTeX, not as literal dollars", () => {
  const html = renderMarkdown("$$\nM = (w + 2) \\cdot t^2\n$$");
  assert.match(html, /class="katex/);
  assert.ok(!html.includes("$$"), "the delimiters are consumed");
});

test("inline math renders and prose dollars do not", () => {
  assert.match(renderMarkdown("where $w$ is the worker count"), /class="katex/);
  const prose = renderMarkdown("It costs $100 and $200 to run.");
  assert.ok(!prose.includes("katex"), "two prices are not a formula");
  assert.ok(prose.includes("$100"), "the prices survive");
});

// ── Code colour (§5.7) ──────────────────────────────────────────

test("a known language is coloured", () => {
  const html = renderMarkdown("```python\nfrom tilecat import Raster\n```");
  assert.match(html, /class="hljs-keyword"/);
  assert.match(html, /<pre[^>]*data-src-line="1"/);
});

test("an unknown language is not guessed at", () => {
  const html = renderMarkdown("```wat\nnot a language\n```");
  assert.ok(!html.includes("hljs-"), "no grammar is guessed");
  assert.ok(html.includes("not a language"), "the code is still there");
});

// ── Mermaid (§5.8) ──────────────────────────────────────────────

test("a mermaid fence becomes a pre with a stable id and its source intact", () => {
  const html = renderMarkdown("# T\n\n```mermaid\nflowchart LR\n    A --> B\n```");

  assert.match(html, /<pre class="rex-mermaid" id="mermaid-3" data-src-line="3">/);
  assert.ok(html.includes("flowchart LR"), "the source stays readable as the fallback");
  assert.ok(!html.includes("hljs-"), "mermaid is not code and is not coloured");
});

test("a mermaid fence escapes its own source", () => {
  const html = renderMarkdown('```mermaid\nflowchart LR\n    A["<b>x</b>"] --> B\n```');
  assert.ok(html.includes("&lt;b&gt;"), "angle brackets are escaped, not emitted as markup");
});

// ── Footnotes (§5.1) ────────────────────────────────────────────

test("a footnote becomes a reference and a note, not literal brackets", () => {
  const html = renderMarkdown("Text.[^1]\n\n[^1]: Verified against gdalwarp.");

  assert.ok(!html.includes("[^1]"), "no literal marker");
  assert.match(html, /class="footnote-ref"/);
  assert.match(html, /class="footnotes"/);
  assert.ok(html.includes("Verified against gdalwarp."), "the note text is the author's");
});

// ── Everything that was already right stays right ───────────────

test("tables, nested lists and inline HTML are unchanged", () => {
  const html = renderMarkdown(
    ["| a | b |", "| :--- | ---: |", "| 1 | 2 |", "", "<sub>small</sub>"].join("\n"),
  );
  assert.match(html, /<table[^>]*data-src-line="1"/);
  assert.match(html, /style="text-align:right"/, "column alignment survives");
  assert.match(html, /<sub>small<\/sub>/, "inline HTML survives");
});
