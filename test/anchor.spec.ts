// SPEC.md §13 Milestone 0 — the anchor spike, and the gate the rest of REX
// waits behind.
//
// Anchoring is the one component that fails silently: a wrong anchor resolves
// to *somewhere*, reports `ok`, and looks fine until a human reads the
// highlight. So this script does not assert that resolution succeeded — it
// prints what each anchor resolved *to*, and fails when a layer 1 hit does not
// return the text it was created from.
//
// Run: npm run test:anchor

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium, type Page } from "playwright";
import { renderMarkdown } from "../src/main/render/markdown.ts";
import type { Anchor, AnchorState } from "../src/shared/types.ts";

const DOCS = join(homedir(), "Projects/Github/redhat/ProtoBot/docs");
const HTML_DOC = join(DOCS, "review/2026-08-20-architecture-explained.html");
const MD_DOC = join(DOCS, "architecture/components.md");
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
}

interface Resolved {
  id: string;
  layer: number | null;
  state: AnchorState;
  /** The raw DOM text (or element description) the anchor landed on. */
  landedOn: string | null;
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
    created.push({
      id: marker.id,
      anchor: rex.createTextAnchor(index, range, input.sourceFile),
      signature: marker.quote,
    });
  }

  const el = document.querySelectorAll(input.element.selector)[input.element.index];
  if (!el) throw new Error(`element anchor target missing: ${input.element.selector}`);
  const elementAnchor = rex.createElementAnchor(index, el, input.sourceFile);
  created.push({
    id: input.element.id,
    anchor: elementAnchor,
    // An element with text resolves through its quote, so compare against that;
    // a textless one can only ever be compared as an element.
    signature: elementAnchor.quote ? elementAnchor.quote.exact : describe(el),
  });

  // Both test documents label their diagrams, so every anchorable element here
  // carries text and never reaches layer 3. This probe strips the quote to
  // force §6.5 step 4 — the path that a real image or icon would take.
  const probe: Created = {
    id: `${input.element.id}/layer-3-probe`,
    anchor: { ...elementAnchor, quote: null, position: null },
    signature: describe(el),
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
    if (resolution?.kind === "range") landedOn = resolution.range.toString();
    else if (resolution?.kind === "element") landedOn = describe(resolution.element);
    return {
      id: record.id,
      layer: resolution ? resolution.layer : null,
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
    const signature = signatures.get(row.id);
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

function editHtml(html: string): string {
  const footnote =
    '<p class="footnote" style="margin-top:1.4rem;">Everything else in the architecture exists to keep those three claims alive. Every component below protects one of them.</p>';
  let out = replaceOnce(
    html,
    footnote,
    `${footnote}\n<p class="footnote">Inserted by the milestone 0 spike. It exists only to shift every character offset below it.</p>`,
  );

  out = replaceOnce(
    out,
    "EARS is the narrow waist of the system. Everything upstream of it is conversation. Everything downstream of it is machinery.",
    "EARS is the pinch point of the whole pipeline. Above the line everything is discussion; below it everything is automation.",
  );

  return deleteHtmlSection(out, '<div class="plate">02</div>');
}

function editMarkdown(source: string): string {
  const intro =
    "For the user-facing flow and phase details, see\n[user-interaction-flow.md](user-interaction-flow.md).";
  let out = replaceOnce(
    source,
    intro,
    `${intro}\n\nInserted by the milestone 0 spike. It exists only to shift every\ncharacter offset below it.`,
  );

  out = replaceOnce(
    out,
    "The WMS Adapter is a thin, pluggable integration layer between\nProtoBot and the user's chosen work management backend.",
    "The WMS Adapter is a slim, swappable bridge that connects ProtoBot\nto whichever work management backend the user picked.",
  );

  return deleteMarkdownSection(out, "## Specification Toolkit");
}

function replaceOnce(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  if (at === -1) throw new Error(`edit target not found: ${needle.slice(0, 60)}…`);
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

/** Removes the whole `<section>` containing `marker`. */
function deleteHtmlSection(html: string, marker: string): string {
  const at = html.indexOf(marker);
  if (at === -1) throw new Error(`section marker not found: ${marker}`);
  const start = html.lastIndexOf("<section>", at);
  const end = html.indexOf("</section>", at);
  if (start === -1 || end === -1) throw new Error("could not bracket the section to delete");
  return html.slice(0, start) + html.slice(end + "</section>".length);
}

/** Removes an `## …` section up to the next heading of the same level. */
function deleteMarkdownSection(source: string, heading: string): string {
  const start = source.indexOf(heading);
  if (start === -1) throw new Error(`heading not found: ${heading}`);
  const next = source.indexOf("\n## ", start + heading.length);
  return source.slice(0, start) + (next === -1 ? "" : source.slice(next + 1));
}

const MD_PAGE = (body: string): string =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>components.md</title></head>\n<body>\n${body}\n</body></html>\n`;

// ── Main ────────────────────────────────────────────────────────

const HTML_MARKERS: Marker[] = [
  {
    id: "html/verdict",
    quote: "ProtoBot turns a written specification into a running demo",
    expect: "ok",
    why: "above the insertion point — offsets unchanged",
  },
  {
    id: "html/repeated-phrase",
    quote: "The specification is the product",
    expect: "ok",
    why: "occurs twice; must disambiguate by prefix/suffix, not pick the first",
  },
  {
    id: "html/after-insert",
    quote: "The design uses a construction metaphor.",
    expect: "ok",
    why: "below the inserted paragraph — §13 requires these stay ok",
  },
  {
    id: "html/ears-parse",
    quote: "A plain program can parse it.",
    expect: "ok",
    why: "short quote below the insertion, inside a list item",
  },
  {
    id: "html/reworded",
    quote:
      "EARS is the narrow waist of the system. Everything upstream of it is conversation. Everything downstream of it is machinery.",
    expect: "moved-or-orphaned",
    why: "THE REWORDED ONE — must never resolve silently to another passage",
  },
  {
    id: "html/deleted-section",
    quote: "Keep them apart, and their agreement becomes real evidence",
    expect: "orphaned",
    why: "inside the deleted section 02",
  },
  {
    id: "html/components",
    quote: "The room where a person and an agent sit together.",
    expect: "ok",
    why: "below both the insertion and the deletion",
  },
  {
    id: "html/walkthrough",
    quote: "If only one part of this document sticks, make it this one.",
    expect: "ok",
    why: "far below the deletion",
  },
  {
    id: "html/gaps",
    quote: "Some is named as an open question but is far bigger than its one bullet suggests.",
    expect: "ok",
    why: "last section — the largest offset shift",
  },
];

const MD_MARKERS: Marker[] = [
  {
    id: "md/title",
    quote: "ProtoBot: System Components",
    expect: "ok",
    why: "the h1, above everything",
  },
  {
    id: "md/overview",
    quote:
      "This document identifies the major system components that ProtoBot needs to be built from",
    expect: "ok",
    why: "hard-wrapped in source; only survives if whitespace normalisation is right",
  },
  {
    id: "md/drafting-table",
    quote: "The Drafting Table is where the human sits down with an AI agent",
    expect: "ok",
    why: "below the inserted paragraph",
  },
  {
    id: "md/two-parts",
    quote: "A Drafting Table implementation consists of two parts",
    expect: "ok",
    why: "spans a bold span — inline elements must not break the quote",
  },
  {
    id: "md/reworded",
    quote:
      "The WMS Adapter is a thin, pluggable integration layer between ProtoBot and the user's chosen work management backend.",
    expect: "moved-or-orphaned",
    why: "THE REWORDED ONE — must never resolve silently to another passage",
  },
  {
    id: "md/deleted-section",
    quote: "The Specification Toolkit is the portable domain logic that any",
    expect: "orphaned",
    why: "inside the deleted Specification Toolkit section",
  },
  {
    id: "md/storage",
    quote: "Project content lives in the project's git repo, not in the",
    expect: "ok",
    why: "below the deletion, spans a bold span",
  },
  {
    id: "md/one-adapter",
    quote: "One adapter implementation is active per project.",
    expect: "ok",
    why: "immediately after the reworded sentence — the neighbour most at risk",
  },
  {
    id: "md/approved-specs",
    quote: "Approved specifications live on main",
    expect: "ok",
    why: "short quote, far below every edit",
  },
];

// ── The region gate ─────────────────────────────────────────────
//
// A region anchor is geometry, and geometry always resolves: redraw the chart
// and x/y/w/h still land inside it, onto different content, reporting success.
// That is the one silent wrong-place failure the rest of §6 is built to avoid,
// and the `RegionRef.fingerprint` field exists solely to close it. This case is
// the proof, and it fails loudly if the field is ever dropped.

interface RegionCheck {
  id: string;
  orphaned: boolean;
  landedOn: string | null;
}

/** Redraws one figure in place: same element, same position, new content. */
function redrawSvg(html: string, which: number): string {
  const blocks = [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)];
  const block = blocks[which];
  if (!block) throw new Error(`document has no svg at index ${which}`);
  const redrawn = block[0].replace(
    /^(<svg[^>]*>)/,
    '$1<circle cx="12" cy="12" r="5" fill="#2f5da8"></circle>',
  );
  return html.slice(0, block.index) + redrawn + html.slice(block.index + block[0].length);
}

function createRegionsInPage(which: number): Array<{ id: string; anchor: Anchor }> {
  const rex = (window as any).__rexAnchor;
  const index = rex.buildTextIndex(document);
  const svgs = document.querySelectorAll("svg");
  const box = { x: 8, y: 8, w: 40, h: 24 };
  return [
    { id: "region/redrawn", anchor: rex.createRegionAnchor(index, svgs[which], box, null) },
    { id: "region/untouched", anchor: rex.createRegionAnchor(index, svgs[which + 1], box, null) },
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
        ? `<${resolution.element.tagName.toLowerCase()}> ${(resolution.element.getAttribute("aria-label") ?? "").slice(0, 60)}`
        : null,
    };
  });
}

async function runRegionGate(bundle: string, html: string): Promise<number> {
  const which = 1;
  const original = join(WORK, "region-original.html");
  const redrawn = join(WORK, "region-redrawn.html");
  writeFileSync(original, html);
  writeFileSync(redrawn, redrawSvg(html, which));

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

  const html = readFileSync(HTML_DOC, "utf8");
  const htmlOriginal = join(WORK, "original.html");
  const htmlEdited = join(WORK, "edited.html");
  writeFileSync(htmlOriginal, html);
  writeFileSync(htmlEdited, editHtml(html));

  const markdown = readFileSync(MD_DOC, "utf8");
  const mdOriginal = join(WORK, "original.md.html");
  const mdEdited = join(WORK, "edited.md.html");
  writeFileSync(mdOriginal, MD_PAGE(renderMarkdown(markdown)));
  writeFileSync(mdEdited, MD_PAGE(renderMarkdown(editMarkdown(markdown))));

  const cases: Case[] = [
    {
      name: "HTML · 2026-08-20-architecture-explained.html",
      markers: HTML_MARKERS,
      element: {
        selector: "svg",
        index: 2,
        id: "html/svg-element",
        quote: "",
        expect: "ok",
        why: "inline SVG in section 03 — its <text> labels are indexable, so it keys on them",
      },
      original: htmlOriginal,
      edited: htmlEdited,
      sourceFile: null,
    },
    {
      name: "Markdown · components.md (data-src-line)",
      markers: MD_MARKERS,
      element: {
        selector: "pre",
        index: 1,
        id: "md/pre-element",
        quote: "",
        expect: "ok",
        why: "a fenced diagram block — has text, so it resolves by quote, not by position",
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

  failures += await runRegionGate(bundle, html);

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
