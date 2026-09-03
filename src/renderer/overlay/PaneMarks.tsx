// Spec 16 §4.2 — the marks a pane draws, whichever version it is showing.
//
// Spec 15 said of the left pane: *"it hands up no surface, so no anchor is ever
// created or resolved against it."* §4.2 reverses that half. Once the original
// takes a comment it needs everything a commented pane needs — the outlines
// round what resolved here, the numbered boxes of what is being selected, and
// the lane of bars down the side — and it needs them drawn by the same code, or
// the two panes disagree about what a mark means.
//
// What stays true is the other half: the original is not a second document
// under review, and nothing typed against it ever edits it.

import type { ThreadWithMessages } from "../../shared/types.ts";
import { inflateRect, type ScopeRect } from "../anchor/pick.ts";
import type { ResolvedThread } from "./anchoring.ts";
import { hugOf } from "./hug.ts";
import { Trash } from "./Icons.tsx";
import { MarginBars } from "./MarginBars.tsx";
import { MARK_REACH } from "./marginLane.ts";

/** One place the selection panel is holding, as this pane draws it. */
export interface DraftMark {
  id: string;
  /** Its row's number in the panel, so nine cells and nine rows can be paired. */
  number: number;
  box: ScopeRect;
  /**
   * The lines of a passage, when the place is one. The outline is drawn to
   * follow them; `box` is where the two buttons hang, which keeps them in the
   * margins rather than over the prose whatever shape the passage has.
   */
  lines: ScopeRect[] | null;
}

interface Props {
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  hoveredThreadId: string | null;
  marks: DraftMark[];
  hoveredItemId: string | null;
  scrollX: number;
  scrollY: number;
  onHoverItem: (id: string | null) => void;
  onRemoveItem: (id: string) => void;
  /** Spec 26 §4.5 — put this place on the path bar, so ↑ ↓ move it. */
  onFocusItem: (id: string) => void;
  onSelectMarker: (threadId: string) => void;
  onHoverThread: (threadId: string | null) => void;
}

export function PaneMarks(props: Props): React.JSX.Element {
  // One outline per checked target, so a comment written against three rows
  // shows all three. The thread id alone is not unique, hence the position.
  const blocks = props.resolved.flatMap((entry) => {
    // Spec 06 §6.4 — a run is outlined, never filled, so it needs to be told
    // apart from an ordinary block box. The anchor already says: only the two
    // scopes that cover more than the thing they name carry an extent.
    const thread = props.threads.find((one) => one.id === entry.threadId);
    return entry.checked
      .filter((check) => check.box !== null)
      .map((check) => ({
        entry,
        check,
        box: check.box as ScopeRect,
        run: Boolean(thread?.targets[check.position]?.anchor.extent),
      }));
  });

  return (
    <>
      {/*
        Every place the selection is about, outlined at once. A list of nine
        cells in the panel does not tell the reviewer *which* nine, and the
        whole reason to comment on nine cells is that their arrangement matters.
        Drawn from the rect captured at the click, so no anchor has to be
        resolved before the comment exists.
      */}
      {props.marks.map((mark) => {
        // A passage is drawn as the shape of its own lines; a table, a figure
        // or a region keeps the plain box, because there the box IS the thing.
        const hug = mark.lines ? hugOf(mark.lines) : null;
        return (
          <div
            key={mark.id}
            className={`rex-draft-outline${hug ? " rex-draft-outline-hug" : ""}${
              props.hoveredItemId === mark.id ? " rex-draft-outline-lit" : ""
            }`}
            style={{
              left: mark.box.x - props.scrollX,
              top: mark.box.y - props.scrollY,
              width: mark.box.w,
              height: mark.box.h,
            }}
            onMouseEnter={() => props.onHoverItem(mark.id)}
            onMouseLeave={() => props.onHoverItem(null)}
          >
            {/*
            The outline itself, when the place is a passage. Its geometry is in
            `hug.ts`; all this does is put it where the lines were measured.
            `aria-hidden`, because the shape says nothing the panel's own row
            does not say in words.
          */}
            {hug ? (
              <svg
                className="rex-draft-shape"
                aria-hidden="true"
                width={hug.box.w}
                height={hug.box.h}
                viewBox={`0 0 ${hug.box.w} ${hug.box.h}`}
                style={{ left: hug.box.x - mark.box.x, top: hug.box.y - mark.box.y }}
              >
                {hug.paths.map((path) => (
                  <path key={path} d={path} />
                ))}
              </svg>
            ) : null}

            {/*
            Spec 26 §4.5 — the badge takes the bar to this place. It is the
            shortest route to "not that, the section" while the reviewer is
            looking at the page rather than at the sidebar, and it costs no new
            affordance: the badge was already the one part of the outline that
            takes the mouse.
          */}
            <button
              type="button"
              className="rex-draft-index"
              aria-label={`Widen or narrow place ${mark.number}`}
              title="Widen or narrow this place — ↑ ↓, or the crumbs at the foot"
              onClick={() => props.onFocusItem(mark.id)}
            >
              {mark.number}
            </button>
            {/*
            Dropping a place without going to find its row in the panel. It
            mirrors the number badge across the box — badge left, trash right —
            and like the badge it is the only other part of the outline that
            takes the mouse, sitting in the margin rather than over the prose.
          */}
            <button
              type="button"
              className="rex-draft-remove"
              aria-label={`Remove place ${mark.number} from the selection`}
              title="Remove this place"
              onClick={() => props.onRemoveItem(mark.id)}
            >
              <Trash size={11} />
            </button>
          </div>
        );
      })}

      {/*
        An anchor on a whole element or a region of one is an outline, not a
        fill: the Custom Highlight API paints ranges, so there is no range to
        paint here — and drawing it as an overlay box keeps the promise that
        REX never touches the document's own tree.
      */}
      {blocks.map(({ entry, check, box, run }) => {
        // §6.4 — the ring is drawn OUTSIDE the block, not on it. Drawn on the
        // box its border ran down the first column of pixels of every line and
        // read as touching the letters. `MARK_REACH` is what the bar lane is
        // told to clear, so the two marks cannot grow into each other.
        const ring = inflateRect(box, MARK_REACH);
        return (
          <div
            key={`${entry.threadId}-${check.position}`}
            className={`rex-block-outline${check.state === "moved" ? " rex-block-moved" : ""}${
              props.activeId === entry.threadId ? " rex-block-active" : ""
            }${run ? " rex-block-run" : ""}`}
            style={{
              left: ring.x - props.scrollX,
              top: ring.y - props.scrollY,
              width: ring.w,
              height: ring.h,
            }}
          />
        );
      })}

      {/*
        Spec 15 §8 — one bar per comment, in the lane beside its block, with the
        number inside it. Spec 16 §7.2 — each pane draws the bars for the
        targets that resolved in IT, so the two lanes read as a diff of the
        review as well as of the text.
      */}
      <MarginBars
        resolved={props.resolved}
        threads={props.threads}
        activeId={props.activeId}
        hoveredThreadId={props.hoveredThreadId}
        scrollX={props.scrollX}
        scrollY={props.scrollY}
        onSelect={props.onSelectMarker}
        onHover={props.onHoverThread}
      />
    </>
  );
}
