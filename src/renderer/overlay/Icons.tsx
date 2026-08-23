// The line icons the design draws, in one place so a stroke weight cannot
// drift between two screens. Every path is copied from the artboards.
//
// All are 16×16 viewBox and inherit `currentColor`, so a control's own colour
// carries its icon — the write-capable agent's pencil is red because the button
// it sits in is, not because the icon is drawn red.

interface Props {
  size?: number;
}

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

/** Apply — the only place in REX a pencil appears, and it writes to disk. */
export const Pencil = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 11} d="M11.2 2.8 13.2 4.8 5.6 12.4 2.8 13.2 3.6 10.4z" />
);

/** The read profile's promise: this agent cannot write. */
export const Shield = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 11} d="M8 2 13 4v4.2C13 11 10.8 13.2 8 14 5.2 13.2 3 11 3 8.2V4z" />
);

export const Check = (p: Props): React.JSX.Element => (
  <Line {...p} size={p.size ?? 13} d="M3.5 8.5 6.5 11.5 12.5 5" />
);

export const Lines = (p: Props): React.JSX.Element => <Line {...p} d="M3 5h10M3 8h10M3 11h6" />;

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
