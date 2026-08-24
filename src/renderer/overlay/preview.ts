// Spec 10 §2 — click a figure, read it at a useful size.
//
// A diagram drawn to fit a 620px measure (`MEASURE.width`) is a diagram whose
// labels cannot be read, and that is most of what a Mermaid flowchart or an
// architecture SVG is *for*. The document's own zoom (spec 04) scales the whole
// page, so reading one diagram means losing the prose around it and then
// finding your place again.
//
// This runs in the renderer and reaches into the document iframe from outside,
// the same access the anchor resolver has always had. The iframe still runs no
// script.
//
// ─ THE ONE RULE THIS FILE OBEYS ────────────────────────────────
//
// **Nothing in the document is mutated.** Not an attribute, not an inline
// style, not a wrapper. `create.ts` fingerprints an element from its
// `outerHTML` for a region anchor, so an added `data-rex-zoomable` would orphan
// every region cut from that image — silently, the next time the document was
// opened. `pdf.ts` puts its bitmap *beside* `.rex-pdf-page` for exactly this
// reason, and §6.7 refuses the same trick for highlights.
//
// So the affordance is a stylesheet, which adds no node to the tree and changes
// no element's markup: one `<style data-rex-overlay>` carrying cursor rules and
// nothing else. It sets no colour, no size and no spacing, so a local HTML file
// still looks exactly as its author wrote it (spec 01 §5.4 point 3).

import DOMPurify from "dompurify";

/**
 * What the lightbox was handed, already lifted out of the document.
 *
 * The SVG arrives as a fragment rather than as markup, and that is a
 * correctness requirement rather than a convenience — see `SVG_SANITISE_OPTIONS`
 * below. A fragment is emptied by the first `append`, so the lightbox clones it
 * on every mount and this value stays reusable.
 */
export type PreviewFigure =
  | { kind: "image"; src: string; caption: string | null; backdrop: string | null }
  | { kind: "svg"; svg: DocumentFragment; caption: string | null; backdrop: string | null };

/**
 * The CSS properties that decide what a diagram looks like.
 *
 * A drawing lifted out of its document loses its document's stylesheet, and for
 * SVG that is not a cosmetic loss — `fill` falls back to black, so a figure of
 * outlined boxes becomes a figure of solid black rectangles. Measured on
 * 2026-08-24 against ProtoBot's architecture page, whose diagrams are drawn with
 * classes (`.d-box-in { fill: var(--paper); stroke: var(--rule) }`) rather than
 * with presentation attributes.
 *
 * So the *computed* value of each of these is copied onto the copy before it
 * leaves. Computed is the whole trick: it has already resolved the custom
 * properties, the inheritance and `currentColor`, so none of the document's CSS
 * has to travel with the figure — and none of it can reach REX's own controls.
 * This is what an SVG exporter does, and for the same reason.
 *
 * The `url(#…)` ones — markers, clips, masks, filters — keep working because a
 * reference and the `<defs>` it points at travel together inside the one
 * element.
 */
const CARRIED_STYLES: readonly string[] = [
  "alignment-baseline",
  "clip-path",
  "clip-rule",
  "color",
  "display",
  "dominant-baseline",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "mix-blend-mode",
  "opacity",
  "paint-order",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "text-decoration",
  "vector-effect",
  "visibility",
  "white-space",
  "word-spacing",
];

/** A colour with nothing behind it — both spellings a browser returns. */
const TRANSPARENT = /^(?:transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

/**
 * The cursor, and only the cursor — and it says exactly what `openableFrom`
 * below does, selector for selector.
 *
 * That correspondence is the point, and it is why there is no size threshold
 * anywhere in this file. The first version excluded an `<svg>` under 80px, to
 * keep a lightbox off an inline chevron; nothing in CSS can express "80px", so
 * the cursor could not agree with the rule and every small icon advertised a
 * preview that never came. A cursor that lies is worse than a lightbox over a
 * 16px glyph.
 *
 * What replaced it is a signal the document actually declares:
 * `aria-hidden="true"` is an author saying this drawing is decoration. The four
 * diagrams in ProtoBot's architecture page carry `role="img"` and an
 * `aria-label`; Mermaid's renders carry `role="graphics-document document"`.
 * None of them is hidden, and an icon that is decoration usually says so.
 *
 * `a[href] img` has to undo the rule rather than the rule avoiding links: the
 * UA stylesheet puts `cursor: pointer` on an anchor and the image inherits it,
 * so without that line a README badge would advertise a preview too.
 */
const CURSOR_STYLESHEET = `
  img, svg { cursor: zoom-in; }
  a[href] img, a[href] svg { cursor: pointer; }
  img[aria-hidden="true"], svg[aria-hidden="true"] { cursor: auto; }
`;

/**
 * The SVG is re-sanitised on the way out of the iframe, and that is not
 * belt-and-braces.
 *
 * The iframe is sandboxed without `allow-scripts` (spec 01 §5.4 step 2), so
 * whatever a document carries is inert *there*. The lightbox is in the
 * renderer, where script does run — and an `<svg>` moved across that line
 * brings its `<script>` children and its `onload=` attributes with it. The
 * document was purified once already on the way in (`sanitise.ts`), so this
 * should find nothing; a boundary that is only safe because of what happened
 * upstream is one refactor away from not being safe at all.
 *
 * THE NODE IS SANITISED, NOT ITS `outerHTML`. DOMPurify duck-types its input,
 * so a node from the iframe's realm is handled as a node — and importing it
 * keeps the two namespaces a diagram is built from, rather than putting them
 * through an HTML parser that has to guess at them again.
 *
 * `HTML_INTEGRATION_POINTS` is the line that makes a Mermaid diagram legible,
 * and it is worth the paragraph it costs. Mermaid draws every node label into a
 * `<foreignObject>` holding an HTML `<div>`; DOMPurify's default integration
 * points are `['annotation-xml']` alone, so an HTML element inside
 * `foreignObject` fails `_checkHtmlNamespace` and is dropped. Measured on
 * 2026-08-24 against `components.md`: all seven labels came back as
 * `<foreignObject width="64.125" height="24"></foreignObject>` and the diagram
 * drew as a column of empty boxes — a failure that reads as a styling bug and
 * logs nothing.
 *
 * That default guards against mXSS, where sanitised output is *re-serialised
 * and re-parsed* and the parser resolves the namespaces differently the second
 * time. That round trip does not happen here: what comes back is a DOM
 * fragment, and the lightbox inserts it as one. The tag and attribute
 * allow-lists are untouched either way, so `<script>` and every `on*` handler
 * are still removed — which is the property that actually matters at this
 * boundary.
 */
const SVG_SANITISE_OPTIONS = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ["style", "foreignObject"],
  // A set, not a list: DOMPurify clones this value and then indexes it by the
  // parent's lowercased tag name. An array would clone to an array, and every
  // lookup on it would be undefined. `annotation-xml` is DOMPurify's own
  // default and is repeated because this replaces the set rather than adding
  // to it.
  HTML_INTEGRATION_POINTS: { "annotation-xml": true, foreignobject: true },
  // Literal `true`, so the overload that returns a fragment is the one chosen.
  RETURN_DOM_FRAGMENT: true as const,
};

/**
 * The colour the figure is drawn on where it lives.
 *
 * The lightbox's own paper is right for the two documents REX is developed
 * against, and wrong the first time somebody opens a dark one: a diagram drawn
 * in pale strokes for a dark page disappears on white. The nearest ancestor with
 * a real background is what the document itself puts behind the figure, so it is
 * the honest answer for both.
 */
function backdropOf(element: Element): string | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = view.getComputedStyle(node).backgroundColor;
    if (colour && !TRANSPARENT.test(colour)) return colour;
  }
  return null;
}

/**
 * A detached copy carrying its own appearance.
 *
 * `cloneNode` first, so nothing is written to the document under review — the
 * rule at the head of this file. The two trees are then walked in lockstep,
 * which is sound because a deep clone has exactly the structure of its original
 * and `querySelectorAll` returns document order for both.
 */
function withInlineStyles(element: Element): Element {
  const copy = element.cloneNode(true) as Element;
  const view = element.ownerDocument.defaultView;
  if (!view) return copy;

  const originals = [element, ...element.querySelectorAll("*")];
  const copies = [copy, ...copy.querySelectorAll("*")];
  for (const [index, source] of originals.entries()) {
    const target = copies[index];
    // The iframe's own constructors, not this document's — the realm trap
    // again, and here it would silently skip every element.
    if (!(target instanceof view.SVGElement || target instanceof view.HTMLElement)) continue;
    const computed = view.getComputedStyle(source);
    for (const property of CARRIED_STYLES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  }
  return copy;
}

/** The `<figcaption>` beside it, or the alt text. Never both. */
function captionOf(element: Element): string | null {
  const caption = element.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
  if (caption) return caption;
  const alt = element instanceof HTMLImageElement ? element.alt.trim() : "";
  return alt || null;
}

/**
 * The figure this click is about, or null if the click was about something else.
 *
 * Three things are deliberately not figures, and the stylesheet above excludes
 * exactly the same three:
 *
 * - anything carrying `data-rex-overlay`, which is REX's own — a PDF page
 *   bitmap most of all. A page is the document, and the document already zooms.
 * - anything inside a link. A README's badges are all of them, and a lightbox
 *   of a 20px "build passing" is nobody's idea of a bigger preview.
 * - anything the author marked `aria-hidden`, which is decoration by
 *   declaration rather than by guesswork about its size.
 */
function openableFrom(target: EventTarget | null): Element | null {
  // Not `instanceof Element`: the target belongs to the iframe's realm, and
  // `Element` here is the overlay's own constructor, so the test is always
  // false across the two documents. The same trap `DocumentView` documents on
  // its fragment-link handler.
  const start = target as Element | null;
  if (typeof start?.closest !== "function") return null;

  const element = start.closest("img, svg");
  if (!element) return null;
  if (element.closest("[data-rex-overlay], a[href]")) return null;
  return element.getAttribute("aria-hidden") === "true" ? null : element;
}

function figureFrom(element: Element): PreviewFigure | null {
  const caption = captionOf(element);
  const backdrop = backdropOf(element);
  // Tag name rather than `instanceof HTMLImageElement`, for the realm reason
  // above: the element's constructor is the iframe's, not this document's.
  if (element.tagName.toLowerCase() === "img") {
    // `currentSrc` rather than `src`: it is already absolute, and it is the URL
    // the browser actually fetched, which is the one that will load again here.
    const image = element as HTMLImageElement;
    const src = image.currentSrc || image.getAttribute("src") || "";
    return src ? { kind: "image", src, caption, backdrop } : null;
  }
  const svg = DOMPurify.sanitize(withInlineStyles(element), SVG_SANITISE_OPTIONS);
  return svg.firstElementChild ? { kind: "svg", svg, caption, backdrop } : null;
}

/**
 * Wires one document for previews. Called once per load, beside the iframe's
 * other two listeners in `DocumentView`.
 *
 * Nothing guards against pick or pen mode: both layers cover the frame and
 * swallow the pointer, so a click in either never reaches this document at all.
 * A second guard here would be a second thing to keep in step with them.
 */
export function attachFigurePreview(
  inner: Document,
  onOpen: (figure: PreviewFigure) => void,
): void {
  const style = inner.createElement("style");
  // §6.3 rule 2 — REX's own elements stay out of the text index.
  style.setAttribute("data-rex-overlay", "");
  style.textContent = CURSOR_STYLESHEET;
  inner.head.append(style);

  inner.addEventListener("click", (event: MouseEvent) => {
    // A drag that started in the prose and ended on the image fires `click` on
    // the image. That gesture was a selection, and a lightbox over it would
    // throw the selection away at the moment it was finished.
    if (inner.getSelection()?.isCollapsed === false) return;

    const element = openableFrom(event.target);
    if (!element) return;
    const figure = figureFrom(element);
    if (!figure) return;
    // A linked image is already excluded above, so the only navigation this can
    // cancel is the one the browser would invent for a bare image.
    event.preventDefault();
    onOpen(figure);
  });
}
