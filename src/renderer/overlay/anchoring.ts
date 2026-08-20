// The glue between the anchor resolver (§6) and the overlay (§7).
//
// Two tiers, one interface. Tier 1 renders into a same-origin iframe whose DOM
// the renderer can touch directly. Tier 2 is a <webview>, a separate process
// whose DOM it cannot — so the same resolver runs *inside* it, loaded by a
// preload, and only serialisable results come back. Invariant I1 holds either
// way: resolution happens in a renderer, on the live DOM, never in main.
//
// Not in §3.1's tree — the four files it lists are the resolver itself, which
// stays free of anything React or IPC shaped.

import type { Anchor, AnchorState, Thread } from "../../shared/types.ts";
import { createTextAnchor } from "../anchor/create.ts";
import { type HighlightHit, paintHighlights } from "../anchor/highlight.ts";
import { anchorStateFor, resolveAnchor } from "../anchor/resolve.ts";
import { buildTextIndex, rangeToOffsets, type TextIndex } from "../anchor/textIndex.ts";

export interface ResolvedThread {
  threadId: string;
  state: AnchorState;
  /** Offset from the top of the document content, or null when orphaned. */
  top: number | null;
}

export interface DraftAnchor {
  anchor: Anchor;
  top: number;
}

/** What the overlay needs from whichever surface is showing the document. */
export interface DocumentSurface {
  resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]>;
  anchorFromSelection(): Promise<DraftAnchor | null>;
}

function documentTop(range: Range, view: Window): number {
  return range.getBoundingClientRect().top + view.scrollY;
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

    let range: Range | null = null;
    if (resolution?.kind === "range") {
      range = resolution.range;
    } else if (resolution?.kind === "element") {
      range = doc.createRange();
      range.selectNode(resolution.element);
    }

    if (range) hits.push({ range, status: thread.status });
    resolved.push({
      threadId: thread.id,
      state: anchorStateFor(resolution, documentChanged),
      top: range ? documentTop(range, view) : null,
    });
  }

  paintHighlights(view, hits);
  return { index, resolved };
}

/** SPEC.md §6.4 — the user's selection becomes an anchor, or nothing. */
export function anchorFromSelectionIn(
  view: Window,
  index: TextIndex | null,
  sourceFile: string | null,
): DraftAnchor | null {
  if (!index) return null;
  const selection = view.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!rangeToOffsets(index, range)) return null;

  const anchor = createTextAnchor(index, range, sourceFile);
  return anchor ? { anchor, top: documentTop(range, view) } : null;
}

// ── Tier 1: a same-origin iframe the renderer can reach into ────

export class FrameSurface implements DocumentSurface {
  private index: TextIndex | null = null;
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
    return view ? anchorFromSelectionIn(view, this.index, this.sourceFile) : null;
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

  private async call(method: string, args: unknown[]): Promise<unknown> {
    const call = `window.__rexAnchor && window.__rexAnchor.${method}(${args
      .map((argument) => JSON.stringify(argument))
      .join(", ")})`;
    const raw = await this.webview.executeJavaScript(call);
    return typeof raw === "string" ? JSON.parse(raw) : null;
  }

  async resolve(threads: Thread[], documentChanged: boolean): Promise<ResolvedThread[]> {
    const result = await this.call("resolveAll", [JSON.stringify(threads), documentChanged]);
    return (result as ResolvedThread[] | null) ?? [];
  }

  async anchorFromSelection(): Promise<DraftAnchor | null> {
    // A remote page has no local source file, so `Anchor.source` stays null and
    // Apply is disabled for it (§5.2).
    return (await this.call("createFromSelection", [])) as DraftAnchor | null;
  }
}
