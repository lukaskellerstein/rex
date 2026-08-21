import * as React from "react";
import { cx } from "../internal/cx";

export interface SwatchProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Any CSS colour. Pass `var(--moved)` to show the token rather than a hex. */
  color: string;
  /** The token's name — `--moved`, or a plain word like `Moved`. */
  name: string;
  /** The resolved value, printed under the name. Usually the hex. */
  value?: string;
}

/**
 * One colour, its name and its value.
 *
 * The chip carries a border in `--rule` for one reason: three of REX's
 * surfaces are within a few percent of each other, and without an edge a
 * `--panel` swatch on a `--bg` ground looks like a hole rather than a colour.
 */
export const Swatch = React.forwardRef<HTMLDivElement, SwatchProps>(function Swatch(
  { color, name, value, className, ...rest },
  ref,
) {
  return (
    <div {...rest} ref={ref} className={cx("rex-swatch", className)}>
      <div className="rex-swatch-chip" style={{ background: color }} />
      <div className="rex-swatch-text">
        <span className="rex-swatch-name">{name}</span>
        {value ? <span className="rex-swatch-value">{value}</span> : null}
      </div>
    </div>
  );
});
