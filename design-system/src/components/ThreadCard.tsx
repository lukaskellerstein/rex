import * as React from "react";
import { cx } from "../internal/cx";
import { type AnchorState, STATE_SUFFIX } from "../internal/state";

export interface ThreadCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** How this comment's anchor last resolved. @default 'ok' */
  state?: AnchorState;
  /** The card whose thread is open. Deepens the wash; never changes the hue. */
  selected?: boolean;
  /** The numbered token, drawn at the left of the card. */
  token?: React.ReactNode;
  /** The comment itself. One or two lines, at full contrast. */
  note: React.ReactNode;
  /**
   * The document or documents this comment is about. Always present — the list
   * is the workspace's, so a row that named its document only sometimes would
   * have to be read twice.
   */
  documents: string;
  /** The state word, the turn count, anything else quiet. */
  meta?: React.ReactNode;
}

/**
 * One comment in the list. Treatment **C · Wash** — the one that was built.
 *
 * **A card carries its state as a wash with a matching border**, and selection
 * deepens that same wash and brightens that same border. It never changes hue.
 * That is the rule the four treatments were judged on: a reviewer must be able
 * to read *what state this is in* and *whether it is the one I have open* at
 * the same time, from one card. A selected card that changed colour would
 * answer the second question by destroying the first.
 *
 * Hover sits between resting and selected, on the same hue again — three steps
 * of one colour, never two colours.
 *
 * The state is written in a word in the meta line as well as painted in the
 * wash. Nothing here rests on hue alone.
 */
export const ThreadCard = React.forwardRef<HTMLButtonElement, ThreadCardProps>(function ThreadCard(
  {
    state = "ok",
    selected = false,
    token,
    note,
    documents,
    meta,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const suffix = STATE_SUFFIX[state];
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cx(
        "rex-thread",
        state !== "ok" && `rex-thread-${suffix}`,
        selected && "rex-thread-on",
        className,
      )}
    >
      {token}
      <span className="rex-thread-body">
        <span className="rex-thread-note">{note}</span>
        <span className="rex-thread-docs">{documents}</span>
        {meta ? <span className="rex-thread-meta">{meta}</span> : null}
      </span>
    </button>
  );
});
