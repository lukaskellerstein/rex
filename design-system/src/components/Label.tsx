import * as React from "react";
import { cx } from "../internal/cx";

export interface LabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * The only heading REX's chrome has: `ANCHOR`, `PLACES`, `MOST REFERENCED`.
 *
 * Ten pixels, semibold, tracked wide, and muted. It names a region without
 * competing with anything inside it — which is the whole job, because in a
 * review tool the loudest thing on screen should always be the document.
 *
 * Write the text in capitals yourself. The component does not `text-transform`,
 * so that an abbreviation reads correctly and so the label can be copied.
 */
export const Label = React.forwardRef<HTMLSpanElement, LabelProps>(function Label(
  { className, children, ...rest },
  ref,
) {
  return (
    <span {...rest} ref={ref} className={cx("rex-label", className)}>
      {children}
    </span>
  );
});
