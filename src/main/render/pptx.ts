// Spec 11 §4 — a `.pptx`, read in main and handed over as HTML.
//
// Per invariant I2 and the DOCX precedent in `docx.ts`: the parse happens here,
// the renderer receives a string, and not one line of the renderer changes. A
// deck arrives as `presentation: { kind: "html" }`, so the anchor resolver, the
// highlight painter, the pen layer and the figure preview all work on it
// because they work on any HTML.
//
// `pptxtojson` reads and cannot write. Every byte REX ever puts back into a
// deck is written by code in this repository (§3).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import JSZip from "jszip";
import { allowDirectory, baseHrefFor } from "../protocol.ts";
import { escapeHtml, type MediaUrl, slideHtml } from "./pptxSlides.ts";
import { DECK_STYLESHEET } from "./pptxStylesheet.ts";
import {
  deckCacheDir,
  deckTitle,
  type ParsedDeck,
  parseDeck,
  sidecarMarkdown,
  sidecarPathFor,
  slideTexts,
} from "./pptxText.ts";

export interface RenderedPptx {
  html: string;
  title: string | null;
  /**
   * §4.7 — the message when the deck would not parse, and null when it did.
   *
   * One deck in thirty throws (§2.2). Apply is off for it, because REX must
   * never offer to edit a file it could not read.
   */
  error: string | null;
  /** Media, and the agent's text sidecar. */
  cacheDir: string;
  /** §6.2 — absolute path to the Markdown the agent reads instead of the zip. */
  sidecarPath: string | null;
  /** Slide size in points, for anyone who needs the aspect ratio. */
  size: { width: number; height: number } | null;
  slideCount: number;
}

/**
 * The library's own naming for a media part is the zip entry's path, so the
 * only mapping needed is "is it cached, and under what name".
 */
function mediaUrlFor(cacheDir: string, cached: ReadonlySet<string>): MediaUrl {
  const mediaHref = baseHrefFor(join(cacheDir, "media"));
  return (ref: string): string | null => {
    const name = basename(ref);
    return cached.has(name) ? `${mediaHref}${encodeURIComponent(name)}` : null;
  };
}

/**
 * §4.4 — media is extracted to disk and served over `rex-doc://`, never inlined
 * as a `data:` URI. A 4.6 MB deck would otherwise cross IPC as a far larger
 * string, and the same picture used on nine slides would cross it nine times.
 *
 * Keyed by content hash, so an unchanged deck is not re-extracted and a changed
 * one cannot serve a stale picture.
 */
async function extractMedia(bytes: Buffer, cacheDir: string): Promise<Set<string>> {
  const mediaDir = join(cacheDir, "media");
  const marker = join(cacheDir, "media.json");

  if (existsSync(marker)) {
    try {
      return new Set(JSON.parse(await readFile(marker, "utf8")) as string[]);
    } catch {
      // A truncated marker from an interrupted extract. Redo it.
    }
  }

  mkdirSync(mediaDir, { recursive: true });
  const zip = await JSZip.loadAsync(bytes);
  const names: string[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith("ppt/media/")) continue;
    const name = basename(path);
    if (name.length === 0) continue;
    writeFileSync(join(mediaDir, name), await entry.async("nodebuffer"));
    names.push(name);
  }

  writeFileSync(marker, JSON.stringify(names));
  return new Set(names);
}

// ── The page ────────────────────────────────────────────────

/**
 * §4.3 rule 7 — the page declares its encoding.
 *
 * A one-line rule with a disproportionate failure mode: without it the
 * library's correct UTF-8 renders as `Onion Â· Machina` and `ÄŒeskÃ¡ poÅ¡ta`,
 * and Czech text makes it visible on the first slide.
 */
function deckPage(title: string, body: string, extraCss = ""): string {
  return `<!doctype html>
<html lang="en" data-rex-paper>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${DECK_STYLESHEET}${extraCss}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * §7.7 — a slide drawn for the preview is the slide and nothing around it.
 *
 * The pane's own chrome — the ground, the slide number, the notes drawer, the
 * drop shadow — is orientation when you are scrolling a deck and noise when you
 * are comparing two pictures of one slide side by side.
 *
 * Written as an override rather than as a second emitter, because the preview
 * has to be the picture the reviewer will actually get: a separate renderer
 * would be a second thing to keep in step, and the one it would drift from is
 * the one that decides whether an edit is accepted.
 */
const BARE_SLIDE_CSS = `
  html, body { padding: 0; overflow: hidden; background: transparent; }
  .rex-deck { margin: 0; }
  .rex-slide-wrap { margin: 0; }
  .rex-slide-tag, .rex-notes { display: none; }
  .rex-slide { box-shadow: none; }
`;

/** §4.7 — shown in place of the document, never a blank pane. */
function unreadablePage(name: string, message: string): string {
  const body =
    `<div class="rex-unreadable" data-rex-overlay>` +
    `<h1>REX could not read this presentation.</h1>` +
    `<code>${escapeHtml(message)}</code>` +
    `<p>The file may use a PowerPoint feature REX's reader does not handle. ` +
    `The file itself has not been touched.</p>` +
    `</div>`;
  return deckPage(name, body);
}

/**
 * §6.2 — the sidecar for a deck, written if it is not already there.
 *
 * The agent is given this instead of the `.pptx`, because a `.pptx` is a zip:
 * `Read` fails on it, and the agent then answers from the reviewer's comment
 * alone **while appearing to have read the document**. Nothing reports that,
 * which is what makes it worth a file of its own.
 *
 * Regenerated rather than trusted, because the deck can change on disk between
 * being opened and being asked about, and a sidecar describing the version
 * before an edit is a confident wrong answer. Returns null for a deck that will
 * not parse — the caller then has nothing to offer the agent and says so.
 */
export async function ensureSidecar(path: string): Promise<string | null> {
  const name = basename(path);
  const bytes = await readFile(path);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const sidecarPath = sidecarPathFor(name, contentHash);
  if (existsSync(sidecarPath)) return sidecarPath;

  try {
    const deck = await parseDeck(bytes);
    mkdirSync(deckCacheDir(contentHash), { recursive: true });
    writeFileSync(sidecarPath, sidecarMarkdown(name, slideTexts(deck.slides)));
    return sidecarPath;
  } catch {
    return null;
  }
}

/**
 * §7.7 — one slide, drawn on its own, for the before-and-after preview.
 *
 * The same emitter as the document view, because the preview has to be the
 * picture the reviewer will actually get. A separate "preview renderer" would
 * be a second thing to keep in step, and the one it would drift from is the one
 * that decides whether an edit is accepted.
 *
 * Returns null when the deck will not parse or has no such slide.
 */
export async function renderSlidePage(
  bytes: Buffer,
  contentHash: string,
  slideNumber: number,
): Promise<{ html: string; widthPt: number; heightPt: number } | null> {
  let deck: ParsedDeck;
  try {
    deck = await parseDeck(bytes);
  } catch {
    return null;
  }
  const slide = deck.slides[slideNumber - 1];
  if (!slide) return null;

  const cacheDir = deckCacheDir(contentHash);
  mkdirSync(cacheDir, { recursive: true });
  const cached = await extractMedia(bytes, cacheDir);
  allowDirectory(cacheDir);

  const article =
    `<article class="rex-deck" style="--slide-w:${deck.size.width}pt;` +
    `--slide-h:${deck.size.height}pt">\n` +
    `${slideHtml(slide, slideNumber, mediaUrlFor(cacheDir, cached))}\n</article>`;
  return {
    html: deckPage(`Slide ${slideNumber}`, article, BARE_SLIDE_CSS),
    widthPt: deck.size.width,
    heightPt: deck.size.height,
  };
}

export async function renderPptx(path: string, contentHash: string): Promise<RenderedPptx> {
  const name = basename(path);
  const cacheDir = deckCacheDir(contentHash);
  const bytes = await readFile(path);

  let deck: ParsedDeck;
  try {
    deck = await parseDeck(bytes);
  } catch (error) {
    return {
      html: unreadablePage(name, error instanceof Error ? error.message : String(error)),
      title: name,
      error: error instanceof Error ? error.message : String(error),
      cacheDir,
      sidecarPath: null,
      size: null,
      slideCount: 0,
    };
  }

  mkdirSync(cacheDir, { recursive: true });
  const cached = await extractMedia(bytes, cacheDir);
  allowDirectory(cacheDir);

  const media = mediaUrlFor(cacheDir, cached);
  const slides = deck.slides.map((slide, index) => slideHtml(slide, index + 1, media)).join("\n");
  const article =
    `<article class="rex-deck" style="--slide-w:${deck.size.width}pt;` +
    `--slide-h:${deck.size.height}pt">\n${slides}\n</article>`;

  const texts = slideTexts(deck.slides);
  const sidecarPath = sidecarPathFor(name, contentHash);
  writeFileSync(sidecarPath, sidecarMarkdown(name, texts));

  const title = deckTitle(texts, name);
  return {
    html: deckPage(title, article),
    title,
    error: null,
    cacheDir,
    sidecarPath,
    size: deck.size,
    slideCount: deck.slides.length,
  };
}
