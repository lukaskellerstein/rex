// Spec 15 §8 — how a commented passage is marked.
//
// A coloured vertical bar in the margin beside the block, with the comment's
// number on it. Nothing on the text itself until that comment is opened or
// pointed at (§8.4), which is what makes a document with six comments in it
// readable again.
//
// It replaces `Gutter.tsx` — a 32px rail of numbered discs beside the page. The
// rail was a second place to look for what the passage already implies, it could
// not say which of two adjacent paragraphs a disc belonged to, and §6 needs its
// column for the second pane.
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

/** §8.2 — 3px of bar, 2px of gap. */
const LANE = 5;

/** How far left of the block the first bar stands. */
const OFFSET = 14;

/** §8.3 — the numbered chip's own width, which is what makes two collide. */
const CHIP = 16;

/** §8.3 — chips that would collide step down by this much. */
const CHIP_STEP = 18;

interface Bar {
  threadId: string;
  number: number;
  /** Which lane out of the block's left edge, 0 being nearest the text. */
  lane: number;
  box: ScopeRect;
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

  // §8.3 — a chip pushed down by every chip already at this height. Walked in
  // draw order, so the number nearest the text is the one on top.
  //
  // Height alone decides, never height AND lane. A chip is 16px across and a
  // lane is 5px, so two chips in adjacent lanes overlap almost completely —
  // measured on 2026-08-26, where two comments on one paragraph drew one
  // readable number and one hidden behind it. What the reviewer asked for is
  // numbers descending the left edge, and this is that rule.
  const chipTops = new Map<string, number>();
  const taken: Array<{ x: number; y: number }> = [];
  for (const bar of bars) {
    const x = bar.box.x - OFFSET - bar.lane * LANE;
    let y = bar.box.y;
    while (taken.some((spot) => Math.abs(spot.x - x) < CHIP && Math.abs(spot.y - y) < CHIP_STEP)) {
      y += CHIP_STEP;
    }
    taken.push({ x, y });
    chipTops.set(`${bar.threadId}-${bar.box.y}-${bar.lane}`, y);
  }

  return (
    <>
      {bars.map((bar) => {
        const left = bar.box.x - OFFSET - bar.lane * LANE - props.scrollX;
        const key = `${bar.threadId}-${bar.box.y}-${bar.lane}`;
        return (
          <button
            type="button"
            key={key}
            className={bar.className}
            title={bar.title}
            style={{ left, top: bar.box.y - props.scrollY, height: bar.box.h }}
            onClick={() => props.onSelect(bar.threadId)}
            onMouseEnter={() => props.onHover(bar.threadId)}
            onMouseLeave={() => props.onHover(null)}
          >
            <span
              className="rex-margin-number"
              style={{ top: (chipTops.get(key) ?? bar.box.y) - bar.box.y }}
            >
              {bar.number}
            </span>
          </button>
        );
      })}
    </>
  );
}
