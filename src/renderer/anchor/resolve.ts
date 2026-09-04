// SPEC.md §6.5 — Anchor → Range. Layers are tried in order and the first
// success wins; failing all of them is `orphaned`, which is a normal outcome
// and never a lost comment (§6.6).

import diff_match_patch from "diff-match-patch";
import { findPart, fingerprintSource } from "../../shared/diagram.ts";
import {
  type Anchor,
  type AnchorExtent,
  type AnchorState,
  ELEMENT_QUOTE_MAX,
  type ElementRef,
  type TextPosition,
} from "../../shared/types.ts";
import { fingerprintElement, isStableId } from "./create.ts";
import { elementForPart, fenceLineOf, partsOf, sourceOf } from "./diagram.ts";
import { blockOf, resolveGap } from "./gap.ts";
import {
  closestHeading,
  documentRunFor,
  type ElementRun,
  isHeading,
  sectionRunFor,
} from "./section.ts";
import { elementToOffsets, offsetsToRange, rangeToOffsets, type TextIndex } from "./textIndex.ts";

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
 *
 * `document` is the whole-file target of spec 06 §4.3, which names nothing
 * inside the document and so had nothing to find.
 */
export type ElementMatch = "id" | "identity" | "path" | "document";

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
  | {
      kind: "element";
      element: Element;
      layer: AnchorLayer;
      matchedBy: ElementMatch;
      /**
       * Spec 29 §5.4 — the source line the place is on NOW, when the resolver
       * knows better than the nearest `data-src-line` stamp. A diagram part
       * sits inside a `<pre>` stamped with the fence's opening line; the part
       * itself is some lines below it, and this says how many.
       */
      line?: number;
    }
  /**
   * Spec 06 §4.4 — a run of sibling blocks: a section, or a whole document.
   *
   * Neither is an element and neither is a range, because in a rendered
   * Markdown or DOCX document the blocks are siblings rather than a subtree
   * (§4.2). The box for a run is the union of `first` and `last`'s rects, and
   * because both are measured live it re-flows exactly like every other box.
   */
  | {
      kind: "run";
      first: Element;
      last: Element;
      layer: AnchorLayer;
      matchedBy: ElementMatch;
      extent: AnchorExtent;
    }
  /**
   * Spec 16 §6.5 — a place BETWEEN two blocks, which is none of the three
   * above: there is no range to paint, no element to outline, and no run.
   *
   * At least one of `after` and `before` is non-null. A resolution that found
   * neither is not returned at all — it is `null`, which `anchorStateFor`
   * already turns into `orphaned`.
   */
  | {
      kind: "gap";
      /** The block above, when this resolution found it. */
      after: Element | null;
      /** The block below, when it found that. */
      before: Element | null;
      layer: AnchorLayer;
    };

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

  const candidates: Array<{ element: Element; matchedBy: ElementMatch }> = [];
  // Screened again rather than trusted: the id was judged stable when the
  // anchor was written, possibly by an older build with a shorter list.
  if (ref.id && isStableId(ref.id)) {
    const byId = index.doc.getElementById(ref.id);
    if (byId) candidates.push({ element: byId, matchedBy: "id" });
  }
  if (ref.css) {
    try {
      const found = index.doc.querySelector(ref.css);
      if (found) candidates.push({ element: found, matchedBy: matchKindOf(ref.css) });
    } catch {
      return null;
    }
  }

  // Spec 11 §5.2 steps 2 and 3 — with a fingerprint stored, each candidate has
  // to still *be* what it was, and the first that is wins. That is what lets a
  // deck anchor survive a shape being inserted above it: the id now points at
  // the wrong shape and fails, and the name selector finds the right one.
  //
  // Without a fingerprint — every prose anchor — the first candidate wins
  // exactly as before, and nothing about resolving prose changes.
  if (!ref.fingerprint) return candidates[0] ?? null;
  return candidates.find((found) => fingerprintElement(found.element) === ref.fingerprint) ?? null;
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

/** SPEC.md §6.5 layers 1 and 2 — the quote, exact then fuzzy. */
function resolveQuote(
  index: TextIndex,
  anchor: Anchor,
): { range: Range; layer: AnchorLayer } | null {
  const exact = anchor.quote?.exact;
  if (!exact) return null;

  const hits = allIndicesOf(index.text, exact);

  if (hits.length === 1) {
    const range = offsetsToRange(index, { start: hits[0], end: hits[0] + exact.length });
    if (range) return { range, layer: 1 };
  } else if (hits.length > 1) {
    const hit = disambiguate(index, anchor, hits);
    const range = offsetsToRange(index, { start: hit, end: hit + exact.length });
    if (range) return { range, layer: 1 };
  }

  const approximate = fuzzy(index, anchor);
  if (approximate) {
    const range = offsetsToRange(index, approximate);
    if (range) return { range, layer: 2 };
  }

  return null;
}

/** Spec 06 §4.4 — the file itself. It never fails while the document opens. */
function resolveDocument(index: TextIndex): Resolution | null {
  const run = documentRunFor(index.doc);
  if (!run) return null;
  return { kind: "run", ...run, layer: 1, matchedBy: "document", extent: "document" };
}

/**
 * Spec 06 §4.4 — resolve the **heading** through the existing layers, then walk
 * its siblings by §4.2 to find where the run ends.
 *
 * The id comes first here, unlike a text anchor, because a section anchor names
 * an element rather than quoting a passage: in Markdown that id is a
 * hand-written slug (`markdown-it-anchor`), which survives a rebuild that
 * rewords every heading around it. Each candidate is checked to still *be* a
 * heading — an id that now points at a paragraph is a document restructured
 * underneath the comment, and there is no run to walk from.
 */
function resolveSection(index: TextIndex, anchor: Anchor): Resolution | null {
  const found = ((): { heading: Element; layer: AnchorLayer; matchedBy: ElementMatch } | null => {
    const ref = anchor.element;
    if (ref?.id && isStableId(ref.id)) {
      const byId = index.doc.getElementById(ref.id);
      if (byId && isHeading(byId)) return { heading: byId, layer: 1, matchedBy: "id" };
    }

    const quoted = resolveQuote(index, anchor);
    const heading = quoted ? closestHeading(quoted.range.commonAncestorContainer) : null;
    if (quoted && heading) return { heading, layer: quoted.layer, matchedBy: "identity" };

    const byElement = resolveElement(index, anchor);
    if (byElement && isHeading(byElement.element)) {
      // A **positional** path is deliberately not a fallback for a heading that
      // had a quote, for exactly the reason §6.5 already refuses one for a text
      // anchor: `section:nth-of-type(4) > div > h2` still matches *something*
      // after a section above it is deleted, so a reworded heading would resolve
      // onto its neighbour and report `moved`. That is this feature's version of
      // the silent wrong-place failure — §10 milestone 9 names it — and
      // orphaning costs nothing, because §6.6 keeps the comment and its quote.
      //
      // An *identity* path is a different thing and stays: it names the element,
      // and `create.ts` verified it matched exactly one when the anchor was
      // written. So is a path on a heading that never had text to lose.
      if (byElement.matchedBy !== "path" || !anchor.quote?.exact) {
        return { heading: byElement.element, layer: 3, matchedBy: byElement.matchedBy };
      }
    }

    return null;
  })();

  if (!found) return null;
  const run: ElementRun = sectionRunFor(found.heading);
  return { kind: "run", ...run, layer: found.layer, matchedBy: found.matchedBy, extent: "section" };
}

/**
 * Whether a block still holds the text a neighbour was written from.
 *
 * `createElementAnchor` records a block's own text, truncated at
 * `ELEMENT_QUOTE_MAX`. So a short quote IS the block's entire text and a
 * truncated one is its opening — and anything else is a *different* block that
 * happens to contain the same words.
 *
 * Measured on 2026-08-26 against `components.md`: the gap below the last bullet
 * of the deleted Specification Toolkit section resolved its lower neighbour —
 * the `<h2>Specification Toolkit</h2>` — onto a list item reading
 * "Specification Toolkit — The portable set of skills…" three hundred lines
 * higher up. The quote matched, exactly once, and the gap reported `ok`.
 */
function isStillTheBlock(index: TextIndex, block: Element, stored: string): boolean {
  const span = elementToOffsets(index, block);
  if (!span) return false;
  const text = index.text.slice(span.start, span.end);
  return stored.length >= ELEMENT_QUOTE_MAX ? text.startsWith(stored) : text === stored;
}

/**
 * The kind of block an element ref names — `h2`, `li`, `table` — or null when
 * the ref does not say, in which case nothing is checked and nothing changes.
 *
 * `ElementRef.tag` says it outright on every anchor made since 2026-09-04. An
 * older ref may still say it through its CSS path, whose last segment is a tag
 * unless a stable id replaced the whole path with `#id` — and then it is null.
 *
 * Measured on 2026-09-04 against `documentation-sample/one/sample-document.md`:
 * the gap below the last roadmap item resolved its lower neighbour — the
 * deleted `<h2 id="faq">FAQ</h2>` — onto the table of contents entry
 * `<li>FAQ</li>`, two hundred lines higher up, and the gap reported `ok`.
 * `isStillTheBlock` was satisfied, correctly: an `<li>` reading "FAQ" is a
 * block whose entire text is "FAQ". The quote cannot tell a heading from the
 * entry that points at it, and the path could not either, because the stable
 * id had reduced it to `#faq`. The tag can, so the ref now carries it.
 */
function kindNamed(ref: ElementRef | null | undefined): string | null {
  if (ref?.tag) return ref.tag.toLowerCase();
  const css = ref?.css;
  if (!css) return null;
  const last = css.split(">").pop()?.trim() ?? "";
  const tag = /^([a-z][a-z0-9-]*)/i.exec(last);
  return tag ? tag[1].toLowerCase() : null;
}

/**
 * The block a quote match turns out to be a pick OF, rather than a passage IN.
 *
 * Two anchors reach the quote layer and they mean different things. A text
 * selection is about the words the reviewer dragged over. A block pick — a
 * paragraph, a table, a card — is about the whole block, and its quote is only
 * the key `createElementAnchor` recorded to find it again, truncated at
 * `ELEMENT_QUOTE_MAX` so a long table does not store a copy of itself.
 *
 * Until 2026-08-26 both were painted as the range that matched, so a comment on
 * an eight-paragraph block wore a wash over its first 320 characters, stopping
 * mid-word. It read as "the comment is about this much", which was not true —
 * and it was the wash spec 15 §8.4 had already ruled out for exactly this
 * reason. An element resolution is outlined and never filled (`anchoring.ts`),
 * and the bar in the margin already spans the block, so the block pick says
 * what it covers without painting a word of it.
 *
 * The test is geometric rather than a stored flag, because that fixes the
 * anchors already in the database as well as the ones written next. It asks the
 * one question that separates the two: does the match START where its block
 * starts, and then either cover the block or stop exactly at the cap?
 *
 * A drag selection that happens to cover a whole paragraph reads as a block
 * pick under this test. That is not a defect worth a flag: the two say the same
 * thing about the same words, and only their paint differs.
 */
function blockPickedBy(index: TextIndex, anchor: Anchor, range: Range): Element | null {
  // No element ref means nothing named a block — a stored position only.
  if (!anchor.element) return null;

  const block = blockOf(range.commonAncestorContainer);
  if (!block) return null;

  const span = elementToOffsets(index, block);
  const found = rangeToOffsets(index, range);
  if (!span || !found || found.start !== span.start) return null;

  // It covers the block outright. However it was made, it is about the block.
  if (found.end === span.end) return block;

  // Or the block is longer than the match, and the match stopped EXACTLY at the
  // cap — which is `createElementAnchor` truncating, and nothing else. `>=`
  // would be wrong here: a dragged selection that starts at a block's first
  // character and runs past 320 of them is a passage, not a block, and the
  // reviewer chose where it ends.
  return (anchor.quote?.exact.length ?? 0) === ELEMENT_QUOTE_MAX ? block : null;
}

/**
 * Spec 16 §6.3 — one side of a gap, resolved to the block it names.
 *
 * **Deliberately the strictest resolution in REX**, and the gate is what made
 * it so. A gap looks the same everywhere, so a neighbour found in the wrong
 * place cannot be seen; and the cost of refusing a doubtful one is only a
 * `moved` badge, because the other side is still holding the place. Two rules
 * follow:
 *
 *  · A side with text resolves through its quote and then has to still BE that
 *    block. Fuzzy is not enough on its own, and neither is an exact hit.
 *  · A side with no text at all — an image, a drawing — may use its element
 *    ref, but only where that ref NAMES the element. A positional path still
 *    matches something after an edit, and that something is a silent wrong
 *    place. The same rule §6.5 already applies to a text anchor.
 */
function resolveNeighbour(index: TextIndex, side: Anchor): Element | null {
  const stored = side.quote?.exact ?? null;

  if (stored) {
    const quoted = resolveQuote(index, side);
    if (!quoted) return null;
    const block = blockOf(quoted.range.commonAncestorContainer);
    if (!block || !isStillTheBlock(index, block, stored)) return null;
    //  · And it has to be the same KIND of block. `isStillTheBlock` asks
    //    whether the whole block reads as the stored quote, and a table of
    //    contents entry reads exactly as the heading it points at.
    const kind = kindNamed(side.element);
    return kind === null || block.tagName.toLowerCase() === kind ? block : null;
  }

  const found = resolveElement(index, side);
  return found && found.matchedBy !== "path" ? (blockOf(found.element) ?? found.element) : null;
}

/**
 * Spec 29 §5.4 — a part of a Mermaid diagram, found in the fence's source.
 *
 * Step 1 finds the diagram: every drawn fence whose source has the stored
 * fingerprint; else the `<pre>` the element ref names, if it still holds the
 * part's text; else the one fence anywhere that does. Step 2 finds the part in
 * that source by what names it — an id, two ends, a run of text — and never by
 * a line number alone. Step 3 hands back the part's SVG element from the map,
 * or the `<pre>` when the map has none for it: a drawing detail never orphans
 * a comment about the text.
 *
 * The layer says how sure the find was, and `anchorStateFor` reads it as it
 * reads every other anchor's: an untouched fence is 1 and `ok`; a changed fence
 * whose part is still named is 3 and `ok` — a node whose label was edited two
 * lines away is the same node; a `lines` part found by its text in a changed
 * fence, or any part found only by searching every fence, is 2 and `moved`.
 */
function resolveDiagram(index: TextIndex, anchor: Anchor): Resolution | null {
  const ref = anchor.diagram;
  if (!ref) return null;
  const blocks = [...index.doc.querySelectorAll<HTMLElement>("pre.rex-mermaid")];
  if (blocks.length === 0) return null;

  // The element ref names the `<pre>` — a hint, since its id moves with the
  // fence (§1.2). It is read once here and consulted twice below.
  const named = resolveElement(index, anchor)?.element ?? null;
  const holds = (b: HTMLElement) => findPart(partsOf(b), ref);

  let block: HTMLElement | null = null;
  let layer: AnchorLayer = 1;
  const same = blocks.filter((b) => fingerprintSource(sourceOf(b)) === ref.fingerprint);
  if (same.length > 0) {
    // Two identical diagrams: the one the ref names, if it is among them.
    block = same.find((b) => b === named) ?? same[0];
  } else {
    if (named && blocks.includes(named as HTMLElement) && holds(named as HTMLElement)) {
      block = named as HTMLElement;
      layer = 3;
    } else {
      const holding = blocks.filter((b) => holds(b) !== null);
      if (holding.length !== 1) return null;
      block = holding[0];
      layer = 2;
    }
    // A `lines` part is named by nothing but its text, and the text now sits
    // among different neighbours: found, and `moved`.
    if (ref.part.kind === "lines") layer = 2;
  }

  const found = holds(block);
  if (!found) return null;
  const fenceLine = fenceLineOf(block);
  return {
    kind: "element",
    element: elementForPart(block, found.part) ?? block,
    layer,
    matchedBy: "identity",
    ...(fenceLine === null ? {} : { line: fenceLine + found.lines.from }),
  };
}

/** SPEC.md §6.5 — run the layers in order, stop at the first success. */
export function resolveAnchor(index: TextIndex, anchor: Anchor): Resolution | null {
  // Spec 29 §5.4 — first of all, before even a gap: a diagram part is narrower
  // than any extent and never has one, and the thing it names is not on the
  // page as text.
  if (anchor.diagram) return resolveDiagram(index, anchor);
  // Spec 16 §6.3 — read before the four layers, beside `region` and `extent`.
  // A gap names no text and no element of its own, so none of them applies.
  if (anchor.gap) {
    const found = resolveGap(anchor.gap, (side) => resolveNeighbour(index, side));
    // The layer is not consulted for a gap — `anchorStateFor` branches on which
    // neighbours matched instead (§6.5) — so it records the strongest thing
    // that could have found either side.
    return found ? { kind: "gap", ...found, layer: 1 } : null;
  }
  // Spec 06 §4.4 — `extent` is consulted first, exactly as `region` already is.
  if (anchor.extent === "document") return resolveDocument(index);
  if (anchor.extent === "section") return resolveSection(index, anchor);
  if (anchor.region) return resolveRegion(index, anchor);

  if (anchor.quote?.exact) {
    // Layer 3 is deliberately NOT a fallback for a text anchor. Measured on the
    // milestone 0 documents: when a quoted passage is deleted outright, its
    // element ref — a positional CSS path — still matches *something*, so the
    // comment lands on an unrelated paragraph and reports `moved`. That is the
    // silent wrong-place failure §6.1 and §13 exist to prevent, and orphaning
    // costs nothing: §6.6 keeps the thread, its quote and its history in the
    // orphan tray. Layer 3 stays what §6.2 describes it as — the layer for
    // things that have no text.
    const quoted = resolveQuote(index, anchor);
    if (quoted) {
      // Spec 06 §4.4 — the quote found the place; what the comment COVERS is a
      // separate question, and for a block pick the answer is the block.
      const block = blockPickedBy(index, anchor, quoted.range);
      return block
        ? { kind: "element", element: block, layer: quoted.layer, matchedBy: "identity" }
        : { kind: "range", range: quoted.range, layer: quoted.layer };
    }

    // Spec 11 §5.2 — the one exception, and it is the reason the exception is
    // safe rather than a hole in the rule above. A fingerprinted element ref is
    // not "something that still matches": it is an element whose content is
    // byte-for-byte what it was when the comment was written. A shape whose
    // text the reviewer cannot find any more, on a slide that has not been
    // touched, is a shape the quote layer missed — not a different shape.
    //
    // Only a deck stores one, so a prose anchor cannot take this path at all.
    if (anchor.element?.fingerprint) {
      const found = resolveElement(index, anchor);
      if (found) {
        return { kind: "element", element: found.element, layer: 3, matchedBy: found.matchedBy };
      }
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
  // Spec 16 §6.3 — before the layer tests, because the question a gap answers
  // is which NEIGHBOURS matched rather than which layer found them.
  //
  // A single-sided match is `moved` and never `ok`: one of the two things that
  // defined this place has gone, and a gap that resolved three paragraphs late
  // looks exactly like a gap that did not. This is the one anchor kind whose
  // wrong answer is invisible, so it is the one that reports doubt.
  if (resolution.kind === "gap") {
    if (documentChanged) return "moved";
    return resolution.after && resolution.before ? "ok" : "moved";
  }
  // Spec 06 §4.5 — a document target is always `ok` while its document opens,
  // and never `moved`. That is not a weakness in the model, it is the point: it
  // is the one comment whose subject cannot be edited away, so "is this file
  // still accurate?" is still waiting a month later whatever happened to the
  // prose.
  if (resolution.kind === "run" && resolution.extent === "document") return "ok";
  if (documentChanged) return "moved";
  if (resolution.layer === 1) return "ok";
  // Fuzzy found it somewhere other than where it was, whatever kind it is.
  if (resolution.layer === 2) return "moved";
  return resolution.kind !== "range" && resolution.matchedBy !== "path" ? "ok" : "moved";
}
