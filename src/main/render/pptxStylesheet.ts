// Spec 11 §4.3 — the stylesheet for a rendered deck.
//
// Its own module for the same reason `stylesheet.ts` is: it is a large string
// constant, and leaving it in `pptx.ts` buries the emitter that matters.
//
// ONE HARD RULE, inherited from `stylesheet.ts`: no `<` anywhere in the string
// below, comments included. DOMPurify's mXSS guard deletes any element whose
// text content matches `/<[/\w!]/`, and a `style` element holding CSS is
// exactly that shape — the whole stylesheet disappears with nothing logged.
//
// Every number a slide draws with is the library's own, in points, inside a
// slide box sized in points (§4.3 rule 4). Nothing here converts a coordinate.
// Fitting a deck to a narrow pane is REX's existing document zoom, which is CSS
// `zoom` on the frame's documentElement and therefore takes part in layout.

import { ALERT, PAPER } from "../../shared/tokens.ts";

export const DECK_STYLESHEET = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 20px 0 96px;
    background: ${PAPER.wash};
    color: ${PAPER.ink};
    font: 15px/1.45 "DM Sans", system-ui, -apple-system, sans-serif;
  }

  .rex-deck { width: var(--slide-w); margin: 0 auto; }

  .rex-slide-wrap { margin: 0 0 26px; }

  .rex-slide-tag {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${PAPER.inkMuted};
    margin: 0 0 5px 2px;
  }

  /* The slide rectangle itself, and the anchor target for a whole-slide
     comment. Its box is the slide and nothing else, so a region anchor stored
     as fractions of it means what it says. */
  .rex-slide {
    position: relative;
    display: block;
    width: var(--slide-w);
    height: var(--slide-h);
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16);
  }

  .rex-shape { position: absolute; box-sizing: border-box; }

  /* Non-rectangular geometry. The viewBox is the library's own path box, so
     the drawing scales with the shape and never rounds. */
  .rex-geom {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  /* Sits after .rex-geom in the markup, so it paints over it. */
  .rex-text {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    white-space: normal;
    word-wrap: break-word;
  }
  .rex-text p { margin: 0; }
  .rex-text ul, .rex-text ol { margin: 0; padding-left: 1.4em; }

  .rex-media { display: block; width: 100%; height: 100%; object-fit: fill; }
  .rex-crop { position: absolute; inset: 0; overflow: hidden; }
  .rex-crop img { position: absolute; }
  video.rex-media { object-fit: contain; background: #000000; }

  /* An audio shape, a chart REX cannot draw, and anything else with no picture
     of its own. Labelled rather than empty: the box is still anchorable, and a
     reviewer must be able to see what it is. */
  .rex-placeholder {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 8px 10px;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 1px dashed ${PAPER.rule};
    border-radius: 3px;
    background: ${PAPER.wash};
    color: ${PAPER.inkMuted};
    font-size: 12px;
    overflow: hidden;
  }
  .rex-placeholder b { color: ${PAPER.inkBody}; font-weight: 600; }

  .rex-table { border-collapse: collapse; width: 100%; height: 100%; table-layout: fixed; }
  .rex-table td { padding: 3px 6px; vertical-align: middle; overflow: hidden; }
  .rex-table p { margin: 0; }

  /* Speaker notes. Authored text, so they are part of the text index and carry
     no data-rex-overlay — a reviewer may legitimately comment on one (§4.6). */
  .rex-notes {
    margin: 6px 0 0;
    padding: 0;
    border: 1px solid ${PAPER.rule};
    border-radius: 4px;
    background: ${PAPER.bg};
    font-size: 13px;
    line-height: 1.5;
  }
  .rex-notes summary {
    padding: 5px 10px;
    cursor: pointer;
    color: ${PAPER.inkMuted};
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .rex-notes .rex-notes-body { padding: 0 10px 9px; color: ${PAPER.inkBody}; }
  .rex-notes p { margin: 0 0 6px; }

  /* §4.7 — a deck that would not parse. REX's own, so it is marked as such and
     stays out of the text index. */
  .rex-unreadable {
    max-width: 620px;
    margin: 40px auto;
    padding: 18px 20px;
    border: 1px solid ${ALERT.caution.rule};
    border-left-width: 3px;
    border-radius: 4px;
    background: ${ALERT.caution.bg};
    color: ${PAPER.inkBody};
    font-size: 14px;
    line-height: 1.6;
  }
  .rex-unreadable h1 { margin: 0 0 8px; font-size: 15px; color: ${PAPER.ink}; }
  .rex-unreadable code {
    display: block;
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 3px;
    background: ${PAPER.wash};
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    overflow-x: auto;
  }
`;
