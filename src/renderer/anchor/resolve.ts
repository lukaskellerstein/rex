// SPEC.md §6.5 — Anchor → Range. Layers are tried in order and the first
// success wins; failing all of them is `orphaned`, which is a normal outcome
// and never a lost comment (§6.6).

import diff_match_patch from "diff-match-patch";
import type { Anchor, AnchorState, TextPosition } from "../../shared/types.ts";
import { fingerprintElement, isStableId } from "./create.ts";
import { offsetsToRange, type TextIndex } from "./textIndex.ts";

/** 1 = quote (exact or disambiguated), 2 = fuzzy, 3 = element. */
export type AnchorLayer = 1 | 2 | 3;

/**
 * How layer 3 found its element, in descending order of trust.
 *
 * `id` and `identity` both *name* the element — an id attribute, or one of the
 * identifying selectors `create.ts` prefers (`aria-label`, `data-testid`,
 * `name`, `title`), each of which it verified matched exactly one element when
 * the anchor was written. `path` merely describes where the element used to
 * sit, and is the case `create.ts` warns "still matches something, so the
 * comment lands on an unrelated paragraph".
 */
export type ElementMatch = "id" | "identity" | "path";

/**
 * A stored selector is positional exactly when `generateCssPath()` had to fall
 * back to `nth-of-type` — it breaks out of its walk the moment it finds an
 * identity, so a selector without one was identity all the way up.
 */
function matchKindOf(css: string): ElementMatch {
  return css.includes(":nth-of-type(") ? "path" : "identity";
}

export type Resolution =
  | { kind: "range"; range: Range; layer: AnchorLayer }
  | { kind: "element"; element: Element; layer: AnchorLayer; matchedBy: ElementMatch };

/** SPEC.md §6.5 step 3 — 0 is exact, 1 accepts anything. */
const MATCH_THRESHOLD = 0.25;
/** How far from the expected position the Bitap search looks. */
const MATCH_DISTANCE = 5000;

/**
 * Bitap works on a machine word, so diff-match-patch refuses a pattern longer
 * than `Match_MaxBits` (32) outright. A long quote is therefore located by its
 * opening 32 characters and then *verified* over its whole length — without
 * that second step a shared opening phrase would resolve confidently into the
 * wrong paragraph, which is exactly the silent failure §13 exists to catch.
 */
const MAX_VERIFY_ERROR = 0.25;

const dmp = new diff_match_patch();
dmp.Match_Threshold = MATCH_THRESHOLD;
dmp.Match_Distance = MATCH_DISTANCE;

/** Every index at which `needle` occurs in `haystack`. */
function allIndicesOf(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  if (needle.length === 0) return hits;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    hits.push(i);
  }
  return hits;
}

/** Length of the longest common suffix of `a` and `b`. */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the longest common prefix of `a` and `b`. */
function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** SPEC.md §6.5 step 2 — pick between repeats of the same quote by context. */
function disambiguate(index: TextIndex, anchor: Anchor, hits: number[]): number {
  const quote = anchor.quote;
  const expected = anchor.position?.start ?? 0;
  let best = hits[0];
  let bestScore = -1;

  for (const hit of hits) {
    const before = index.text.slice(Math.max(0, hit - (quote?.prefix.length ?? 0)), hit);
    const after = index.text.slice(
      hit + (quote?.exact.length ?? 0),
      hit + (quote?.exact.length ?? 0) + (quote?.suffix.length ?? 0),
    );
    const score =
      commonSuffixLength(before, quote?.prefix ?? "") +
      commonPrefixLength(after, quote?.suffix ?? "");

    if (score > bestScore) {
      best = hit;
      bestScore = score;
    } else if (score === bestScore && Math.abs(hit - expected) < Math.abs(best - expected)) {
      // Tie — the hit nearest the original position wins (§6.5 step 2).
      best = hit;
    }
  }
  return best;
}

/** SPEC.md §6.5 step 3 — bounded fuzzy search, then verification. */
function fuzzy(index: TextIndex, anchor: Anchor): TextPosition | null {
  const exact = anchor.quote?.exact;
  if (!exact) return null;

  const probe = exact.slice(0, Math.min(exact.length, dmp.Match_MaxBits));
  const expected = Math.min(anchor.position?.start ?? 0, index.text.length);
  const at = dmp.match_main(index.text, probe, expected);
  if (at === -1) return null;

  const candidate = index.text.slice(at, at + exact.length);
  const distance = dmp.diff_levenshtein(dmp.diff_main(exact, candidate));
  if (distance / exact.length > MAX_VERIFY_ERROR) return null;

  return { start: at, end: Math.min(at + exact.length, index.text.length) };
}

/**
 * SPEC.md §6.5 step 4 — the only layer an image, SVG or table ever had.
 *
 * Reports *how* it matched, not just what: an id written by hand identifies the
 * element wherever it moves to, while a `nth-of-type` path identifies a slot
 * that something else may now occupy.
 */
function resolveElement(
  index: TextIndex,
  anchor: Anchor,
): { element: Element; matchedBy: ElementMatch } | null {
  const ref = anchor.element;
  if (!ref) return null;
  // Screened again rather than trusted: the id was judged stable when the
  // anchor was written, possibly by an older build with a shorter list.
  if (ref.id && isStableId(ref.id)) {
    const byId = index.doc.getElementById(ref.id);
    if (byId) return { element: byId, matchedBy: "id" };
  }
  if (ref.css) {
    try {
      const found = index.doc.querySelector(ref.css);
      if (found) return { element: found, matchedBy: matchKindOf(ref.css) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A region anchor points at a box inside an element, so the element is what has
 * to be found — its caption is context, not the target, and resolving through
 * the caption text would land the box on whatever now sits at those offsets.
 *
 * The fingerprint is the whole reason this is separate: geometry always
 * resolves, so without a content check a redrawn figure would report success
 * while pointing at new content. A mismatch orphans, which §6.6 makes a normal
 * outcome — the comment and its quote are kept either way.
 */
function resolveRegion(index: TextIndex, anchor: Anchor): Resolution | null {
  const found = resolveElement(index, anchor);
  if (!found) return null;

  const expected = anchor.region?.fingerprint;
  if (expected && fingerprintElement(found.element) !== expected) return null;

  return { kind: "element", element: found.element, layer: 3, matchedBy: found.matchedBy };
}

/** SPEC.md §6.5 — run the layers in order, stop at the first success. */
export function resolveAnchor(index: TextIndex, anchor: Anchor): Resolution | null {
  if (anchor.region) return resolveRegion(index, anchor);

  const exact = anchor.quote?.exact;

  if (exact) {
    // Layer 3 is deliberately NOT a fallback for a text anchor. Measured on the
    // milestone 0 documents: when a quoted passage is deleted outright, its
    // element ref — a positional CSS path — still matches *something*, so the
    // comment lands on an unrelated paragraph and reports `moved`. That is the
    // silent wrong-place failure §6.1 and §13 exist to prevent, and orphaning
    // costs nothing: §6.6 keeps the thread, its quote and its history in the
    // orphan tray. Layer 3 stays what §6.2 describes it as — the layer for
    // things that have no text.
    const hits = allIndicesOf(index.text, exact);

    if (hits.length === 1) {
      const range = offsetsToRange(index, { start: hits[0], end: hits[0] + exact.length });
      if (range) return { kind: "range", range, layer: 1 };
    } else if (hits.length > 1) {
      const hit = disambiguate(index, anchor, hits);
      const range = offsetsToRange(index, { start: hit, end: hit + exact.length });
      if (range) return { kind: "range", range, layer: 1 };
    }

    const approximate = fuzzy(index, anchor);
    if (approximate) {
      const range = offsetsToRange(index, approximate);
      if (range) return { kind: "range", range, layer: 2 };
    }

    return null;
  }

  const found = resolveElement(index, anchor);
  if (found) {
    return { kind: "element", element: found.element, layer: 3, matchedBy: found.matchedBy };
  }

  return null;
}

/**
 * SPEC.md §6.6 — the state the UI shows, from the layer that resolved and
 * whether the file changed underneath. `moved` means "found, but not where or
 * not how it was"; it earns a badge, not a hidden comment.
 *
 * Layer 3 is graded rather than condemned wholesale. Reporting `moved` for
 * every element anchor was tolerable while they were a rare fallback, but the
 * design makes them a primary way to comment — on a table, a figure, a section —
 * and a badge that appears on an untouched document trains people to ignore it.
 * An element found by name on unchanged bytes is an exact match and says so; a
 * match found only through a positional path genuinely earns the badge.
 */
export function anchorStateFor(
  resolution: Resolution | null,
  documentChanged: boolean,
): AnchorState {
  if (!resolution) return "orphaned";
  if (documentChanged) return "moved";
  if (resolution.layer === 1) return "ok";
  return resolution.kind === "element" && resolution.matchedBy !== "path" ? "ok" : "moved";
}
