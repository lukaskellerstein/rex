// The glue between the anchor resolver (§6) and the overlay (§7).
//
// One surface, one interface. The document renders into a same-origin iframe
// whose DOM the renderer can touch directly, which is what invariant I1 asks
// for: resolution happens in a renderer, on the live DOM, never in main.
//
// `DocumentSurface` is still an interface rather than a class. It is the seam
// the resolver is called through, and a test double implements it.
//
// Not in §3.1's tree — the files it lists are the resolver itself, which stays
// free of anything React or IPC shaped.

import { partWords } from "../../shared/diagram.ts";
import { contextOf, findMatches, MAX_PAGE_MATCHES } from "../../shared/find.ts";
import { tallyPlaces, threadState } from "../../shared/targets.ts";
import type {
  Anchor,
  AnchorState,
  DiagramPart,
  DocumentPlace,
  FindMark,
  LineRange,
  SearchContext,
  TextPosition,
  Thread,
} from "../../shared/types.ts";
import {
  createDiagramAnchor,
  createDocumentAnchor,
  createElementAnchor,
  createRegionAnchor,
  createSectionAnchor,
  createTextAnchor,
} from "../anchor/create.ts";
import { diagramOf, fenceLineOf, partsOf } from "../anchor/diagram.ts";
import { createGapAnchor, gapLabel, stampedLineOf } from "../anchor/gap.ts";
import { clearFind, type HighlightHit, paintFind, paintHighlights } from "../anchor/highlight.ts";
import {
  blocksInDrawing,
  boundsOf,
  containerOfDrawing,
  polygonOf,
  type Stroke,
} from "../anchor/lasso.ts";
import {
  changedBlocks,
  contentColumn,
  describeElement,
  describeGap,
  GAP_MARK_HEIGHT,
  gapNeighboursAdjacent,
  gapRect,
  lineRectsOf,
  type PickScope,
  rectOfRun,
  type ScopeChain,
  type ScopeRect,
  scopeChainAt,
  scopeChainForAnchor,
  scopeChainForElement,
  scopeChainForPart,
  scopeChainForRange,
  stampedBlocks,
  toDocumentRect,
  unionRect,
} from "../anchor/pick.ts";
import { anchorStateFor, type Resolution, resolveAnchor } from "../anchor/resolve.ts";
import { headingTextOf } from "../anchor/section.ts";
import {
  buildTextIndex,
  offsetsToRange,
  rangeToOffsets,
  type TextIndex,
} from "../anchor/textIndex.ts";

/** One target the sweep could actually check — spec 05 §5.4. */
export interface CheckedTarget {
  /** Its index in `Thread.targets` — what `anchor:restate` names it by. */
  position: number;
  state: AnchorState;
  /**
   * The box to outline, or null for a text target: the Custom Highlight API
   * paints ranges, so a text target is a fill and a block target is an outline
   * (design/selection/Kinds).
   */
  box: ScopeRect | null;
  /**
   * Spec 08 §7.2 — where to draw this place's NUMBER, which is not the same
   * question as whether to draw an outline.
   *
   * A text target has no box, because filling it is the highlight's job — but
   * it still has a position, and pointing at its row has to be able to say
   * "there". Null only when there is genuinely nowhere: an orphan, or a
   * whole-document target.
   */
  mark: ScopeRect | null;
  /**
   * Spec 15 §8.2 — the box the margin bar spans: the BLOCK this place sits in.
   *
   * Not `mark`, and the difference is the whole point of the new mark. A
   * comment on one sentence has a `mark` that starts mid-line, and a bar drawn
   * at that x would stand in the middle of the prose. The reviewer asked for a
   * line beside the *section*, so a text target reports the paragraph, the list
   * item or the table cell that contains it, and a block target reports itself.
   */
  bar: ScopeRect | null;
  /**
   * Spec 16 §7.3 — the 1px line across the text column at a gap's insertion
   * point, and null for every other kind.
   *
   * A gap has no height, so its bar can only say *that* there is a comment
   * here; the rule is what says *where*. Drawn in the overlay over the pane —
   * spec 01 §6.7 is not bent for a horizontal line any more than for a `<mark>`.
   */
  rule: ScopeRect | null;
  /**
   * What this place turned out to BE — `Code block`, `Table · 3 rows × 4
   * columns`, `Section · “…”`. Null when the place holds a passage, which is
   * the one case that keeps its quote instead. `place.ts` is the rule.
   */
  label: string | null;
  /**
   * The source line it is on NOW, from the `data-src-line` the Markdown
   * renderer stamps (§5.3). The anchor's own `source.line` is where it *was*,
   * so the pair is what lets a card say `L41 was L37` — the concrete form of
   * "re-found after the file changed", which as a phrase alone leaves the
   * reviewer with nowhere to look.
   */
  line: number | null;
  /**
   * Spec 35 §3 — and the line it ends on, read the way a gap's line already
   * is: the next stamped block's start, or the file's own length for the last
   * block. Null where the format stamps nothing, and for a gap, which has no
   * extent.
   */
  lineEnd: number | null;
}

export interface ResolvedThread {
  threadId: string;
  /**
   * The worst state across the targets this sweep could check, ignoring the
   * ones it could not. Null when it checked none — which is not orphaned, and
   * must never be shown as one (§5.4).
   */
  state: AnchorState | null;
  /** One entry per target **in the open document**, never for the others. */
  checked: CheckedTarget[];
  /** From the first checked target, for the gutter marker. Null when none was. */
  top: number | null;
  /**
   * What the first checked target turned out to point at — `Table · 3 rows ×
   * 4 columns`, `Code block`. Null when that place holds prose, which is the
   * one case a comment list shows as a quote. Same value as `checked[0].label`;
   * kept here because the list draws one line per thread, not one per place.
   */
  label: string | null;
  /**
   * Spec 06 §5.4 — the union of every checked target's box, measured now.
   *
   * This is the frame a stored stroke's fractions are mapped onto, and
   * measuring it every sweep is what makes the ink survive a reflow, a resize
   * and a zoom: the ink is defined in terms of the targets, so when they move
   * it moves. Null when nothing here resolved.
   */
  union: ScopeRect | null;
}

/**
 * Which gesture made an anchor — a run of text, or a thing on the page.
 *
 * Not derivable from the anchor: `create.ts` gives both a quote and an element
 * ref, so only the moment of creation knows. Carried on the panel's item and
 * handed back whenever the chain has to be rebuilt (§4.1).
 */
export type SelectedKind = "text" | "element";

/**
 * Spec 05 §4.2 — enough to build a `SelectionItem`. Replaces `DraftAnchor`.
 *
 * `top` is gone with the floating composer: the panel does not sit beside
 * anything, so nothing needs a vertical position any more. `rect` carries the
 * geometry the outline needs.
 */
export interface Selected {
  anchor: Anchor;
  /** The row's own words — the quote, or `Table · 7 rows × 4 columns`. */
  label: string;
  /**
   * Null for a document target, which has no box: spec 06 §6.4 refuses to draw
   * an outline whose two edges are never on screen together. Spec 05 §6 already
   * defines that state and `DocumentView` already skips it.
   */
  rect: ScopeRect | null;
  /**
   * One box per line of the passage, for a place that IS text — so the outline
   * can follow the words instead of boxing the lines they sit on.
   *
   * Null for every place that is already a rectangle: a table, a figure, a
   * region cut out of an image, a gap, a run, the whole document. There the
   * box is the thing itself, and `rect` says it exactly.
   */
  lines: ScopeRect[] | null;
  /** The chain to widen through, and which of it produced `anchor`. */
  scopes: PickScope[];
  active: number;
}

/**
 * What a probe found: the chain under the cursor, and which of it to show as
 * chosen. The second half is the whole point — see `keptIndex`.
 */
export interface Probe {
  scopes: PickScope[];
  active: number;
}

/**
 * Spec 06 §5.3 — what a finished drawing yields.
 *
 * The strokes come back beside the targets, converted into the same document
 * coordinates the targets' boxes are in, because that is the space the ink is
 * stored from (§5.4) and only the surface can do the conversion.
 */
export interface Drawn {
  targets: Selected[];
  strokes: Stroke[];
}

/** One panel row, in the form the surface needs to measure it again. */
export interface AnchorToMeasure {
  anchor: Anchor;
  kind: SelectedKind;
}

/**
 * Where a place is now: the box it spans, and — for a passage — the line boxes
 * its outline follows. The pair travels together because both are measured
 * from the same resolution, and a `rect` without its `lines` is what draws the
 * outline back over text nobody selected.
 */
export interface MeasuredPlace {
  rect: ScopeRect;
  /** Null for a place that is a rectangle rather than a run of text. */
  lines: ScopeRect[] | null;
}

/**
 * Spec 16 §6.6 — one place the `+ Add` affordance can appear, as the overlay
 * needs it: a band to hover, a rule to draw, and an index to commit.
 *
 * Serialisable on purpose. The two blocks it sits between stay inside the
 * surface, because a live `Element` held in React state outlives the document
 * it came from and then resolves to *somewhere*.
 */
export interface GapSpot {
  /** What `anchorFromGap` takes back. Its position in this sweep's list. */
  index: number;
  /** The text column, in document coordinates. */
  x: number;
  w: number;
  /** The insertion point — where the rule is drawn. */
  y: number;
  /** The band that answers a hover, clamped so two can never overlap (§6.6). */
  top: number;
  bottom: number;
  /** §6.7 — what the place will be called once it is picked. */
  label: string;
}

/** §6.6 — the pointer must be within this of the midpoint for a gap to answer. */
const GAP_BAND = 8;

/** What the overlay needs from whichever surface is showing the document. */
export interface DocumentSurface {
  /**
   * `openDocumentId` is what makes §5.4 possible: a target in a document that
   * is not on screen has no live DOM, so it is not resolved and not guessed at.
   *
   * `activeThreadId` is the comment whose card is open, and it decides only
   * which colour its passages are painted in (§6).
   */
  resolve(
    threads: Thread[],
    documentChanged: boolean,
    openDocumentId: string,
    activeThreadId: string | null,
  ): Promise<ResolvedThread[]>;

  /**
   * Spec 05 §6 — where each selected place is on the page *now*.
   *
   * The panel's own rect is measured once, at the click. Everything that moves
   * a document under a fixed overlay — a window resize, a splitter drag, the
   * explorer opening, a re-render after Apply — leaves that rect behind, and a
   * dashed box drawn from it names text it is no longer over. Measured on
   * 2026-08-21: two places selected, the window widened by 300px, both outlines
   * stayed put while the prose re-centred around them.
   *
   * Null for a place whose anchor no longer resolves here: no box is honest,
   * and a box in the old spot is not.
   */
  rectsForAnchors(items: AnchorToMeasure[]): Promise<Array<MeasuredPlace | null>>;

  /**
   * §3.4 — the document's own text selection, dropped.
   *
   * Ask empties the panel, but the browser's selection is not the panel's and
   * survived it: the passage stayed blue in the document with nothing left in
   * REX that was about it.
   */
  clearTextSelection(): void;

  /** §6 — repaints the passages, with `activeThreadId`'s in the open colour. */
  repaintActive(activeThreadId: string | null, hoveredThreadId?: string | null): void;

  /** A text selection, or null when there is none worth taking (§3.1 rule 1). */
  selectionMade(): Promise<Selected | null>;

  /**
   * design/selection/Hover — what sits under the cursor, and what encloses it.
   *
   * `keep` is the scope the reviewer had chosen **by hand** in the previous
   * chain, so that widening survives the pointer moving. `NO_KEPT_SCOPE` when
   * there was no such choice, and then the narrowest scope wins — see
   * `keptIndex`.
   */
  probeAt(x: number, y: number, keep: number): Promise<Probe | null>;

  /** Commits the probe's chain at `index`. */
  anchorFromScope(index: number): Promise<Selected | null>;
  /** design/selection/Region — a dragged box, in document coordinates. */
  anchorFromRegion(index: number, box: ScopeRect): Promise<Selected | null>;

  /**
   * Spec 06 §5.3 — the blocks a drawing enclosed, as ordinary targets.
   *
   * Strokes arrive as `PenLayer` keeps them: CSS pixels from the document's
   * content origin, which is the only frame that survives a zoom (see its own
   * note). Only a surface holds the document, so only a surface can put them
   * back into document coordinates — which is why the converted strokes come
   * back too, for the ink to be stored from.
   *
   * The targets are what a click would have produced for each block, in
   * document order, so nothing downstream knows the pen exists.
   */
  targetsFromDrawing(strokes: Stroke[], zoom: number): Promise<Drawn>;

  /**
   * §4.1 — the chain for an item already in the panel, rebuilt from its anchor.
   *
   * It also becomes the surface's current chain, so `anchorFromScope` and
   * `anchorFromRegion` act on the row the reviewer just expanded rather than on
   * whatever the pointer last passed over.
   *
   * `kind` is what the panel remembers about how the anchor was made; a stored
   * anchor cannot say. See `scopeChainForAnchor`.
   */
  scopesForAnchor(anchor: Anchor, kind: SelectedKind): Promise<Probe | null>;
  /** Re-anchors an item to one scope of that rebuilt chain. */
  anchorFromAnchorScope(
    anchor: Anchor,
    kind: SelectedKind,
    index: number,
  ): Promise<Selected | null>;

  /** Scrolls the document itself — the pick layer covers it and eats the wheel. */
  scrollBy(dx: number, dy: number): void;
  /** §3.3 — a panel row clicked while its document is open scrolls to it. */
  scrollToAnchor(anchor: Anchor): void;

  /**
   * Spec 53 §4.2 — a `#fragment`, in this document.
   *
   * False when nothing here carries the id, which is the honest answer and the
   * one the notice bar needs: the file opened, the place in it does not exist.
   */
  scrollToFragment(id: string): boolean;
  /** Spec 53 §4.4 — put the reviewer back where a history entry says they were. */
  scrollToPlace(place: DocumentPlace): void;
  /** Spec 53 §5.4 — where the reviewer is now, to remember before leaving. */
  placeHere(): DocumentPlace | null;

  /** §5.6.1 — the boxes to outline after an Apply, from `data-src-line`. */
  boxesForLines(ranges: LineRange[]): Promise<ScopeRect[]>;

  /**
   * Spec 16 §4.1 and §5.5 — the blocks a gesture may land on here.
   *
   * `null` means "all of them", which is the original pane and every document
   * nobody has changed. A **non-null empty** list is not the same thing: it
   * means this pane has a change to show and no way to say which blocks it
   * touched — a plain HTML file with no `data-src-line` — so nothing is live.
   *
   * Line ranges rather than elements, because the surface owns the DOM and the
   * caller owns the working copy. Called again whenever that list moves: a new
   * revision, an undo, an approve, a discard.
   */
  setLiveBlocks(ranges: LineRange[] | null): void;

  /** Spec 16 §6.6 — every gap the `+ Add` affordance can appear in. */
  gaps(): GapSpot[];

  /**
   * §6.1 — the gap nearest the middle of what is on screen, for the `A` key.
   *
   * A keyboard gesture has no pointer, so "here" has to mean something. The
   * middle of the visible text is what a reader is looking at, and the place
   * that appears in the panel names its neighbour — so a wrong guess is
   * visible before anything is sent, and one `esc` undoes it.
   *
   * Null when this document offers no gaps at all.
   */
  nearestGap(): number | null;

  /** §6.1 — one of them, committed as a place. */
  anchorFromGap(index: number): Promise<Selected | null>;

  /**
   * Spec 29 §4.2 — a part of a drawn diagram, chosen in the lightbox, as a
   * place. The lightbox holds a copy of the drawing and never touches the
   * document; it names the block by its id and the part by what the source
   * calls it, and the surface — which owns the DOM — makes the anchor.
   */
  anchorFromDiagramPart(blockId: string, part: DiagramPart): Promise<Selected | null>;

  /**
   * Spec 28 §5.2 — every match of `query` on this page, painted and measured.
   *
   * The surface owns the index, so it owns the find: matching runs over the
   * same normalised text the anchors resolve against (§2 point 1), and the
   * ranges are kept here for `findShow` and `findContext`.
   */
  find(query: string): FindOutcome;
  /**
   * Paints one match as current. With `reveal`, scrolls to it — but only if
   * it is not already on screen, which is the difference between a page that
   * keeps still while the reviewer types and one that jumps on every letter.
   */
  findShow(ordinal: number, reveal: boolean): void;
  /** §5.5 — the words around one match, for telling a hit from main which it is. */
  findContext(ordinal: number): SearchContext | null;
  /** §4.1 — `esc`: no yellow remains. */
  findClear(): void;
  /** §4.1 — the page's own text selection, as a string, for seeding the bar. */
  selectedText(): string;
}

/** Spec 28 §5.2 — what `find` hands back. */
export interface FindOutcome {
  count: number;
  /** §4.3 — more than `MAX_PAGE_MATCHES` exist; `count` is the first thousand. */
  capped: boolean;
  /**
   * §4.1 — the first match at or below the top of the viewport, or 0. What
   * becomes current when the query changes, so a reviewer who scrolled to §6
   * and typed finds §6's match current rather than page one's.
   */
  nearest: number;
  /** §4.1.1 — one per match, for the overview ruler. */
  marks: FindMark[];
}

/**
 * `probeAt`'s `keep` when the reviewer has not widened by hand. Nothing is
 * carried over and the narrowest scope wins.
 */
export const NO_KEPT_SCOPE = -1;

/**
 * Which scope of a new chain the reviewer should still be on.
 *
 * A probe fires on every pointer move, and it used to reset the choice to the
 * narrowest scope each time. So the reviewer widened from the cell to the table
 * with ↑, moved the mouse one pixel on the way to clicking, and silently got the
 * cell back. Measured on 2026-08-21 on `sample-document.md`: widen to `table`,
 * move 1px, click — the composer opened on "Cell · row 3".
 *
 * The chosen *element* is what carries over, not its position: hovering a
 * different cell of the same table keeps the table chosen, because the table is
 * still in the chain. Moving to another part of the document does not, because
 * it is not — and there the narrowest scope is right again.
 *
 * **Only a deliberate choice is carried**, which is why `keep` can be
 * `NO_KEPT_SCOPE`. An element that encloses everything never leaves the chain,
 * so a choice that landed on one would pin every later probe to it — and a PDF
 * page is exactly such an element. A first hover over blank paper chose the
 * page, because there the page is the only scope, and from then on hovering a
 * line of text still reported the page. Measured on 2026-08-21 on
 * `documentation-sample/one/sample-document.pdf`: a hover over the Summary
 * paragraph offered `page 1 › line` with `page 1` chosen, and every click added
 * a whole page.
 */
function keptIndex(previous: ScopeChain | null, next: ScopeChain, keep: number): number {
  const chosen = keep >= 0 ? (previous?.elements[keep] ?? null) : null;
  if (!chosen) return 0;
  const at = next.elements.indexOf(chosen);
  return at >= 0 ? at : 0;
}

function documentTop(rect: DOMRect, view: Window): number {
  return rect.top + view.scrollY;
}

/** Elements that are not a passage in their own right, so the walk goes past them. */
const INLINE = new Set(["A", "B", "I", "EM", "STRONG", "CODE", "SPAN", "SMALL", "SUP", "SUB"]);

/**
 * Spec 15 §8.2 — the block a range sits in, for the margin bar to span.
 *
 * Walks out of inline elements, because a comment on a bold phrase is a comment
 * on the paragraph it is in as far as the margin is concerned. Stops at the
 * body: a bar down the whole document is the outline §6.7 already refused to
 * draw, for the same reason.
 */
function blockRectOf(view: Window, range: Range): ScopeRect | null {
  let node: Node | null = range.commonAncestorContainer;
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;

  let element = node as Element | null;
  while (element && INLINE.has(element.tagName)) element = element.parentElement;
  if (!element || element.tagName === "BODY" || element.tagName === "HTML") return null;

  return toDocumentRect(view, element.getBoundingClientRect());
}

/**
 * SPEC.md §6.5 and §6.6 — resolve every thread against a live DOM, then paint.
 *
 * Takes the `Window` and `Document` rather than reaching for the frame itself,
 * so the resolver never assumes which document it is looking at.
 */
function resolveAgainst(
  view: Window,
  doc: Document,
  threads: Thread[],
  documentChanged: boolean,
  openDocumentId: string,
  activeThreadId: string | null,
): { index: TextIndex; resolved: ResolvedThread[]; hits: HighlightHit[] } {
  const index = buildTextIndex(doc);
  const hits: HighlightHit[] = [];
  const resolved: ResolvedThread[] = [];

  for (const thread of threads) {
    let top: number | null = null;
    let label: string | null = null;
    let union: ScopeRect | null = null;
    const checked: CheckedTarget[] = [];

    /**
     * Spec 06 §5.4 — the frame the stroke's fractions are mapped onto.
     *
     * Every target's box, including a text target's, which `CheckedTarget.box`
     * deliberately leaves null because the Custom Highlight API paints that one
     * as a fill. The ink still has to span it.
     */
    const widen = (box: ScopeRect): void => {
      union = union ? unionRect(union, box) : box;
    };

    for (const [position, target] of thread.targets.entries()) {
      // §5.4 — a target in a document that is not open has no live DOM. It is
      // not resolved and not guessed at; it keeps whatever state it last had.
      if (target.documentId !== openDocumentId) continue;

      const anchor = target.anchor;
      const resolution = resolveAnchor(index, anchor);
      const state = anchorStateFor(resolution, documentChanged);
      const first = checked.length === 0;

      // Both are the same two questions for every kind of resolution — what is
      // this place, and where in the file is it now — so they are asked once.
      const words = resolution ? describeResolved(index, resolution, anchor) : null;
      const line = resolution ? sourceLineOf(resolution) : null;
      const lineEnd = resolution ? sourceLineEndOf(resolution) : null;

      if (resolution?.kind === "range") {
        hits.push({ threadId: thread.id, range: resolution.range, status: thread.status, state });
        // No box — the highlight fills it — but a mark, so its row can point.
        const where = toDocumentRect(view, resolution.range.getBoundingClientRect());
        checked.push({
          position,
          state,
          box: null,
          mark: where,
          bar: blockRectOf(view, resolution.range) ?? where,
          rule: null,
          label: words,
          line,
          lineEnd,
        });
        widen(where);
        if (first) {
          top = documentTop(resolution.range.getBoundingClientRect(), view);
          label = words;
        }
      } else if (resolution?.kind === "element") {
        const outline = toDocumentRect(view, resolution.element.getBoundingClientRect());
        const box = anchor.region ? regionWithin(outline, anchor) : outline;
        checked.push({
          position,
          state,
          box,
          mark: box,
          bar: box,
          rule: null,
          label: words,
          line,
          lineEnd,
        });
        widen(box);
        if (first) {
          top = box.y;
          label = words;
        }
      } else if (resolution?.kind === "gap") {
        // Spec 16 §7.4 — a gap has no block, so it gets one built: a
        // zero-width, one-line-high bar in the lane, and the rule that says
        // where. No `HighlightHit` either — there is no range to paint.
        const where = gapRect(index, resolution.after, resolution.before);
        const mark = { x: where.x, y: where.y, w: 0, h: where.h };
        // §7.3 — the rule only where there is still a gap to point at. Once
        // something has been written into it the two neighbours are no longer
        // next to each other, and a line across the column would be drawn over
        // that new text: the mark for "put something here" would read as
        // "delete this". The bar still says which comment, and where.
        const empty = gapNeighboursAdjacent(doc, resolution.after, resolution.before);
        checked.push({
          position,
          state,
          box: null,
          mark,
          bar: mark,
          rule: empty ? { x: where.x, y: where.y + where.h / 2, w: where.w, h: 0 } : null,
          label: words,
          line,
          lineEnd,
        });
        widen(where);
        if (first) {
          top = where.y;
          label = words;
        }
      } else if (resolution?.kind === "run") {
        // Spec 06 §6.4 — a run is outlined, never filled, around the union of
        // its ends. A document target draws nothing at all: an outline round
        // the whole file is a rectangle whose two edges are never on screen
        // together, it would lie over every other mark, and it teaches nothing.
        // Its gutter marker at the top of the document is where it belongs.
        const whole = resolution.extent === "document";
        const box = rectOfRun(resolution);
        // A whole-document target has no mark either: a number at the top of a
        // file points at nothing the reviewer can look at.
        checked.push({
          position,
          state,
          box: whole ? null : box,
          mark: whole ? null : box,
          bar: whole ? null : box,
          rule: null,
          label: words,
          line,
          lineEnd,
        });
        // A document target is left out of the union for the same reason it
        // draws no box: it would stretch the ink over the whole file.
        if (!whole) widen(box);
        if (first) {
          top = whole ? 0 : box.y;
          label = words;
        }
      } else {
        // Orphaned: nothing to paint and nowhere to draw it, but the target is
        // still checked and still has to be restated.
        checked.push({
          position,
          state,
          box: null,
          mark: null,
          bar: null,
          rule: null,
          label: null,
          line: null,
          lineEnd: null,
        });
      }
    }

    // A thread with nothing checked here keeps its row and its card. Dropping
    // it would cost it the state an earlier visit found (§5.4).
    resolved.push({
      threadId: thread.id,
      state: threadState(tallyPlaces(checked.map((entry) => entry.state))),
      checked,
      top,
      label,
      union,
    });
  }

  paintHighlights(view, hits, activeThreadId);
  return { index, resolved, hits };
}

/**
 * Where one anchor's box is on the page as it is drawn now, or null when the
 * thing it named is not in this document any more.
 *
 * The quote is dropped for an element place, exactly as `scopeChainForAnchor`
 * drops it: `create.ts` gives an element anchor a quote too, and answering the
 * quote first would measure the text rather than the table it was taken from.
 */
function rectForAnchorIn(
  view: Window,
  index: TextIndex,
  anchor: Anchor,
  kind: SelectedKind,
): MeasuredPlace | null {
  const probe = kind === "element" && !anchor.extent ? { ...anchor, quote: null } : anchor;
  const resolution = resolveAnchor(index, probe);
  if (!resolution) return null;
  if (resolution.kind === "range") {
    // The union AND the lines: the outline follows the words, and everything
    // else — the path bar, the ink's frame, the scroll — still wants one box.
    return {
      rect: toDocumentRect(view, resolution.range.getBoundingClientRect()),
      lines: lineRectsOf(view, resolution.range),
    };
  }
  // Spec 16 §7.3 — a gap's box is the text column at the insertion point, so
  // the panel's outline shows *where* rather than a zero-width sliver.
  if (resolution.kind === "gap") {
    return { rect: gapRect(index, resolution.after, resolution.before), lines: null };
  }
  if (resolution.kind === "run") {
    // §6.4 again — the whole file has no box a reviewer could read.
    return resolution.extent === "document" ? null : { rect: rectOfRun(resolution), lines: null };
  }
  const outline = toDocumentRect(view, resolution.element.getBoundingClientRect());
  return { rect: anchor.region ? regionWithin(outline, anchor) : outline, lines: null };
}

/** The stored fractions, back into a box on the element as it is drawn now. */
function regionWithin(element: ScopeRect, anchor: Anchor): ScopeRect {
  const region = anchor.region;
  if (!region) return element;
  return {
    x: element.x + region.x * element.w,
    y: element.y + region.y * element.h,
    w: region.w * element.w,
    h: region.h * element.h,
  };
}

/**
 * Blocks whose text is not prose, and so must never be shown as a quote.
 *
 * The selector is the DOM half of `place.ts`'s rule: a range that lands inside
 * one of these is a place in a code block or a table, not a passage, however
 * ordinary its quote looked when it was stored.
 */
const OPAQUE_BLOCKS = "pre, table, figure, img, svg, canvas, video";

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/**
 * A one-line name for a resolved place, so a card has something true to show
 * rather than a blank line, an invented description, or a flattened code block
 * dressed up as a sentence.
 *
 * Null — and only null — means "this really is prose, quote it".
 *
 * A run always gets a name, quote or no quote: a section anchor stores its
 * heading's text (§4.3), and showing that as the card's blockquote would claim
 * the comment is about eight words when it is about everything under them.
 */
function describeResolved(index: TextIndex, resolution: Resolution, anchor: Anchor): string | null {
  // Spec 16 §6.7 — a gap is always named, never quoted: there is nothing there
  // to quote, which is the whole point of it.
  if (resolution.kind === "gap") {
    return gapLabel(resolution.after, resolution.before);
  }

  if (resolution.kind === "run") {
    return resolution.extent === "document"
      ? "The whole document"
      : `Section · “${headingTextOf(resolution.first)}”`;
  }

  if (resolution.kind === "element") {
    // Spec 29 §4.1 — a diagram part is named by the source, in the words the
    // chip used. `describeElement` on the `<g>` it is drawn as would say `g`.
    if (anchor.diagram) {
      const block = diagramOf(resolution.element);
      if (block) return partWords(partsOf(block), anchor.diagram.part, fenceLineOf(block)).title;
    }
    const { title } = describeElement(index, resolution.element);
    const region = anchor.region;
    if (!region) return title;
    return `Region of ${title} · x ${region.x.toFixed(2)} · w ${region.w.toFixed(2)}`;
  }

  // A range. It keeps its quote unless the block it landed in is one whose
  // text carries no meaning on its own, in which case the block is named.
  const block = elementOf(resolution.range.commonAncestorContainer)?.closest(OPAQUE_BLOCKS);
  return block ? describeElement(index, block).title : null;
}

/**
 * Which line of the source file a resolved place is on NOW.
 *
 * `data-src-line` is stamped on every block by the Markdown renderer (§5.3),
 * so this is a lookup rather than a measurement. Absent for tier-1 HTML, which
 * has no source file to number — the card then shows the document alone, which
 * is what it showed before this existed.
 */
function sourceLineOf(resolution: Resolution): number | null {
  // Spec 16 §6.5 — a gap is on the line its lower neighbour starts on, because
  // that is where an insertion goes. With only the block above still here, it
  // is that block's line plus however many lines the block itself spans.
  if (resolution.kind === "gap") {
    const below = stampedLineOf(resolution.before);
    if (below !== null) return below;
    const above = stampedLineOf(resolution.after);
    return above === null ? null : above + blockLineCount(resolution.after);
  }

  // Spec 29 §5.4 — a diagram part knows its own line: the fence's stamp plus
  // where in the fence the part is stated.
  if (resolution.kind === "element" && resolution.line !== undefined) return resolution.line;

  const node =
    resolution.kind === "range"
      ? elementOf(resolution.range.commonAncestorContainer)
      : resolution.kind === "element"
        ? resolution.element
        : resolution.first;
  return stampedLineOf(stampedBlockAt(node, "start"));
}

/**
 * The stamped block a node's line is read from, when the node itself carries
 * no stamp.
 *
 * `data-src-line` goes on paragraphs, headings, list ITEMS, tables and fences
 * — not on the `<ul>` around the items, not on an `<hr>`, not on a raw HTML
 * block. A whole-document run therefore ends on a bare `<ul>` whenever a file
 * ends with a list, and `closest` finds nothing above it. Measured 2026-09-02
 * on a 1130-line file whose last element was that `<ul>`: the head showed
 * `whole file` with no length.
 *
 * So: the node's own stamp; else the first or last stamped block INSIDE it,
 * which is the `<ul>` case; else the nearest stamped block before or after it
 * in document order, which is the `<hr>` case. `end` and `start` read the
 * same shape from opposite ends.
 */
function stampedBlockAt(node: Element | null, edge: "start" | "end"): Element | null {
  if (!node) return null;
  const own = node.closest("[data-src-line]");
  if (own) return own;
  const inside = node.querySelectorAll("[data-src-line]");
  if (inside.length > 0) return inside[edge === "start" ? 0 : inside.length - 1];
  const blocks = stampedBlocks(node.ownerDocument);
  if (edge === "start") {
    return (
      blocks.find(
        (block) => node.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
      ) ?? null
    );
  }
  return (
    blocks.findLast(
      (block) => node.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_PRECEDING,
    ) ?? null
  );
}

/**
 * Spec 35 §3 — which line of the source file a resolved place ENDS on.
 *
 * The same lookup as `sourceLineOf`, from the other end: the block the place's
 * last node sits in, and where that block ends. A gap has no extent, so it has
 * no last line; a diagram part is one line, its own.
 */
function sourceLineEndOf(resolution: Resolution): number | null {
  if (resolution.kind === "gap") return null;
  if (resolution.kind === "element" && resolution.line !== undefined) return resolution.line;

  const node =
    resolution.kind === "range"
      ? elementOf(resolution.range.endContainer)
      : resolution.kind === "element"
        ? resolution.element
        : resolution.last;
  const block = stampedBlockAt(node, "end");
  const line = stampedLineOf(block);
  if (block === null || line === null) return null;
  return line + blockLineCount(block) - 1;
}

/**
 * How many source lines a block spans, read off the block that follows it.
 *
 * `data-src-line` marks where a block *starts*, so the only thing in the DOM
 * that knows where it ends is the next stamped block — and for the last block
 * in the file, the file's own length, which the renderer writes on `<body>`
 * (spec 35 §3). One line is the fallback where neither is known.
 */
function blockLineCount(block: Element | null): number {
  const line = stampedLineOf(block);
  if (block === null || line === null) return 1;
  const blocks = stampedBlocks(block.ownerDocument);
  const next = blocks[blocks.indexOf(block) + 1] ?? null;
  const after = stampedLineOf(next);
  if (after !== null && after > line) return after - line;
  const total = documentLineCount(block.ownerDocument);
  return total !== null && total >= line ? total - line + 1 : 1;
}

/** The file's line count, from the `data-src-lines` the renderer stamps on `<body>`. */
function documentLineCount(doc: Document): number | null {
  const total = Number.parseInt(doc.body?.getAttribute("data-src-lines") ?? "", 10);
  return Number.isFinite(total) ? total : null;
}

// ── PDF: a comment is a place on a page, never a quote ──────────

/** The `.rex-pdf-page` box a node sits in, or null outside a PDF. */
function pdfPageOf(node: Node): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(".rex-pdf-page") ?? null;
}

/**
 * Spec 03 §7.3 — in a PDF, a quote cannot lead.
 *
 * Three properties of the format, none of them faults of PDF.js, make a quote
 * untrustworthy there: `getTextContent()` returns items in content-stream
 * order rather than reading order, so a two-column page interleaves its
 * columns; word spaces are often absent from the strings and implied only by
 * glyph positions; and ligatures arrive as one glyph, so `find` becomes `ﬁnd`.
 * The same sentence can therefore normalise to two different strings on two
 * runs, and a quote anchor that reports `ok` may be pointing anywhere — exactly
 * the silent wrong-place failure REX exists to avoid.
 *
 * So a PDF anchor is a *region of a page*: `element` is `#page-N`, `region` is
 * the fraction box inside it, and the quote is kept only as a hint. Keeping it
 * costs nothing, because `resolveAnchor` takes the region branch whenever
 * `region` is set and never consults the quote for these. This is how Acrobat
 * has always worked, and it is honest: point at a place on a page.
 */
function pdfRegionAnchor(
  view: Window,
  index: TextIndex,
  page: Element,
  target: ScopeRect,
  quoteFrom: Anchor | null,
  sourceFile: string | null,
): Anchor {
  const box = toDocumentRect(view, page.getBoundingClientRect());
  const anchor = createRegionAnchor(
    index,
    page,
    { x: target.x - box.x, y: target.y - box.y, w: target.w, h: target.h },
    sourceFile,
  );
  if (!quoteFrom?.quote) return anchor;
  // The hint is what the reviewer actually selected, not the page's opening
  // text — that is the whole value of recording it.
  return { ...anchor, quote: quoteFrom.quote, position: quoteFrom.position };
}

/**
 * Spec 05 §3.1 rule 1 — under this many characters is never a comment.
 *
 * Every selection now *adds* a row, and people drag over a sentence while
 * reading. Two characters of that is a slip, not a question.
 */
const MIN_SELECTION_CHARACTERS = 3;

/** The words a panel row shows for one scope. */
function labelFor(scope: PickScope | undefined, region: boolean): string {
  if (!scope) return "Selection";
  const base = scope.kind === "text" ? (scope.quote ?? "Text selection") : scope.title;
  return region ? `Region of ${base}` : base;
}

/** SPEC.md §6.4 — the user's selection becomes an anchor, or nothing. */
function anchorFromSelectionIn(
  view: Window,
  index: TextIndex | null,
  sourceFile: string | null,
): { selected: Selected; chain: ScopeChain } | null {
  if (!index) return null;
  const selection = view.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (range.toString().replace(/\s+/g, " ").trim().length < MIN_SELECTION_CHARACTERS) return null;
  if (!rangeToOffsets(index, range)) return null;

  const text = createTextAnchor(index, range, sourceFile);
  if (!text) return null;

  // Spec 03 §7.3 — inside a PDF the same selection becomes a region of its
  // page, with the quote kept only as a hint.
  const page = pdfPageOf(range.commonAncestorContainer);
  const anchor = page
    ? pdfRegionAnchor(
        view,
        index,
        page,
        toDocumentRect(view, range.getBoundingClientRect()),
        text,
        sourceFile,
      )
    : text;

  const chain = scopeChainForRange(index, range);
  return {
    selected: {
      anchor,
      label: labelFor(chain.scopes[0], false),
      rect: toDocumentRect(view, range.getBoundingClientRect()),
      // §7.3 again — inside a PDF what was stored is a REGION of the page, so
      // the outline has to be the rectangle that was stored. Everywhere else
      // the place is the words, and the outline follows them.
      lines: page ? null : lineRectsOf(view, range),
      scopes: chain.scopes,
      active: 0,
    },
    chain,
  };
}

/**
 * design/selection/Escalate and /Region — the anchor for one scope of a chain.
 *
 * Every scope writes the same `Anchor` shape: no new fields, and the widening
 * is the same widening the path bar performs before the click.
 */
function anchorFromScopeIn(
  view: Window,
  index: TextIndex | null,
  chain: ScopeChain | null,
  scopeIndex: number,
  sourceFile: string | null,
  region: ScopeRect | null,
): Selected | null {
  if (!index || !chain) return null;
  const scope = chain.scopes[scopeIndex];
  if (!scope) return null;

  const made = (
    anchor: Anchor,
    rect: ScopeRect | null,
    cut: boolean,
    lines: ScopeRect[] | null = null,
  ): Selected => ({
    anchor,
    label: labelFor(scope, cut),
    rect,
    lines,
    scopes: chain.scopes,
    active: scopeIndex,
  });

  // Spec 06 §4.3 — both write the same `Anchor` shape as everything else, and
  // both are read before the four layers on the way back out.
  if (scope.extent === "document") return made(createDocumentAnchor(), null, false);
  if (scope.extent === "section") {
    const heading = chain.elements[scopeIndex];
    if (!heading) return null;
    return made(createSectionAnchor(index, heading, sourceFile), scope.rect, false);
  }

  // Spec 29 §5.6 — a part of a drawn diagram is named in the fence's source,
  // never as the `<g>` it is drawn as. The chain's element is the part's
  // drawing, or the `<pre>` when the map had none for it; either way the block
  // is the diagram it sits in.
  if (scope.part) {
    const block = diagramOf(chain.elements[scopeIndex]);
    if (!block) return null;
    const anchor = createDiagramAnchor(block, scope.part, sourceFile);
    return anchor ? made(anchor, scope.rect, false) : null;
  }

  if (scope.kind === "text") {
    if (!chain.range) return null;
    const text = createTextAnchor(index, chain.range, sourceFile);
    if (!text) return null;
    const page = pdfPageOf(chain.range.commonAncestorContainer);
    const anchor = page
      ? pdfRegionAnchor(
          view,
          index,
          page,
          toDocumentRect(view, chain.range.getBoundingClientRect()),
          text,
          sourceFile,
        )
      : text;
    // Widening to `text` keeps the passage a passage, so its outline still
    // follows the words — measured off the chain's own range, not the scope's
    // box, which is that range flattened into one rectangle.
    return made(anchor, scope.rect, false, page ? null : lineRectsOf(view, chain.range));
  }

  const element = chain.elements[scopeIndex];
  if (!element) return null;

  if (region) {
    // The drag arrives in document coordinates; `createRegionAnchor` wants it
    // relative to the element's own top-left corner.
    const box = toDocumentRect(view, element.getBoundingClientRect());
    const anchor = createRegionAnchor(
      index,
      element,
      { x: region.x - box.x, y: region.y - box.y, w: region.w, h: region.h },
      sourceFile,
    );
    return made(anchor, region, true);
  }

  // §7.3 again: widening to anything inside a PDF still resolves through the
  // page, so an element anchor there is a region covering what was picked.
  const page = pdfPageOf(element);
  if (page) {
    return made(
      pdfRegionAnchor(view, index, page, scope.rect, null, sourceFile),
      scope.rect,
      false,
    );
  }

  return made(createElementAnchor(index, element, sourceFile), scope.rect, false);
}

/**
 * Spec 06 §5.3 step 6 — a drawing becomes targets.
 *
 * The load-bearing step. A drawn target is an **ordinary element or region
 * anchor**: it resolves through the same four layers, it reports `ok`, `moved`
 * or `orphaned` the same way, and Apply treats it exactly as it treats a target
 * that was clicked. Nothing downstream learns a new kind of target, and an
 * agent that never hears the word "pen" still answers correctly — which is the
 * test of whether §5.3 was designed properly.
 */
function targetsFromDrawingIn(
  view: Window,
  doc: Document,
  index: TextIndex | null,
  strokes: ReadonlyArray<Stroke>,
  zoom: number,
  sourceFile: string | null,
  liveBlocks: Element[] | null,
): Drawn {
  if (!index || !doc.body) return { targets: [], strokes: [] };

  // The layer keeps points as CSS pixels from the content's top-left corner, so
  // that they survive a zoom re-centring the prose. Every box below is in
  // document coordinates at the zoom on screen, so the strokes come up to meet
  // them: scale by the zoom, then shift by where that content now starts.
  const base = toDocumentRect(view, doc.body.getBoundingClientRect());
  const scaled: Stroke[] = strokes.map((stroke) =>
    stroke.map((point) => ({ x: point.x * zoom + base.x, y: point.y * zoom + base.y })),
  );

  const made = (element: Element, anchor: Anchor, rect: ScopeRect, cut: boolean): Selected => {
    const chain = scopeChainForElement(index, element);
    return {
      anchor,
      label: labelFor(chain.scopes[0], cut),
      rect,
      // A lasso takes whole blocks and regions of them. Both are rectangles.
      lines: null,
      scopes: chain.scopes,
      active: 0,
    };
  };

  // Spec 16 §5.5 — the lasso FILTERS rather than refusing outright, so a
  // drawing that crosses one live block and two unchanged ones still makes a
  // comment about the one it was allowed to take.
  const blocks = blocksInDrawing(view, doc, scaled).flatMap((el) => liveWithin(liveBlocks, el));
  if (blocks.length > 0) {
    return {
      targets: blocks.map((element) =>
        made(
          element,
          createElementAnchor(index, element, sourceFile),
          toDocumentRect(view, element.getBoundingClientRect()),
          false,
        ),
      ),
      strokes: scaled,
    };
  }

  // §5.3 — when the circle encloses nothing, the floor. Refusing a gesture the
  // reviewer clearly meant is worse than answering it imprecisely.
  const container = containerOfDrawing(view, doc, scaled);
  const bounds = boundsOf(polygonOf(scaled));
  if (!container || !bounds) return { targets: [], strokes: scaled };
  // The floor is still bounded by §4.1: a circle drawn over unchanged prose
  // must not fall back to a region of the whole content root.
  if (!isLive(liveBlocks, container)) return { targets: [], strokes: scaled };

  const box = toDocumentRect(view, container.getBoundingClientRect());
  const anchor = createRegionAnchor(
    index,
    container,
    { x: bounds.x - box.x, y: bounds.y - box.y, w: bounds.w, h: bounds.h },
    sourceFile,
  );
  return { targets: [made(container, anchor, bounds, true)], strokes: scaled };
}

// ── Spec 16 §5.2 — two sweeps, merged ───────────────────────────

/** `ok` beats `moved` beats `orphaned` — the order "best" means here. */
const BETTER: Record<AnchorState, number> = { ok: 0, moved: 1, orphaned: 2 };

/**
 * Spec 16 §5.2 — **per target, the best of the two panes.**
 *
 * This is the trap in the whole spec. A target that resolved on the left and
 * not on the right is *found*, not lost, and taking the worse of the two panes
 * would report every comment on unchanged text as orphaned the moment a working
 * copy existed — which is §1.2 rebuilt with more machinery.
 *
 * Spec 32 §6 made the per-**thread** rule agree with this one instead of
 * contradicting it: a comment is lost only when every place is, which is what
 * `threadState` does. The two questions are still different — one place seen
 * twice, against several places seen once — and both now answer "best".
 *
 * Which version a comment is about is not stored anywhere. It is wherever the
 * anchor resolves, and this is the only place that reads the answer.
 */
export function mergeResolved(panes: ReadonlyArray<ResolvedThread[]>): ResolvedThread[] {
  const order: string[] = [];
  const byThread = new Map<string, ResolvedThread[]>();
  for (const pane of panes) {
    for (const entry of pane) {
      const found = byThread.get(entry.threadId);
      if (found) found.push(entry);
      else {
        order.push(entry.threadId);
        byThread.set(entry.threadId, [entry]);
      }
    }
  }

  return order.map((threadId) => {
    const entries = byThread.get(threadId) as ResolvedThread[];
    const best = new Map<number, CheckedTarget>();
    for (const entry of entries) {
      for (const check of entry.checked) {
        const held = best.get(check.position);
        if (!held || BETTER[check.state] < BETTER[held.state]) best.set(check.position, check);
      }
    }
    const checked = [...best.values()].sort((a, b) => a.position - b.position);
    // The geometry comes from the first pane that found anything, which is the
    // new version whenever it did — the pane a card's "go to this place" jumps
    // into unless the passage only exists on the left.
    const anchored = entries.find((entry) => entry.top !== null) ?? entries[0];
    return {
      threadId,
      state: threadState(tallyPlaces(checked.map((entry) => entry.state))),
      checked,
      top: anchored.top,
      label: anchored.label,
      union: anchored.union,
    };
  });
}

// ── Spec 16 §4.1 — what a gesture is allowed to land on ─────────

/**
 * Whether a node is inside one of the live blocks.
 *
 * `live.contains(el)` and never the other way round. A selection dragged across
 * a changed block and two unchanged ones has the content root as its common
 * ancestor, and answering "yes, that root contains a live block" would let
 * every gesture through — which is exactly the ambiguity §4 removes.
 */
function isLive(live: Element[] | null, node: Node | null): boolean {
  if (live === null) return true;
  if (!node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return false;
  return live.some((block) => block === el || block.contains(el));
}

/**
 * Spec 16 §5.5 — the live part of a block the lasso took, in document order.
 *
 * `isLive` alone is not enough here, and a list is why. The Markdown renderer
 * stamps `data-src-line` on a `<li>` but not on the `<ul>` around it, so a
 * changed list item makes the ITEM live while its list is not. The lasso
 * collapses a circle to the outermost block it encloses — the `<ul>` — and
 * `live.contains(el)` is then false in the only direction `isLive` asks about.
 * Every target was dropped and a circle round a changed list selected nothing,
 * which is the same silent failure as the pen bug beside it. Measured on
 * 2026-08-26.
 *
 * So a block that is not itself live hands back the live blocks INSIDE it. The
 * rule §4.1 states is unchanged — what is outlined in green is what responds —
 * and the reviewer gets exactly the outlined items their circle went round.
 */
function liveWithin(live: Element[] | null, el: Element): Element[] {
  if (live === null || isLive(live, el)) return [el];
  return live.filter((block) => el.contains(block));
}

/**
 * Spec 16 §6.6 — every gap in the document, as bands the overlay can hover.
 *
 * The blocks are the ones the rest of REX already agrees on (`stampedBlocks`),
 * so a document with no `data-src-line` has no gaps at all and the affordance
 * simply never appears — §6.4's third case, by construction.
 *
 * The band is clamped to half the room between the two blocks, so two gaps can
 * never be hit at once and blocks less than 16px apart get whatever room there
 * is.
 */
function gapsIn(view: Window, doc: Document): Array<GapSpot & { after: Element; before: Element }> {
  const column = contentColumn(doc);
  if (!column) return [];

  const blocks = stampedBlocks(doc);
  const spots: Array<GapSpot & { after: Element; before: Element }> = [];

  for (let i = 0; i + 1 < blocks.length; i++) {
    const after = blocks[i];
    const before = blocks[i + 1];
    const above = toDocumentRect(view, after.getBoundingClientRect());
    const below = toDocumentRect(view, before.getBoundingClientRect());
    const room = below.y - (above.y + above.h);
    // Overlapping or touching blocks — a float, a negative margin — have no gap
    // between them to point at.
    if (room <= 0) continue;

    const y = above.y + above.h + room / 2;
    const half = Math.min(GAP_BAND, room / 2);
    spots.push({
      index: spots.length,
      x: column.x,
      w: column.w,
      y,
      top: y - half,
      bottom: y + half,
      label: gapLabel(after, before),
      after,
      before,
    });
  }
  return spots;
}

/**
 * Spec 05 §5.6.1 — where an Apply's changed lines landed, as boxes to outline.
 */
export function boxesForLinesIn(
  view: Window,
  doc: Document,
  ranges: ReadonlyArray<LineRange>,
): ScopeRect[] {
  return changedBlocks(doc, ranges).map((element) =>
    toDocumentRect(view, element.getBoundingClientRect()),
  );
}

// ── The surface: a same-origin iframe the renderer reaches into ──

export class FrameSurface implements DocumentSurface {
  private index: TextIndex | null = null;
  /** The chain the composer's chips and the path bar refer back into. */
  private chain: ScopeChain | null = null;
  /**
   * The last sweep's painted ranges, so opening a comment can recolour them
   * without resolving every thread again — and, more to the point, without
   * writing every target's state back to the database on a click.
   */
  private hits: HighlightHit[] = [];
  private readonly frame: HTMLIFrameElement;
  private readonly sourceFile: string | null;
  /**
   * Spec 16 §4.1 — the blocks a gesture may land on, or null for all of them.
   *
   * Not readonly, because the set moves whenever the working copy does — a new
   * revision, an undo, an approve, a discard — and the surface outlives all
   * four. `setLiveBlocks` is the one way in.
   */
  private liveBlocks: Element[] | null = null;
  /** The line ranges `liveBlocks` was built from, so a re-measure can repeat it. */
  private liveRanges: LineRange[] | null = null;
  /** §6.6 — this sweep's gaps, and the blocks each sits between. */
  private gapSpots: Array<GapSpot & { after: Element; before: Element }> = [];

  constructor(frame: HTMLIFrameElement, sourceFile: string | null) {
    this.frame = frame;
    this.sourceFile = sourceFile;
  }

  async resolve(
    threads: Thread[],
    documentChanged: boolean,
    openDocumentId: string,
    activeThreadId: string | null,
  ): Promise<ResolvedThread[]> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return [];
    const outcome = resolveAgainst(
      view,
      doc,
      threads,
      documentChanged,
      openDocumentId,
      activeThreadId,
    );
    this.index = outcome.index;
    this.hits = outcome.hits;
    // Both are geometry, and every reason to sweep is a reason to re-measure
    // them: a reflow, a resize, a zoom and a re-render all move them.
    this.gapSpots = gapsIn(view, doc);
    this.setLiveBlocks(this.liveRanges);
    return outcome.resolved;
  }

  setLiveBlocks(ranges: LineRange[] | null): void {
    this.liveRanges = ranges;
    const doc = this.frame.contentDocument;
    this.liveBlocks = ranges === null || !doc ? null : changedBlocks(doc, ranges);
  }

  gaps(): GapSpot[] {
    return this.gapSpots.map(({ after: _after, before: _before, ...spot }) => spot);
  }

  nearestGap(): number | null {
    const view = this.frame.contentWindow;
    if (!view || this.gapSpots.length === 0) return null;
    const middle = view.scrollY + view.innerHeight / 2;
    let best: number | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const spot of this.gapSpots) {
      const distance = Math.abs(spot.y - middle);
      if (distance < closest) {
        closest = distance;
        best = spot.index;
      }
    }
    return best;
  }

  async anchorFromGap(index: number): Promise<Selected | null> {
    const spot = this.gapSpots[index];
    if (!spot || !this.index) return null;
    const rect = { x: spot.x, y: spot.y - GAP_MARK_HEIGHT / 2, w: spot.w, h: GAP_MARK_HEIGHT };
    return {
      anchor: createGapAnchor(this.index, spot.after, spot.before, this.sourceFile),
      label: spot.label,
      rect,
      // A gap has no text at all — that is what the comment is about.
      lines: null,
      scopes: [describeGap(rect, spot.after, spot.before)],
      active: 0,
    };
  }

  async anchorFromDiagramPart(blockId: string, part: DiagramPart): Promise<Selected | null> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc || !this.index) return null;
    // `diagramOf` hands back the typed block, and only a drawn one.
    const block = diagramOf(doc.getElementById(blockId));
    if (!block || block.id !== blockId) return null;
    // §4.1 — a diagram that is not live takes no place, as the page's own pick
    // would refuse it.
    if (!isLive(this.liveBlocks, block)) return null;
    // It becomes the current chain, so widening acts on this place.
    const chain = scopeChainForPart(this.index, block, part);
    this.chain = chain;
    return anchorFromScopeIn(view, this.index, chain, 0, this.sourceFile, null);
  }

  async rectsForAnchors(items: AnchorToMeasure[]): Promise<Array<MeasuredPlace | null>> {
    const view = this.frame.contentWindow;
    if (!view || !this.index) return items.map(() => null);
    const index = this.index;
    return items.map((item) => rectForAnchorIn(view, index, item.anchor, item.kind));
  }

  clearTextSelection(): void {
    this.frame.contentWindow?.getSelection()?.removeAllRanges();
  }

  repaintActive(activeThreadId: string | null, hoveredThreadId: string | null = null): void {
    const view = this.frame.contentWindow;
    if (view) paintHighlights(view, this.hits, activeThreadId, hoveredThreadId);
  }

  async selectionMade(): Promise<Selected | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    // Spec 16 §4.1 — a selection outside every live block produces nothing,
    // silently, exactly as the many mouse-ups that select nothing already do.
    // No panel, no notice, no refusal to dismiss: what is outlined is what
    // responds, and the reviewer is looking at a pane where the live blocks are
    // already drawn in a different colour.
    const selection = view.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range && !isLive(this.liveBlocks, range.commonAncestorContainer)) return null;
    const outcome = anchorFromSelectionIn(view, this.index, this.sourceFile);
    // Only a real selection replaces the chain. This fires on EVERY mouse-up in
    // the document, and most of those select nothing — a click to dismiss a
    // highlight, a click to scroll to a link. Nulling the chain on those threw
    // away whatever pick mode had just probed, and the next click in pick mode
    // then anchored nothing at all.
    if (outcome) this.chain = outcome.chain;
    return outcome?.selected ?? null;
  }

  async probeAt(x: number, y: number, keep: number): Promise<Probe | null> {
    if (!this.index) return null;
    // §4.1 — the pick probe answers nothing outside the live blocks, so the
    // path bar never offers a scope a click cannot take.
    if (!isLive(this.liveBlocks, this.index.doc.elementFromPoint(x, y))) return null;
    const chain = scopeChainAt(this.index, x, y);
    // A probe that finds nothing does NOT throw the chain away. The overlay
    // keeps drawing the last outline in this case (see `probe` in App.tsx), so
    // nulling here left the picture and the thing that can anchor it
    // disagreeing: the reviewer saw a highlighted table, clicked six pixels
    // into its margin, and got nothing — because `anchorFromScope` had no
    // chain left to work from. Measured on 2026-08-23.
    //
    // `selectionMade` above already refuses the same trick for the same
    // reason. The two go stale together or not at all.
    if (!chain) return null;
    const active = keptIndex(this.chain, chain, keep);
    this.chain = chain;
    return { scopes: chain.scopes, active };
  }

  async anchorFromScope(index: number): Promise<Selected | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    return anchorFromScopeIn(view, this.index, this.chain, index, this.sourceFile, null);
  }

  async anchorFromRegion(index: number, box: ScopeRect): Promise<Selected | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    // §4.1 — a box dragged out of an element that is not live is not a place.
    if (!isLive(this.liveBlocks, this.chain?.elements[index] ?? null)) return null;
    return anchorFromScopeIn(view, this.index, this.chain, index, this.sourceFile, box);
  }

  async targetsFromDrawing(strokes: Stroke[], zoom: number): Promise<Drawn> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return { targets: [], strokes: [] };
    return targetsFromDrawingIn(
      view,
      doc,
      this.index,
      strokes,
      zoom,
      this.sourceFile,
      this.liveBlocks,
    );
  }

  async scopesForAnchor(anchor: Anchor, kind: SelectedKind): Promise<Probe | null> {
    if (!this.index) return null;
    const rebuilt = scopeChainForAnchor(this.index, anchor, kind);
    if (!rebuilt) return null;
    // It becomes the current chain, so widening and region-dragging both act on
    // the row the reviewer expanded rather than on the last thing hovered.
    this.chain = rebuilt.chain;
    return { scopes: rebuilt.chain.scopes, active: rebuilt.active };
  }

  async anchorFromAnchorScope(
    anchor: Anchor,
    kind: SelectedKind,
    index: number,
  ): Promise<Selected | null> {
    const view = this.frame.contentWindow;
    if (!view || !this.index) return null;
    const rebuilt = scopeChainForAnchor(this.index, anchor, kind);
    if (!rebuilt) return null;
    this.chain = rebuilt.chain;
    return anchorFromScopeIn(view, this.index, rebuilt.chain, index, this.sourceFile, null);
  }

  scrollBy(dx: number, dy: number): void {
    this.frame.contentWindow?.scrollBy(dx, dy);
  }

  scrollToAnchor(anchor: Anchor): void {
    const view = this.frame.contentWindow;
    if (!view || !this.index) return;
    scrollToAnchorIn(view, this.index, anchor);
  }

  // ── Spec 53 — following a link, and getting back ────────────

  scrollToFragment(id: string): boolean {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return false;
    // `getElementById` first, then `name`: a hand-written HTML document can
    // still carry `<a name="…">`, which is what a fragment meant before ids.
    const target =
      doc.getElementById(id) ?? doc.querySelector(`a[name="${CSS.escape(id)}"]`) ?? null;
    if (!target) return false;
    bringIntoView(view, target.getBoundingClientRect());
    return true;
  }

  scrollToPlace(place: DocumentPlace): void {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return;

    const block = place.line === null ? null : blockAtOrAbove(doc, place.line);
    if (block) {
      bringIntoView(view, block.getBoundingClientRect());
      return;
    }
    // §4.4 — the fallback, for a format that stamps no line at all. `zoom`
    // takes part in layout, so an offset read at 1.5 is 1.5× the same place at
    // 1 and has to be rescaled when the reviewer changed the zoom in between.
    const scale = place.zoom === 0 ? 1 : zoomOf(doc) / place.zoom;
    view.scrollTo({ top: place.scrollY * scale, behavior: "smooth" });
  }

  placeHere(): DocumentPlace | null {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc || !this.sourceFile) return null;
    return {
      path: this.sourceFile,
      line: topVisibleLine(doc),
      scrollY: view.scrollY,
      zoom: zoomOf(doc),
    };
  }

  async boxesForLines(ranges: LineRange[]): Promise<ScopeRect[]> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return [];
    return boxesForLinesIn(view, doc, ranges);
  }

  // ── Spec 28 — find ──────────────────────────────────────────

  /** The matches of the last `find`, as live ranges and as offsets. */
  private findRanges: Range[] = [];
  private findPositions: TextPosition[] = [];

  find(query: string): FindOutcome {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    const none: FindOutcome = { count: 0, capped: false, nearest: 0, marks: [] };
    if (!view || !doc || !this.index) {
      this.findRanges = [];
      this.findPositions = [];
      return none;
    }
    const index = this.index;
    const { matches, capped } = findMatches(index.text, query, MAX_PAGE_MATCHES);
    const ranges: Range[] = [];
    const positions: TextPosition[] = [];
    for (const position of matches) {
      const range = offsetsToRange(index, position);
      if (!range) continue;
      ranges.push(range);
      positions.push(position);
    }
    this.findRanges = ranges;
    this.findPositions = positions;
    paintFind(view, ranges, -1);

    // Measured once against the whole document's height, in the same
    // coordinate space `getBoundingClientRect` reports the ranges in — which
    // under CSS `zoom` is the scaled one, consistently (see `applyZoom`).
    const root = doc.documentElement.getBoundingClientRect();
    const total = Math.max(root.height, view.innerHeight, 1);
    const marks: FindMark[] = [];
    let nearest = -1;
    ranges.forEach((range, at) => {
      const box = range.getBoundingClientRect();
      marks.push({ top: (box.top + view.scrollY) / total, height: box.height / total });
      if (nearest === -1 && box.bottom >= 0) nearest = at;
    });
    return { count: ranges.length, capped, nearest: Math.max(nearest, 0), marks };
  }

  findShow(ordinal: number, reveal: boolean): void {
    const view = this.frame.contentWindow;
    const range = this.findRanges[ordinal];
    if (!view || !range) return;
    paintFind(view, this.findRanges, ordinal);
    if (!reveal) return;
    const box = range.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= view.innerHeight) return;
    // A third of the way down, as `scrollToAnchorIn` does: a match pinned to
    // the top edge reads as if its context had been cut off.
    view.scrollTo({ top: box.top + view.scrollY - view.innerHeight / 3, behavior: "smooth" });
  }

  findContext(ordinal: number): SearchContext | null {
    const position = this.findPositions[ordinal];
    if (!position || !this.index) return null;
    return contextOf(this.index.text, position);
  }

  findClear(): void {
    this.findRanges = [];
    this.findPositions = [];
    const view = this.frame.contentWindow;
    if (view) clearFind(view);
  }

  selectedText(): string {
    return this.frame.contentWindow?.getSelection()?.toString() ?? "";
  }
}

/**
 * §3.3 — bring an anchor into view, without touching the document's own tree.
 */
/**
 * Spec 53 §4.4 — REX's one rule for bringing a place into view.
 *
 * A third of the way down and not at the top edge, which is what
 * `scrollToAnchorIn` has always done and for the reason written there: a
 * passage pinned to the top reads as if its context has been cut off. The
 * reviewer asked for "the middle of the screen" and meant the same thing. Two
 * conventions in one app would read as a bug, so there is one, and it is this
 * function.
 */
function bringIntoView(view: Window, rect: DOMRect): void {
  view.scrollTo({ top: rect.top + view.scrollY - view.innerHeight / 3, behavior: "smooth" });
}

/**
 * The block a source line falls in, or the nearest one above it.
 *
 * `data-src-line` marks where a block *starts* (§5.3), so a line in the middle
 * of a paragraph has no element of its own and an exact lookup would answer
 * nothing for most lines in the file.
 */
function blockAtOrAbove(doc: Document, line: number): Element | null {
  let best: Element | null = null;
  let bestLine = Number.NEGATIVE_INFINITY;
  for (const element of doc.querySelectorAll("[data-src-line]")) {
    const at = Number.parseInt(element.getAttribute("data-src-line") ?? "", 10);
    if (!Number.isFinite(at) || at > line || at <= bestLine) continue;
    best = element;
    bestLine = at;
  }
  return best;
}

/**
 * The source line of the first block on screen, for a departure with no click
 * to ask (§5.4 rule 2).
 */
function topVisibleLine(doc: Document): number | null {
  for (const element of doc.querySelectorAll("[data-src-line]")) {
    if (element.getBoundingClientRect().bottom < 0) continue;
    const at = Number.parseInt(element.getAttribute("data-src-line") ?? "", 10);
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/** What `applyZoom` last set on this page. */
function zoomOf(doc: Document): number {
  const zoom = Number.parseFloat(doc.documentElement.style.zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function scrollToAnchorIn(view: Window, index: TextIndex, anchor: Anchor): void {
  const resolution = resolveAnchor(index, anchor);
  if (!resolution) return;
  // Spec 16 §6.5 — a gap is brought into view by whichever neighbour it found,
  // preferring the block above so the reviewer sees what it comes after.
  const target =
    resolution.kind === "gap"
      ? (resolution.after ?? resolution.before)
      : resolution.kind === "run"
        ? // A run is brought into view by its *start*: scrolling to the middle
          // of a four-thousand-character section shows the reviewer neither end
          // of what their comment is about.
          resolution.first
        : resolution.kind === "element"
          ? resolution.element
          : null;
  if (resolution.kind !== "range" && !target) return;
  const rect =
    resolution.kind === "range"
      ? resolution.range.getBoundingClientRect()
      : (target as Element).getBoundingClientRect();
  bringIntoView(view, rect);
}
