// Spec 15 §8 — how a commented passage is marked.
//
// A coloured vertical bar in one fixed lane down the left of the pane, level
// with the passage, with the comment's number inside it. Nothing on the text
// itself until that comment is opened or pointed at (§8.4), which is what makes
// a document with six comments in it readable again.
//
// It replaces `Gutter.tsx` — a 32px rail of numbered discs beside the page. The
// rail was a second place to look for what the passage already implies, it could
// not say which of two adjacent paragraphs a disc belonged to, and §6 needs its
// column for the second pane.
//
// **The lane is fixed, and the height is not.** Version 2.0 put each bar at its
// own block's left edge, so a list item's bar sat 40px right of a paragraph's
// and the marks formed a ragged staircase. A block's indent is information
// about the prose, not about the comments. Only the x is fixed; the height
// still comes from the block, so a bar still says *which* paragraph.
//
// Spec 16 §7.2 — each pane draws the bars for the targets that resolved in IT,
// under the same number, so the two lanes read as a diff of the review as well
// as of the text. Nothing here computes that: it is what the two sweeps found,
// drawn.
//
// Drawn in the overlay over the pane, exactly as `.rex-block-outline` is, so
// invariant I1 and spec 01 §6.7 hold: no `<mark>`, no wrapper, no mutation of
// the document under review.

import type { ThreadWithMessages } from "../../shared/types.ts";
import type { ScopeRect } from "../anchor/pick.ts";
import type { ResolvedThread } from "./anchoring.ts";
import { markerClass } from "./wash.ts";

interface Props {
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  hoveredThreadId: string | null;
  scrollX: number;
  scrollY: number;
  onSelect: (threadId: string) => void;
  onHover: (threadId: string | null) => void;
}

/** §8.2 — where the lane starts, measured from the pane's own left edge. */
const LANE_X = 4;

/** §8.3 — wide enough to carry a number inside it. */
const BAR_W = 18;

/** A second lane, for a bar that would sit on top of one already placed. */
const LANE_STEP = 20;

/** How much clear paper is left between the last lane and the prose. */
const LANE_MARGIN = 4;

/** §8.3 — two bars that end up in one lane step their numbers down by this. */
const NUMBER_STEP = 18;

interface Bar {
  threadId: string;
  number: number;
  /** Which lane out of the pane's left edge, 0 being furthest from the text. */
  lane: number;
  box: ScopeRect;
  /** Spec 16 §7.3 — the rule across the text column, for a gap. Null otherwise. */
  rule: ScopeRect | null;
  className: string;
  title: string;
}

/**
 * Two bars share a lane only when they do not overlap vertically.
 *
 * Without this every comment in the document would stack, and the fifth one
 * would be 70px into the margin whether or not anything else was near it. The
 * check is per pair rather than per document, so a page of comments that never
 * touch draws every bar in the same lane — which is what a reader expects.
 */
function laneFor(placed: Bar[], box: ScopeRect): number {
  let lane = 0;
  for (;;) {
    const clash = placed.some(
      (bar) => bar.lane === lane && bar.box.y < box.y + box.h && box.y < bar.box.y + bar.box.h,
    );
    if (!clash) return lane;
    lane++;
  }
}

/**
 * How many lanes fit between the pane's edge and the prose.
 *
 * §9.1 — the lane must not overlap the paper's text at any window width down to
 * 1200px with both panes open, and at that width each half has about 24px of
 * paper margin to work with. So the count is measured rather than assumed: the
 * leftmost block on screen is the closest the text ever comes, and lanes stop
 * before it. Beyond the last one, bars share a lane and their numbers step down
 * instead — a hidden bar is worse than a crowded one.
 */
function laneCount(bars: Bar[]): number {
  const textLeft = Math.min(...bars.map((bar) => bar.box.x));
  if (!Number.isFinite(textLeft)) return 1;
  const room = textLeft - LANE_MARGIN - LANE_X;
  return Math.max(1, Math.floor((room - BAR_W) / LANE_STEP) + 1);
}

export function MarginBars(props: Props): React.JSX.Element {
  const numbers = new Map(props.threads.map((thread, position) => [thread.id, position + 1]));
  const byId = new Map(props.threads.map((thread) => [thread.id, thread]));

  const bars: Bar[] = [];
  for (const entry of props.resolved) {
    const thread = byId.get(entry.threadId);
    if (!thread) continue;

    for (const check of entry.checked) {
      // §8.5 — an orphan has no place in the document by definition, so it has
      // no bar. The comment list is where it is reported, and it counts them.
      if (!check.bar) continue;

      const label =
        check.state === "orphaned"
          ? " — anchor lost"
          : check.state === "moved"
            ? " — text moved"
            : "";
      bars.push({
        threadId: thread.id,
        number: numbers.get(thread.id) ?? 0,
        lane: laneFor(bars, check.bar),
        box: check.bar,
        rule: check.rule,
        className: [
          "rex-margin",
          markerClass(thread.status, check.state, thread.isNote),
          props.activeId === thread.id ? "rex-margin-active" : "",
          props.hoveredThreadId === thread.id ? "rex-margin-lit" : "",
        ]
          .filter(Boolean)
          .join(" "),
        title: `${thread.note}${label}`,
      });
    }
  }

  const lanes = bars.length > 0 ? laneCount(bars) : 1;
  const leftOf = (bar: Bar): number => LANE_X + Math.min(bar.lane, lanes - 1) * LANE_STEP;

  // §8.3 — a number pushed down by every number already at this height in this
  // lane. Only reached once the lanes run out, which is what the clamp above
  // makes possible; with room to spare each bar has a lane of its own and the
  // numbers all sit at the top.
  const numberTops = new Map<string, number>();
  const taken: Array<{ x: number; y: number }> = [];
  for (const bar of bars) {
    const x = leftOf(bar);
    let y = bar.box.y;
    while (taken.some((spot) => spot.x === x && Math.abs(spot.y - y) < NUMBER_STEP)) {
      y += NUMBER_STEP;
    }
    taken.push({ x, y });
    numberTops.set(`${bar.threadId}-${bar.box.y}-${bar.lane}`, y);
  }

  return (
    <>
      {/*
        Spec 16 §7.3 — a gap has no height, so its bar can only say THAT there
        is a comment here. The rule across the text column is what says where.
      */}
      {bars.map((bar) =>
        bar.rule ? (
          <div
            key={`rule-${bar.threadId}-${bar.rule.y}`}
            className={`rex-gap-rule${props.activeId === bar.threadId ? " rex-gap-rule-active" : ""}`}
            style={{
              left: bar.rule.x - props.scrollX,
              top: bar.rule.y - props.scrollY,
              width: bar.rule.w,
            }}
          />
        ) : null,
      )}

      {bars.map((bar) => {
        const key = `${bar.threadId}-${bar.box.y}-${bar.lane}`;
        return (
          <button
            type="button"
            key={key}
            className={bar.className}
            title={bar.title}
            style={{ left: leftOf(bar), top: bar.box.y - props.scrollY, height: bar.box.h }}
            onClick={() => props.onSelect(bar.threadId)}
            onMouseEnter={() => props.onHover(bar.threadId)}
            onMouseLeave={() => props.onHover(null)}
          >
            <span
              className="rex-margin-number"
              style={{ top: (numberTops.get(key) ?? bar.box.y) - bar.box.y }}
            >
              {bar.number}
            </span>
          </button>
        );
      })}
    </>
  );
}
