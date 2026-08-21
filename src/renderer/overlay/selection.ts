// Spec 05 §3 — what is in the selection panel, and the three rules that decide
// whether something new joins it.
//
// The rules are here rather than in `App.tsx` because they are the whole
// definition of "what counts as a selection" and they are pure: a list in, a
// list out. §3.1 warns that reading with the mouse now leaves rows behind, and
// these are what keep that from being unusable.

import { v4 as uuidv4 } from "uuid";
import type { Anchor, DocumentRef, RegionRef } from "../../shared/types.ts";
import type { ScopeRect } from "../anchor/pick.ts";
import type { SelectedKind } from "./anchoring.ts";

/** Spec 05 §3.5 — one row of the panel. */
export interface SelectionItem {
  /** Stable for the life of the item; the React key and the hover pairing id. */
  id: string;
  /**
   * Which gesture made it — a run of text, or a thing on the page.
   *
   * Kept because the anchor cannot say: `create.ts` gives a text anchor and an
   * element anchor the same fields. Without it, rebuilding the widening chain
   * (§4.1) offered `text` as the chosen scope for a comment stored on a table
   * cell.
   */
  kind: SelectedKind;
  documentId: string;
  /**
   * The whole ref, not a path, so a row can reopen its document with the
   * `doc:open` that exists — and so a tier 2 URL document works here too.
   */
  documentRef: DocumentRef;
  /** Shown in the row: the file name, or the host for a URL. Not the whole path. */
  documentName: string;
  anchor: Anchor;
  /** The row's own words — the quote, or `Table · 7 rows × 4 columns`. */
  label: string;
  /**
   * Where it sits, in document coordinates, and the zoom that was measured at.
   * Spec 04 §4.5: the outline is redrawn from these, rescaled, so a half-built
   * selection outlives a zoom change.
   *
   * Null once the anchor stops resolving in the open document — a place whose
   * thing has gone keeps its row, because the reviewer chose it, but it must
   * not keep a box: an outline in the old spot points at whatever moved into
   * it. Every sweep re-measures this (`DocumentSurface.rectsForAnchors`).
   */
  rect: ScopeRect | null;
  zoom: number;
}

export function newSelectionItem(fields: Omit<SelectionItem, "id">): SelectionItem {
  return { id: uuidv4(), ...fields };
}

function sameRegion(a: RegionRef | null, b: RegionRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * §3.1 rule 3 — the same place, picked twice.
 *
 * Two *different* regions of one figure are not duplicates and both are kept:
 * spec 04 already treats commenting on two parts of one drawing as legitimate,
 * and they differ in exactly the field compared here.
 */
function isDuplicate(a: SelectionItem, b: SelectionItem): boolean {
  return (
    a.documentId === b.documentId &&
    (a.anchor.element?.id ?? null) === (b.anchor.element?.id ?? null) &&
    (a.anchor.element?.css ?? null) === (b.anchor.element?.css ?? null) &&
    (a.anchor.quote?.exact ?? null) === (b.anchor.quote?.exact ?? null) &&
    sameRegion(a.anchor.region, b.anchor.region)
  );
}

/**
 * §3.1 rule 2 — the two anchors cover some of the same normalised text.
 *
 * Both need a `position`, which is what the resolver stores for anything with
 * text. Without one on either side there is nothing to compare and the answer is
 * no, which errs towards keeping a row the reviewer can see and remove.
 */
function overlaps(a: SelectionItem, b: SelectionItem): boolean {
  if (a.documentId !== b.documentId) return false;
  const first = a.anchor.position;
  const second = b.anchor.position;
  if (!first || !second) return false;
  return first.start < second.end && second.start < first.end;
}

/**
 * §3.1 — everything selected is added, with three exceptions.
 *
 * 1. Rule 1 (a selection under three characters) is enforced in the surface, as
 *    close to the gesture as it can be, so it never reaches here.
 * 2. An exact duplicate is refused silently — the list comes back unchanged.
 * 3. A selection overlapping the **newest** row replaces it: dragging out a
 *    sentence, letting go, then extending it is one act.
 */
export function addSelectionItem(
  items: readonly SelectionItem[],
  next: SelectionItem,
): SelectionItem[] {
  if (items.some((item) => isDuplicate(item, next))) return [...items];

  const newest = items.at(-1);
  if (newest && overlaps(newest, next)) return [...items.slice(0, -1), next];

  return [...items, next];
}

/** Drag-reorder, §3.2. `targets[0]` is what Apply's prompt leads with. */
export function moveSelectionItem(
  items: readonly SelectionItem[],
  from: number,
  to: number,
): SelectionItem[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
