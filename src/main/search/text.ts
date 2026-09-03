// Spec 28 §5.4 — the text main searches, per format.
//
// The rule (§2 point 3): a search across the workspace searches the text each
// document OPENS AS — rendered, not raw — so that a hit found here is a hit the
// page can paint. Every format therefore goes through the same renderer opening
// it goes through, and the HTML that comes back is reduced to text by
// `textOfHtml`, which is spec 01 §6.3's DOM walk written over a string.
//
// `textOfHtml` is pure and is what `test/find.spec.ts` exercises. The per-format
// readers below reach the renderers, and two of those reach Electron
// (`render/pptx.ts` through `protocol.ts`), so they are imported lazily — a
// test of the stripper must not boot Electron.

import { readFileSync, statSync } from "node:fs";
import { decodeHTML } from "entities";
import {
  isDocxPath,
  isHtmlPath,
  isMarkdownPath,
  isPdfPath,
  isPptxPath,
} from "../render/formats.ts";
import { sha256 } from "../render/html.ts";

/**
 * Spec 01 §6.3 rule 2, as `anchor/textIndex.ts`'s `SKIP_TAGS` has it: elements
 * that never contribute visible prose, dropped with everything inside them.
 * Matched case-insensitively because an SVG `<style>` reports its tag in lower
 * case — the Mermaid lesson of 2026-08-21, when four thousand characters of
 * diagram CSS entered the index.
 */
const DROPPED_ELEMENTS = ["script", "style", "head", "title", "template", "noscript", "desc"];

const DROPPED = new RegExp(`<(${DROPPED_ELEMENTS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");

/**
 * §5.4 — the visible text of an HTML string, normalised as the page's index
 * normalises it.
 *
 * Tags are removed **with nothing in their place**: the DOM puts no character
 * at a tag boundary, so `<b>a</b>b` reads `ab` in both. Entities are decoded
 * before whitespace is collapsed, so `&nbsp;` becomes a space here exactly as
 * U+00A0 does under the index's `/\s/`. The leading space is dropped because
 * the index drops leading whitespace (§6.3 rule 4).
 *
 * On HTML REX wrote itself the result equals `TextIndex.text`. On an author's
 * own HTML it is close — a `>` inside an attribute value would end a tag early
 * — and §5.5 says where a hit lands when the two disagree.
 */
export function textOfHtml(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DROPPED, "")
    .replace(/<[^>]*>/g, "");
  return decodeHTML(stripped).replace(/\s+/g, " ").replace(/^ /, "");
}

interface CachedText {
  mtimeMs: number;
  size: number;
  text: string;
}

/**
 * §5.4 — by the path actually read, for the session, in memory.
 *
 * One `stat` per file per search decides whether the text is still good. Not
 * persisted: a persistent index would make the database about something other
 * than comments (spec 25 §6.1), and one reviewer's workspace does not need one.
 */
const cache = new Map<string, CachedText>();

/** Test seam. The app never empties it. */
export function forgetSearchTexts(): void {
  cache.clear();
}

/**
 * §5.4 — the text of one document, as opening it would show it.
 *
 * `path` decides the format (it is the document's real name); `contentPath` is
 * where the bytes are — the working copy when one exists, exactly as `doc:open`
 * reads it. Throws when the file cannot be read or rendered; the caller lists
 * the file under `not searched` with the message.
 */
export async function documentText(path: string, contentPath: string): Promise<string> {
  const stat = statSync(contentPath);
  const cached = cache.get(contentPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.text;
  }

  const text = await extractText(path, contentPath);
  cache.set(contentPath, { mtimeMs: stat.mtimeMs, size: stat.size, text });
  return text;
}

async function extractText(path: string, contentPath: string): Promise<string> {
  if (isMarkdownPath(path)) {
    // Rendered, not raw (§8): a hit in a link's URL or a fence marker is a hit
    // the page never shows, and its ordinal would disagree with the page's.
    const { renderMarkdown } = await import("../render/markdown.ts");
    return textOfHtml(renderMarkdown(readFileSync(contentPath, "utf8")));
  }
  if (isHtmlPath(path)) {
    return textOfHtml(readFileSync(contentPath, "utf8"));
  }
  if (isDocxPath(path)) {
    const { renderDocx } = await import("../render/docx.ts");
    return textOfHtml((await renderDocx(contentPath)).html);
  }
  if (isPptxPath(path)) {
    // As opening does. Its sidecar cache is keyed by the content hash, so the
    // second read of an unchanged deck is cheap.
    const { renderPptx } = await import("../render/pptx.ts");
    const rendered = await renderPptx(contentPath, sha256(readFileSync(contentPath)));
    if (rendered.error !== null) throw new Error(rendered.error);
    return textOfHtml(rendered.html);
  }
  if (isPdfPath(path)) {
    const { pdfText } = await import("./pdf.ts");
    return await pdfText(contentPath);
  }
  throw new Error("REX renders Markdown, HTML, PDF, DOCX and PPTX, and this is none of them.");
}
