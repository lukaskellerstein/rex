// What both document frames have in common.
//
// Spec 15 §6.1 put a second document on screen — the original, beside the
// working copy — and the two have to be drawn by the same code or the diff is
// between REX's two renderers rather than between the reviewer's two versions.
// So the srcdoc, the base href and the zoom live here, and `DocumentView` and
// `OriginalPane` both call them.

import type { OpenedDocument } from "../../shared/types.ts";
import { prepareDocumentHtml } from "./sanitise.ts";

export function baseHref(directory: string): string {
  const encoded = directory
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `rex-doc://doc${encoded}/`;
}

/**
 * The empty page a PDF is drawn into (spec 03 §7.2).
 *
 * REX's own markup, not the author's, so it does not go through DOMPurify. Its
 * stylesheet arrives with the pass that creates the elements it styles.
 */
export const PDF_SHELL =
  '<!doctype html><html lang="en" data-rex-paper><head><meta charset="utf-8"></head><body></body></html>';

/** Spec 03 §9 — `presentation` is a union, so this stays exhaustive. */
export function srcdocFor(doc: OpenedDocument): string {
  return doc.presentation.kind === "html"
    ? prepareDocumentHtml(doc.presentation.html, doc.baseDir ? baseHref(doc.baseDir) : null)
    : // A PDF starts as an empty page; the §7 pass builds every page into it
      // before the surface is handed up.
      PDF_SHELL;
}

/**
 * CSS `zoom`, not `transform: scale`.
 *
 * `zoom` takes part in layout, so `getBoundingClientRect()` and `scrollY`
 * inside the frame both report the scaled geometry and keep agreeing with each
 * other — which is the only reason the overlay's boxes still land on the right
 * things. `transform` would leave layout at 1× and every rect the resolver
 * reads would be a lie. It also reflows a Markdown document to the new size
 * instead of letting a scaled page run off the side.
 */
export function applyZoom(inner: Document | null, zoom: number): void {
  if (!inner) return;
  inner.documentElement.style.zoom = String(zoom);
}
