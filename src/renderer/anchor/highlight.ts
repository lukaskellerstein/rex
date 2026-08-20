// SPEC.md §6.7 — paint the resolved ranges with the CSS Custom Highlight API.
//
// Nothing here may touch the document tree. Wrapping a range in <mark> would
// shift the character offsets every other anchor depends on and would show up
// to any agent that reads the file, so the highlight lives entirely in the
// highlight registry and its CSS arrives as a constructed stylesheet rather
// than a <style> element.

import type { ThreadStatus } from "../../shared/types.ts";

const OPEN_HIGHLIGHT = "rex-open";
const RESOLVED_HIGHLIGHT = "rex-resolved";

const HIGHLIGHT_CSS = `
::highlight(${OPEN_HIGHLIGHT})     { background: rgba(255, 213, 0, 0.35); }
::highlight(${RESOLVED_HIGHLIGHT}) { background: rgba(120, 120, 120, 0.18); }
`;

export interface HighlightHit {
  range: Range;
  status: ThreadStatus;
}

/** Documents already carrying the highlight stylesheet. */
const styled = new WeakSet<Document>();

/**
 * Adds the `::highlight()` rules without adding a node. `adoptedStyleSheets`
 * keeps milestone 2's "the document DOM is byte-identical" check literally
 * true — a <style> tag would not.
 */
function ensureStylesheet(win: Window): void {
  const doc = win.document;
  if (styled.has(doc)) return;
  const sheet = new (win as Window & typeof globalThis).CSSStyleSheet();
  sheet.replaceSync(HIGHLIGHT_CSS);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  styled.add(doc);
}

/**
 * SPEC.md §6.7 — replaces both registries wholesale, so a thread that stopped
 * resolving simply stops being painted.
 *
 * `win` is the window owning the ranges: for tier 1 that is the document
 * iframe, not the renderer, and its `CSS.highlights` is a different registry.
 */
export function paintHighlights(win: Window, hits: HighlightHit[]): void {
  const scope = win as Window & typeof globalThis;
  if (typeof scope.Highlight === "undefined" || typeof scope.CSS?.highlights === "undefined")
    return;

  ensureStylesheet(win);

  const open = new scope.Highlight();
  const resolved = new scope.Highlight();
  for (const { range, status } of hits) {
    (status === "open" ? open : resolved).add(range);
  }
  scope.CSS.highlights.set(OPEN_HIGHLIGHT, open);
  scope.CSS.highlights.set(RESOLVED_HIGHLIGHT, resolved);
}

/** Drops every REX highlight from `win`, leaving other registrations alone. */
export function clearHighlights(win: Window): void {
  const scope = win as Window & typeof globalThis;
  scope.CSS?.highlights?.delete(OPEN_HIGHLIGHT);
  scope.CSS?.highlights?.delete(RESOLVED_HIGHLIGHT);
}
