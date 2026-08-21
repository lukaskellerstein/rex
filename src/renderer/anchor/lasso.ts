// Spec 06 §5.3 — what a drawing selects.
//
// **A block is selected when its centre lies inside the drawing.** That is a
// lasso, it is what everyone expects a circle to mean, and it is predictable
// enough to aim with.
//
// The file is in two halves on purpose. `lassoSelect` is pure geometry over
// boxes — no DOM, no document — which is what lets `test/lasso.spec.ts` put
// fixture boxes in and read selected boxes out. `blocksInDrawing` is the thin
// DOM shell around it. Both are free of anything React, IPC or database shaped,
// so they run unchanged in the tier 1 iframe and in the tier 2 preload.

import { isAnchorableBlock, type ScopeRect, toDocumentRect } from "./pick.ts";

export interface Point {
  x: number;
  y: number;
}

/** One press-drag-release. A drawing may be several. */
export type Stroke = Point[];

/**
 * Every stroke's points, in one list.
 *
 * §5.3 — **the path is closed before the test.** A hand-drawn circle never
 * quite meets itself, and a gap of a few pixels must not change the answer. No
 * closing point is appended because the even-odd test below already treats the
 * last point as joined to the first; that *is* the closing.
 */
export function polygonOf(strokes: ReadonlyArray<Stroke>): Point[] {
  return strokes.flat();
}

export function boundsOf(points: ReadonlyArray<Point>): ScopeRect | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Even-odd ray casting: count how many edges a ray to the right crosses.
 *
 * The `(j = i, i = i + 1)` wrap is what closes the path — the edge from the
 * last point back to the first is tested like any other, so an open circle and
 * a closed one give the same answer.
 */
export function pointInPolygon(polygon: ReadonlyArray<Point>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    // Strictly one of the two must be below and one above, so a vertex exactly
    // on the ray is counted once rather than twice.
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function intersects(a: ScopeRect, b: ScopeRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function encloses(outer: ScopeRect, inner: ScopeRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

export interface LassoCandidate<T> {
  value: T;
  box: ScopeRect;
}

/**
 * §5.3 steps 1–5, over boxes rather than elements.
 *
 * `candidates` must arrive in document order; the order is preserved, which is
 * step 5. `contains` answers step 4 — for the DOM it is `Node.contains`, and for
 * a fixture it is box containment.
 */
export function lassoSelect<T>(
  polygon: ReadonlyArray<Point>,
  candidates: ReadonlyArray<LassoCandidate<T>>,
  contains: (outer: T, inner: T) => boolean,
): T[] {
  const bounds = boundsOf(polygon);
  if (!bounds || polygon.length < 3) return [];

  const kept = candidates.filter((candidate) => {
    if (!intersects(candidate.box, bounds)) return false;
    // A block that swallows the whole drawing is the thing you drew *inside*,
    // not a thing you circled — it is the floor of §5.3, reached only when
    // nothing was enclosed. Without this a section whose centre happens to fall
    // in the circle would eat every paragraph the reviewer actually meant.
    if (encloses(candidate.box, bounds)) return false;
    return pointInPolygon(
      polygon,
      candidate.box.x + candidate.box.w / 2,
      candidate.box.y + candidate.box.h / 2,
    );
  });

  // §5.3 step 4 — the outermost match wins. A table inside a circle is one
  // thing, not fifteen; the same dedupe `changedBlocks()` performs for Apply.
  return kept
    .filter(
      (candidate) =>
        !kept.some((other) => other !== candidate && contains(other.value, candidate.value)),
    )
    .map((candidate) => candidate.value);
}

// ── The DOM shell ───────────────────────────────────────────────

/** Every block the lasso may take, in document order, with its box. */
function candidatesIn(view: Window, doc: Document): Array<LassoCandidate<Element>> {
  const found: Array<LassoCandidate<Element>> = [];
  // `querySelectorAll("*")` is already document order, which is step 5.
  for (const el of doc.body?.querySelectorAll("*") ?? []) {
    if (!isAnchorableBlock(el)) continue;
    const box = toDocumentRect(view, el.getBoundingClientRect());
    if (box.w <= 0 || box.h <= 0) continue;
    found.push({ value: el, box });
  }
  return found;
}

/** §5.3 — the blocks a drawing encloses, in document order. */
export function blocksInDrawing(
  view: Window,
  doc: Document,
  strokes: ReadonlyArray<Stroke>,
): Element[] {
  return lassoSelect(polygonOf(strokes), candidatesIn(view, doc), (outer, inner) =>
    outer.contains(inner),
  );
}

/**
 * §5.3 — the floor, for when the circle encloses nothing.
 *
 * A circle round a chart, an arrow in a margin, a ring round one cell of a
 * bitmap: none of these has a block with its centre inside. The pen must still
 * produce something, because refusing a gesture the reviewer clearly meant is
 * worse than answering it imprecisely. You drew inside something; that
 * something, cropped to where you drew, is the honest answer.
 *
 * The **smallest** such element, so a ring inside a chart names the chart
 * rather than the section around it. `<body>` is the last resort and never a
 * preference — in a PDF this lands on the page, which is precisely what spec 03
 * §7.3 says a PDF comment should be.
 */
export function containerOfDrawing(
  view: Window,
  doc: Document,
  strokes: ReadonlyArray<Stroke>,
): Element | null {
  const bounds = boundsOf(polygonOf(strokes));
  if (!bounds) return null;

  let best: Element | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const { value, box } of candidatesIn(view, doc)) {
    if (!encloses(box, bounds)) continue;
    const area = box.w * box.h;
    if (area < bestArea) {
      best = value;
      bestArea = area;
    }
  }
  return best ?? doc.body ?? null;
}
