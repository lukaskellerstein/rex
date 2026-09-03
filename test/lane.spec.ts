// Spec 16 §9.1 — the bar lane never covers the first letter of a line.
//
// This is asserted rather than looked at because it fails by a hair and only at
// some zooms. Reported 2026-09-02 with a screenshot: at 90% zoom the paper's
// 24px side margin renders as 21.6 pane pixels, the lane is chrome and still
// ends at 22, and the first letter of every paragraph disappears under a blue
// bar. Nothing logs, nothing is misplaced, and the document simply reads wrong.
//
// Two halves, because the bug had two halves:
//
//   - the arithmetic in `marginLane.ts`, which used to clamp the lane count to
//     one and draw over the text in exactly the case the clamp exists for;
//   - the paper's own margin, which now counter-scales with the zoom. That half
//     cannot be reasoned about — whether CSS `zoom` scales a px custom property
//     used in `padding` is a browser question — so it is measured in a real
//     browser, at the four zooms the strip offers.
//
// The measurement is `getBoundingClientRect().left` inside the frame, which is
// the same number `MarginBars` compares its lane against (see `applyZoom` on
// why `zoom` and not `transform`).
//
// Run: npm run test:lane

import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { MARKDOWN_STYLESHEET } from "../src/main/render/stylesheet.ts";
import { inflateRect, type ScopeRect } from "../src/renderer/anchor/pick.ts";
import {
  BAR_W,
  LANE_MARGIN,
  LANE_RESERVE,
  LANE_STEP,
  LANE_X,
  laneGeometry,
  MARK_REACH,
  OUTLINE_GAP,
} from "../src/renderer/overlay/marginLane.ts";

/** The 2px `.rex-block-outline` draws, inside the box `PaneMarks` gives it. */
const OUTLINE_BORDER = MARK_REACH - OUTLINE_GAP;

// ── The arithmetic ──────────────────────────────────────────────

test("the ring is drawn outside the block, never on it", () => {
  const block: ScopeRect = { x: 100, y: 200, w: 400, h: 60 };
  const ring = inflateRect(block, MARK_REACH);
  // `box-sizing: border-box`, so the border is inside the box PaneMarks sets.
  const inner = {
    left: ring.x + OUTLINE_BORDER,
    right: ring.x + ring.w - OUTLINE_BORDER,
    top: ring.y + OUTLINE_BORDER,
    bottom: ring.y + ring.h - OUTLINE_BORDER,
  };
  assert.equal(block.x - inner.left, OUTLINE_GAP, "clear paper on the left");
  assert.equal(inner.right - (block.x + block.w), OUTLINE_GAP, "and the same on the right");
  assert.equal(block.y - inner.top, OUTLINE_GAP);
  assert.equal(inner.bottom - (block.y + block.h), OUTLINE_GAP);
});

test("with room to spare the lane sits where spec 15 §8.2 put it", () => {
  const lane = laneGeometry(100);
  assert.equal(lane.x, LANE_X);
  // Every lane that fits, and the last of them still clear of the ring.
  assert.equal(lane.lanes, 4);
  assert.ok(lane.x + (lane.lanes - 1) * LANE_STEP + BAR_W + LANE_MARGIN <= 100 - MARK_REACH);
});

test("the paper's own margin holds the lane and the ring, exactly", () => {
  const lane = laneGeometry(LANE_RESERVE);
  assert.equal(lane.x, LANE_X);
  assert.equal(lane.lanes, 1);
  assert.equal(lane.x + BAR_W + LANE_MARGIN + MARK_REACH, LANE_RESERVE);
});

test("a margin too narrow for the lane slides it left instead of over the text", () => {
  // 21.6px is the reported case: a 24px margin at 90% zoom, before the paper
  // knew about the lane. The old code returned x=4 and drew over the letters.
  const lane = laneGeometry(21.6);
  assert.ok(lane.x < LANE_X, "the lane moved");
  assert.ok(lane.x + BAR_W <= 21.6, "and it is no longer over the prose");
  assert.equal(lane.lanes, 1);
});

test("the lane stops at the pane's edge and never leaves it", () => {
  const lane = laneGeometry(6);
  assert.equal(lane.x, 0);
  assert.equal(lane.lanes, 1);
});

test("no bars means no measurement, and the lane keeps its default", () => {
  const lane = laneGeometry(Number.NaN);
  assert.deepEqual(lane, { x: LANE_X, lanes: 1 });
});

// ── The paper ───────────────────────────────────────────────────

/** The four steps the paper strip offers, plus 1. */
const ZOOMS = [1, 0.9, 0.75, 0.5];

/**
 * The pane the paper has to fill, before `zoom` is applied to it.
 *
 * The half-pane case §9.1 is written for is the only one where the lane can run
 * out of paper: wider than this the measure caps the body, `margin: 0 auto`
 * centres it, and the left margin is far more than any lane wants. So the
 * viewport is scaled with the zoom, which holds the pane at this width in the
 * document's own pixels and keeps the body filling it at every step.
 */
const PANE = 360;

/**
 * Where a paragraph's first letter starts, in the PANE's pixels, at one zoom.
 *
 * `reserve` false is the paper as it was before this fix: no `--rex-lane`, so
 * the stylesheet falls back to a flat 24px.
 */
async function textLeftAt(
  page: import("playwright").Page,
  zoom: number,
  reserve: boolean,
): Promise<number> {
  await page.setViewportSize({ width: Math.round(PANE * zoom), height: 900 });
  return page.evaluate(
    ([zoom, reserve, reserved]) => {
      const root = document.documentElement;
      root.style.zoom = String(zoom);
      if (reserve === 1) root.style.setProperty("--rex-lane", `${reserved / zoom}px`);
      else root.style.removeProperty("--rex-lane");
      return document.querySelector("p")?.getBoundingClientRect().left ?? Number.NaN;
    },
    [zoom, reserve ? 1 : 0, LANE_RESERVE],
  );
}

test("the paper leaves the lane its room at every zoom", async (t) => {
  const html = `<!doctype html><html lang="en" data-rex-paper><head><meta charset="utf-8">
<style>${MARKDOWN_STYLESHEET}</style></head><body>
<h2>Proposal</h2>
<p>An increase in the number of guarantees the design can make.</p>
</body></html>`;
  const file = join(tmpdir(), `rex-lane-${process.pid}.html`);
  writeFileSync(file, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: PANE, height: 900 } });
    await page.goto(pathToFileURL(file).href);

    for (const zoom of ZOOMS) {
      const textLeft = await textLeftAt(page, zoom, true);
      const lane = laneGeometry(textLeft);
      await t.test(`zoom ${zoom}`, () => {
        assert.ok(
          textLeft >= LANE_RESERVE - 0.5,
          `the paper left ${textLeft}px, and the lane needs ${LANE_RESERVE}px`,
        );
        assert.equal(lane.x, LANE_X, "so the lane never has to slide");
        assert.ok(lane.x + BAR_W + LANE_MARGIN <= textLeft + 0.5, "and clear paper is left");
      });
    }

    await t.test("the reported bug, against the paper that had it", async () => {
      const textLeft = await textLeftAt(page, 0.9, false);
      assert.ok(Math.abs(textLeft - 21.6) < 0.5, `24px at 90% zoom is ${textLeft}px`);
      assert.ok(LANE_X + BAR_W > textLeft, "the fixed lane ended past the first letter");
      // What the slide does about it, for the formats REX does not typeset.
      assert.ok(laneGeometry(textLeft).x + BAR_W <= textLeft, "the slide still clears it");
    });

    // Spec 27 §4.3 — `wide` drops the measure, so the body fills the pane at
    // EVERY width and its padding is the left margin however wide the window
    // is. It is the setting the bug was reported under, and the one where a
    // wide window is no protection at all.
    await t.test("the width switch on, in a pane wide enough to centre", async () => {
      await page.evaluate(() => document.documentElement.toggleAttribute("data-rex-wide", true));
      try {
        await page.setViewportSize({ width: 900, height: 900 });
        const before = await page.evaluate(() => {
          document.documentElement.style.zoom = "0.9";
          document.documentElement.style.removeProperty("--rex-lane");
          return document.querySelector("p")?.getBoundingClientRect().left ?? Number.NaN;
        });
        assert.ok(Math.abs(before - 21.6) < 0.5, `the paper left ${before}px`);

        const after = await textLeftAt(page, 0.9, true);
        assert.ok(after >= LANE_RESERVE - 0.5, `the paper now leaves ${after}px`);
        assert.equal(laneGeometry(after).x, LANE_X);
      } finally {
        await page.evaluate(() => document.documentElement.removeAttribute("data-rex-wide"));
      }
    });
  } finally {
    await browser.close();
  }
});
