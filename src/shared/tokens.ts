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

/**
 * Spec 27 §4.4 — the same paper, at night.
 *
 * Every value is its light counterpart at the **same hue** and the mirrored
 * lightness. That rule is not a style preference: spec 18 gives each colour in
 * REX a meaning, and a meaning that changed with the mode would be a second
 * vocabulary. Hue is the meaning; lightness is the mode.
 *
 * The ground is WARM, and that is the one value worth defending. REX's chrome
 * is `--bg: #0e1012` with `--panel: #191c1f`, both cool near-blacks. A cool
 * paper on cool chrome is one surface; a warm paper on cool chrome is still a
 * sheet lying on a desk, which is the whole picture spec 03 §5 started from.
 *
 * **`#24221f` and not the `#1b1a18` this was first written as.** That value
 * measured 1.10:1 against the shell's ground and 1.02:1 against the sidebar it
 * sits beside — a document that stopped being a separate surface at all. It was
 * caught by the assertion in `test/paper.spec.ts` and not by looking, which is
 * the whole argument for measuring two dark greys instead of choosing them.
 *
 * Nothing reads this unless the reviewer pressed the switch. REX never follows
 * `prefers-color-scheme` for its own paper — spec 27 §8, and the reason the
 * comment at the top of `render/stylesheet.ts` was right to refuse it.
 */
export const PAPER_DARK = {
  bg: "#24221f",
  ink: "#f4f2ee",
  inkBody: "#dbd7d0",
  inkMuted: "#9b948a",
  rule: "#3f3b35",
  /** A shade off the paper — which in the dark means one step *up*. */
  wash: "#2c2a26",
  link: "#7fa8e8",
} as const;

/** Spec 27 §4.4 — the text selection, on each ground. */
export const SELECT = {
  light: "#b6d0f2",
  dark: "#2f4a6d",
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
 * Spec 27 §4.4 — the same five callouts on the dark paper.
 *
 * Same hue, mirrored lightness, and no label: a callout's word is the same word
 * on either ground, so it stays in `ALERT` and is read from there. Five kinds,
 * exactly the five above — `test/paper.spec.ts` asserts that the two tables can
 * never drift apart.
 */
export const ALERT_DARK = {
  note: { rule: "#7fa8e8", bg: "#172032" },
  tip: { rule: "#6cbb9c", bg: "#142320" },
  important: { rule: "#b389d6", bg: "#201a2b" },
  warning: { rule: "#d9ac3c", bg: "#2a2213" },
  caution: { rule: "#e0796a", bg: "#2b1a17" },
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

/** Spec 27 §4.4 — the same seven classes on the dark paper. */
export const CODE_DARK = {
  keyword: "#b389d6",
  string: "#6cbb9c",
  comment: PAPER_DARK.inkMuted,
  number: "#e0796a",
  title: PAPER_DARK.link,
  attr: "#cba94f",
  meta: PAPER_DARK.inkMuted,
} as const;

/**
 * Anchor highlights, painted with the CSS Custom Highlight API (§6.7).
 *
 * The design draws the underline as `box-shadow: 0 1.5px 0`, which a highlight
 * pseudo-element cannot take: `::highlight()` accepts only colour,
 * background-color, text-decoration, text-shadow and -webkit-text-stroke. The
 * underline is therefore a `text-decoration`, which is the same 1.5px rule in
 * the same colour and the only form the API will paint.
 *
 * **Every wash below is near-white, so whatever paints it must state `PAPER.ink`
 * beside it.** These were drawn against `PAPER`, the ground of the Markdown REX
 * renders itself. A local HTML file is rendered untouched (spec 01 §5.4 point
 * 3), so one that themes itself dark keeps its own near-white body text — and
 * on 2026-08-26 that measured 1.0:1 against `activeBg`, which is a highlighted
 * passage nobody can read. `highlight.ts` pairs the two; a wash used anywhere
 * else must do the same.
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
  /**
   * The comment whose card is open — violet, and deliberately a fourth colour.
   *
   * Steel and amber say what *state* an anchor is in; they cannot also say
   * which comment is being read. Blue is the selection's (spec 05 §6) and red
   * is the write-capable agent's, so a reviewer holding a half-built selection
   * while reading a comment had two blues on the page meaning two things.
   */
  activeBg: "#ece1f7",
  activeRule: "#7a4fa3",
  /**
   * Spec 15 §8.4 — the comment being pointed at, in the same violet at half
   * strength and with no rule under it.
   *
   * `okBg`, `movedBg` and `resolvedBg` above are no longer painted on text.
   * They are kept because the bar in the margin and the card wash are drawn in
   * the same three colours, and one table of them is what keeps all three
   * places agreeing about what steel and amber mean.
   */
  hoverBg: "#f4eefb",
  /**
   * Spec 28 §4.4 — the reviewer's question: every match of a find, in lemon.
   *
   * A third family beside spec 18's two. Yellow because nothing amber has been
   * painted on text since spec 15 §8.4, and because it is what every editor
   * paints a find in. Lemon and not gold: `--moved` is `#d9b23a`, and a find
   * wash beside a moved pill must not read as the same thing.
   */
  findBg: "#fff1a8",
  /** The match the reviewer is on — the same yellow, stronger, with a rule. */
  findCurrentBg: "#ffd21f",
  findRule: "#8a6a00",
} as const;
