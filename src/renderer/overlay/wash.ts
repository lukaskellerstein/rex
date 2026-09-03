// design/cards — the colour a comment wears, decided in one place.
//
// Three functions, one rule, and no JSX: the card's wash, the numbered token's
// fill and the margin bar's are the same decision drawn on three surfaces,
// and they must never disagree. A `.ts` module rather than a corner of
// `ThreadRow.tsx`, so `node --test` can load it — plain node cannot read `.tsx`.
//
// **The order of the branches is the design.** The two unsent lanes first,
// because a comment in either of them cannot be in any state below; then
// `resolved`, because a resolved comment is not an alarm; then the one anchor
// state that is a lane.
//
// Spec 30 §6 moved the note from the bottom of that order to near the top, and
// took a parameter off all three signatures with it. It used to arrive as
// `isNote`, tested LAST so that a fourth colour could not compete with the three
// above it. It is a lane now (spec 30 §2), it arrives inside `status`, and the
// tension that put it last is gone: a note cannot also be resolved or moved, so
// there is nothing left for it to compete with.
//
// Spec 33 §3.1 — `moved` has no branch. The wash follows the LANE, and `moved`
// is not one (spec 18 §2.1): a comment with a moved or a part-lost place is an
// open comment and wears the open comment's look. The amber it used to wear was
// the most saturated wash on the panel, spent on the fact the reviewer cared
// about least; what happened to the place is a mark on the row's file chip now.

import type { AnchorState, ThreadStatus } from "../../shared/types.ts";

/**
 * Spec 30 §6 — a draft is an open comment that has not started, so it is the
 * open comment's blue with a dashed edge rather than a seventh hue. Spec 33 §3.3
 * gave the note the yellow that `moved` freed; the class names did not change.
 */
export function washClass(status: ThreadStatus, state: AnchorState | null): string {
  if (status === "draft") return "rex-thread-draft";
  if (status === "note") return "rex-thread-unsent";
  if (status === "resolved") return "rex-thread-done";
  if (state === "orphaned") return "rex-thread-orphaned";
  return "";
}

/** The numbered token's fill. Hollow for a note, dashed for a draft. */
export function tokenClass(status: ThreadStatus, state: AnchorState | null): string {
  if (status === "draft") return "rex-token-draft";
  if (status === "note") return "rex-token-unsent";
  if (status === "resolved") return "rex-token-done";
  if (state === "orphaned") return "rex-token-orphaned";
  return "";
}

/**
 * Spec 15 §8.2 — the bar in the document's margin.
 *
 * It was a numbered disc on a 32px rail until spec 15 deleted the rail; the
 * decision it encodes is unchanged, which is why this function did not move.
 */
export function markerClass(status: ThreadStatus, state: AnchorState | null): string {
  if (status === "draft") return "rex-margin-draft";
  if (status === "note") return "rex-margin-unsent";
  if (status === "resolved") return "rex-margin-done";
  if (state === "orphaned") return "rex-margin-lost";
  return "";
}
