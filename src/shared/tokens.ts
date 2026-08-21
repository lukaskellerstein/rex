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
 * GitHub alert callouts (spec 03 §5.2). Each is a rule colour, the wash behind
 * it, and the label CSS draws with `::before` — never real text, or it would
 * enter the anchor text index and move every comment below it.
 *
 * `note` reuses `PAPER.link` and `warning` reuses `HIGHLIGHT.movedRule`, on
 * purpose: a warning callout and a moved anchor are the same amber, so the page
 * carries one meaning per colour.
 */
export const ALERT = {
  note: { rule: "#2f5da8", bg: "#eef3fb", label: "Note" },
  tip: { rule: "#2f7d63", bg: "#eef6f2", label: "Tip" },
  important: { rule: "#7a4fa3", bg: "#f4eff8", label: "Important" },
  warning: { rule: "#c08a12", bg: "#fbf4e4", label: "Warning" },
  caution: { rule: "#b03a2e", bg: "#fbeeec", label: "Caution" },
} as const;

/**
 * Syntax colours for highlight.js's classes (spec 03 §5.7).
 *
 * Mapped onto the paper palette rather than shipping one of highlight.js's own
 * stylesheets, which would be a second, unowned palette beside `PAPER`. Nine
 * classes cover every language REX will meet; anything unmapped inherits
 * `PAPER.inkBody`, which is readable by construction.
 */
export const CODE = {
  keyword: "#7a4fa3",
  string: "#2f7d63",
  comment: PAPER.inkMuted,
  number: "#b03a2e",
  title: PAPER.link,
  attr: "#8a6d1f",
  meta: PAPER.inkMuted,
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
