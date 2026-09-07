// The line icons the design draws, in one place so a stroke weight cannot
// drift between two screens. Every path is copied from the artboards.
//
// All are 16×16 viewBox and inherit `currentColor`, so a control's own colour
// carries its icon — the write-capable agent's pencil is red because the button
// it sits in is, not because the icon is drawn red.

interface Props {
  size?: number;
}

/**
 * The glyph in the corner of a message block, in the chat and in the trace.
 *
 * One number for both, so the two views cannot drift — they draw the same
 * conversation and a reviewer moves between them constantly. Raised from 12 and
 * 13 on 2026-09-04, on the reviewer's ask: at those sizes the glyph read as
 * punctuation beside a 10px label rather than as the thing that says who is
 * speaking, which is the one job it has.
 */
export const MESSAGE_ICON = 15;

/**
 * The same slot, for a FILLED shape.
 *
 * Two pixels smaller because a solid mark carries far more ink than an outline
 * at the same size: a 15px sparkle beside a 15px speech bubble reads as the
 * larger of the two. `StopSquare` is smaller again where it is used — a filled
 * square is the heaviest shape in the set.
 */
export const MESSAGE_ICON_SOLID = 13;

function Line({ size = 12, d }: Props & { d: string }): React.JSX.Element {
  return (
    <svg className="rex-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Solid({ size = 9, d }: Props & { d: string }): React.JSX.Element {
  return (
    <svg
      className="rex-icon-solid"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const ChevronDown = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 10} d="M4 6.5 8 10.5 12 6.5" />
);

export const ChevronLeft = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 11} d="M9.5 4 5.5 8l4 4" />
);

/** "go to ›", "show trace ›" — a control that leads somewhere. */
export const ChevronRight = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 10} d="M6.5 4 10.5 8l-4 4" />
);

/** Tree row, expanded. */
export const TriangleDown = (p: Props): React.JSX.Element => <Solid {...p} d="M4 6h8l-4 5z" />;

/** Tree row, collapsed; also the closed tool-steps row. */
export const TriangleRight = (p: Props): React.JSX.Element => <Solid {...p} d="M6 4v8l5-4z" />;

/**
 * The pen. Two meanings, and spec 14 §7.5 is the argument for letting it have
 * both.
 *
 * Inside a control that says **Change** or **WRITE PROFILE** in words, it is
 * ACT: the agent may write to disk (spec 12). Bare, in a list row's corner
 * beside a trash, it is rename — the reading the rest of the world has trained.
 * The two are never side by side; if they ever are, split the glyph then.
 */
export const Pencil = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 11} d="M11.2 2.8 13.2 4.8 5.6 12.4 2.8 13.2 3.6 10.4z" />
);

export const Check = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 13} d="M3.5 8.5 6.5 11.5 12.5 5" />
);

/**
 * Reopen — the tick undone.
 *
 * A back-curving arrow, which is the shape the rest of the world uses for undo.
 * It never sits beside the tick: a comment is either open or resolved, so the
 * corner carries one of the two and the glyph alone says which one it is.
 */
export const Undo = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 12} d="M5.5 4 2.5 7l3 3M2.5 7h6a3.5 3.5 0 1 1 0 7H6" />
);

export const Lines = (p: Props): React.JSX.Element => <Line {...p} d="M3 5h10M3 8h10M3 11h6" />;

/**
 * Spec 41 §2 — copy this block's text.
 *
 * Two sheets, the front one over the back one's corner. It is the shape every
 * editor and every browser uses for copy, and this is not the place to be
 * original: the button is 20px, appears on hover, and has one press to explain
 * itself. The back sheet is drawn as an open path rather than a second
 * rectangle, so the two never cross where the front one covers it.
 *
 * Not the `Check` beside it in `CopyText`: that one is the same tick every
 * confirmation in REX wears, and it means the same thing here.
 */
export const Copy = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 12} d="M6 6h7.5v7.5H6zM3.5 10H2.5V2.5h7.5V6" />
);

/**
 * Spec 14 §2.1 — a comment group.
 *
 * A folder, decided by the reviewer on 2026-08-25 after the first build drew a
 * pair of brackets and it read as nothing at all. The spec had argued against a
 * folder, on the grounds that the explorer's folders are directories and these
 * are not; the answer was that an unreadable glyph is the worse problem, and a
 * folder is what "a place I put things in" looks like to everybody.
 *
 * Two states, because a closed folder and an open one are the strongest signal
 * a tree has, and the twisty beside it is 9px of triangle.
 */
export const FolderClosed = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 13} d="M2.5 4.5h4l1.2 1.6h5.8v6.4h-11z" />
);

export const FolderOpen = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M2.5 12.5v-8h4l1.2 1.6h5.3v1.6" />
    <path d="M2.5 12.5 4.3 7.7h11L13.5 12.5z" />
  </svg>
);

export const Warning = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 14}
    height={p.size ?? 14}
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 5v4M8 11.2v.1" />
  </svg>
);

export const Info = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 14}
    height={p.size ?? 14}
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.4v3.4M8 5.1v.1" />
  </svg>
);

/**
 * The trace sheet's `debug` control, and nothing else (spec 08 §6.2).
 *
 * A beetle rather than a wrench or a cog: those two mean *settings* in every
 * toolbar anybody has used, and this button changes nothing — it copies what
 * went wrong. Four legs and not six, because at 13px a sixth pair closes the
 * gap between the others and the whole thing reads as a smudge.
 */
export const Bug = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <rect x="5" y="5.4" width="6" height="8.2" rx="3" />
    <path d="M8 7.6v4" />
    <path d="M6.3 4.4 5.1 2.8M9.7 4.4 10.9 2.8" />
    <path d="M5 8.2H2.9M11 8.2h2.1M5 11.4H3.3M11 11.4h1.7" />
  </svg>
);

/**
 * The two panel switches in the bar (`TopBar.tsx`).
 *
 * The outline is the window and the filled bar is the panel, so the glyph says
 * WHICH edge the button acts on without a word. That matters more here than in
 * most icons: the two buttons are the same shape mirrored, and the fill is the
 * only thing that tells them apart at 13px.
 *
 * Filled and not a second outline. A hollow bar beside a hollow window is two
 * rectangles, and at this size nobody reads which one is inside the other.
 */
function Panel({ size = 13, x }: Props & { x: number }): React.JSX.Element {
  return (
    <svg className="rex-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" />
      <rect className="rex-icon-fill" x={x} y="3.5" width="3.5" height="9" />
    </svg>
  );
}

/** Show or hide the workspace, on the left. */
export const PanelLeft = (p: Props): React.JSX.Element => <Panel {...p} x={2.5} />;

/** Show or hide the comments, on the right. */
export const PanelRight = (p: Props): React.JSX.Element => <Panel {...p} x={10} />;

/**
 * Settings — a cogwheel, which is the one glyph nobody has to be taught.
 *
 * Eight teeth on a circle, drawn as one stroked path so it inherits the bar's
 * colour like every other icon here. The hub is a second circle rather than a
 * hole, because a `fill-rule` cut-out renders as a black dot on the dark ground
 * this bar uses.
 */
export const Cog = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    {/*
      A RING with teeth on it, and a hub inside. The first attempt drew eight
      spokes from the centre and no ring, which at 13 px reads as a sun rather
      than a cog — checked on screen, not assumed. The ring is what makes the
      short strokes teeth.
    */}
    <circle cx="8" cy="8" r="4.2" />
    <circle cx="8" cy="8" r="1.7" />
    <path d="M8 2v1.8M8 12.2V14M14 8h-1.8M3.8 8H2" />
    <path d="M12.24 3.76 10.97 5.03M5.03 10.97 3.76 12.24M12.24 12.24 10.97 10.97M5.03 5.03 3.76 3.76" />
  </svg>
);

/** Models — stacked planes, which is what a model list is a list of. */
export const Layers = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M8 2.2 13.4 5 8 7.8 2.6 5z" />
    <path d="M2.6 8.2 8 11l5.4-2.8" />
    <path d="M2.6 11.4 8 14.2l5.4-2.8" />
  </svg>
);

/** Pick mode — a crop frame with a cursor inside it. */
export const PickTarget = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M2.5 2.5h4M9.5 2.5h4v4M13.5 9.5v4h-4M6.5 13.5h-4v-4" />
    <path d="M6.4 6.4 12 8.6l-2.3.9-.9 2.3z" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * The pen — a nib with a freehand stroke behind it.
 *
 * Deliberately not the `Pencil`: that one is Apply's, it is the only place an
 * agent writes to disk, and the two must not read as the same act. This one
 * draws on REX's own glass and changes nothing.
 */
export const PenNib = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M2.6 13.4c1.6-3.4 3.4-5.6 6-7.4" />
    <path d="M9.4 4.2 11.8 6.6 13.4 3.6 12.4 2.6z" />
  </svg>
);

/*
  The trace's kind glyphs. One per block, and the reason they exist: YOU and
  ANSWER were two boxes of the same size carrying the same steel, distinguished
  only by a word in the corner — so a long transcript read as one voice. A
  bubble and a sparkle separate them before the word is read.
*/

/** YOU — the reviewer's own question. */
export const Bubble = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M2.8 3.4h10.4v7.2H7.2L4.2 13v-2.4H2.8z" />
  </svg>
);

/** ANSWER — the agent speaking, here and on the comment card. */
export const Sparkle = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon-solid"
    viewBox="0 0 16 16"
    width={p.size ?? 12}
    height={p.size ?? 12}
    aria-hidden="true"
  >
    <path d="M8 1.6 9.5 6.5 14.4 8 9.5 9.5 8 14.4 6.5 9.5 1.6 8 6.5 6.5z" />
  </svg>
);

/** THINKING — subordinate to the answer, and drawn only in the trace. */
export const Bulb = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M8 2.2a3.8 3.8 0 0 0-2.3 6.8v1.4h4.6V9A3.8 3.8 0 0 0 8 2.2z" />
    <path d="M6.6 12.3h2.8" />
  </svg>
);

/** Any tool that runs a command. */
export const Terminal = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M3 4.5 6 8l-3 3.5M8 11.5h5" />
  </svg>
);

/** Any tool that reads a file. */
export const FileGlyph = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M4 2.5h5l3 3v8H4z" />
    <path d="M9 2.5v3h3" />
  </svg>
);

/**
 * Spec 39 §5.3 — which of the two the blank name box is about to make.
 *
 * Once the menu has closed, this glyph in the row's twisty slot is the only
 * thing that says whether Enter makes a file or a folder.
 *
 * The tree's own two shapes with a `+` in the corner. The shapes are SHORTENED
 * to make room for it rather than scaled down: a folder at 9px beside a folder
 * at 13px reads as two different kinds of folder, which is the one thing these
 * two must not say.
 */
export const FilePlus = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M3.5 2.5h4.5L10.5 5v4.5h-7z" />
    <path d="M8 2.5V5h2.5" />
    <path d="M9.5 12h4M11.5 10v4" />
  </svg>
);

export const FolderPlus = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M2 4.5h4l1.2 1.6h5.3v3.4H2z" />
    <path d="M9.5 12h4M11.5 10v4" />
  </svg>
);

/**
 * DENIED — the gate firing.
 *
 * A barred circle rather than a cross: a cross reads as "this failed", and a
 * refusal is the read profile working, not breaking.
 */
export const Blocked = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.4" />
    <path d="M4.2 4.2 11.8 11.8" />
  </svg>
);

/**
 * Remove — a place from the selection, or a comment and its whole thread.
 *
 * One glyph for both, deliberately. A `×` on a selection row and the word
 * "delete" on a comment card were two vocabularies for one act, and the `×`
 * in particular reads as "dismiss this" rather than "throw this away".
 */
export const Trash = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M3.2 4.6h9.6M6.4 4.6V3.2h3.2v1.4" />
    <path d="M4.6 4.6l.6 8.2h5.6l.6-8.2" />
    <path d="M6.8 6.8v4M9.2 6.8v4" />
  </svg>
);

/**
 * Spec 45 §6 — this thread's traffic through the gateway, in Grafana.
 *
 * Bars on an axis rather than a magnifier or a link glyph: what opens is a
 * dashboard, and the row it joins is already carrying a bug and a bin.
 */
export const Chart = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 13} d="M3 12.5h10M5 12.5V8M8 12.5V4.5M11 12.5V6.5" />
);

/** Close — the lightbox, and anything else that is over the whole window. */
export const Cross = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 13} d="M4 4l8 8M12 4l-8 8" />
);

/**
 * "There is more here" — the button that opens a menu.
 *
 * Vertical, and never horizontal. A row of dots at the end of a line reads as
 * text that was cut short; a column of them reads as a control. `Lines` is
 * already the other kind of menu glyph — that one is a *view*, this one is a
 * list of commands about the thing beside it.
 */
export const Kebab = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon-solid"
    viewBox="0 0 16 16"
    width={p.size ?? 14}
    height={p.size ?? 14}
    aria-hidden="true"
  >
    <circle cx="8" cy="3.6" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="8" cy="12.4" r="1.3" />
  </svg>
);

/**
 * Spec 17 §3.1 — end the run that is happening now.
 *
 * A filled square, the shape every transport control in the world uses for
 * stop, and deliberately not `Blocked`: that one is the gate refusing a tool,
 * which is REX saying no. This is the reviewer saying it.
 */
export const StopSquare = (p: Props): React.JSX.Element => (
  <Solid {...p} size={p.size ?? 9} d="M4 4h8v8H4z" />
);

/**
 * Add — a group inside a group (spec 14 §7.4).
 *
 * A bare plus, and it is not the zoom's: those are inside a magnifier for
 * exactly this reason, so a plus on its own is free to mean "one more of these".
 */
export const Plus = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 12} d="M8 3.5v9M3.5 8h9" />
);

/**
 * Zoom in and out, for the lightbox's own controls (spec 10 §2.3).
 *
 * A magnifier rather than a bare + and −: the two signs alone are the document
 * zoom's vocabulary in the top bar, and reusing them here would suggest the
 * buttons scale the page behind the preview rather than the preview itself.
 */
const LENS = "M7.2 2.6a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2M10.6 10.6 13.6 13.6";

export const ZoomIn = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 14} d={`${LENS}M4.9 7.2h4.6M7.2 4.9v4.6`} />
);

export const ZoomOut = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 14} d={`${LENS}M4.9 7.2h4.6`} />
);

/** Fit the whole figure back into the frame — four corners drawn inward. */
export const FitFrame = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 14} d="M2.6 6V2.6H6M10 2.6h3.4V6M13.4 10v3.4H10M6 13.4H2.6V10" />
);

/**
 * Out of the review — an eye with a line through it (spec 10 §3).
 *
 * Not `Blocked`, which is REX refusing something, and not `Trash`, which throws
 * work away. An exclusion is neither: the folder is still there, still on disk,
 * and one click from coming back. "Not being looked at" is what it means.
 */
export const EyeOff = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <path d="M2 8s2.4-3.6 6-3.6S14 8 14 8s-2.4 3.6-6 3.6S2 8 2 8" />
    <circle cx="8" cy="8" r="1.7" />
    <path d="M3 13 13 3" />
  </svg>
);

/** A table, for a card whose anchor has no quote to show. */
export const TableGlyph = (p: Props): React.JSX.Element => (
  <svg
    className="rex-icon"
    viewBox="0 0 16 16"
    width={p.size ?? 13}
    height={p.size ?? 13}
    aria-hidden="true"
  >
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    <path d="M2.5 6.5h11M6 6.5v6" />
  </svg>
);
