// Spec 26 §2 — the chain REX is outlining, at the foot of the pane.
//
// It used to live inside `PickLayer`, which meant it was drawn only while pick
// mode was on: let go of ⌥ and the crumbs that had the section on them one
// second earlier were gone, with the widening they offered. So it is its own
// component now, mounted from `DocumentView` beside the mode strip, and it says
// what is outlined whether that is a hover or a place already taken.
//
// Spec 08 §4.1 governs the geometry — the 34px strip, one state at a time,
// drawn OVER the pane and never written into the document.

import type { PickScope } from "../anchor/pick.ts";
import { scopeWord } from "../anchor/pick.ts";
import { Strength } from "./Strength.tsx";

interface Props {
  /** Widest last — the chain is built inside out and read outside in. */
  scopes: PickScope[];
  active: number;
  /**
   * §4.1 — the focused place's number, or null while the bar is about a hover.
   *
   * It is also the answer to "which of the two is this", so the hints and the
   * label follow it rather than a second flag that could disagree with it.
   */
  number: number | null;
  onScope: (index: number) => void;
  onDone: () => void;
}

export function PathBar(props: Props): React.JSX.Element | null {
  if (props.scopes.length === 0) return null;
  const scope = props.scopes[props.active] ?? null;
  const place = props.number !== null;

  return (
    <div className="rex-pathbar">
      <span className="rex-pathbar-label">
        PATH
        {/*
          The place's own number, in the colour its outline draws, so the bar
          and the page agree about which row ↑ is going to move. Spec 18's
          draft token — a bar that borrowed the violet of a stored comment
          would claim the place had been sent.
        */}
        {place ? <span className="rex-pathbar-number">{props.number}</span> : null}
      </span>

      <div className="rex-crumbs">
        {[...props.scopes].reverse().map((crumb, position) => (
          <span key={crumb.index} className="rex-crumbs">
            {position > 0 ? <span className="rex-crumb-sep">›</span> : null}
            <button
              type="button"
              className={crumb.index === props.active ? "rex-crumb rex-crumb-on" : "rex-crumb"}
              title={crumb.title}
              onClick={(event) => {
                // The bar sits over the pick layer, which takes a bare click as
                // "add what is under the pointer". A crumb is not that click.
                event.stopPropagation();
                props.onScope(crumb.index);
              }}
            >
              {scopeWord(crumb)}
            </button>
          </span>
        ))}
      </div>

      {/*
        §4.1 — how well an anchor here would survive an edit, bars only. It is
        the one fact on the bar the reviewer can act on: `weak` means a
        positional path and nothing else, and one level wider usually reaches
        something with text. The sentence is in the tooltip, and spelled out in
        full on the expanded panel row, which has the width for it.

        Only under a place. A hover already moves scope to scope as the pointer
        travels, and a meter that flickers with it is noise.
      */}
      {place && scope && scope.kind === "element" ? <Strength scope={scope} bare /> : null}

      <span className="rex-pathbar-keys">
        <span>
          <span className="rex-key">↑</span>
          <span className="rex-key">↓</span>
          {place ? "widen / narrow this place" : "widen / narrow"}
        </span>
        {place ? (
          <span>
            <span className="rex-key">⌥ wheel</span>
            the same
          </span>
        ) : (
          <span>
            <span className="rex-key">click</span>
            adds to the selection
          </span>
        )}
        <button type="button" className="rex-pathbar-done" onClick={props.onDone}>
          <span className="rex-key">esc</span>
          {place ? "done" : "leave"}
        </button>
      </span>
    </div>
  );
}
