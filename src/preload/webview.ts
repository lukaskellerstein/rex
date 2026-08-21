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

import { contextBridge } from "electron";
import { type ScopeChain, type ScopeRect, scopeChainAt } from "../renderer/anchor/pick.ts";
import type { TextIndex } from "../renderer/anchor/textIndex.ts";
import {
  anchorFromScopeIn,
  anchorFromSelectionIn,
  resolveAgainst,
} from "../renderer/overlay/anchoring.ts";
import type { Thread } from "../shared/types.ts";

let index: TextIndex | null = null;
/** The chain the renderer's chips and path bar refer back into, by position. */
let chain: ScopeChain | null = null;

/** A remote page has no local source file, so `Anchor.source` stays null (§5.2). */
const NO_SOURCE = null;

contextBridge.exposeInMainWorld("__rexAnchor", {
  /** JSON in, JSON out — the bridge clones structured data, not class instances. */
  resolveAll(threadsJson: string, documentChanged: boolean): string {
    const threads = JSON.parse(threadsJson) as Thread[];
    const outcome = resolveAgainst(window, document, threads, documentChanged);
    index = outcome.index;
    return JSON.stringify(outcome.resolved);
  },

  createFromSelection(): string | null {
    const outcome = anchorFromSelectionIn(window, index, NO_SOURCE);
    chain = outcome?.chain ?? null;
    return outcome ? JSON.stringify(outcome.draft) : null;
  },

  /** `keep` carries the reviewer's widening across a pointer move — anchoring.ts. */
  probeAt(x: number, y: number, keep: number): string | null {
    const next = index ? scopeChainAt(index, x, y) : null;
    if (!next) {
      chain = null;
      return null;
    }
    const chosen = chain?.elements[keep] ?? null;
    const at = chosen ? next.elements.indexOf(chosen) : -1;
    chain = next;
    return JSON.stringify({ scopes: next.scopes, active: at >= 0 ? at : 0 });
  },

  anchorFromScope(scopeIndex: number): string | null {
    const draft = anchorFromScopeIn(window, index, chain, scopeIndex, NO_SOURCE, null);
    return draft ? JSON.stringify(draft) : null;
  },

  anchorFromRegion(scopeIndex: number, box: ScopeRect): string | null {
    const draft = anchorFromScopeIn(window, index, chain, scopeIndex, NO_SOURCE, box);
    return draft ? JSON.stringify(draft) : null;
  },
});
