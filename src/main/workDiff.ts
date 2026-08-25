// Spec 15 §6.2 and §6.3 — what changed between the two versions, twice over.
//
// Once as a patch, which is what the reviewer opens when they want the exact
// characters. Once as two lists of line ranges — the new version's added blocks
// and the original's removed ones — which is what the panes tint, through the
// `data-src-line` stamps spec 05 §5.6.1 already relies on.
//
// Pure except for the one `git diff --no-index` call: text in, plain data out.

import { relative } from "node:path";
import type { ChangedRegion } from "../shared/types.ts";
import { changedRegions } from "./diff.ts";
import { diffFiles } from "./git.ts";

export interface WorkingDiff {
  /** The unified patch, its headers naming the reviewer's file. */
  patch: string;
  /** Blocks the new version added or changed, in ITS line numbers. */
  added: ChangedRegion[];
  /** Blocks the original had and the new version does not, in ITS line numbers. */
  removed: ChangedRegion[];
  addedLines: number;
  removedLines: number;
}

const EMPTY: WorkingDiff = { patch: "", added: [], removed: [], addedLines: 0, removedLines: 0 };

/**
 * `git diff --no-index` names the two copies it was given, so every header line
 * has to be rewritten to the document the reviewer knows.
 *
 * Three lines carry a name — `diff --git`, `---` and `+++` — and all three are
 * replaced. `changedRegions` reads `+++ b/<path>` to decide what to outline and
 * `tallyByFile` reads it for the per-file counts, so getting this wrong is not
 * cosmetic: both would attribute the change to a file in `~/.rex/work`.
 */
function renameHeaders(patch: string, name: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git ")) return `diff --git a/${name} b/${name}`;
      if (line.startsWith("--- ")) return line.includes("/dev/null") ? line : `--- a/${name}`;
      if (line.startsWith("+++ ")) return line.includes("/dev/null") ? line : `+++ b/${name}`;
      return line;
    })
    .join("\n");
}

function countLines(patch: string, marker: "+" | "-"): number {
  let total = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith(marker) && !line.startsWith(marker.repeat(3))) total++;
  }
  return total;
}

/**
 * The change between one working copy's two versions.
 *
 * `root` is what the patch's paths are relative to and what `changedRegions`
 * joins them back against — the document's repository root, or its own
 * directory when there is no repository.
 */
export function workingDiff(input: {
  base: string;
  current: string;
  /** The reviewer's file, which is what the patch must name. */
  path: string;
  root: string;
}): WorkingDiff {
  const raw = diffFiles(input.base, input.current);
  if (raw.trim().length === 0) return EMPTY;

  // Relative when the document is under the root, absolute when it is not:
  // `changedRegions` resolves a relative path against the root and leaves an
  // absolute one alone, so both come back as the real file either way.
  const away = relative(input.root, input.path);
  const name = away.startsWith("..") ? input.path : away;

  const patch = renameHeaders(raw, name);
  return {
    patch,
    added: changedRegions(patch, input.root, "new"),
    removed: changedRegions(patch, input.root, "old"),
    addedLines: countLines(patch, "+"),
    removedLines: countLines(patch, "-"),
  };
}
