// SPEC.md §13 Milestone 0 — the anchor spike, and the gate the rest of REX
// waits behind.
//
// Anchoring is the one component that fails silently: a wrong anchor resolves
// to *somewhere*, reports `ok`, and looks fine until a human reads the
// highlight. So this script does not assert that resolution succeeded — it
// prints what each anchor resolved *to*, and fails when a layer 1 hit does not
// return the text it was created from.
//
// The two documents are from `documentation-sample` (CLAUDE.md § read-only):
//   * `one/sample-document.md` — Markdown through REX's own renderer, so every
//     block carries `data-src-line` and every heading a slug id.
//   * `one/sample-document.docx` — a different document, through mammoth, so
//     the page has NO `data-src-line` and NO ids: the hand-written-HTML shape,
//     where every anchor falls back to text and structure. Its four images are
//     data URIs, which is what the region gate needs.
//
// Run: npm run test:anchor

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium, type Page } from "playwright";
import { renderDocx } from "../src/main/render/docx.ts";
import { renderMarkdown } from "../src/main/render/markdown.ts";
import type { Anchor, AnchorState } from "../src/shared/types.ts";

const DOCS = join(homedir(), "Projects/Github/lukaskellerstein/documentation-sample");
const MD_DOC = join(DOCS, "one/sample-document.md");
const DOCX_DOC = join(DOCS, "one/sample-document.docx");
const WORK = join(process.env.REX_SPIKE_DIR ?? tmpdir(), "rex-anchor-spike");

interface Marker {
  id: string;
  /** Text to anchor to, as it appears in the *normalised* document text. */
  quote: string;
  /** What this anchor is expected to report after the three edits. */
  expect: AnchorState | "moved-or-orphaned";
  why: string;
}

interface Created {
  id: string;
  anchor: Anchor;
  /**
   * What this anchor was created *on*, so that re-resolution can be checked
   * against it. Without this the element layer can land on a different
   * element, report `moved`, and read as a pass.
   */
  signature: string;
  /**
   * Spec 06 §4.4 — the same check for the resolutions that come back as an
   * ELEMENT rather than a range.
   *
   * An anchor covering exactly one whole block now resolves to that block, so
   * `landedOn` is a description of an element and `signature` — the text it was
   * created from — cannot match it by construction. This is what an element
   * resolution is compared against instead, and it is the same guard: landing
   * on a different element still fails.
   */
  blockSignature: string;
}

interface Resolved {
  id: string;
  layer: number | null;
  state: AnchorState;
  /** The raw DOM text (or element description) the anchor landed on. */
  landedOn: string | null;
  /** Which of the two signatures `landedOn` has to be checked against. */
  landedKind: "range" | "element" | null;
}

/** Anchors are created against the original and re-resolved against the edited copy. */
interface Case {
  name: string;
  markers: Marker[];
  /** Selector + index for the tenth, element-only anchor (§6.4). */
  element: { selector: string; index: number } & Marker;
  original: string;
  edited: string;
  sourceFile: string | null;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

// ── The browser half ────────────────────────────────────────────
// These run inside the page, where the live DOM is. Nothing below may assume
// Node globals.

function createInPage(input: {
  markers: Marker[];
  element: { selector: string; index: number; id: string };
  sourceFile: string | null;
}): { created: Created[]; probe: Created } {
  // Runs inside the page: only DOM globals and window.__rexAnchor exist here.
  const rex = (window as any).__rexAnchor;
  const describe = (el: Element) =>
    `<${el.tagName.toLowerCase()}> ${(el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 80)}`;

  const index = rex.buildTextIndex(document);
  const created: Created[] = [];

  for (const marker of input.markers) {
    const at = index.text.indexOf(marker.quote);
    if (at === -1) throw new Error(`marker not present in document: ${marker.id}`);
    const range = rex.offsetsToRange(index, { start: at, end: at + marker.quote.length });
    if (!range) throw new Error(`marker did not map back to a Range: ${marker.id}`);
    const holder =
      range.commonAncestorContainer.nodeType === 1
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    // A marker whose quote happens to be a block's whole text resolves to
    // that BLOCK, so the block it sits in has to be recorded — not the inline
    // `<strong>` or `<em>` the range happens to be inside, which is what the
    // range's own ancestor is for a bold tagline.
    const block =
      holder?.closest("p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,figcaption,dt,dd") ?? holder;
    created.push({
      id: marker.id,
      anchor: rex.createTextAnchor(index, range, input.sourceFile),
      signature: marker.quote,
      blockSignature: block ? describe(block) : marker.quote,
    });
  }

  const el = document.querySelectorAll(input.element.selector)[input.element.index];
  if (!el) throw new Error(`element anchor target missing: ${input.element.selector}`);
  const elementAnchor = rex.createElementAnchor(index, el, input.sourceFile);
  created.push({
    id: input.element.id,
    anchor: elementAnchor,
    // Spec 06 §4.4 — an element anchor resolves to its ELEMENT now, whether or
    // not it had text to quote. The quote is the key that finds the block, not
    // a statement of what the comment covers, so this is checked as an element.
    signature: elementAnchor.quote ? elementAnchor.quote.exact : describe(el),
    blockSignature: describe(el),
  });

  // Both element targets carry text — a code fence and a table — so neither
  // reaches layer 3 on its own. This probe strips the quote to force §6.5
  // step 4, the path that a real image or icon would take.
  const probe: Created = {
    id: `${input.element.id}/layer-3-probe`,
    anchor: { ...elementAnchor, quote: null, position: null },
    signature: describe(el),
    blockSignature: describe(el),
  };

  return { created, probe };
}

function resolveInPage(created: Created[]): Resolved[] {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);

  return created.map((record) => {
    const resolution = rex.resolveAnchor(index, record.anchor);
    const describe = (el: Element) =>
      `<${el.tagName.toLowerCase()}> ${(el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 80)}`;

    let landedOn: string | null = null;
    let landedKind: "range" | "element" | null = null;
    if (resolution?.kind === "range") {
      landedOn = resolution.range.toString();
      landedKind = "range";
    } else if (resolution?.kind === "element") {
      landedOn = describe(resolution.element);
      landedKind = "element";
    }
    return {
      id: record.id,
      layer: resolution ? resolution.layer : null,
      landedKind,
      // The spike has no stored hash to compare against — that comparison is
      // the app's job (§6.6) — so state here reflects the resolution layer only.
      state: rex.anchorStateFor(resolution, false) as AnchorState,
      landedOn,
    };
  });
}

// ── The Node half ───────────────────────────────────────────────

async function withPage<T>(
  bundle: string,
  file: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.addScriptTag({ content: bundle });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function report(testCase: Case, created: Created[], resolved: Resolved[]): number {
  const byId = new Map([...testCase.markers, testCase.element].map((m) => [m.id, m as Marker]));
  const signatures = new Map(created.map((c) => [c.id, c.signature]));
  const blockSignatures = new Map(created.map((c) => [c.id, c.blockSignature]));
  let failures = 0;

  console.log(`\n── ${testCase.name} ${"─".repeat(Math.max(0, 58 - testCase.name.length))}`);
  for (const row of resolved) {
    const marker = byId.get(row.id);
    const expected = marker?.expect ?? "moved";
    const ok =
      expected === "moved-or-orphaned"
        ? row.state === "moved" || row.state === "orphaned"
        : row.state === expected;

    // The failure this whole script exists to catch: an anchor that reports
    // success while sitting on something it was never created from. Checked for
    // every layer, not just layer 1 — the element layer is where it happened.
    //
    // Spec 06 §4.4 — compared against whichever signature matches what came
    // back. An anchor covering exactly one whole block resolves to the block,
    // so it is checked element-against-element; a passage inside a block is
    // still checked text-against-text. Landing somewhere else fails either way.
    const signature =
      row.landedKind === "element" ? blockSignatures.get(row.id) : signatures.get(row.id);
    const wrongPlace =
      row.layer !== null &&
      row.layer !== 2 && // layer 2 is fuzzy by definition; its text is expected to differ
      !!signature &&
      !!row.landedOn &&
      norm(row.landedOn) !== norm(signature);

    if (!ok || wrongPlace) failures++;
    const verdict = wrongPlace ? "WRONG PLACE" : ok ? "pass" : "FAIL";
    console.log(
      `  ${verdict.padEnd(11)} ${row.id.padEnd(22)} state=${row.state.padEnd(9)} layer=${row.layer ?? "-"}  expected=${expected}`,
    );
    if (marker) console.log(`              ${marker.why}`);
    if (row.landedOn) console.log(`              landed on: ${norm(row.landedOn).slice(0, 100)}`);
  }
  return failures;
}

async function runCase(
  bundle: string,
  testCase: Case,
): Promise<{ failures: number; survived: number }> {
  const { created, probe } = await withPage(bundle, testCase.original, (page) =>
    page.evaluate(createInPage, {
      markers: testCase.markers,
      element: testCase.element,
      sourceFile: testCase.sourceFile,
    }),
  );

  // §13 step 3 — the anchors outlive the page that made them.
  const anchorFile = join(WORK, `${testCase.name.replace(/\W+/g, "-")}.anchors.json`);
  writeFileSync(anchorFile, JSON.stringify(created, null, 2));

  const all = await withPage(bundle, testCase.edited, (page) =>
    page.evaluate(resolveInPage, [...created, probe]),
  );
  const resolved = all.slice(0, created.length);
  const probeResult = all[created.length];

  let failures = report(testCase, created, resolved);
  const survived = resolved.filter((r) => r.state !== "orphaned").length;
  console.log(`  ${survived}/${resolved.length} anchors still resolve · anchors: ${anchorFile}`);

  const probeOk =
    probeResult.layer === 3 && norm(probeResult.landedOn ?? "") === norm(probe.signature);
  if (!probeOk) failures++;
  console.log(
    `  ${probeOk ? "pass" : "FAIL"}        layer-3 probe          quote stripped → layer=${probeResult.layer ?? "-"}, ${
      probeOk
        ? "same element"
        : `landed on: ${norm(probeResult.landedOn ?? "nothing").slice(0, 80)}`
    }`,
  );

  return { failures, survived };
}

// ── The three edits (§13 step 4) ────────────────────────────────
//
// Each document gets the same three edits — a paragraph inserted near the top
// so every offset below it shifts, one sentence reworded, one heading reworded
// (spec 06 §10 milestone 9), and one whole section deleted.

const INSERTED =
  "Inserted by the milestone 0 spike. It exists only to shift every character offset below it.";

function editDocx(html: string): string {
  const firstParagraphEnd = "retired the last of the legacy hosting contracts.</p>";
  let out = replaceOnce(html, firstParagraphEnd, `${firstParagraphEnd}<p>${INSERTED}</p>`);

  out = replaceOnce(
    out,
    "Margin expansion came from three identifiable sources.",
    "Three separate sources drove the expansion of the margin.",
  );

  // Spec 06 §10 milestone 9 — a section keys on its *heading*, so rewording
  // one is the edit that tests it. "What moved the margin" is chosen because it
  // sits below the deletion, which is what makes the wrong-place question live:
  // its positional path still matches a heading afterwards, just not its own.
  out = replaceOnce(
    out,
    "<h2><strong>What moved the margin</strong></h2>",
    "<h2><strong>Why the margin moved</strong></h2>",
  );

  return deleteDocxSection(out, "<h2><strong>At a glance</strong></h2>");
}

function editMarkdown(source: string): string {
  const intro = "Requires Python 3.10 or newer and GDAL 3.6+.";
  let out = replaceOnce(
    source,
    intro,
    `${intro}\n\nInserted by the milestone 0 spike. It exists only to shift every\ncharacter offset below it.`,
  );

  out = replaceOnce(
    out,
    "Tile size matters more than worker count.",
    "Tile size counts for far more than the number of workers.",
  );

  // §10 milestone 9 — the reworded heading. Its slug id changes with it, which
  // is the whole point: the strongest key a Markdown section has stops matching.
  out = replaceOnce(out, "## Configuration", "## Settings, and where they come from");

  return deleteMarkdownSection(out, "## FAQ");
}

function replaceOnce(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  if (at === -1) throw new Error(`edit target not found: ${needle.slice(0, 60)}…`);
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

/**
 * Removes a mammoth section: the heading and everything up to the next `<h1>`
 * or `<h2>`. mammoth emits no `<section>` element, so a section here is what a
 * reader would call one — a heading and the blocks under it.
 */
function deleteDocxSection(html: string, heading: string): string {
  const start = html.indexOf(heading);
  if (start === -1) throw new Error(`heading not found: ${heading}`);
  const rest = html.slice(start + heading.length);
  const next = rest.search(/<h[12][\s>]/);
  if (next === -1) throw new Error("could not find the heading after the section to delete");
  return html.slice(0, start) + rest.slice(next);
}

/** Removes an `## …` section up to the next heading of the same level. */
function deleteMarkdownSection(source: string, heading: string): string {
  const start = source.indexOf(heading);
  if (start === -1) throw new Error(`heading not found: ${heading}`);
  const next = source.indexOf("\n## ", start + heading.length);
  return source.slice(0, start) + (next === -1 ? "" : source.slice(next + 1));
}

const PAGE = (title: string, body: string): string =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n${body}\n</body></html>\n`;

// ── Main ────────────────────────────────────────────────────────

const DOCX_MARKERS: Marker[] = [
  {
    id: "docx/title",
    quote: "Quarterly Business Review",
    expect: "ok",
    why: "above the insertion point — offsets unchanged",
  },
  {
    id: "docx/repeated-phrase",
    quote: "Q2 2026",
    expect: "ok",
    why: "occurs three times; must disambiguate by prefix/suffix, not pick the first",
  },
  {
    id: "docx/after-insert",
    quote: "Two areas need attention before the next cycle.",
    expect: "ok",
    why: "below the inserted paragraph — §13 requires these stay ok",
  },
  {
    id: "docx/below-deletion",
    quote: "Figures are drawn from the consolidated ledger as at 30 June 2026",
    expect: "ok",
    why: "the first paragraph after the deleted section",
  },
  {
    id: "docx/reworded",
    quote: "Margin expansion came from three identifiable sources.",
    expect: "moved-or-orphaned",
    why: "THE REWORDED ONE — must never resolve silently to another passage",
  },
  {
    id: "docx/deleted-section",
    quote: "Total revenue of 12.8M USD, up 17.4% year over year",
    expect: "orphaned",
    why: "inside the deleted 'At a glance' section",
  },
  {
    id: "docx/caption",
    quote: "Figure 2 — Active accounts and monthly churn rate, January to June 2026.",
    expect: "ok",
    why: "an italic caption below both the insertion and the deletion",
  },
  {
    id: "docx/pull-quote",
    quote: "The migration paid for itself two quarters earlier than we forecast",
    expect: "ok",
    why: "inside a quoted, italic run — inline elements must not break the quote",
  },
  {
    id: "docx/last",
    quote: "Approved by the executive committee",
    expect: "ok",
    why: "last paragraph — the largest offset shift",
  },
];

const MD_MARKERS: Marker[] = [
  {
    id: "md/title",
    quote: "A tiled, parallel resampler for very large raster datasets.",
    expect: "ok",
    why: "the bold tagline under the h1, above everything",
  },
  {
    id: "md/repeated-phrase",
    quote: "Sentinel-2 mosaic",
    expect: "ok",
    why: "occurs twice, in prose and in a table cell; must disambiguate by prefix/suffix",
  },
  {
    id: "md/after-insert",
    quote: "Reproject a 40 GB scene to EPSG:3857 with bilinear resampling:",
    expect: "ok",
    why: "below the inserted paragraph",
  },
  {
    id: "md/list-item",
    quote: "Command-line flags",
    expect: "ok",
    why: "short quote inside an ordered-list item",
  },
  {
    id: "md/reworded",
    quote: "Tile size matters more than worker count.",
    expect: "moved-or-orphaned",
    why: "THE REWORDED ONE — inside an alert callout; must never resolve silently to another passage",
  },
  {
    id: "md/deleted-section",
    quote: "Can I resume an interrupted run?",
    expect: "orphaned",
    why: "inside the deleted FAQ section",
  },
  {
    id: "md/inline-code",
    quote: "Tilecat falls back to a single-pass path below --tile-threshold (default 1 GB).",
    expect: "ok",
    why: "spans an inline code span — inline elements must not break the quote",
  },
  {
    id: "md/contributing",
    quote: "Pull requests are welcome. Before opening one:",
    expect: "ok",
    why: "immediately after the deleted section — the neighbour most at risk",
  },
  {
    id: "md/last",
    quote: "Third-party components retain their own licences",
    expect: "ok",
    why: "last section — the largest offset shift",
  },
];

// ── The region gate ─────────────────────────────────────────────
//
// A region anchor is geometry, and geometry always resolves: redraw the chart
// and x/y/w/h still land inside it, onto different content, reporting success.
// That is the one silent wrong-place failure the rest of §6 is built to avoid,
// and the `RegionRef.fingerprint` field exists solely to close it. This case is
// the proof, and it fails loudly if the field is ever dropped.
//
// It runs on the DOCX render, whose four figures are `<img>` elements with
// data-URI sources — deterministic, no network, and exactly what a chart in a
// Word document is.

interface RegionCheck {
  id: string;
  orphaned: boolean;
  landedOn: string | null;
}

/** A valid 1×1 PNG — "a different picture", as small as one can be. */
const ONE_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Redraws one figure in place: same element, same position, new content. */
function redrawImage(html: string, which: number): string {
  const images = [...html.matchAll(/<img[^>]*>/g)];
  const image = images[which];
  if (!image) throw new Error(`document has no img at index ${which}`);
  const redrawn = image[0].replace(/src="[^"]*"/, `src="${ONE_PIXEL}"`);
  if (redrawn === image[0]) throw new Error("img has no src to redraw");
  return html.slice(0, image.index) + redrawn + html.slice(image.index + image[0].length);
}

function createRegionsInPage(which: number): Array<{ id: string; anchor: Anchor }> {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  const images = document.querySelectorAll("img");
  const box = { x: 8, y: 8, w: 40, h: 24 };
  return [
    { id: "region/redrawn", anchor: rex.createRegionAnchor(index, images[which], box, null) },
    { id: "region/untouched", anchor: rex.createRegionAnchor(index, images[which + 1], box, null) },
  ];
}

function resolveRegionsInPage(created: Array<{ id: string; anchor: Anchor }>): RegionCheck[] {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  return created.map((record) => {
    const resolution = rex.resolveAnchor(index, record.anchor);
    return {
      id: record.id,
      orphaned: resolution === null,
      landedOn: resolution?.element
        ? `<${resolution.element.tagName.toLowerCase()}> ${(resolution.element.getAttribute("alt") ?? "").slice(0, 60)}`
        : null,
    };
  });
}

async function runRegionGate(bundle: string, html: string): Promise<number> {
  const which = 1;
  const original = join(WORK, "region-original.html");
  const redrawn = join(WORK, "region-redrawn.html");
  writeFileSync(original, html);
  writeFileSync(redrawn, redrawImage(html, which));

  const created = await withPage(bundle, original, (page) =>
    page.evaluate(createRegionsInPage, which),
  );
  const checks = await withPage(bundle, redrawn, (page) =>
    page.evaluate(resolveRegionsInPage, created),
  );

  console.log(`\n── Regions · a redrawn figure must not resolve ${"─".repeat(14)}`);
  let failures = 0;
  for (const check of checks) {
    // The redrawn one must orphan; its neighbour must survive, or the
    // fingerprint is simply rejecting everything and proves nothing.
    const expected = check.id === "region/redrawn";
    const ok = check.orphaned === expected;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "pass" : "FAIL"}        ${check.id.padEnd(22)} ${
        check.orphaned ? "orphaned" : "resolved"
      }  expected=${expected ? "orphaned" : "resolved"}`,
    );
    console.log(
      `              ${
        expected
          ? "the figure was redrawn — geometry alone would have resolved onto new content"
          : "untouched figure, so the box still means what it meant"
      }`,
    );
  }
  return failures;
}

// ── The section gate (spec 06 §10 milestone 9) ──────────────────
//
// A section anchor names its *heading* and means everything under it (§4.3), so
// the failure it can hide is different from a text anchor's: not "the quote
// moved" but "the heading is gone and something else answered to its
// description". A positional path like `h2:nth-of-type(4)` still matches a
// heading after a section above it is deleted — it is just not the same
// heading. That resolves, reports `moved`, and outlines the wrong four thousand
// characters.
//
// So this case does not assert that a section resolved. It prints the heading
// each one *landed on* and fails when that is not the heading it was created
// from.

interface SectionMarker {
  id: string;
  /** The heading's exact text in the original document. */
  heading: string;
  expect: AnchorState | "moved-or-orphaned";
  why: string;
}

interface SectionResult {
  id: string;
  layer: number | null;
  state: AnchorState;
  /** The heading it landed on — the thing that must not change. */
  landedOn: string | null;
  /** Where the run ends, so a run that swallowed the next section is visible. */
  endsAt: string | null;
  blocks: number;
}

function createSectionsInPage(input: {
  markers: SectionMarker[];
  sourceFile: string | null;
}): Array<{ id: string; anchor: Anchor; signature: string }> {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];

  return input.markers.map((marker) => {
    const heading = headings.find((h) => (h.textContent ?? "").trim() === marker.heading);
    if (!heading) throw new Error(`section heading not present: ${marker.heading}`);
    return {
      id: marker.id,
      anchor: rex.createSectionAnchor(index, heading, input.sourceFile),
      signature: marker.heading,
    };
  });
}

function resolveSectionsInPage(
  created: Array<{ id: string; anchor: Anchor; signature: string }>,
): SectionResult[] {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);

  return created.map((record) => {
    const resolution = rex.resolveAnchor(index, record.anchor);
    const run = resolution && resolution.kind === "run" ? resolution : null;

    let blocks = 0;
    if (run) {
      let el: Element | null = run.first;
      while (el) {
        blocks++;
        if (el === run.last) break;
        el = el.nextElementSibling;
      }
    }

    return {
      id: record.id,
      layer: resolution ? resolution.layer : null,
      state: rex.anchorStateFor(resolution, false) as AnchorState,
      landedOn: run ? (run.first.textContent ?? "").trim() : null,
      // The tag too: the last block of a run is often a table or a figure whose
      // own text is empty, and a diagnostic that prints blank is one nobody
      // trusts.
      endsAt: run
        ? `<${run.last.tagName.toLowerCase()}> ${(run.last.textContent ?? "").trim().slice(0, 50)}`
        : null,
      blocks,
    };
  });
}

async function runSectionGate(
  bundle: string,
  name: string,
  markers: SectionMarker[],
  original: string,
  edited: string,
  sourceFile: string | null,
): Promise<number> {
  const created = await withPage(bundle, original, (page) =>
    page.evaluate(createSectionsInPage, { markers, sourceFile }),
  );
  const results = await withPage(bundle, edited, (page) =>
    page.evaluate(resolveSectionsInPage, created),
  );

  const byId = new Map(markers.map((m) => [m.id, m]));
  const signatures = new Map(created.map((c) => [c.id, c.signature]));
  let failures = 0;

  console.log(`\n── Sections · ${name} ${"─".repeat(Math.max(0, 44 - name.length))}`);
  for (const row of results) {
    const marker = byId.get(row.id);
    const expected = marker?.expect ?? "ok";
    const ok =
      expected === "moved-or-orphaned"
        ? row.state === "moved" || row.state === "orphaned"
        : row.state === expected;

    // The failure this case exists for: a section that resolved onto a heading
    // it was never created from. Checked whatever the state says, because
    // `moved` is exactly what a wrong-place resolution reports.
    const signature = signatures.get(row.id);
    const wrongPlace = row.landedOn !== null && norm(row.landedOn) !== norm(signature ?? "");

    if (!ok || wrongPlace) failures++;
    const verdict = wrongPlace ? "WRONG PLACE" : ok ? "pass" : "FAIL";
    console.log(
      `  ${verdict.padEnd(11)} ${row.id.padEnd(24)} state=${row.state.padEnd(9)} layer=${row.layer ?? "-"}  expected=${expected}`,
    );
    if (marker) console.log(`              ${marker.why}`);
    if (row.landedOn) {
      console.log(
        `              heading: ${norm(row.landedOn).slice(0, 70)} · ${row.blocks} block(s), ends at: ${norm(row.endsAt ?? "")}`,
      );
    }
  }
  return failures;
}

const MD_SECTIONS: SectionMarker[] = [
  {
    id: "md/installation",
    heading: "Installation",
    expect: "ok",
    why: "the insertion lands inside its run — a section grows without moving",
  },
  {
    id: "md/benchmarks",
    heading: "Benchmarks",
    expect: "ok",
    why: "below the insertion; its slug id carries it whatever the offsets do",
  },
  {
    id: "md/deleted",
    heading: "FAQ",
    expect: "orphaned",
    why: "the whole section was deleted — there is no heading to walk from",
  },
  {
    id: "md/reworded-inside",
    heading: "Quick start",
    expect: "ok",
    why: "a sentence inside it was rewritten; the heading is what the anchor names",
  },
  {
    id: "md/reworded-heading",
    heading: "Configuration",
    expect: "moved-or-orphaned",
    why: "THE REWORDED HEADING — must never resolve to the neighbouring section",
  },
];

const DOCX_SECTIONS: SectionMarker[] = [
  {
    id: "docx/executive-summary",
    heading: "Executive summary",
    expect: "ok",
    why: "the insertion lands inside its run — a section grows without moving",
  },
  {
    id: "docx/deleted",
    heading: "At a glance",
    expect: "orphaned",
    why: "the whole section was deleted — there is no heading to walk from",
  },
  {
    id: "docx/scope",
    heading: "Scope and method",
    expect: "ok",
    why: "just below the deletion — no id here, so it resolves on its heading's text",
  },
  {
    id: "docx/financial",
    heading: "1. Financial performance",
    expect: "ok",
    why: "an h1 below the deletion; its run ends where the next h1 begins",
  },
  {
    id: "docx/reworded-heading",
    heading: "What moved the margin",
    expect: "moved-or-orphaned",
    why: "THE REWORDED HEADING — its positional path still matches a heading, just not its own",
  },
];

// ── The gap gate (spec 16 §6.3) ─────────────────────────────────
//
// **A gap is the anchor kind most able to fail silently**, because a gap looks
// the same everywhere. A quote that resolves to the wrong paragraph is visibly
// wrong; a gap that resolves three paragraphs late looks exactly like a gap.
//
// So §6.3 makes it report doubt rather than confidence: a single-sided match is
// `moved` and never `ok`, and no neighbour at all is `orphaned` rather than
// "somewhere near where it used to be". This case is the proof of both, and it
// runs against the same two documents and the same three edits.

interface GapMarker {
  id: string;
  /**
   * The gap AFTER the block holding this text — so the two neighbours are
   * genuinely adjacent, exactly as `GapLayer` would have offered them.
   */
  after: string;
  expect: AnchorState;
  why: string;
}

interface GapCreated {
  id: string;
  anchor: Anchor;
  /** The opening words of each neighbour, so a wrong-place match is visible. */
  afterSignature: string;
  beforeSignature: string;
}

interface GapResult {
  id: string;
  state: AnchorState;
  landedAfter: string | null;
  landedBefore: string | null;
}

function createGapsInPage(input: {
  markers: GapMarker[];
  sourceFile: string | null;
}): GapCreated[] {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const sign = (el: Element | null): string => norm(el?.textContent ?? "").slice(0, 60);

  // The same set spec 16 §6.6 offers gaps between: stamped blocks where the
  // renderer stamped any, keeping only the outermost. The mammoth document
  // carries no `data-src-line` at all, so there the block tags stand in — which
  // is what the gap RESOLVER sees either way, since it walks to the nearest
  // stamped ancestor and falls back to the element itself.
  const stamped = [...document.querySelectorAll("[data-src-line]")];
  const candidates =
    stamped.length > 0
      ? stamped
      : [...document.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,pre,table,blockquote,figure")];
  const blocks = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.contains(el)),
  );

  return input.markers.map((marker) => {
    const wanted = norm(marker.after);
    const at = blocks.findIndex((el) => norm(el.textContent ?? "").includes(wanted));
    if (at === -1) throw new Error(`gap marker's block not found: ${marker.id}`);
    const after = blocks[at];
    const before = blocks[at + 1] ?? null;
    if (!before) throw new Error(`gap marker has no block below it: ${marker.id}`);
    return {
      id: marker.id,
      anchor: rex.createGapAnchor(index, after, before, input.sourceFile),
      afterSignature: sign(after),
      beforeSignature: sign(before),
    };
  });
}

function resolveGapsInPage(created: GapCreated[]): GapResult[] {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

  return created.map((record) => {
    const resolution = rex.resolveAnchor(index, record.anchor);
    const gap = resolution && resolution.kind === "gap" ? resolution : null;
    return {
      id: record.id,
      state: rex.anchorStateFor(resolution, false) as AnchorState,
      landedAfter: gap?.after ? norm(gap.after.textContent ?? "").slice(0, 60) : null,
      landedBefore: gap?.before ? norm(gap.before.textContent ?? "").slice(0, 60) : null,
    };
  });
}

async function runGapGate(
  bundle: string,
  name: string,
  markers: GapMarker[],
  original: string,
  edited: string,
  sourceFile: string | null,
): Promise<number> {
  const created = await withPage(bundle, original, (page) =>
    page.evaluate(createGapsInPage, { markers, sourceFile }),
  );
  const results = await withPage(bundle, edited, (page) =>
    page.evaluate(resolveGapsInPage, created),
  );

  const byId = new Map(markers.map((m) => [m.id, m]));
  const madeFrom = new Map(created.map((c) => [c.id, c]));
  let failures = 0;

  console.log(`\n── Gaps · ${name} ${"─".repeat(Math.max(0, 48 - name.length))}`);
  for (const row of results) {
    const marker = byId.get(row.id);
    const made = madeFrom.get(row.id);
    const ok = row.state === (marker?.expect ?? "ok");

    // The failure this case exists for: a neighbour that resolved onto a block
    // it was never created from. A gap three paragraphs late is invisible to
    // the eye, so it has to be caught here or nowhere.
    const wrongPlace =
      (row.landedAfter !== null && row.landedAfter !== made?.afterSignature) ||
      (row.landedBefore !== null && row.landedBefore !== made?.beforeSignature);

    if (!ok || wrongPlace) failures++;
    const verdict = wrongPlace ? "WRONG PLACE" : ok ? "pass" : "FAIL";
    console.log(
      `  ${verdict.padEnd(11)} ${row.id.padEnd(24)} state=${row.state.padEnd(9)} sides=${
        [row.landedAfter ? "after" : null, row.landedBefore ? "before" : null]
          .filter(Boolean)
          .join("+") || "none"
      }  expected=${marker?.expect}`,
    );
    if (marker) console.log(`              ${marker.why}`);
    console.log(`              after:  ${row.landedAfter ?? "(gone)"}`);
    console.log(`              before: ${row.landedBefore ?? "(gone)"}`);
  }
  return failures;
}

const MD_GAPS: GapMarker[] = [
  {
    id: "md-gap/untouched",
    after: "Environment variables mirror the flags",
    expect: "ok",
    why: "both neighbours survive every edit — the only case that may report ok",
  },
  {
    id: "md-gap/after-only",
    after: "Deprecation of --legacy-scheduler, which has been a no-op since 1.0.",
    expect: "moved",
    why: "the block BELOW is the deleted FAQ heading; the table of contents still holds an <li> reading 'FAQ', which must not answer for it",
  },
  {
    id: "md-gap/before-only",
    after: "Is the output bit-identical to GDAL's gdalwarp?",
    expect: "moved",
    why: "the block ABOVE went with the deleted section; it resolves via `before`",
  },
  {
    id: "md-gap/orphaned",
    after: "Does Tilecat modify the source file?",
    expect: "orphaned",
    why: "both neighbours were deleted — never 'somewhere near where it used to be'",
  },
];

const DOCX_GAPS: GapMarker[] = [
  {
    id: "docx-gap/untouched",
    after: "The following commitments were agreed at the quarterly planning session.",
    expect: "ok",
    why: "a paragraph and the table under it; both survive every edit",
  },
  {
    id: "docx-gap/after-only",
    after: "Two areas need attention before the next cycle.",
    expect: "moved",
    why: "the block BELOW is the deleted 'At a glance' heading — one side is not ok",
  },
  {
    id: "docx-gap/before-only",
    after: "Headcount grew by 34, of which 21 joined delivery and support functions.",
    expect: "moved",
    why: "the last item of the deleted section — only what follows it is left",
  },
  {
    id: "docx-gap/orphaned",
    after: "At a glance",
    expect: "orphaned",
    why: "a heading and its first bullet, both inside the deleted section",
  },
];

async function main(): Promise<void> {
  mkdirSync(WORK, { recursive: true });

  const built = await esbuild.build({
    entryPoints: [join(import.meta.dirname, "../src/renderer/anchor/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "__rexAnchor",
    write: false,
    platform: "browser",
    target: "chrome120",
  });
  const bundle = built.outputFiles[0].text;

  const docx = (await renderDocx(DOCX_DOC)).html;
  const docxOriginal = join(WORK, "original.docx.html");
  const docxEdited = join(WORK, "edited.docx.html");
  writeFileSync(docxOriginal, PAGE("sample-document.docx", docx));
  writeFileSync(docxEdited, PAGE("sample-document.docx", editDocx(docx)));

  const markdown = readFileSync(MD_DOC, "utf8");
  const mdOriginal = join(WORK, "original.md.html");
  const mdEdited = join(WORK, "edited.md.html");
  writeFileSync(mdOriginal, PAGE("sample-document.md", renderMarkdown(markdown)));
  writeFileSync(mdEdited, PAGE("sample-document.md", renderMarkdown(editMarkdown(markdown))));

  const cases: Case[] = [
    {
      name: "DOCX · sample-document.docx (mammoth, no data-src-line)",
      markers: DOCX_MARKERS,
      element: {
        selector: "table",
        index: 1,
        id: "docx/table-element",
        quote: "",
        expect: "ok",
        why: "the 'Summary of results' table — has text, so it resolves by quote, not by position",
      },
      original: docxOriginal,
      edited: docxEdited,
      sourceFile: null,
    },
    {
      name: "Markdown · sample-document.md (data-src-line)",
      markers: MD_MARKERS,
      element: {
        // Not the Mermaid fence: a diagram block resolves by spec 29's own
        // rules and is covered by test/diagram.spec.ts. A plain fence is the
        // element-anchor case this gate is about.
        selector: "pre",
        index: 1,
        id: "md/pre-element",
        quote: "",
        expect: "ok",
        why: "the console fence under Installation — has text, so it resolves by quote, not by position",
      },
      original: mdOriginal,
      edited: mdEdited,
      sourceFile: MD_DOC,
    },
  ];

  let failures = 0;
  const survival: string[] = [];
  for (const testCase of cases) {
    const result = await runCase(bundle, testCase);
    failures += result.failures;
    survival.push(
      `${testCase.name.split(" ·")[0]}: ${result.survived}/${testCase.markers.length + 1}`,
    );
  }

  failures += await runRegionGate(bundle, PAGE("sample-document.docx", docx));

  // Spec 06 §10 milestone 9 — both documents, the same three edits, plus the
  // one edit a section can actually feel: its heading reworded.
  failures += await runSectionGate(
    bundle,
    "sample-document.md",
    MD_SECTIONS,
    mdOriginal,
    mdEdited,
    MD_DOC,
  );
  failures += await runSectionGate(
    bundle,
    "sample-document.docx",
    DOCX_SECTIONS,
    docxOriginal,
    docxEdited,
    null,
  );

  // Spec 16 §6.3 — the new kind, against both documents. It is the one most
  // able to fail silently, so it is the one that has to fail loudly.
  failures += await runGapGate(bundle, "sample-document.md", MD_GAPS, mdOriginal, mdEdited, MD_DOC);
  failures += await runGapGate(
    bundle,
    "sample-document.docx",
    DOCX_GAPS,
    docxOriginal,
    docxEdited,
    null,
  );

  // §13 step 6 — the number that justifies owning the Markdown renderer.
  console.log(`\nSurvival after the same three edits — ${survival.join("  ·  ")}`);
  console.log(
    failures === 0
      ? "\nGATE PASSED — every classification matches inspection.\n"
      : `\nGATE FAILED — ${failures} anchor(s) misclassified or resolved to the wrong place.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
