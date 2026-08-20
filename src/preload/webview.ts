// The tier 2 preload (SPEC.md §5.2, milestone 7).
//
// A <webview> is a separate process, so the renderer cannot reach its DOM.
// Invariant I1 says the resolver runs on the live DOM, which means it has to
// run *here*. Only serialisable results cross back — a Range cannot survive
// the context bridge, and the caller only ever needed offsets and states.

import { contextBridge } from "electron";
import type { TextIndex } from "../renderer/anchor/textIndex.ts";
import { anchorFromSelectionIn, resolveAgainst } from "../renderer/overlay/anchoring.ts";
import type { Thread } from "../shared/types.ts";

let index: TextIndex | null = null;

contextBridge.exposeInMainWorld("__rexAnchor", {
  /** JSON in, JSON out — the bridge clones structured data, not class instances. */
  resolveAll(threadsJson: string, documentChanged: boolean): string {
    const threads = JSON.parse(threadsJson) as Thread[];
    const outcome = resolveAgainst(window, document, threads, documentChanged);
    index = outcome.index;
    return JSON.stringify(outcome.resolved);
  },

  createFromSelection(): string | null {
    const draft = anchorFromSelectionIn(window, index, null);
    return draft ? JSON.stringify(draft) : null;
  },
});
