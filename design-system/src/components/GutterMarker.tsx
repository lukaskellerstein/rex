import * as React from "react";
import { cx } from "../internal/cx";
import { type AnchorState, STATE_SUFFIX } from "../internal/state";

export interface GutterMarkerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The number, matching this comment's `Token` in the sidebar. */
  index: number;
  /** How the anchor last resolved. @default 'ok' */
  state?: AnchorState;
  /** Ring it — this is the comment whose card is open. */
  active?: boolean;
  /**
   * An orphan has no position on the page to sit at, so it pins to the foot of
   * the gutter with the word `LOST` under it. Never leave it floating at a
   * guessed height: a marker beside the wrong paragraph is worse than a marker
   * that admits it has nowhere to go.
   */
  pinned?: boolean;
}

/**
 * A comment's mark in the margin of the document, in the 32px gutter beside the
 * paper.
 *
 * It is drawn in the gutter, never on the document. REX does not mutate what it
 * is reviewing — not a wrapper element, not a style attribute, nothing. The
 * same rule is why highlights use the CSS Custom Highlight API rather than
 * `<mark>`: wrapping a range would shift every offset the other anchors depend
 * on.
 *
 * The gutter's two greys are literal rather than tokens, because the gutter is
 * on the paper: it has to read against a document, and a document is light
 * whatever REX's chrome is doing.
 */
export const GutterMarker = React.forwardRef<HTMLButtonElement, GutterMarkerProps>(
  function GutterMarker(
    {
      index,
      state = "ok",
      active = false,
      pinned = false,
      className,
      style,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const suffix = STATE_SUFFIX[state];
    const marker = (
      <button
        {...rest}
        ref={ref}
        type={type}
        className={cx(
          "rex-marker",
          state !== "ok" && `rex-marker-${suffix === "orphaned" ? "lost" : suffix}`,
          active && "rex-marker-active",
          !pinned && className,
        )}
        style={pinned ? undefined : style}
      >
        {index}
      </button>
    );

    if (!pinned) return marker;

    /*
      When pinned, the caller's position belongs to the WRAPPER, not the button:
      the label and the marker are one thing pinned to the foot of the gutter.
      Positioning the button alone leaves `LOST` behind at the top of the
      column, beside whatever marker happens to be there — which reads as that
      marker being the lost one.
    */
    return (
      <span className={cx("rex-marker-pinned", className)} style={style}>
        {marker}
        <span className="rex-lost-label">LOST</span>
      </span>
    );
  },
);
