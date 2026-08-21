// SPEC.md §6.3 — normalise the document's text and keep a two-way map back to
// the DOM. Everything else in §6 depends on this file being right.

import type { TextPosition } from "../../shared/types.ts";

/** Never contributes visible prose, so never enters the index (§6.3 rule 2). */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "DESC"]);

/**
 * `tagName` is upper-cased for HTML elements and left as written for SVG and
 * MathML ones, so an SVG `<style>` reports `"style"` and a plain `has()` misses
 * it. Measured on 2026-08-21: Mermaid's SVG carries about four thousand
 * characters of its own CSS in an inline `<style>`, and every one of them
 * entered the text index — shifting every anchor offset below the diagram and
 * making the CSS quotable as if it were the author's prose.
 */
function isSkipped(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName.toUpperCase());
}

/**
 * Marks REX's own overlay host. Its text must stay out of the index — if the UI
 * enters it, every offset shifts whenever the UI changes (§6.3 rule 2).
 */
export const REX_OVERLAY_ATTR = "data-rex-overlay";

export interface TextSegment {
  node: Text;
  /** Inclusive offset into `TextIndex.text`. */
  start: number;
  /** Exclusive offset into `TextIndex.text`. */
  end: number;
}

export interface TextIndex {
  /** Normalised document text: every whitespace run collapsed to one space. */
  text: string;
  segments: TextSegment[];
  /**
   * Per character of `text`, the offset range inside its owning node's raw
   * `data` that produced it. A collapsed whitespace run is one character here
   * and a span of several there, which is why a plain shift will not do.
   */
  rawStarts: Int32Array;
  rawEnds: Int32Array;
  /** The document the segments live in — Range construction needs it. */
  doc: Document;
}

const WHITESPACE = /\s/;

/** Walks `root`, collapsing whitespace, recording where every character came from. */
export function buildTextIndex(root: Node): TextIndex {
  const chunks: string[] = [];
  const segments: TextSegment[] = [];
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];
  let length = 0;
  // Tracks whether the last emitted character was a collapsed space, so a run
  // spanning a node boundary still yields exactly one space.
  let pendingSpace = false;

  const emitText = (node: Text): void => {
    const data = node.data;
    if (data.length === 0) return;
    const start = length;
    let out = "";

    for (let i = 0; i < data.length; ) {
      if (WHITESPACE.test(data[i])) {
        let j = i;
        while (j < data.length && WHITESPACE.test(data[j])) j++;
        // Leading whitespace at the very start of the document is dropped
        // (§6.3 rule 4); elsewhere a run becomes a single space, and a run
        // already represented by a previous node's space is dropped too.
        if (length + out.length > 0 && !pendingSpace) {
          out += " ";
          rawStarts.push(i);
          rawEnds.push(j);
          pendingSpace = true;
        }
        i = j;
        continue;
      }
      out += data[i];
      rawStarts.push(i);
      rawEnds.push(i + 1);
      pendingSpace = false;
      i++;
    }

    if (out.length === 0) return;
    chunks.push(out);
    length += out.length;
    segments.push({ node, start, end: length });
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      emitText(node as Text);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (isSkipped(el)) return;
      if (el.hasAttribute(REX_OVERLAY_ATTR)) return;

      if (el.tagName === "IFRAME") {
        // §6.3 rule 3 — tier 1 HTML renders in a same-origin iframe, so its
        // body is part of the document under review. A cross-origin one throws
        // on access and is simply not ours to index.
        try {
          const inner = (el as HTMLIFrameElement).contentDocument;
          if (inner) walk(inner);
        } catch {
          // Cross-origin: nothing to index.
        }
        return;
      }

      if (el.tagName === "SLOT") {
        for (const assigned of (el as HTMLSlotElement).assignedNodes()) walk(assigned);
        return;
      }

      // An open shadow root replaces the light children in what the user sees;
      // slotted content is reached through the <slot> branch above.
      if (el.shadowRoot) {
        walk(el.shadowRoot);
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };

  walk(root);

  return {
    text: chunks.join(""),
    segments,
    rawStarts: Int32Array.from(rawStarts),
    rawEnds: Int32Array.from(rawEnds),
    doc: ownerDocument(root),
  };
}

function ownerDocument(node: Node): Document {
  if (node.nodeType === Node.DOCUMENT_NODE) return node as Document;
  return node.ownerDocument ?? document;
}

/** Index of the segment containing `offset`, or -1. Segments are ordered. */
function segmentAt(index: TextIndex, offset: number): number {
  let lo = 0;
  let hi = index.segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = index.segments[mid];
    if (offset < seg.start) hi = mid - 1;
    else if (offset >= seg.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

type Side = "start" | "end";

/** Text offset for a raw offset inside one node's data. */
function rawToTextOffset(index: TextIndex, seg: TextSegment, raw: number, side: Side): number {
  for (let i = seg.start; i < seg.end; i++) {
    if (side === "start" ? index.rawEnds[i] > raw : index.rawStarts[i] >= raw) return i;
  }
  return seg.end;
}

/**
 * Text offset for a DOM boundary point. Boundaries inside an element (rather
 * than inside text) are snapped to the neighbouring indexed character.
 */
function pointToOffset(
  index: TextIndex,
  container: Node,
  offset: number,
  side: Side,
): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const i = index.segments.findIndex((s) => s.node === container);
    if (i !== -1) return rawToTextOffset(index, index.segments[i], offset, side);
  }

  const probe = index.doc.createRange();
  try {
    probe.setStart(container, offset);
  } catch {
    return null;
  }
  probe.collapse(true);

  if (side === "start") {
    for (const seg of index.segments) {
      // comparePoint < 0 means the node starts before the boundary.
      if (probe.comparePoint(seg.node, 0) >= 0) return seg.start;
    }
    return index.text.length;
  }
  for (let i = index.segments.length - 1; i >= 0; i--) {
    const seg = index.segments[i];
    if (probe.comparePoint(seg.node, seg.node.length) <= 0) return seg.end;
  }
  return 0;
}

/** Offsets spanned by everything indexed inside `el`, or null if it holds no text. */
export function elementToOffsets(index: TextIndex, el: Element): TextPosition | null {
  let start = -1;
  let end = -1;
  for (const seg of index.segments) {
    if (!el.contains(seg.node)) continue;
    if (start === -1) start = seg.start;
    end = seg.end;
  }
  return start === -1 ? null : { start, end };
}

/** SPEC.md §6.3 — Range → offsets in the normalised text. */
export function rangeToOffsets(index: TextIndex, range: Range): TextPosition | null {
  const start = pointToOffset(index, range.startContainer, range.startOffset, "start");
  const end = pointToOffset(index, range.endContainer, range.endOffset, "end");
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** SPEC.md §6.3 — offsets in the normalised text → a live Range. */
export function offsetsToRange(index: TextIndex, position: TextPosition): Range | null {
  const { start, end } = position;
  if (end <= start || start < 0 || end > index.text.length) return null;

  const startSeg = segmentAt(index, start);
  const endSeg = segmentAt(index, end - 1);
  if (startSeg === -1 || endSeg === -1) return null;

  const range = index.doc.createRange();
  range.setStart(index.segments[startSeg].node, index.rawStarts[start]);
  range.setEnd(index.segments[endSeg].node, index.rawEnds[end - 1]);
  return range;
}
