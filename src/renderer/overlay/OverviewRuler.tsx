// Spec 64 — the overview ruler: the whole document, at the right edge of a pane.
//
// Spec 28 §4.1.1 built the strip for a find's matches. It now carries three
// kinds of mark and the band (§3): the part of the document on screen; where
// the comments are while reading, or the change while comparing, in the left
// lane; and a find's matches in the right lane, so a find and a comment at one
// height are both visible (§4).
//
// VS Code draws these marks in the scrollbar's track. The frame's scrollbar
// belongs to the iframe and the overlay cannot paint in it, so the strip sits
// over that lane instead: the strip and the band take no pointer events and
// every mark does, so the scrollbar under it keeps working wherever a mark is
// not (spec 28 §5.6). Marks stay off the tab order, as spec 28 decided.
//
// **Nothing here adds a trigger** (§4). The page is read on every render, and
// every reason a mark moves — a sweep, a resize, a zoom, a reflow, a new
// revision — already renders the pane, as the frame's `scroll` does.

import type { FindMark, ThreadWithMessages } from "../../shared/types.ts";
import { bringBoxIntoView, type ResolvedThread } from "./anchoring.ts";
import type { ChangeBox } from "./changes.ts";
import { pageExtent } from "./frame.ts";
import { bandOf, changeMarks, commentMarks, type RulerMark, type RulerSpan } from "./rulerMarks.ts";

/** Spec 28 §4.1.1 — a find's marks, handed to the pane being read. */
export interface FindMarks {
  marks: FindMark[];
  /** The current match's index, or -1. Its mark is stronger and a pixel wider. */
  current: number;
  onPick: (ordinal: number) => void;
}

/** §3.1 — what the margin bars draw from, filtered by the lane chips already. */
export interface CommentSource {
  resolved: ResolvedThread[];
  threads: ThreadWithMessages[];
  activeId: string | null;
  hoveredThreadId: string | null;
}

interface Props {
  frame: React.RefObject<HTMLIFrameElement | null>;
  /** §3 — null while comparing: the reviewer is reading the change (spec 63 §5). */
  comments: CommentSource | null;
  /** §3.2 — the same boxes the pane outlines. */
  changes: ChangeBox[];
  /** Null unless a find stands in this pane. */
  find: FindMarks | null;
  /** §5 — what clicking the comment's margin bar does. */
  onSelectMarker: (threadId: string) => void;
}

/** At least 2px, so a one-line target on a long page still shows (§4). */
function placed(span: RulerSpan): React.CSSProperties {
  return { top: `${span.top * 100}%`, height: `max(${span.height * 100}%, 2px)` };
}

export function OverviewRuler(props: Props): React.JSX.Element | null {
  const frame = props.frame.current;
  const extent = pageExtent(frame);
  const band = extent ? bandOf(extent) : null;
  if (!extent || !band) return null;

  const { comments, find } = props;
  const marks = [
    ...(comments
      ? commentMarks(
          comments.resolved,
          comments.threads,
          comments.activeId,
          comments.hoveredThreadId,
          extent.total,
        )
      : []),
    ...changeMarks(props.changes, extent.total),
  ];

  // §5 — a comment opens as its bar would open it; either kind is then brought
  // into view by REX's one rule for that.
  const pick = (mark: RulerMark): void => {
    if (mark.threadId) props.onSelectMarker(mark.threadId);
    const view = props.frame.current?.contentWindow;
    if (view) bringBoxIntoView(view, mark.box);
  };

  return (
    <div className="rex-ruler">
      <div className="rex-ruler-band" style={placed(band)} />
      {marks.map((mark) => (
        <button
          key={mark.key}
          type="button"
          tabIndex={-1}
          className={`rex-ruler-mark rex-ruler-lane ${mark.className}`}
          style={placed(mark)}
          aria-label={mark.title}
          title={mark.title}
          onClick={() => pick(mark)}
        />
      ))}
      {find?.marks.map((mark, at) => (
        <button
          // Position is identity here: two matches cannot share a top.
          key={`${mark.top}-${at}`}
          type="button"
          // Off the tab order: a thousand stops on one page is not navigation.
          tabIndex={-1}
          className={`rex-ruler-mark rex-ruler-find${at === find.current ? " rex-ruler-current" : ""}`}
          style={placed(mark)}
          aria-label={`Match ${at + 1} of ${find.marks.length}`}
          title={`Match ${at + 1} of ${find.marks.length}`}
          onClick={() => find.onPick(at)}
        />
      ))}
    </div>
  );
}
