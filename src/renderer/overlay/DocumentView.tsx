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

import { useEffect, useRef, useState } from "react";
import type { OpenedDocument, ThreadWithMessages } from "../../shared/types.ts";
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
import { PickLayer } from "./PickLayer.tsx";
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
  /** Spec 05 §5.6.1 — what an Apply changed in this document, while it is pending. */
  changeBoxes: ScopeRect[];
  picking: boolean;
  pickScopes: PickScope[] | null;
  pickActive: number;
  arming: boolean;
  onSurfaceReady: (surface: DocumentSurface) => void;
  onSelectionChanged: () => void;
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
  '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>';

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

/** A box measured at one zoom, drawn at another. */
function rescale(rect: ScopeRect, by: number): ScopeRect {
  return by === 1 ? rect : { x: rect.x * by, y: rect.y * by, w: rect.w * by, h: rect.h * by };
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
  const blocks = props.resolved.flatMap((entry) =>
    entry.checked
      .filter((check) => check.box !== null)
      .map((check) => ({ entry, check, box: check.box as ScopeRect })),
  );

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
            box: rescale(item.rect, props.zoom / item.zoom),
          },
        ]
      : [],
  );

  return (
    <main className="rex-doc" ref={paneRef}>
      {doc === null ? (
        <div className="rex-empty">
          <h1>REX</h1>
          <p>Open a Markdown, HTML, PDF or DOCX document, or a folder, to start commenting.</p>
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
        </div>
      ))}

      {/*
        An anchor on a whole element or a region of one is an outline, not a
        fill: the Custom Highlight API paints ranges, so there is no range to
        paint here — and drawing it as an overlay box keeps the promise that
        REX never touches the document's own tree.
      */}
      {blocks.map(({ entry, check, box }) => (
        <div
          key={`${entry.threadId}-${check.position}`}
          className={`rex-block-outline${check.state === "moved" ? " rex-block-moved" : ""}${
            props.activeId === entry.threadId ? " rex-block-active" : ""
          }`}
          style={{
            left: box.x - scroll.x,
            top: box.y - scroll.y,
            width: box.w,
            height: box.h,
          }}
        />
      ))}

      <Gutter
        resolved={props.resolved}
        threads={props.threads}
        activeId={props.activeId}
        scrollY={scroll.y}
        onSelect={props.onSelectMarker}
      />

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
          onRegion={props.onRegion}
          onCancel={props.onPickCancel}
          onScrollBy={props.onScrollBy}
          onZoomBy={props.onZoomBy}
        />
      ) : null}
    </main>
  );
}
