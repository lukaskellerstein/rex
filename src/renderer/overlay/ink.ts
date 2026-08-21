// Spec 06 §5.4 — where a drawing's ink lives, and how it gets back onto the
// page.
//
// The whole of the design is one sentence: **the ink is stored as fractions of
// the union box of the comment's targets.** Pixels fail on the first window
// resize. Fractions of one element fail as soon as the drawing spans more than
// that element. Fractions of the union box are self-correcting — resolve the
// targets, take the union of their boxes now, and map the stored fractions onto
// it, so when the paragraphs reflow the ink reflows with them.
//
// Getting this wrong makes the ink drift off the thing it was drawn around,
// which is the one failure a reviewer would not notice.

import type { StrokeRef } from "../../shared/types.ts";
import type { Point, Stroke } from "../anchor/lasso.ts";
import type { ScopeRect } from "../anchor/pick.ts";
import { unionRect } from "../anchor/pick.ts";

/**
 * A box measured at one zoom, drawn at another.
 *
 * Spec 05 §6 — a selection outlives a zoom change, and reading a table closely
 * before deciding whether the fourth row belongs is exactly when someone zooms.
 */
export function rescaleRect(rect: ScopeRect, by: number): ScopeRect {
  return by === 1 ? rect : { x: rect.x * by, y: rect.y * by, w: rect.w * by, h: rect.h * by };
}

export function unionOfRects(rects: ReadonlyArray<ScopeRect | null>): ScopeRect | null {
  let union: ScopeRect | null = null;
  for (const rect of rects) {
    if (!rect) continue;
    union = union ? unionRect(union, rect) : rect;
  }
  return union;
}

/** A box with no area cannot be divided by; a fraction of it means nothing. */
function measurable(box: ScopeRect): boolean {
  return box.w > 0 && box.h > 0;
}

/**
 * Strokes into the form that is stored.
 *
 * They arrive in **document coordinates at the zoom on screen** — the surface
 * converts them there (`targetsFromDrawingIn`), because only it holds the
 * document. The union box is in the same space, so the division is a ratio and
 * the zoom drops out and never comes back.
 */
export function strokeRefFrom(
  strokes: ReadonlyArray<Stroke>,
  union: ScopeRect,
  width: number,
): StrokeRef | null {
  if (!measurable(union) || strokes.length === 0) return null;
  return {
    paths: strokes.map((stroke) =>
      stroke.map((point) => ({
        x: (point.x - union.x) / union.w,
        y: (point.y - union.y) / union.h,
      })),
    ),
    width,
  };
}

/**
 * The stored fractions, back onto the page as it is drawn now.
 *
 * Deliberately approximate after an edit: if a paragraph inside the circle
 * grows by two lines the union box grows and the stroke stretches, so it no
 * longer traces exactly what was drawn. That is the correct failure — the
 * drawing is a record of a gesture, not a measurement, and the *targets* are
 * what carry the comment's meaning. Ink that stayed at its original pixels
 * while the text moved would be far worse: it would point confidently at the
 * wrong paragraph.
 */
export function pointsOfStroke(stroke: StrokeRef, union: ScopeRect): Point[][] {
  if (!measurable(union)) return [];
  return stroke.paths.map((path) =>
    path.map((point) => ({
      x: union.x + point.x * union.w,
      y: union.y + point.y * union.h,
    })),
  );
}
