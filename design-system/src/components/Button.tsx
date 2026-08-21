import * as React from "react";
import { cx } from "../internal/cx";

export type ButtonVariant = "default" | "primary" | "write";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `default` is every ordinary action. `primary` is the one thing the panel
   * exists to do — `Ask`. `write` is reserved: it is the only control in REX
   * that can change a file on disk.
   * @default 'default'
   */
  variant?: ButtonVariant;
  /** Stretch to the width of the container. */
  block?: boolean;
  children: React.ReactNode;
}

/**
 * REX's action control. 28px high, 4px radius, no shadow.
 *
 * **There is one `primary` button per panel.** In the selection panel it is
 * `Ask`; in a dialog it is the confirming action. If a panel seems to need two,
 * one of them is `default`.
 *
 * **`write` is not a style choice.** Red is spent on exactly two things in this
 * design — a lost anchor, and the write-capable agent — so that it never stops
 * meaning "look at this". Use `write` only for a control that hands work to the
 * agent that can edit a document, and never to make an ordinary action look
 * urgent.
 *
 * A destructive action stays away from the primary one: `clear` lives inside
 * the selection list it acts on, not beside `Ask` at the foot, because a
 * destructive control next to the primary one is a slip waiting to happen.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", block = false, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        "rex-button",
        variant !== "default" && `rex-button-${variant}`,
        block && "rex-button-block",
        className,
      )}
    >
      {children}
    </button>
  );
});
