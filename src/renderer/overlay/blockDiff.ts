// Spec 63 §3.2 and §3.3 — two lists of blocks, aligned, and what the change did
// to each one.
//
// The blocks arrive as their own content (`changes.ts` builds it), so two
// blocks are the same block exactly when their strings are equal. The
// alignment is the longest common subsequence, the one `git diff` makes over
// lines: an identical block is unchanged for certain, and nothing is outlined
// for being near a change.
//
// Pure: strings in, kinds out. No DOM.

export type ChangeKind = "added" | "removed" | "changed";

export interface BlockDiff {
  /** Per block of the original: what the change did to it, or null. */
  before: Array<ChangeKind | null>;
  /** Per block of the new version, the same. */
  after: Array<ChangeKind | null>;
}

/**
 * §3.4 — past this many pairs the alignment is not attempted.
 *
 * The table is one 32-bit cell per pair, so this is 16 MB. A document that
 * changed this much gets no tints, by spec 15's rule that a wrong outline is
 * worse than none, and the patch below the panes still says everything.
 */
const MAX_PAIRS = 4_000_000;

/**
 * What the change did to every block, or null when there is too much to align.
 *
 * Between two aligned blocks lies a gap, and what the gap holds decides the
 * kind of everything in it (§3.3): only original blocks, removed; only new
 * ones, added; both, the change rewrote that stretch.
 */
export function diffBlocks(before: readonly string[], after: readonly string[]): BlockDiff | null {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  const middleBefore = before.slice(head, before.length - tail);
  const middleAfter = after.slice(head, after.length - tail);
  if (middleBefore.length * middleAfter.length > MAX_PAIRS) return null;

  const result: BlockDiff = {
    before: before.map(() => null),
    after: after.map(() => null),
  };
  const matches = commonSubsequence(middleBefore, middleAfter);
  // A sentinel past both ends closes the last gap like every other.
  matches.push([middleBefore.length, middleAfter.length]);

  let fromBefore = 0;
  let fromAfter = 0;
  for (const [atBefore, atAfter] of matches) {
    const lost = atBefore - fromBefore;
    const gained = atAfter - fromAfter;
    const kind: ChangeKind = lost > 0 && gained > 0 ? "changed" : lost > 0 ? "removed" : "added";
    for (let at = fromBefore; at < atBefore; at++) result.before[head + at] = kind;
    for (let at = fromAfter; at < atAfter; at++) result.after[head + at] = kind;
    fromBefore = atBefore + 1;
    fromAfter = atAfter + 1;
  }
  return result;
}

/** The aligned pairs, as `[index in before, index in after]`, in order. */
function commonSubsequence(
  before: readonly string[],
  after: readonly string[],
): Array<[number, number]> {
  const rows = before.length;
  const cols = after.length;
  const width = cols + 1;
  // `length[i * width + j]` is the LCS of `before[i..]` and `after[j..]`.
  const length = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      length[i * width + j] =
        before[i] === after[j]
          ? length[(i + 1) * width + j + 1] + 1
          : Math.max(length[(i + 1) * width + j], length[i * width + j + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (length[(i + 1) * width + j] >= length[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
