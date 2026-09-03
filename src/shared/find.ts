// Spec 28 §4.3 — one matcher, for both processes.
//
// Main runs it over the text it extracts from every document in the workspace
// (`main/search/text.ts`); the renderer runs it over the page's own text index
// (`anchor/textIndex.ts`). The two texts are meant to be the same string, and
// this being the same function is what makes a hit found in main the same hit
// the page paints — same ordinal, same context. Two matchers would agree most
// of the time, which is the worst amount.
//
// No `node:` imports, so it is importable from either side and from `node --test`.

import type { SearchContext, TextPosition } from "./types.ts";

/**
 * How many matches one page paints. The Highlight API is asked to paint every
 * range on every keystroke, and a single letter over a long document is
 * thousands; past this the count reads `k of 1000+` and the reviewer types a
 * second letter.
 */
export const MAX_PAGE_MATCHES = 1000;
/** Spec 28 §4.2 — hit rows kept per file. The rest is `and N more`. */
export const MAX_HITS_PER_FILE = 50;
/** Hit rows kept across the whole workspace. */
export const MAX_HITS_TOTAL = 500;
/** Characters of context either side of a hit, cut at a word (§5.5). */
export const CONTEXT_CHARS = 48;

/**
 * §4.3 — the query's whitespace collapsed to single spaces and trimmed.
 *
 * The index text is (spec 01 §6.3 rule 4), so the query has to be, or a double
 * space typed by accident could never match anything.
 */
export function normaliseQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/** Every character that means something to `RegExp`, made literal. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface FoundMatches {
  matches: TextPosition[];
  /** True when there were more than `max` — the list holds the first `max`. */
  capped: boolean;
}

/**
 * §4.3 — every place `query` occurs in `text`, case folded, non-overlapping.
 *
 * A `RegExp` with `i` and `u` rather than lower-casing both sides: the offsets
 * come back in the original string whatever the folding did to lengths, which
 * `toLowerCase()` on both sides cannot promise (`İ` lower-cases to two code
 * units). The `u` flag makes `i` fold by Unicode's simple case mapping, so `ſ`
 * matches `s` and `K` (the Kelvin sign) matches `k`; nothing folds accents,
 * and that is deliberate (§4.3, §8).
 */
export function findMatches(text: string, query: string, max: number): FoundMatches {
  const needle = normaliseQuery(query);
  if (needle.length === 0 || max <= 0) return { matches: [], capped: false };

  const pattern = new RegExp(escapeRegExp(needle), "giu");
  const matches: TextPosition[] = [];
  for (const match of text.matchAll(pattern)) {
    if (matches.length === max) return { matches, capped: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, capped: false };
}

/**
 * §5.5 — the words around a match, up to `chars` either side, cut at a word.
 *
 * Both processes call this on what they believe is the same text, and the
 * renderer compares the two results to decide which match on the page a hit
 * from main is. So the cut has to be deterministic in the text alone: it is
 * moved inward to the nearest space, never outward, and only when it would
 * otherwise split a word.
 */
export function contextOf(
  text: string,
  position: TextPosition,
  chars: number = CONTEXT_CHARS,
): SearchContext {
  const { start, end } = position;

  let from = Math.max(0, start - chars);
  if (from > 0 && text[from - 1] !== " ") {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < start) from = space + 1;
  }

  let to = Math.min(text.length, end + chars);
  if (to < text.length && text[to] !== " ") {
    const space = text.lastIndexOf(" ", to);
    if (space !== -1 && space >= end) to = space;
  }

  return {
    before: text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, to),
    cutBefore: from > 0,
    cutAfter: to < text.length,
  };
}

/** Two contexts agree when the words either side of the match are the same. */
export function sameContext(one: SearchContext, two: SearchContext): boolean {
  return one.before === two.before && one.after === two.after && one.match === two.match;
}
