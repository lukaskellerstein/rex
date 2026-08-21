/// <reference types="vite/client" />

// `?raw` imports are a Vite feature; electron-vite builds the main process with
// Vite too, which is how §9's schema.sql reaches the bundle as a string.
declare module "*.sql?raw" {
  const content: string;
  export default content;
}

import type { RexApi } from "./shared/channels.ts";
import type { AnchorSummary } from "./shared/types.ts";

declare global {
  interface Window {
    /** The contextBridge surface from src/preload/index.ts. */
    rex: RexApi;
    /**
     * SPEC.md §8.7 step 6 — main calls this after an Apply. Anchors resolve in
     * the renderer (invariant I1), so the sweep has to happen here and hand its
     * summary back across `executeJavaScript`.
     *
     * Spec 05 §5.6: Apply may change several documents, so it is given every one
     * it changed. The document on screen is re-rendered only if it is among
     * them — re-rendering one that did not change would cost the reviewer their
     * scroll position for nothing.
     */
    __rexReanchor?: (changedDocumentIds: string[]) => Promise<AnchorSummary>;
  }
}
