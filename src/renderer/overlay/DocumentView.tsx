// The document under review, plus the margin REX draws beside it.
//
// Tier 1 (§5.2) renders into an iframe that is `sandbox="allow-same-origin"`
// and nothing else: same-origin so the resolver can reach the DOM for
// anchoring (§6.3 rule 3), and without `allow-scripts` so a local file's
// scripts cannot run (§5.4 step 2). Tier 2 renders into a <webview>, where the
// resolver runs behind a preload instead.
//
// The pane is a row — frame, then a 32px gutter — rather than a gutter floating
// over the frame, so nothing the author wrote ever sits under REX's markers.

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenedDocument, StrokeRef, ThreadWithMessages } from "../../shared/types.ts";
import type { Stroke } from "../anchor/lasso.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import {
  type DocumentSurface,
  FrameSurface,
  type ResolvedThread,
  type WebviewElement,
  WebviewSurface,
} from "./anchoring.ts";
import { enrichDocument } from "./enrich.ts";
import { Gutter } from "./Gutter.tsx";
import { Trash } from "./Icons.tsx";
import { pointsOfStroke, rescaleRect, unionOfRects } from "./ink.ts";
import { ModeStrip } from "./ModeStrip.tsx";
import { PenLayer, pathData } from "./PenLayer.tsx";
import { PickLayer } from "./PickLayer.tsx";
import { addPaperFonts } from "./paperFonts.ts";
import { attachFigurePreview, type PreviewFigure } from "./preview.ts";
import { prepareDocumentHtml } from "./sanitise.ts";
import type { SelectionItem } from "./selection.ts";

interface Props {
  doc: OpenedDocument | null;
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  /** Spec 05 §3 — the panel's items. Only this document's are drawn. */
  selection: SelectionItem[];
  /** The item the reviewer is pointing at, in the panel or here (§6). */
  hoveredItemId: string | null;
  onHoverItem: (id: string | null) => void;
  /** Drop one place from the selection, from its own outline rather than the panel. */
  onRemoveItem: (id: string) => void;
  /** Spec 05 §5.6.1 — what an Apply changed in this document, while it is pending. */
  changeBoxes: ScopeRect[];
  picking: boolean;
  pickScopes: PickScope[] | null;
  pickActive: number;
  arming: boolean;
  /** Spec 06 §5.1 — the pen layer, mounted only while the mode is on. */
  penning: boolean;
  /** §5.4 — the ink for the comment being built, if it was drawn. */
  selectionStroke: StrokeRef | null;
  /** §6.4 — a saved comment's ink shows when its row is hovered, too. */
  hoveredThreadId: string | null;
  /** Spec 08 §7.2 — which of the open comment's places is being pointed at. */
  hoveredPlace: number | null;
  /** Spec 08 §4 — both modes are turned on from the foot of the paper now. */
  onTogglePick: () => void;
  onTogglePen: () => void;
  onDrawn: (strokes: Stroke[]) => void;
  onPenCancel: () => void;
  onSurfaceReady: (surface: DocumentSurface) => void;
  onSelectionChanged: () => void;
  /** Spec 10 §2 — a figure was clicked, and wants to be read at a real size. */
  onPreview: (figure: PreviewFigure) => void;
  /**
   * The pane changed size, so every box the overlay draws was measured against
   * a layout that no longer exists.
   *
   * Watched on the frame rather than on `window`, because most of what resizes
   * this pane never touches the window: dragging either splitter, the explorer
   * appearing when a folder is opened, the comments column being hidden behind
   * the graph. Measured on 2026-08-21 — a splitter drag left every selection
   * outline behind while the prose re-centred around it.
   */
  onPaneResized: () => void;
  onSelectMarker: (threadId: string) => void;
  onProbe: (x: number, y: number) => void;
  onPickActive: (index: number) => void;
  onPickCommit: (index: number) => void;
  /** A click in pick mode, at the point it landed on. */
  onPickCommitAt: (x: number, y: number) => void;
  onPickCancel: () => void;
  onRegion: (index: number, box: ScopeRect) => void;
  onScrollBy: (dx: number, dy: number) => void;
  /** The document's own zoom. 1 is 100%. */
  zoom: number;
  onZoomBy: (factor: number) => void;
  onZoomReset: () => void;
  /** Called once a new zoom is on the page, so the resolver can re-measure. */
  onZoomApplied: () => void;
}

function baseHref(directory: string): string {
  const encoded = directory
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `rex-doc://doc${encoded}/`;
}

/**
 * The empty page a PDF is drawn into (spec 03 §7.2).
 *
 * REX's own markup, not the author's, so it does not go through DOMPurify. Its
 * stylesheet arrives with the pass that creates the elements it styles.
 */
const PDF_SHELL =
  '<!doctype html><html lang="en" data-rex-paper><head><meta charset="utf-8"></head><body></body></html>';

/**
 * Fragment links, which `<base href>` breaks.
 *
 * The document sits in a srcdoc iframe, and its own images and stylesheets can
 * only find themselves through a `<base href="rex-doc://…/">` (sanitise.ts).
 * That same base also resolves `#installation` against `rex-doc://…/`, so a
 * table-of-contents link stops being a jump inside the page and becomes a
 * navigation to a URL that 404s. Measured on 2026-08-21: all nine links in
 * `sample-document.md` were dead this way even after the headings gained their
 * ids, and the only symptom was a 404 in the console.
 *
 * The iframe runs no script (spec 01 §5.4 step 2), so the renderer scrolls it
 * from outside — the same reaching-in the anchor resolver has always done, and
 * the mechanism spec 03 §4.1 describes.
 */
function jumpToFragmentsInsteadOfNavigating(inner: Document): void {
  inner.addEventListener("click", (event: MouseEvent) => {
    // Not `event.target instanceof Element`. The target belongs to the iframe's
    // realm and `Element` here is the overlay's own constructor, so instanceof
    // across the two documents is always false — the listener would run, match
    // nothing, and let every link navigate exactly as if it were not there.
    const start = event.target as Element | null;
    const link = typeof start?.closest === "function" ? start.closest("a[href]") : null;
    const href = link?.getAttribute("href");
    if (!href?.startsWith("#") || href.length < 2) return;

    const heading = inner.getElementById(decodeURIComponent(href.slice(1)));
    if (!heading) return;
    event.preventDefault();
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** One wheel notch, or one press of ⌘+. */
const ZOOM_IN = 1.1;
const ZOOM_OUT = 1 / 1.1;

/**
 * CSS `zoom`, not `transform: scale`.
 *
 * `zoom` takes part in layout, so `getBoundingClientRect()` and `scrollY`
 * inside the frame both report the scaled geometry and keep agreeing with each
 * other — which is the only reason the overlay's boxes still land on the right
 * things. `transform` would leave layout at 1× and every rect the resolver
 * reads would be a lie. It also reflows a Markdown document to the new size
 * instead of letting a scaled page run off the side.
 */
function applyZoom(inner: Document | null, zoom: number): void {
  if (!inner) return;
  inner.documentElement.style.zoom = String(zoom);
}

/**
 * ⌘/ctrl with the wheel, or with + − 0, while the pointer or the caret is
 * inside the document itself.
 *
 * The listeners have to live *in* the frame's document. An event that happens
 * inside an iframe never reaches the parent, so a wheel over the prose is
 * invisible to the overlay — and `preventDefault` here is what stops Chromium
 * from applying its own page zoom on top of ours.
 */
function zoomFromInside(
  inner: Document,
  commands: { current: { by: (factor: number) => void; reset: () => void } },
): void {
  inner.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      commands.current.by(event.deltaY < 0 ? ZOOM_IN : ZOOM_OUT);
    },
    // Wheel listeners are passive by default, and a passive one cannot
    // preventDefault — the browser would zoom the whole frame as well.
    { passive: false },
  );

  inner.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
    if (event.key === "+" || event.key === "=") commands.current.by(ZOOM_IN);
    else if (event.key === "-" || event.key === "_") commands.current.by(ZOOM_OUT);
    else if (event.key === "0") commands.current.reset();
    else return;
    event.preventDefault();
  });
}

/** A drag-resize fires continuously; answer once it stops. */
const RESIZE_SETTLE_MS = 200;

export function DocumentView(props: Props): React.JSX.Element {
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const webviewRef = useRef<WebviewElement>(null);
  const paneRef = useRef<HTMLElement>(null);

  const { doc, onSurfaceReady, onSelectionChanged } = props;
  const isWebview = doc !== null && doc.presentation.kind === "url";

  /**
   * Spec 06 §5.4 — where the document's content starts, in pane coordinates,
   * measured at the moment it is asked for.
   *
   * A callback rather than a number because it moves with every scroll and with
   * every zoom, and the pen has to store points relative to it — see the note
   * on `PenLayer`'s own `origin` prop for what happens when it does not.
   */
  const contentOrigin = useCallback((): { x: number; y: number } => {
    const frame = frameRef.current;
    const pane = paneRef.current;
    const body = frame?.contentDocument?.body;
    if (!frame || !pane || !body) return { x: 0, y: 0 };
    const paneBox = pane.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    return {
      x: frameBox.left - paneBox.left + bodyBox.left,
      y: frameBox.top - paneBox.top + bodyBox.top,
    };
  }, []);

  /**
   * The live zoom and the live zoom callback, for listeners that live inside
   * the document frame.
   *
   * Those listeners are attached once per document load, and the load effect
   * must not re-run when the zoom changes — re-running it rewrites `srcdoc`,
   * which reloads the document under review and throws away its scroll
   * position. So they read through refs instead of closing over the value.
   */
  const zoomRef = useRef(props.zoom);
  const zoomCommands = useRef({ by: props.onZoomBy, reset: props.onZoomReset });
  zoomRef.current = props.zoom;
  zoomCommands.current = { by: props.onZoomBy, reset: props.onZoomReset };

  /** Read through a ref for the same reason, and it matters more here: a
      re-run of the load effect would rewrite `srcdoc` mid-review. */
  const previewRef = useRef(props.onPreview);
  previewRef.current = props.onPreview;

  // ── Tiers 1 and 3: fill the iframe, enrich it, then hand up a surface ──

  useEffect(() => {
    const frame = frameRef.current;
    if (!doc || doc.presentation.kind === "url" || !frame) return;

    // Spec 03 §9 — `presentation` is a union so this stays exhaustive.
    // `noFallthroughCasesInSwitch` is on, so a format added later is a compile
    // error here rather than a blank pane.
    const srcdoc =
      doc.presentation.kind === "html"
        ? prepareDocumentHtml(doc.presentation.html, doc.baseDir ? baseHref(doc.baseDir) : null)
        : // A PDF starts as an empty page; the §7 pass builds every page into
          // it before the surface is handed up.
          PDF_SHELL;

    let live = true;
    const onLoad = async (): Promise<void> => {
      if (!live) return;
      const view = frame.contentWindow;
      const inner = frame.contentDocument;
      if (!view || !inner) return;

      const follow = (): void => setScroll({ x: view.scrollX, y: view.scrollY });
      follow();
      view.addEventListener("scroll", follow, { passive: true });
      inner.addEventListener("mouseup", onSelectionChanged);
      jumpToFragmentsInsteadOfNavigating(inner);
      zoomFromInside(inner, zoomCommands);

      // Before the zoom, and long before the surface: a face that lands after
      // the page has been measured reflows every line under it.
      await addPaperFonts(view).catch((error: unknown) =>
        console.warn("[rex] the paper's DM Sans faces did not load", error),
      );
      if (!live) return;

      // Before the surface is handed up, so the text index and every rect the
      // resolver takes are measured at the size the reader is actually seeing.
      applyZoom(inner, zoomRef.current);

      // Spec 03 §4.3 — the DOM must be final before the surface is handed up,
      // because `onSurfaceReady` is what makes the resolver build its text
      // index. An anchor created against a half-drawn document records offsets
      // into text that is about to move: it resolves, it reports `ok`, and it
      // points at the wrong place.
      await enrichDocument(inner, doc);
      if (!live) return;

      // After the enrichment passes: until Mermaid has run there is no `<svg>`
      // for a click to find, and the size test a diagram has to pass is a test
      // of its drawn box.
      attachFigurePreview(inner, (figure) => previewRef.current(figure));

      // NOTHING SETS `color-scheme` ON THIS FRAME, and it is worth a note
      // because the obvious improvement is a bug.
      //
      // A build of this file measured the document's ground and set a matching
      // `color-scheme` on the iframe, to give a dark document a dark scrollbar.
      // It broke rendering. `color-scheme` on the embedder decides what
      // `prefers-color-scheme` resolves to *inside* the frame, and the three
      // ProtoBot review documents theme themselves with exactly that media
      // query and no script — the sandbox runs none (spec 01 §5.4 step 2), so
      // the media query is the only theme they have. Worse, the value stuck to
      // the element across loads: open a Markdown file, then one of those, and
      // the second inherited the first's `light` and rendered light on a
      // dark-mode machine.
      //
      // Left alone, the frame inherits the reader's own preference, the
      // document's media query decides, and REX renders rather than restyles.

      onSurfaceReady(new FrameSurface(frame, doc.ref.kind === "file" ? doc.ref.value : null));
    };

    // `load` cannot await, so the async work is fired and the `live` flag is
    // what stops a stale document from handing up a surface after the reviewer
    // has already opened another one.
    const onLoadEvent = (): void => void onLoad();

    frame.addEventListener("load", onLoadEvent);
    frame.srcdoc = srcdoc;
    return () => {
      live = false;
      frame.removeEventListener("load", onLoadEvent);
    };
  }, [doc, onSurfaceReady, onSelectionChanged]);

  // ── Tier 2: the <webview> resolves inside its own process ───

  useEffect(() => {
    const webview = webviewRef.current;
    if (doc?.presentation.kind !== "url" || !webview) return;

    const onReady = (): void => {
      onSurfaceReady(new WebviewSurface(webview));
      // A remote page scrolls in its own process; markers follow its scroll
      // rather than the overlay's, and a poll is the cheapest honest way to
      // track it without another IPC surface.
      setScroll({ x: 0, y: 0 });
    };

    webview.addEventListener("dom-ready", onReady);
    webview.setAttribute("src", doc.ref.value);
    return () => webview.removeEventListener("dom-ready", onReady);
  }, [doc, onSurfaceReady]);

  useEffect(() => {
    if (!isWebview) return;
    const timer = window.setInterval(() => onSelectionChanged(), 700);
    return () => window.clearInterval(timer);
  }, [isWebview, onSelectionChanged]);

  // ── The pane's own size ─────────────────────────────────────

  const { onPaneResized } = props;
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    let timer = 0;
    // It fires once on observe, before there is a surface. That call is free —
    // the sweep behind it returns early until one is handed up.
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onPaneResized, RESIZE_SETTLE_MS);
    });
    observer.observe(pane);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [onPaneResized]);

  // ── Zoom ────────────────────────────────────────────────────
  //
  // Applied here rather than in the load effect, which must not re-run: it
  // rewrites `srcdoc` and would reload the document on every notch of the
  // wheel. The load effect applies the *current* zoom once, this one applies
  // every change after that.
  const { zoom, onZoomApplied } = props;
  useEffect(() => {
    if (isWebview) {
      // A remote page is another process, so the same one line is executed
      // inside it. Electron's own `setZoomFactor` would scale the whole
      // <webview> chrome-side, which is a different thing.
      void webviewRef.current?.executeJavaScript(
        `document.documentElement.style.zoom = ${JSON.stringify(String(zoom))}`,
      );
    } else {
      applyZoom(frameRef.current?.contentDocument ?? null, zoom);
    }
    // Every box the overlay draws was measured at the old size, so the
    // resolver has to run again before any of them is believable.
    onZoomApplied();
  }, [zoom, isWebview, onZoomApplied]);

  // One outline per checked target, so a comment written against three rows
  // shows all three. The thread id alone is not unique, hence the position.
  const blocks = props.resolved.flatMap((entry) => {
    // Spec 06 §6.4 — a run is outlined, never filled, so it needs to be told
    // apart from an ordinary block box. The anchor already says: only the two
    // scopes that cover more than the thing they name carry an extent.
    const thread = props.threads.find((one) => one.id === entry.threadId);
    return entry.checked
      .filter((check) => check.box !== null)
      .map((check) => ({
        entry,
        check,
        box: check.box as ScopeRect,
        run: Boolean(thread?.targets[check.position]?.anchor.extent),
      }));
  });

  // Spec 05 §6 — the selection's own places, drawn only for this document. The
  // number is the row's number in the panel, so nine cells and nine rows can be
  // told apart, and a place in another document keeps its number without a box.
  const marks = props.selection.flatMap((item, position) =>
    // A row from another document keeps its number without a box, and so does
    // one whose anchor stopped resolving here — see `SelectionItem.rect`.
    item.documentId === props.doc?.documentId && item.rect
      ? [
          {
            id: item.id,
            number: position + 1,
            // Rescaled from the zoom it was measured at: a selection outlives a
            // zoom change, and reading a table closely before deciding whether
            // the fourth row belongs is exactly when someone zooms.
            box: rescaleRect(item.rect, props.zoom / item.zoom),
          },
        ]
      : [],
  );

  /**
   * Spec 06 §6.4 — whose ink is on the glass right now.
   *
   * The selection's while the panel holds it, and a saved comment's when that
   * comment is the open one or its row is hovered. **Not always:** twelve
   * drawings on one page, all showing at once, is a scribbled-on document
   * rather than a reviewed one.
   *
   * Each maps its stored fractions onto a union box measured by the last sweep,
   * which is what makes the ink follow a reflow, a resize and a zoom — §5.4.
   */
  /**
   * Spec 08 §7.2 — the place the card is pointing at, if it is in THIS
   * document and the sweep found somewhere to point.
   */
  const activeMark = ((): { number: number; box: ScopeRect } | null => {
    if (props.activeId === null || props.hoveredPlace === null) return null;
    const entry = props.resolved.find((one) => one.threadId === props.activeId);
    const target = entry?.checked.find((one) => one.position === props.hoveredPlace);
    return target?.mark ? { number: props.hoveredPlace + 1, box: target.mark } : null;
  })();

  const shownStroke = ((): { stroke: StrokeRef; union: ScopeRect } | null => {
    if (props.selectionStroke) {
      const union = unionOfRects(marks.map((mark) => mark.box));
      if (union) return { stroke: props.selectionStroke, union };
    }
    const showing = props.activeId ?? props.hoveredThreadId;
    if (!showing) return null;
    const thread = props.threads.find((one) => one.id === showing);
    const union = props.resolved.find((entry) => entry.threadId === showing)?.union ?? null;
    return thread?.stroke && union ? { stroke: thread.stroke, union } : null;
  })();

  return (
    <main className="rex-doc" ref={paneRef}>
      {doc === null ? (
        <div className="rex-empty">
          <h1>REX</h1>
          <p>
            Open a Markdown, HTML, PDF, DOCX or PPTX document, or a folder, to start commenting.
          </p>
        </div>
      ) : null}

      {isWebview ? (
        <webview
          ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
          className="rex-frame"
          preload={doc?.webviewPreload ?? undefined}
        />
      ) : (
        <iframe
          ref={frameRef}
          className="rex-frame"
          title="Document under review"
          sandbox="allow-same-origin"
        />
      )}

      {/*
        Spec 05 §5.6.1 — what an Apply just changed, in the write colour, while
        the reviewer decides. Drawn first so a selection outline over the same
        block still reads on top of it.
      */}
      {props.changeBoxes.map((box) => (
        <div
          key={`change-${box.x}-${box.y}-${box.w}-${box.h}`}
          className="rex-change-outline"
          style={{
            left: box.x - scroll.x,
            top: box.y - scroll.y,
            width: box.w,
            height: box.h,
          }}
        />
      ))}

      {/*
        Every place the selection is about, outlined at once. A list of nine
        cells in the panel does not tell the reviewer *which* nine, and the whole
        reason to comment on nine cells is that their arrangement matters. Drawn
        from the rect captured at the click, so no anchor has to be resolved
        before the comment exists.
      */}
      {marks.map((mark) => (
        <div
          key={mark.id}
          className={`rex-draft-outline${
            props.hoveredItemId === mark.id ? " rex-draft-outline-lit" : ""
          }`}
          style={{
            left: mark.box.x - scroll.x,
            top: mark.box.y - scroll.y,
            width: mark.box.w,
            height: mark.box.h,
          }}
          onMouseEnter={() => props.onHoverItem(mark.id)}
          onMouseLeave={() => props.onHoverItem(null)}
        >
          <span className="rex-draft-index">{mark.number}</span>
          {/*
            Dropping a place without going to find its row in the panel. It
            mirrors the number badge across the box — badge left, trash right —
            and like the badge it is the only other part of the outline that
            takes the mouse, sitting in the margin rather than over the prose.
          */}
          <button
            type="button"
            className="rex-draft-remove"
            aria-label={`Remove place ${mark.number} from the selection`}
            title="Remove this place"
            onClick={() => props.onRemoveItem(mark.id)}
          >
            <Trash size={11} />
          </button>
        </div>
      ))}

      {/*
        Spec 08 §7.2 — REX pointing back.

        Point at a place in the open comment's card and its mark here takes the
        same number, in the violet the open comment is painted in. With nine
        cells picked, "which nine" is the whole question — and a list that
        cannot answer it is a list of nine identical rows.

        One at a time, and only while pointed at: nine permanent badges over the
        prose is the wall this is meant to avoid.
      */}
      {activeMark ? (
        <span
          className="rex-place-mark"
          style={{ left: activeMark.box.x - scroll.x, top: activeMark.box.y - scroll.y }}
        >
          {activeMark.number}
        </span>
      ) : null}

      {/*
        An anchor on a whole element or a region of one is an outline, not a
        fill: the Custom Highlight API paints ranges, so there is no range to
        paint here — and drawing it as an overlay box keeps the promise that
        REX never touches the document's own tree.
      */}
      {blocks.map(({ entry, check, box, run }) => (
        <div
          key={`${entry.threadId}-${check.position}`}
          className={`rex-block-outline${check.state === "moved" ? " rex-block-moved" : ""}${
            props.activeId === entry.threadId ? " rex-block-active" : ""
          }${run ? " rex-block-run" : ""}`}
          style={{
            left: box.x - scroll.x,
            top: box.y - scroll.y,
            width: box.w,
            height: box.h,
          }}
        />
      ))}

      {/*
        Above the document and below the pen's own toolbar, offset by scroll
        like every other mark. Drawn here rather than in `PenLayer` because the
        ink outlives the layer: the layer is mounted only while the mode is on.
      */}
      {shownStroke ? (
        <svg className="rex-ink rex-ink-shown" aria-hidden="true">
          {pointsOfStroke(shownStroke.stroke, shownStroke.union).map((path, position) => (
            // A stroke has no id of its own; its place in the drawing is it.
            <path
              key={position}
              d={pathData(path, (point) => ({ x: point.x - scroll.x, y: point.y - scroll.y }))}
              strokeWidth={shownStroke.stroke.width * props.zoom}
            />
          ))}
        </svg>
      ) : null}

      <Gutter
        resolved={props.resolved}
        threads={props.threads}
        activeId={props.activeId}
        scrollY={scroll.y}
        onSelect={props.onSelectMarker}
      />

      {props.penning ? (
        <PenLayer
          origin={contentOrigin}
          zoom={props.zoom}
          onDone={props.onDrawn}
          onCancel={props.onPenCancel}
          onScrollBy={props.onScrollBy}
          onZoomBy={props.onZoomBy}
        />
      ) : null}

      {props.picking ? (
        <PickLayer
          scopes={props.pickScopes}
          active={props.pickActive}
          scrollX={scroll.x}
          scrollY={scroll.y}
          arming={props.arming}
          onProbe={props.onProbe}
          onActive={props.onPickActive}
          onCommit={props.onPickCommit}
          onCommitAt={props.onPickCommitAt}
          onRegion={props.onRegion}
          onCancel={props.onPickCancel}
          onScrollBy={props.onScrollBy}
          onZoomBy={props.onZoomBy}
        />
      ) : null}

      {/*
        Spec 08 §4.1 — one strip, three states, and only ever one at a time.
        The two bars above are the other two; this is the resting one.
      */}
      {props.doc && !props.picking && !props.penning ? (
        <ModeStrip
          canPick
          canDraw={props.doc.presentation.kind !== "url"}
          onTogglePick={props.onTogglePick}
          onTogglePen={props.onTogglePen}
        />
      ) : null}
    </main>
  );
}
