// Spec 05 §5.6.1 — a unified diff, into the lines the reviewer should look at.
//
// Only the `+` side is useful. The `-` side describes a file that no longer
// exists on disk, and the document the reviewer is about to read is the new one,
// so a range taken from the old numbering would outline the wrong paragraphs
// with complete confidence. That is the failure mode this whole codebase is
// careful about, and here it is one character of difference in a regex.
//
// Pure text in, plain data out: no git, no filesystem, no Electron.

import { isAbsolute, join } from "node:path";
import type { ChangedRegion } from "../shared/types.ts";

/** `@@ -12,3 +12,5 @@` — the old side is the first pair, the new side the second. */
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** `+++ b/docs/a.md`, or `+++ /dev/null` when the file was deleted. */
const NEW_FILE = /^\+\+\+ (?:b\/)?(.+)$/;

/** `--- a/docs/a.md` — the same header on the old side. */
const OLD_FILE = /^--- (?:a\/)?(.+)$/;

/**
 * Spec 15 §6.2 — which half of the patch to walk.
 *
 * `new` is what the reviewer's document holds after the change, and it is the
 * only side spec 05 §5.6.1 ever needed: there was one document on screen and it
 * was the new one. The two panes put the OLD text on screen as well, so the
 * removed lines now have somewhere to be drawn, and they are read out of the
 * same patch by counting the other pair of numbers.
 */
export type DiffSide = "new" | "old";

/**
 * Every run of added lines, per file, in the file as it is **now**.
 *
 * The added lines only, not the whole hunk. A hunk carries three lines of
 * context either side, and on a short file that reaches most of it: measured on
 * 2026-08-21, a one-section edit to a 13-line `limits.md` outlined four blocks,
 * three of which the agent never touched. An outline that covers untouched prose
 * is worse than no outline, because the reviewer has to check it to find out.
 *
 * Trimming to the changed lines is safe because the renderer does not match them
 * against `data-src-line` directly — it widens each line to the block that
 * contains it (`changedBlocks`). A line changed in the middle of a paragraph
 * still lands inside that paragraph's span, so nothing is lost by being precise
 * here, and the context lines only ever added neighbours.
 *
 * A hunk that only deletes has no added lines and yields no range. There is
 * nothing left in the document to outline, and the diff says the rest.
 */
export function changedRegions(
  unifiedDiff: string,
  root: string,
  side: DiffSide = "new",
): ChangedRegion[] {
  const regions: ChangedRegion[] = [];
  // The marker whose lines this side counts, and the one that stands still.
  const mine = side === "new" ? "+" : "-";
  const theirs = side === "new" ? "-" : "+";
  const fileHeader = side === "new" ? NEW_FILE : OLD_FILE;

  let file: string | null = null;
  /** The next line number on this side, as the hunk body is walked. */
  let line = 0;
  let run: ChangedRegion | null = null;

  const closeRun = (): void => {
    if (run) regions.push(run);
    run = null;
  };

  for (const text of unifiedDiff.split("\n")) {
    const header = fileHeader.exec(text);
    if (header) {
      closeRun();
      const path = header[1].trim();
      file = path === "/dev/null" ? null : isAbsolute(path) ? path : join(root, path);
      continue;
    }

    const hunk = HUNK.exec(text);
    if (hunk) {
      closeRun();
      line = Number(side === "new" ? hunk[2] : hunk[1]);
      continue;
    }

    if (file === null || line === 0) continue;

    // A file header starts with three of its marker, and both were handled
    // above — so a line starting with one marker here is content.
    if (text.startsWith(mine)) {
      if (run) run.to = line;
      else run = { file, from: line, to: line };
      line++;
    } else if (text.startsWith(theirs)) {
      // A line belonging to the other side takes no room on this one, so the
      // numbering stands still — but the run of changed lines has ended.
      closeRun();
    } else if (text.startsWith(" ") || text === "") {
      closeRun();
      line++;
    }
    // `\ No newline at end of file` and anything else is neither, and moves
    // nothing.
  }

  closeRun();
  return regions;
}
