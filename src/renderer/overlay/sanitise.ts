// SPEC.md §5.4 step 1 — sanitising a local HTML file before it is displayed.
//
// Its own module so that the tier 2 preload, which shares the resolver but
// never renders local HTML, does not drag DOMPurify into a sandboxed preload
// where node_modules cannot be required at all.
//
// This runs in the renderer rather than in main because DOMPurify needs a DOM;
// the iframe is additionally sandboxed without `allow-scripts`, so the two
// protections are independent.

import DOMPurify from "dompurify";

/** Kept so the document's own stylesheets and diagrams survive (§5.4 point 3). */
const SANITISE_OPTIONS = {
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ["style", "link", "base"],
  ADD_ATTR: ["rel", "href", "media", "type", "crossorigin", "data-src-line", "target"],
};

export function prepareDocumentHtml(html: string, baseHref: string | null): string {
  const clean = DOMPurify.sanitize(html, SANITISE_OPTIONS);
  if (!baseHref) return clean;
  // A srcdoc iframe resolves relative URLs against the *parent* page, so the
  // document's own images and stylesheets need this to find themselves.
  const base = `<base href="${baseHref}">`;
  return clean.includes("<head")
    ? clean.replace(/<head([^>]*)>/i, `<head$1>${base}`)
    : `${base}${clean}`;
}
