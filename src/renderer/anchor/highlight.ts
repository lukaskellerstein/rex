// SPEC.md §6.7 — paint the resolved ranges with the CSS Custom Highlight API.
//
// Nothing here may touch the document tree. Wrapping a range in <mark> would
// shift the character offsets every other anchor depends on and would show up
// to any agent that reads the file, so the highlight lives entirely in the
// highlight registry and its CSS arrives as a constructed stylesheet rather
// than a <style> element.
//
// Four registries rather than two: the design gives an exact anchor and a
// re-found one different colours in the document, the same steel and amber the
// gutter marker and the card wash use, so state reads the same in all three
// places. A resolved thread is drained of colour but still findable. The
// comment whose card is open outranks all three — see `ACTIVE_HIGHLIGHT`.

import { HIGHLIGHT } from "../../shared/tokens.ts";
import type { AnchorState, ThreadStatus } from "../../shared/types.ts";

const OK_HIGHLIGHT = "rex-ok";
const MOVED_HIGHLIGHT = "rex-moved";
const RESOLVED_HIGHLIGHT = "rex-resolved";
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
::highlight(${OK_HIGHLIGHT}) {
  background-color: ${HIGHLIGHT.okBg};
  text-decoration: underline 1.5px ${HIGHLIGHT.okRule};
  text-underline-offset: 3px;
}
::highlight(${MOVED_HIGHLIGHT}) {
  background-color: ${HIGHLIGHT.movedBg};
  text-decoration: underline 1.5px ${HIGHLIGHT.movedRule};
  text-underline-offset: 3px;
}
::highlight(${RESOLVED_HIGHLIGHT}) {
  background-color: ${HIGHLIGHT.resolvedBg};
}
::highlight(${ACTIVE_HIGHLIGHT}) {
  background-color: ${HIGHLIGHT.activeBg};
  text-decoration: underline 2px ${HIGHLIGHT.activeRule};
  text-underline-offset: 3px;
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
 * `win` is the window owning the ranges: for tier 1 that is the document
 * iframe, not the renderer, and its `CSS.highlights` is a different registry.
 */
export function paintHighlights(
  win: Window,
  hits: HighlightHit[],
  activeThreadId: string | null,
): void {
  const scope = win as Window & typeof globalThis;
  if (typeof scope.Highlight === "undefined" || typeof scope.CSS?.highlights === "undefined")
    return;

  ensureStylesheet(win);

  const ok = new scope.Highlight();
  const moved = new scope.Highlight();
  const resolved = new scope.Highlight();
  const active = new scope.Highlight();

  for (const hit of hits) {
    if (hit.threadId === activeThreadId) active.add(hit.range);
    else if (hit.status === "resolved") resolved.add(hit.range);
    else if (hit.state === "moved") moved.add(hit.range);
    else ok.add(hit.range);
  }

  scope.CSS.highlights.set(OK_HIGHLIGHT, ok);
  scope.CSS.highlights.set(MOVED_HIGHLIGHT, moved);
  scope.CSS.highlights.set(RESOLVED_HIGHLIGHT, resolved);
  scope.CSS.highlights.set(ACTIVE_HIGHLIGHT, active);
}

/** Drops every REX highlight from `win`, leaving other registrations alone. */
export function clearHighlights(win: Window): void {
  const scope = win as Window & typeof globalThis;
  scope.CSS?.highlights?.delete(OK_HIGHLIGHT);
  scope.CSS?.highlights?.delete(MOVED_HIGHLIGHT);
  scope.CSS?.highlights?.delete(RESOLVED_HIGHLIGHT);
  scope.CSS?.highlights?.delete(ACTIVE_HIGHLIGHT);
}
