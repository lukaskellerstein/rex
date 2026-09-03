// What both document frames have in common.
//
// Spec 15 §6.1 put a second document on screen — the original, beside the
// working copy — and the two have to be drawn by the same code or the diff is
// between REX's two renderers rather than between the reviewer's two versions.
// So the srcdoc, the base href and the zoom live here, and `DocumentView` and
// `OriginalPane` both call them.

import type { OpenedDocument, PaperView } from "../../shared/types.ts";
import { LANE_RESERVE } from "./marginLane.ts";
import { prepareDocumentHtml } from "./sanitise.ts";

export function baseHref(directory: string): string {
  const encoded = directory
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `rex-doc://doc${encoded}/`;
}

/**
 * The empty page a PDF is drawn into (spec 03 §7.2).
 *
 * REX's own markup, not the author's, so it does not go through DOMPurify. Its
 * stylesheet arrives with the pass that creates the elements it styles.
 */
export const PDF_SHELL =
  '<!doctype html><html lang="en" data-rex-paper><head><meta charset="utf-8"></head><body></body></html>';

/** Spec 03 §9 — `presentation` is a union, so this stays exhaustive. */
export function srcdocFor(doc: OpenedDocument): string {
  return doc.presentation.kind === "html"
    ? prepareDocumentHtml(doc.presentation.html, doc.baseDir ? baseHref(doc.baseDir) : null)
    : // A PDF starts as an empty page; the §7 pass builds every page into it
      // before the surface is handed up.
      PDF_SHELL;
}

/**
 * CSS `zoom`, not `transform: scale`.
 *
 * `zoom` takes part in layout, so `getBoundingClientRect()` and `scrollY`
 * inside the frame both report the scaled geometry and keep agreeing with each
 * other — which is the only reason the overlay's boxes still land on the right
 * things. `transform` would leave layout at 1× and every rect the resolver
 * reads would be a lie. It also reflows a Markdown document to the new size
 * instead of letting a scaled page run off the side.
 */
export function applyZoom(inner: Document | null, zoom: number): void {
  if (!inner) return;
  inner.documentElement.style.zoom = String(zoom);
  // Spec 16 §9.1 — the paper margin the bar lane stands in, counter-scaled so
  // it stays `LANE_RESERVE` of the PANE's pixels at every zoom. `zoom` scales
  // everything inside the frame; the lane is drawn outside it and does not
  // scale, so a fixed 24px margin shrinks under the bar and the reviewer loses
  // the first letter of every line. Only a page REX typeset reads it — see the
  // note on `applyPaperView` for why setting it everywhere is still right.
  inner.documentElement.style.setProperty("--rex-lane", `${LANE_RESERVE / zoom}px`);
}

/**
 * Spec 27 §5.2 — the two switches, as two attributes on the page's own root.
 *
 * An attribute and not a re-render. The stylesheet REX wrote is already in the
 * frame and every colour in it is a custom property, so `data-rex-dark`
 * repaints the document and `data-rex-wide` reflows it without main rendering
 * anything again and without the frame reloading. A reload would throw away the
 * scroll position, every resolved anchor and any half-built selection, to
 * change two things REX could change from outside — which is the same
 * reaching-in `applyZoom` above does, and the same one the resolver has done
 * since milestone 0.
 *
 * Harmless on a page REX did not typeset: those carry no rule that reads either
 * attribute. The strip that sets them is not drawn there anyway (§4.2), and
 * this stays unconditional so that a format gaining the switches later needs no
 * change here.
 */
export function applyPaperView(inner: Document | null, view: PaperView): void {
  if (!inner) return;
  inner.documentElement.toggleAttribute("data-rex-wide", view.wide);
  inner.documentElement.toggleAttribute("data-rex-dark", view.dark);
}

// ── The listeners that have to live INSIDE the frame ────────────
//
// An event that happens inside an iframe never reaches the parent, so every one
// of these has to be attached to the frame's own document. Spec 16 §4.2 gives
// the original pane a surface, which means the reviewer works in it as well —
// and a pane where links are dead, ⌘+ does nothing and `P` is ignored is a pane
// that reads as broken.

/**
 * Fragment links, which `<base href>` breaks.
 *
 * The document sits in a srcdoc iframe, and its own images and stylesheets can
 * only find themselves through a `<base href="rex-doc://…/">` (sanitise.ts).
 * That same base also resolves `#installation` against `rex-doc://…/`, so a
 * table-of-contents link stops being a jump inside the page and becomes a
 * navigation to a URL that 404s. Measured on 2026-08-21: all nine links in
 * `sample-document.md` were dead this way even after the headings gained their
 * ids, and the only symptom was a 404 in the console.
 *
 * The iframe runs no script (spec 01 §5.4 step 2), so the renderer scrolls it
 * from outside — the same reaching-in the anchor resolver has always done, and
 * the mechanism spec 03 §4.1 describes.
 */
export function jumpToFragmentsInsteadOfNavigating(inner: Document): void {
  inner.addEventListener("click", (event: MouseEvent) => {
    // Not `event.target instanceof Element`. The target belongs to the iframe's
    // realm and `Element` here is the overlay's own constructor, so instanceof
    // across the two documents is always false — the listener would run, match
    // nothing, and let every link navigate exactly as if it were not there.
    const start = event.target as Element | null;
    const link = typeof start?.closest === "function" ? start.closest("a[href]") : null;
    const href = link?.getAttribute("href");
    if (!href?.startsWith("#") || href.length < 2) return;

    const heading = inner.getElementById(decodeURIComponent(href.slice(1)));
    if (!heading) return;
    event.preventDefault();
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** One wheel notch, or one press of ⌘+. */
export const ZOOM_IN = 1.1;
export const ZOOM_OUT = 1 / 1.1;

/**
 * ⌘/ctrl with the wheel, or with + − 0, while the pointer or the caret is
 * inside the document itself.
 *
 * `preventDefault` here is what stops Chromium from applying its own page zoom
 * on top of ours.
 */
export function zoomFromInside(
  inner: Document,
  commands: { current: { by: (factor: number) => void; reset: () => void } },
): void {
  inner.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      commands.current.by(event.deltaY < 0 ? ZOOM_IN : ZOOM_OUT);
    },
    // Wheel listeners are passive by default, and a passive one cannot
    // preventDefault — the browser would zoom the whole frame as well.
    { passive: false },
  );

  inner.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
    if (event.key === "+" || event.key === "=") commands.current.by(ZOOM_IN);
    else if (event.key === "-" || event.key === "_") commands.current.by(ZOOM_OUT);
    else if (event.key === "0") commands.current.reset();
    else return;
    event.preventDefault();
  });
}

/**
 * Spec 08 §4.2 — the mode keys work wherever the reviewer last clicked.
 *
 * Every REX binding is registered on the *overlay's* document (`App.tsx`, and
 * both layers), and an event inside an iframe never reaches it. So the moment
 * the reviewer clicks in the prose, or drags a text selection, focus moves into
 * the frame and `P`, `N`, `D`, `G`, `esc` and the ⌥ hold all go dead. That is
 * exactly when they are wanted: a selection is what you make just before you
 * widen it with a pick.
 *
 * Measured on 2026-08-25 against `components.md`: a `keydown` dispatched inside
 * the frame never arrived at the parent, and the reviewer read the whole thing
 * as "pick element does not work on the Comments tab", because clicking that
 * tab is what they did in between and a button click does not move focus on
 * macOS.
 *
 * A rebuilt copy rather than the event itself — an event can only be dispatched
 * once, and the copy has no target inside the frame, so `typing()` in `App.tsx`
 * reads it as "not a field" and the binding fires.
 *
 * `⌘`/`ctrl` combinations are left where they are: `zoomFromInside` already
 * answers the zoom keys here, and a forwarded copy would zoom a second time.
 */
export function forwardKeysToParent(
  inner: Document,
  /**
   * Spec 26 §5.4 — whether the overlay wants the arrow keys right now.
   *
   * Forwarding is a *copy*: the original event stays inside the frame, so
   * `preventDefault` on the parent's copy does nothing about the frame's own
   * scrolling. Without this, ↑ with the path bar up both widened the place and
   * scrolled the document a line — the page moving under the outline that had
   * just grown, which reads as the widening having gone wrong.
   *
   * A ref-shaped object rather than a boolean, for the reason `zoomFromInside`
   * takes one: this listener is attached once per frame load and the answer
   * changes many times per second.
   */
  wantsArrows: { current: boolean },
): void {
  const forward = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      /*
        Spec 28 §5.3 — the F chord is the one ⌘/ctrl combination forwarded.

        Nothing inside the frame answers it, so the copy cannot double an
        effect the way a forwarded ⌘+ would double the zoom. The modifiers
        travel with it, because ⌘F and ⌘⇧F are two different things (§4.1,
        §4.2), and the original is stopped so Chromium does not act on it.
      */
      if (event.type !== "keydown" || event.altKey || (event.key !== "f" && event.key !== "F")) {
        return;
      }
      event.preventDefault();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: event.key,
          code: event.code,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        }),
      );
      return;
    }
    // Only the scroll is taken, and only while the bar is asking for it. Every
    // other key is copied out and left alone, exactly as before.
    if (
      wantsArrows.current &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      event.type === "keydown"
    ) {
      event.preventDefault();
    }
    document.dispatchEvent(
      new KeyboardEvent(event.type, {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      }),
    );
  };
  inner.addEventListener("keydown", forward);
  inner.addEventListener("keyup", forward);
}
