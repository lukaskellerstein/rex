// Spec 35 §2.3 — a place's line on the card, as cells.
//
// Run: npm run test:place-line

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NO_FACTS, placeCells } from "../src/renderer/overlay/placeLine.ts";
import type { Anchor } from "../src/shared/types.ts";

function anchor(extra: Partial<Anchor> = {}): Anchor {
  return { quote: null, position: null, element: null, region: null, source: null, ...extra };
}

const at = (line: number): Anchor["source"] => ({ file: "/w/a.md", line });

test("a section: a range, a count and the kind", () => {
  const cells = placeCells(
    anchor({ extent: "section", source: at(794) }),
    { label: "Section · “7. The change set has no defined form”", line: 794, lineEnd: 812 },
    "ok",
  );
  assert.deepEqual(cells, {
    where: "L794–812",
    whole: false,
    size: "19 lines",
    kind: "section",
    was: null,
    unchecked: false,
  });
});

test("one table row is one line, and says which kind of row", () => {
  const cells = placeCells(
    anchor({ source: at(954) }),
    { label: "Row 3 · “waiting”", line: 954, lineEnd: 954 },
    "ok",
  );
  assert.equal(cells.where, "L954");
  assert.equal(cells.size, "1 line");
  assert.equal(cells.kind, "table row");
});

test("the whole file: no range, its length as the size, no kind", () => {
  const cells = placeCells(
    anchor({ extent: "document", source: at(1) }),
    { label: "The whole document", line: 1, lineEnd: 1018 },
    "ok",
  );
  assert.deepEqual(cells, {
    where: null,
    whole: true,
    size: "1018 lines",
    kind: null,
    was: null,
    unchecked: false,
  });
  // An anchor written before spec 06 has no extent; its label still says it.
  assert.equal(
    placeCells(anchor(), { label: "The whole document", line: 1, lineEnd: 40 }, "ok").whole,
    true,
  );
});

test("prose has no label and is a passage", () => {
  const cells = placeCells(
    anchor({
      quote: { exact: "Only the third has mutable state.", prefix: "", suffix: "" },
      source: at(41),
    }),
    { label: null, line: 41, lineEnd: 44 },
    "ok",
  );
  assert.equal(cells.kind, "passage");
  assert.equal(cells.where, "L41–44");
  assert.equal(cells.size, "4 lines");
});

test("a moved place says where it was — only once the sweep has seen it", () => {
  const seen = placeCells(
    anchor({ source: at(37) }),
    { label: null, line: 41, lineEnd: 44 },
    "moved",
  );
  assert.equal(seen.was, 37);
  const unseen = placeCells(anchor({ source: at(37) }), NO_FACTS, null);
  assert.equal(unseen.was, null);
});

test("a place nobody looked at keeps its stored line and says so", () => {
  const cells = placeCells(anchor({ extent: "section", source: at(245) }), NO_FACTS, null);
  assert.deepEqual(cells, {
    where: "L245",
    whole: false,
    size: null,
    kind: "section",
    was: null,
    unchecked: true,
  });
});

test("a lost place keeps its stored line; the mark is the caller's", () => {
  // The sweep found nothing, so `facts` is empty and the state says lost.
  const cells = placeCells(
    anchor({ source: at(954) }),
    { label: null, line: null, lineEnd: null },
    "orphaned",
  );
  assert.equal(cells.where, "L954");
  assert.equal(cells.unchecked, false);
  assert.equal(cells.size, null);
});

test("a page or a slide is the where-cell when there are no lines", () => {
  assert.equal(
    placeCells(anchor(), { label: "Page 3", line: null, lineEnd: null }, "ok").where,
    "page 3",
  );
  assert.equal(
    placeCells(anchor(), { label: "Page 3", line: null, lineEnd: null }, "ok").kind,
    "page",
  );
  assert.equal(
    placeCells(anchor(), { label: "Slide 4 · “Roadmap”", line: null, lineEnd: null }, "ok").where,
    "slide 4",
  );
  // An HTML figure: no line, no page — the kind alone.
  const figure = placeCells(
    anchor(),
    { label: "Figure · “Latency”", line: null, lineEnd: null },
    "ok",
  );
  assert.equal(figure.where, null);
  assert.equal(figure.kind, "figure");
});

test("the kind comes from the label's head, in lower case", () => {
  const kind = (label: string) => placeCells(anchor(), { label, line: 5, lineEnd: 9 }, "ok").kind;
  assert.equal(kind("Table · 3 rows × 4 columns"), "table");
  assert.equal(kind("Code block"), "code block");
  assert.equal(kind("Cell · row 2, “State”"), "table cell");
  assert.equal(kind("Region of Table · x 0.10 · w 0.40"), "region");
  assert.equal(kind("Node · “WMS”"), "node");
});

test("a gap is a gap whatever is beside it, and has no size", () => {
  const cells = placeCells(
    anchor({
      gap: { after: null, before: null } as unknown as NonNullable<Anchor["gap"]>,
      source: at(120),
    }),
    { label: "between “Intro” and “Scope”", line: 120, lineEnd: null },
    "ok",
  );
  assert.equal(cells.kind, "gap");
  assert.equal(cells.where, "L120");
  assert.equal(cells.size, null);
});
