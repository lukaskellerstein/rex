import * as React from "react";
import { cx } from "../internal/cx";

export interface QuoteProps extends React.HTMLAttributes<HTMLQuoteElement> {
  /** Smaller, and capped at about two lines — for a collapsed row in a list. */
  small?: boolean;
  children: React.ReactNode;
}

/**
 * Text taken out of the document under review.
 *
 * This is the only place Newsreader appears in the whole of REX. Everything
 * REX says is set in IBM Plex Sans; everything the document says is set in a
 * serif, in italic, behind a rule. So a reader can never mistake a quote for
 * REX's own voice — which matters, because the two sit centimetres apart in the
 * same card and one of them is evidence.
 *
 * The height cap is deliberate and is not a bug to fix. A quote here is an
 * address, not the passage: if you need the whole thing, the document is on the
 * left.
 */
export const Quote = React.forwardRef<HTMLQuoteElement, QuoteProps>(function Quote(
  { small = false, className, children, ...rest },
  ref,
) {
  return (
    <blockquote
      {...rest}
      ref={ref}
      className={cx("rex-quote", small && "rex-quote-small", className)}
    >
      {children}
    </blockquote>
  );
});
