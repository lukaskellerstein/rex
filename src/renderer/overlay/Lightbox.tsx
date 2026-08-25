// Spec 10 §2.3 — one figure, as large as the window allows, pannable and
// zoomable.
//
// `transform: scale()` here, and that is not a contradiction of
// `DocumentView`'s insistence on CSS `zoom`. `zoom` is required *there* because
// the anchor resolver reads `getBoundingClientRect()` off the document and
// those rects have to keep agreeing with the layout underneath them. Nothing
// anchors into this component: it is REX's own chrome, drawn over everything,
// holding a copy of a figure rather than the figure. `transform` is composited
// on the GPU and does not reflow, which is what makes a drag feel like dragging.
//
// Inside the shadow root like everything else REX draws (spec 01 §7).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Cross, FitFrame, ZoomIn, ZoomOut } from "./Icons.tsx";
import type { PreviewFigure } from "./preview.ts";

interface Props {
  figure: PreviewFigure;
  onClose: () => void;
}

/**
 * Wider than the document's own 0.4–3 (spec 04), on purpose.
 *
 * The whole reason to open this is that the figure was too small to read, and a
 * dense Mermaid graph rendered into a 620px measure needs several multiples
 * before its edge labels resolve. The floor is low enough to take in a tall
 * diagram whole.
 */
const SCALE_MIN = 0.1;
const SCALE_MAX = 12;
const SCALE_STEP = 1.15;

/**
 * How far the *opening* view will enlarge a small figure.
 *
 * Opening at 1:1 was the first thing built and it was wrong: a 346×546 Mermaid
 * diagram in a 1600×1000 window came up as a small square in the middle of a
 * lot of black, which is the size it already was in the document — the one
 * thing the reviewer opened it to stop looking at. So the opening view fills
 * the window.
 *
 * The cap is for raster: the stylesheet's `max-width`/`max-height` already
 * shrink anything too large, so this multiplier only ever applies to a figure
 * smaller than the window, and past about four times a screenshot is mush.
 * Vector art would take more, but one rule that is right for both beats two
 * that have to be told apart.
 */
const FIT_SCALE_MAX = 4;

/** How much of the stage the opening view fills, leaving the bar its room. */
const FIT_FRACTION = 0.94;

interface View {
  scale: number;
  x: number;
  y: number;
}

function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

export function Lightbox(props: Props): React.JSX.Element {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);

  const { figure, onClose } = props;

  /**
   * Back to the opening view: the whole figure, filling the window, centred.
   *
   * Measured rather than remembered, because it is also what `0` and a
   * double-click do — and by then the window may be a different size than it
   * was when the preview opened.
   *
   * `offsetWidth`, not `getBoundingClientRect()`: the rect is the *transformed*
   * box, so reading it here would fold the current zoom into the next one and
   * every press of `0` would shrink the figure again.
   */
  const fit = useCallback((): void => {
    const stage = stageRef.current;
    const drawn = figureRef.current;
    if (!stage || !drawn || drawn.offsetWidth === 0 || drawn.offsetHeight === 0) return;
    const scale = Math.min(
      FIT_SCALE_MAX,
      (stage.clientWidth * FIT_FRACTION) / drawn.offsetWidth,
      (stage.clientHeight * FIT_FRACTION) / drawn.offsetHeight,
    );
    // Never below 1: the stylesheet's `max-width`/`max-height` have already
    // fitted anything larger than the window, so a scale under 1 here would be
    // rounding error shrinking a figure that already fits.
    setView({ scale: Math.max(1, scale), x: 0, y: 0 });
  }, []);

  /**
   * Zoom about a point, so the thing under the pointer stays under it.
   *
   * Without this the figure creeps away from whatever is being examined, and
   * every notch of the wheel has to be paid back with a drag. `origin` is in
   * stage coordinates — the centre of the stage is (0, 0), which is where the
   * untransformed figure sits.
   */
  const zoomAbout = useCallback((factor: number, origin: { x: number; y: number } | null) => {
    setView((current) => {
      const scale = clampScale(current.scale * factor);
      // Clamped away, so the pan must not move either: a wheel at the limit
      // that still slid the figure sideways would read as a broken zoom.
      if (scale === current.scale) return current;
      if (!origin) return { ...current, scale };
      const ratio = scale / current.scale;
      return {
        scale,
        x: origin.x - (origin.x - current.x) * ratio,
        y: origin.y - (origin.y - current.y) * ratio,
      };
    });
  }, []);

  /** Where the pointer is, relative to the centre of the stage. */
  const originOf = useCallback((event: { clientX: number; clientY: number }) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const box = stage.getBoundingClientRect();
    return {
      x: event.clientX - (box.left + box.width / 2),
      y: event.clientY - (box.top + box.height / 2),
    };
  }, []);

  // ── The SVG case ────────────────────────────────────────────
  //
  // A sanitised fragment, put into a host element by hand: React would
  // otherwise try to own every child of an `<svg>` subtree it did not create.
  // Why a fragment rather than markup is `preview.ts`'s long comment.
  //
  // A layout effect rather than an ordinary one: the figure has to be measurable
  // before the first paint, or `fit` reads a zero-sized box and the diagram
  // opens at some arbitrary size.
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host || figure.kind !== "svg") return;
    // Cloned, because appending a fragment empties it — and this effect runs
    // again whenever the figure changes.
    host.replaceChildren(figure.svg.cloneNode(true));
    const svg = host.firstElementChild;
    if (svg instanceof SVGSVGElement) {
      // Mermaid caps the diagram at the measure it was drawn into, with an
      // inline `max-width` and `width: 100%`. Here that is exactly backwards —
      // it would hold the figure to the width of a column that is not even on
      // screen — so the intrinsic size from the viewBox is restored and the
      // stage does the fitting.
      //
      // The two properties are removed one at a time rather than by dropping
      // the whole `style` attribute, which is where the inlined appearance now
      // lives (`preview.ts`). Clearing it wholesale returned the diagram to
      // black boxes.
      svg.style.removeProperty("max-width");
      svg.style.removeProperty("width");
      const box = svg.viewBox.baseVal;
      if (box.width > 0 && box.height > 0) {
        svg.setAttribute("width", String(box.width));
        svg.setAttribute("height", String(box.height));
      }
    }
    fit();
  }, [figure, fit]);

  /**
   * An image has no size until it has loaded, so the fit is taken again then.
   *
   * `complete` covers the cached case, where the load event fired before this
   * component existed and would never fire again.
   */
  useLayoutEffect(() => {
    if (figure.kind !== "image") return;
    const image = figureRef.current?.querySelector("img");
    if (!image) return;
    if (image.complete) fit();
    else image.addEventListener("load", fit, { once: true });
    return () => image.removeEventListener("load", fit);
  }, [figure, fit]);

  /**
   * The preview takes the keyboard when it opens, and hands it back when it
   * closes.
   *
   * Without this, Escape did nothing in practice while appearing to work in
   * every test. A preview is opened by clicking a figure *inside the document
   * iframe*, and that click leaves focus in the iframe — so every key after it
   * is delivered to the document under review and never reaches the listener
   * below, which is on the renderer's own `document`. A synthetic click moves
   * no focus, which is exactly why the automated check passed.
   *
   * The active element is followed down through shadow roots on the way in:
   * from the outer document, focus anywhere inside REX reads as the host, and
   * restoring *that* would put the caret nowhere. What is wanted back is the
   * iframe itself, so the reader can carry on scrolling the document they were
   * reading.
   */
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let deepest = document.activeElement;
    while (deepest?.shadowRoot?.activeElement) deepest = deepest.shadowRoot.activeElement;
    const returnTo = deepest instanceof HTMLElement ? deepest : null;

    containerRef.current?.focus();
    return () => returnTo?.focus();
  }, []);

  // ── Keys ────────────────────────────────────────────────────
  //
  // Capture phase on `document`, and everything is stopped there: while the
  // preview is up it owns the keyboard. REX's own single-letter bindings — `p`,
  // `n`, `d`, `g`, ⇧A — are on `document` too, and a `p` typed at a preview
  // toggling pick mode on the page behind it is the kind of thing nobody
  // reproduces on purpose.
  //
  // `stopPropagation` and not `preventDefault`: a key's default action is not a
  // listener, so ⇥ still moves focus and ↩ still presses the focused button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomAbout(SCALE_STEP, null);
      else if (event.key === "-" || event.key === "_") zoomAbout(1 / SCALE_STEP, null);
      else if (event.key === "0") fit();
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, zoomAbout]);

  // ── The wheel ───────────────────────────────────────────────
  //
  // No modifier, unlike the document behind it: a lightbox is a single figure
  // and there is nothing else here for a bare wheel to mean. Attached by hand
  // rather than as a React prop because React registers `onWheel` passively,
  // and a passive listener cannot `preventDefault` — the window would scroll
  // behind the preview while the preview zoomed.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomAbout(event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP, originOf(event));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [originOf, zoomAbout]);

  // ── The drag ────────────────────────────────────────────────

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    // Stops the browser starting a text selection or its own image drag from
    // this press. The stylesheet's `user-select: none` covers the figure; this
    // covers the gesture, which is the half that survives a stray click.
    event.preventDefault();
    drag.current = { x: event.clientX, y: event.clientY, from: view };
    // Capture, so a fast drag that leaves the window still ends on this element
    // rather than stranding the figure mid-pan.
    //
    // It throws `InvalidPointerId` for a pointer the browser no longer holds
    // active, and losing the whole pan to that would be the wrong trade: the
    // capture is an improvement to the drag, not the drag itself.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* the drag still tracks; it just stops early if the pointer leaves */
    }
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const from = drag.current;
    if (!from) return;
    setView({
      scale: from.from.scale,
      x: from.from.x + (event.clientX - from.x),
      y: from.from.y + (event.clientY - from.y),
    });
  };

  const onPointerUp = (): void => {
    drag.current = null;
  };

  const percent = Math.round(view.scale * 100);

  return (
    // `tabIndex={-1}` so it can hold focus without joining the tab order: the
    // bar's own buttons are the things worth tabbing to.
    <div
      ref={containerRef}
      className="rex-lightbox"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={figure.caption ?? "Figure preview"}
    >
      {/*
        The scrim closes, and it is the whole background rather than a margin
        around the figure: "click away to dismiss" is only true if there is
        somewhere to click. The stage above it stops the click from reaching
        here, so a click *on* the figure pans and never closes.
      */}
      <button
        type="button"
        className="rex-lightbox-scrim"
        aria-label="Close the preview"
        onClick={onClose}
      />

      <div
        ref={stageRef}
        className="rex-lightbox-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Double-click is the shortest way back from "lost at 8×", which is
        // where pan-and-zoom always eventually puts someone.
        onDoubleClick={() => fit()}
      >
        {/*
          `translate` before `scale`, and the stylesheet's `transform-origin` is
          the figure's own centre — which is where the untransformed figure sits,
          because the stage centres it. That is the frame `zoomAbout` does its
          arithmetic in; swapping the two operations silently changes what a
          zoom about the pointer means.
        */}
        <div
          ref={figureRef}
          className="rex-lightbox-figure"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {figure.kind === "image" ? (
            // `draggable={false}`: without it Chromium starts its own image
            // drag on mousedown and the pan never begins.
            <img
              src={figure.src}
              alt={figure.caption ?? ""}
              draggable={false}
              // §2.4 — whatever the document draws the figure on. Null falls
              // through to the stylesheet's paper.
              style={figure.backdrop ? { background: figure.backdrop } : undefined}
            />
          ) : (
            <div
              ref={svgHostRef}
              className="rex-lightbox-svg"
              style={figure.backdrop ? { background: figure.backdrop } : undefined}
            />
          )}
        </div>
      </div>

      <div className="rex-lightbox-bar">
        {figure.caption ? (
          <span className="rex-lightbox-caption" title={figure.caption}>
            {figure.caption}
          </span>
        ) : null}
        <span className="rex-spacer" />
        <span className="rex-lightbox-scale">{percent}%</span>
        <button
          type="button"
          className="rex-icon-button"
          title="Zoom out — the wheel, or −"
          aria-label="Zoom out"
          onClick={() => zoomAbout(1 / SCALE_STEP, null)}
        >
          <ZoomOut />
        </button>
        <button
          type="button"
          className="rex-icon-button"
          title="Zoom in — the wheel, or +"
          aria-label="Zoom in"
          onClick={() => zoomAbout(SCALE_STEP, null)}
        >
          <ZoomIn />
        </button>
        <button
          type="button"
          className="rex-icon-button"
          title="Fit — double-click the figure, or 0"
          aria-label="Fit the figure to the window"
          onClick={() => fit()}
        >
          <FitFrame />
        </button>
        <button
          type="button"
          className="rex-icon-button"
          title="Close — Escape"
          aria-label="Close the preview"
          onClick={onClose}
        >
          <Cross />
        </button>
      </div>
    </div>
  );
}
