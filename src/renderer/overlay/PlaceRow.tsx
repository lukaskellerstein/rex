// Spec 35 §2.3 — one place, in cells: where it is, how big it is, what kind of
// thing it is. Never what it says.
//
// `placeCells` decides the words. This draws them, with a hairline between the
// cells and the file name bright, so the five lines of a five-place comment
// read as a listing and not as five sentences.
//
// Its own file since spec 38 §3.2: the card head lists every place a comment
// has, and the trace sheet lists, under each `YOU` block, the places that
// message brought. One row, drawn by both, so the sheet and the head cannot
// describe one place differently.

import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { ChevronRight } from "./Icons.tsx";
import { type PlaceFacts, placeCells } from "./placeLine.ts";

export function PlaceRow({
  thread,
  position,
  facts,
  state,
  here,
  lit,
  onHover,
  onGo,
}: {
  thread: ThreadWithMessages;
  position: number;
  facts: PlaceFacts;
  state: AnchorState | null;
  /** Spec 08 §7.3 — true when the place's document is the one on screen. */
  here: boolean;
  lit: boolean;
  onHover: (position: number | null) => void;
  onGo: () => void;
}): React.JSX.Element {
  const target = thread.targets[position];
  const name = thread.targetNames[position] ?? "";
  const cells = target ? placeCells(target.anchor, facts, state) : null;

  return (
    <li
      className={lit ? "rex-place rex-place-lit" : "rex-place"}
      onMouseEnter={() => onHover(here ? position : null)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="rex-place-index rex-place-index-active">{position + 1}</span>
      <span className="rex-place-file">
        <span className="rex-place-name" title={name}>
          {name}
        </span>
        {/* Spec 18 §3 — gone is grey, and the tree's `?` says it on the file. */}
        {state === "orphaned" ? (
          <span className="rex-place-lost" title="anchor lost">
            ?
          </span>
        ) : null}
      </span>
      {cells ? (
        <span className="rex-place-cells">
          {cells.whole ? (
            <span className="rex-place-cell">
              <span className="rex-place-badge rex-place-whole">whole file</span>
            </span>
          ) : cells.where ? (
            <span className="rex-place-cell">
              <span className="rex-place-badge">{cells.where}</span>
            </span>
          ) : null}
          {cells.size ? <span className="rex-place-cell rex-place-size">{cells.size}</span> : null}
          {cells.kind ? <span className="rex-place-cell rex-place-kind">{cells.kind}</span> : null}
          {cells.was !== null ? (
            <span className="rex-place-cell rex-place-was">was L{cells.was}</span>
          ) : null}
          {cells.unchecked ? (
            <span className="rex-place-cell rex-place-unchecked">not checked here</span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        className="rex-link rex-place-go"
        title={here ? "Scroll to this place" : `Open ${name || "it"} and scroll there`}
        onClick={onGo}
      >
        go to
        <ChevronRight />
      </button>
    </li>
  );
}
