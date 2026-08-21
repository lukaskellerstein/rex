// Spec 03 §7 — PDF, drawn by the renderer into the document iframe.
//
// PDF.js draws to a <canvas>, and the document iframe runs no script. So the
// renderer draws — but not into a canvas inside the iframe.
//
// Chromium never paints a <canvas> that lives in a frame sandboxed without
// `allow-scripts`, which is exactly what spec 01 §5.4 step 2 requires the
// document iframe to be. The bitmap is really there — `getImageData` reads back
// every glyph — and the element reports `display: block`, a correct box and
// full opacity. It is simply never composited, so the page shows as blank
// paper. Measured on 2026-08-21 with three iframes side by side, each handed an
// identical orange square: no `sandbox` attribute painted it, `allow-same-origin
// allow-scripts` painted it, and `allow-same-origin` alone did not.
//
// So the canvas is created in the *renderer's own* document, where it composites
// like any other, and only the finished picture crosses into the iframe — as an
// <img>, which a sandboxed frame draws perfectly well.
//
// That <img> sits beside `.rex-pdf-page`, never inside it. A region anchor
// stores a fingerprint of the element it was cut from and that fingerprint is
// taken from `outerHTML` (`create.ts`), so a page whose markup gained a bitmap
// when it happened to be painted would orphan every region on it. `#page-N`
// therefore holds the text layer and nothing else, and its markup is the same
// before and after painting.
//
// Main does not read the bytes. It returns a `rex-doc://` URL and PDF.js
// range-fetches it, which is why the renderer's CSP gains `connect-src
// rex-doc:` and why `.pdf` joins the MIME table in `main/protocol.ts`.

import type { PDFPageProxy as PDFPage } from "pdfjs-dist";
// `?url` yields only a string, so this import costs nothing at load time. The
// library itself is imported dynamically below, so a Markdown document never
// pays for it — the same reason §5.8 defers Mermaid.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { OpenedDocument } from "../../shared/types.ts";
import { PDF_STYLESHEET } from "./pdfStylesheet.ts";

/**
 * §7.4 — refuse rather than hang. Spec 02 §4.2 set the precedent: report the
 * limit, never show a partial thing silently.
 */
const MAX_PAGES = 500;

/** How far either side of the viewport a page is painted ahead of the scroll. */
const PAINT_MARGIN_PX = 800;

/**
 * Bitmaps are drawn at the screen's own pixel density, up to this much.
 *
 * A page is laid out at scale 1 so that the text layer keeps lining up with the
 * glyphs, but the picture behind it can carry more pixels than that. The cap
 * bounds the cost: a 2× A4 page is about 8 MB while it is being drawn.
 */
const MAX_BITMAP_SCALE = 2;

/**
 * One page, painted in the renderer's own document and handed over as a picture.
 *
 * PNG rather than JPEG: this is text, and JPEG rings around every letter.
 */
async function paintToDataUrl(page: PDFPage, scale: number): Promise<string> {
  const viewport = page.getViewport({ scale });
  // `document` here is the renderer's, not the iframe's — see the file header.
  // It is never appended anywhere; a detached canvas still rasterises.
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // `canvas`, not `canvasContext`: the latter is legacy in PDF.js 6 and is
  // honoured only when `canvas` is explicitly null.
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/png");
}

export async function pdfPass(doc: Document, source: OpenedDocument): Promise<void> {
  if (source.presentation.kind !== "pdf") return;

  const style = doc.createElement("style");
  style.textContent = PDF_STYLESHEET;
  doc.head.append(style);

  const { getDocument, GlobalWorkerOptions, TextLayer } = await import("pdfjs-dist");
  // A bundled, same-origin asset — not a blob worker, which would need `blob:`
  // in the CSP. It must be set before the first `getDocument`.
  GlobalWorkerOptions.workerSrc = workerUrl;

  // Every asset URL is required, not optional — see `DocumentPresentation`.
  const assets = source.presentation.assetsUrl;
  const pdf = await getDocument({
    url: source.presentation.url,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    iccUrl: `${assets}iccs/`,
    wasmUrl: `${assets}wasm/`,
  }).promise;

  if (pdf.numPages > MAX_PAGES) {
    showMessage(doc, `This PDF has ${pdf.numPages} pages. REX draws at most ${MAX_PAGES}.`);
    return;
  }

  // Structure first, pixels later. Every page's box and text layer is built
  // before this function returns; only the pictures are painted lazily.
  // This is not an optimisation, it is §4.3: a page whose *structure* appeared
  // during scrolling would change the text index under anchors that had already
  // resolved. Pixels arriving later change nothing the resolver can see.
  const painters = new Map<Element, () => Promise<void>>();
  const scale = Math.min(window.devicePixelRatio || 1, MAX_BITMAP_SCALE);

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });

    // The sheet holds the picture; the page holds the text. Both created IN the
    // iframe's document, and the page covers the sheet exactly, so a region
    // stored as fractions of `#page-N` still lands where it was drawn.
    const sheet = doc.createElement("div");
    sheet.className = "rex-pdf-sheet";
    sheet.style.width = `${viewport.width}px`;
    sheet.style.height = `${viewport.height}px`;

    const bitmap = doc.createElement("img");
    bitmap.className = "rex-pdf-bitmap";
    bitmap.alt = "";
    // §6.3 rule 2 — REX's own elements stay out of the text index.
    bitmap.setAttribute("data-rex-overlay", "");

    const box = doc.createElement("div");
    box.className = "rex-pdf-page";
    // §4.2 rule 6 — a page has nothing for a quote to match, so it is reached
    // by layer 3, which needs a stable id.
    box.id = `page-${n}`;
    box.dataset.page = String(n);
    // PDF.js 6 positions every text span with `calc(var(--total-scale-factor)
    // * …px)`. Without the property every span collapses to zero size: the text
    // is *there*, so `getTextContent` looks fine and the DOM looks fine, but
    // nothing can be selected. `--scale-factor` is set too — one legacy rule in
    // pdf_viewer.css still reads it. (§13 in the spec named only the old one;
    // 6.2.108 renamed it.)
    box.style.setProperty("--total-scale-factor", "1");
    box.style.setProperty("--scale-factor", "1");

    const text = doc.createElement("div");
    text.className = "textLayer rex-pdf-text";

    box.append(text);
    sheet.append(bitmap, box);
    doc.body.append(sheet);

    await new TextLayer({
      textContentSource: await page.getTextContent(),
      container: text,
      viewport,
    }).render();

    painters.set(sheet, async () => {
      bitmap.src = await paintToDataUrl(page, scale);
    });
  }

  if (!doc.body.querySelector(".rex-pdf-text .endOfContent, .rex-pdf-text span")) {
    // §7.4 — a scanned PDF has no text layer. Say so rather than letting the
    // reviewer wonder why nothing can be selected.
    showMessage(doc, "This PDF holds no text layer. Comment on a region of a page instead.", true);
  }

  paintWhenVisible(doc, painters);
}

/**
 * Bitmaps arrive under an IntersectionObserver, and each page is painted once.
 *
 * The observer is built in the iframe's own realm, so `root: null` means that
 * document's viewport.
 *
 * A note for whoever debugs this next, because it cost an hour: none of this
 * runs while REX's window is hidden or off-screen. Chromium suspends the
 * "update the rendering" steps for a hidden document, and observer delivery,
 * `scroll` dispatch and `requestAnimationFrame` all hang off those steps —
 * PDF.js's own render loop included. The symptom is pages that stay blank with
 * no error anywhere, and it looks exactly like a broken observer. Check
 * `document.visibilityState` before believing anything else.
 */
function paintWhenVisible(doc: Document, painters: Map<Element, () => Promise<void>>): void {
  const view = doc.defaultView;
  if (!view) return;

  const observer = new view.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const paint = painters.get(entry.target);
        if (!paint) continue;
        // Removed before awaiting, so a slow page is never queued twice.
        painters.delete(entry.target);
        observer.unobserve(entry.target);
        void paint().catch((error) => {
          console.warn(`[rex] pdf: ${entry.target.id} did not paint`, error);
        });
      }
    },
    { root: null, rootMargin: `${PAINT_MARGIN_PX}px 0px` },
  );

  for (const box of painters.keys()) observer.observe(box);
}

/** A line of REX's own text, kept out of the anchor index by the overlay attr. */
function showMessage(doc: Document, message: string, append = false): void {
  const note = doc.createElement("p");
  note.className = "rex-pdf-note";
  // §6.3 rule 2 — REX's own words never enter the text index, or every offset
  // below them shifts by text the author never wrote.
  note.setAttribute("data-rex-overlay", "");
  note.textContent = message;
  if (append) doc.body.append(note);
  else doc.body.prepend(note);
}
