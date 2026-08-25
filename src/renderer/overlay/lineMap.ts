// Spec 15 §6.2 — the same place in the other version.
//
// The two panes are only a diff if they stay level with each other, and "level"
// cannot mean "the same pixel": one side has paragraphs the other does not. It
// means the same *source line*, mapped through the patch.
//
// Pure text in, plain numbers out — no DOM, so `node --test` can load it.

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function hunksOf(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of patch.split("\n")) {
    const found = HUNK.exec(line);
    if (!found) continue;
    hunks.push({
      oldStart: Number(found[1]),
      // A hunk with no count is one line long — `@@ -3 +3,2 @@` is legal git.
      oldCount: found[2] === undefined ? 1 : Number(found[2]),
      newStart: Number(found[3]),
      newCount: found[4] === undefined ? 1 : Number(found[4]),
    });
  }
  return hunks;
}

/**
 * Where a line of the NEW version sits in the OLD one.
 *
 * Outside every hunk the two versions run in step, so the answer is the line
 * plus whatever the hunks before it added or removed. Inside a hunk there is no
 * single right answer — that is what a hunk *is* — so it answers with the start
 * of the hunk on the old side, which puts the two panes at the top of the same
 * change rather than at some arbitrary line inside it.
 */
export function toOriginalLine(hunks: readonly Hunk[], newLine: number): number {
  let shift = 0;
  for (const hunk of hunks) {
    if (newLine < hunk.newStart) break;
    if (newLine < hunk.newStart + hunk.newCount) return hunk.oldStart;
    shift = hunk.oldStart + hunk.oldCount - (hunk.newStart + hunk.newCount);
  }
  return Math.max(1, newLine + shift);
}

/** The same journey the other way, for a scroll that started in the left pane. */
export function toCurrentLine(hunks: readonly Hunk[], oldLine: number): number {
  let shift = 0;
  for (const hunk of hunks) {
    if (oldLine < hunk.oldStart) break;
    if (oldLine < hunk.oldStart + hunk.oldCount) return hunk.newStart;
    shift = hunk.newStart + hunk.newCount - (hunk.oldStart + hunk.oldCount);
  }
  return Math.max(1, oldLine + shift);
}
