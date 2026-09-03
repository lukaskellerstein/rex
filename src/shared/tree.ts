// Which files in a scanned tree are documents — the one walk, for both sides.
//
// Shared because both processes ask it and must agree. Main asks it of the whole
// tree, to know where the reference graph and the search start; the renderer
// asks it of one folder, when the reviewer selects that folder in the explorer.
// A second copy of the walk is a second answer to "is this file in the review",
// and the two would drift the first time a rule changed.
//
// Pure, over `TreeEntry` alone: no `node:fs`, nothing from `main/` or
// `renderer/`. That is what lets the renderer import it at all.

import type { TreeEntry } from "./types.ts";

/**
 * Every document under these entries, depth first, in the order the tree draws.
 *
 * Two kinds are left out, and neither needs a flag. An `other` entry is listed
 * precisely because REX cannot render it, so there is nothing to point a comment
 * at. An excluded subtree is free to skip: the scan never walked it, so its
 * `children` are already empty and the `exclusion` test only has to catch the
 * folder itself. A revealed row is drawn so it can be un-excluded, never so it
 * can be acted on.
 *
 * The order is not cosmetic. For the explorer's folder selection it decides
 * `targets[0]`, which is what Apply's prompt leads with, so it has to be the
 * order the reviewer is looking at.
 */
export function documentsIn(entries: readonly TreeEntry[]): string[] {
  const paths: string[] = [];
  const visit = (list: readonly TreeEntry[]): void => {
    for (const entry of list) {
      if (entry.exclusion !== null) continue;
      if (entry.kind === "document") paths.push(entry.path);
      else if (entry.kind === "directory") visit(entry.children);
    }
  };
  visit(entries);
  return paths;
}
