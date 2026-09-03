// Spec 33 §2.1 — the file chips on a comment row, as data.
//
// One chip per DISTINCT file, in target order, counting every place the comment
// has in it. The row used to quote `targets[0]` and nothing else, so a comment
// about five places in four files said "The whole document" — its first place
// — and nothing about the other four.
//
// A `.ts` module rather than a corner of `ThreadRow.tsx`, so `node --test` can
// load it — plain node cannot read `.tsx`.

import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";

export interface FileChip {
  name: string;
  /** Places in this file, the whole-file one included. */
  places: number;
  /** One of them is the whole file — `anchor.extent === "document"`. */
  whole: boolean;
  /** How many of them are lost. Never counts a place nobody looked at. */
  lost: number;
}

/**
 * `states` is per target, parallel to `thread.targets` — the sweep's fresher
 * answer where it has one, the stored state where it does not (spec 05 §5.4).
 * A `null` is "nobody looked" and is neither lost nor found, so it adds to the
 * count and never to `lost`.
 */
export function filesOf(
  thread: Pick<ThreadWithMessages, "targets" | "targetNames">,
  states: ReadonlyArray<AnchorState | null>,
): FileChip[] {
  // A Map keeps insertion order, which is target order — the order the reviewer
  // picked the places in, and the order the card lists them.
  const byName = new Map<string, FileChip>();
  thread.targets.forEach((target, position) => {
    const name = thread.targetNames[position] ?? "";
    const chip = byName.get(name) ?? { name, places: 0, whole: false, lost: 0 };
    chip.places += 1;
    if (target.anchor.extent === "document") chip.whole = true;
    if (states[position] === "orphaned") chip.lost += 1;
    byName.set(name, chip);
  });
  return [...byName.values()];
}
