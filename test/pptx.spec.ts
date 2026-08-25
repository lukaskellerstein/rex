// Spec 11 milestone 11.0 — the reader, judged against real decks.
//
// Runs without Electron, which is why the parse, the text extraction and the
// HTML emitter live in three modules and only one of them reaches the protocol
// handler. Everything asserted here was measured on 2026-08-24 and written into
// spec 11 §2 before any of this code existed; the point of the file is that a
// later reader can re-run the measurements rather than trust them.
//
// The decks are real files on this machine and are deliberately not fixtures —
// §10 says so, and a fixture would be a deck REX's author chose, which is the
// one kind of deck that cannot surprise it. A machine without them skips.
//
// Run: npm run test:pptx

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Shape, Slide } from "pptxtojson/dist/index.js";
import { openPackage } from "../src/main/pptx/package.ts";
import { reorderSlides } from "../src/main/pptx/slides.ts";
import { slideHtml } from "../src/main/render/pptxSlides.ts";
import { DECK_STYLESHEET } from "../src/main/render/pptxStylesheet.ts";
import {
  type ParsedDeck,
  parseDeck,
  sidecarMarkdown,
  slideTexts,
  usedFonts,
} from "../src/main/render/pptxText.ts";

const DECKS = {
  /** §10 — 23 slides, full-bleed photos, gradients, cards, one table, Czech text. */
  agrofert: join(
    homedir(),
    "Projects/Github/onion-ai-eu/executive-management/customers/agri-chem/agrofert/presentation/Onion-AI-Agrofert-EN.pptx",
  ),
  /** §10 — 27 slides, carries native PowerPoint comments REX must ignore. */
  volareza: join(homedir(), "Downloads/VOLAREZA_-_Onion_Machina_-_v4_obsahove_upravy.pptx"),
  /** §10 — 408 zero-size `line` shapes. */
  rules: join(
    homedir(),
    "Documents/onion-ai-governed-decision-layer-v2-design---327e55ec-36e6-4168-8bbc-67cd4da2f371.pptx",
  ),
  /** §10 — the deck that does not parse. Its criterion is the message. */
  broken: join(
    homedir(),
    "Documents/onion_ai_investor_sample_deck---26f9f7fc-0d5c-40a6-b81e-e30d3ac1df79.pptx",
  ),
} as const;

async function open(path: string): Promise<ParsedDeck> {
  return parseDeck(readFileSync(path));
}

function skipUnless(path: string): { skip: string | false } {
  return { skip: existsSync(path) ? false : `not on this machine: ${path}` };
}

/** Every element on a slide, groups and SmartArt walked into. */
function flatten(slide: Slide): Array<Slide["elements"][number]> {
  const out: Array<Slide["elements"][number]> = [];
  const walk = (elements: readonly Slide["elements"][number][]): void => {
    for (const el of elements) {
      out.push(el);
      if (el.type === "group" || el.type === "diagram") walk(el.elements);
    }
  };
  walk(slide.elements);
  return out;
}

// ── The stylesheet's one hard rule, inherited from spec 03 ──────

test("the deck stylesheet contains no angle bracket, comments included", () => {
  // DOMPurify's mXSS guard deletes any element whose text matches /<[/\w!]/,
  // and a `style` element holding CSS is exactly that shape. The whole
  // stylesheet disappears, the deck renders unstyled, and nothing logs a word.
  const at = DECK_STYLESHEET.indexOf("<");
  assert.equal(
    at,
    -1,
    at === -1 ? "" : `"<" at ${at}: ${DECK_STYLESHEET.slice(Math.max(0, at - 70), at + 30)}`,
  );
});

// ── §2.2 — geometry, inheritance and text ───────────────────────

test(
  "the Agrofert deck parses with the geometry §2.2 measured",
  skipUnless(DECKS.agrofert),
  async () => {
    const deck = await open(DECKS.agrofert);

    assert.equal(deck.slides.length, 23);
    assert.deepEqual(deck.size, { width: 720, height: 405 });

    // §2.2 — slide 4's title, whose raw EMU offsets compute to 36 / 25.2 / 648 /
    // 50.4. Independently derived before the library was chosen; this is the
    // assertion that the library still agrees.
    const title = flatten(deck.slides[3]).find((el) => "name" in el && el.name === "Text 1") as
      | Shape
      | undefined;
    assert.ok(title, "slide 4 has a shape named Text 1");
    assert.equal(Math.round(title.left), 36);
    assert.equal(Math.round(title.top), 25);
    assert.equal(Math.round(title.width), 648);
    assert.equal(Math.round(title.height), 50);

    const texts = slideTexts(deck.slides);
    assert.equal(
      texts[3].shapes.find((shape) => shape.name === "Text 1")?.text,
      "Onion: the group data plane",
    );
  },
);

test(
  "§2.3 trap 2 — Czech text survives, so the encoding is real",
  skipUnless(DECKS.agrofert),
  async () => {
    const deck = await open(DECKS.agrofert);
    const all = slideTexts(deck.slides)
      .flatMap((slide) => slide.shapes.map((shape) => shape.text))
      .join(" ");
    // Mojibake would render these as `Onion Â· Machina` and `ÄŒeskÃ¡ poÅ¡ta`.
    assert.ok(all.includes("·"), "a middle dot survives");
    assert.ok(/[ěščřžýáíéúůĚŠČŘŽ]/.test(all), "Czech diacritics survive");
  },
);

test("the VOLAREZA deck parses at 16:9", skipUnless(DECKS.volareza), async () => {
  const deck = await open(DECKS.volareza);
  assert.equal(deck.slides.length, 27);
  assert.equal(Math.round(deck.size.width), 960);
  assert.equal(deck.size.height, 540);
});

test(
  "§2.2 — a zero-size element is a `line` and never carries text",
  skipUnless(DECKS.rules),
  async () => {
    const deck = await open(DECKS.rules);
    assert.equal(deck.slides.length, 12);

    let zeroSized = 0;
    for (const slide of deck.slides) {
      for (const el of flatten(slide)) {
        if (el.width !== 0 && el.height !== 0) continue;
        zeroSized++;
        assert.equal(el.type, "shape");
        assert.equal((el as Shape).shapType, "line", "a zero-size element is a rule");
        assert.equal(
          (el as Shape).content?.replace(/<[^>]*>/g, "").trim() ?? "",
          "",
          "a rule carries no text, so drawing it as a border loses nothing",
        );
      }
    }
    // §2.2 measured 408 of them in the worst deck. The count is asserted rather
    // than the presence, because "some" would pass on a deck that lost 400.
    assert.equal(zeroSized, 408);
  },
);

test(
  "§4.7 — the one deck that will not parse throws, and says why",
  skipUnless(DECKS.broken),
  async () => {
    await assert.rejects(
      () => open(DECKS.broken),
      /Relationships/,
      "the failure is a hard throw REX has to catch, not a degraded parse",
    );
  },
);

// ── §4.3 — the slide HTML contract ──────────────────────────────

test(
  "§4.3 — a slide emits the contract every other section depends on",
  skipUnless(DECKS.agrofert),
  async () => {
    const deck = await open(DECKS.agrofert);
    const html = slideHtml(deck.slides[3], 4, () => "rex-doc://doc/cache/media/x.png");

    // Rule 1 — the structural anchor target, the same role `page-N` plays for a PDF.
    assert.match(html, /<section class="rex-slide" id="slide-4" data-slide="4"/);
    // Rule 2 — one element per shape, numbered from 1 within the slide.
    assert.match(html, /id="slide-4-shape-1"/);
    assert.match(html, /id="slide-4-shape-2"/);
    // Rule 3 — the PowerPoint name, verbatim, because "Text 7" means nothing to a
    // reviewer and the id is an index that moves.
    assert.match(html, /data-name="Text 1"/);
    // Rule 4 — points, inside a slide box measured in points.
    assert.match(html, /left:36pt;top:25\.2pt;width:648pt;height:50\.4pt/);
    // §4.4 — nothing is inlined.
    assert.ok(!html.includes("data:image"), "no data: URI reaches the HTML");
    // §4.5 trap 1 — a non-breaking space does not wrap, so body text is clipped.
    assert.ok(!html.includes("&nbsp;"), "the library's non-breaking spaces are gone");
  },
);

test(
  "§4.3 rule 5 — a zero-size rule is drawn as a border with hit area",
  skipUnless(DECKS.rules),
  async () => {
    const deck = await open(DECKS.rules);
    const slides = deck.slides.map((slide, index) => slideHtml(slide, index + 1, () => null));
    const html = slides.join("");

    assert.match(html, /border-left:[^;]+;/, "a vertical rule is a left border");
    assert.ok(
      !/width:0pt;height:0pt/.test(html),
      "no shape is emitted at zero by zero — it would be invisible and unclickable",
    );
  },
);

test(
  "§4.6 — speaker notes are emitted, collapsed, and are not overlay chrome",
  skipUnless(DECKS.rules),
  async () => {
    const deck = await open(DECKS.rules);
    const html = deck.slides
      .map((slide, index) => slideHtml(slide, index + 1, () => null))
      .join("");

    assert.match(html, /<details class="rex-notes">/);
    assert.match(html, /<summary>Speaker notes<\/summary>/);
    // A note is authored text, so it belongs in the text index: a reviewer may
    // legitimately want to comment on one.
    assert.ok(
      !/rex-notes[^>]*data-rex-overlay/.test(html),
      "notes are not marked as REX's own chrome",
    );
  },
);

// ── §6.2 — the sidecar the agent reads instead of the zip ────────

test(
  "§6.2 — the sidecar names every slide and every shape",
  skipUnless(DECKS.agrofert),
  async () => {
    const deck = await open(DECKS.agrofert);
    const markdown = sidecarMarkdown("Onion-AI-Agrofert-EN.pptx", slideTexts(deck.slides));

    assert.match(markdown, /^# Onion-AI-Agrofert-EN\.pptx$/m);
    assert.match(markdown, /^## Slide 4$/m);
    // Names are included because an edit plan addresses shapes by name (§7.2.2
    // rule 2), so the agent must see the names REX will accept back.
    assert.match(markdown, /^\[Text 1\] Onion: the group data plane$/m);
    assert.equal(markdown.match(/^## Slide \d+$/gm)?.length, 23);
  },
);

test(
  "§7.5.3 — the deck's fonts come from its content, not from `usedFonts`",
  skipUnless(DECKS.agrofert),
  async () => {
    const deck = await open(DECKS.agrofert);

    // Measured on 2026-08-24: the library reports an empty list on all four
    // acceptance decks, so a rule that trusted it would refuse every real font.
    assert.deepEqual(deck.usedFonts, []);

    const fonts = usedFonts(deck.slides, deck.usedFonts);
    assert.ok(fonts.has("Cambria"), "the title's font is found in the content");
    assert.ok(fonts.has("Calibri"), "the body font is found in the content");
  },
);

// ── §4.3 rule 1 — presentation order, not file order ────────────

test(
  "§4.3 rule 1 — slides come back in PRESENTATION order",
  skipUnless(DECKS.agrofert),
  async () => {
    const source = readFileSync(DECKS.agrofert);
    const pkg = await openPackage(source);

    // `pptxtojson` collects slide parts from `[Content_Types].xml` and sorts them
    // by the number in the file name. It never reads `<p:sldIdLst>`. But the file
    // numbering never has to match the order — that is exactly what makes a
    // reorder cheap (§7.6.1) — so a deck a colleague reordered before sending it
    // would open in REX in the wrong order, silently, with every slide number
    // wrong. Measured on 2026-08-25.
    await reorderSlides(pkg, [1, 2, 3, 7, 4, 5, 6, ...Array.from({ length: 16 }, (_, n) => n + 8)]);
    const reordered = await pkg.toBuffer();

    const was = slideTexts((await parseDeck(source)).slides);
    const now = slideTexts((await parseDeck(reordered)).slides);

    const titleOf = (slide: (typeof was)[number]): string =>
      slide.shapes.find((shape) => shape.text.length > 0)?.text ?? "";

    assert.equal(titleOf(now[3]), titleOf(was[6]), "what was slide 7 is now slide 4");
    assert.equal(titleOf(now[4]), titleOf(was[3]), "and what was slide 4 is now slide 5");
    assert.equal(now.length, was.length, "no slide was lost or gained");
  },
);
