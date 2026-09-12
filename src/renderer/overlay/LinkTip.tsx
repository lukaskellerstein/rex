// Spec 53 §4.7 — where this link goes, before you click it.
//
// A browser answers this in a status bar at the bottom-left corner. REX answers
// it beside the link, because a review pane is not a browser window: the
// reviewer is reading prose in the middle of the screen and a caption in a
// corner is somewhere they are not looking.
//
// Drawn over the pane and never into the document. The document lives in a
// sandboxed iframe with no script, so a `title` attribute is the only tooltip it
// could carry itself — and that one is the operating system's, arrives after
// about a second, and cannot show three lines. Spec 01 §6.7's rule that REX
// never writes into the page under review points the same way.
//
// It takes no pointer events at all. A tip that could be hovered would sit
// between the reviewer and the link they are about to click.

import type { ScopeRect } from "../anchor/pick.ts";

/** What the tip says about one link. Built in `App`, which is where main answers. */
export interface LinkTipView {
  /** The link's box, in the document's own coordinates. */
  rect: ScopeRect;
  /**
   * Line one — where it goes. A full path with `~` for home, the URL for an
   * external link, or REX's own words for a place in this same document.
   */
  target: string;
  /** Line two — the place inside it, as the author wrote it. */
  fragment: string | null;
  /** Line three — why REX will not go there. Null when it will. */
  refusal: string | null;
}

interface Props {
  tip: LinkTipView | null;
  scrollX: number;
  scrollY: number;
  /** The pane's own height, so a tip near the foot flips above its link. */
  paneHeight: number;
}

/** Roughly what the tip needs below a link before it stops fitting. */
const TIP_ROOM = 92;

export function LinkTip(props: Props): React.JSX.Element | null {
  const { tip } = props;
  if (!tip) return null;

  // The document scrolls under a fixed layer, so a rect in document
  // coordinates comes back by the current scroll offset to be drawn — the same
  // arithmetic every other layer over this pane does.
  const left = tip.rect.x - props.scrollX;
  const top = tip.rect.y - props.scrollY;
  const below = top + tip.rect.h + 6;
  const flip = below + TIP_ROOM > props.paneHeight;

  return (
    <div
      className="rex-linktip"
      // Never announced. The link's own text and `href` are what a screen
      // reader already reads, and this repeats them for the eye alone.
      aria-hidden="true"
      style={flip ? { left, bottom: props.paneHeight - top + 6 } : { left, top: below }}
    >
      <span className="rex-linktip-target">{tip.target}</span>
      {tip.fragment ? <span className="rex-linktip-fragment">#{tip.fragment}</span> : null}
      {tip.refusal ? <span className="rex-linktip-refusal">{tip.refusal}</span> : null}
    </div>
  );
}
