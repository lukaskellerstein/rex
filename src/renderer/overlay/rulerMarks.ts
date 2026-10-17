// Spec 64 — what the overview ruler draws, as fractions of the whole document.
//
// Every mark is a picture of something the pane already draws, taken from the
// list it is already drawn from: a comment's mark from the `ResolvedThread[]`
// the margin bars read, a change's from the `ChangeBox[]` the outlines read.
// Nothing is computed here that the page does not already show, so the strip
// cannot disagree with the page (§3) — which is the answer to spec 28 §6 point
// 9's worry about keeping two pictures in step.
//
// A `.ts` module with no JSX and no DOM, so `node --test` can load it.

import { commentName } from "../../shared/names.ts";
import type { ThreadWithMessages } from "../../shared/types.ts";
import type { ScopeRect } from "../anchor/pick.ts";
import type { ResolvedThread } from "./anchoring.ts";
import type { ChangeKind } from "./blockDiff.ts";
import type { ChangeBox } from "./changes.ts";
import { barClasses } from "./wash.ts";

/** §3.3 — where the reader is in the page, in the units every box is measured in. */
export interface PageExtent {
  scrollY: number;
  viewHeight: number;
  /** `documentElement.scrollHeight` — never less than the view, even on a short page. */
  total: number;
}

/** A stretch of the strip, both numbers fractions of the document's height. */
export interface RulerSpan {
  top: number;
  height: number;
}

/** §4 — one mark in the left lane: a comment's place, or a changed block. */
export interface RulerMark extends RulerSpan {
  key: string;
  /** The kind's class, and for a comment the bar's colour on top of it. */
  className: string;
  /** §5 — what a hover names it. */
  title: string;
  /** §5 — what a click brings into view, in the frame's document pixels. */
  box: ScopeRect;
  /** §5 — the comment a click opens, or null for a change. */
  threadId: string | null;
}

/** §3.2 — `OUTLINE_CLASS`'s three kinds, one ruler class each. */
const CHANGE_CLASS: Record<ChangeKind, string> = {
  removed: "rex-ruler-removed",
  added: "rex-ruler-added",
  changed: "rex-ruler-rewritten",
};

const CHANGE_TITLE: Record<ChangeKind, string> = {
  removed: "Removed",
  added: "Added",
  changed: "Rewritten",
};

/** §3.3 — the part of the document on screen. */
export function bandOf(extent: PageExtent): RulerSpan | null {
  if (extent.total <= 0) return null;
  return spanOf(extent.scrollY, extent.viewHeight, extent.total);
}

/**
 * §3.1 — one mark per target that has a margin bar, in that bar's colour.
 *
 * An orphan has no bar, so it has no mark either: it has no place in the
 * document, and the comment list is where it is reported.
 */
export function commentMarks(
  resolved: ResolvedThread[],
  threads: ThreadWithMessages[],
  activeId: string | null,
  hoveredThreadId: string | null,
  total: number,
): RulerMark[] {
  if (total <= 0) return [];
  // Numbered by position in the full list, exactly as `MarginBars` numbers.
  const numbers = new Map(threads.map((thread, position) => [thread.id, position + 1]));
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return resolved.flatMap((entry) => {
    const thread = byId.get(entry.threadId);
    if (!thread) return [];
    return entry.checked.flatMap((check) =>
      check.bar
        ? [
            {
              ...spanOf(check.bar.y, check.bar.h, total),
              key: `${thread.id}-${check.position}`,
              className: [
                "rex-ruler-comment",
                barClasses(
                  thread.status,
                  check.state,
                  activeId === thread.id,
                  hoveredThreadId === thread.id,
                ),
              ]
                .filter(Boolean)
                .join(" "),
              title: `Comment ${numbers.get(thread.id) ?? 0} · ${commentName(thread)}`,
              box: check.bar,
              threadId: thread.id,
            },
          ]
        : [],
    );
  });
}

/** §3.2 — one mark per changed block, as tall as the block. */
export function changeMarks(boxes: ChangeBox[], total: number): RulerMark[] {
  if (total <= 0) return [];
  return boxes.map((box, at) => ({
    ...spanOf(box.y, box.h, total),
    // By position: a hidden pane measures every block at 0×0, so geometry is
    // not unique there — the reason the outlines are keyed this way too.
    key: `change-${at}`,
    className: CHANGE_CLASS[box.kind],
    title: CHANGE_TITLE[box.kind],
    box,
    threadId: null,
  }));
}

/** A run of document pixels as fractions, kept inside the strip. */
function spanOf(y: number, h: number, total: number): RulerSpan {
  const top = Math.min(Math.max(y / total, 0), 1);
  return { top, height: Math.min(Math.max(h / total, 0), 1 - top) };
}
