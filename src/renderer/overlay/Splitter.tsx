// A drag handle between two panes.
//
// Pointer capture rather than window listeners: the pointer keeps reporting to
// this element even when it leaves it, which is what makes a fast drag not tear
// off, and the capture is released for us if the gesture is cancelled.

import { useRef } from "react";

interface Props {
  /** Current width of the pane being resized, in pixels. */
  width: number;
  min: number;
  max: number;
  /**
   * +1 when the pane is to the left of this handle (dragging right widens it),
   * -1 when it is to the right (dragging right narrows it).
   */
  direction: 1 | -1;
  label: string;
  onChange: (width: number) => void;
}

export function Splitter(props: Props): React.JSX.Element {
  const start = useRef<{ x: number; width: number } | null>(null);

  const clamp = (value: number): number => Math.min(props.max, Math.max(props.min, value));

  return (
    <div
      className="rex-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${props.label}`}
      aria-valuenow={Math.round(props.width)}
      tabIndex={0}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width: props.width };
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
        props.onChange(clamp(from.width + (event.clientX - from.x) * props.direction));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(event) => {
        // A pointer is not the only way to move a divider.
        const step = event.shiftKey ? 48 : 12;
        if (event.key === "ArrowLeft") props.onChange(clamp(props.width - step * props.direction));
        else if (event.key === "ArrowRight")
          props.onChange(clamp(props.width + step * props.direction));
        else return;
        event.preventDefault();
      }}
    />
  );
}
