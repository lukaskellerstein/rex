// SPEC.md §6.7 — paint the resolved ranges with the CSS Custom Highlight API.
//
// Nothing here may touch the document tree. Wrapping a range in <mark> would
// shift the character offsets every other anchor depends on and would show up
// to any agent that reads the file, so the highlight lives entirely in the
// highlight registry and its CSS arrives as a constructed stylesheet rather
// than a <style> element.
//
// **Spec 15 §8.4 changed what gets painted, not how.** Until then every
// commented passage carried a wash and an underline, and six comments on one
// screen made the document unreadable — which is §8.1's complaint and the
// reason the marks moved to the margin (`MarginBars.tsx`).
//
// So the rule is now: the text is painted for the comment being READ, and for
// the one being pointed at. Nothing else. Which exact words a comment is about
// is a question you ask about one comment, and asking it is what lights them
// up. The state colours — steel, amber, drained, red — did not go away; they
// moved to the bar in the margin, which is where they no longer cost the
// reader anything.

import { HIGHLIGHT } from "../../shared/tokens.ts";
import type { AnchorState, ThreadStatus } from "../../shared/types.ts";

/**
 * Spec 15 §8.4 — the comment being pointed at, softly.
 *
 * The same violet as the open one at a lower strength: hovering a row is a
 * question ("where is this?"), and opening a comment is an answer. Two
 * intensities of one colour say that; two colours would say they were different
 * kinds of thing.
 */
const HOVER_HIGHLIGHT = "rex-hover";
/**
 * The open comment's own passages, in violet.
 *
 * It wins over state, because a reviewer reading one comment is asking "where
 * is this one?", not "what state is it in" — the card beside them already says
 * the state in words. It is a fourth colour and not a brighter blue: the
 * selection panel can be half-built at the same time, and its places are blue.
 */
const ACTIVE_HIGHLIGHT = "rex-active";

/**
 * The design draws the underline as `box-shadow: 0 1.5px 0`. A highlight
 * pseudo-element cannot take box-shadow — the property set is colour,
 * background-color, text-decoration, text-shadow and -webkit-text-stroke — so
 * it is written as the text-decoration that paints the same rule.
 */
const HIGHLIGHT_CSS = `
::highlight(${ACTIVE_HIGHLIGHT}) {
  background-color: ${HIGHLIGHT.activeBg};
  text-decoration: underline 2px ${HIGHLIGHT.activeRule};
  text-underline-offset: 3px;
}
::highlight(${HOVER_HIGHLIGHT}) {
  background-color: ${HIGHLIGHT.hoverBg};
}
`;

export interface HighlightHit {
  threadId: string;
  range: Range;
  status: ThreadStatus;
  state: AnchorState;
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
 * SPEC.md §6.7 — replaces every registry wholesale, so a thread that stopped
 * resolving simply stops being painted.
 *
 * `win` is the window owning the ranges: the document iframe, not the
 * renderer, and its `CSS.highlights` is a different registry.
 */
export function paintHighlights(
  win: Window,
  hits: HighlightHit[],
  activeThreadId: string | null,
  hoveredThreadId: string | null = null,
): void {
  const scope = win as Window & typeof globalThis;
  if (typeof scope.Highlight === "undefined" || typeof scope.CSS?.highlights === "undefined")
    return;

  ensureStylesheet(win);

  const active = new scope.Highlight();
  const hovered = new scope.Highlight();

  for (const hit of hits) {
    // §8.4 — and nothing else. A commented passage that is neither open nor
    // pointed at carries no paint at all; its bar in the margin says it is
    // there, and says in what state.
    if (hit.threadId === activeThreadId) active.add(hit.range);
    else if (hit.threadId === hoveredThreadId) hovered.add(hit.range);
  }

  scope.CSS.highlights.set(ACTIVE_HIGHLIGHT, active);
  scope.CSS.highlights.set(HOVER_HIGHLIGHT, hovered);
}

/** Drops every REX highlight from `win`, leaving other registrations alone. */
export function clearHighlights(win: Window): void {
  const scope = win as Window & typeof globalThis;
  scope.CSS?.highlights?.delete(ACTIVE_HIGHLIGHT);
  scope.CSS?.highlights?.delete(HOVER_HIGHLIGHT);
}
