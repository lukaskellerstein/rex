import * as React from "react";
import { cx } from "../internal/cx";

export interface ScopeChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this is the scope the anchor currently uses. */
  on?: boolean;
  children: React.ReactNode;
}

/**
 * How wide the thing you picked is: `sentence`, `paragraph`, `cell`, `row`,
 * `table`, `figure`.
 *
 * Selecting is a phase, and widening is part of it — you drag over a word in a
 * table, then walk out to the cell, the row, the table. The chips are that
 * walk, and the one that is on is where the anchor sits now.
 *
 * The chips appear on the **expanded** row of the selection panel only. Nine
 * collapsed rows each carrying a full set of scope chips is a wall, and the
 * panel exists to make a nine-place selection readable.
 *
 * `tbody` is walked through rather than offered: nobody comments on a table
 * body, and offering it put two chips both reading "table" side by side.
 */
export const ScopeChip = React.forwardRef<HTMLButtonElement, ScopeChipProps>(function ScopeChip(
  { on = false, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-pressed={on}
      className={cx("rex-scope", on && "rex-scope-on", className)}
    >
      {children}
    </button>
  );
});
