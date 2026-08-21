// Spec 07 §4.2 and §4.3 — the text the worker chunks, against the text the
// renderer resolves in.
//
// Run: npm run test:text
//
// This is the cheap test that decides whether the expensive feature works at
// all. Spec 01 §6.5 layer 1 is an exact string match, so every claim's quote has
// to be character-for-character a substring of what `buildTextIndex` holds. If
// `text.ts` and `textIndex.ts` disagree by one space, every anchor the fact
// graph ever writes reports `orphaned` — and it would look like a bad model
// rather than a bad string, which is the expensive way to find out.
//
// So the comparison is made against a **real DOM in a real browser**, the same
// way `anchor.spec.ts` does it, and not against a second implementation of the
// same idea in Node.

import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { chunkDocument, locateQuote } from "../src/main/facts/chunk.ts";
import { htmlToText } from "../src/main/facts/text.ts";
import { renderMarkdown } from "../src/main/render/markdown.ts";

const DOCS = join(homedir(), "Projects/Github/redhat/ProtoBot/docs");
const MD_DOC = join(DOCS, "architecture/components.md");
const HTML_DOC = join(DOCS, "review/2026-08-20-architecture-explained.html");
const WORK = join(process.env.REX_SPIKE_DIR ?? tmpdir(), "rex-facts-text");

const PAGE = (body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>\n${body}\n</body></html>`;

/**
 * The normalised text of a page, as `textIndex.ts` builds it.
 *
 * Mermaid is deliberately *not* rendered here even though the app renders it
 * (`mermaid.ts`), because the comparison this test makes is with the DOM as main
 * hands it over. `text.ts` drops `pre.rex-mermaid` from its output, so the page
 * has to have those blocks removed too or the two would differ by exactly the
 * thing both of them are meant to be ignoring.
 */
async function domText(html: string, name: string): Promise<string> {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, name);
  writeFileSync(file, html);

  const built = await esbuild.build({
    entryPoints: [join(import.meta.dirname, "../src/renderer/anchor/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "__rexAnchor",
    write: false,
    platform: "browser",
    target: "chrome120",
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.addScriptTag({ content: built.outputFiles[0].text });
    return await page.evaluate(() => {
      // Match `text.ts`, which drops a mermaid fence because the app replaces
      // its text with an SVG before the resolver ever sees it.
      for (const block of document.querySelectorAll("pre.rex-mermaid")) block.remove();
      const rex = (
        window as unknown as { __rexAnchor: { buildTextIndex: (n: Node) => { text: string } } }
      ).__rexAnchor;
      return rex.buildTextIndex(document).text;
    });
  } finally {
    await browser.close();
  }
}

/** Where two strings first differ, with context — a diff for one long line. */
function firstDifference(a: string, b: string): string {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  if (i === limit && a.length === b.length) return "identical";
  const from = Math.max(0, i - 60);
  return (
    `first differ at ${i} of ${a.length}/${b.length}\n` +
    `  worker: …${JSON.stringify(a.slice(from, i + 60))}\n` +
    `  dom:    …${JSON.stringify(b.slice(from, i + 60))}`
  );
}

test("htmlToText matches the renderer's text index, on rendered Markdown", async () => {
  const html = PAGE(renderMarkdown(readFileSync(MD_DOC, "utf8")));
  const worker = htmlToText(html).text;
  const dom = await domText(html, "components.html");

  assert.ok(
    worker.length > 10_000,
    `only ${worker.length} chars of text — the walker missed the body`,
  );
  assert.equal(worker, dom, firstDifference(worker, dom));
});

test("htmlToText matches the renderer's text index, on a real HTML document", async () => {
  // 920 lines, four inline SVG diagrams and its own <style> — the hostile case
  // from spec 01 §13, and the one where a naive tag-stripper leaks CSS into the
  // text and shifts every offset after it.
  const html = readFileSync(HTML_DOC, "utf8");
  const worker = htmlToText(html).text;
  const dom = await domText(html, "explained.html");

  assert.ok(worker.length > 10_000, `only ${worker.length} chars of text`);
  assert.equal(worker, dom, firstDifference(worker, dom));
});

test("every chunk's span is exactly its own text in the document", () => {
  const html = PAGE(renderMarkdown(readFileSync(MD_DOC, "utf8")));
  const document = htmlToText(html);
  const chunks = chunkDocument(document);

  assert.ok(chunks.length > 5, `only ${chunks.length} chunks`);
  for (const chunk of chunks) {
    const span = document.text.slice(chunk.start, chunk.end);
    // The chunk joins blocks with a blank line the document does not have, so
    // the two are not equal — but the first and last blocks must line up, or
    // `locateQuote` would search the wrong window.
    const firstBlock = chunk.text.split("\n\n")[0];
    assert.ok(
      span.startsWith(firstBlock),
      `chunk ${chunk.index} span does not start with its first block:\n  span:  ${JSON.stringify(span.slice(0, 90))}\n  block: ${JSON.stringify(firstBlock.slice(0, 90))}`,
    );
  }
});

test("a quote from a chunk locates back into the document text", () => {
  const html = PAGE(renderMarkdown(readFileSync(MD_DOC, "utf8")));
  const document = htmlToText(html);
  const chunks = chunkDocument(document);

  let checked = 0;
  for (const chunk of chunks) {
    for (const block of chunk.text.split("\n\n")) {
      // A sentence, the way §3.2 asks the model for one.
      const sentence = block.split(". ")[0];
      if (sentence.length < 30) continue;
      const at = locateQuote(document, chunk, sentence);
      assert.ok(
        at,
        `quote from chunk ${chunk.index} did not locate: ${JSON.stringify(sentence.slice(0, 80))}`,
      );
      assert.equal(
        document.text.slice(at.start, at.end),
        sentence,
        `chunk ${chunk.index} located a quote at the wrong offsets`,
      );
      checked++;
      break;
    }
  }
  assert.ok(checked > 5, `only ${checked} quotes checked`);
});

test("a quote the model invented is dropped rather than located", () => {
  const document = htmlToText(PAGE("<p>ProtoBot is written in TypeScript.</p>"));
  const [chunk] = chunkDocument(document);
  assert.equal(locateQuote(document, chunk, "ProtoBot is written in Python."), null);
  // Whitespace differences count as invented too: the anchor built from it would
  // not match at layer 1, so believing it would produce a silent orphan.
  assert.equal(locateQuote(document, chunk, "ProtoBot  is written in TypeScript."), null);
  assert.ok(locateQuote(document, chunk, "ProtoBot is written in TypeScript."));
});

test("a mermaid fence contributes no text and no chunk", () => {
  const html = PAGE(
    '<p>Before.</p><pre class="rex-mermaid" id="mermaid-3">flowchart LR\n  A["Frontend"] --> B["Harness"]</pre><p>After.</p>',
  );
  const document = htmlToText(html);
  assert.equal(document.text.includes("flowchart"), false, "mermaid source leaked into the text");
  assert.equal(document.text.includes("Frontend"), false, "mermaid labels leaked into the text");
  assert.deepEqual(
    document.blocks.map((block) => block.text),
    ["Before.", "After."],
  );
});

// Both of the following trim: the page template ends in a newline before
// `</body>`, and a trailing whitespace run still emits its one space — in the
// DOM exactly as here, which is the behaviour the two comparison tests above
// already pin down. What is being asserted is leakage, not edge whitespace.

test("script and style never enter the text", () => {
  const document = htmlToText(
    PAGE("<style>p { color: red }</style><p>Kept.</p><script>var x = 1;</script>"),
  );
  assert.equal(document.text.trim(), "Kept.");
});

test("a > inside an attribute value is not read as prose", () => {
  // The failure mode a plain /<[^>]+>/ has, and it does not throw: it emits the
  // rest of the attribute as text, shifting every offset after it.
  const document = htmlToText(PAGE('<p title="a > b">Kept.</p>'));
  assert.equal(document.text.trim(), "Kept.");
});
