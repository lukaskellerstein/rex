import * as React from "react";
import { cx } from "../internal/cx";

export interface ReviewFile {
  /** The path, as the reviewer knows it. */
  path: string;
  /** Lines added. */
  added?: number;
  /** Lines removed. */
  removed?: number;
  /** This is the document already on screen — so it is not a link. */
  open?: boolean;
  /** Open this file. Ignored when `open` is set: there is nowhere to go. */
  onOpen?: () => void;
}

export interface ReviewBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What the write-capable agent changed. */
  files: ReviewFile[];
  /**
   * The heading — `Apply changed 2 files`. Named `heading` rather than `title`
   * because `title` on a `<div>` is the browser's tooltip, and a bar that
   * silently became a tooltip would be a real bug.
   */
  heading: React.ReactNode;
  /** A quiet second line — what was skipped, and why. */
  note?: React.ReactNode;
  /** `OK` and `Undo`, and `show diff`. */
  actions?: React.ReactNode;
  /** A `<pre className="rex-diff">` block, when the reviewer opens the diff. */
  children?: React.ReactNode;
}

/**
 * What sits under the document after the agent has changed it, while the
 * reviewer decides.
 *
 * **A bar, not a dialog, and that is the whole point.** A modal over the
 * document answers "what does this patch say" while hiding the thing it says it
 * about. Here the reviewer reads the document as it now stands, with the
 * changed sections outlined in it, and this sits under it carrying `OK` and
 * `Undo`.
 *
 * It wears the write tint, because a write-capable agent has already touched
 * the disk. The changed sections in the document are outlined in the same red —
 * never the selection's blue. Mid-Apply a reviewer must not have to work out
 * which marks are their own selection and which are the agent's edit.
 *
 * The file that is already open is not a link, because there is nowhere to go.
 */
export const ReviewBar = React.forwardRef<HTMLDivElement, ReviewBarProps>(function ReviewBar(
  { files, heading, note, actions, className, children, ...rest },
  ref,
) {
  return (
    <div {...rest} ref={ref} className={cx("rex-review", className)}>
      <div className="rex-review-head">
        <span className="rex-review-title">
          <strong>{heading}</strong>
          {note ? <span className="rex-meta">{note}</span> : null}
        </span>
        {actions}
      </div>
      <div className="rex-files">
        {files.map((file) => {
          const counts = (
            <>
              {file.added ? <span className="rex-file-add">+{file.added}</span> : null}
              {file.removed ? <span className="rex-file-del">−{file.removed}</span> : null}
            </>
          );
          return file.open ? (
            <span key={file.path} className="rex-file rex-file-open">
              {file.path}
              {counts}
            </span>
          ) : (
            <button key={file.path} type="button" className="rex-file" onClick={file.onOpen}>
              {file.path}
              {counts}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
});
