// design/cards — the colour a comment wears, decided in one place.
//
// Three functions, one rule, and no JSX: the card's wash, the numbered token's
// fill and the margin bar's are the same decision drawn on three surfaces,
// and they must never disagree. A `.ts` module rather than a corner of
// `ThreadRow.tsx`, so `node --test` can load it — plain node cannot read `.tsx`.
//
// **The order of the branches is the design.** Status first, because a resolved
// comment is not an alarm; then the anchor states, loudest first; then the note.
// A note is LAST, which is what stops a fourth colour competing with the three
// above it: it fills the slot that had no colour at all — an ordinary open
// comment whose anchor is fine — so no comment ever has to choose between two.

import type { AnchorState } from "../../shared/types.ts";

/** The card's background wash and border. */
export function washClass(status: string, state: AnchorState | null, isNote = false): string {
  if (status === "resolved") return "rex-thread-done";
  if (state === "orphaned") return "rex-thread-orphaned";
  if (state === "moved") return "rex-thread-moved";
  if (isNote) return "rex-thread-unsent";
  return "";
}

/** The numbered token's fill. Hollow for a note, filled for everything else. */
export function tokenClass(status: string, state: AnchorState | null, isNote = false): string {
  if (status === "resolved") return "rex-token-done";
  if (state === "orphaned") return "rex-token-orphaned";
  if (state === "moved") return "rex-token-moved";
  if (isNote) return "rex-token-unsent";
  return "";
}

/**
 * Spec 15 §8.2 — the bar in the document's margin.
 *
 * It was a numbered disc on a 32px rail until spec 15 deleted the rail; the
 * decision it encodes is unchanged, which is why this function did not move.
 */
export function markerClass(status: string, state: AnchorState | null, isNote = false): string {
  if (status === "resolved") return "rex-margin-done";
  if (state === "orphaned") return "rex-margin-lost";
  if (state === "moved") return "rex-margin-moved";
  if (isNote) return "rex-margin-unsent";
  return "";
}
