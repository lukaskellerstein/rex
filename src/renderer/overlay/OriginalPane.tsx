// Spec 15 §6.1 and spec 16 §4.2 — the left-hand pane: the document as it is on
// disk.
//
// **Spec 15 §6.1 is reversed here.** It said this pane "hands up no surface, so
// no anchor is ever created or resolved against it", which was the right place
// to stop for one spec and the wrong place to leave it: a reviewer looking at a
// paragraph the change deleted had no way to say *"put that back"*. It gets a
// surface now, and takes a comment on anything — §4's table.
//
// What stays true is the other half. The original is not a second document
// under review: nothing typed against it ever edits it, the only thing that
// changes the file is approving the proposal, and **Add is the one gesture it
// never gets** (§6.4) — you cannot add to a version that is already fixed.
//
// `documentChanged` is always false here, and that is load-bearing rather than
// a shortcut. This pane shows `base` — the file exactly as it was when the
// working copy was forked — so nothing in it can have moved under an anchor
// written against it. Passing the document's own `contentChanged` would report
// every comment on unchanged text as `moved` the moment any working copy
// existed, which is the loudest possible wrong answer. `App.tsx` is where that
// is passed.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LineRange,
  OpenedDocument,
  PaperView,
  ThreadWithMessages,
} from "../../shared/types.ts";
import type { Stroke } from "../anchor/lasso.ts";
import type { PickScope, ScopeRect } from "../anchor/pick.ts";
import {
  boxesForLinesIn,
  type DocumentSurface,
  FrameSurface,
  type ResolvedThread,
} from "./anchoring.ts";
import { enrichDocument } from "./enrich.ts";
import {
  answerLinkClicks,
  applyPaperView,
  applyZoom,
  forwardKeysToParent,
  srcdocFor,
  zoomFromInside,
} from "./frame.ts";
import { LinkTip, type LinkTipView } from "./LinkTip.tsx";
import { ModeStrip } from "./ModeStrip.tsx";
import { mermaidPass } from "./mermaid.ts";
import { type DraftMark, PaneMarks } from "./PaneMarks.tsx";
import { PathBar } from "./PathBar.tsx";
import { PenLayer } from "./PenLayer.tsx";
import { PickLayer } from "./PickLayer.tsx";
import { addPaperFonts } from "./paperFonts.ts";

interface Props {
  doc: OpenedDocument;
  /** §6.2 — line ranges only the original has. */
  removed: LineRange[];
  zoom: number;
  /**
   * Spec 27 §4.6 — the paper, which both panes share.
   *
   * No strip here. One switch governs the pair, because two grounds in one
   * comparison is the exact fault the old "light only" comment warned about,
   * arriving from the inside.
   */
  paper: PaperView;
  /**
   * Spec 28 §5.6 — the find bar and the overview ruler, when this is the pane
   * being read (the pane control on `Original`). Null otherwise; the strip
   * never comes with them, because one strip governs both panes (spec 27 §4.6).
   */
  corner: React.ReactNode;
  ruler: React.ReactNode;
  /**
   * Handed the frame once it is drawn, so the right-hand pane can keep this one
   * level with it (§6.2). Called again with null when the document goes.
   */
  onFrameReady: (frame: HTMLIFrameElement | null) => void;
  /** Spec 16 §4.2 — and the surface, so this pane can be commented on. */
  onSurfaceReady: (surface: DocumentSurface | null) => void;
  onSelectionChanged: () => void;
  /**
   * Spec 53 §3 — a link followed here opens in the CURRENT pane.
   *
   * This pane shows one file's past. A second file has no past to show beside
   * it, so there is nothing for a left-hand pane of it to be.
   */
  onFollowLink: (href: string, line: number | null) => void;
  /** Spec 53 §4.7 — the same hover, in this pane. */
  onHoverLink: (link: { href: string; rect: ScopeRect } | null) => void;
  linkTip: LinkTipView | null;

  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  hoveredThreadId: string | null;
  marks: DraftMark[];
  hoveredItemId: string | null;
  onHoverItem: (id: string | null) => void;
  onRemoveItem: (id: string) => void;
  /** Spec 26 §4.5 — the number badge puts its place on the path bar. */
  onFocusItem: (id: string) => void;
  onSelectMarker: (threadId: string) => void;
  onHoverThread: (threadId: string | null) => void;

  /** The two modes, exactly as the right-hand pane offers them (§4). */
  picking: boolean;
  /** Spec 26 §2 — the chain on the bar, already filtered to this pane. */
  pathScopes: PickScope[] | null;
  pathActive: number;
  /** Spec 26 §4.1 — the focused place's number, or null under a hover. */
  pathNumber: number | null;
  onPathScope: (index: number) => void;
  onPathDone: () => void;
  arming: boolean;
  penning: boolean;
  onTogglePick: () => void;
  onTogglePen: () => void;
  onProbe: (x: number, y: number, cause: "move" | "scroll") => void;
  /** Spec 26 §4.4 — ⌥ with the wheel. Positive widens. */
  onWiden: (by: number) => void;
  onPickCommit: (index: number) => void;
  onPickCommitAt: (x: number, y: number) => void;
  onPickCancel: () => void;
  onRegion: (index: number, box: ScopeRect) => void;
  onDrawn: (strokes: Stroke[]) => void;
  onPenCancel: () => void;
  onScrollBy: (dx: number, dy: number) => void;
  onZoomBy: (factor: number) => void;
  onZoomReset: () => void;
}

/** A drag-resize fires continuously; answer once it stops. */
const RESIZE_SETTLE_MS = 200;

export function OriginalPane(props: Props): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [boxes, setBoxes] = useState<ScopeRect[]>([]);

  const { doc, zoom, removed, onFrameReady, onSurfaceReady, onSelectionChanged } = props;

  // The ranges as a string, so the effect below re-runs when they change and
  // not when a new array of the same numbers arrives from a re-render.
  const ranges = JSON.stringify(removed);

  const measure = useCallback((frame: HTMLIFrameElement, lines: LineRange[]): void => {
    const view = frame.contentWindow;
    const inner = frame.contentDocument;
    if (!view || !inner || lines.length === 0) {
      setBoxes([]);
      return;
    }
    setBoxes(boxesForLinesIn(view, inner, lines));
  }, []);

  /**
   * Read through refs for the same reason `DocumentView` does: these listeners
   * are attached once per document load, and re-running the load effect would
   * rewrite `srcdoc` and throw away where the reviewer had scrolled to.
   */
  const zoomRef = useRef(zoom);
  const zoomCommands = useRef({ by: props.onZoomBy, reset: props.onZoomReset });
  zoomRef.current = zoom;
  zoomCommands.current = { by: props.onZoomBy, reset: props.onZoomReset };
  /** Spec 27 §5.2 — read through a ref, so a switch never rewrites `srcdoc`. */
  const paperRef = useRef(props.paper);
  paperRef.current = props.paper;
  /** Spec 53 §5.2 — the same, for the link listeners. */
  const followRef = useRef(props.onFollowLink);
  followRef.current = props.onFollowLink;
  const hoverRef = useRef(props.onHoverLink);
  hoverRef.current = props.onHoverLink;
  /** Spec 26 §5.4 — the overlay holds ↑ ↓, so this frame must not scroll on them. */
  const wantsArrows = useRef(false);
  wantsArrows.current = (props.pathScopes?.length ?? 0) > 0;

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

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let live = true;
    const onLoad = async (): Promise<void> => {
      const view = frame.contentWindow;
      const inner = frame.contentDocument;
      if (!live || !view || !inner) return;

      // Built here and handed up below — see the note in `DocumentView`: the
      // link listener needs `scrollToFragment`, which owns REX's rule for
      // bringing a place into view.
      const surface = new FrameSurface(frame, doc.ref.value);

      const follow = (): void => setScroll({ x: view.scrollX, y: view.scrollY });
      follow();
      view.addEventListener("scroll", follow, { passive: true });
      inner.addEventListener("mouseup", onSelectionChanged);
      answerLinkClicks(inner, {
        fragment: (id) => surface.scrollToFragment(id),
        follow: (href, line) => followRef.current(href, line),
        hover: (link) => hoverRef.current(link),
      });
      zoomFromInside(inner, zoomCommands);
      forwardKeysToParent(inner, wantsArrows);

      await addPaperFonts(view).catch(() => undefined);
      if (!live) return;
      applyZoom(inner, zoomRef.current);
      // Spec 27 §4.6 — the same paper as the pane beside it, applied before the
      // enrichment so the diagrams are drawn once, in the theme they will keep.
      applyPaperView(inner, paperRef.current);
      await enrichDocument(inner, doc, paperRef.current.dark ? "dark" : "neutral");
      if (!live) return;

      measure(frame, JSON.parse(ranges) as LineRange[]);
      onFrameReady(frame);
      // Spec 16 §5.5 — `liveBlocks` stays null here: everything in the original
      // is live, because everything in it is something the change may have
      // taken away and the reviewer may want back.
      onSurfaceReady(surface);
    };

    const onLoadEvent = (): void => void onLoad();
    frame.addEventListener("load", onLoadEvent);
    frame.srcdoc = srcdocFor(doc);
    return () => {
      live = false;
      frame.removeEventListener("load", onLoadEvent);
      onFrameReady(null);
      onSurfaceReady(null);
    };
    // `zoom` is deliberately absent: re-running rewrites `srcdoc`, which reloads
    // the document and throws away where the reviewer had scrolled to. The
    // effect below applies every zoom after the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ranges, measure, onFrameReady, onSurfaceReady, onSelectionChanged]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    applyZoom(frame.contentDocument, zoom);
    measure(frame, JSON.parse(ranges) as LineRange[]);
  }, [zoom, ranges, measure]);

  /**
   * Spec 27 §4.6 — the paper changed, so this pane changes with it.
   *
   * The removed-block tints are geometry, exactly as they are under a zoom, so
   * a width change has to re-measure them. The sweep that re-resolves every
   * anchor is `DocumentView`'s to fire — it owns `onReflowed` and covers both
   * surfaces — and this effect is only about the boxes this pane draws itself.
   */
  const { paper } = props;
  const paperDrawn = useRef(false);
  useEffect(() => {
    const frame = frameRef.current;
    const inner = frame?.contentDocument ?? null;
    if (!frame || !inner) return;
    applyPaperView(inner, paper);
    if (!paperDrawn.current) {
      paperDrawn.current = true;
      return;
    }

    let live = true;
    void (async () => {
      await mermaidPass(inner, paper.dark ? "dark" : "neutral").catch((error: unknown) =>
        console.warn("[rex] the original's diagrams were not redrawn", error),
      );
      if (live) measure(frame, JSON.parse(ranges) as LineRange[]);
    })();
    return () => {
      live = false;
    };
  }, [paper, ranges, measure]);

  /**
   * A resize re-measures, because a removed-block tint is geometry.
   *
   * Spec 15 measured these boxes when the document loaded and on a zoom, and
   * nowhere else — so a pane that changed width afterwards kept drawing them at
   * the old one. The prose re-centres and the tint does not follow it.
   * Reported on 2026-08-26 with the window widened after the document was
   * opened: the red box sat in the left margin, 250px from the passage it was
   * supposed to be around, at the width the pane used to have.
   *
   * `DocumentView` has watched its own pane for exactly this since spec 05
   * §5.6.1; this is the same watch on the other half.
   */
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const frame = frameRef.current;
        if (frame) measure(frame, JSON.parse(ranges) as LineRange[]);
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(pane);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [ranges, measure]);

  return (
    <section className="rex-half rex-half-original">
      <header className="rex-half-head">
        <span className="rex-half-title">Original</span>
        <span className="rex-half-hint">on disk · comment on what the change removed</span>
      </header>
      <div className="rex-half-body" ref={paneRef}>
        <iframe
          ref={frameRef}
          className="rex-frame"
          title="The document as it is on disk"
          sandbox="allow-same-origin"
        />
        {props.corner ? <div className="rex-corner">{props.corner}</div> : null}
        {props.ruler}
        {boxes.map((box, at) => (
          <div
            // By position, for the same reason `changeBoxes` is — a hidden pane
            // measures every block at 0×0 and a geometry key stops being unique.
            key={`removed-${at}`}
            className="rex-removed-outline"
            style={{
              left: box.x - scroll.x,
              top: box.y - scroll.y,
              width: box.w,
              height: box.h,
            }}
          />
        ))}

        <PaneMarks
          resolved={props.resolved}
          threads={props.threads}
          activeId={props.activeId}
          hoveredThreadId={props.hoveredThreadId}
          marks={props.marks}
          hoveredItemId={props.hoveredItemId}
          scrollX={scroll.x}
          scrollY={scroll.y}
          onHoverItem={props.onHoverItem}
          onRemoveItem={props.onRemoveItem}
          onFocusItem={props.onFocusItem}
          onSelectMarker={props.onSelectMarker}
          onHoverThread={props.onHoverThread}
        />

        <LinkTip
          tip={props.linkTip}
          scrollX={scroll.x}
          scrollY={scroll.y}
          paneHeight={paneRef.current?.clientHeight ?? 0}
        />

        {props.penning ? (
          <PenLayer
            origin={contentOrigin}
            zoom={zoom}
            onDone={props.onDrawn}
            onCancel={props.onPenCancel}
            onScrollBy={props.onScrollBy}
            onZoomBy={props.onZoomBy}
          />
        ) : null}

        {props.picking ? (
          <PickLayer
            scopes={props.pathScopes}
            active={props.pathActive}
            scrollX={scroll.x}
            scrollY={scroll.y}
            arming={props.arming}
            onProbe={props.onProbe}
            onWiden={props.onWiden}
            onCommit={props.onPickCommit}
            onCommitAt={props.onPickCommitAt}
            onRegion={props.onRegion}
            onCancel={props.onPickCancel}
            onScrollBy={props.onScrollBy}
            onZoomBy={props.onZoomBy}
          />
        ) : null}

        {/*
          §4 — the same two modes as the right-hand pane, and §6.4 — Add is the
          one gesture the original never gets: you cannot add to a version that
          is already fixed.

          Spec 26 §4.7 — a place taken from THIS pane widens in this pane, so
          the path bar is drawn here too. `pathScopes` arrives already filtered
          to the original, so its presence is the whole test.
        */}
        {props.pathScopes && props.pathScopes.length > 0 && !props.penning ? (
          <PathBar
            scopes={props.pathScopes}
            active={props.pathActive}
            number={props.pathNumber}
            onScope={props.onPathScope}
            onDone={props.onPathDone}
          />
        ) : !props.picking && !props.penning ? (
          <ModeStrip
            canPick
            canAdd={false}
            narrow={false}
            onTogglePick={props.onTogglePick}
            onTogglePen={props.onTogglePen}
            onToggleAdd={() => undefined}
          />
        ) : null}
      </div>
    </section>
  );
}
