// Spec 06 §10 milestone 5 — the lasso, as a unit.
//
// No browser, no document, no UI: `lassoSelect` is a pure function of a polygon
// and a list of boxes, which is exactly why §5.3 was written as steps over
// boxes rather than as a DOM walk. The geometry is the part that can be
// silently wrong — a circle that quietly takes the wrong paragraph looks like a
// circle that worked — so it is the part with a test that reads the answer
// rather than asserting that one exists.
//
// Run: npm run test:lasso

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  boundsOf,
  lassoSelect,
  type Point,
  pointInPolygon,
  polygonOf,
} from "../src/renderer/anchor/lasso.ts";
import type { ScopeRect } from "../src/renderer/anchor/pick.ts";

interface Box {
  id: string;
  box: ScopeRect;
}

/** Fixture containment: a box contains another when it encloses it and differs. */
function contains(outer: Box, inner: Box): boolean {
  return (
    outer !== inner &&
    outer.box.x <= inner.box.x &&
    outer.box.y <= inner.box.y &&
    outer.box.x + outer.box.w >= inner.box.x + inner.box.w &&
    outer.box.y + outer.box.h >= inner.box.y + inner.box.h
  );
}

function select(polygon: Point[], boxes: Box[]): string[] {
  return lassoSelect(
    polygon,
    boxes.map((value) => ({ value, box: value.box })),
    contains,
  ).map((b) => b.id);
}

/** A rough circle of `sides` points. `open` leaves a gap where it should close. */
function circle(cx: number, cy: number, r: number, sides = 24, open = false): Point[] {
  const points: Point[] = [];
  const stop = open ? sides - 3 : sides;
  for (let i = 0; i < stop; i++) {
    const angle = (i / sides) * Math.PI * 2;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}

const rect = (id: string, x: number, y: number, w: number, h: number): Box => ({
  id,
  box: { x, y, w, h },
});

// Three blocks stacked, as a rendered Markdown document lays them out.
const PARAGRAPHS = [
  rect("p1", 100, 100, 400, 40),
  rect("p2", 100, 160, 400, 40),
  rect("p3", 100, 900, 400, 40),
];

test("a block is selected when its centre lies inside the drawing", () => {
  const drawn = circle(300, 150, 120);
  assert.deepEqual(select(drawn, PARAGRAPHS), ["p1", "p2"]);
});

test("an open circle selects what a closed one does", () => {
  const closed = circle(300, 150, 120, 24, false);
  const open = circle(300, 150, 120, 24, true);

  // §5.3 — a hand-drawn circle never quite meets itself, and a gap of a few
  // pixels must not change the answer.
  assert.deepEqual(select(open, PARAGRAPHS), select(closed, PARAGRAPHS));
  assert.deepEqual(select(open, PARAGRAPHS), ["p1", "p2"]);
});

test("a td, its tr and its table all inside yield only the table", () => {
  const table = rect("table", 100, 100, 400, 120);
  const row = rect("tr", 100, 140, 400, 40);
  const cell = rect("td", 100, 140, 100, 40);
  const drawn = circle(300, 160, 300);

  // All three centres are inside, so all three survive the point test; only the
  // outermost may reach the panel. A table inside a circle is one thing, not
  // fifteen.
  assert.deepEqual(select(drawn, [table, row, cell]), ["table"]);
});

test("results come back in document order", () => {
  // Handed to the lasso out of order; it must answer in the order it was given,
  // which is the order the document lays them out.
  const jumbled = [PARAGRAPHS[1], PARAGRAPHS[0]];
  const drawn = circle(300, 150, 120);
  assert.deepEqual(
    lassoSelect(
      drawn,
      // Rebuilt in document order, as the DOM walk supplies them.
      [PARAGRAPHS[0], PARAGRAPHS[1]].map((value) => ({ value, box: value.box })),
      contains,
    ).map((b) => b.id),
    ["p1", "p2"],
  );
  // And the jumbled list answers in *its* order, proving the order is the
  // caller's rather than something this function invents.
  assert.deepEqual(select(drawn, jumbled), ["p2", "p1"]);
});

test("an empty circle yields none", () => {
  // Drawn in the gutter, left of every block.
  const drawn = circle(40, 150, 25);
  assert.deepEqual(select(drawn, PARAGRAPHS), []);
});

test("a block that swallows the whole drawing is not selected by it", () => {
  // §5.3 — you drew *inside* the figure; the figure is the floor, reached only
  // when nothing was enclosed, never a thing the circle picked up. Without this
  // rule the containment dedupe would then drop the paragraphs for it.
  const figure = rect("figure", 0, 0, 1000, 1000);
  const drawn = circle(300, 150, 120);
  assert.deepEqual(select(drawn, [figure, ...PARAGRAPHS]), ["p1", "p2"]);
});

test("a degenerate drawing selects nothing", () => {
  // A tap rather than a drag: two points cannot enclose anything, and a polygon
  // of fewer than three is not a shape.
  assert.deepEqual(select([{ x: 300, y: 150 }], PARAGRAPHS), []);
  assert.deepEqual(select([], PARAGRAPHS), []);
});

test("several strokes are one polygon", () => {
  // §5.1 — a drawing may be several strokes: a circle plus an arrow, or a shape
  // drawn in two goes.
  const halves = [circle(300, 150, 120).slice(0, 12), circle(300, 150, 120).slice(12)];
  assert.deepEqual(select(polygonOf(halves), PARAGRAPHS), ["p1", "p2"]);
});

test("bounds and the point test agree about the obvious cases", () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.deepEqual(boundsOf(square), { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(pointInPolygon(square, 5, 5), true);
  assert.equal(pointInPolygon(square, 15, 5), false);
  assert.equal(boundsOf([]), null);
});
