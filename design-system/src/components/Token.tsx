import * as React from "react";
import { cx } from "../internal/cx";
import { type AnchorState, STATE_SUFFIX } from "../internal/state";

export interface TokenProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The number drawn on the card and on its mark in the document. */
  index: number;
  /** How the anchor last resolved. @default 'ok' */
  state?: AnchorState;
  /** Ring it — this is the comment whose card is open. */
  active?: boolean;
}

/**
 * The numbered circle on a comment card. State at full strength.
 *
 * The number is the whole point: it ties this card to a mark in the document,
 * so `3` in the card and `3` in the gutter are one comment seen twice. The
 * fill says how that mark last resolved.
 *
 * `resolved` is drained of colour but still numbered. A resolved comment is not
 * gone — you can still find what it was about, which is exactly what a reviewer
 * needs when they are checking whether a change was actually made.
 */
export const Token = React.forwardRef<HTMLSpanElement, TokenProps>(function Token(
  { index, state = "ok", active = false, className, ...rest },
  ref,
) {
  const suffix = STATE_SUFFIX[state];
  return (
    <span
      {...rest}
      ref={ref}
      className={cx(
        "rex-token",
        state !== "ok" && `rex-token-${suffix}`,
        active && "rex-token-active",
        className,
      )}
    >
      {index}
    </span>
  );
});
