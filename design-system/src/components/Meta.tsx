import * as React from "react";
import { cx } from "../internal/cx";

export interface MetaProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /**
   * Monospace and one step fainter. Use it for an address — a path, a document
   * name, a session id — never for prose.
   */
  mono?: boolean;
  /**
   * Tabular figures. Turn this on for anything numeric that updates in place:
   * a cost, a duration, a count. Proportional digits shimmer as they change.
   */
  tabular?: boolean;
  children: React.ReactNode;
}

/**
 * The quiet line under something: `read · 2 turns · 6 steps · 12.4s · $0.031`.
 *
 * Eleven pixels in `--muted`. It is the register REX uses for a fact about a
 * thing rather than the thing itself, and it is deliberately hard to mistake
 * for the answer above it.
 *
 * Separate the parts with a middle dot and spaces (` · `), not commas — the
 * parts are peers, not a sentence.
 */
export const Meta = React.forwardRef<HTMLParagraphElement, MetaProps>(function Meta(
  { mono = false, tabular = false, className, children, ...rest },
  ref,
) {
  return (
    <p
      {...rest}
      ref={ref}
      className={cx("rex-meta", mono && "rex-meta-mono", tabular && "rex-meta-tabular", className)}
    >
      {children}
    </p>
  );
});
