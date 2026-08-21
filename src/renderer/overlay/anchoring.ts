// The glue between the anchor resolver (§6) and the overlay (§7).
//
// Two tiers, one interface. Tier 1 renders into a same-origin iframe whose DOM
// the renderer can touch directly. Tier 2 is a <webview>, a separate process
// whose DOM it cannot — so the same resolver runs *inside* it, loaded by a
// preload, and only serialisable results come back. Invariant I1 holds either
// way: resolution happens in a renderer, on the live DOM, never in main.
//
// Not in §3.1's tree — the files it lists are the resolver itself, which stays
// free of anything React or IPC shaped.

import { worstState } from "../../shared/targets.ts";
import type { Anchor, AnchorState, LineRange, Thread } from "../../shared/types.ts";
import {
  createDocumentAnchor,
  createElementAnchor,
  createRegionAnchor,
  createSectionAnchor,
  createTextAnchor,
} from "../anchor/create.ts";
import { type HighlightHit, paintHighlights } from "../anchor/highlight.ts";
import {
  blocksInDrawing,
  boundsOf,
  containerOfDrawing,
  polygonOf,
  type Stroke,
} from "../anchor/lasso.ts";
import {
  changedBlocks,
  describeElement,
  type PickScope,
  rectOfRun,
  type ScopeChain,
  type ScopeRect,
  scopeChainAt,
  scopeChainForAnchor,
  scopeChainForElement,
  scopeChainForRange,
  toDocumentRect,
  unionRect,
} from "../anchor/pick.ts";
import { anchorStateFor, type Resolution, resolveAnchor } from "../anchor/resolve.ts";
import { headingTextOf } from "../anchor/section.ts";
import { buildTextIndex, rangeToOffsets, type TextIndex } from "../anchor/textIndex.ts";

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
   * 4 columns`. Only for anchors with no quote of their own, where the card
   * would otherwise have a blank line where the quote goes.
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
  rectsForAnchors(items: AnchorToMeasure[]): Promise<Array<ScopeRect | null>>;

  /**
   * §3.4 — the document's own text selection, dropped.
   *
   * Ask empties the panel, but the browser's selection is not the panel's and
   * survived it: the passage stayed blue in the document with nothing left in
   * REX that was about it.
   */
  clearTextSelection(): void;

  /** §6 — repaints the passages, with `activeThreadId`'s in the open colour. */
  repaintActive(activeThreadId: string | null): void;

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

  /** §5.6.1 — the boxes to outline after an Apply, from `data-src-line`. */
  boxesForLines(ranges: LineRange[]): Promise<ScopeRect[]>;
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

/**
 * SPEC.md §6.5 and §6.6 — resolve every thread against a live DOM, then paint.
 * Shared by both surfaces: the webview preload calls exactly this function.
 */
export function resolveAgainst(
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

      if (resolution?.kind === "range") {
        hits.push({ threadId: thread.id, range: resolution.range, status: thread.status, state });
        checked.push({ position, state, box: null });
        widen(toDocumentRect(view, resolution.range.getBoundingClientRect()));
        if (first) top = documentTop(resolution.range.getBoundingClientRect(), view);
      } else if (resolution?.kind === "element") {
        const outline = toDocumentRect(view, resolution.element.getBoundingClientRect());
        const box = anchor.region ? regionWithin(outline, anchor) : outline;
        checked.push({ position, state, box });
        widen(box);
        if (first) {
          top = box.y;
          label = describeResolved(index, resolution, anchor);
        }
      } else if (resolution?.kind === "run") {
        // Spec 06 §6.4 — a run is outlined, never filled, around the union of
        // its ends. A document target draws nothing at all: an outline round
        // the whole file is a rectangle whose two edges are never on screen
        // together, it would lie over every other mark, and it teaches nothing.
        // Its gutter marker at the top of the document is where it belongs.
        const whole = resolution.extent === "document";
        const box = rectOfRun(resolution);
        checked.push({ position, state, box: whole ? null : box });
        // A document target is left out of the union for the same reason it
        // draws no box: it would stretch the ink over the whole file.
        if (!whole) widen(box);
        if (first) {
          top = whole ? 0 : box.y;
          label = describeResolved(index, resolution, anchor);
        }
      } else {
        // Orphaned: nothing to paint and nowhere to draw it, but the target is
        // still checked and still has to be restated.
        checked.push({ position, state, box: null });
      }
    }

    // A thread with nothing checked here keeps its row and its card. Dropping
    // it would cost it the state an earlier visit found (§5.4).
    resolved.push({
      threadId: thread.id,
      state: worstState(checked.map((entry) => entry.state)),
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
export function rectForAnchorIn(
  view: Window,
  index: TextIndex,
  anchor: Anchor,
  kind: SelectedKind,
): ScopeRect | null {
  const probe = kind === "element" && !anchor.extent ? { ...anchor, quote: null } : anchor;
  const resolution = resolveAnchor(index, probe);
  if (!resolution) return null;
  if (resolution.kind === "range") {
    return toDocumentRect(view, resolution.range.getBoundingClientRect());
  }
  if (resolution.kind === "run") {
    // §6.4 again — the whole file has no box a reviewer could read.
    return resolution.extent === "document" ? null : rectOfRun(resolution);
  }
  const outline = toDocumentRect(view, resolution.element.getBoundingClientRect());
  return anchor.region ? regionWithin(outline, anchor) : outline;
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
 * A one-line name for a resolved block anchor, so a card with no quote has
 * something true to show rather than a blank line or an invented description.
 *
 * A run always gets one, quote or no quote. A section anchor stores its
 * heading's text (§4.3), and showing that as the card's blockquote would claim
 * the comment is about eight words when it is about everything under them.
 */
function describeResolved(index: TextIndex, resolution: Resolution, anchor: Anchor): string | null {
  if (resolution.kind === "run") {
    return resolution.extent === "document"
      ? "The whole document"
      : `Section · “${headingTextOf(resolution.first)}”`;
  }
  if (resolution.kind === "range" || anchor.quote?.exact) return null;
  const { title } = describeElement(index, resolution.element);
  const region = anchor.region;
  if (!region) return title;
  return `Region of ${title} · x ${region.x.toFixed(2)} · w ${region.w.toFixed(2)}`;
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
export function anchorFromSelectionIn(
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
export function anchorFromScopeIn(
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

  const made = (anchor: Anchor, rect: ScopeRect | null, cut: boolean): Selected => ({
    anchor,
    label: labelFor(scope, cut),
    rect,
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
    return made(anchor, scope.rect, false);
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
 *
 * Shared by both surfaces, like `resolveAgainst`: in tier 2 the work has to
 * happen inside the webview's own process, which is why `lasso.ts` is pure DOM.
 */
export function targetsFromDrawingIn(
  view: Window,
  doc: Document,
  index: TextIndex | null,
  strokes: ReadonlyArray<Stroke>,
  zoom: number,
  sourceFile: string | null,
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
      scopes: chain.scopes,
      active: 0,
    };
  };

  const blocks = blocksInDrawing(view, doc, scaled);
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

  const box = toDocumentRect(view, container.getBoundingClientRect());
  const anchor = createRegionAnchor(
    index,
    container,
    { x: bounds.x - box.x, y: bounds.y - box.y, w: bounds.w, h: bounds.h },
    sourceFile,
  );
  return { targets: [made(container, anchor, bounds, true)], strokes: scaled };
}

/**
 * Spec 05 §5.6.1 — where an Apply's changed lines landed, as boxes to outline.
 *
 * Shared by both surfaces for the same reason `resolveAgainst` is: the work is
 * DOM work, and in tier 2 it has to happen inside the webview's own process.
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

// ── Tier 1: a same-origin iframe the renderer can reach into ────

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
    return outcome.resolved;
  }

  async rectsForAnchors(items: AnchorToMeasure[]): Promise<Array<ScopeRect | null>> {
    const view = this.frame.contentWindow;
    if (!view || !this.index) return items.map(() => null);
    const index = this.index;
    return items.map((item) => rectForAnchorIn(view, index, item.anchor, item.kind));
  }

  clearTextSelection(): void {
    this.frame.contentWindow?.getSelection()?.removeAllRanges();
  }

  repaintActive(activeThreadId: string | null): void {
    const view = this.frame.contentWindow;
    if (view) paintHighlights(view, this.hits, activeThreadId);
  }

  async selectionMade(): Promise<Selected | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    const outcome = anchorFromSelectionIn(view, this.index, this.sourceFile);
    this.chain = outcome?.chain ?? null;
    return outcome?.selected ?? null;
  }

  async probeAt(x: number, y: number, keep: number): Promise<Probe | null> {
    if (!this.index) return null;
    const chain = scopeChainAt(this.index, x, y);
    if (!chain) {
      this.chain = null;
      return null;
    }
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
    return anchorFromScopeIn(view, this.index, this.chain, index, this.sourceFile, box);
  }

  async targetsFromDrawing(strokes: Stroke[], zoom: number): Promise<Drawn> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return { targets: [], strokes: [] };
    return targetsFromDrawingIn(view, doc, this.index, strokes, zoom, this.sourceFile);
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

  async boxesForLines(ranges: LineRange[]): Promise<ScopeRect[]> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return [];
    return boxesForLinesIn(view, doc, ranges);
  }
}

/**
 * §3.3 — bring an anchor into view, without touching the document's own tree.
 *
 * Exported because the tier 2 preload needs exactly this, and a second copy of
 * it there is a second place for the run case to be forgotten.
 */
export function scrollToAnchorIn(view: Window, index: TextIndex, anchor: Anchor): void {
  const resolution = resolveAnchor(index, anchor);
  if (!resolution) return;
  const rect =
    resolution.kind === "range"
      ? resolution.range.getBoundingClientRect()
      : // A run is brought into view by its *start*: scrolling to the middle of
        // a four-thousand-character section shows the reviewer neither end of
        // what their comment is about.
        (resolution.kind === "run" ? resolution.first : resolution.element).getBoundingClientRect();
  // A third of the way down rather than at the very top: a passage pinned to
  // the top edge reads as if its context has been cut off.
  view.scrollTo({ top: rect.top + view.scrollY - view.innerHeight / 3, behavior: "smooth" });
}

// ── Tier 2: a <webview>, driven through its preload ─────────────

/** The subset of Electron's <webview> element this file uses. */
export interface WebviewElement extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>;
}

export class WebviewSurface implements DocumentSurface {
  private readonly webview: WebviewElement;

  constructor(webview: WebviewElement) {
    this.webview = webview;
  }

  private async call<T>(method: string, args: unknown[]): Promise<T | null> {
    const call = `window.__rexAnchor && window.__rexAnchor.${method}(${args
      .map((argument) => JSON.stringify(argument))
      .join(", ")})`;
    const raw = await this.webview.executeJavaScript(call);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  }

  async resolve(
    threads: Thread[],
    documentChanged: boolean,
    openDocumentId: string,
    activeThreadId: string | null,
  ): Promise<ResolvedThread[]> {
    const result = await this.call<ResolvedThread[]>("resolveAll", [
      JSON.stringify(threads),
      documentChanged,
      openDocumentId,
      activeThreadId,
    ]);
    return result ?? [];
  }

  async rectsForAnchors(items: AnchorToMeasure[]): Promise<Array<ScopeRect | null>> {
    const result = await this.call<Array<ScopeRect | null>>("rectsForAnchors", [
      JSON.stringify(items),
    ]);
    return result ?? items.map(() => null);
  }

  clearTextSelection(): void {
    void this.webview.executeJavaScript(
      "window.getSelection() && getSelection().removeAllRanges()",
    );
  }

  repaintActive(activeThreadId: string | null): void {
    void this.webview.executeJavaScript(
      `window.__rexAnchor && window.__rexAnchor.repaintActive(${JSON.stringify(activeThreadId)})`,
    );
  }

  async selectionMade(): Promise<Selected | null> {
    // A remote page has no local source file, so `Anchor.source` stays null and
    // Apply is disabled for it (§5.2).
    return await this.call<Selected>("createFromSelection", []);
  }

  async probeAt(x: number, y: number, keep: number): Promise<Probe | null> {
    return await this.call<Probe>("probeAt", [x, y, keep]);
  }

  async anchorFromScope(index: number): Promise<Selected | null> {
    return await this.call<Selected>("anchorFromScope", [index]);
  }

  async anchorFromRegion(index: number, box: ScopeRect): Promise<Selected | null> {
    return await this.call<Selected>("anchorFromRegion", [index, box]);
  }

  /**
   * Spec 06 §11 — the pen is not offered on a remote page in this milestone
   * set, so nothing calls this here. It exists because `lasso.ts` was written to
   * run in the preload, which is what keeps tier 2 possible later; the bridge
   * being in place is the difference between "possible" and "a rewrite".
   */
  async targetsFromDrawing(strokes: Stroke[], zoom: number): Promise<Drawn> {
    const result = await this.call<Drawn>("targetsFromDrawing", [JSON.stringify(strokes), zoom]);
    return result ?? { targets: [], strokes: [] };
  }

  async scopesForAnchor(anchor: Anchor, kind: SelectedKind): Promise<Probe | null> {
    return await this.call<Probe>("scopesForAnchor", [JSON.stringify(anchor), kind]);
  }

  async anchorFromAnchorScope(
    anchor: Anchor,
    kind: SelectedKind,
    index: number,
  ): Promise<Selected | null> {
    return await this.call<Selected>("anchorFromAnchorScope", [
      JSON.stringify(anchor),
      kind,
      index,
    ]);
  }

  scrollBy(dx: number, dy: number): void {
    void this.webview.executeJavaScript(`window.scrollBy(${dx}, ${dy})`);
  }

  scrollToAnchor(anchor: Anchor): void {
    void this.webview.executeJavaScript(
      `window.__rexAnchor && window.__rexAnchor.scrollToAnchor(${JSON.stringify(JSON.stringify(anchor))})`,
    );
  }

  async boxesForLines(_ranges: LineRange[]): Promise<ScopeRect[]> {
    // A remote page has no local source file, so Apply never edits one and
    // there is nothing here that could have changed (§5.2).
    return [];
  }
}
