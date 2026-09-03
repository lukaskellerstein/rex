// Spec 15 §8.2 / spec 16 §9.1 — where the lane of margin bars is allowed to be.
//
// A `.ts` module rather than a corner of `MarginBars.tsx`, so `node --test` can
// load it — plain node cannot read `.tsx`. The same reason `hug.ts` and
// `lanes.ts` are their own files. (`lanes.ts` is a different kind of lane
// entirely: which of the five a comment is IN. This one is a strip of paper.)
//
// The lane is CHROME and never scales. `frame.ts` puts CSS `zoom` on the
// document, which scales the paper's margin with everything else, but a 10px
// number inside a 9px bar cannot be read — so the bar keeps its size and the
// paper is asked for more room instead. `LANE_RESERVE` is what it asks for.

/** §8.2 — where the lane starts, measured from the pane's own left edge. */
export const LANE_X = 4;

/** §8.3 — wide enough to carry a number inside it. */
export const BAR_W = 18;

/** A second lane, for a bar that would sit on top of one already placed. */
export const LANE_STEP = 20;

/** How much clear paper is left between the last lane and the mark beside it. */
export const LANE_MARGIN = 4;

/**
 * Spec 06 §6.4 — the clear paper a ring round a block leaves round the prose.
 *
 * The ring used to be drawn ON the block's own box, so its border ran down the
 * first column of pixels of every line and read as touching the letters.
 * Reported 2026-09-02, right after the lane itself was moved off the text:
 * *"the border of the selection is still a little bit close to the text"*.
 */
export const OUTLINE_GAP = 4;

/** The ring's own border, drawn outside that gap. `overlay.css` sets it too. */
const OUTLINE_BORDER = 2;

/**
 * How far outside a block's own box the widest mark REX draws reaches.
 *
 * The lane has to clear THIS and not the text, because the ring gets there
 * first. `PaneMarks` inflates the block's box by the same number.
 */
export const MARK_REACH = OUTLINE_GAP + OUTLINE_BORDER;

/**
 * The paper the lane needs, in the PANE's pixels.
 *
 * `applyZoom` divides this by the document's zoom and hands it to a page REX
 * typeset as `--rex-lane`, so the reserve is the same number of pane pixels
 * however far the reviewer has zoomed out.
 */
export const LANE_RESERVE = LANE_X + BAR_W + LANE_MARGIN + MARK_REACH;

export interface LaneGeometry {
  /** The first lane's left edge, from the pane's own left edge. */
  x: number;
  /** How many lanes fit before the prose. Never fewer than one. */
  lanes: number;
}

/**
 * Where the lane starts, and how many lanes fit, given where the text starts.
 *
 * §9.1 — the lane must not overlap the paper's text, nor the ring drawn round
 * it. Both numbers are measured rather than assumed: `textLeft` is the leftmost
 * block on screen, the closest the text ever comes, the ring reaches
 * `MARK_REACH` further left again, and the last lane stops `LANE_MARGIN` short
 * of that. Beyond it, bars share a lane and their numbers step down instead —
 * a hidden bar is worse than a crowded one.
 *
 * **The whole lane slides left when the paper leaves less room than it wants.**
 * Version 2.2 fixed the start at `LANE_X` and clamped the count to a minimum of
 * one, so the one case the clamp exists for — no room at all — drew the bar
 * straight over the first letters of every line. Reported 2026-09-02 against a
 * Markdown document at 90% zoom: `zoom` scaled the paper's 24px margin to
 * 21.6px while the lane still ended at 22px. A page REX typesets now reserves
 * `LANE_RESERVE` in the pane's own pixels, so the slide is the backstop for the
 * formats REX does not style — an HTML file with its own CSS, a deck, a PDF.
 */
export function laneGeometry(textLeft: number): LaneGeometry {
  if (!Number.isFinite(textLeft)) return { x: LANE_X, lanes: 1 };
  const edge = textLeft - MARK_REACH;
  const x = Math.max(0, Math.min(LANE_X, edge - LANE_MARGIN - BAR_W));
  const room = edge - LANE_MARGIN - x;
  return { x, lanes: Math.max(1, Math.floor((room - BAR_W) / LANE_STEP) + 1) };
}
