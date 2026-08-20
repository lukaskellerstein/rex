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

import { generateCssPath, isStableId } from "./create.ts";
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

/** How far up to offer. Beyond this the scopes stop being distinguishable. */
const MAX_SCOPES = 6;

/** An element quote is its opening text, not all of it (§6.4 / create.ts). */
const QUOTE_PREVIEW_MAX = 90;

/** SVG elements report a lowercase `tagName`; normalise before comparing. */
function tagOf(el: Element): string {
  return el.tagName.toUpperCase();
}

/**
 * The smallest thing under the cursor worth anchoring to. Inline runs resolve
 * up to their block, so hovering a bold word offers the paragraph rather than
 * the `<strong>` — an anchor on the `<strong>` is a positional path to a word.
 */
export function smallestAnchorable(from: Element | null): Element | null {
  let el = from;
  while (el && INLINE_TAGS.has(tagOf(el))) el = el.parentElement;
  return el;
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

function labelOf(el: Element): string {
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
    regionCapable: REGION_TAGS.has(tagOf(el)),
  };
}

/** The ancestor chain from `el` outward, narrow first, capped and stopped. */
function chainFrom(index: TextIndex, el: Element | null, offset: number): ScopeChain {
  const scopes: PickScope[] = [];
  const elements: Array<Element | null> = [];

  let current: Element | null = el;
  while (current && !CHAIN_STOP.has(tagOf(current)) && scopes.length + offset < MAX_SCOPES) {
    if (!TRANSPARENT.has(tagOf(current))) {
      scopes.push(describeElement(index, current, scopes.length + offset));
      elements.push(current);
    }
    current = current.parentElement;
  }

  return { scopes, elements, range: null };
}

/** design/selection/Hover — what the cursor is over, and what encloses it. */
export function scopeChainAt(index: TextIndex, x: number, y: number): ScopeChain | null {
  const target = index.doc.elementFromPoint(x, y);
  const anchorable = smallestAnchorable(target);
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
