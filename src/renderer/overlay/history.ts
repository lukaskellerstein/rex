// Spec 53 §5.4 — the way back.
//
// Two stacks and three functions. No DOM, no React, no IPC, so `node --test`
// loads it directly — the same reason `lineMap.ts` and `jsonTree.ts` are their
// own modules. Everything that needs a live page (reading a scroll offset,
// putting one back) is on the surface; everything that is a decision about
// WHICH place to go to is here.
//
// The model is a browser's, because that is the model every reviewer already
// has: going somewhere pushes where you were, going back moves one entry from
// one stack to the other, and going somewhere new throws the forward stack
// away.

import type { DocumentPlace } from "../../shared/types.ts";

export interface History {
  /** Most recent last, so back is a pop. */
  back: DocumentPlace[];
  forward: DocumentPlace[];
}

/**
 * How far back the reviewer can walk.
 *
 * A cap and not a limit anyone will meet: it exists so a long session cannot
 * grow an unbounded array, and so the debug report's counts stay small. The
 * oldest entry is dropped, never the newest.
 */
export const HISTORY_DEPTH = 50;

export const EMPTY_HISTORY: History = { back: [], forward: [] };

export function canGoBack(history: History): boolean {
  return history.back.length > 0;
}

export function canGoForward(history: History): boolean {
  return history.forward.length > 0;
}

/**
 * §5.4 rule 1 and rule 3 — a new place is being opened, so remember the one
 * being left and drop the forward stack.
 *
 * Every change of document comes through here, not only a link click. A Back
 * that works after a link but not after a click in the explorer is a Back
 * nobody trusts, and the reviewer cannot see which route they took.
 */
export function pushPlace(history: History, leaving: DocumentPlace): History {
  const back = [...history.back, leaving];
  return {
    back: back.length > HISTORY_DEPTH ? back.slice(back.length - HISTORY_DEPTH) : back,
    forward: [],
  };
}

/**
 * §5.4 rule 4 — one step back, with the place being left going onto `forward`.
 *
 * `here` is where the reviewer is standing right now, which the caller reads
 * off the live page. Null when there is nowhere to go, so the caller has one
 * check rather than two.
 */
export function goBack(
  history: History,
  here: DocumentPlace,
): { history: History; to: DocumentPlace } | null {
  const to = history.back.at(-1);
  if (!to) return null;
  return {
    history: { back: history.back.slice(0, -1), forward: [...history.forward, here] },
    to,
  };
}

/** The mirror of `goBack`, so the pair walks the same two files both ways. */
export function goForward(
  history: History,
  here: DocumentPlace,
): { history: History; to: DocumentPlace } | null {
  const to = history.forward.at(-1);
  if (!to) return null;
  return {
    history: { back: [...history.back, here], forward: history.forward.slice(0, -1) },
    to,
  };
}
