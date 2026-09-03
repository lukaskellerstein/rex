// The one rule that reads a thread's targets, shared by both processes.
//
// Spec 32 §2: a comment is lost only when EVERY place it has is lost. It was
// the opposite until then — the worst place decided, so one renamed heading
// filed a comment with three live places in the `gone` lane and took it out of
// the `open` filter. Written once, here, because the sidebar, the paper, the
// tree and the export all answer it and must answer it the same way.
//
// `null` — "that document has not been open, so nobody looked" — competes in
// neither direction (spec 05 §5.4). It cannot lose a comment and it cannot save
// one. Getting that wrong turns "not checked" into "orphaned", which is the
// difference between a comment that is waiting and a comment that is lost.
//
// No DOM, no database, no Electron: `node --test` imports this directly.

import type { AnchorState, DocumentRef } from "./types.ts";

/**
 * Spec 32 §5 — how a comment's places came out.
 *
 * A count and not a single state, because a single state cannot describe four
 * places. `checked` is `ok + moved + orphaned`: the places somebody has actually
 * looked at, and the only ones any rule below reads.
 */
export interface PlaceTally {
  ok: number;
  moved: number;
  orphaned: number;
  /** Nobody looked — spec 05 §5.4. Never counted as lost, never counted as found. */
  unchecked: number;
  checked: number;
}

/** A comment with no places at all, and what every `get` on a tally map falls back to. */
export const NO_PLACES: PlaceTally = { ok: 0, moved: 0, orphaned: 0, unchecked: 0, checked: 0 };

export function tallyPlaces(states: ReadonlyArray<AnchorState | null>): PlaceTally {
  const tally: PlaceTally = { ok: 0, moved: 0, orphaned: 0, unchecked: 0, checked: 0 };
  for (const state of states) {
    if (state === null) {
      tally.unchecked++;
      continue;
    }
    tally[state]++;
    tally.checked++;
  }
  return tally;
}

/**
 * Spec 32 §2 — the comment's own state, from its places.
 *
 * Three rules, in this order, and the first is the whole spec:
 *
 * - **`orphaned` needs every checked place**, not one of them. A comment with a
 *   place still on the paper can be reached by pointing at it, and `laneOf`
 *   reads this answer to decide whether it leaves the `open` filter.
 * - **`moved` takes the leftover** (§2.1). Not gone, not clean — one amber wash
 *   for "something under this comment changed, look". `moved` is not a lane
 *   (spec 18 §2.1), so nothing is filed anywhere by it.
 * - **Null when nobody looked at any place.** Not `ok`: REX cannot report a
 *   document it has never opened as fine.
 */
export function threadState(tally: PlaceTally): AnchorState | null {
  if (tally.checked === 0) return null;
  if (tally.orphaned === tally.checked) return "orphaned";
  if (tally.orphaned > 0 || tally.moved > 0) return "moved";
  return "ok";
}

/**
 * Spec 32 §2.2 — the word a summary prints, and which colour it wears.
 *
 * A count wherever the places disagree, because "anchor lost" on a comment with
 * three live places is the sentence this spec exists to delete. The denominator
 * is `checked` and never `states.length`: a place in a file nobody has opened is
 * not evidence in either direction, so counting it would make the fraction a
 * claim about a file nobody read.
 *
 * The tone is not the same decision as the wash. A part-lost comment washes
 * amber — it is open, and `threadState` says `moved` — while this word reads
 * grey, because what happened to that one place is absence. Spec 18 §3 gives
 * grey to absence and amber to a thing that shifted, and a part-lost comment
 * genuinely has one of each.
 */
export function placesWord(tally: PlaceTally): { text: string; tone: "lost" | "moved" } | null {
  const { checked, orphaned, moved } = tally;
  if (checked === 0) return null;
  if (orphaned === checked) return { text: "anchor lost", tone: "lost" };
  if (orphaned > 0) return { text: `${orphaned} of ${checked} lost`, tone: "lost" };
  if (moved === checked) return { text: "text moved", tone: "moved" };
  if (moved > 0) return { text: `${moved} of ${checked} moved`, tone: "moved" };
  return null;
}

/** `path` is `root` itself, or sits under it. Never `/docs-old` under `/docs`. */
function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * Spec 10 §3.3 — is this comment about nothing but excluded documents?
 *
 * The question a workspace-wide command asks before it acts on a thread. It is
 * deliberately strict in two directions, because both loose readings lose work:
 *
 * - **Every** file target must be excluded, not merely one. A comment that spans
 *   an excluded appendix and a chapter still in review is a comment about the
 *   chapter, and skipping it would drop a real question on the floor.
 * - A comment with no file target at all — a synthesis comment, or one whose
 *   document row has gone — is never out of scope. Exclusion is a statement
 *   about a folder, and a thread that names no folder cannot be the subject of
 *   one.
 */
export function outOfReviewScope(
  targetRefs: ReadonlyArray<DocumentRef | null>,
  excluded: readonly string[],
): boolean {
  if (excluded.length === 0) return false;
  const files = targetRefs.filter((ref) => ref !== null).map((ref) => ref.value);
  return files.length > 0 && files.every((path) => excluded.some((root) => isUnder(path, root)));
}
