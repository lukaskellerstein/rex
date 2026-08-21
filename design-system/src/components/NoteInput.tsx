import * as React from "react";
import { cx } from "../internal/cx";

export interface NoteInputProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  placeholder?: string;
}

/**
 * Where a comment gets written, and where a reply gets typed.
 *
 * A textarea rather than an input, and resizable vertically, because a comment
 * on a document is a sentence or two more often than it is a line. 58px is
 * about two lines at REX's 13px — enough to start, not so much that an empty
 * box dominates the foot of the panel.
 *
 * It sits at the **foot of a full column**, under whatever it is about. That is
 * what the sidebar's two tabs bought: with the selection list no longer capped
 * to leave room below it, the note and `Ask` have the bottom of the panel to
 * themselves.
 */
export const NoteInput = React.forwardRef<HTMLTextAreaElement, NoteInputProps>(function NoteInput(
  { className, rows = 2, ...rest },
  ref,
) {
  return <textarea {...rest} ref={ref} rows={rows} className={cx("rex-input", className)} />;
});
