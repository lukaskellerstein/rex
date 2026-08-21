import * as React from "react";
import { cx } from "../internal/cx";

export interface AnchorKindProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What this anchor is: `Figure`, `Table`, `Region of a figure`, `Element`. */
  title: string;
  /**
   * The geometry or address, in monospace: `1024 × 384`, `rows 3–7`,
   * `#deployment-diagram`. This is what makes the anchor checkable.
   */
  geometry?: string;
  /** A small drawing of the thing — a thumbnail, an outline, an icon. */
  figure?: React.ReactNode;
}

/**
 * What sits where a quote would sit, when the anchor is not text.
 *
 * A figure or a table has no words to quote. This line is never left blank, and
 * it is never filled with a description REX made up — REX does not describe a
 * picture it cannot read. It says what the anchor **is**, plus the geometry, and
 * stops there.
 *
 * The geometry earns its place: a region anchor is pure geometry and so it
 * always resolves to somewhere. `RegionRef` therefore carries a fingerprint of
 * the element's rendered content, and a mismatch reports `orphaned` with the
 * comment kept. A redrawn figure must orphan while its untouched neighbour
 * still resolves — this is the one anchor kind that can otherwise fail in
 * silence.
 */
export const AnchorKind = React.forwardRef<HTMLDivElement, AnchorKindProps>(function AnchorKind(
  { title, geometry, figure, className, ...rest },
  ref,
) {
  return (
    <div {...rest} ref={ref} className={cx("rex-kind", className)}>
      {figure}
      <span className="rex-kind-text">
        <span className="rex-kind-title">{title}</span>
        {geometry ? <span className="rex-kind-geom">{geometry}</span> : null}
      </span>
    </div>
  );
});
