import * as React from "react";
import { cx } from "../internal/cx";

export type Strength = "durable" | "fair" | "weak";

export interface StrengthMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * How well this anchor will survive the document being edited.
   *
   * `durable` — the element has an id, an `aria-label` or a `data-testid`, and
   * that name matches exactly one element. `fair` — it is found by its heading
   * and text. `weak` — it is a positional path and nothing else, so any
   * reordering above it moves the comment.
   */
  strength: Strength;
  /** Overrides the default wording. */
  label?: string;
}

const BARS: Record<Strength, number> = { durable: 3, fair: 2, weak: 1 };
const WORD: Record<Strength, string> = {
  durable: "Durable anchor",
  fair: "Fair anchor",
  weak: "Weak anchor",
};

/**
 * How likely this anchor is to still find its text tomorrow.
 *
 * It is shown for one reason: **the reviewer can act on it.** A bare `<div>`
 * with no id and no text is a positional path, and widening one level before
 * clicking turns a weak anchor into a durable one. A meter nobody can act on
 * would just be anxiety.
 *
 * It sits on the expanded selection row, beside the scope chips — the moment
 * you are choosing what to point at is the moment the number can change what
 * you do.
 */
export const StrengthMeter = React.forwardRef<HTMLDivElement, StrengthMeterProps>(
  function StrengthMeter({ strength, label, className, ...rest }, ref) {
    const lit = BARS[strength];
    return (
      <div
        {...rest}
        ref={ref}
        className={cx(
          "rex-strength",
          strength !== "durable" && `rex-strength-${strength}`,
          className,
        )}
      >
        <span className="rex-strength-bars">
          <i className={cx(lit < 1 && "rex-off")} />
          <i className={cx(lit < 2 && "rex-off")} />
          <i className={cx(lit < 3 && "rex-off")} />
        </span>
        <span>{label ?? WORD[strength]}</span>
      </div>
    );
  },
);
