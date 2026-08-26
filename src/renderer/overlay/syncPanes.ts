// Spec 15 §6.2 — the two panes scroll together.
//
// Not by pixel: one side has paragraphs the other does not, so a pixel offset
// drifts further apart the longer the document is, which is exactly when a
// reviewer needs the two halves level. They are kept level by **source line**,
// mapped through the patch (`lineMap.ts`), landing on the `data-src-line`
// stamps spec 05 §5.6.1 already relies on.
//
// A document with no stamps falls back to proportion, which is honest: it is
// the best that can be known, and it is what every side-by-side viewer does.

import { hunksOf, toCurrentLine, toOriginalLine } from "./lineMap.ts";

interface Stamp {
  line: number;
  top: number;
}

/** Every stamped block, by document top. Cheap enough to redo on each scroll. */
function stampsOf(doc: Document): Stamp[] {
  const stamps: Stamp[] = [];
  for (const element of doc.querySelectorAll("[data-src-line]")) {
    const line = Number(element.getAttribute("data-src-line"));
    if (!Number.isInteger(line) || line <= 0) continue;
    stamps.push({ line, top: (element as HTMLElement).offsetTop });
  }
  return stamps.sort((a, b) => a.top - b.top);
}

/** The last stamp at or above `y`, which is the block the reader is looking at. */
function stampAt(stamps: readonly Stamp[], y: number): Stamp | null {
  let found: Stamp | null = null;
  for (const stamp of stamps) {
    if (stamp.top > y + 1) break;
    found = stamp;
  }
  return found ?? stamps[0] ?? null;
}

/** The stamp for `line`, or the nearest one above it. */
function stampFor(stamps: readonly Stamp[], line: number): Stamp | null {
  let found: Stamp | null = null;
  for (const stamp of stamps) {
    if (stamp.line > line) break;
    found = stamp;
  }
  return found ?? stamps[0] ?? null;
}

function proportional(from: Window, to: Window): number {
  const fromMax = Math.max(1, from.document.documentElement.scrollHeight - from.innerHeight);
  const toMax = Math.max(0, to.document.documentElement.scrollHeight - to.innerHeight);
  return (from.scrollY / fromMax) * toMax;
}

/**
 * How far off a written position a scroll may land and still be recognised as
 * the one we wrote. Chromium rounds sub-pixel scroll offsets.
 */
const SAME_PLACE = 2;

/**
 * Where each pane was last scrolled to BY THIS FILE, so its own handler can
 * tell the echo apart from the reader.
 *
 * A position and not a flag, and that is the whole fix for a scroll that
 * fought back. The flag was cleared on the next animation frame, on the
 * assumption that the scroll it caused would have been dispatched by then —
 * and scroll events are dispatched asynchronously, so whether the flag was
 * still up when the echo arrived came down to the order of two callbacks in
 * different documents. A position needs no timing at all: an event that lands
 * exactly where we put it is ours, whenever it turns up.
 */
const written = new WeakMap<Window, number>();

function scrollTogether(to: Window, top: number): void {
  // Already there: writing it again produces another scroll event to reason
  // about and moves nothing.
  if (Math.abs(to.scrollY - top) < 1) return;
  written.set(to, top);
  to.scrollTo({ top });
}

function align(from: Window, to: Window, map: (line: number) => number): void {
  const here = stampsOf(from.document);
  const there = stampsOf(to.document);
  if (here.length === 0 || there.length === 0) {
    scrollTogether(to, proportional(from, to));
    return;
  }

  const at = stampAt(here, from.scrollY);
  if (!at) return;
  const twin = stampFor(there, map(at.line));
  if (!twin) return;
  // The offset INTO the block is carried across, so scrolling through a long
  // paragraph moves the other side by the same amount rather than sticking at
  // its top and then jumping a whole block.
  scrollTogether(to, Math.max(0, twin.top + (from.scrollY - at.top)));
}

/**
 * Keeps `original` level with `current`, and the other way round.
 *
 * Returns the cleanup.
 *
 * **The two panes must never both drive at once**, and near an added block that
 * is not a matter of taste. `toOriginalLine` maps every line inside an added
 * hunk onto the one original line the hunk starts at, and `toCurrentLine` maps
 * that original line back to the START of the hunk — so a reader scrolling down
 * through a newly added block moved the original, the original's echo mapped
 * back to the top of that block, and the reader was pulled back up to where
 * they had started. Reported on 2026-08-26: *"it just blocks me and it always
 * returns me back to this element"*.
 *
 * The mapping is not invertible there and cannot be made so — one side has
 * text the other does not, which is the whole point of the two panes. What is
 * fixable is the echo, and `written` is what fixes it.
 */
export function syncPanes(
  current: HTMLIFrameElement,
  original: HTMLIFrameElement,
  patch: string,
): () => void {
  const currentView = current.contentWindow;
  const originalView = original.contentWindow;
  if (!currentView || !originalView) return () => undefined;

  const hunks = hunksOf(patch);

  const follow = (from: Window, to: Window, map: (line: number) => number) => (): void => {
    // This pane landing exactly where we put it is our own scroll coming back,
    // not the reader moving. Answering it is what closes the loop.
    const ours = written.get(from);
    if (ours !== undefined && Math.abs(from.scrollY - ours) <= SAME_PLACE) {
      written.delete(from);
      return;
    }
    align(from, to, map);
  };

  const fromCurrent = follow(currentView, originalView, (line) => toOriginalLine(hunks, line));
  const fromOriginal = follow(originalView, currentView, (line) => toCurrentLine(hunks, line));

  currentView.addEventListener("scroll", fromCurrent, { passive: true });
  originalView.addEventListener("scroll", fromOriginal, { passive: true });
  // Level from the moment they appear, rather than on the first scroll.
  fromCurrent();

  return () => {
    currentView.removeEventListener("scroll", fromCurrent);
    originalView.removeEventListener("scroll", fromOriginal);
  };
}
