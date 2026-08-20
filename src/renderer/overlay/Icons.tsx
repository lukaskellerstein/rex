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
