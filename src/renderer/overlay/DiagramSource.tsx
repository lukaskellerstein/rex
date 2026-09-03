// Spec 29 §4.2 — the source pane: a Mermaid fence, read-only, with file line
// numbers in a gutter, beside the drawing it was made from.
//
// It is REX's own `<pre>` inside the shadow root, never the document's. The
// text is exactly the fence's source, untouched — no reformatting, no colour
// beyond what a code block gets — and there is no caret: `docs/FORMATS.md` §1
// rule 3 is a boundary, and this pane is inside it. The agent changes the
// source; the reviewer says what should change.
//
// Two things point at each other through this pane. Hovering a line washes its
// parts in the drawing (the parent does that from `onHoverLine`); hovering a
// part in the drawing washes its lines here (`litLines`). A click takes a
// place: the line's one part when it states exactly one, else the line itself
// as `lines`. A drag down the gutter takes a run of lines.

import { useRef, useState } from "react";
import { type DiagramParts, partsOnLine } from "../../shared/diagram.ts";
import type { AnchorState, DiagramPart } from "../../shared/types.ts";

/** A place already taken on this diagram, as the panel numbers it. */
export interface SourcePlace {
  number: number;
  from: number;
  to: number;
}

/** A comment that already exists on a part of this diagram. */
export interface SourceComment {
  from: number;
  to: number;
  state: AnchorState;
}

interface Props {
  source: string;
  parts: DiagramParts;
  /** The line the fence opens on. Null draws fence-relative numbers. */
  fenceLine: number | null;
  /** Lines the drawing's hover points at: the strong one and the light ones. */
  litLines: { strong: number[]; light: number[] };
  places: SourcePlace[];
  comments: SourceComment[];
  onHoverLine: (line: number | null) => void;
  onPick: (part: DiagramPart) => void;
}

/** A press and release closer than this is a click, not a drag. */
const DRAG_MINIMUM = 4;

export function DiagramSource(props: Props): React.JSX.Element {
  const lines = props.source.split("\n");
  const offset = props.fenceLine ?? 0;
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const pressed = useRef<{ line: number; y: number } | null>(null);

  const partsOf = (line: number): DiagramPart[] => partsOnLine(props.parts, line);

  /** §4.2 — one part on the line is that part; anything else is the line. */
  const pick = (line: number): void => {
    const stated = partsOf(line);
    props.onPick(stated.length === 1 ? stated[0] : { kind: "lines", from: line, to: line });
  };

  const placesOn = (line: number): SourcePlace[] =>
    props.places.filter((place) => place.from <= line && line <= place.to);
  const commentOn = (line: number): SourceComment | undefined =>
    props.comments.find((comment) => comment.from <= line && line <= comment.to);

  return (
    <div
      className="rex-source"
      onPointerLeave={() => {
        props.onHoverLine(null);
      }}
    >
      <pre
        className="rex-source-body"
        onPointerUp={() => {
          const from = pressed.current;
          pressed.current = null;
          const run = drag;
          setDrag(null);
          if (run && run.from !== run.to) {
            props.onPick({
              kind: "lines",
              from: Math.min(run.from, run.to),
              to: Math.max(run.from, run.to),
            });
            return;
          }
          if (from) pick(from.line);
        }}
        onPointerCancel={() => {
          pressed.current = null;
          setDrag(null);
        }}
      >
        {lines.map((text, at) => {
          const line = at + 1;
          const places = placesOn(line);
          const comment = commentOn(line);
          const inDrag =
            drag !== null &&
            Math.min(drag.from, drag.to) <= line &&
            line <= Math.max(drag.from, drag.to);
          const classes = ["rex-source-line"];
          if (props.litLines.strong.includes(line)) classes.push("rex-source-line-strong");
          else if (props.litLines.light.includes(line)) classes.push("rex-source-line-light");
          if (places.length > 0) classes.push("rex-source-line-place");
          if (comment) classes.push(`rex-source-line-comment rex-source-line-${comment.state}`);
          if (inDrag) classes.push("rex-source-line-drag");
          // Only the first line of a place carries its number, as the drawing's
          // outline carries one number. Two nodes declared on one line — `A[..]
          // --> B{..}` — are two places on it, and both numbers are shown.
          const numbers = places
            .filter((place) => place.from === line)
            .map((place) => place.number);
          const numbered = numbers.length > 0 ? numbers.join(", ") : null;
          return (
            <div
              key={line}
              className={classes.join(" ")}
              onPointerEnter={() => {
                props.onHoverLine(line);
                if (pressed.current) setDrag({ from: pressed.current.line, to: line });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                pressed.current = { line, y: event.clientY };
              }}
              onPointerMove={(event) => {
                const from = pressed.current;
                if (!from || drag) return;
                if (Math.abs(event.clientY - from.y) >= DRAG_MINIMUM)
                  setDrag({ from: from.line, to: line });
              }}
            >
              <span className="rex-source-gutter">{line + offset}</span>
              <span className="rex-source-text">{text.length > 0 ? text : " "}</span>
              {numbered !== null ? <span className="rex-source-number">{numbered}</span> : null}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
