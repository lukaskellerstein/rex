import * as React from "react";
import { cx } from "../internal/cx";

export type ChipTone = "open" | "resolved" | "orphaned";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this filter is on. */
  on?: boolean;
  /** The tally. The chip carries it, so the filter row doubles as the counts. */
  count?: number;
  /**
   * Which state this chip filters for. It colours the count badge when the chip
   * is on — and only then, so an off row stays a plain row of grey pills.
   */
  tone?: ChipTone;
  children: React.ReactNode;
}

/**
 * A filter over the comment list: `All 12`, `Open 7`, `Resolved 4`,
 * `Orphaned 1`.
 *
 * **The chip carries its own count**, which is why REX has no separate tally
 * line anywhere. One row answers both "what can I filter by" and "how many of
 * each are there".
 *
 * The count badge only takes its state colour while the chip is on. An entire
 * row of coloured badges would spend steel, green and red on a control, and
 * those three colours are needed for the cards below it.
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { on = false, count, tone, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-pressed={on}
      className={cx("rex-chip", on && "rex-chip-on", className)}
    >
      {children}
      {count === undefined ? null : (
        <span className={cx("rex-chip-count", tone && `rex-chip-count-${tone}`)}>{count}</span>
      )}
    </button>
  );
});
