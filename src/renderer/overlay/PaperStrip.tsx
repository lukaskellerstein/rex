// Spec 27 §4.1 — how the page is drawn, set from the page.
//
// The same rule that put `pick element` and `pen` at the foot of the paper
// (spec 08 §4) puts these at its head: a control belongs where it acts. These
// two act on the paper itself — its width and its ground — so they sit on the
// paper, in the corner opposite the modes, drawn in the same pill so that REX
// has one way of showing a control that turns on.
//
// Drawn only for a Markdown document (§4.2). Everywhere else the page's styles
// are somebody else's — the author's CSS, Word's own emphasis, a deck's design,
// a picture of a page — and REX does not restyle those. `DocumentView` decides;
// this component is only ever asked to draw.

import type { PaperView } from "../../shared/types.ts";

interface Props {
  view: PaperView;
  onWide: () => void;
  onDark: () => void;
}

export function PaperStrip(props: Props): React.JSX.Element {
  return (
    <div className="rex-paper">
      <button
        type="button"
        className={`rex-mode${props.view.wide ? " rex-mode-on" : ""}`}
        title={
          props.view.wide
            ? "Back to the 620px measure — W"
            : "Let the text fill the pane — W. Good for a wide table; prose reads better narrow."
        }
        aria-pressed={props.view.wide}
        onClick={props.onWide}
      >
        <kbd className="rex-key">W</kbd>
        wide
      </button>

      {/*
        `T` for theme, and not `D`: `D` is already the Document view (`App.tsx`'s
        key switch), and a letter that means two things is a letter that means
        neither.
      */}
      <button
        type="button"
        className={`rex-mode${props.view.dark ? " rex-mode-on" : ""}`}
        title={props.view.dark ? "Back to the light paper — T" : "Read on dark paper — T"}
        aria-pressed={props.view.dark}
        onClick={props.onDark}
      >
        <kbd className="rex-key">T</kbd>
        dark
      </button>
    </div>
  );
}
