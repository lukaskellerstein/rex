// A drag handle on the TOP edge of a reply box (asked for 2026-09-02).
//
// The textarea already carries the browser's own corner grip, and that grip only
// pushes the bottom edge down — into the buttons under it. This one moves the
// edge the reviewer is actually looking at: the line between what has been said
// and what they are typing. The space comes from the conversation above, which
// is the space they want to spend.
//
// Not `Splitter.tsx`, which divides two panes and is TOLD their size. A reply
// box is not a pane: the stylesheet gives it its first height, and the browser's
// corner grip can change it behind React's back. So this handle MEASURES when
// the drag starts, and the number it reports is always the height on screen.

import type { RefObject } from "react";
import { useRef } from "react";

/**
 * `.rex-input`'s own `min-height`, and it must stay equal to it. Below this the
 * stylesheet clamps the box, so a smaller number here would report a height
 * nothing on screen ever takes.
 */
const MIN = 116;

/** What the conversation keeps, however far the box is dragged up. */
const KEEP = 96;

interface Props {
  /** The box being resized. */
  box: RefObject<HTMLTextAreaElement | null>;
  /** The scrolling area above it — the space the box grows into. */
  above: RefObject<HTMLElement | null>;
  label: string;
  /** A height in pixels, or null to go back to the stylesheet's height. */
  onChange: (height: number | null) => void;
}

export function ReplyGrip(props: Props): React.JSX.Element {
  const start = useRef<{ y: number; height: number; max: number } | null>(null);

  const measure = (): { height: number; max: number } | null => {
    const box = props.box.current;
    if (!box) return null;
    const height = box.getBoundingClientRect().height;
    // The ceiling is the box PLUS the area above it, so it does not move while
    // the drag does: the two heights trade, and their sum is fixed for as long
    // as the panel is. Measuring only the area above would lower the ceiling on
    // every pointer move and the box would stop short of it.
    const room = props.above.current?.clientHeight ?? 0;
    return { height, max: Math.max(MIN, height + room - KEEP) };
  };

  return (
    <div
      className="rex-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${props.label}`}
      tabIndex={0}
      title={`Drag to change the height of ${props.label}. Double-click to put it back.`}
      onPointerDown={(event) => {
        const now = measure();
        if (!now) return;
        start.current = { y: event.clientY, height: now.height, max: now.max };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is an optimisation — it keeps a fast drag from tearing off.
          // Losing it must not throw out of the handler and abandon the drag.
        }
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (!from) return;
        // Up the screen is a SMALLER clientY and a TALLER box, so the movement
        // is subtracted rather than added.
        const height = from.height - (event.clientY - from.y);
        props.onChange(Math.min(from.max, Math.max(MIN, height)));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onDoubleClick={() => {
        // The corner grip writes an inline height REX never set, so a reset has
        // to clear the element as well as the state. React only removes what it
        // put there itself.
        const box = props.box.current;
        if (box) box.style.height = "";
        props.onChange(null);
      }}
      onKeyDown={(event) => {
        // A pointer is not the only way to move a divider.
        const now = measure();
        if (!now) return;
        const step = event.shiftKey ? 48 : 12;
        if (event.key === "ArrowUp") props.onChange(Math.min(now.max, now.height + step));
        else if (event.key === "ArrowDown") props.onChange(Math.max(MIN, now.height - step));
        else return;
        event.preventDefault();
      }}
    />
  );
}
