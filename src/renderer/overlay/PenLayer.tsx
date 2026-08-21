// Spec 06 §5.1 and §5.2 — the pen: a mode, like pick.
//
// A sibling of `PickLayer.tsx` and built from it, on the same terms: it sits
// above the document frame, swallows pointer events, and scrolls and zooms the
// document underneath — because a mode that stops you reading is a mode you
// leave.
//
// **The pen draws on REX's overlay, never on the document.** An SVG path
// written into the document's own tree would mutate the file under review and
// shift every offset the resolver depends on, which §6.7 already refuses for
// highlights.
//
// §6.3 — the toolbar carries undo, redo, cancel and done, and nothing else. The
// note field the sketch put here is deliberately absent: a floating field takes
// focus, so every bare-letter shortcut dies while it is open; it is dismissed by
// a stray click, taking the work with it; and it is the wrong home for something
// built up over time. Spec 05 removed exactly that card one spec ago. The note
// is typed where the note has always been typed — eight centimetres right, in
// the panel that already has one.

import { useEffect, useRef, useState } from "react";
import type { Point, Stroke } from "../anchor/lasso.ts";

interface Props {
  /**
   * Where the document's content starts, in pane coordinates, **as it is
   * painted right now** — measured live rather than passed as a number, because
   * it moves with every scroll and with every zoom.
   *
   * It is what a point is stored relative to, and getting that wrong is what
   * makes ink drift off the words. Scroll offset alone is not enough: prose is
   * centred in the pane, so zooming in *narrows* the margin rather than scaling
   * it, and a point stored as a plain document coordinate slides sideways.
   * Measured on 2026-08-21 on `sample-document.md` — vertical tracking was
   * exact and horizontal drifted by 9% of the table's width per zoom step.
   */
  origin: () => Point;
  /**
   * The document's own zoom. Points are kept at zoom 1 and drawn at this, so
   * ink laid down at 150% still traces the same words at 80% — the document
   * reflows and the ink reflows with it.
   */
  zoom: number;
  /** §5.2 — the drawing ends when the reviewer says so, not on pointer-up. */
  onDone: (strokes: Stroke[]) => void;
  onCancel: () => void;
  onScrollBy: (dx: number, dy: number) => void;
  onZoomBy: (factor: number) => void;
}

/** §11 — one red pen. No colours, no widths, no highlighter. */
export const PEN_WIDTH = 2.5;

/** Points closer than this add nothing but bytes. In zoom-1 document pixels. */
const MIN_STEP = 2;

/** A press with no drag is not a stroke. */
const MIN_POINTS = 2;

/** One stroke as an SVG path, in the coordinates it will be drawn at. */
export function pathData(stroke: ReadonlyArray<Point>, project: (p: Point) => Point): string {
  if (stroke.length === 0) return "";
  const first = project(stroke[0]);
  // A single point still has to show: a dot, drawn as a zero-length line, which
  // `stroke-linecap: round` renders as a disc.
  if (stroke.length === 1) return `M ${first.x} ${first.y} L ${first.x} ${first.y}`;
  return stroke
    .map((point, i) => {
      const at = project(point);
      return `${i === 0 ? "M" : "L"} ${at.x} ${at.y}`;
    })
    .join(" ");
}

export function PenLayer(props: Props): React.JSX.Element {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  /** Undone strokes, newest last. Cleared as soon as a new one is drawn. */
  const [undone, setUndone] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState<Stroke | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const { onCancel, onDone, zoom } = props;

  /**
   * Read through a ref so the key effect below does not re-subscribe on every
   * point of every stroke — which would be once per pointermove.
   */
  const live = useRef({ strokes, undone, drawing });
  live.current = { strokes, undone, drawing };

  // §5.1 — undo and redo act on whole strokes, never on points.
  //
  // Both read through `live` and set each piece of state directly. Moving one
  // stroke between two lists is one action, and expressing it as a `setUndone`
  // *inside* a `setStrokes` updater made the updater impure: React is free to
  // re-run an updater, so the nested call was dropped and redo never lit up.
  // Measured on 2026-08-21 — undo worked, redo stayed disabled forever.
  const undo = (): void => {
    const { strokes: current, undone: stack } = live.current;
    if (current.length === 0) return;
    setStrokes(current.slice(0, -1));
    setUndone([...stack, current[current.length - 1]]);
  };

  const redo = (): void => {
    const { strokes: current, undone: stack } = live.current;
    if (stack.length === 0) return;
    setStrokes([...current, stack[stack.length - 1]]);
    setUndone(stack.slice(0, -1));
  };

  const done = (): void => {
    const all = live.current.strokes;
    if (all.length === 0) {
      // Nothing drawn is nothing to select; leaving is the honest outcome.
      onCancel();
      return;
    }
    onDone(all);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // The selection panel is open beside the pen and its note has a caret;
      // `composedPath()[0]` because the shadow boundary retargets `event.target`
      // to the host — see App.tsx.
      const focused = event.composedPath()[0];
      if (
        focused instanceof HTMLElement &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" || focused.isContentEditable)
      ) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        done();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `undo`, `redo` and `done` all read through `live`, so they need no deps.
  }, [onCancel, onDone]);

  // Measured once per render and reused for every point of every stroke: it is
  // one layout read, and reading it per point would be thousands.
  const from = props.origin();

  /** Pane coordinates → CSS pixels from the content's top-left corner. */
  const toDocument = (event: React.PointerEvent): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return {
      x: (event.clientX - (rect?.left ?? 0) - from.x) / zoom,
      y: (event.clientY - (rect?.top ?? 0) - from.y) / zoom,
    };
  };

  /** …and back, onto the page as it is painted now. */
  const project = (point: Point): Point => ({
    x: point.x * zoom + from.x,
    y: point.y * zoom + from.y,
  });

  const shown = drawing ? [...strokes, drawing] : strokes;

  return (
    <div
      ref={layerRef}
      className="rex-pen-layer"
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) {
          props.onZoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
          return;
        }
        props.onScrollBy(event.deltaX, event.deltaY);
      }}
      onPointerDown={(event) => {
        // The toolbar sits *inside* the layer, so its buttons raise this too.
        // Starting a stroke there would capture the pointer, and a captured
        // pointer retargets the `click` to the capture element — so the button
        // that was pressed never hears about it. Measured on 2026-08-21: undo,
        // redo, cancel and done were all inert until this returned early.
        if (event.target instanceof Element && event.target.closest(".rex-pentool")) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture keeps a fast stroke from tearing off the layer; letting it
          // throw out of the handler would abandon the stroke before it starts.
          // PickLayer guards the same call for the same reason.
        }
        setDrawing([toDocument(event)]);
      }}
      onPointerMove={(event) => {
        if (!drawing) return;
        const point = toDocument(event);
        const last = drawing[drawing.length - 1];
        if (Math.abs(point.x - last.x) < MIN_STEP && Math.abs(point.y - last.y) < MIN_STEP) return;
        setDrawing([...drawing, point]);
      }}
      onPointerUp={() => {
        if (!drawing) return;
        setDrawing(null);
        if (drawing.length < MIN_POINTS) return;
        setStrokes((current) => [...current, drawing]);
        // A new stroke is a new branch; what was undone before it is gone.
        setUndone([]);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* Below the toolbar and above the document, and never taking the
          pointer — the layer itself is the drawing surface. */}
      <svg className="rex-ink" aria-hidden="true">
        {shown.map((stroke, position) => (
          // A stroke has no id of its own; its place in the drawing is it, and
          // the list only ever grows or loses its tail.
          <path key={position} d={pathData(stroke, project)} strokeWidth={PEN_WIDTH * zoom} />
        ))}
      </svg>

      <div className="rex-pentool">
        <span className="rex-pathbar-label">PEN</span>
        <button type="button" disabled={strokes.length === 0} onClick={undo}>
          undo
        </button>
        <button type="button" disabled={undone.length === 0} onClick={redo}>
          redo
        </button>
        <span className="rex-spacer" />
        <span className="rex-pentool-count">
          {strokes.length} stroke{strokes.length === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
        <button
          type="button"
          className="rex-pentool-done"
          disabled={strokes.length === 0}
          onClick={done}
        >
          done
        </button>
        <span className="rex-pathbar-keys">
          <span>
            <span className="rex-key">enter</span>
            done
          </span>
          <span>
            <span className="rex-key">esc</span>
            leave
          </span>
        </span>
      </div>
    </div>
  );
}
