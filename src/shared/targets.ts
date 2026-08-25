// The one rule that reads a thread's targets, shared by both processes.
//
// Spec 05 §5.4: a thread is as good as its worst target, and `null` — "that
// document has not been open, so nobody looked" — is not one of the states it
// competes with. Written once, here, because getting it wrong in either process
// turns "not checked" into "orphaned", which is the difference between a comment
// that is waiting and a comment that is lost.
//
// No DOM, no database, no Electron: `node --test` imports this directly.

import type { AnchorState, DocumentRef } from "./types.ts";

/** `orphaned` beats `moved` beats `ok`. */
const RANK: Record<AnchorState, number> = { ok: 0, moved: 1, orphaned: 2 };

/** The worst of `states`, ignoring nulls. Null when every state is null. */
export function worstState(states: ReadonlyArray<AnchorState | null>): AnchorState | null {
  let worst: AnchorState | null = null;
  for (const state of states) {
    if (state === null) continue;
    if (worst === null || RANK[state] > RANK[worst]) worst = state;
  }
  return worst;
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
