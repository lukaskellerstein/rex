import * as React from "react";
import { cx } from "../internal/cx";

export interface OrphanTrayProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** How many comments have lost their text. */
  count: number;
  /** A quiet note at the right edge — `3 in other documents`. */
  note?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The strip that collects comments whose text is gone.
 *
 * Dashed, because an orphan is a comment with nowhere to point — the border
 * says so before the words do. It is the one control in REX that survives
 * having no position at all: it cannot sit in the gutter, because there is no
 * line to sit beside, so it lives at the top of the comments column and says
 * how many.
 *
 * **An orphan is not a document nobody opened.** A target in a file that has
 * never been on screen is `not checked here`, in the grey this design uses for
 * absence, and it is never counted in this tray. An orphan means the text is
 * gone; unchecked means nobody looked. Confusing the two turns a quiet backlog
 * into a false alarm.
 */
export const OrphanTray = React.forwardRef<HTMLButtonElement, OrphanTrayProps>(function OrphanTray(
  { count, note, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button {...rest} ref={ref} type={type} className={cx("rex-tray", className)}>
      <span>
        {children ?? (
          <>
            {count} {count === 1 ? "comment has" : "comments have"} lost the text
          </>
        )}
      </span>
      {note ? <span className="rex-tray-more">{note}</span> : null}
    </button>
  );
});
