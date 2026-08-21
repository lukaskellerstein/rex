import * as React from "react";
import { cx } from "../internal/cx";
import { type AnchorState, STATE_SUFFIX } from "../internal/state";

export interface AnchorCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** How the anchor last resolved. @default 'ok' */
  state?: AnchorState;
  /** The head of the card: a `Token`, a `StatePill`, a `TextButton`. */
  head?: React.ReactNode;
  /** The comment, at full contrast. It is why the card exists. */
  note?: React.ReactNode;
  /** The `Quote` or `AnchorKind` — what the comment is about. */
  children?: React.ReactNode;
}

/**
 * The block at the top of an open thread: what this comment is about, and what
 * it says.
 *
 * It wears the same wash as the `ThreadCard` in the list, so opening a card is
 * visibly the same object getting bigger rather than a new screen. The wash is
 * the only thing that carries state here — there is no second badge, because
 * the head already has room for a pill.
 *
 * The order is fixed and is the design's own rule: **the answer outranks the
 * machinery.** The comment is above the quote, the conversation is below both,
 * and the tool steps are one collapsed row under that.
 */
export const AnchorCard = React.forwardRef<HTMLDivElement, AnchorCardProps>(function AnchorCard(
  { state = "ok", head, note, className, children, ...rest },
  ref,
) {
  const suffix = STATE_SUFFIX[state];
  return (
    <div
      {...rest}
      ref={ref}
      className={cx("rex-card-anchor", state !== "ok" && `rex-thread-${suffix}`, className)}
    >
      {head ? <div className="rex-card-anchor-head">{head}</div> : null}
      {note ? <p className="rex-card-note">{note}</p> : null}
      {children}
    </div>
  );
});
