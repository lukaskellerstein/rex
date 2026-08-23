// What one of a comment's places IS, in words — for the card and the list.
//
// THE RULE THIS FILE EXISTS FOR. A comment's quote is shown as a quote, in
// Newsreader italic, because a passage read back is how a reviewer recognises
// what they wrote about. That treatment is a claim: *this is prose*. It is
// wrong for a code block, a table or a figure, and wrongest exactly where it
// is most tempting — `createElementAnchor` records the block's whole text, and
// `TextIndex` normalisation flattens every newline out of it, so a comment on
//
//     tilecat warp input.tif output.tif \
//       --to-crs EPSG:3857 \
//       --resample bilinear
//
// came out as one unreadable line of italic serif claiming to be a sentence.
//
// So a place with no prose to quote is named instead: `Code block`, `Table`,
// `Section · “…”`. The live DOM gives the better name — `describeElement` can
// say `Table · 3 rows × 4 columns` because it can count them — and this file
// is the fallback for the places the sweep could not look at, because their
// document is not the one on screen.

import type { Anchor } from "../../shared/types.ts";

/**
 * Blocks whose text is not prose. `img`, `svg` and `canvas` have none at all;
 * `pre` and `table` have text that means nothing without its layout.
 */
const BLOCK_NAMES: Record<string, string> = {
  pre: "Code block",
  code: "Code block",
  table: "Table",
  thead: "Table header",
  tbody: "Table body",
  tr: "Table row",
  figure: "Figure",
  img: "Image",
  svg: "Drawing",
  canvas: "Drawing",
  video: "Video",
};

/**
 * The tag a stored CSS path ends on.
 *
 * `generateCssPath` writes `html > body > pre:nth-of-type(3)`, and may end on
 * an identity step instead — `#install`, `svg[aria-label="…"]` — so the
 * qualifiers come off before the tag is read. An identity step with no tag in
 * front of it (`#install`) yields nothing, which is correct: an id says which
 * element, never what kind it is.
 */
function tagOfPath(css: string | undefined): string | null {
  const last = css?.split(">").pop()?.trim();
  if (!last) return null;
  const tag = last.replace(/[#.:[].*$/, "").toLowerCase();
  return tag.length > 0 ? tag : null;
}

/**
 * What this place is, from the stored anchor alone — or null when the anchor
 * really does hold a passage, which is the case that keeps its quote.
 *
 * Deliberately conservative. Guessing "Code block" about a paragraph would
 * hide the one line that tells the reviewer which comment they are looking at.
 */
export function storedPlaceLabel(anchor: Anchor): string | null {
  if (anchor.extent === "document") return "The whole document";
  if (anchor.extent === "section") {
    // Spec 06 §4.3 — a section anchor stores its HEADING's text, so the quote
    // is the title rather than the passage it covers.
    const heading = anchor.quote?.exact?.trim();
    return heading ? `Section · “${heading}”` : "Section";
  }

  const kind = BLOCK_NAMES[tagOfPath(anchor.element?.css) ?? ""] ?? null;
  if (anchor.region) return kind ? `Region of ${kind}` : "Region";
  if (kind) return kind;

  // No quote and nothing that names a kind: an element anchor on something
  // with no text of its own. Named for what it is rather than left blank.
  return anchor.quote?.exact ? null : "Block";
}

/**
 * The two lines a place shows: where it is, and what it is.
 *
 * `label` and `quote` are exclusive by construction — a place that can be
 * named is never also quoted — so a caller never has to decide between them.
 */
export interface PlaceWords {
  label: string | null;
  quote: string | null;
}

/**
 * `swept` is what the resolver found this place to be against the live DOM,
 * and it wins: it can count a table's rows and read a figure's caption, and
 * this file cannot. Null means the sweep could not look — the place is in a
 * document that is not open — and the stored anchor answers instead.
 */
export function placeWords(anchor: Anchor, swept: string | null): PlaceWords {
  const label = swept ?? storedPlaceLabel(anchor);
  return { label, quote: label ? null : (anchor.quote?.exact ?? null) };
}
