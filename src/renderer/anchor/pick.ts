// design/selection — pointing at something that is not a run of text.
//
// Four of the five anchor kinds in design/selection/Kinds.dc.html were already
// creatable by `create.ts` and resolvable by `resolve.ts`, and none of them was
// reachable from the UI. This file is what reaches them: given a point, or a
// text selection, it produces the chain of things the reviewer could anchor to,
// each described well enough to choose between them before clicking.
//
// Pure DOM on purpose. It runs unchanged inside the tier 1 iframe and inside
// the tier 2 preload, and it holds nothing React, IPC or database shaped.

import type { Anchor, AnchorExtent, LineRange } from "../../shared/types.ts";
import { generateCssPath, isStableId } from "./create.ts";
import { resolveAnchor } from "./resolve.ts";
import {
  documentRunFor,
  type ElementRun,
  headingTextOf,
  runMembers,
  sectionHeadingFor,
  sectioningElementFor,
  sectionRunFor,
} from "./section.ts";
import { elementToOffsets, type TextIndex } from "./textIndex.ts";

/**
 * How well an anchor on this element would survive an edit — read straight off
 * what would be stored. Shown before the click because the reviewer can act on
 * it: one level wider is often something with an id or with text.
 */
export type AnchorStrength = "durable" | "fair" | "weak";

export interface ScopeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PickScope {
  /** Position in the chain, narrow to wide. What the surface takes back. */
  index: number;
  kind: "text" | "element";
  /**
   * Spec 06 §4.1 — set on the two scopes that cover more than the element they
   * name. Absent everywhere else, which is the old behaviour.
   */
  extent?: AnchorExtent;
  /** Crumb and chip label — `td`, `tr`, `table`, `section#retry-policy`. */
  label: string;
  /** Card heading — `Cell · row 2, "Notes"`. */
  title: string;
  /** What would be stored, in words. */
  detail: string;
  /** The element's opening text, when it has any. */
  quote: string | null;
  strength: AnchorStrength;
  /** Why that strength, in one clause. */
  strengthNote: string;
  /**
   * Bounding box in *document* coordinates — scroll offset included, the same
   * frame `ResolvedThread.top` uses. Viewport coordinates would go stale the
   * moment the reader scrolled with the composer open.
   */
  rect: ScopeRect;
  /** True for a figure, image or drawing — the kinds a region can be cut from. */
  regionCapable: boolean;
}

/** The serialisable half crosses the process boundary; the elements stay put. */
export interface ScopeChain {
  scopes: PickScope[];
  /** Live elements, parallel to `scopes`. Null at a text scope. */
  elements: Array<Element | null>;
  /** The selection a text scope was built from, if any. */
  range: Range | null;
}

/** An inline run is not a thing you comment on; its block is. */
const INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BR",
  "CITE",
  "CODE",
  "DATA",
  "DFN",
  "EM",
  "I",
  "KBD",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
]);

/** Things a dragged box can be cut out of. */
const REGION_TAGS = new Set(["FIGURE", "IMG", "SVG", "CANVAS", "VIDEO", "PICTURE"]);

/** Never offered as a scope: the whole page is not an anchor. */
const CHAIN_STOP = new Set(["BODY", "HTML", "MAIN", "#document"]);

/**
 * Walked through but never offered. `<tbody>` holds every row of a table and
 * would appear in the chain as a second "table" between the row and the table —
 * a scope nobody means, and one that makes the widening read as a bug.
 */
const TRANSPARENT = new Set(["TBODY", "THEAD", "TFOOT", "COLGROUP"]);

/**
 * The same rule, by class, for a PDF (spec 03 §7.2).
 *
 * `.textLayer` and `.rex-pdf-sheet` are both exactly the page's own box, so the
 * chain offered three names for one thing and picking inside a PDF read as "it
 * only ever selects the whole page". `.markedContent` is `display: contents`
 * and has no box at all, so it could never be outlined.
 */
const TRANSPARENT_CLASSES = ["textLayer", "rex-pdf-sheet", "markedContent"];

/** The page box a region can be cut from — a chart on a PDF page (§7.4). */
const PDF_PAGE_CLASS = "rex-pdf-page";

/** How far up to offer. Beyond this the scopes stop being distinguishable. */
const MAX_SCOPES = 6;

/** An element quote is its opening text, not all of it (§6.4 / create.ts). */
const QUOTE_PREVIEW_MAX = 90;

/** SVG elements report a lowercase `tagName`; normalise before comparing. */
function tagOf(el: Element): string {
  return el.tagName.toUpperCase();
}

function transparent(el: Element): boolean {
  return (
    TRANSPARENT.has(tagOf(el)) || TRANSPARENT_CLASSES.some((name) => el.classList.contains(name))
  );
}

/**
 * The run of glyphs under the cursor in a PDF, or null outside one.
 *
 * PDF.js places every text item absolutely, so an item is a box on the page
 * rather than an inline run inside a paragraph. Walking up out of it — which
 * `<span>` otherwise demands — lands on the text layer, and the text layer
 * covers the whole page: that is why pick mode in a PDF could offer nothing
 * smaller than the page. Measured on 2026-08-21 on `sample-document.pdf`.
 */
function pdfTextItem(from: Element): Element | null {
  const layer = from.closest(".textLayer");
  if (!layer || from === layer) return null;
  let el: Element | null = from;
  while (el && el !== layer) {
    // `.markedContent` groups items and has no box; the item inside it does.
    if (tagOf(el) === "SPAN" && !el.classList.contains("markedContent")) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * The smallest thing under the cursor worth anchoring to. Inline runs resolve
 * up to their block, so hovering a bold word offers the paragraph rather than
 * the `<strong>` — an anchor on the `<strong>` is a positional path to a word.
 *
 * A PDF text item is the exception, and not an inconsistent one: it is already
 * a positioned box, so there is no block for it to resolve up to.
 */
export function smallestAnchorable(from: Element | null): Element | null {
  const item = from ? pdfTextItem(from) : null;
  if (item) return item;
  let el = from;
  while (el && INLINE_TAGS.has(tagOf(el))) el = el.parentElement;
  return el;
}

/**
 * Spec 06 §5.3 step 2 — a block the lasso may take.
 *
 * The same three exclusions the chain already applies, asked as a predicate
 * instead of as a walk: the page itself is not an anchor, a `<tbody>` is a name
 * for a table nobody means, and an inline run is not a thing you comment on —
 * its block is.
 *
 * A PDF's text items are `<span>`s and are therefore excluded, which is
 * deliberate rather than incidental: circling a paragraph of a PDF selects no
 * line, so the drawing falls through to §5.3's floor and becomes a region of
 * the page — which is what spec 03 §7.3 says a PDF comment is.
 */
export function isAnchorableBlock(el: Element): boolean {
  const tag = tagOf(el);
  return !CHAIN_STOP.has(tag) && !INLINE_TAGS.has(tag) && !transparent(el);
}

function textOf(index: TextIndex, el: Element): string | null {
  const span = elementToOffsets(index, el);
  if (!span) return null;
  const text = index.text.slice(span.start, span.end).trim();
  return text.length > 0 ? text : null;
}

function preview(text: string | null): string | null {
  if (!text) return null;
  return text.length > QUOTE_PREVIEW_MAX ? `${text.slice(0, QUOTE_PREVIEW_MAX)}…` : text;
}

/** Position of `el` among its siblings of the same tag, 1-indexed. */
function ordinalOf(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  return (
    Array.from(parent.children)
      .filter((child) => child.tagName === el.tagName)
      .indexOf(el) + 1
  );
}

/** The header cell above a `<td>`, when the table has one. */
function columnHeader(cell: Element): string | null {
  const row = cell.parentElement;
  const table = cell.closest("table");
  if (!row || !table) return null;
  const column = Array.from(row.children).indexOf(cell);
  const head = table.querySelector("thead tr") ?? table.querySelector("tr");
  const header = head?.children[column];
  const text = header?.textContent?.trim();
  return text && text.length > 0 ? text : null;
}

function tableShape(table: Element): string {
  const rows = table.querySelectorAll("tr").length;
  const first = table.querySelector("tr");
  const columns = first ? first.children.length : 0;
  return `${rows} row${rows === 1 ? "" : "s"} × ${columns} column${columns === 1 ? "" : "s"}`;
}

/** The caption or heading that names a block, for the card's title line. */
function nameOf(el: Element): string | null {
  const caption = el.querySelector("figcaption, caption");
  const captionText = caption?.textContent?.trim();
  if (captionText) return captionText;
  const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
  const headingText = heading?.textContent?.trim();
  return headingText ?? null;
}

/** A short human name for what this element is. */
function titleOf(el: Element, quote: string | null): string {
  const tag = tagOf(el);
  const quoted = (text: string | null): string => (text ? ` · “${text}”` : "");

  // Before the tag table, because a PDF page is a `div` and the table has only
  // one word for those: the panel row for a whole page read "Block".
  if (el.classList.contains(PDF_PAGE_CLASS)) {
    const page = el.getAttribute("data-page");
    return page ? `Page ${page}` : "Page";
  }

  switch (tag) {
    case "TD":
    case "TH": {
      const header = columnHeader(el);
      const row = el.parentElement ? ordinalOf(el.parentElement) : 1;
      return `Cell · row ${row}${header ? `, “${header}”` : ""}`;
    }
    case "TR":
      return `Row ${ordinalOf(el)}${quoted(preview(el.children[0]?.textContent?.trim() ?? null))}`;
    case "TABLE":
      return `Table · ${tableShape(el)}`;
    case "THEAD":
      return "Table header";
    case "TBODY":
      return `Table body · ${tableShape(el.closest("table") ?? el)}`;
    case "FIGURE":
    case "PICTURE":
      return `Figure${quoted(nameOf(el))}`;
    case "IMG":
      return `Image${quoted((el as HTMLImageElement).alt || null)}`;
    case "SVG":
      return `Drawing${quoted(el.getAttribute("aria-label"))}`;
    case "CANVAS":
      return "Drawing";
    case "PRE":
      return "Code block";
    case "BLOCKQUOTE":
      return "Quote block";
    case "UL":
    case "OL":
      return `List · ${el.children.length} item${el.children.length === 1 ? "" : "s"}`;
    case "LI":
      return `List item ${ordinalOf(el)}`;
    case "P":
      return "Paragraph";
    case "SPAN":
      // Only a PDF text item reaches here: an inline span in an HTML document
      // resolves up to its block — see `smallestAnchorable`.
      return `Line${quoted(preview(quote))}`;
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return `Heading${quoted(preview(el.textContent?.trim() ?? null))}`;
    case "SECTION":
    case "ARTICLE":
    case "ASIDE":
    case "HEADER":
    case "FOOTER":
    case "DIV":
      return `${tag === "DIV" ? "Block" : tag.charAt(0) + tag.slice(1).toLowerCase()}${quoted(nameOf(el))}`;
    default:
      return quote ? `${tag.toLowerCase()}${quoted(preview(quote))}` : tag.toLowerCase();
  }
}

/**
 * Three tiers, read straight off what would be stored:
 * a stable id names the element wherever it moves to; a text quote carries it
 * even if the path renumbers; a positional path alone is the case `create.ts`
 * warns lands on an unrelated element after an edit.
 */
function strengthOf(el: Element, quote: string | null): [AnchorStrength, string] {
  if (isStableId(el.id)) return ["durable", "hand-written id, survives a rebuild"];
  if (quote) return ["fair", "no id, but its text carries it if it moves"];
  return ["weak", "a positional path and nothing else — widen one level"];
}

/** Viewport rect → document rect, so it survives a scroll. */
export function toDocumentRect(view: Window | null, rect: DOMRect): ScopeRect {
  return {
    x: rect.left + (view?.scrollX ?? 0),
    y: rect.top + (view?.scrollY ?? 0),
    w: rect.width,
    h: rect.height,
  };
}

function rectOf(el: Element): ScopeRect {
  return toDocumentRect(el.ownerDocument?.defaultView ?? null, el.getBoundingClientRect());
}

/** The smallest box holding both. Spec 06 §4.4 — the box for a run. */
export function unionRect(a: ScopeRect, b: ScopeRect): ScopeRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** A run's box, measured live, so it re-flows exactly like every other box. */
export function rectOfRun(run: ElementRun): ScopeRect {
  return unionRect(rectOf(run.first), rectOf(run.last));
}

/**
 * The crumb and chip word. A tag name everywhere except in a PDF, where "div"
 * and "span" say nothing at all: there they are the page and a line on it.
 */
function labelOf(el: Element): string {
  if (el.classList.contains(PDF_PAGE_CLASS)) {
    const page = el.getAttribute("data-page");
    return page ? `page ${page}` : "page";
  }
  if (pdfTextItem(el) === el) return "line";
  const tag = el.tagName.toLowerCase();
  return isStableId(el.id) ? `${tag}#${el.id}` : tag;
}

/** One element, described. Exported for the card line a quoteless anchor needs. */
export function describeElement(index: TextIndex, el: Element, position = 0): PickScope {
  const quote = textOf(index, el);
  const [strength, strengthNote] = strengthOf(el, quote);
  // The real selector, not a sketch of one: it is what makes a weak anchor
  // recognisably weak — `section:nth-of-type(3) > div > p` reads as a slot
  // rather than as a thing, which is exactly the judgement being offered.
  const stored = isStableId(el.id)
    ? `element.id = "${el.id}"`
    : `element.css = "${generateCssPath(el)}"`;

  return {
    index: position,
    kind: "element",
    label: labelOf(el),
    title: titleOf(el, quote),
    detail: quote ? `${stored} · quote = “${preview(quote)}”` : `${stored} · no text to quote`,
    quote: preview(quote),
    strength,
    strengthNote,
    rect: rectOf(el),
    // A PDF page joins the figures: it is a picture with text over it, and
    // pdf.ts already tells the reviewer to "comment on a region of a page"
    // when the page carries no text layer at all (spec 03 §7.4).
    regionCapable: REGION_TAGS.has(tagOf(el)) || el.classList.contains(PDF_PAGE_CLASS),
  };
}

/**
 * Spec 06 §4.2 — the heading, and everything under it.
 *
 * The stored anchor is the *heading's*, so the strength is the heading's too:
 * in Markdown it carries a hand-written slug id, which is the strongest anchor
 * REX has; elsewhere its own text carries it.
 */
function describeSection(heading: Element, run: ElementRun, position: number): PickScope {
  const name = headingTextOf(heading);
  const blocks = runMembers(run).length;
  const durable = isStableId(heading.id);
  const stored = durable
    ? `element.id = "${heading.id}"`
    : `element.css = "${generateCssPath(heading)}"`;

  return {
    index: position,
    kind: "element",
    extent: "section",
    label: `section “${name}”`,
    title: `Section · “${name}”`,
    detail: `${stored} · extent = section · covers ${blocks} block${blocks === 1 ? "" : "s"}`,
    quote: name.length > 0 ? name : null,
    strength: durable ? "durable" : "fair",
    strengthNote: durable
      ? "hand-written id, survives a rebuild"
      : "no id, but its heading carries it if it moves",
    rect: rectOfRun(run),
    regionCapable: false,
  };
}

/** Spec 06 §4.3 — the file itself, named by nothing inside it. */
function describeDocument(run: ElementRun, position: number): PickScope {
  return {
    index: position,
    kind: "element",
    extent: "document",
    label: "document",
    title: "The whole document",
    detail: "no element and no quote — the file itself",
    quote: null,
    strength: "durable",
    strengthNote: "the file itself — it cannot move",
    rect: rectOfRun(run),
    regionCapable: false,
  };
}

/**
 * Spec 06 §4.1 — `section` and `document`, appended at the wide end.
 *
 * Both sit **outside `MAX_SCOPES`**, which caps walked ancestors only. Without
 * that exemption a cell deep in a `div`-wrapped table fills the chain and loses
 * exactly these two scopes, at the depth where they are most wanted.
 *
 * Rule 2 — a real sectioning element wins over a synthetic run. When the
 * heading's enclosing `<section>`, `<article>` or `<aside>` already holds the
 * whole run it *is* the section scope: a true DOM subtree is a stronger anchor
 * than a rule about siblings. If the walk above already offered it there is
 * nothing to do; if the cap cut it off, it is appended here, because the same
 * exemption applies to it.
 */
function appendWideScopes(
  index: TextIndex,
  from: Element,
  scopes: PickScope[],
  elements: Array<Element | null>,
  offset: number,
): void {
  const at = (): number => scopes.length + offset;

  const heading = sectionHeadingFor(from);
  if (heading) {
    const run = sectionRunFor(heading);
    const real = sectioningElementFor(run);
    if (!real) {
      scopes.push(describeSection(heading, run, at()));
      elements.push(heading);
    } else if (!elements.includes(real)) {
      scopes.push(describeElement(index, real, at()));
      elements.push(real);
    }
  }

  const whole = documentRunFor(index.doc);
  if (whole) {
    scopes.push(describeDocument(whole, at()));
    // `<body>` is never offered as an element scope (CHAIN_STOP), but it is a
    // real node and `keptIndex` compares by identity: without one here, widening
    // to `document` and then moving the pointer one pixel would silently drop
    // back to the paragraph.
    elements.push(index.doc.body);
  }
}

/** The ancestor chain from `el` outward, narrow first, capped and stopped. */
function chainFrom(index: TextIndex, el: Element | null, offset: number): ScopeChain {
  const scopes: PickScope[] = [];
  const elements: Array<Element | null> = [];

  let current: Element | null = el;
  while (current && !CHAIN_STOP.has(tagOf(current)) && scopes.length + offset < MAX_SCOPES) {
    if (!transparent(current)) {
      scopes.push(describeElement(index, current, scopes.length + offset));
      elements.push(current);
    }
    current = current.parentElement;
  }

  if (el) appendWideScopes(index, el, scopes, elements, offset);

  return { scopes, elements, range: null };
}

/**
 * Spec 06 §5.3 step 6 — the chain around one element, from outside this file.
 *
 * A drawn target is an **ordinary element anchor**, so its panel row must offer
 * the same chips a clicked one does: widen a paragraph the circle caught to its
 * section, or drop to the cell inside it.
 */
export function scopeChainForElement(index: TextIndex, el: Element): ScopeChain {
  return chainFrom(index, el, 0);
}

/**
 * The line just above or below the cursor, when the cursor is in the gap.
 *
 * PDF.js sizes every text item to its glyphs, not to the line it sits in, so
 * the leading between two lines belongs to no item at all — and the text layer
 * behind it covers the whole page. Pointing two pixels under a sentence
 * therefore offered the page, and a pointer moving down a paragraph flickered
 * between the line and the page. Measured on 2026-08-21 on
 * `documentation-sample/one/sample-document.pdf`: on the glyphs, 14 probes out
 * of 14 found their line; two pixels below, 0 of 14 did.
 *
 * The slack comes from the line's own height rather than a fixed number of
 * pixels, so a heading is as forgiving as a caption and nothing is tuned per
 * document. It is deliberately small in both directions: past it — in a margin,
 * or over a drawing — the honest answer is the page, and a region is how a
 * drawing gets commented on.
 *
 * Only reached when the cursor is over a text layer and nothing else, so the
 * search is one page's items and never runs in an HTML document.
 */
function nearestTextItem(target: Element | null, x: number, y: number): Element | null {
  if (!target?.classList.contains("textLayer")) return null;

  let best: Element | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const span of target.querySelectorAll("span")) {
    if (span.classList.contains("markedContent")) continue;
    const box = span.getBoundingClientRect();
    // A `.markedContent` wrapper and a `<br>` both measure zero.
    if (box.width === 0 || box.height === 0) continue;

    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    const slack = box.height * 0.6;
    if (dx > slack || dy > slack) continue;

    const distance = dx + dy;
    if (distance < bestDistance) {
      best = span;
      bestDistance = distance;
    }
  }
  return best;
}

/** design/selection/Hover — what the cursor is over, and what encloses it. */
export function scopeChainAt(index: TextIndex, x: number, y: number): ScopeChain | null {
  const target = index.doc.elementFromPoint(x, y);
  const anchorable = nearestTextItem(target, x, y) ?? smallestAnchorable(target);
  if (!anchorable || CHAIN_STOP.has(tagOf(anchorable))) return null;
  const chain = chainFrom(index, anchorable, 0);
  return chain.scopes.length > 0 ? chain : null;
}

/**
 * design/selection/Escalate — the same widening, offered from a text selection
 * instead of from the cursor. The text itself is scope 0; the enclosing
 * structure follows. Both write the same `Anchor` shape.
 */
export function scopeChainForRange(index: TextIndex, range: Range): ScopeChain {
  const text = range.toString().replace(/\s+/g, " ").trim();
  const container = range.commonAncestorContainer;
  const host =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : (container.parentElement ?? null);

  const textScope: PickScope = {
    index: 0,
    kind: "text",
    label: "text",
    title: "Text selection",
    detail: "quote + 32 characters either side · survives a rewrite elsewhere",
    quote: preview(text),
    strength: text.length >= 24 ? "durable" : "fair",
    strengthNote:
      text.length >= 24
        ? "a long quote is close to unique in one document"
        : "a short quote — the surrounding context disambiguates it",
    rect: toDocumentRect(index.doc.defaultView, range.getBoundingClientRect()),
    regionCapable: false,
  };

  const outer = chainFrom(index, smallestAnchorable(host), 1);
  return {
    scopes: [textScope, ...outer.scopes],
    elements: [null, ...outer.elements],
    range,
  };
}

/**
 * Spec 05 §4.1 — the chain to widen through, for an anchor already written.
 *
 * The selection panel keeps items, not chains. A chain holds live `Element`s:
 * they die when the document reloads, they cannot cross the tier 2 bridge, and
 * a stale one resolves to *somewhere* and looks fine. So widening rebuilds the
 * chain from the anchor every time, which also means it works after a reload —
 * which the remembered chain never survived.
 *
 * `kind` is not a convenience. A text anchor and an element anchor carry the
 * same fields — both quote their text and both name their element (`create.ts`)
 * — so a stored anchor cannot say which gesture made it, and `resolveAnchor`
 * answers the quote first for either. Rebuilding without `kind` therefore
 * offered `text` as the chosen scope for a comment stored on a table cell:
 * measured on 2026-08-21 against `retries.md`. The panel was there when the
 * anchor was made and knows the answer, so it states it rather than letting
 * this function infer one.
 *
 * Null when the anchor does not resolve, which is the honest answer: the thing
 * it named is not in this document any more, so there is nothing to widen from.
 *
 * `active` is which scope of the rebuilt chain the anchor already *is*. It used
 * to be 0 by construction, because the chain was always built outward from
 * whatever the anchor resolved to. Spec 06 breaks that: a section anchor
 * resolves to a run whose chain is built from its heading, so the anchor's own
 * scope is the `section` chip and not the `heading` one below it.
 */
export function scopeChainForAnchor(
  index: TextIndex,
  anchor: Anchor,
  kind: "text" | "element",
): { chain: ScopeChain; active: number } | null {
  // Nulling the quote forces `resolveAnchor` past layer 1 and onto the element
  // the anchor names — which for an element anchor is the thing it is about.
  // An extent anchor is exempt: `resolveSection` already leads with the element
  // and keeps the quote as its strongest fallback.
  const probe = kind === "element" && !anchor.extent ? { ...anchor, quote: null } : anchor;
  const resolution = resolveAnchor(index, probe);
  if (!resolution) return null;

  if (resolution.kind === "range") {
    const chain = scopeChainForRange(index, resolution.range);
    return chain.scopes.length > 0 ? { chain, active: 0 } : null;
  }

  if (resolution.kind === "element") {
    const chain = chainFrom(index, resolution.element, 0);
    return chain.scopes.length > 0 ? { chain, active: 0 } : null;
  }

  // Spec 06 §6.2 — a document target has nothing to widen to and nothing to
  // narrow back to, so its chain is the one chip that says what it is.
  if (resolution.extent === "document") {
    const scope = describeDocument({ first: resolution.first, last: resolution.last }, 0);
    return { chain: { scopes: [scope], elements: [index.doc.body], range: null }, active: 0 };
  }

  // A section: the chain is built from its heading, which appends the section
  // scope again by §4.1. Falling back to 0 covers the case where the document
  // has since gained a real `<section>` and rule 2 now wins.
  const chain = chainFrom(index, resolution.first, 0);
  if (chain.scopes.length === 0) return null;
  const at = chain.scopes.findIndex((scope) => scope.extent === "section");
  return { chain, active: at >= 0 ? at : 0 };
}

/**
 * Spec 05 §5.6.1 — the blocks a set of changed source lines falls inside.
 *
 * `data-src-line` marks where a block *starts*, so a changed line is almost
 * never equal to one. A block therefore owns every line from its own up to the
 * line before the next block's, and a range matches when the two overlap. That
 * turns "lines 12 to 16 changed" into "this paragraph and that table changed",
 * which is the only form a reviewer can act on.
 *
 * Only the outermost match is returned: a changed paragraph inside a changed
 * blockquote is one change, and two nested outlines read as two.
 */
export function changedBlocks(doc: Document, ranges: ReadonlyArray<LineRange>): Element[] {
  if (ranges.length === 0) return [];

  const stamped = [...doc.querySelectorAll("[data-src-line]")]
    .map((el) => ({ el, line: Number(el.getAttribute("data-src-line")) }))
    .filter((entry) => Number.isInteger(entry.line) && entry.line > 0);
  if (stamped.length === 0) return [];

  const starts = [...new Set(stamped.map((entry) => entry.line))].sort((a, b) => a - b);
  const lastLineOf = new Map<number, number>();
  starts.forEach((line, position) => {
    // The final block runs to the end of the file, whatever that is.
    lastLineOf.set(
      line,
      position + 1 < starts.length ? starts[position + 1] - 1 : Number.MAX_SAFE_INTEGER,
    );
  });

  const hit = stamped
    .filter(({ line }) => {
      const last = lastLineOf.get(line) ?? line;
      return ranges.some((range) => range.from <= last && range.to >= line);
    })
    .map((entry) => entry.el);

  return hit.filter((el) => !hit.some((other) => other !== el && other.contains(el)));
}
