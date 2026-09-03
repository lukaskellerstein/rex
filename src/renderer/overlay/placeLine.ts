// Spec 35 §2.3 — one place's line on the card, in cells: where it is, how big
// it is, and what kind of thing it is. Never what it says.
//
// The card used to quote the place — a heading, a sentence, a flattened table
// row in italic serif — and the reviewer's verdict was that a head is not
// where anyone reads a document. So a place is described the way a file
// listing describes a file: an address and a size. The paper, one `go to`
// away, is where the words are.
//
// A `.ts` module rather than a corner of `CommentCard.tsx`, so `node --test`
// can load it — plain node cannot read `.tsx`.

import type { Anchor, AnchorState, AnchorTarget } from "../../shared/types.ts";
import { storedPlaceLabel } from "./place.ts";

/**
 * Spec 24 §3.4, completed by spec 37 §3 — which places each of the reviewer's
 * messages brought, as positions in `thread.targets`.
 *
 * A place carries the id of the message it arrived with (spec 24 §5.1), and
 * the places the comment was CREATED with carry none: they belong to the first
 * `YOU` message, which `threadAsk` sends verbatim as the conversation's
 * opening. The card draws them as pills and the trace sheet as rows (spec 38
 * §3.2), from this one answer, so the two cannot disagree about which message
 * was about what.
 */
export interface PlacesByMessage {
  /** The places with no message — the first `YOU`'s. In target order. */
  startedWith: number[];
  /** The rest, by the id of the message that brought them. In target order. */
  byMessage: Map<string, number[]>;
}

export function placesByMessage(targets: readonly AnchorTarget[]): PlacesByMessage {
  const startedWith: number[] = [];
  const byMessage = new Map<string, number[]>();
  targets.forEach((target, position) => {
    if (target.messageId === null) {
      startedWith.push(position);
      return;
    }
    const positions = byMessage.get(target.messageId) ?? [];
    positions.push(position);
    byMessage.set(target.messageId, positions);
  });
  return { startedWith, byMessage };
}

/** What the sweep found out about one place, or nothing where it could not look. */
export interface PlaceFacts {
  /** What it IS, when its text is not prose — `Code block`, `Table · 3 × 4`. */
  label: string | null;
  /** The line it starts on now, from `data-src-line`. */
  line: number | null;
  /** The line it ends on now — spec 35 §3. Null where the format has no lines. */
  lineEnd: number | null;
}

export const NO_FACTS: PlaceFacts = { label: null, line: null, lineEnd: null };

export interface PlaceCells {
  /** `L794–812`, `L954`, `page 3`, `slide 4` — or null. */
  where: string | null;
  /** The place is the whole file: the where-cell says so instead of a range. */
  whole: boolean;
  /** `19 lines`, `1 line`, `1018 lines` — or null when the extent is not known. */
  size: string | null;
  /** `section`, `table row`, `passage`… — or null for a whole file. */
  kind: string | null;
  /** The line it was written on, when it is somewhere else now. */
  was: number | null;
  /** Nobody has looked — its document has not been open. Spec 05 §5.4. */
  unchecked: boolean;
}

/** The label the sweep gives a whole document, and the one `place.ts` stores. */
const WHOLE = "The whole document";

/**
 * The words `describeElement` and `storedPlaceLabel` put before the ` · `,
 * turned into the kind a listing prints. The head of a label is a name for
 * what the block is — `Table`, `Code block`, `Row 3`, `Region of Table` — and
 * the kind is that name in the panel's own lower case, with the two table
 * parts said in full because `row` and `cell` alone say nothing.
 */
function kindOfLabel(label: string): string {
  const head = label.split(" · ")[0].trim();
  if (/^Region of /.test(head)) return "region";
  const bare = head.replace(/\s+\d+$/, "").toLowerCase();
  if (bare === "row") return "table row";
  if (bare === "cell") return "table cell";
  return bare;
}

/**
 * The kind, from the anchor first and the label second.
 *
 * The anchor knows what it was MADE as — a gap, a section, a diagram part —
 * and that outranks what the DOM under it looks like now. A label names a
 * block; no label at all means the place holds prose, which is the one kind
 * that is never labelled, so it is named here.
 */
function kindOf(anchor: Anchor, label: string | null): string {
  if (anchor.gap) return "gap";
  if (anchor.extent === "section") return "section";
  if (label) return kindOfLabel(label);
  return "passage";
}

/** `Page 3` or `Slide 4` at the head of a label, as the where-cell says it. */
function pageOf(label: string | null): string | null {
  const match = label?.match(/^(Page|Slide)\s+(\d+)/i);
  return match ? `${match[1].toLowerCase()} ${match[2]}` : null;
}

function lines(n: number): string {
  return `${n} line${n === 1 ? "" : "s"}`;
}

/**
 * `facts` is what the sweep found — nothing, where the document is not open —
 * and `state` is the place's state, null when nobody looked. The stored
 * anchor fills in what the sweep could not: its start line and its label.
 */
export function placeCells(
  anchor: Anchor,
  facts: PlaceFacts,
  state: AnchorState | null,
): PlaceCells {
  const label = facts.label ?? storedPlaceLabel(anchor);
  const whole = anchor.extent === "document" || label === WHOLE;
  const stored = anchor.source?.line ?? null;
  const from = facts.line ?? stored;
  const to = facts.line !== null ? facts.lineEnd : null;

  return {
    where: whole
      ? null
      : from === null
        ? pageOf(label)
        : to !== null && to > from
          ? `L${from}–${to}`
          : `L${from}`,
    whole,
    size: whole
      ? // A whole file starts at line 1, so its last line is its length.
        to !== null
        ? lines(to)
        : null
      : from !== null && to !== null
        ? lines(Math.max(1, to - from + 1))
        : null,
    kind: whole ? null : kindOf(anchor, label),
    // Only a place the sweep has seen can be somewhere else than it was.
    was: facts.line !== null && stored !== null && facts.line !== stored ? stored : null,
    unchecked: state === null,
  };
}
