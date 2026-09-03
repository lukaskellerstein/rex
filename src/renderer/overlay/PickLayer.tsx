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
  /**
   * Spec 26 §4.8 — `cause` is why: the pointer moved, or the document did.
   *
   * They are not the same question. A pointer that moves is the reviewer
   * pointing somewhere else, and a deliberate widening should give way when the
   * thing they chose is not there any more. A SCROLL moves the page under a
   * cursor that did not move at all, and dropping their choice for it is how
   * "widen to the section, scroll to see where it ends, click" ended in the
   * paragraph. App decides; the layer only says which happened.
   */
  onProbe: (x: number, y: number, cause: "move" | "scroll") => void;
  /** Enter commits whatever the path bar currently shows. */
  onCommit: (index: number) => void;
  /**
   * Spec 26 §4.4 — ⌥ with the wheel walks the chain, one scope per notch.
   *
   * It lands here and nowhere else because holding ⌥ for 250ms is what mounts
   * this layer: while ⌥ is down the layer is up and already owns the wheel.
   * Positive widens.
   */
  onWiden: (by: number) => void;
  /**
   * A CLICK commits what is under the pointer, named by where it landed rather
   * than by what the last probe happened to leave behind.
   *
   * The click carries its own coordinates because the alternative — trusting
   * `scopes[active]` from React state — has two ways to be empty at exactly the
   * moment it is needed. A click with no pointer move before it never probed,
   * so there is no chain and the click does nothing; and the pointer is already
   * resting over the document whenever pick mode is entered right after reading
   * or selecting something, which is precisely when nobody moves the mouse
   * first. Probing at the click point makes the first click behave like every
   * later one.
   */
  onCommitAt: (x: number, y: number) => void;
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

/**
 * Spec 26 §4.8 — how far the pointer must travel to count as pointing somewhere
 * else.
 *
 * A probe on every pixel is not only wasteful, it is destructive: a deliberate
 * widening survives a re-probe only while `keptIndex` can still find the chosen
 * element in the new chain, so a jitter of one or two pixels after a scroll was
 * enough to throw a chosen section away. Nobody means anything by two pixels —
 * a trackpad scroll nudges the cursor, and the mouse-down of a click carries a
 * `mousemove` with it.
 *
 * Small enough that moving between two adjacent table cells still answers.
 */
const MOVE_MINIMUM = 4;

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
  /** §4.8 — where the last probe was actually taken, for `MOVE_MINIMUM`. */
  const lastProbed = useRef<{ x: number; y: number } | null>(null);

  const scope = props.scopes?.[props.active] ?? null;
  const { onCancel, onCommit, scopes, active } = props;

  // Escape leaves; Enter takes what the bar is showing.
  //
  // Spec 26 §5.4 — ↑ and ↓ moved up to `App.tsx`. They have to work when this
  // layer is not mounted, because the bar outlives pick mode and a place taken
  // with a text drag never had a layer at all. Enter stays: committing what is
  // under the pointer is this layer's own gesture and means nothing without it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (!scopes || scopes.length === 0) return;
      // Pick mode and the selection panel are open together, and there Enter
      // belongs to the caret in the note, not to the scope chain.
      // `composedPath()[0]` because the shadow boundary retargets
      // `event.target` to the host — see App.tsx.
      const focused = event.composedPath()[0];
      if (
        focused instanceof HTMLElement &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")
      ) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit(active);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scopes, active, onCancel, onCommit]);

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
        // Spec 26 §4.4 — ⌥ with the wheel widens and narrows, in the same
        // direction the keys do and the crumbs read. Checked before the scroll,
        // because the reviewer holding ⌥ is holding it to pick, not to read.
        if (event.altKey) {
          props.onWiden(event.deltaY < 0 ? 1 : -1);
          return;
        }
        props.onScrollBy(event.deltaX, event.deltaY);
        // The document moved under a cursor that did not, so what the cursor is
        // over has changed. Probing again keeps the outline honest.
        const point = lastPoint.current;
        if (point && !props.arming) props.onProbe(point.x, point.y, "scroll");
      }}
      onPointerMove={(event) => {
        const point = toDocument(event);
        lastPoint.current = point;
        if (drag) {
          setDrag({ ...drag, toX: point.x + props.scrollX, toY: point.y + props.scrollY });
          return;
        }
        if (props.arming) return;
        // §4.8 — a move under `MOVE_MINIMUM` is not the reviewer pointing
        // somewhere else, and re-probing on it can throw away a scope they
        // chose by hand. Measured from the point the last probe was taken at,
        // not from the last event, so a slow drift still adds up to a move.
        const from = lastProbed.current;
        if (
          from &&
          Math.abs(point.x - from.x) < MOVE_MINIMUM &&
          Math.abs(point.y - from.y) < MOVE_MINIMUM
        ) {
          return;
        }
        lastProbed.current = point;
        props.onProbe(point.x, point.y, "move");
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
      onClick={(event) => {
        if (props.arming) return;
        const point = toDocument(event);
        props.onCommitAt(point.x, point.y);
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

      {/*
        Spec 26 §4.1 — the path bar is no longer drawn here. It outlives this
        layer, so `DocumentView` mounts it beside the mode strip; drawing it
        from inside the thing it outlives is exactly what made the widening
        vanish the moment ⌥ came up.
      */}
    </div>
  );
}
