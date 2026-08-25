// The tier 2 preload (SPEC.md §5.2, milestone 7).
//
// A <webview> is a separate process, so the renderer cannot reach its DOM.
// Invariant I1 says the resolver runs on the live DOM, which means it has to
// run *here*. Only serialisable results cross back — a Range cannot survive
// the context bridge, and the caller only ever needed offsets and states.
//
// The picking layer is here for the same reason: hit-testing a point and
// walking its ancestors is DOM work, so the renderer sends coordinates and gets
// back descriptions. The live elements never leave this process.

import { contextBridge, ipcRenderer } from "electron";
import { type HighlightHit, paintHighlights } from "../renderer/anchor/highlight.ts";
import type { Stroke } from "../renderer/anchor/lasso.ts";
import {
  type ScopeChain,
  type ScopeRect,
  scopeChainAt,
  scopeChainForAnchor,
} from "../renderer/anchor/pick.ts";
import type { TextIndex } from "../renderer/anchor/textIndex.ts";
import {
  type AnchorToMeasure,
  anchorFromScopeIn,
  anchorFromSelectionIn,
  rectForAnchorIn,
  resolveAgainst,
  scrollToAnchorIn,
  targetsFromDrawingIn,
} from "../renderer/overlay/anchoring.ts";
import type { ForwardedKey, GUEST_EVENT } from "../shared/channels.ts";
import type { Anchor, Thread } from "../shared/types.ts";

let index: TextIndex | null = null;
/** The chain the renderer's chips and path bar refer back into, by position. */
let chain: ScopeChain | null = null;
/** The last sweep's ranges — see FrameSurface's own note beside `hits`. */
let hits: HighlightHit[] = [];

/** A remote page has no local source file, so `Anchor.source` stays null (§5.2). */
const NO_SOURCE = null;

/**
 * Spec 05 §4.1 — the chain for an anchor already in the panel, and which of it
 * the anchor already is (spec 06 §4.1 — for a section that is not scope 0).
 */
function chainForAnchor(
  anchorJson: string,
  kind: "text" | "element",
): { chain: ScopeChain; active: number } | null {
  if (!index) return null;
  const rebuilt = scopeChainForAnchor(index, JSON.parse(anchorJson) as Anchor, kind);
  if (rebuilt) chain = rebuilt.chain;
  return rebuilt;
}

contextBridge.exposeInMainWorld("__rexAnchor", {
  /** JSON in, JSON out — the bridge clones structured data, not class instances. */
  resolveAll(
    threadsJson: string,
    documentChanged: boolean,
    openDocumentId: string,
    activeThreadId: string | null,
  ): string {
    const threads = JSON.parse(threadsJson) as Thread[];
    const outcome = resolveAgainst(
      window,
      document,
      threads,
      documentChanged,
      openDocumentId,
      activeThreadId,
    );
    index = outcome.index;
    hits = outcome.hits;
    return JSON.stringify(outcome.resolved);
  },

  /** Spec 05 §6 — where each selected place sits on the page as it is now. */
  rectsForAnchors(itemsJson: string): string {
    const items = JSON.parse(itemsJson) as AnchorToMeasure[];
    const current = index;
    if (!current) return JSON.stringify(items.map(() => null));
    return JSON.stringify(
      items.map((item) => rectForAnchorIn(window, current, item.anchor, item.kind)),
    );
  },

  /** §6 — recolours the passages when a different comment is opened. */
  repaintActive(activeThreadId: string | null): void {
    paintHighlights(window, hits, activeThreadId);
  },

  createFromSelection(): string | null {
    const outcome = anchorFromSelectionIn(window, index, NO_SOURCE);
    chain = outcome?.chain ?? null;
    return outcome ? JSON.stringify(outcome.selected) : null;
  },

  /**
   * `keep` carries the reviewer's widening across a pointer move, and only when
   * they widened by hand — see `keptIndex` in anchoring.ts, which this mirrors.
   */
  probeAt(x: number, y: number, keep: number): string | null {
    const next = index ? scopeChainAt(index, x, y) : null;
    if (!next) {
      chain = null;
      return null;
    }
    const chosen = keep >= 0 ? (chain?.elements[keep] ?? null) : null;
    const at = chosen ? next.elements.indexOf(chosen) : -1;
    chain = next;
    return JSON.stringify({ scopes: next.scopes, active: at >= 0 ? at : 0 });
  },

  anchorFromScope(scopeIndex: number): string | null {
    const selected = anchorFromScopeIn(window, index, chain, scopeIndex, NO_SOURCE, null);
    return selected ? JSON.stringify(selected) : null;
  },

  anchorFromRegion(scopeIndex: number, box: ScopeRect): string | null {
    const selected = anchorFromScopeIn(window, index, chain, scopeIndex, NO_SOURCE, box);
    return selected ? JSON.stringify(selected) : null;
  },

  /** Spec 06 §5.3 — the lasso, run inside the page whose DOM it measures. */
  targetsFromDrawing(strokesJson: string, zoom: number): string {
    const strokes = JSON.parse(strokesJson) as Stroke[];
    return JSON.stringify(targetsFromDrawingIn(window, document, index, strokes, zoom, NO_SOURCE));
  },

  scopesForAnchor(anchorJson: string, kind: "text" | "element"): string | null {
    const rebuilt = chainForAnchor(anchorJson, kind);
    return rebuilt
      ? JSON.stringify({ scopes: rebuilt.chain.scopes, active: rebuilt.active })
      : null;
  },

  anchorFromAnchorScope(
    anchorJson: string,
    kind: "text" | "element",
    scopeIndex: number,
  ): string | null {
    const rebuilt = chainForAnchor(anchorJson, kind);
    const selected = anchorFromScopeIn(
      window,
      index,
      rebuilt?.chain ?? null,
      scopeIndex,
      NO_SOURCE,
      null,
    );
    return selected ? JSON.stringify(selected) : null;
  },

  /** §3.3 — a panel row clicked while its page is open scrolls to it. */
  scrollToAnchor(anchorJson: string): void {
    if (!index) return;
    scrollToAnchorIn(window, index, JSON.parse(anchorJson) as Anchor);
  },
});

/**
 * The channel name is written out rather than imported as a value.
 *
 * `channels.ts` is a value import in `index.ts`, and the two preload entries
 * sharing one value module makes Rollup emit `chunks/channels-*.cjs` — which
 * Electron cannot load, because a preload script is a single file with no
 * module resolution. Measured on 2026-08-25: `index.cjs` shrank from 5.15 kB to
 * 2.52 kB, the window came up with no `window.rex` at all, and every IPC call
 * threw. It is the same fault the `externalizeDepsPlugin` note in
 * `electron.vite.config.ts` records, from the other direction.
 *
 * The type annotation is what keeps the literal honest: rename the channel in
 * `channels.ts` and this stops compiling.
 */
const KEY_CHANNEL: (typeof GUEST_EVENT)["key"] = "guest:key";

/**
 * Spec 08 §4.2 — the mode keys, sent out of the guest process.
 *
 * The same hole `forwardKeysToParent` closes for tier 1, one process further
 * away: every REX binding lives on the overlay's document, and a key pressed in
 * the page under review reaches nothing. `⌘`/`ctrl` combinations stay here —
 * they belong to the page and to Electron, not to REX.
 */
for (const type of ["keydown", "keyup"] as const) {
  document.addEventListener(type, (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    const forwarded: ForwardedKey = {
      type,
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
    };
    ipcRenderer.sendToHost(KEY_CHANNEL, forwarded);
  });
}
