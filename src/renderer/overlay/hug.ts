// The outline of a passage: a shape that follows the text, not a box round it.
//
// THE RULE THIS FILE EXISTS FOR. A selection that starts halfway along a line
// and ends on the next one is two partial lines, and the smallest rectangle
// holding both is the full width of both — so an outline drawn from that
// rectangle says the comment is about text the reviewer never selected.
// Reported 2026-09-02 against a Markdown list, where the box swallowed the
// list markers and the whole of the line the selection started in the middle
// of.
//
// So the outline is built from one box per line (`lineRectsOf`) and drawn as a
// single closed path down the left edges and back up the right ones — the same
// staircase every text selection anywhere is drawn as. One path, not one box
// per line, because the number badge claims this is ONE place; three stacked
// dashed boxes say three.
//
// A place that IS a box — a table, a figure, a region cut out of an image —
// never comes here. There the rectangle is the thing itself, and hugging it
// would be drawing a shape around a shape.

import type { ScopeRect } from "../anchor/pick.ts";

/** Breathing room round the glyphs, so the dashed edge is not on the text. */
const PAD_X = 2;
const PAD_Y = 1;

/** Half the stroke, so a 2px dash on the outermost edge is not clipped away. */
const STROKE = 2;

/**
 * How far two lines may be apart and still be drawn as one shape.
 *
 * Consecutive lines of a paragraph touch or nearly touch, and the small gap
 * between them is closed (see `snap`) so the shape has no seam. A paragraph
 * break is much larger than one line's own height, and bridging it would draw
 * the outline around white space that holds no selected text at all — so the
 * passage becomes two shapes, which is what it looks like on the page.
 */
const JOIN = 0.75;

/** What `PaneMarks` needs to draw one place. All of it relative to `box`. */
export interface Hug {
  /** Where the shape sits in document coordinates, stroke included. */
  box: ScopeRect;
  /** One closed SVG path per run of touching lines. */
  paths: string[];
}

interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Lines into padded bands, in the order they are read. */
function bandsOf(lines: ScopeRect[]): Band[] {
  return lines
    .map((line) => ({
      left: line.x - PAD_X,
      right: line.x + line.w + PAD_X,
      top: line.y - PAD_Y,
      bottom: line.y + line.h + PAD_Y,
    }))
    .sort((a, b) => a.top - b.top);
}

/**
 * Bands split into the groups that are drawn as one shape, with the gap inside
 * a group closed.
 *
 * Closing it matters: a 1px seam between two bands leaves the dashed edge
 * showing a horizontal rule through the middle of the passage, which reads as
 * a boundary the reviewer did not draw.
 */
function group(bands: Band[]): Band[][] {
  const groups: Band[][] = [];
  let current: Band[] = [];
  for (const band of bands) {
    const last = current.at(-1);
    if (last && band.top - last.bottom > (last.bottom - last.top) * JOIN) {
      groups.push(current);
      current = [];
    }
    const previous = current.at(-1);
    if (previous) {
      const seam = (previous.bottom + band.top) / 2;
      previous.bottom = seam;
      band.top = seam;
    }
    current.push(band);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * One group of touching bands as a closed path: down every left edge, across
 * the foot, then back up every right edge.
 *
 * The bands share their horizontal edges after `snap`, so each step down the
 * left side is a vertical line then a horizontal one, and the result is a
 * simple polygon whatever the lines' widths are — including the common case
 * where the last line is far shorter than the ones above it.
 */
function pathOf(bands: Band[], first: Band, originX: number, originY: number): string {
  const x = (value: number): number => Math.round((value - originX) * 100) / 100;
  const y = (value: number): number => Math.round((value - originY) * 100) / 100;

  const steps: string[] = [`M ${x(first.left)} ${y(first.top)}`];
  // Down the left edges. Each band drops to its own foot, then steps sideways
  // to where the next line starts — which is the whole point: the step is what
  // makes the shape follow a passage that begins mid-line.
  bands.forEach((band, at) => {
    const next = bands[at + 1];
    steps.push(`V ${y(band.bottom)}`, `H ${x(next ? next.left : band.right)}`);
  });
  // And back up the right edges, the same walk in reverse.
  const upward = [...bands].reverse();
  upward.forEach((band, at) => {
    const next = upward[at + 1];
    steps.push(`V ${y(band.top)}`, `H ${x(next ? next.right : band.left)}`);
  });
  steps.push("Z");
  return steps.join(" ");
}

/**
 * The shape for one passage, or null when there is nothing to draw.
 *
 * Every coordinate in `paths` is relative to `box`, so the caller positions one
 * element and lets the SVG hold the geometry — the same thing it already does
 * with a place that is a plain rectangle.
 */
export function hugOf(lines: ScopeRect[]): Hug | null {
  if (lines.length === 0) return null;
  const groups = group(bandsOf(lines));
  if (groups.length === 0) return null;

  const flat = groups.flat();
  const left = Math.min(...flat.map((band) => band.left)) - STROKE;
  const top = Math.min(...flat.map((band) => band.top)) - STROKE;
  const right = Math.max(...flat.map((band) => band.right)) + STROKE;
  const bottom = Math.max(...flat.map((band) => band.bottom)) + STROKE;

  const paths: string[] = [];
  for (const bands of groups) {
    const first = bands[0];
    if (first) paths.push(pathOf(bands, first, left, top));
  }

  return { box: { x: left, y: top, w: right - left, h: bottom - top }, paths };
}
