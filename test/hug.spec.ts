// The outline of a passage, as a unit.
//
// This is asserted rather than looked at for the reason anchoring is: a wrong
// shape still draws SOMETHING. A path whose walk back up the right-hand side
// is in the wrong order is a bow-tie that renders as two filled triangles over
// the prose, and a path that never steps sideways is the bug this file was
// written for — the full-width box over two half-selected lines, reported
// 2026-09-02 with a screenshot.
//
// So the test measures the polygon instead of reading it. The area a closed
// path encloses is the one number that says "this covers the selected lines
// and nothing else", and the shoelace formula gives it from the path string
// itself — the same string the browser is handed.
//
// The lines below are 22px apart because that is what a 20px line of prose
// plus `hugOf`'s 1px of padding above and below comes to, so the bands meet
// exactly and the arithmetic stays readable. Real lines meet or overlap by a
// pixel or two, which is what `hugOf` closes the seam for.
//
// No DOM. `hugOf` takes boxes and returns strings; measuring the DOM is
// `lineRectsOf` in `pick.ts`.
//
// Run: npm run test:hug

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ScopeRect } from "../src/renderer/anchor/pick.ts";
import { hugOf } from "../src/renderer/overlay/hug.ts";

/** One line of text, at the size Markdown renders prose at. */
function line(x: number, y: number, w: number): ScopeRect {
  return { x, y, w, h: 20 };
}

/**
 * The path's corners, in order.
 *
 * `hugOf` writes only `M`, `V`, `H` and `Z`, so the walk is a matter of
 * carrying the coordinate the command does not name.
 */
function corners(path: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const tokens = path.split(/\s+/);
  let x = 0;
  let y = 0;
  for (let at = 0; at < tokens.length; at += 1) {
    if (tokens[at] === "M") {
      x = Number(tokens[at + 1]);
      y = Number(tokens[at + 2]);
      at += 2;
    } else if (tokens[at] === "V") {
      y = Number(tokens[at + 1]);
      at += 1;
    } else if (tokens[at] === "H") {
      x = Number(tokens[at + 1]);
      at += 1;
    } else {
      continue;
    }
    points.push([x, y]);
  }
  return points;
}

/** The area a closed polygon encloses. A bow-tie's two lobes cancel out. */
function area(points: Array<[number, number]>): number {
  let sum = 0;
  for (let at = 0; at < points.length; at += 1) {
    const [x1, y1] = points[at] ?? [0, 0];
    const [x2, y2] = points[(at + 1) % points.length] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** What the lines themselves cover, once `hugOf` has padded them. */
function padded(lines: ScopeRect[]): number {
  return lines.reduce((total, box) => total + (box.w + 4) * (box.h + 2), 0);
}

test("no lines is no shape", () => {
  assert.equal(hugOf([]), null);
});

test("one line is a rectangle round that line", () => {
  const one = line(100, 40, 300);
  const hug = hugOf([one]);
  assert.ok(hug);
  assert.equal(hug.paths.length, 1);
  // 2px of padding either side, 1px above and below, and the stroke's own 2px
  // outside all of it.
  assert.equal(hug.box.x, 100 - 2 - 2);
  assert.equal(hug.box.y, 40 - 1 - 2);
  assert.equal(hug.box.w, 300 + 4 + 4);
  assert.equal(hug.box.h, 20 + 2 + 4);
  assert.equal(area(corners(hug.paths[0] ?? "")), padded([one]));
});

test("a passage that starts mid-line does not cover the line it starts in", () => {
  // The reported case: the first line is selected from halfway along, the
  // second from its start. The box this replaces spanned 100..1500 over BOTH.
  const lines = [line(700, 40, 800), line(100, 62, 500)];
  const hug = hugOf(lines);
  assert.ok(hug);
  assert.equal(hug.paths.length, 1, "two touching lines are one shape");

  const shape = corners(hug.paths[0] ?? "");
  assert.equal(
    area(shape),
    padded(lines),
    "the shape covers the two lines and nothing else — a box round both would be 1400 wide",
  );

  // And the specific claim the screenshot was about: nothing is drawn to the
  // left of where the passage starts, at the height it starts at.
  const top = Math.min(...shape.map(([, y]) => y));
  const start = 700 - 2 - hug.box.x;
  assert.ok(
    shape.filter(([, y]) => y === top).every(([x]) => x >= start),
    "no corner of the first line's top edge reaches back into the unselected text",
  );
});

test("a passage across a paragraph break is two shapes, not one bridge", () => {
  // 68px of white space between them: bridging it would outline a paragraph
  // gap that holds none of the selection.
  const hug = hugOf([line(100, 40, 900), line(100, 130, 400)]);
  assert.ok(hug);
  assert.equal(hug.paths.length, 2);
});

test("three lines walk down every left edge and back up every right one", () => {
  const lines = [line(600, 40, 900), line(100, 62, 1400), line(100, 84, 300)];
  const hug = hugOf(lines);
  assert.ok(hug);
  assert.equal(hug.paths.length, 1);
  const shape = corners(hug.paths[0] ?? "");
  assert.equal(area(shape), padded(lines), "a bow-tie would measure smaller than the lines do");
  // Four corners per line, plus the start, which the walk returns to.
  assert.equal(shape.length, lines.length * 4 + 1);
});
