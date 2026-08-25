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

function align(from: Window, to: Window, map: (line: number) => number): void {
  const here = stampsOf(from.document);
  const there = stampsOf(to.document);
  if (here.length === 0 || there.length === 0) {
    to.scrollTo({ top: proportional(from, to) });
    return;
  }

  const at = stampAt(here, from.scrollY);
  if (!at) return;
  const twin = stampFor(there, map(at.line));
  if (!twin) return;
  // The offset INTO the block is carried across, so scrolling through a long
  // paragraph moves the other side by the same amount rather than sticking at
  // its top and then jumping a whole block.
  to.scrollTo({ top: Math.max(0, twin.top + (from.scrollY - at.top)) });
}

/**
 * Keeps `original` level with `current`, and the other way round.
 *
 * Returns the cleanup. The re-entry guard is a flag rather than a comparison of
 * positions: scrolling one pane scrolls the other, whose own handler would then
 * scroll the first back, and two frames disagreeing by one pixel would jitter
 * between them for as long as the reviewer watched.
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
  let echo = false;

  const follow = (from: Window, to: Window, map: (line: number) => number) => (): void => {
    if (echo) return;
    echo = true;
    try {
      align(from, to, map);
    } finally {
      // One frame, not a timer: the scroll this just caused fires its own
      // handler synchronously in the same task, and the flag has to still be up
      // when it does.
      from.requestAnimationFrame(() => {
        echo = false;
      });
    }
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
