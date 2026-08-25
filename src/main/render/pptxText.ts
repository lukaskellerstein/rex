// Spec 11 §6.2 — every string in a deck, as plain text and as the Markdown
// sidecar the agent reads.
//
// Separate from `pptx.ts` because that module reaches Electron — it registers
// the media cache as a `rex-doc://` root — and this one is pure. Milestone 11.0
// is a `node --test` spec that runs without Electron, and it can only stay that
// way if the text half is importable on its own.

import { homedir } from "node:os";
import { join } from "node:path";
import { decodeHTML } from "entities";
import type { Element as DeckElement, Slide } from "pptxtojson/dist/index.js";
import { parse } from "pptxtojson/dist/index.js";
import { readDeckMap } from "../pptx/deck.ts";
import { openPackage } from "../pptx/package.ts";

export type ParsedDeck = Awaited<ReturnType<typeof parse>>;

/**
 * The deck, parsed once and the same way everywhere.
 *
 * `imageMode: "none"` keeps each picture's part reference and drops the base64
 * the library would otherwise build for it — §4.4 wants the reference, and
 * building the other costs seconds and megabytes for something that is thrown
 * away. The three modes are here rather than at each call site so that the read
 * path, the round-trip check in §7.8 and the tests cannot drift apart.
 */
export async function parseDeck(bytes: Buffer): Promise<ParsedDeck> {
  // A copy, because `Buffer.buffer` may be a slice of a larger pool and the
  // library reads the whole ArrayBuffer it is handed.
  const copy = Uint8Array.from(bytes);
  const deck = await parse(copy.buffer, {
    imageMode: "none",
    videoMode: "none",
    audioMode: "none",
  });
  return { ...deck, slides: await inPresentationOrder(bytes, deck.slides) };
}

/**
 * §4.3 rule 1 — slides in **presentation order**, which the library does not do.
 *
 * `pptxtojson` collects the slide parts from `[Content_Types].xml` and sorts
 * them by the number in the file name:
 *
 *     n.sort((a, b) => +/(\d+)\.xml/.exec(a)[1] - +/(\d+)\.xml/.exec(b)[1])
 *
 * It never reads `<p:sldIdLst>`. But the file numbering **never has to match
 * the presentation order** — that is exactly what makes §7.6.1's reorder cheap,
 * and PowerPoint leaves `slide7.xml` sitting fourth whenever anyone drags a
 * slide. Measured on 2026-08-25: reordering a deck changed nothing the reader
 * showed.
 *
 * That is a defect in the **read** path and not only in reordering. A deck a
 * colleague reordered before sending it would open in REX in the wrong order,
 * with every slide number wrong, silently. So the parsed slides are permuted
 * here, once, where every caller gets it.
 */
async function inPresentationOrder(bytes: Buffer, slides: Slide[]): Promise<Slide[]> {
  let order: string[];
  let byFileNumber: string[];
  try {
    const pkg = await openPackage(bytes);
    order = (await readDeckMap(pkg)).slides;
    byFileNumber = pkg
      .paths()
      .filter((part) => /^ppt\/slides\/slide\d+\.xml$/.test(part))
      .sort((a, b) => slideNumberOf(a) - slideNumberOf(b));
  } catch {
    // A deck whose presentation part cannot be read is one the caller is about
    // to report anyway (§4.7). Leaving the order alone is the honest fallback.
    return slides;
  }

  if (byFileNumber.length !== slides.length) return slides;
  const permuted = order
    .map((part) => slides[byFileNumber.indexOf(part)])
    .filter((slide): slide is Slide => slide !== undefined);
  return permuted.length === slides.length ? permuted : slides;
}

function slideNumberOf(part: string): number {
  return Number(/(\d+)\.xml$/.exec(part)?.[1] ?? 0);
}

/** Everything REX caches for one deck, keyed by the deck's content hash (§4.4). */
export function deckCacheDir(contentHash: string): string {
  const root = process.env.REX_CACHE_PATH ?? join(homedir(), ".rex", "cache");
  return join(root, "pptx", contentHash);
}

/** §6.2 — the sidecar for a deck, wherever it was last written. */
export function sidecarPathFor(deckName: string, contentHash: string): string {
  return join(deckCacheDir(contentHash), `${deckName}.md`);
}

export interface DeckShapeText {
  name: string;
  text: string;
}

export interface DeckSlideText {
  number: number;
  shapes: DeckShapeText[];
  note: string;
}

/** A shape's `content` is HTML the library built. This is what it says. */
export function plainText(html: string | undefined): string {
  if (!html) return "";
  return decodeHTML(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function collect(elements: readonly DeckElement[], into: DeckShapeText[]): void {
  for (const el of elements) {
    if (el.type === "group" || el.type === "diagram") {
      collect(el.elements, into);
      continue;
    }
    const name = "name" in el && el.name ? el.name : el.type;
    if (el.type === "table") {
      const cells = el.data
        .flatMap((row) => row.map((cell) => plainText(cell.text)))
        .filter((cell) => cell.length > 0);
      into.push({ name, text: cells.join(" | ") });
      continue;
    }
    into.push({ name, text: "content" in el ? plainText(el.content) : "" });
  }
}

export function slideTexts(slides: readonly Slide[]): DeckSlideText[] {
  return slides.map((slide, index) => {
    const shapes: DeckShapeText[] = [];
    collect(slide.elements, shapes);
    return { number: index + 1, shapes, note: plainText(slide.note) };
  });
}

/**
 * §6.2 — the Markdown the agent reads instead of the `.pptx`.
 *
 * A zip defeats `Read`, so without this the agent answers from the reviewer's
 * comment alone while appearing to have read the document — the invisible
 * failure §6.1 names. Shape names are included because an edit plan addresses
 * shapes by name (§7.2.2 rule 2), so the agent must see the names REX will
 * accept back.
 *
 * A read artifact and never an edit target: it is regenerated from the deck, it
 * lives outside every repository, and nothing REX does writes from it back into
 * the file.
 */
export function sidecarMarkdown(deckName: string, slides: readonly DeckSlideText[]): string {
  const lines = [`# ${deckName}`, ""];
  for (const slide of slides) {
    lines.push(`## Slide ${slide.number}`);
    for (const shape of slide.shapes) {
      lines.push(shape.text ? `[${shape.name}] ${shape.text}` : `[${shape.name}]`);
    }
    if (slide.note) lines.push("", "### Notes", slide.note);
    lines.push("");
  }
  return lines.join("\n");
}

/** The deck's own title: the first text on slide 1, else the file name. */
export function deckTitle(slides: readonly DeckSlideText[], fallback: string): string {
  const first = slides[0]?.shapes.find((shape) => shape.text.length > 0);
  return first ? first.text.slice(0, 120) : fallback;
}

/**
 * Every font the deck actually uses.
 *
 * `pptxtojson` exposes `usedFonts`, and on all four acceptance decks it is
 * **empty** — measured on 2026-08-24. The fonts are really there, in each
 * shape's `content` as `font-family: Cambria`, so §7.5.3's "a font must already
 * be in the deck" is answered from the content and the library's list together
 * rather than from a field that reports nothing.
 */
export function usedFonts(slides: readonly Slide[], reported: readonly string[]): Set<string> {
  const fonts = new Set(reported);
  const walk = (elements: readonly DeckElement[]): void => {
    for (const el of elements) {
      if (el.type === "group" || el.type === "diagram") {
        walk(el.elements);
        continue;
      }
      const content = "content" in el ? (el.content ?? "") : "";
      for (const match of content.matchAll(/font-family:\s*([^;"']+)/g)) {
        fonts.add(match[1].trim());
      }
    }
  };
  for (const slide of slides) walk(slide.elements);
  return fonts;
}
