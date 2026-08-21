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

/**
 * DOMPurify's default URI allow-list covers http(s), mailto and a handful of
 * others, and strips every scheme it does not know — `rex-doc:` included. That
 * is why `<base>` is injected *after* sanitising, below.
 *
 * REX's own head links are absolute `rex-doc://` URLs (KaTeX's stylesheet,
 * spec 03 §5.6), so the scheme has to survive. Allowing it grants a document
 * nothing it did not already have: the protocol handler serves only directories
 * a document has actually been opened from (`protocol.ts`), and a relative URL
 * through `<base>` already reaches exactly the same set of files.
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|rex-doc):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/**
 * Kept so the document's own stylesheets and diagrams survive (§5.4 point 3).
 *
 * `input`, `type`, `checked` and `disabled` are for the task-list checkboxes
 * REX emits (spec 03 §5.3) — a checkbox holds no text, which is the whole
 * reason it is a checkbox and not the literal `[x]`.
 */
const SANITISE_OPTIONS = {
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ["style", "link", "base", "input"],
  ADD_ATTR: [
    "rel",
    "href",
    "media",
    "type",
    "crossorigin",
    "data-src-line",
    "target",
    "checked",
    "disabled",
  ],
  ALLOWED_URI_REGEXP,
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
