// design/selection/Hover and /selection/Region — pointing at an element, and
// cutting a box out of one.
//
// Everything this file draws is drawn **over** the document pane, never on the
// document. REX must not mutate the document under review: an outline written
// as a style attribute on a hovered element would be a mutation, would be
// visible to any agent that reads the file, and §6.7 already refuses the same
// trick for highlights. So the outline, the badge and the marquee are overlay
// boxes positioned from rects the surface reports back.
//
// The layer sits above the frame and swallows pointer events, which is what
// stops a pick-mode drag from starting a text selection underneath it. It is
// mounted only while picking.

import { useEffect, useRef, useState } from "react";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";

interface Props {
  /** The chain under the cursor, narrow first. Null before the first probe. */
  scopes: PickScope[] | null;
  active: number;
  scrollX: number;
  scrollY: number;
  /** True once a scope is chosen and a box is being dragged inside it. */
  arming: boolean;
  onProbe: (x: number, y: number) => void;
  onActive: (index: number) => void;
  /** Adds this element to the selection panel. Every click adds — spec 05 §3.1. */
  onCommit: (index: number) => void;
  onRegion: (index: number, box: ScopeRect) => void;
  onCancel: () => void;
  /**
   * Scrolls the document underneath.
   *
   * The layer sits over the frame and swallows the wheel, and the frame is its
   * *sibling* rather than its ancestor, so the browser has nothing to chain the
   * scroll to: without this, pick mode froze the document. Reading is most of
   * reviewing, and a mode that stops you reading is a mode you leave.
   */
  onScrollBy: (dx: number, dy: number) => void;
  /** ⌘/ctrl with the wheel zooms rather than scrolls, here as in the document. */
  onZoomBy: (factor: number) => void;
}

/** Ignore a click that was really a very small drag, and vice versa. */
const DRAG_MINIMUM = 6;

interface Drag {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

function boxOf(drag: Drag): ScopeRect {
  return {
    x: Math.min(drag.fromX, drag.toX),
    y: Math.min(drag.fromY, drag.toY),
    w: Math.abs(drag.toX - drag.fromX),
    h: Math.abs(drag.toY - drag.fromY),
  };
}

/** Keeps a dragged box inside the element it is being cut from. */
function clampTo(box: ScopeRect, bounds: ScopeRect): ScopeRect {
  const x = Math.max(bounds.x, Math.min(box.x, bounds.x + bounds.w));
  const y = Math.max(bounds.y, Math.min(box.y, bounds.y + bounds.h));
  return {
    x,
    y,
    w: Math.min(box.w, bounds.x + bounds.w - x),
    h: Math.min(box.h, bounds.y + bounds.h - y),
  };
}

export function PickLayer(props: Props): React.JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** Where the pointer last was, in pane coordinates — a scroll re-probes there. */
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const scope = props.scopes?.[props.active] ?? null;
  const { onActive, onCancel, onCommit, scopes, active } = props;

  // ↑ / ↓ widen and narrow; escape leaves. The path bar's crumbs do the same,
  // and both are the same widening the composer's chips perform after a click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (!scopes || scopes.length === 0) return;
      // Pick mode and the selection panel are open together, and there ↑ belongs
      // to the caret in the note, not to the scope chain. `composedPath()[0]`
      // because the shadow boundary retargets `event.target` to the host — see
      // App.tsx.
      const focused = event.composedPath()[0];
      if (
        focused instanceof HTMLElement &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")
      ) {
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onActive(Math.min(active + 1, scopes.length - 1));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        onActive(Math.max(active - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        onCommit(active);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scopes, active, onActive, onCancel, onCommit]);

  /** Pane coordinates → the document's own, so probes and rects agree. */
  const toDocument = (event: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    const rect = layerRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  // The document scrolls under a fixed layer, so a rect in document
  // coordinates has to come back by the current scroll offset to be drawn.
  const place = (rect: ScopeRect): React.CSSProperties => ({
    left: rect.x - props.scrollX,
    top: rect.y - props.scrollY,
    width: rect.w,
    height: rect.h,
  });

  const marquee = drag && scope ? clampTo(boxOf(drag), scope.rect) : null;

  return (
    // The layer is a pointer surface, not a control: every route into it —
    // arrow keys, escape, enter, and the path bar's own buttons — is keyboard
    // reachable, and pick mode itself is entered from a real button.
    <div
      ref={layerRef}
      className="rex-pick-layer rex-pick-layer-active"
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) {
          props.onZoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
          return;
        }
        props.onScrollBy(event.deltaX, event.deltaY);
        // The document moved under a cursor that did not, so what the cursor is
        // over has changed. Probing again keeps the outline honest.
        const point = lastPoint.current;
        if (point && !props.arming) props.onProbe(point.x, point.y);
      }}
      onPointerMove={(event) => {
        const point = toDocument(event);
        lastPoint.current = point;
        if (drag) {
          setDrag({ ...drag, toX: point.x + props.scrollX, toY: point.y + props.scrollY });
          return;
        }
        if (!props.arming) props.onProbe(point.x, point.y);
      }}
      onPointerDown={(event) => {
        if (!props.arming) return;
        const point = toDocument(event);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is an optimisation — it keeps a fast drag from tearing off
          // the layer. Splitter.tsx guards the same call for the same reason:
          // letting it throw out of the handler abandons the drag before it
          // starts, and the region is never cut.
        }
        const at = { x: point.x + props.scrollX, y: point.y + props.scrollY };
        setDrag({ fromX: at.x, fromY: at.y, toX: at.x, toY: at.y });
      }}
      onPointerUp={() => {
        if (!drag) return;
        const box = scope ? clampTo(boxOf(drag), scope.rect) : boxOf(drag);
        setDrag(null);
        if (box.w >= DRAG_MINIMUM && box.h >= DRAG_MINIMUM) props.onRegion(props.active, box);
      }}
      onClick={() => {
        if (!props.arming && scope) props.onCommit(props.active);
      }}
      onContextMenu={(event) => {
        // Swallowed, and nothing more. Spec 05 §3.1 removed the modifiers: on
        // macOS ctrl-click *is* a right-click, the OS owns that gesture, and
        // building selection on top of it is fault 1 of §1. Every plain click
        // adds now, so no modifier has anything left to do.
        event.preventDefault();
      }}
    >
      {/*
        Spec 06 §6.4 — the whole document draws no box. Its two edges are never
        on screen together, so the "outline" would be a pair of vertical lines
        down the viewport saying nothing. The badge alone says what is chosen,
        pinned where it can always be read.

        A section is outlined but not filled, for the reason §6.4 gives about
        the mark: a wash over four thousand characters is a page you cannot
        read, and pick mode is exactly when the reviewer is still reading.
      */}
      {scope && !props.arming ? (
        scope.extent === "document" ? (
          <div className="rex-pick-badge rex-pick-badge-pinned">the whole document</div>
        ) : (
          <>
            <div
              className={
                scope.extent ? "rex-pick-outline rex-pick-outline-run" : "rex-pick-outline"
              }
              style={place(scope.rect)}
            />
            <div
              className="rex-pick-badge"
              style={{
                left: scope.rect.x - props.scrollX - 2,
                top: scope.rect.y - props.scrollY - 20,
              }}
            >
              {scope.label.split("#")[0]}
              {scope.label.includes("#") ? <span>#{scope.label.split("#")[1]}</span> : null}
            </div>
          </>
        )
      ) : null}

      {props.arming && scope ? (
        <div className="rex-pick-outline" style={place(scope.rect)} />
      ) : null}

      {marquee ? (
        <div className="rex-marquee" style={place(marquee)}>
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : null}

      {props.scopes && props.scopes.length > 0 ? (
        <div className="rex-pathbar">
          <span className="rex-pathbar-label">PATH</span>
          <div className="rex-crumbs">
            {/* Widest first: a path reads outside in, even though the chain is
                built inside out. */}
            {[...props.scopes].reverse().map((crumb, position) => (
              <span key={crumb.index} className="rex-crumbs">
                {position > 0 ? <span className="rex-crumb-sep">›</span> : null}
                <button
                  type="button"
                  className={crumb.index === props.active ? "rex-crumb rex-crumb-on" : "rex-crumb"}
                  title={crumb.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onActive(crumb.index);
                  }}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
          <span className="rex-pathbar-keys">
            <span>
              <span className="rex-key">↑</span>
              <span className="rex-key">↓</span>
              widen / narrow
            </span>
            <span>
              <span className="rex-key">click</span>
              adds to the selection
            </span>
            <span>
              <span className="rex-key">esc</span>
              leave
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
