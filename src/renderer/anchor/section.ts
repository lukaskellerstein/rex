// Spec 06 §4.2 — what a section is, when the document has no `<section>`.
//
// In a rendered Markdown or DOCX document the blocks are **siblings**, not
// nested: `markdownPage()` puts them directly in `<body>` and mammoth emits a
// flat fragment. So a section is not a subtree and cannot be found with
// `closest()`. It is a heading, plus every following sibling up to but not
// including the next heading of the same or higher rank — the rule every
// Markdown tool uses and the one the author had in mind when they typed it.
//
// Its own module rather than part of `pick.ts` (which §9 nominates) for one
// reason: `resolve.ts` needs it too, and `pick.ts` already imports `resolve.ts`.
// Putting it there would close an import cycle between the two files the whole
// resolver hangs off.
//
// Pure DOM, like everything beside it: it runs unchanged in the tier 1 iframe
// and in the tier 2 preload.

/** A run of sibling blocks — a section, or a whole document (§4.4). */
export interface ElementRun {
  first: Element;
  last: Element;
}

/** Elements that mark a section out in the DOM itself, when the author did. */
const SECTIONING_SELECTOR = "section, article, aside";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** How long a heading may be before the crumb and the card truncate it. */
const HEADING_PREVIEW_MAX = 60;

export function isHeading(el: Element): boolean {
  return /^H[1-6]$/.test(el.tagName.toUpperCase());
}

/** The heading a node sits in, or null when it sits in none. */
export function closestHeading(node: Node): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(HEADING_SELECTOR) ?? null;
}

/** 1 for `<h1>`, 6 for `<h6>`. Lower is *higher* rank, as in the markup. */
function rankOf(heading: Element): number {
  return Number(heading.tagName[1]);
}

/** The heading's own words, for a crumb, a chip, a panel row or a prompt. */
export function headingTextOf(heading: Element): string {
  const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > HEADING_PREVIEW_MAX ? `${text.slice(0, HEADING_PREVIEW_MAX)}…` : text;
}

/**
 * §4.2 — the heading, plus every following sibling up to but not including the
 * next heading of the same or higher rank.
 *
 * Three edges, stated so they are not rediscovered: a heading with no blocks
 * after it is a section of one element — itself; the last section of a document
 * runs to the last element beside it; and an `<h3>` belongs to the `<h2>` above
 * it, because only a same-or-higher rank ends the run.
 */
export function sectionRunFor(heading: Element): ElementRun {
  let last = heading;
  for (let sibling = heading.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (isHeading(sibling) && rankOf(sibling) <= rankOf(heading)) break;
    last = sibling;
  }
  return { first: heading, last };
}

/** Every sibling from `first` to `last` inclusive. */
export function runMembers(run: ElementRun): Element[] {
  const members: Element[] = [run.first];
  for (let sibling = run.first; sibling !== run.last; ) {
    const next: Element | null = sibling.nextElementSibling;
    // The two are siblings by construction; a null here would mean the DOM moved
    // under us, and walking off the end is not something to do quietly.
    if (!next) break;
    members.push(next);
    sibling = next;
  }
  return members;
}

/**
 * The heading whose section `el` sits in, or null when it sits in none.
 *
 * The *nearest preceding* heading, which is the innermost section containing
 * the element: under `## Roadmap` → `### Next quarter` → a paragraph, the
 * paragraph's section is "Next quarter". Content before the first heading
 * belongs to no section at all (§4.2), which is correct — a preamble is not a
 * section, and it is still reachable as itself and as the document.
 */
export function sectionHeadingFor(el: Element): Element | null {
  const doc = el.ownerDocument;
  if (!doc) return null;

  let best: Element | null = null;
  for (const heading of doc.querySelectorAll(HEADING_SELECTOR)) {
    const where = heading.compareDocumentPosition(el);
    if (where === 0) return heading; // `el` is the heading
    // `el` sits inside the heading — an <img> or a <code> in a title.
    if (where & Node.DOCUMENT_POSITION_CONTAINED_BY) return heading;
    // `el` wraps headings, so it is a container of sections rather than
    // something inside one. Nothing further can improve on that.
    if (where & Node.DOCUMENT_POSITION_CONTAINS) return null;
    if (where & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = heading;
      continue;
    }
    // Headings arrive in document order, so the first one that does not precede
    // `el` means every later one does not either.
    break;
  }

  if (!best) return null;
  // The nearest preceding heading is not always the enclosing one: headings can
  // live inside a `<section>` while `el` sits in a later `<div>` outside it.
  const run = sectionRunFor(best);
  return runMembers(run).some((member) => member === el || member.contains(el)) ? best : null;
}

/**
 * §4.1 rule 2 — the real `<section>`, `<article>` or `<aside>` that already
 * holds the whole run, or null when the author marked up no such thing.
 *
 * A true DOM subtree is a stronger anchor than a rule about siblings, and an
 * HTML document that marks up its own sections should not be second-guessed.
 */
export function sectioningElementFor(run: ElementRun): Element | null {
  const enclosing = run.first.closest(SECTIONING_SELECTOR);
  return enclosing?.contains(run.last) ? enclosing : null;
}

/**
 * §4.4 — the whole document as a run: `<body>`'s first and last element
 * children.
 *
 * Null only when the body holds no elements at all, which is a document with
 * nothing in it.
 */
export function documentRunFor(doc: Document): ElementRun | null {
  const body = doc.body;
  const first = body?.firstElementChild;
  const last = body?.lastElementChild;
  return first && last ? { first, last } : null;
}
