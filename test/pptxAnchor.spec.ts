// Spec 11 milestone 11.3 — **the gate.**
//
// "If a deck's anchors cannot survive the deck being edited and re-saved, the
// rest is not worth building." Same reasoning as milestone 0 in spec 01 §13,
// and the same shape of script: it does not assert that resolution *succeeded*,
// it prints what each anchor resolved **to** and fails when that is not what it
// was created from. A wrong-place resolution reports `ok`, and looking right is
// the whole of what makes it dangerous.
//
// §10's anchoring criteria say "rewrite one shape's text **in PowerPoint**,
// re-save, reopen". PowerPoint cannot be driven from here, so the three edited
// decks below are produced by REX's own surgery (§7.3). That is a fair stand-in
// and in one way a harder one: PowerPoint re-writes metadata and recompresses
// on save, which changes the bytes everywhere and would make the reader rebuild
// the page from scratch; REX's surgery changes one part and leaves every other
// byte alone, so an anchor that breaks here breaks on the *smallest* edit a
// deck can receive.
//
// Run: npm run test:pptx-anchor

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium, type Page } from "playwright";
import { type OoxmlPackage, openPackage } from "../src/main/ooxml/package.ts";
import { slidePartAt } from "../src/main/pptx/deck.ts";
import {
  applyPlanToPackage,
  insertShapeXml,
  openContext,
  textBoxXml,
} from "../src/main/pptx/edit.ts";
import { parsePlan } from "../src/main/pptx/plan.ts";
import { slideHtml } from "../src/main/render/pptxSlides.ts";
import { DECK_STYLESHEET } from "../src/main/render/pptxStylesheet.ts";
import { parseDeck } from "../src/main/render/pptxText.ts";
import type { Anchor, AnchorState } from "../src/shared/types.ts";

const DECK = join(
  homedir(),
  "Projects/Github/onion-ai-eu/executive-management/customers/agri-chem/agrofert/presentation/Onion-AI-Agrofert-EN.pptx",
);
const WORK = join(process.env.REX_SPIKE_DIR ?? tmpdir(), "rex-pptx-anchor");

const TITLE = "Onion: the group data plane";
const REWORDED = "Onion: the group control plane";

/** What each anchor is expected to report against one edited deck. */
type Expectation = AnchorState | "moved-or-orphaned";

interface Marker {
  id: string;
  /** How the anchor is made, inside the page. */
  kind: "text" | "element" | "region";
  /** For a text anchor: the words. For the others: a CSS selector. */
  target: string;
  why: string;
}

interface Created {
  id: string;
  anchor: Anchor;
  /** What it was created *on*, so re-resolution can be checked against it. */
  signature: string;
}

interface Resolved {
  id: string;
  layer: number | null;
  state: AnchorState;
  landedOn: string | null;
}

const MARKERS: Marker[] = [
  {
    id: "quote/title",
    kind: "text",
    target: TITLE,
    why: "the words of slide 4's title — the passage the reword destroys",
  },
  {
    id: "quote/card",
    kind: "text",
    target: "Every BU's operational systems",
    why: "body copy in a card on the same slide, which nothing touches",
  },
  {
    id: "quote/elsewhere",
    kind: "text",
    target: "How it integrates",
    why: "a different slide entirely — must be untouched by every edit",
  },
  {
    id: "element/title-shape",
    kind: "element",
    target: "#slide-4 [data-name='Text 1']",
    why: "the title SHAPE, whose id is an index and whose name is not (§5.2)",
  },
  {
    id: "element/card",
    kind: "element",
    target: "#slide-4 [data-name='Shape 3']",
    why: "a shape below the insertion point — the one whose id renumbers",
  },
  {
    id: "region/slide",
    kind: "region",
    target: "#slide-4",
    why: "a box drawn on the whole slide, stored as fractions of #slide-N",
  },
  {
    id: "element/whole-slide",
    kind: "element",
    target: "#slide-1",
    why: "comment on a whole slide, on a slide no edit touches",
  },
];

const norm = (value: string): string => value.replace(/\s+/g, " ").trim();

// ── The browser half ────────────────────────────────────────────

/** A drag box, in the element's own coordinates. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What `resolveAnchor` returns, narrowed to what this file reads off it. */
interface Landing {
  kind: string;
  layer: number;
  range?: Range;
  element?: Element;
}

/**
 * The bundled resolver, as the page sees it.
 *
 * `esbuild` puts it on `window`, so there is no import to take the types from
 * and the text index is opaque here — it is a value this file passes back and
 * never inspects.
 */
interface RexAnchor {
  buildTextIndex(doc: Document): unknown;
  offsetsToRange(index: unknown, at: { start: number; end: number }): Range | null;
  createTextAnchor(index: unknown, range: Range, sourceFile: string | null): Anchor;
  createElementAnchor(index: unknown, el: Element, sourceFile: string | null): Anchor;
  createRegionAnchor(index: unknown, el: Element, box: Box, sourceFile: string | null): Anchor;
  resolveAnchor(index: unknown, anchor: Anchor): Landing | null;
  anchorStateFor(resolution: Landing | null, documentChanged: boolean): AnchorState;
}

function createInPage(markers: Marker[]): Created[] {
  const rex = (window as unknown as { __rexAnchor: RexAnchor }).__rexAnchor;
  const index = rex.buildTextIndex(document);

  // The signature is what the anchor was created ON, in a form that can be
  // compared against wherever it lands — and an anchor can land as a Range or
  // as an Element, so the signature has to be comparable to both. Text is the
  // one thing both have; a shape with none falls back to its name, which is
  // what the element description then also reports.
  const describe = (el: Element): string => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text.slice(0, 90) : `[${el.getAttribute("data-name") ?? el.id}]`;
  };

  return markers.map((marker) => {
    if (marker.kind === "text") {
      const at = (index as { text: string }).text.indexOf(marker.target);
      if (at === -1) throw new Error(`marker not in the deck: ${marker.id} (${marker.target})`);
      const range = rex.offsetsToRange(index, { start: at, end: at + marker.target.length });
      if (!range) throw new Error(`marker did not map back to a Range: ${marker.id}`);
      return {
        id: marker.id,
        anchor: rex.createTextAnchor(index, range, null),
        signature: marker.target,
      };
    }

    const el = document.querySelector(marker.target);
    if (!el) throw new Error(`no element for ${marker.id}: ${marker.target}`);

    if (marker.kind === "region") {
      const rect = el.getBoundingClientRect();
      const box = {
        x: rect.width * 0.1,
        y: rect.height * 0.1,
        w: rect.width * 0.5,
        h: rect.height * 0.3,
      };
      return {
        id: marker.id,
        anchor: rex.createRegionAnchor(index, el, box, null),
        signature: describe(el),
      };
    }

    return {
      id: marker.id,
      anchor: rex.createElementAnchor(index, el, null),
      signature: describe(el),
    };
  });
}

function resolveInPage(created: Created[]): Resolved[] {
  const rex = (window as unknown as { __rexAnchor: RexAnchor }).__rexAnchor;
  const index = rex.buildTextIndex(document);

  const describe = (el: Element): string => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text.slice(0, 90) : `[${el.getAttribute("data-name") ?? el.id}]`;
  };

  return created.map((record) => {
    const resolution = rex.resolveAnchor(index, record.anchor) as {
      kind: string;
      layer: number;
      range?: Range;
      element?: Element;
    } | null;

    let landedOn: string | null = null;
    if (resolution?.kind === "range" && resolution.range) landedOn = resolution.range.toString();
    else if (resolution?.kind === "element" && resolution.element) {
      landedOn = describe(resolution.element);
    }

    return {
      id: record.id,
      layer: resolution ? resolution.layer : null,
      // The deck's bytes always change when it is re-saved (§5.3), so the state
      // here reflects the resolution layer only — exactly as the milestone 0
      // spike does. `documentChanged` is the app's comparison, not this one's.
      state: rex.anchorStateFor(resolution, false),
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

/** The deck, rendered the way `renderPptx` renders it, minus its media cache. */
async function pageFor(bytes: Buffer, file: string): Promise<string> {
  const deck = await parseDeck(bytes);
  const slides = deck.slides
    .map((slide, index) => slideHtml(slide, index + 1, (ref) => `media/${ref.split("/").pop()}`))
    .join("\n");
  const html = `<!doctype html>
<html lang="en" data-rex-paper>
<head><meta charset="utf-8"><title>deck</title><style>${DECK_STYLESHEET}</style></head>
<body>
<article class="rex-deck" style="--slide-w:${deck.size.width}pt;--slide-h:${deck.size.height}pt">
${slides}
</article>
</body></html>`;
  writeFileSync(file, html);
  return file;
}

/** §7.3 — one shape's text rewritten, and nothing else in the file touched. */
async function rewordedDeck(source: Buffer): Promise<Buffer> {
  const plan = parsePlan({
    deck: DECK,
    operations: [{ op: "setText", slide: 4, shape: "Text 1", from: TITLE, to: REWORDED }],
  });
  return (await applyPlanToPackage(await openPackage(source), plan)).bytes;
}

/**
 * A shape inserted at the **front** of slide 4's tree, which is what sending a
 * new background rectangle to the back does in PowerPoint — and what
 * `placement: "background"` does in §7.4.4.
 *
 * This is the edit the shape id cannot survive: every `slide-4-shape-M` below
 * it renumbers, so an anchor that trusted the id lands on its neighbour and
 * reports success.
 */
async function deckWithInsertedShape(source: Buffer): Promise<Buffer> {
  const pkg: OoxmlPackage = await openPackage(source);
  const context = await openContext(pkg);
  const part = slidePartAt(context.map, 4);
  const xml = await pkg.readText(part);
  const fragment = textBoxXml({
    id: 900,
    name: "Inserted first",
    box: { x: 0.02, y: 0.9, w: 0.2, h: 0.05 },
    size: context.size,
    text: "inserted before everything",
  });
  pkg.write(part, insertShapeXml(xml, fragment, "front"));
  return pkg.toBuffer();
}

/** §5.3 — PowerPoint re-saving a deck it did not change. */
async function resavedDeck(source: Buffer): Promise<Buffer> {
  return (await openPackage(source)).toBuffer();
}

interface Variant {
  name: string;
  bytes: Buffer;
  expect: Record<string, Expectation>;
  /** Anchors whose landing place is *expected* to differ from creation. */
  mayLandElsewhere: Set<string>;
}

function report(variant: Variant, created: Created[], resolved: Resolved[]): number {
  const signatures = new Map(created.map((record) => [record.id, record.signature]));
  const why = new Map(MARKERS.map((marker) => [marker.id, marker.why]));
  let failures = 0;

  console.log(`\n── ${variant.name} ${"─".repeat(Math.max(0, 58 - variant.name.length))}`);
  for (const row of resolved) {
    const expected = variant.expect[row.id] ?? "ok";
    const ok =
      expected === "moved-or-orphaned"
        ? row.state === "moved" || row.state === "orphaned"
        : row.state === expected;

    // The failure this whole file exists to catch: an anchor sitting on
    // something it was never created from, reporting success.
    const signature = signatures.get(row.id);
    const wrongPlace =
      !variant.mayLandElsewhere.has(row.id) &&
      row.layer !== null &&
      row.layer !== 2 &&
      !!signature &&
      !!row.landedOn &&
      !norm(row.landedOn).includes(norm(signature).slice(0, 60));

    if (!ok || wrongPlace) failures++;
    console.log(
      `  ${(wrongPlace ? "WRONG PLACE" : ok ? "pass" : "FAIL").padEnd(11)} ${row.id.padEnd(22)} state=${row.state.padEnd(9)} layer=${row.layer ?? "-"}  expected=${expected}`,
    );
    console.log(`              ${why.get(row.id) ?? ""}`);
    if (row.landedOn) console.log(`              landed on: ${norm(row.landedOn).slice(0, 96)}`);
  }
  return failures;
}

async function main(): Promise<void> {
  if (!existsSync(DECK)) {
    console.log(`SKIPPED — the acceptance deck is not on this machine:\n  ${DECK}`);
    return;
  }
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

  const source = readFileSync(DECK);
  const original = await pageFor(source, join(WORK, "original.html"));

  const created = await withPage(bundle, original, (page) => page.evaluate(createInPage, MARKERS));
  writeFileSync(join(WORK, "anchors.json"), JSON.stringify(created, null, 2));

  const variants: Variant[] = [
    {
      name: "Re-saved with no edit — nothing may orphan (§10)",
      bytes: await resavedDeck(source),
      expect: {},
      mayLandElsewhere: new Set(),
    },
    {
      name: "One shape's text rewritten (§10)",
      bytes: await rewordedDeck(source),
      expect: {
        // The reworded passage itself. It must never resolve silently elsewhere.
        "quote/title": "moved-or-orphaned",
        // The shape that holds it: its content is no longer what it was, so the
        // fingerprint refuses it. That is §5.2 working, not failing.
        "element/title-shape": "orphaned",
        // The whole slide's markup changed with it.
        "region/slide": "moved-or-orphaned",
      },
      mayLandElsewhere: new Set(["quote/title"]),
    },
    {
      name: "A shape inserted before the anchored ones (§5.2, §10)",
      bytes: await deckWithInsertedShape(source),
      expect: {
        // The slide gained a shape, so a box drawn on the slide is a box on
        // something that is no longer the same picture.
        "region/slide": "moved-or-orphaned",
      },
      // Nothing here may land elsewhere. That is the whole point of the case:
      // the ids all renumbered and every anchor must still be about its own
      // shape, or orphan.
      mayLandElsewhere: new Set(),
    },
  ];

  let failures = 0;
  for (const variant of variants) {
    const file = await pageFor(
      variant.bytes,
      join(WORK, `${variant.name.slice(0, 12).replace(/\W+/g, "-")}.html`),
    );
    const resolved = await withPage(bundle, file, (page) => page.evaluate(resolveInPage, created));
    failures += report(variant, created, resolved);
  }

  console.log(
    failures === 0
      ? "\nGATE PASSED — every deck anchor classification matches inspection.\n"
      : `\nGATE FAILED — ${failures} anchor(s) misclassified or resolved to the wrong place.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
