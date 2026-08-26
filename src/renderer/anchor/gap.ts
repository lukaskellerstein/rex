// Spec 16 §6 — Add: a place between two blocks.
//
// Every other anchor names a thing. This one names the space where a thing is
// not, and that is why it is the anchor kind most able to fail silently: a
// quote that resolves to the wrong paragraph is visibly wrong, while a gap that
// resolves three paragraphs late looks exactly like a gap. So §6.3's rule is
// enforced here and nowhere else — a single-sided match is `moved`, never `ok`,
// and no neighbour at all is `orphaned` rather than "somewhere near".
//
// Pure DOM, like `pick.ts` beside it: nothing React, IPC or database shaped.

import type { Anchor, GapNeighbour, GapRef } from "../../shared/types.ts";
import { createElementAnchor } from "./create.ts";
import type { TextIndex } from "./textIndex.ts";

/** The stamp every block-level element carries when REX rendered the document. */
const SRC_LINE = "[data-src-line]";

/** §6.7 — how much of a neighbour's text names it in a label. */
const LABEL_WORDS = 6;

/**
 * An inline run is part of a block, never a block. A gap sits between blocks.
 *
 * Its own copy rather than `pick.ts`'s, deliberately: `pick.ts` imports
 * `resolve.ts`, which imports this file, and a cycle between the three is worse
 * than eleven duplicated tag names.
 */
const INLINE = new Set([
  "A",
  "ABBR",
  "B",
  "CODE",
  "EM",
  "I",
  "MARK",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
]);

/**
 * The block a resolved neighbour belongs to.
 *
 * A quote resolves to a range inside a paragraph and an element ref can resolve
 * to something narrower than the block it sits in; the gap is defined between
 * *blocks*, so both are walked back out.
 *
 * The stamped ancestor wherever the renderer stamped one, because that is the
 * block every other part of REX agrees on. A hand-written HTML file has none
 * (spec 01 §5.4 point 3), and there the walk out of inline runs is what is
 * left — a quote inside a `<strong>` is about the paragraph around it.
 */
export function blockOf(node: Node | Element | null): Element | null {
  let el =
    node === null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : ((node as Node).parentElement ?? null);

  const stamped = el?.closest(SRC_LINE) ?? null;
  if (stamped) return stamped;

  while (el && INLINE.has(el.tagName.toUpperCase())) el = el.parentElement;
  return el;
}

/** The `data-src-line` of a block, or null when the format stamps none. */
export function stampedLineOf(el: Element | null): number | null {
  const stamped = el?.closest(SRC_LINE);
  if (!stamped) return null;
  const line = Number.parseInt(stamped.getAttribute("data-src-line") ?? "", 10);
  return Number.isFinite(line) ? line : null;
}

/** The opening words of a block, for a label the reviewer can recognise. */
export function firstWords(el: Element | null, words = LABEL_WORDS): string | null {
  const text = el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length === 0) return null;
  const taken = text.split(" ").slice(0, words).join(" ");
  return taken.length < text.length ? `${taken}…` : taken;
}

function neighbourOf(index: TextIndex, el: Element | null): GapNeighbour | null {
  if (!el) return null;
  // The same quote and element ref `createElementAnchor` writes, so a neighbour
  // resolves through the layers that already exist rather than a new mechanism.
  const anchor = createElementAnchor(index, el, null);
  return { quote: anchor.quote, element: anchor.element };
}

/** The line the insertion point sits on: the block below's, else the one after. */
function gapLine(after: Element | null, before: Element | null): number | null {
  const below = stampedLineOf(before);
  if (below !== null) return below;
  const above = stampedLineOf(after);
  return above === null ? null : above + 1;
}

/** §6.2 — a gap anchor, from the two blocks it sits between. */
export function createGapAnchor(
  index: TextIndex,
  after: Element | null,
  before: Element | null,
  sourceFile: string | null,
): Anchor {
  const line = gapLine(after, before);
  return {
    quote: null,
    position: null,
    element: null,
    region: null,
    source: sourceFile && line !== null ? { file: sourceFile, line } : null,
    gap: {
      after: neighbourOf(index, after),
      before: neighbourOf(index, before),
      line,
    },
  };
}

/** One side of a gap, as an ordinary anchor the four layers can be run on. */
export function neighbourAnchor(side: GapNeighbour): Anchor {
  return {
    quote: side.quote,
    position: null,
    element: side.element,
    region: null,
    source: null,
  };
}

/** What a gap resolved to: whichever of its two neighbours are still here. */
export interface GapMatch {
  after: Element | null;
  before: Element | null;
}

/**
 * §6.3 — resolve `after`, then `before`, and refuse to invent a third answer.
 *
 * `find` is injected rather than imported so this file never depends on
 * `resolve.ts`, which depends on it. It is `resolveAnchor` narrowed to "give me
 * the block this side names", and it is the only thing a neighbour needs.
 */
export function resolveGap(gap: GapRef, find: (anchor: Anchor) => Element | null): GapMatch | null {
  const after = gap.after ? find(neighbourAnchor(gap.after)) : null;
  const before = gap.before ? find(neighbourAnchor(gap.before)) : null;
  // Neither neighbour is here any more. §6.3 rule 3 — orphaned, and never
  // "somewhere near where it used to be".
  if (!after && !before) return null;
  return { after, before };
}

/** §6.7 — what a gap is called, in order of what resolved. */
export function gapLabel(after: Element | null, before: Element | null): string {
  const above = firstWords(after);
  if (above) return `Add here — after “${above}”`;
  const below = firstWords(before);
  if (below) return `Add here — before “${below}”`;
  return "Add here — after “…”";
}

/** The same label from the stored anchor, for a document that is not open. */
export function storedGapLabel(gap: GapRef): string {
  const above = gap.after?.quote?.exact?.replace(/\s+/g, " ").trim();
  if (above) return `Add here — after “${trimWords(above)}”`;
  const below = gap.before?.quote?.exact?.replace(/\s+/g, " ").trim();
  if (below) return `Add here — before “${trimWords(below)}”`;
  return "Add here — after “…”";
}

function trimWords(text: string): string {
  const taken = text.split(" ").slice(0, LABEL_WORDS).join(" ");
  return taken.length < text.length ? `${taken}…` : taken;
}
