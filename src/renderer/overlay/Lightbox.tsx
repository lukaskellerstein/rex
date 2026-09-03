// Spec 10 §2.3 — one figure, as large as the window allows, pannable and
// zoomable. Spec 29 §4.2 — and for a Mermaid diagram, its source beside it.
//
// `transform: scale()` here, and that is not a contradiction of
// `DocumentView`'s insistence on CSS `zoom`. `zoom` is required *there* because
// the anchor resolver reads `getBoundingClientRect()` off the document and
// those rects have to keep agreeing with the layout underneath them. Nothing
// anchors into this component: it is REX's own chrome, drawn over everything,
// holding a copy of a figure rather than the figure. `transform` is composited
// on the GPU and does not reflow, which is what makes a drag feel like dragging.
//
// A diagram's places are made by the surface, never here: a click names the
// block and the part, `App` asks the surface for the anchor, and the panel gets
// the row. This file draws where those places are, on a copy, and nothing it
// draws is in the document.
//
// Inside the shadow root like everything else REX draws (spec 01 §7).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type DiagramParts,
  linesOf,
  partKey,
  partsOnLine,
  scanDiagram,
} from "../../shared/diagram.ts";
import type { AnchorState, DiagramPart } from "../../shared/types.ts";
import { partElements, partUnderPointer } from "../anchor/diagram.ts";
import { DiagramSource, type SourceComment, type SourcePlace } from "./DiagramSource.tsx";
import { Cross, FitFrame, ZoomIn, ZoomOut } from "./Icons.tsx";
import type { PreviewFigure } from "./preview.ts";

/** Spec 29 §4.2 — a place already taken on the open diagram, as the panel numbers it. */
export interface LightboxPlace {
  number: number;
  part: DiagramPart;
}

/** Spec 29 §4.2 — a comment that already exists on a part of the open diagram. */
export interface LightboxComment {
  part: DiagramPart;
  state: AnchorState;
}

interface Props {
  figure: PreviewFigure;
  onClose: () => void;
  /** Spec 29 §4.2 — a click on a part or a line takes a place. Only for a diagram. */
  onPick?: (part: DiagramPart) => void;
  places?: LightboxPlace[];
  comments?: LightboxComment[];
}

/** Spec 29 §4.2 — the three views of a diagram. */
type DiagramView = "drawing" | "source" | "both";
const VIEWS: DiagramView[] = ["drawing", "source", "both"];
const VIEW_WORDS: Record<DiagramView, string> = {
  drawing: "Drawing",
  source: "Source",
  both: "Both",
};

/**
 * Remembered for the session and not persisted: a preference about one
 * figure's view is not a setting about REX (spec 25 §6.1). `Both` first —
 * the reviewer asked to see the source *as well*.
 */
let rememberedView: DiagramView = "both";

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

/** A press and release closer than this is a click on a part, not a pan. */
const CLICK_SLACK = 4;

interface View {
  scale: number;
  x: number;
  y: number;
}

function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

/** Spec 29 §4.2 — the lines a hovered part points at: its own strongly, its other mentions lightly. */
function litLinesFor(
  parts: DiagramParts | null,
  part: DiagramPart | null,
  line: number | null,
): { strong: number[]; light: number[] } {
  if (line !== null) return { strong: [line], light: [] };
  if (!parts || !part) return { strong: [], light: [] };
  const span = linesOf(parts, part);
  if (!span) return { strong: [], light: [] };
  const strong: number[] = [];
  for (let at = span.from; at <= span.to; at++) strong.push(at);
  const light =
    part.kind === "node"
      ? (parts.nodes.get(part.id)?.mentions ?? []).filter((at) => !strong.includes(at))
      : [];
  return { strong, light };
}

/**
 * A part's box in the root SVG's own coordinates, so a `<rect>` appended to
 * the root lands on it whatever transforms sit between — Mermaid translates
 * every node's `<g>`, and the copy is scaled by the stage on top of that.
 * `getScreenCTM` on both ends is what folds all of it into one matrix.
 */
function boxInRoot(
  svg: SVGSVGElement,
  el: Element,
): { x: number; y: number; w: number; h: number } | null {
  if (!(el instanceof SVGGraphicsElement)) return null;
  const rootCtm = svg.getScreenCTM();
  const elCtm = el.getScreenCTM();
  if (!rootCtm || !elCtm) return null;
  const into = rootCtm.inverse().multiply(elCtm);
  const box = el.getBBox();
  const corners = [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x, box.y + box.height),
    new DOMPoint(box.x + box.width, box.y + box.height),
  ].map((point) => point.matrixTransform(into));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function Lightbox(props: Props): React.JSX.Element {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null);

  const { figure, onClose } = props;
  const diagram = figure.kind === "diagram" ? figure : null;

  // ── Spec 29 — the diagram's parts, and what the pointer is on ──
  const parts = useMemo(() => (diagram ? scanDiagram(diagram.source) : null), [diagram]);
  const [diagramView, setDiagramView] = useState<DiagramView>(rememberedView);
  const [hoverPart, setHoverPart] = useState<DiagramPart | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);

  const chooseView = useCallback((next: DiagramView): void => {
    rememberedView = next;
    setDiagramView(next);
  }, []);

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
    if (!host || (figure.kind !== "svg" && figure.kind !== "diagram")) return;
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

  // Spec 29 §4.2 — the stage is a different width under each view, so the
  // opening fit is taken again when the view changes.
  useEffect(() => {
    if (diagram) fit();
  }, [diagram, diagramView, fit]);

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

  // ── Spec 29 §4.2 — the marks drawn on the copy ──────────────
  //
  // Places, comments and the hover are `<rect>`s appended to the copied SVG's
  // root, in the root's own coordinates (`boxInRoot`), so they pan and zoom
  // with the drawing for free. The copy is REX's to draw on; the document's
  // diagram is never touched.
  const lit = useMemo(() => {
    if (!parts) return [];
    if (hoverPart) return [hoverPart];
    if (hoverLine !== null) return partsOnLine(parts, hoverLine);
    return [];
  }, [parts, hoverPart, hoverLine]);

  useEffect(() => {
    const svg = svgHostRef.current?.firstElementChild;
    if (!parts || !(svg instanceof SVGSVGElement)) return;
    svg.querySelector(".rex-lightbox-marks")?.remove();
    const marks = document.createElementNS(SVG_NS, "g");
    marks.setAttribute("class", "rex-lightbox-marks");
    const map = partElements(svg, parts);

    const draw = (part: DiagramPart, cls: string, number: number | null): void => {
      const element = map.get(partKey(part));
      if (!element) return;
      const box = boxInRoot(svg, element);
      if (!box) return;
      const pad = 4;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(box.x - pad));
      rect.setAttribute("y", String(box.y - pad));
      rect.setAttribute("width", String(box.w + pad * 2));
      rect.setAttribute("height", String(box.h + pad * 2));
      rect.setAttribute("rx", "4");
      rect.setAttribute("class", `rex-dmark ${cls}`);
      marks.append(rect);
      if (number !== null) {
        const badge = document.createElementNS(SVG_NS, "g");
        badge.setAttribute("class", "rex-dmark-number");
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", String(box.x - pad));
        circle.setAttribute("cy", String(box.y - pad));
        circle.setAttribute("r", "9");
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(box.x - pad));
        text.setAttribute("y", String(box.y - pad));
        text.textContent = String(number);
        badge.append(circle, text);
        marks.append(badge);
      }
    };

    for (const comment of props.comments ?? [])
      draw(comment.part, `rex-dmark-${comment.state}`, null);
    for (const place of props.places ?? []) draw(place.part, "rex-dmark-place", place.number);
    // Spec 29 §10 point 11 — the hover mark answers "which line is this" and
    // only `Both` has lines to answer with. In `Drawing` a hover draws nothing.
    if (diagramView !== "drawing") for (const part of lit) draw(part, "rex-dmark-hover", null);
    svg.append(marks);
  }, [parts, lit, props.places, props.comments, view.scale, diagramView]);

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
      // Spec 29 §4.2 — `s` cycles the three views of a diagram.
      else if (diagram && (event.key === "s" || event.key === "S")) {
        chooseView(VIEWS[(VIEWS.indexOf(rememberedView) + 1) % VIEWS.length]);
      } else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, zoomAbout, fit, diagram, chooseView]);

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
  }, [originOf, zoomAbout, diagramView]);

  // ── Spec 29 §4.2 — what the pointer is on, in the drawing ───
  //
  // The lightbox lives in a shadow root, so `document.elementFromPoint` would
  // answer with the host; the root the stage sits in is asked instead.
  const partUnder = useCallback(
    (event: { clientX: number; clientY: number }): DiagramPart | null => {
      const svg = svgHostRef.current?.firstElementChild;
      const stage = stageRef.current;
      if (!parts || !stage || !(svg instanceof SVGSVGElement)) return null;
      const root = stage.getRootNode();
      const hit =
        root instanceof ShadowRoot || root instanceof Document
          ? root.elementFromPoint(event.clientX, event.clientY)
          : null;
      // A mark is drawn over the part it marks; the part under it is the answer.
      const through = hit?.closest(".rex-lightbox-marks") ? null : hit;
      return partUnderPointer(svg, parts, through, event.clientX, event.clientY)?.part ?? null;
    },
    [parts],
  );

  // ── The drag ────────────────────────────────────────────────

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    // Stops the browser starting a text selection or its own image drag from
    // this press. The stylesheet's `user-select: none` covers the figure; this
    // covers the gesture, which is the half that survives a stray click.
    event.preventDefault();
    drag.current = { x: event.clientX, y: event.clientY, from: view, moved: false };
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
    if (!from) {
      if (!diagram) return;
      // No badge follows the pointer here (spec 29 §10 point 10): the mark on
      // the drawing and the lit lines in the source are the answer to "what am
      // I on", and a label over a node hid the node it named.
      const next = partUnder(event);
      setHoverPart((current) =>
        (current ? partKey(current) : null) === (next ? partKey(next) : null) ? current : next,
      );
      return;
    }
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) >= CLICK_SLACK)
      from.moved = true;
    setView({
      scale: from.from.scale,
      x: from.from.x + (event.clientX - from.x),
      y: from.from.y + (event.clientY - from.y),
    });
  };

  const onPointerUp = (event: React.PointerEvent): void => {
    const from = drag.current;
    drag.current = null;
    // Spec 29 §4.2 — a click on a part takes a place; a drag pans; a click on
    // empty ground does nothing.
    if (from && !from.moved && diagram && props.onPick) {
      const part = partUnder(event);
      if (part) props.onPick(part);
    }
  };

  const percent = Math.round(view.scale * 100);
  const litLines = litLinesFor(parts, hoverPart, hoverLine);

  const sourcePlaces: SourcePlace[] =
    parts && props.places
      ? props.places.flatMap((place) => {
          const span = linesOf(parts, place.part);
          return span ? [{ number: place.number, from: span.from, to: span.to }] : [];
        })
      : [];
  const sourceComments: SourceComment[] =
    parts && props.comments
      ? props.comments.flatMap((comment) => {
          const span = linesOf(parts, comment.part);
          return span ? [{ from: span.from, to: span.to, state: comment.state }] : [];
        })
      : [];

  const stage = (
    <div
      ref={stageRef}
      className="rex-lightbox-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setHoverPart(null);
      }}
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
  );

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

      {diagram && parts ? (
        // Spec 29 §4.2 — the drawing and its source, under one control.
        <div className={`rex-lightbox-split rex-lightbox-split-${diagramView}`}>
          {/*
            Both halves stay MOUNTED and are hidden, never unmounted. The SVG copy
            is put into its host once, by the layout effect above, and an
            unmounted host comes back empty: `Source` then `Drawing` showed a
            white rectangle where the diagram had been, for the rest of the
            preview. Reported on 2026-09-01. `hidden` is `display: none`, so a
            hidden half takes no grid column and `fit` measures nothing in it.
          */}
          <div className="rex-lightbox-half" hidden={diagramView === "source"}>
            {stage}
          </div>
          <div className="rex-lightbox-source" hidden={diagramView === "drawing"}>
            <div className="rex-source-head">
              <span className="rex-source-file">{figure.caption ?? "Mermaid"}</span>
              <span className="rex-source-span">
                {diagram.fenceLine !== null
                  ? `lines ${diagram.fenceLine + 1}–${diagram.fenceLine + diagram.source.split("\n").length}`
                  : `${diagram.source.split("\n").length} lines`}
                {" · "}
                {parts.type || "mermaid"}
              </span>
            </div>
            <DiagramSource
              source={diagram.source}
              parts={parts}
              fenceLine={diagram.fenceLine}
              litLines={litLines}
              places={sourcePlaces}
              comments={sourceComments}
              onHoverLine={setHoverLine}
              onPick={(part) => props.onPick?.(part)}
            />
          </div>
        </div>
      ) : (
        stage
      )}

      <div className="rex-lightbox-bar">
        {figure.caption ? (
          <span className="rex-lightbox-caption" title={figure.caption}>
            {figure.caption}
          </span>
        ) : null}
        {diagram ? (
          <>
            <div
              className="rex-segment rex-lightbox-views"
              role="tablist"
              aria-label="What the preview shows"
            >
              {VIEWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={diagramView === option}
                  className={diagramView === option ? "rex-on" : undefined}
                  title={`${VIEW_WORDS[option]} — s cycles`}
                  onClick={() => chooseView(option)}
                >
                  {VIEW_WORDS[option]}
                </button>
              ))}
            </div>
            <span
              className={`rex-lightbox-places${(props.places?.length ?? 0) === 0 ? " rex-lightbox-places-none" : ""}`}
            >
              {props.places?.length ?? 0} {(props.places?.length ?? 0) === 1 ? "place" : "places"}
            </span>
          </>
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
