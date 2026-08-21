import * as React from "react";
import { cx } from "../internal/cx";

export type PillTone = "ok" | "moved" | "lost" | "write";

export interface StatePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * `ok` resolved exactly, `moved` re-found after the text changed, `lost` the
   * text is gone, `write` the agent that can edit a file on disk.
   */
  tone: PillTone;
  children: React.ReactNode;
}

/**
 * A state, said in a word and a colour at once.
 *
 * The dot is drawn from `currentcolor`, so a pill can never say one thing in
 * its text and another in its mark. **Always give it a word.** Nothing in REX
 * rests on hue alone — a reviewer with a colour-vision difference must read the
 * same state a reviewer without one reads, from the same pixel.
 *
 * `lost` and `write` are the same red, and that is deliberate: red is spent on
 * exactly two things in this design — an anchor whose text is gone, and the
 * agent that can change a file. Both mean "look at this before you go on". A
 * third meaning would teach the reviewer to ignore the first two.
 */
export const StatePill = React.forwardRef<HTMLSpanElement, StatePillProps>(function StatePill(
  { tone, className, children, ...rest },
  ref,
) {
  return (
    <span {...rest} ref={ref} className={cx("rex-pill", `rex-pill-${tone}`, className)}>
      {children}
    </span>
  );
});
