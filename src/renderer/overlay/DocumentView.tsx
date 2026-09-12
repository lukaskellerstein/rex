// The document under review, plus the margin REX draws beside it.
//
// Every document renders into an iframe that is `sandbox="allow-same-origin"`
// and nothing else: same-origin so the resolver can reach the DOM for
// anchoring (§6.3 rule 3), and without `allow-scripts` so a local file's
// scripts cannot run (§5.4 step 2).
//
// Spec 15 §6.1 — the pane is a row of up to two halves: the original on the
// left when there is a change to read against, and the version that will exist
// on the right.
//
// **Spec 16 §4 decides what a gesture means in each.** The left pane takes a
// comment on anything; the right takes one only on a block the change added or
// altered, because everything the change left alone is the document and the
// document is the left pane. Two ways to say one thing is the ambiguity that
// made a comment read "anchor lost" the moment an ACT run deleted its
// paragraph, and the narrow rule removes it at the source.
//
// The 32px rail of numbered discs that used to sit beside the frame is gone
// (spec 15 §8.5). Its column is what the second half is drawn in, and the marks
// it carried are now bars in the margin — `MarginBars.tsx`.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentVersion,
  LineRange,
  OpenedDocument,
  PaneMode,
  PaperView,
  ThreadWithMessages,
  WorkingCopyView,
} from "../../shared/types.ts";
import type { Stroke } from "../anchor/lasso.ts";
import { type PickScope, rescaleRect, type ScopeRect } from "../anchor/pick.ts";
import {
  type DocumentSurface,
  FrameSurface,
  type GapSpot,
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
import { GapLayer } from "./GapLayer.tsx";
import { LinkTip, type LinkTipView } from "./LinkTip.tsx";
import { ModeStrip } from "./ModeStrip.tsx";
import { mermaidPass } from "./mermaid.ts";
import { OriginalPane } from "./OriginalPane.tsx";
import { type DraftMark, PaneMarks } from "./PaneMarks.tsx";
import { PaperStrip } from "./PaperStrip.tsx";
import { PathBar } from "./PathBar.tsx";
import { PenLayer } from "./PenLayer.tsx";
import { PickLayer } from "./PickLayer.tsx";
import { addPaperFonts } from "./paperFonts.ts";
import { attachFigurePreview, type PreviewFigure } from "./preview.ts";
import type { SelectionItem } from "./selection.ts";
import { syncPanes } from "./syncPanes.ts";

interface Props {
  doc: OpenedDocument | null;
  /**
   * Spec 15 §6.1 — the left-hand pane, when the reviewer is comparing.
   *
   * Null whenever there is nothing to compare against: no working copy, or the
   * pane control is on `New`. `doc` is then the only document on screen, exactly
   * as it was before spec 15.
   */
  original: OpenedDocument | null;
  /** §6.2 — line ranges only the original has, tinted in that pane. */
  removedLines: LineRange[];
  /** §6.3 — the patch, which is what keeps the two panes level. */
  patch: string;
  /**
   * Spec 15 §7.1 — the head of the new-version pane, and the three answers.
   *
   * One object rather than five props: they are one thing, they arrive and go
   * together, and null is the ordinary state of a document nobody has changed.
   */
  workingBar: {
    view: WorkingCopyView;
    /** How many OTHER documents are waiting, for `Approve all`. */
    others: number;
    onApprove: () => void;
    /** §7.1 — every waiting document, in turn. Only offered when there is one. */
    onApproveAll: () => void;
    onUndo: () => void;
    onDiscard: () => void;
  } | null;
  paneMode: PaneMode;
  onPaneMode: (mode: PaneMode) => void;
  /** Spec 16 §5.2 — what the NEW-version sweep found. */
  resolved: ResolvedThread[];
  /** §5.2 — and what the original's sweep found, for its own lane. */
  originalResolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  /** Spec 05 §3 — the panel's items. Only this document's are drawn. */
  selection: SelectionItem[];
  /**
   * Spec 24 §3.3 — the places picked for the open comment and not yet sent.
   * Empty unless a card is on screen. Drawn exactly as the panel's items are,
   * numbered on from `pendingFrom` so the outline says what the strip says.
   */
  pending: SelectionItem[];
  /** How many places the open comment already has — the first pending one is `pendingFrom + 1`. */
  pendingFrom: number;
  /** The item the reviewer is pointing at, in the panel or here (§6). */
  hoveredItemId: string | null;
  onHoverItem: (id: string | null) => void;
  /** Drop one place from the selection, from its own outline rather than the panel. */
  onRemoveItem: (id: string) => void;
  /** Spec 26 §4.5 — the number badge puts its place on the path bar. */
  onFocusItem: (id: string) => void;
  /** Spec 05 §5.6.1 — what an Apply changed in this document, while it is pending. */
  changeBoxes: ScopeRect[];
  picking: boolean;
  /**
   * Spec 26 §2 — the chain REX is outlining: the hover while pick mode is on,
   * the focused place otherwise. One chain, so the outline, the crumbs and the
   * chips can never say three different things.
   */
  pathScopes: PickScope[] | null;
  pathActive: number;
  /** Spec 16 §4 — which pane the chain above belongs to. */
  pathPane: DocumentVersion;
  /** Spec 26 §4.1 — the focused place's number, or null under a hover. */
  pathNumber: number | null;
  /** A crumb. Re-anchors the place, or moves the pick — App decides which. */
  onPathScope: (index: number) => void;
  /** `esc` and the bar's own `done`. */
  onPathDone: () => void;
  arming: boolean;
  /** Spec 06 §5.1 — the pen layer, mounted only while the mode is on. */
  penning: boolean;
  hoveredThreadId: string | null;
  /** Spec 15 §8.4 — pointing at a bar lights its passage, and its row. */
  onHoverThread: (threadId: string | null) => void;
  /** Spec 08 §7.2 — which of the open comment's places is being pointed at. */
  hoveredPlace: number | null;
  /** Spec 08 §4 — both modes are turned on from the foot of the paper now. */
  onTogglePick: () => void;
  onTogglePen: () => void;
  onDrawn: (pane: DocumentVersion, strokes: Stroke[]) => void;
  onPenCancel: () => void;
  onSurfaceReady: (pane: DocumentVersion, surface: DocumentSurface | null) => void;
  onSelectionChanged: (pane: DocumentVersion) => void;
  /**
   * Spec 53 §5.2 — a link that is not a place in this document.
   *
   * `line` is the source line the link sits on, which is what Back comes home
   * to. The pane does not decide what the link means: resolving it reads the
   * filesystem, which is main's (invariant I2).
   */
  onFollowLink: (pane: DocumentVersion, href: string, line: number | null) => void;
  /**
   * Spec 53 §4.7 — the pointer came to rest on a link, or left one.
   *
   * Reported rather than answered here: saying where a link goes means asking
   * main, and the answer is worth caching for the life of the document.
   */
  onHoverLink: (pane: DocumentVersion, link: { href: string; rect: ScopeRect } | null) => void;
  /** What to draw, once `App` has an answer. Null while there is nothing to say. */
  linkTip: { pane: DocumentVersion; view: LinkTipView } | null;
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
  onProbe: (pane: DocumentVersion, x: number, y: number, cause: "move" | "scroll") => void;
  onPickCommit: (index: number) => void;
  /** Spec 26 §4.4 — ⌥ with the wheel. Positive widens. */
  onWiden: (by: number) => void;
  /** A click in pick mode, at the point it landed on. */
  onPickCommitAt: (pane: DocumentVersion, x: number, y: number) => void;
  onPickCancel: () => void;
  onRegion: (index: number, box: ScopeRect) => void;
  onScrollBy: (pane: DocumentVersion, dx: number, dy: number) => void;
  /**
   * Spec 16 §6.6 — whether Add is armed.
   *
   * Off by default and held on with ⇧, exactly as pick is held on with ⌥. The
   * rule and the pill are an offer, and an offer nobody asked for is furniture
   * across the prose of a document somebody is only reading.
   */
  adding: boolean;
  onToggleAdd: () => void;
  /** §6.6 — every gap the affordance can appear in. */
  gaps: GapSpot[];
  /** §6.1 — which gap is offered under the pointer now, so `A` can take it. */
  onGapOffer: (index: number | null) => void;
  onGapPick: (index: number) => void;
  /** The document's own zoom. 1 is 100%. */
  zoom: number;
  onZoomBy: (factor: number) => void;
  onZoomReset: () => void;
  /**
   * Called once the page has been redrawn at a new size, so the resolver can
   * re-measure. Fired by the zoom, by the width switch and by a Mermaid redraw
   * — every box the overlay holds was measured against the layout before it.
   */
  onReflowed: () => void;
  /** Spec 27 §4 — how the paper is drawn. Both panes read this one value (§4.6). */
  paper: PaperView;
  /** §4.2 — whether this document is one REX typeset, and may therefore be switched. */
  paperable: boolean;
  onPaperWide: () => void;
  onPaperDark: () => void;
  /**
   * Spec 28 §4.1 — the pane being read, which is where the find acts. The
   * original when the pane control is on `Original`; this pane otherwise.
   */
  findPane: DocumentVersion;
  /** §5.6 — the find bar, or null while it is closed. Drawn in `findPane`'s corner. */
  corner: React.ReactNode;
  /** §4.1.1 — the overview ruler, or null while there is nothing to mark. */
  ruler: React.ReactNode;
}

/** A drag-resize fires continuously; answer once it stops. */
const RESIZE_SETTLE_MS = 200;

const PANES: Array<{ mode: PaneMode; label: string }> = [
  { mode: "original", label: "Original" },
  { mode: "both", label: "Both" },
  { mode: "new", label: "New" },
];

/**
 * Spec 15 §7.1 and §7.4 — the head of the new-version pane.
 *
 * A notice and not a gate. Nothing is waiting on it: the reviewer's file
 * already holds what it held before the run, and it keeps holding it until
 * Approve is pressed. So it carries the counts, the three answers, and the
 * conflict when there is one — and it can be ignored for as long as they like.
 *
 * **It spans both panes rather than sitting in the new version's head**, and
 * that is a fix rather than a preference. `Original` hides the new-version half
 * — and the half was where the `Original / Both / New` control lived, so
 * choosing `Original` took away the only way back to `Both`, along with
 * Approve, Undo last and Discard. Reported on 2026-08-26. A control that
 * governs both panes cannot live inside one of them.
 */
function WorkingHead(props: {
  bar: NonNullable<Props["workingBar"]>;
  mode: PaneMode;
  onMode: (mode: PaneMode) => void;
}): React.JSX.Element {
  const { view } = props.bar;
  return (
    <header className="rex-workbar">
      <span className="rex-half-title">Change</span>
      <span className="rex-half-count">
        <span className="rex-added">+{view.addedLines}</span>{" "}
        <span className="rex-removed">−{view.removedLines}</span>
      </span>
      <span className="rex-half-hint">
        {view.revisions === 1 ? "1 change" : `${view.revisions} changes`}
      </span>

      <span className="rex-half-modes">
        {PANES.map((pane) => (
          <button
            key={pane.mode}
            type="button"
            className={`rex-half-mode${props.mode === pane.mode ? " rex-half-mode-on" : ""}`}
            onClick={() => props.onMode(pane.mode)}
          >
            {pane.label}
          </button>
        ))}
      </span>

      {/*
        Spec 34 §5.3 — while a run is pointed at this document the three
        answers are greyed, with main's own reason as their title. Main refuses
        anyway; this is the affordance, not the guard.
      */}
      <span className="rex-half-actions">
        <button
          type="button"
          className="rex-approve"
          onClick={props.bar.onApprove}
          disabled={view.held !== null}
          title={view.held ?? undefined}
        >
          Approve
        </button>
        {/*
          §7.1 — two gestures, not one button that means different things
          depending on how many documents happen to be waiting. It appears only
          when there is a second one, and it names how many it will write.
        */}
        {props.bar.others > 0 ? (
          <button type="button" className="rex-half-button" onClick={props.bar.onApproveAll}>
            Approve all ({props.bar.others + 1})
          </button>
        ) : null}
        <button
          type="button"
          className="rex-half-button"
          onClick={props.bar.onUndo}
          disabled={view.held !== null}
          title={view.held ?? undefined}
        >
          Undo last
        </button>
        <button
          type="button"
          className="rex-half-button"
          onClick={props.bar.onDiscard}
          disabled={view.held !== null}
          title={view.held ?? undefined}
        >
          Discard
        </button>
      </span>

      {/* §7.3 — REX does not merge, so it says so before Approve is pressed. */}
      {view.conflict ? <p className="rex-half-conflict">{view.conflict}</p> : null}
    </header>
  );
}

export function DocumentView(props: Props): React.JSX.Element {
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLIFrameElement>(null);
  /**
   * Spec 15 §6.1 — the box every overlay mark is measured against.
   *
   * It is the half's BODY, not the half itself, and that distinction is
   * load-bearing now that a head can sit above the frame: every mark is drawn at
   * `box.y - scroll.y`, which is a frame coordinate, so a root that included the
   * head would draw every outline, bar and badge exactly the head's height too
   * high. Measured on 2026-08-26 — the changed-block outline landed on the
   * paragraph above the one it belonged to.
   */
  const paneRef = useRef<HTMLDivElement>(null);
  /**
   * Spec 16 §6.6 — where the pointer is inside the document frame.
   *
   * Tracked here because an event inside an iframe never reaches the parent, so
   * `GapLayer` cannot see the pointer until it is already under the band it
   * drew.
   *
   * **It is cleared when the pointer leaves the PANE, never when it leaves the
   * frame**, and that distinction is the whole of a flicker this had at first.
   * The band is drawn *over* the frame, so the moment it appears the pointer is
   * on the band and no longer on the iframe — which fires the frame's own
   * `mouseleave`. Clearing on that took the band away, which put the pointer
   * back on the frame, which drew the band again: the `+ Add` rule blinked on
   * and off several times a second under a stationary mouse. Measured on
   * 2026-08-26. The pane encloses both the frame and the band, so leaving it is
   * the one event that really means "gone".
   */
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const { doc, onSurfaceReady, onSelectionChanged, onDrawn, onProbe, onPickCommitAt, onScrollBy } =
    props;

  /**
   * Spec 16 §4 — the pane-bound callbacks, each with ONE identity for the life
   * of the app.
   *
   * Written out rather than inlined in the JSX, and the reason is a bug this
   * file has hit twice now. `OriginalPane`'s load effect depends on
   * `onSurfaceReady` and `onSelectionChanged`, and `PenLayer`'s and
   * `PickLayer`'s depend on theirs. An arrow function written in the JSX is a
   * new value on every render, so the effect tears down and re-runs on every
   * render — and `onSurfaceReady(null)` on the way out sweeps, which renders,
   * which re-runs it. Measured on 2026-08-26: `Maximum update depth exceeded`,
   * thirty-three times, the first time the second pane was opened.
   */
  /**
   * Spec 53 §5.2 — read through a ref for the reason the block above gives: the
   * link listener is attached once per frame load, and this callback is rebuilt
   * on every render of the shell.
   */
  const followRef = useRef(props.onFollowLink);
  followRef.current = props.onFollowLink;
  const hoverRef = useRef(props.onHoverLink);
  hoverRef.current = props.onHoverLink;

  const originalSurfaceReady = useCallback(
    (surface: DocumentSurface | null) => onSurfaceReady("original", surface),
    [onSurfaceReady],
  );
  const originalSelectionChanged = useCallback(
    () => onSelectionChanged("original"),
    [onSelectionChanged],
  );
  const originalFollowLink = useCallback(
    (href: string, line: number | null) => followRef.current("original", href, line),
    [],
  );
  const originalHoverLink = useCallback(
    (link: { href: string; rect: ScopeRect } | null) => hoverRef.current("original", link),
    [],
  );
  const originalDrawn = useCallback((strokes: Stroke[]) => onDrawn("original", strokes), [onDrawn]);
  const originalProbe = useCallback(
    (x: number, y: number, cause: "move" | "scroll") => onProbe("original", x, y, cause),
    [onProbe],
  );
  const originalCommitAt = useCallback(
    (x: number, y: number) => onPickCommitAt("original", x, y),
    [onPickCommitAt],
  );
  const originalScrollBy = useCallback(
    (dx: number, dy: number) => onScrollBy("original", dx, dy),
    [onScrollBy],
  );

  const currentDrawn = useCallback((strokes: Stroke[]) => onDrawn("current", strokes), [onDrawn]);
  const currentProbe = useCallback(
    (x: number, y: number, cause: "move" | "scroll") => onProbe("current", x, y, cause),
    [onProbe],
  );
  const currentCommitAt = useCallback(
    (x: number, y: number) => onPickCommitAt("current", x, y),
    [onPickCommitAt],
  );
  const currentScrollBy = useCallback(
    (dx: number, dy: number) => onScrollBy("current", dx, dy),
    [onScrollBy],
  );

  /**
   * §6.6 — a point the band reported, in the overlay's coordinates, put back
   * into the frame's.
   *
   * The frame fills the pane body, so the pane's own box is the offset. This is
   * what keeps the pointer live while the band is covering the frame.
   */
  const pointerFromOverlay = useCallback((at: { x: number; y: number }): void => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    setPointer({ x: at.x - box.left, y: at.y - box.top });
  }, []);

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
  /**
   * Spec 27 §5.2 — read through a ref for exactly the reason above: the load
   * effect must apply the current paper, and must not re-run when the reviewer
   * changes it. The effect below is what applies every change after the load.
   */
  const paperRef = useRef(props.paper);
  paperRef.current = props.paper;
  /**
   * Spec 26 §5.4 — the overlay is holding the arrow keys, so the frame must not
   * scroll on them as well. A ref for the same reason as the zoom commands: the
   * load effect must not re-run when this changes, because re-running it
   * rewrites `srcdoc`.
   */
  const wantsArrows = useRef(false);
  wantsArrows.current = (props.pathScopes?.length ?? 0) > 0;

  /** Read through a ref for the same reason, and it matters more here: a
      re-run of the load effect would rewrite `srcdoc` mid-review. */
  const previewRef = useRef(props.onPreview);
  previewRef.current = props.onPreview;

  // ── Fill the iframe, enrich it, then hand up a surface ──

  useEffect(() => {
    const frame = frameRef.current;
    if (!doc || !frame) return;

    const srcdoc = srcdocFor(doc);

    let live = true;
    const onLoad = async (): Promise<void> => {
      if (!live) return;
      const view = frame.contentWindow;
      const inner = frame.contentDocument;
      if (!view || !inner) return;

      // Built here rather than at the handover below, because the link listener
      // needs it: `scrollToFragment` is the one place that knows REX's rule for
      // bringing a place into view, and a second copy of that rule inside this
      // effect is a second convention waiting to drift.
      const surface = new FrameSurface(frame, doc.ref.value);

      const follow = (): void => setScroll({ x: view.scrollX, y: view.scrollY });
      follow();
      view.addEventListener("scroll", follow, { passive: true });
      inner.addEventListener("mouseup", () => onSelectionChanged("current"));
      // Spec 16 §6.6 — the pointer, for the `+ Add` affordance. `mouseleave` on
      // the frame's own document is what puts it away again.
      inner.addEventListener(
        "mousemove",
        (event: MouseEvent) => setPointer({ x: event.clientX, y: event.clientY }),
        { passive: true },
      );
      answerLinkClicks(inner, {
        fragment: (id) => surface.scrollToFragment(id),
        follow: (href, line) => followRef.current("current", href, line),
        hover: (link) => hoverRef.current("current", link),
      });
      zoomFromInside(inner, zoomCommands);
      forwardKeysToParent(inner, wantsArrows);

      // Before the zoom, and long before the surface: a face that lands after
      // the page has been measured reflows every line under it.
      await addPaperFonts(view).catch((error: unknown) =>
        console.warn("[rex] the paper's DM Sans faces did not load", error),
      );
      if (!live) return;

      // Before the surface is handed up, so the text index and every rect the
      // resolver takes are measured at the size the reader is actually seeing.
      applyZoom(inner, zoomRef.current);
      // Spec 27 §5.4 — and at the WIDTH they are seeing. Before the enrichment
      // for the same reason as the zoom: a page that drew its diagrams at
      // 620px and then went wide would have measured every one of them against
      // a layout it is about to leave.
      applyPaperView(inner, paperRef.current);

      // Spec 03 §4.3 — the DOM must be final before the surface is handed up,
      // because `onSurfaceReady` is what makes the resolver build its text
      // index. An anchor created against a half-drawn document records offsets
      // into text that is about to move: it resolves, it reports `ok`, and it
      // points at the wrong place.
      await enrichDocument(inner, doc, paperRef.current.dark ? "dark" : "neutral");
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
      // The HTML review documents this was measured on theme themselves with exactly that media
      // query and no script — the sandbox runs none (spec 01 §5.4 step 2), so
      // the media query is the only theme they have. Worse, the value stuck to
      // the element across loads: open a Markdown file, then one of those, and
      // the second inherited the first's `light` and rendered light on a
      // dark-mode machine.
      //
      // Left alone, the frame inherits the reader's own preference, the
      // document's media query decides, and REX renders rather than restyles.

      onSurfaceReady("current", surface);
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
      onSurfaceReady("current", null);
    };
  }, [doc, onSurfaceReady, onSelectionChanged]);

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
  const { zoom, onReflowed } = props;
  useEffect(() => {
    applyZoom(frameRef.current?.contentDocument ?? null, zoom);
    // Every box the overlay draws was measured at the old size, so the
    // resolver has to run again before any of them is believable.
    onReflowed();
  }, [zoom, onReflowed]);

  // ── The paper (spec 27 §5.2, §5.4) ──────────────────────────
  //
  // Applied here rather than in the load effect for the same reason the zoom
  // is: that effect rewrites `srcdoc`, and re-running it would reload the
  // document under review every time the reviewer pressed `W`.
  const { paper } = props;
  /**
   * The load effect has already applied the paper and drawn the diagrams in
   * its theme, so the FIRST run of this one has nothing to do — and doing it
   * anyway would re-render every diagram in the document on open, for nothing.
   */
  const paperDrawn = useRef(false);
  useEffect(() => {
    const inner = frameRef.current?.contentDocument ?? null;
    if (!inner) return;
    applyPaperView(inner, paper);
    if (!paperDrawn.current) {
      paperDrawn.current = true;
      return;
    }

    let live = true;
    void (async () => {
      // Spec 27 §4.5 — a Mermaid diagram is REX's own drawing, so it is drawn
      // again to match the paper. `mermaidPass` returns at once when the
      // document holds none, which is what makes this cheap enough to run on
      // every switch rather than only on the dark one.
      await mermaidPass(inner, paper.dark ? "dark" : "neutral").catch((error: unknown) =>
        console.warn("[rex] the diagrams were not redrawn for the new paper", error),
      );
      // Spec 03 §4.3, arriving on the second render instead of the first: the
      // DOM has to be final before anything is measured against it. A width
      // change reflows every line, and a redrawn diagram can change height.
      if (live) onReflowed();
    })();
    return () => {
      live = false;
    };
  }, [paper, onReflowed]);

  /**
   * Spec 15 §6.2 — the two panes, kept level.
   *
   * The left pane hands its frame up when it has drawn, because that is the
   * first moment there is anything to align against; `null` on the way out
   * takes the listeners with it.
   */
  const [originalFrame, setOriginalFrame] = useState<HTMLIFrameElement | null>(null);
  const { patch } = props;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !originalFrame) return;
    return syncPanes(frame, originalFrame, patch);
  }, [originalFrame, patch]);

  // Spec 05 §6 — the selection's own places, drawn only for this document, and
  // spec 16 §4 — in the pane they were taken from. A place picked in the
  // original resolves at the original's coordinates, and drawing it here would
  // put a numbered box over whatever now sits at that height in the new version.
  const marksFor = (items: SelectionItem[], pane: DocumentVersion, from: number): DraftMark[] =>
    items.flatMap((item, position) =>
      // A row from another document keeps its number without a box, and so does
      // one whose anchor stopped resolving here — see `SelectionItem.rect`.
      item.documentId === props.doc?.documentId && item.pane === pane && item.rect
        ? [
            {
              id: item.id,
              number: from + position + 1,
              // Rescaled from the zoom it was measured at: a selection outlives a
              // zoom change, and reading a table closely before deciding whether
              // the fourth row belongs is exactly when someone zooms.
              box: rescaleRect(item.rect, props.zoom / item.zoom),
              // A passage is outlined by its lines, so the shape follows the
              // words. A place that is a box has none, and keeps its box.
              lines: item.lines?.map((line) => rescaleRect(line, props.zoom / item.zoom)) ?? null,
            },
          ]
        : [],
    );

  // Spec 24 §3.3 — the two lists are never both non-empty on screen: a
  // selection lands in the card while a card is shown and in the panel
  // otherwise. Drawing both is what keeps that true rather than assumed.
  const marksIn = (pane: DocumentVersion): DraftMark[] => [
    ...marksFor(props.selection, pane, 0),
    ...marksFor(props.pending, pane, props.pendingFrom),
  ];

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

  return (
    <main className="rex-doc">
      {doc === null ? (
        <div className="rex-empty">
          <h1>REX</h1>
          <p>
            Open a Markdown, HTML, PDF, DOCX or PPTX document, or a folder, to start commenting.
          </p>
        </div>
      ) : null}

      {/*
        Spec 15 §7.1 and spec 16 — the change's own bar, ABOVE both panes.

        Every control here governs the pair: which of the two is on screen, and
        what becomes of the proposal. Inside one pane they were unreachable the
        moment that pane was the one hidden.
      */}
      {props.workingBar ? (
        <WorkingHead bar={props.workingBar} mode={props.paneMode} onMode={props.onPaneMode} />
      ) : null}

      <div className="rex-doc-panes">
        {/*
        Spec 15 §6.1 — the original, read-only in the sense that nothing typed
        against it edits it. Spec 16 §4.2 — it takes a comment on anything,
        because everything the change left alone is the document and this is the
        document.
      */}
        {props.original ? (
          <OriginalPane
            doc={props.original}
            removed={props.removedLines}
            zoom={props.zoom}
            paper={props.paper}
            // Spec 28 §4.1 — the find follows the pane being read.
            corner={props.findPane === "original" ? props.corner : null}
            ruler={props.findPane === "original" ? props.ruler : null}
            onFrameReady={setOriginalFrame}
            onSurfaceReady={originalSurfaceReady}
            onSelectionChanged={originalSelectionChanged}
            onFollowLink={originalFollowLink}
            onHoverLink={originalHoverLink}
            linkTip={props.linkTip?.pane === "original" ? props.linkTip.view : null}
            resolved={props.originalResolved}
            threads={props.threads}
            activeId={props.activeId}
            hoveredThreadId={props.hoveredThreadId}
            marks={marksIn("original")}
            hoveredItemId={props.hoveredItemId}
            onHoverItem={props.onHoverItem}
            onRemoveItem={props.onRemoveItem}
            onFocusItem={props.onFocusItem}
            onSelectMarker={props.onSelectMarker}
            onHoverThread={props.onHoverThread}
            picking={props.picking}
            pathScopes={props.pathPane === "original" ? props.pathScopes : null}
            pathActive={props.pathActive}
            pathNumber={props.pathNumber}
            onPathScope={props.onPathScope}
            onPathDone={props.onPathDone}
            arming={props.arming}
            penning={props.penning}
            onTogglePick={props.onTogglePick}
            onTogglePen={props.onTogglePen}
            onProbe={originalProbe}
            onWiden={props.onWiden}
            onPickCommit={props.onPickCommit}
            onPickCommitAt={originalCommitAt}
            onPickCancel={props.onPickCancel}
            onRegion={props.onRegion}
            onDrawn={originalDrawn}
            onPenCancel={props.onPenCancel}
            onScrollBy={originalScrollBy}
            onZoomBy={props.onZoomBy}
            onZoomReset={props.onZoomReset}
          />
        ) : null}

        <section
          className={`rex-half rex-half-current${props.original ? " rex-half-split" : ""}${
            props.paneMode === "original" && props.original ? " rex-half-hidden" : ""
          }`}
        >
          {/*
            Identity only. Everything that acts on the change is in the bar
            above both panes — see `WorkingHead`.
          */}
          {props.workingBar ? (
            <header className="rex-half-head">
              <span className="rex-half-title">New version</span>
              <span className="rex-half-hint">comment on what it changed</span>
            </header>
          ) : null}

          {/*
          §6.6 — the pane, not the frame, is what the pointer has to leave for
          the `+ Add` affordance to go away. See the note on `pointer`.
        */}
          <div className="rex-half-body" ref={paneRef} onMouseLeave={() => setPointer(null)}>
            <iframe
              ref={frameRef}
              className="rex-frame"
              title="Document under review"
              sandbox="allow-same-origin"
            />

            {/*
              Spec 27 §4.1 — the paper's own switches, at the head of the pane.

              Drawn on this pane only, even while two are on screen: one strip
              governs both (§4.6), and a second copy in the original's head
              would be a control that appears to be about the pane it sits in.
            */}
            {/*
              Spec 28 §5.6 — the same corner, as a right-aligned row: the
              strip's right edge stays where spec 27 put it, and the find bar
              grows leftwards from it while it is open.
            */}
            {props.paperable || (props.findPane === "current" && props.corner) ? (
              <div className="rex-corner">
                {props.findPane === "current" ? props.corner : null}
                {props.paperable ? (
                  <PaperStrip
                    view={props.paper}
                    onWide={props.onPaperWide}
                    onDark={props.onPaperDark}
                  />
                ) : null}
              </div>
            ) : null}
            {props.findPane === "current" ? props.ruler : null}

            {/*
        Spec 05 §5.6.1 — what an Apply just changed, in the write colour, while
        the reviewer decides. Drawn first so a selection outline over the same
        block still reads on top of it. Spec 16 §4.1 — these are also exactly
        the blocks this pane will answer a gesture on, so the outline is the
        affordance and no new furniture is needed.
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

            <PaneMarks
              resolved={props.resolved}
              threads={props.threads}
              activeId={props.activeId}
              hoveredThreadId={props.hoveredThreadId}
              marks={marksIn("current")}
              hoveredItemId={props.hoveredItemId}
              scrollX={scroll.x}
              scrollY={scroll.y}
              onHoverItem={props.onHoverItem}
              onRemoveItem={props.onRemoveItem}
              onFocusItem={props.onFocusItem}
              onSelectMarker={props.onSelectMarker}
              onHoverThread={props.onHoverThread}
            />

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
        Spec 16 §6 — Add. Mounted on the same terms as `ModeStrip`: only when
        neither pick nor pen is on, because both of those capture the pointer
        for their own purposes and a third layer competing for a hover would
        make all three unreliable.
      */}
            {props.doc && props.adding && !props.picking && !props.penning ? (
              <GapLayer
                gaps={props.gaps}
                scrollX={scroll.x}
                scrollY={scroll.y}
                pointer={pointer}
                onPointerInOverlay={pointerFromOverlay}
                onOffer={props.onGapOffer}
                onPick={props.onGapPick}
              />
            ) : null}

            {props.penning ? (
              <PenLayer
                origin={contentOrigin}
                zoom={props.zoom}
                onDone={currentDrawn}
                onCancel={props.onPenCancel}
                onScrollBy={currentScrollBy}
                onZoomBy={props.onZoomBy}
              />
            ) : null}

            {/*
              §4.7 — over every other layer, and under none of them. It answers
              a question the reviewer asked with the pointer, so it has to be
              the thing they can see.
            */}
            <LinkTip
              tip={props.linkTip?.pane === "current" ? props.linkTip.view : null}
              scrollX={scroll.x}
              scrollY={scroll.y}
              paneHeight={paneRef.current?.clientHeight ?? 0}
            />

            {props.picking ? (
              <PickLayer
                scopes={props.pathPane === "current" ? props.pathScopes : null}
                active={props.pathActive}
                scrollX={scroll.x}
                scrollY={scroll.y}
                arming={props.arming}
                onProbe={currentProbe}
                onWiden={props.onWiden}
                onCommit={props.onPickCommit}
                onCommitAt={currentCommitAt}
                onRegion={props.onRegion}
                onCancel={props.onPickCancel}
                onScrollBy={currentScrollBy}
                onZoomBy={props.onZoomBy}
              />
            ) : null}

            {/*
        Spec 08 §4.1, widened by spec 26 §4.7 — one strip, four states, and only
        ever one at a time. The path bar is now two of them: it is drawn while
        pick mode is on, AND while a place is focused with the mode off. Its own
        `number` prop tells the two apart.

        The pen bar is drawn by `PenLayer`; this file mounts the other two.
      */}
            {props.doc &&
            props.pathPane === "current" &&
            props.pathScopes &&
            props.pathScopes.length > 0 &&
            !props.penning ? (
              <PathBar
                scopes={props.pathScopes}
                active={props.pathActive}
                number={props.pathNumber}
                onScope={props.onPathScope}
                onDone={props.onPathDone}
              />
            ) : props.doc && !props.picking && !props.penning ? (
              <ModeStrip
                canPick
                // Spec 16 §6.4 — the gap list is the test, not the file's
                // extension. A format that stamps no `data-src-line` has no
                // gaps, so the button that would do nothing is not drawn.
                canAdd={props.gaps.length > 0}
                narrow={props.workingBar !== null}
                onTogglePick={props.onTogglePick}
                onTogglePen={props.onTogglePen}
                onToggleAdd={props.onToggleAdd}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
