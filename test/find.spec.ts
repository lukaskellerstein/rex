// Spec 28 §7 milestone 0 — the matcher and the stripper, judged by assertion.
//
// Two processes search, and they have to find the same thing. Main runs
// `findMatches` over the text it strips out of each document's HTML; the
// renderer runs the same function over the page's own text index. A hit found
// in main is only a hit the page can show if the two texts are the same string
// — so the stripper is held to the index's own rules here, character for
// character, on the HTML REX writes itself.
//
// The colours are arithmetic for spec 27 §9.2's reason: nobody judges a yellow
// against an ink by looking at one of them.
//
// No browser and no database. The PDF is written by this file, so the test
// carries no binary fixture.
//
// Run: npm run test:find

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderMarkdown } from "../src/main/render/markdown.ts";
import { pdfText } from "../src/main/search/pdf.ts";
import { documentText, forgetSearchTexts, textOfHtml } from "../src/main/search/text.ts";
import {
  CONTEXT_CHARS,
  contextOf,
  findMatches,
  MAX_HITS_PER_FILE,
  MAX_HITS_TOTAL,
  MAX_PAGE_MATCHES,
  normaliseQuery,
  sameContext,
} from "../src/shared/find.ts";
import { HIGHLIGHT, PAPER } from "../src/shared/tokens.ts";

// ── The query (§4.3) ────────────────────────────────────────────

test("a query's whitespace is collapsed and trimmed, as the index text is", () => {
  assert.equal(normaliseQuery("  two   words\n\there "), "two words here");
  assert.equal(normaliseQuery("   "), "");
});

test("case is folded, and the offsets are in the original text", () => {
  const text = "Invariant one. INVARIANT two. invariant three.";
  const { matches, capped } = findMatches(text, "invariant", MAX_PAGE_MATCHES);
  assert.deepEqual(
    matches.map((m) => text.slice(m.start, m.end)),
    ["Invariant", "INVARIANT", "invariant"],
  );
  assert.equal(capped, false);
});

test("a query typed with two spaces matches text that has one", () => {
  const text = "the three invariants shape every change";
  const { matches } = findMatches(text, "three  invariants", MAX_PAGE_MATCHES);
  assert.equal(matches.length, 1);
  assert.equal(text.slice(matches[0].start, matches[0].end), "three invariants");
});

test("the query is literal — regex specials match themselves", () => {
  assert.equal(findMatches("a.b axb a(b) a*b", "a.b", 10).matches.length, 1);
  assert.equal(findMatches("a.b axb a(b) a*b", "a(b)", 10).matches.length, 1);
  assert.equal(findMatches("a.b axb a(b) a*b", "a*b", 10).matches.length, 1);
  assert.equal(findMatches("[x] y", "[x]", 10).matches.length, 1);
  assert.equal(findMatches("a\\b", "a\\b", 10).matches.length, 1);
});

test("matches do not overlap", () => {
  assert.equal(findMatches("aaaa", "aa", 10).matches.length, 2);
});

test("an empty query matches nothing", () => {
  assert.deepEqual(findMatches("anything", "", 10), { matches: [], capped: false });
  assert.deepEqual(findMatches("anything", "   ", 10), { matches: [], capped: false });
});

test("the cap holds the first `max` and says there were more", () => {
  const text = "e".repeat(20);
  const { matches, capped } = findMatches(text, "e", 5);
  assert.equal(matches.length, 5);
  assert.equal(capped, true);
  assert.equal(findMatches(text, "e", 20).capped, false);
});

test("the three limits are what the spec says", () => {
  assert.equal(MAX_PAGE_MATCHES, 1000);
  assert.equal(MAX_HITS_PER_FILE, 50);
  assert.equal(MAX_HITS_TOTAL, 500);
  assert.equal(CONTEXT_CHARS, 48);
});

// ── The context (§5.5) ──────────────────────────────────────────

test("context is cut at a word, inward, and says when it was cut", () => {
  const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
  const at = text.indexOf("delta");
  const context = contextOf(text, { start: at, end: at + 5 }, 7);
  // 7 characters back lands inside "gamma"; the cut moves in to its end.
  assert.equal(context.before, "gamma ");
  assert.equal(context.match, "delta");
  // 7 characters on lands inside "epsilon"; the cut moves back to the space
  // before it — which is the match's own end, so nothing is left after.
  assert.equal(context.after, "");
  assert.equal(context.cutBefore, true);
  assert.equal(context.cutAfter, true);
});

test("context at the edges is not cut", () => {
  const text = "one two three";
  const head = contextOf(text, { start: 0, end: 3 }, 48);
  assert.deepEqual(head, {
    before: "",
    match: "one",
    after: " two three",
    cutBefore: false,
    cutAfter: false,
  });
  const tail = contextOf(text, { start: 8, end: 13 }, 48);
  assert.equal(tail.before, "one two ");
  assert.equal(tail.after, "");
  assert.equal(tail.cutAfter, false);
});

test("two contexts agree on their words, whatever else they carry", () => {
  const one = contextOf("x the word y", { start: 6, end: 10 });
  const two = { ...one, cutBefore: !one.cutBefore };
  assert.equal(sameContext(one, two), true);
  assert.equal(sameContext(one, { ...one, after: " z" }), false);
});

// ── The stripper (§5.4) ─────────────────────────────────────────

test("the text of REX's own Markdown page, as the index would read it", () => {
  const markdown = [
    "# Title",
    "",
    "Hello **bold** world, and a [link](https://example.com/invariant).",
    "",
    "- one",
    "- two",
    "",
    "```js",
    "const x = 1; // invariant",
    "```",
    "",
    "Done.",
    "",
  ].join("\n");
  const text = textOfHtml(renderMarkdown(markdown));
  // The link's URL is not on the page, so it is not in the text (§8): one
  // `invariant`, in the code block, not two.
  assert.equal(
    text,
    "Title Hello bold world, and a link. one two const x = 1; // invariant Done. ",
  );
  assert.equal(findMatches(text, "invariant", 10).matches.length, 1);
});

test("nothing stands in for a tag — the DOM puts no character at a boundary", () => {
  assert.equal(textOfHtml("<b>a</b>b"), "ab");
  assert.equal(textOfHtml("<p>a</p><p>b</p>"), "ab");
  assert.equal(textOfHtml("<p>a</p>\n<p>b</p>"), "a b");
  assert.equal(textOfHtml("line<br>break"), "linebreak");
});

test("script, style, head and the rest are dropped with their content", () => {
  const html = [
    "<!doctype html><html><head><title>Not this</title><style>p { color: red }</style></head>",
    "<body><!-- nor this --><p>Prose.</p><script>const notThis = 1 < 2;</script>",
    "<svg><style>.node { fill: #fff }</style><desc>hidden</desc><text>drawn</text></svg>",
    "<template><p>never</p></template><noscript>off</noscript></body></html>",
  ].join("");
  assert.equal(textOfHtml(html), "Prose.drawn");
});

test("entities are decoded, and a non-breaking space collapses like any other", () => {
  assert.equal(textOfHtml("a&nbsp;&nbsp;b &amp; c &lt;d&gt; &#x27;e&#39;"), "a b & c <d> 'e'");
});

test("whitespace runs are one space, and the leading one is dropped", () => {
  assert.equal(textOfHtml("\n  <p>\n  spaced   out\n</p>\n"), "spaced out ");
});

// ── The colours (§4.4) ──────────────────────────────────────────

/** WCAG 2.x relative luminance, as `test/paper.spec.ts` computes it. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(one: string, two: string): number {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function cssVariable(name: string): string {
  const css = readFileSync(new URL("../src/renderer/overlay/overlay.css", import.meta.url), "utf8");
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `overlay.css declares --${name}`);
  return match[1];
}

test("both washes read with the paper's ink on them", () => {
  assert.ok(contrast(HIGHLIGHT.findBg, PAPER.ink) >= 4.5, "every match");
  assert.ok(contrast(HIGHLIGHT.findCurrentBg, PAPER.ink) >= 4.5, "the current match");
  assert.ok(contrast(HIGHLIGHT.findRule, HIGHLIGHT.findCurrentBg) >= 3, "the rule under it");
});

test("the chrome's find yellow reads on the panel, and is not the moved amber", () => {
  const find = cssVariable("find");
  const strong = cssVariable("find-strong");
  const panel = cssVariable("panel");
  assert.ok(contrast(find, panel) >= 4.5, "a mark and a result row's match");
  assert.ok(contrast(strong, panel) >= 4.5, "the current mark");
  assert.notEqual(find, cssVariable("moved"));
  assert.equal(strong, HIGHLIGHT.findCurrentBg, "one strong yellow, on both surfaces");
});

// ── The reader, and its cache (§5.4) ────────────────────────────

test("a document's text is read once until the file changes", async () => {
  forgetSearchTexts();
  const directory = mkdtempSync(join(tmpdir(), "rex-find-"));
  const path = join(directory, "note.md");
  writeFileSync(path, "# One\n\nfirst words\n");
  assert.equal(await documentText(path, path), "One first words ");

  // Same mtime and size: the cache answers, even though the bytes moved.
  const stat = { mtime: new Date(2026, 0, 1, 12, 0, 0) };
  writeFileSync(path, "# One\n\nfirst wordz\n");
  utimesSync(path, stat.mtime, stat.mtime);
  const before = await documentText(path, path);
  writeFileSync(path, "# One\n\nfirst wordy\n");
  utimesSync(path, stat.mtime, stat.mtime);
  assert.equal(await documentText(path, path), before);

  // A different size is a different file.
  writeFileSync(path, "# One\n\nfirst words, longer\n");
  assert.equal(await documentText(path, path), "One first words, longer ");
});

// ── The PDF (milestone 3) ───────────────────────────────────────

/**
 * The smallest PDF that says something: one page, one Helvetica line. Written
 * by hand with a correct xref, so pdf.js has nothing to repair.
 */
function tinyPdf(line: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    null, // the content stream, built below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 100 Td (${line}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, at) => {
    offsets.push(Buffer.byteLength(body));
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("a PDF's text is read in main, without a canvas", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rex-find-pdf-"));
  const path = join(directory, "hello.pdf");
  writeFileSync(path, tinyPdf("Hello invariant world"));
  const text = await pdfText(path);
  assert.equal(text, "Hello invariant world");
  assert.equal((await documentText(path, path)).includes("invariant"), true);
});
