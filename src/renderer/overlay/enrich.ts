// Spec 03 §4 — the enrichment seam.
//
// The document iframe is `sandbox="allow-same-origin"` with no `allow-scripts`
// (spec 01 §5.4 step 2), and that does not change. But some of what REX has to
// draw *is* a drawing program: Mermaid needs a live DOM to measure text, and
// PDF.js needs a canvas 2D context. Neither can produce its output as a string.
//
// So the split is not "hard formats and easy formats". It is: can this thing
// produce its output as a string, or does it have to measure and paint? The
// first kind runs in main and arrives as static HTML (KaTeX, highlight.js,
// mammoth). The second kind runs here, in the renderer process, and reaches
// into the iframe from outside.
//
// Reaching in needs no new privilege. The iframe is same-origin, so the
// renderer can already create elements inside it and hold a canvas context —
// the same access the anchor resolver has used since milestone 0. No script
// runs inside the iframe. The renderer draws, from outside.

import type { OpenedDocument } from "../../shared/types.ts";
import { mermaidPass } from "./mermaid.ts";
import { pdfPass } from "./pdf.ts";

/** One drawing job against the document's live DOM. */
export type EnrichPass = (doc: Document, source: OpenedDocument) => Promise<void>;

/**
 * In order, and never in parallel. Two passes writing the same DOM is a race
 * that reproduces about once a week.
 */
const PASSES: ReadonlyArray<{ name: string; run: EnrichPass }> = [
  { name: "mermaid", run: mermaidPass },
  { name: "pdf", run: pdfPass },
];

/**
 * Runs every pass that applies to this document, in order.
 *
 * The caller must await this before `onSurfaceReady`, and the DOM must be final
 * when it returns — §4.3. Spec 01 §6.3 rebuilds the text index whenever the
 * document is re-rendered, so an anchor created against a half-drawn document
 * records offsets into text that is about to move. It resolves. It reports
 * `ok`. It points at the wrong place, which is the exact silent failure
 * `rules/06-testing.md` exists to catch.
 *
 * A pass that genuinely cannot finish up front — a 300-page PDF is the real
 * case — must still build its final DOM *structure* here and fill in only
 * pixels later. Pixels arriving late change nothing the resolver can see.
 */
export async function enrichDocument(doc: Document, source: OpenedDocument): Promise<void> {
  for (const pass of PASSES) {
    try {
      await pass.run(doc, source);
    } catch (error) {
      // The document still opens. A diagram that will not draw must never cost
      // the reviewer the document, and every pass leaves its own fallback in
      // place on failure.
      console.warn(`[rex] enrich: the ${pass.name} pass failed`, error);
    }
  }
}
