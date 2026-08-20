// The *document-side* half of the Workbench palette (design/system/Components).
//
// REX's chrome lives in one process and declares its own tokens in
// `renderer/overlay/overlay.css`. These four groups do not: the paper ground and
// its type are written by the Markdown renderer in **main**, while the anchor
// highlights painted on top of them are written by the resolver in the
// **renderer**. A drift between the two shows up as a highlight that no longer
// reads against the page it sits on, so they share one source.
//
// Nothing here may import from main/ or renderer/ — see rules/05-implement.md.

/** The paper the document is printed on, and the ink used on it. */
export const PAPER = {
  /** Ground — deliberately not pure white. */
  bg: "#fbfaf8",
  /** Headings and the strongest text. */
  ink: "#211f1c",
  /** Body copy, one step back from the headings. */
  inkBody: "#3d3a36",
  /** Captions, table notes, anything secondary. */
  inkMuted: "#6b655d",
  /** Rules, table borders. */
  rule: "#e0ddd7",
  /** Table headers, figure grounds — a shade off the paper. */
  wash: "#f2f0ec",
  /** Links inside the document. */
  link: "#2f5da8",
} as const;

/** The document measure. Applies only to Markdown REX renders itself (§5.3). */
export const MEASURE = {
  width: "620px",
  fontSize: "15px",
  lineHeight: "1.68",
} as const;

/**
 * Anchor highlights, painted with the CSS Custom Highlight API (§6.7).
 *
 * The design draws the underline as `box-shadow: 0 1.5px 0`, which a highlight
 * pseudo-element cannot take: `::highlight()` accepts only colour,
 * background-color, text-decoration, text-shadow and -webkit-text-stroke. The
 * underline is therefore a `text-decoration`, which is the same 1.5px rule in
 * the same colour and the only form the API will paint.
 */
export const HIGHLIGHT = {
  /** Resolved exactly — steel. */
  okBg: "#dbe6f6",
  okRule: "#2f5da8",
  /** Re-found after the text changed — amber. */
  movedBg: "#fbeecd",
  movedRule: "#c08a12",
  /** A resolved thread, drained of colour but still findable. */
  resolvedBg: "#e9e7e2",
} as const;
