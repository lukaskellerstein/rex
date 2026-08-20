// SPEC.md §6.4 — Range → Anchor. Four layers are recorded at creation time so
// that resolution has something to fall back to (§6.2).

import type { Anchor, ElementRef, RegionRef, SourceRef } from "../../shared/types.ts";
import { elementToOffsets, rangeToOffsets, type TextIndex } from "./textIndex.ts";

/** How much context either side of the quote disambiguates a repeat (§4). */
const CONTEXT_CHARS = 32;

/** An element anchor quotes its opening text, not all of it — a long table
 * would otherwise store a copy of itself. */
const ELEMENT_QUOTE_MAX = 320;

/**
 * Framework-generated ids change on every render, so they are worse than no id
 * at all — an anchor keyed to one resolves confidently to the wrong element.
 * SPEC.md §6.4 step 6.
 */
const UNSTABLE_ID = /^(:|ember|mat-|cdk-|ng-|react-|r:|\d+$)/;

export function isStableId(id: string): boolean {
  return id.length > 0 && !UNSTABLE_ID.test(id);
}

/**
 * Attributes that describe *what an element is* rather than where it sits.
 * An inline diagram carries `aria-label` because it has to be readable to a
 * screen reader, which makes it the one thing about an SVG that survives its
 * neighbours being edited.
 */
const IDENTIFYING_ATTRS = ["aria-label", "data-testid", "name", "title"] as const;

/** Long labels become a prefix match rather than a 300-character selector. */
const ATTR_PREFIX_MAX = 120;

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * A selector matching this element and no other, or null when nothing but its
 * position distinguishes it.
 */
function identifyingSelector(el: Element): string | null {
  const doc = el.ownerDocument;
  if (!doc) return null;
  if (isStableId(el.id)) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  for (const attr of IDENTIFYING_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const truncated = value.length > ATTR_PREFIX_MAX;
    const probe = truncated ? value.slice(0, ATTR_PREFIX_MAX) : value;
    const selector = `${tag}[${attr}${truncated ? "^=" : "="}"${escapeAttrValue(probe)}"]`;
    try {
      if (doc.querySelectorAll(selector).length === 1) return selector;
    } catch {
      // Malformed value for a selector — try the next attribute.
    }
  }
  return null;
}

/**
 * A CSS path, preferring whatever identifies an element over where it sits.
 *
 * Purely positional paths were measured failing on the milestone 0 documents:
 * deleting one `<section>` renumbered `section:nth-of-type(3)` and an anchor on
 * a diagram resolved, confidently, to a different diagram. `nth-of-type` is
 * still the last resort — but only after identity has been tried at every level.
 */
export function generateCssPath(el: Element): string {
  const steps: string[] = [];
  let current: Element | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const identity = identifyingSelector(current);
    if (identity) {
      steps.unshift(identity);
      break;
    }
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      steps.unshift(tag);
      break;
    }
    const sameType = Array.from(parent.children).filter(
      (c) => c.tagName === (current as Element).tagName,
    );
    steps.unshift(
      sameType.length > 1 ? `${tag}:nth-of-type(${sameType.indexOf(current) + 1})` : tag,
    );
    current = parent;
  }

  return steps.join(" > ");
}

function nearestElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function elementRef(el: Element | null): ElementRef | null {
  if (!el) return null;
  const ref: ElementRef = {};
  if (isStableId(el.id)) ref.id = el.id;
  ref.css = generateCssPath(el);
  return ref;
}

/**
 * SPEC.md §6.4 step 7 — the nearest ancestor carrying `data-src-line`, stamped
 * by the Markdown renderer (§5.3). Absent for tier 1 HTML, where Apply locates
 * the edit by searching the file for the quote instead (§5.4).
 */
function sourceRef(node: Node, file: string | null): SourceRef | null {
  if (!file) return null;
  const el = nearestElement(node)?.closest("[data-src-line]");
  if (!el) return null;
  const line = Number.parseInt(el.getAttribute("data-src-line") ?? "", 10);
  return Number.isFinite(line) ? { file, line } : null;
}

/** SPEC.md §6.4 — a text anchor, the primary kind. */
export function createTextAnchor(
  index: TextIndex,
  range: Range,
  sourceFile: string | null,
): Anchor | null {
  const position = rangeToOffsets(index, range);
  if (!position) return null;

  const { text } = index;
  return {
    quote: {
      exact: text.slice(position.start, position.end),
      prefix: text.slice(Math.max(0, position.start - CONTEXT_CHARS), position.start),
      suffix: text.slice(position.end, Math.min(text.length, position.end + CONTEXT_CHARS)),
    },
    position,
    element: elementRef(nearestElement(range.commonAncestorContainer)),
    region: null,
    source: sourceRef(range.commonAncestorContainer, sourceFile),
  };
}

/**
 * SPEC.md §6.4 — an anchor on a whole element: an image, an SVG, a table, a
 * code block.
 *
 * §6.4 leaves `quote` null here because §6.2 scopes layer 3 to "anything with
 * no text". Many anchorable elements do have text, though, and for those the
 * quote is the far stronger key — the milestone 0 run showed a `<pre>` resolved
 * through its positional CSS path landing on the wrong block once a section
 * above it was deleted. So the quote is recorded whenever there is one, and
 * `element` stays as the layer of last resort it was meant to be.
 */
export function createElementAnchor(
  index: TextIndex,
  el: Element,
  sourceFile: string | null,
): Anchor {
  const span = elementToOffsets(index, el);
  const position = span
    ? { start: span.start, end: Math.min(span.end, span.start + ELEMENT_QUOTE_MAX) }
    : null;

  return {
    quote: position
      ? {
          exact: index.text.slice(position.start, position.end),
          prefix: index.text.slice(Math.max(0, position.start - CONTEXT_CHARS), position.start),
          suffix: index.text.slice(
            position.end,
            Math.min(index.text.length, position.end + CONTEXT_CHARS),
          ),
        }
      : null,
    position,
    element: elementRef(el),
    region: null,
    source: sourceRef(el, sourceFile),
  };
}

/**
 * SPEC.md §6.4 — a dragged box inside an element, stored as fractions of its
 * bounding box so that it survives the element being resized.
 */
export function createRegionAnchor(
  index: TextIndex,
  el: Element,
  box: { x: number; y: number; w: number; h: number },
  sourceFile: string | null,
): Anchor {
  const rect = el.getBoundingClientRect();
  const region: RegionRef = {
    x: rect.width > 0 ? box.x / rect.width : 0,
    y: rect.height > 0 ? box.y / rect.height : 0,
    w: rect.width > 0 ? box.w / rect.width : 0,
    h: rect.height > 0 ? box.h / rect.height : 0,
  };
  return { ...createElementAnchor(index, el, sourceFile), region };
}
