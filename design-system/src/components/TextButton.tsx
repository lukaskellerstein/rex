import * as React from "react";
import { cx } from "../internal/cx";

export interface TextButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Muted rather than link-blue — for a secondary action like `clear`. */
  quiet?: boolean;
  children: React.ReactNode;
}

/**
 * An action that must not look like a button: `show trace ›`, `go to ›`,
 * `details ⌄`, `clear`.
 *
 * It is a real `<button>`, because it does something rather than going
 * somewhere — but it is set in link blue at 11px with no border and no fill, so
 * it can sit beside a `Button` without competing with it.
 *
 * Keep the trailing `›` on anything that opens a view, and the `⌄` on anything
 * that unfolds in place. The glyph is how a reader tells the two apart before
 * clicking.
 */
export const TextButton = React.forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton(
  { quiet = false, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx("rex-textbutton", quiet && "rex-textbutton-quiet", className)}
    >
      {children}
    </button>
  );
});
