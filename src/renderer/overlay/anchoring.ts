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

import type { Anchor, AnchorState, Thread } from "../../shared/types.ts";
import { createElementAnchor, createRegionAnchor, createTextAnchor } from "../anchor/create.ts";
import { type HighlightHit, paintHighlights } from "../anchor/highlight.ts";
import {
  describeElement,
  type PickScope,
  type ScopeChain,
  type ScopeRect,
  scopeChainAt,
  scopeChainForRange,
  toDocumentRect,
} from "../anchor/pick.ts";
import { anchorStateFor, resolveAnchor } from "../anchor/resolve.ts";
import { buildTextIndex, rangeToOffsets, type TextIndex } from "../anchor/textIndex.ts";

export interface ResolvedThread {
  threadId: string;
  /** The worst state across every anchor the thread has. */
  state: AnchorState;
  /** Offset from the top of the document content, or null when orphaned. */
  top: number | null;
  /**
   * The boxes to outline — one per anchor on a whole element or a region of
   * one. Empty for a text anchor: the Custom Highlight API paints ranges, so a
   * text anchor is a fill and a block anchor is an outline
   * (design/selection/Kinds).
   */
  boxes: ScopeRect[];
  /**
   * What the anchor turned out to point at — `Table · 3 rows × 4 columns`.
   * Only for anchors with no quote of their own, where the card would otherwise
   * have a blank line where the quote goes.
   */
  label: string | null;
}

/** `orphaned` beats `moved` beats `ok` — a thread is only as good as its worst anchor. */
const STATE_RANK: Record<AnchorState, number> = { ok: 0, moved: 1, orphaned: 2 };

function worse(a: AnchorState, b: AnchorState): AnchorState {
  return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}

export interface DraftAnchor {
  anchor: Anchor;
  top: number;
  /** The chain the reviewer can widen through — the composer's chips. */
  scopes: PickScope[];
  /** Which of them produced `anchor`. */
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

/** What the overlay needs from whichever surface is showing the document. */
export interface DocumentSurface {
  resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]>;
  /** A text selection becomes a draft, with its enclosing structure offered. */
  anchorFromSelection(): Promise<DraftAnchor | null>;
  /**
   * design/selection/Hover — what sits under the cursor, and what encloses it.
   *
   * `keep` is the scope the reviewer had chosen in the previous chain, so that
   * widening survives the pointer moving.
   */
  probeAt(x: number, y: number, keep: number): Promise<Probe | null>;
  /** Re-anchors the current draft to another scope in the same chain. */
  anchorFromScope(index: number): Promise<DraftAnchor | null>;
  /** design/selection/Region — a dragged box, in document coordinates. */
  anchorFromRegion(index: number, box: ScopeRect): Promise<DraftAnchor | null>;
  /** Scrolls the document itself — the pick layer covers it and eats the wheel. */
  scrollBy(dx: number, dy: number): void;
}

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
 */
function keptIndex(previous: ScopeChain | null, next: ScopeChain, keep: number): number {
  const chosen = previous?.elements[keep] ?? null;
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
): { index: TextIndex; resolved: ResolvedThread[] } {
  const index = buildTextIndex(doc);
  const hits: HighlightHit[] = [];
  const resolved: ResolvedThread[] = [];

  for (const thread of threads) {
    if (!thread.anchor) continue;

    // The primary anchor first: it is what the gutter marker sits beside and
    // what the card quotes, so `top` and `label` come from it alone.
    let top: number | null = null;
    let label: string | null = null;
    const boxes: ScopeRect[] = [];
    let state: AnchorState = "ok";

    // `extraAnchors` may be missing on a thread that crossed the bridge from an
    // older build, so it is read defensively rather than trusted.
    for (const [position, anchor] of [thread.anchor, ...(thread.extraAnchors ?? [])].entries()) {
      const resolution = resolveAnchor(index, anchor);
      const anchorState = anchorStateFor(resolution, documentChanged);
      state = position === 0 ? anchorState : worse(state, anchorState);

      if (resolution?.kind === "range") {
        hits.push({ range: resolution.range, status: thread.status, state: anchorState });
        if (position === 0) top = documentTop(resolution.range.getBoundingClientRect(), view);
      } else if (resolution?.kind === "element") {
        const outline = toDocumentRect(view, resolution.element.getBoundingClientRect());
        const box = anchor.region ? regionWithin(outline, anchor) : outline;
        boxes.push(box);
        if (position === 0) {
          top = box.y;
          label = describeResolved(index, resolution.element, anchor);
        }
      }
    }

    resolved.push({ threadId: thread.id, state, top, boxes, label });
  }

  paintHighlights(view, hits);
  return { index, resolved };
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
 */
function describeResolved(index: TextIndex, element: Element, anchor: Anchor): string | null {
  if (anchor.quote?.exact) return null;
  const { title } = describeElement(index, element);
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

/** SPEC.md §6.4 — the user's selection becomes an anchor, or nothing. */
export function anchorFromSelectionIn(
  view: Window,
  index: TextIndex | null,
  sourceFile: string | null,
): { draft: DraftAnchor; chain: ScopeChain } | null {
  if (!index) return null;
  const selection = view.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
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
    draft: {
      anchor,
      top: documentTop(range.getBoundingClientRect(), view),
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
): DraftAnchor | null {
  if (!index || !chain) return null;
  const scope = chain.scopes[scopeIndex];
  if (!scope) return null;

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
    return { anchor, top: scope.rect.y, scopes: chain.scopes, active: scopeIndex };
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
    return { anchor, top: region.y, scopes: chain.scopes, active: scopeIndex };
  }

  // §7.3 again: widening to anything inside a PDF still resolves through the
  // page, so an element anchor there is a region covering what was picked.
  const page = pdfPageOf(element);
  if (page) {
    const anchor = pdfRegionAnchor(view, index, page, scope.rect, null, sourceFile);
    return { anchor, top: scope.rect.y, scopes: chain.scopes, active: scopeIndex };
  }

  return {
    anchor: createElementAnchor(index, element, sourceFile),
    top: scope.rect.y,
    scopes: chain.scopes,
    active: scopeIndex,
  };
}

// ── Tier 1: a same-origin iframe the renderer can reach into ────

export class FrameSurface implements DocumentSurface {
  private index: TextIndex | null = null;
  /** The chain the composer's chips and the path bar refer back into. */
  private chain: ScopeChain | null = null;
  private readonly frame: HTMLIFrameElement;
  private readonly sourceFile: string | null;

  constructor(frame: HTMLIFrameElement, sourceFile: string | null) {
    this.frame = frame;
    this.sourceFile = sourceFile;
  }

  async resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]> {
    const view = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!view || !doc) return [];
    const outcome = resolveAgainst(view, doc, threads, documentChanged);
    this.index = outcome.index;
    return outcome.resolved;
  }

  async anchorFromSelection(): Promise<DraftAnchor | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    const outcome = anchorFromSelectionIn(view, this.index, this.sourceFile);
    this.chain = outcome?.chain ?? null;
    return outcome?.draft ?? null;
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

  async anchorFromScope(index: number): Promise<DraftAnchor | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    return anchorFromScopeIn(view, this.index, this.chain, index, this.sourceFile, null);
  }

  async anchorFromRegion(index: number, box: ScopeRect): Promise<DraftAnchor | null> {
    const view = this.frame.contentWindow;
    if (!view) return null;
    return anchorFromScopeIn(view, this.index, this.chain, index, this.sourceFile, box);
  }

  scrollBy(dx: number, dy: number): void {
    this.frame.contentWindow?.scrollBy(dx, dy);
  }
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

  async resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]> {
    const result = await this.call<ResolvedThread[]>("resolveAll", [
      JSON.stringify(threads),
      documentChanged,
    ]);
    return result ?? [];
  }

  async anchorFromSelection(): Promise<DraftAnchor | null> {
    // A remote page has no local source file, so `Anchor.source` stays null and
    // Apply is disabled for it (§5.2).
    return await this.call<DraftAnchor>("createFromSelection", []);
  }

  async probeAt(x: number, y: number, keep: number): Promise<Probe | null> {
    return await this.call<Probe>("probeAt", [x, y, keep]);
  }

  async anchorFromScope(index: number): Promise<DraftAnchor | null> {
    return await this.call<DraftAnchor>("anchorFromScope", [index]);
  }

  async anchorFromRegion(index: number, box: ScopeRect): Promise<DraftAnchor | null> {
    return await this.call<DraftAnchor>("anchorFromRegion", [index, box]);
  }

  scrollBy(dx: number, dy: number): void {
    void this.webview.executeJavaScript(`window.scrollBy(${dx}, ${dy})`);
  }
}
