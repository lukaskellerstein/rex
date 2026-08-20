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
  state: AnchorState;
  /** Offset from the top of the document content, or null when orphaned. */
  top: number | null;
  /**
   * The box to outline, for an anchor on a whole element or a region of one.
   * Null for a text anchor: the Custom Highlight API paints ranges, so a text
   * anchor is a fill and a block anchor is an outline (design/selection/Kinds).
   */
  box: ScopeRect | null;
  /**
   * What the anchor turned out to point at — `Table · 3 rows × 4 columns`.
   * Only for anchors with no quote of their own, where the card would otherwise
   * have a blank line where the quote goes.
   */
  label: string | null;
}

export interface DraftAnchor {
  anchor: Anchor;
  top: number;
  /** The chain the reviewer can widen through — the composer's chips. */
  scopes: PickScope[];
  /** Which of them produced `anchor`. */
  active: number;
}

/** What the overlay needs from whichever surface is showing the document. */
export interface DocumentSurface {
  resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]>;
  /** A text selection becomes a draft, with its enclosing structure offered. */
  anchorFromSelection(): Promise<DraftAnchor | null>;
  /** design/selection/Hover — what sits under the cursor, and what encloses it. */
  probeAt(x: number, y: number): Promise<PickScope[] | null>;
  /** Re-anchors the current draft to another scope in the same chain. */
  anchorFromScope(index: number): Promise<DraftAnchor | null>;
  /** design/selection/Region — a dragged box, in document coordinates. */
  anchorFromRegion(index: number, box: ScopeRect): Promise<DraftAnchor | null>;
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
    const resolution = resolveAnchor(index, thread.anchor);
    const state = anchorStateFor(resolution, documentChanged);

    let top: number | null = null;
    let box: ScopeRect | null = null;
    let label: string | null = null;

    if (resolution?.kind === "range") {
      hits.push({ range: resolution.range, status: thread.status, state });
      top = documentTop(resolution.range.getBoundingClientRect(), view);
    } else if (resolution?.kind === "element") {
      const rect = resolution.element.getBoundingClientRect();
      const outline = toDocumentRect(view, rect);
      box = thread.anchor.region ? regionWithin(outline, thread.anchor) : outline;
      top = box.y;
      label = describeResolved(index, resolution.element, thread.anchor);
    }

    resolved.push({ threadId: thread.id, state, top, box, label });
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

  const anchor = createTextAnchor(index, range, sourceFile);
  if (!anchor) return null;

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
    const anchor = createTextAnchor(index, chain.range, sourceFile);
    if (!anchor) return null;
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

  async probeAt(x: number, y: number): Promise<PickScope[] | null> {
    if (!this.index) return null;
    const chain = scopeChainAt(this.index, x, y);
    this.chain = chain;
    return chain?.scopes ?? null;
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

  async probeAt(x: number, y: number): Promise<PickScope[] | null> {
    return await this.call<PickScope[]>("probeAt", [x, y]);
  }

  async anchorFromScope(index: number): Promise<DraftAnchor | null> {
    return await this.call<DraftAnchor>("anchorFromScope", [index]);
  }

  async anchorFromRegion(index: number, box: ScopeRect): Promise<DraftAnchor | null> {
    return await this.call<DraftAnchor>("anchorFromRegion", [index, box]);
  }
}
