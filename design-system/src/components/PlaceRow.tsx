import * as React from "react";
import { cx } from "../internal/cx";

export interface PlaceRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The number, matching the outline drawn in the document. */
  index: number;
  /** The document this place is in. Always shown, never only when it differs. */
  document: string;
  /** What is at this place — a quote, or `figure 2`, or `row 4`. */
  children?: React.ReactNode;
  /** Pointed at: the row lights, and its mark in the document lights with it. */
  lit?: boolean;
  /** This is the open comment's place, so the number takes its violet. */
  active?: boolean;
  /**
   * The document has not been opened, so nothing here has been resolved yet.
   * This is **not** an orphan: an orphan means the text is gone, this means
   * nobody looked. It gets the grey the design uses for absence, never red.
   */
  unchecked?: boolean;
}

/**
 * One place a comment is about, in a list of them.
 *
 * **The comment list is the workspace's, not the open document's.** So every
 * row names its document always — a list where the document appears sometimes
 * is a list you have to read twice — and a comment about two files is one
 * comment seen from either of them.
 *
 * Pointing at a row lights it and draws its number on the mark in the document,
 * in the open comment's violet. A place in a document that is not open has
 * nothing to light; that row says which document it is in, and opens it.
 *
 * That last part is what makes a workspace-wide comment list usable at all: a
 * comment you can read here may be about a document that is not on screen, and
 * a gutter marker can only reach the one that is.
 */
export const PlaceRow = React.forwardRef<HTMLButtonElement, PlaceRowProps>(function PlaceRow(
  {
    index,
    document: doc,
    lit = false,
    active = false,
    unchecked = false,
    className,
    type = "button",
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx("rex-place", lit && "rex-place-lit", active && "rex-place-active", className)}
    >
      <span className="rex-place-index">{index}</span>
      {children}
      <span className={cx("rex-place-doc", unchecked && "rex-place-unchecked")}>{doc}</span>
    </button>
  );
});
