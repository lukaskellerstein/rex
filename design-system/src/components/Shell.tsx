import * as React from "react";
import { cx } from "../internal/cx";

export interface ShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stretch to fill the height of whatever contains it. */
  fill?: boolean;
  children: React.ReactNode;
}

/**
 * The surface every other component stands on, and the only place the palette
 * is declared.
 *
 * In REX itself this is the shadow root: every pixel REX draws lives inside
 * one, so that the document under review cannot style REX's controls and REX's
 * CSS cannot change how the document looks. That isolation is a correctness
 * requirement in a review tool, not a preference.
 *
 * Here it is a class instead, which buys the same thing one level weaker: the
 * tokens are scoped to this element, so a single card can be dropped into any
 * page without leaking the palette into it. **Wrap everything in one.** A
 * component used outside a `Shell` finds no `--fg`, no `--sans` and no wash,
 * and renders as unstyled browser default.
 */
export const Shell = React.forwardRef<HTMLDivElement, ShellProps>(function Shell(
  { fill = false, className, children, style, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      className={cx("rex-shell", className)}
      style={fill ? { height: "100%", ...style } : style}
    >
      {children}
    </div>
  );
});
