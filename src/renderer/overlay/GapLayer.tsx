// Spec 16 §6 — Add: naming the space between two blocks.
//
// It is the one place REX could not point at. A reviewer who wants an example
// after the third paragraph had to comment on the third paragraph and say
// "after this", which is a different sentence with a different meaning: one
// asks for a change to that paragraph, the other asks for something that is not
// there yet.
//
// **The layer takes the pointer only inside the band it is currently
// offering.** Everywhere else it is `pointer-events: none`, so selecting text
// across a gap still works — and §6.6 keeps it off the screen entirely while
// pick or pen mode is on, because both of those capture the pointer for their
// own purposes and a third competitor would make all three unreliable.
//
// Drawn over the pane, never into the document: spec 01 §6.7 is not bent for a
// horizontal line any more than for a `<mark>`.

import { useEffect } from "react";
import type { GapSpot } from "./anchoring.ts";

interface Props {
  /** §6.6 — every gap in the document, measured by the last sweep. */
  gaps: GapSpot[];
  scrollX: number;
  scrollY: number;
  /**
   * Where the pointer is inside the document frame, in frame coordinates.
   *
   * It has to come from outside: an event that happens inside an iframe never
   * reaches the parent, so the frame's own `mousemove` is the only thing that
   * knows — the same fact `zoomFromInside` and `forwardKeysToParent` exist for.
   * Null when the pointer has left the frame.
   */
  pointer: { x: number; y: number } | null;
  /**
   * The band covers the frame while it is drawn, so the frame's own
   * `mousemove` stops arriving. Without this the pointer would be frozen at
   * whatever it was when the band appeared, and moving along the band — or off
   * the top of it — would be invisible.
   *
   * The point is in the OVERLAY's coordinates, because that is what a React
   * handler on this element sees. Only `DocumentView` knows where the frame
   * sits inside the pane, so it is what converts.
   */
  onPointerInOverlay: (at: { x: number; y: number }) => void;
  /** §6.1 — which gap is being offered right now, for the `A` key. */
  onOffer: (index: number | null) => void;
  onPick: (index: number) => void;
}

export function GapLayer(props: Props): React.JSX.Element | null {
  const { pointer, onOffer } = props;

  // Frame coordinates are viewport coordinates inside the frame, and the gaps
  // are in document coordinates, so the scroll is what joins them.
  const x = (pointer?.x ?? 0) + props.scrollX;
  const y = (pointer?.y ?? 0) + props.scrollY;

  // §6.6 — the bands are clamped so they never overlap, so at most one matches.
  const spot = pointer
    ? (props.gaps.find(
        (gap) => y >= gap.top && y <= gap.bottom && x >= gap.x && x <= gap.x + gap.w,
      ) ?? null)
    : null;

  // §6.1 — the `A` key adds at whatever is being offered, so what is offered
  // has to be reported. In an effect rather than in the render, because it is
  // a message to the shell and not part of drawing the band.
  const offered = spot?.index ?? null;
  useEffect(() => {
    onOffer(offered);
  }, [offered, onOffer]);

  if (!spot) return null;

  return (
    <button
      type="button"
      className="rex-gap"
      title={spot.label}
      style={{
        left: spot.x - props.scrollX,
        top: spot.top - props.scrollY,
        width: spot.w,
        height: Math.max(spot.bottom - spot.top, 1),
      }}
      onMouseMove={(event) => props.onPointerInOverlay({ x: event.clientX, y: event.clientY })}
      onClick={() => props.onPick(spot.index)}
    >
      <span className="rex-gap-line" />
      <span className="rex-gap-pill">+ Add</span>
    </button>
  );
}
