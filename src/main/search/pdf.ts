// Spec 28 §5.4, milestone 3 — a PDF's text, read in main.
//
// Main does not read a PDF's bytes to DRAW one (spec 03 §7.1): the renderer's
// pdf.js does, because that is where the canvas is. Text needs no canvas, and
// pdf.js ships a legacy build that runs under Node and answers
// `getTextContent` without one. Imported lazily, as the renderer imports the
// same library, so a workspace with no PDF never pays for it.
//
// The join is by spaces and line ends, which is close to — not the same as —
// how the renderer's text layer lays the same items out. Where the two differ,
// §5.5's jump lands on a match and the ruler shows the rest.

import { readFileSync } from "node:fs";

/** Spec 03 §7.4 — the renderer refuses past this, so the search does too. */
const MAX_PAGES = 500;

export async function pdfText(path: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(path)),
    // No glyph is drawn, so no font is loaded.
    disableFontFace: true,
    useSystemFonts: false,
    // Errors only. Under Node the library otherwise announces its fake worker
    // on every document, which is a fact about the environment and not news.
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });

  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) {
      throw new Error(`This PDF has ${document.numPages} pages; REX reads at most ${MAX_PAGES}.`);
    }
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        if ("str" in item) parts.push(item.str, item.hasEOL ? "\n" : " ");
      }
      pages.push(parts.join(""));
    }
    return pages.join("\n").replace(/\s+/g, " ").trim();
  } finally {
    await task.destroy();
  }
}
