// Spec 28 §4.1.1 — the overview ruler.
//
// A thin strip the full height of the pane, at its right edge, with one mark
// per match at the height that match has in the whole document. It answers
// "where else, and how far" — the one thing neither the count nor the paint on
// the visible page can say.
//
// VS Code draws these marks in the scrollbar's track. The frame's scrollbar
// belongs to the iframe and the overlay cannot paint in it, so the strip sits
// over that lane instead: the strip itself takes no pointer events and every
// mark does, so the scrollbar under it keeps working wherever a mark is not
// (§5.6).

import type { FindMark } from "../../shared/types.ts";

interface Props {
  marks: FindMark[];
  /** The current match's index, or -1. Its mark is stronger and a pixel wider. */
  current: number;
  onPick: (ordinal: number) => void;
}

export function FindRuler(props: Props): React.JSX.Element {
  return (
    <div className="rex-ruler">
      {props.marks.map((mark, at) => (
        <button
          // Position is identity here: two matches cannot share a top.
          key={`${mark.top}-${at}`}
          type="button"
          // Off the tab order: a thousand stops on one page is not navigation.
          tabIndex={-1}
          className={`rex-ruler-mark${at === props.current ? " rex-ruler-current" : ""}`}
          style={{
            top: `${mark.top * 100}%`,
            // At least 2px, so a one-line match on a long page still shows.
            height: `max(${mark.height * 100}%, 2px)`,
          }}
          aria-label={`Match ${at + 1} of ${props.marks.length}`}
          title={`Match ${at + 1} of ${props.marks.length}`}
          onClick={() => props.onPick(at)}
        />
      ))}
    </div>
  );
}
