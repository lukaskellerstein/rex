// The stylesheet for a PDF drawn into the document iframe (spec 03 §7.2).
//
// Separate from `main/render/stylesheet.ts` because a PDF has no page rendered
// in main at all: the renderer builds the whole document, so the CSS travels
// with the code that creates the elements it styles.
//
// The `.textLayer` rules are copied from `pdfjs-dist/web/pdf_viewer.css` rather
// than linked, because that file also restyles the page around the text layer —
// a whole viewer chrome REX does not use and must not inherit.
//
// Two hard rules for the string below, comments included:
//
//   No backtick. It is a template literal, so one ends the string early and the
//   build fails with a parse error pointing at CSS.
//
//   No angle bracket. This string does not pass through DOMPurify today, but
//   `main/render/stylesheet.ts` does, and there a tag name written in angle
//   brackets inside a comment deletes the entire stylesheet in silence. Keeping
//   the habit in both places is what stops that trap being rediscovered.

import { PAPER } from "../../shared/tokens.ts";

export const PDF_STYLESHEET = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 24px 0 96px;
    background: ${PAPER.wash};
    color: ${PAPER.inkBody};
    font: 15px/1.68 "IBM Plex Sans", system-ui, -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    /* "safe" so a page wider than the pane is not centred out of reach. */
    align-items: safe center;
    gap: 20px;
  }

  /* One sheet of paper. Its size comes from the PDF's own viewport, so a region
     stored as fractions lands on the same spot however the pane is sized.

     Pages are drawn at 1:1 and the pane scrolls sideways when it is narrower,
     rather than being fitted to the width. Fitting would scale the picture with
     CSS while the text layer stayed at its rendered scale, and PDF.js positions
     every span with calc(var(--total-scale-factor) * …px) — so the invisible,
     selectable text would drift off the glyphs under it, and every region
     anchor would be cut from a box whose contents had moved. Measured on
     2026-08-21 at a 312px pane: the drawing shrank to 441px tall inside a box
     still 842px tall. A PDF page is paginated by its author; scrolling one is
     what every reader does. */
  .rex-pdf-sheet {
    position: relative;
    flex: none;
    background: ${PAPER.bg};
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
  }

  /* The picture, drawn in the renderer and handed over (see pdf.ts). It is
     REX's own element and sits beside the page rather than inside it, so the
     markup a region anchor fingerprints never changes when a page paints. */
  .rex-pdf-bitmap {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  /* The page proper: the id an element anchor binds to, and the text layer.
     It covers the sheet exactly, so its box is the page's box. */
  .rex-pdf-page {
    position: absolute;
    inset: 0;
  }

  .rex-pdf-note {
    margin: 0 24px;
    padding: 10px 14px;
    border-radius: 4px;
    background: ${PAPER.bg};
    color: ${PAPER.inkMuted};
    font-size: 13.5px;
  }

  /* Copied from pdfjs-dist/web/pdf_viewer.css — the rules that position the
     invisible, selectable text over the bitmap. Every span is placed with
     calc(var(--total-scale-factor) * …px), which is why pdf.ts sets that
     property on each page box. */
  .textLayer {
    color-scheme: only light;
    position: absolute;
    text-align: initial;
    inset: 0;
    overflow: clip;
    opacity: 1;
    line-height: 1;
    letter-spacing: normal;
    word-spacing: normal;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: CanvasText;
    z-index: 0;
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }
  .textLayer span,
  .textLayer br {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    user-select: text;
  }
  .textLayer > :not(.markedContent),
  .textLayer .markedContent span:not(.markedContent) {
    z-index: 1;
    --font-height: 0;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }
  .textLayer .markedContent { display: contents; }
  .textLayer span[role="img"] { user-select: none; cursor: default; }
  .textLayer .endOfContent {
    display: block;
    position: absolute;
    inset: 100% 0 0;
    z-index: 0;
    cursor: default;
    user-select: none;
  }
  .textLayer ::selection { background: #b6d0f2; color: transparent; }
`;
