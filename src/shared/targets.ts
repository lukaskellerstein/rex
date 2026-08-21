// The one rule that reads a thread's targets, shared by both processes.
//
// Spec 05 §5.4: a thread is as good as its worst target, and `null` — "that
// document has not been open, so nobody looked" — is not one of the states it
// competes with. Written once, here, because getting it wrong in either process
// turns "not checked" into "orphaned", which is the difference between a comment
// that is waiting and a comment that is lost.
//
// No DOM, no database, no Electron: `node --test` imports this directly.

import type { AnchorState } from "./types.ts";

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
