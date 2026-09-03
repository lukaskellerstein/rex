// Spec 30 §2 — which lane a comment is in, decided in one place.
//
// It is one function and not a predicate per lane, because the lanes are
// DISJOINT: every comment is in exactly one of them, and a set of five
// independent tests is free to put one comment in two. The list, the five
// counts and the marks on the paper all read this, so they cannot disagree
// about where a comment belongs.
//
// A `.ts` module rather than a corner of `Sidebar.tsx`, so `node --test` can
// load it — plain node cannot read `.tsx`. It is the same reason `wash.ts` is
// its own file, and these two are the pair that must always agree: `laneOf`
// says which lane, `wash.ts` says what that lane looks like.

import type { AnchorState, ThreadStatus } from "../../shared/types.ts";

/**
 * The four stored lanes, plus the one that is computed.
 *
 * `orphaned` is not a `ThreadStatus` and must never become one. Spec 18 §2 kept
 * it out on purpose: the other four are facts about what the REVIEWER did, and
 * this one is a fact about what happened to the DOCUMENT. Storing it would mean
 * writing to the database every time a sweep changed its mind.
 */
export type Lane = ThreadStatus | "orphaned";

/** Filter-row order: the two unsent lanes, then sent, then dealt with, then lost. */
export const LANES: readonly Lane[] = ["draft", "note", "open", "resolved", "orphaned"];

/**
 * What each lane is called on screen, which is not always its key.
 *
 * Two of the five differ, and both differences were bought with a measurement.
 * Spec 18 §5.2 shortened `orphaned` to **gone** to fit four chips in a 384px
 * row; spec 30 §4.4 shortened `resolved` to **done** to fit five. `done` is not
 * a new word either — `--done` has been the token name for that colour since
 * spec 18 §3, so the screen is catching up with the palette.
 */
export const LANE_LABEL: Record<Lane, string> = {
  draft: "draft",
  note: "note",
  open: "open",
  resolved: "done",
  orphaned: "gone",
};

/**
 * The lane a comment is in, given the freshest anchor state anyone has for it.
 *
 * **`resolved` is terminal, and that is the whole subtlety.** Spec 18 §2: a
 * comment that was dealt with and whose text was later removed stays resolved.
 * It never enters the gone lane and never appears in the gone count. The gone
 * lane exists so a reviewer does not lose a question they asked, and an
 * answered question cannot be lost — flagging one is noise in the lane that
 * exists to catch real losses.
 *
 * Spec 30 §2 widened it at the other end: `draft` and `note` CAN go gone, for
 * the reason `open` could. The reviewer has not dealt with it, and the text it
 * points at has vanished.
 *
 * `state` is the MERGED state across both panes (spec 16 §5.2), never one
 * pane's own. Taking the worst of the two would report every comment on
 * unchanged text as orphaned the moment a working copy existed.
 *
 * Spec 32 §2 changed what `orphaned` means before it arrives here, and this
 * function did not have to move: it is now "every place this comment has is
 * gone", so the gone lane holds comments that cannot be reached from the paper
 * at all — which is the only reason the lane exists.
 */
export function laneOf(status: ThreadStatus, state: AnchorState | null): Lane {
  if (state === "orphaned" && status !== "resolved") return "orphaned";
  return status;
}
