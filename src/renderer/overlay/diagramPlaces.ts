// Spec 29 §4.2 — what the lightbox draws over a diagram besides the drawing:
// the places already taken on it, numbered as the panel numbers them, and the
// comments that already exist on its parts.
//
// Pure functions over the state `App` already holds, so the lightbox learns
// nothing about the panel, the pending strips or the thread list — it is
// handed two arrays and draws them.

import type { OpenedDocument, ThreadWithMessages } from "../../shared/types.ts";
import type { LightboxComment, LightboxPlace } from "./Lightbox.tsx";
import type { PreviewFigure } from "./preview.ts";
import type { SelectionItem } from "./selection.ts";

/** Whether a stored anchor is a part of the diagram the lightbox is showing. */
function onDiagram(
  item: { anchor: SelectionItem["anchor"]; documentId: string },
  figure: Extract<PreviewFigure, { kind: "diagram" }>,
  documentId: string,
): boolean {
  return (
    item.documentId === documentId &&
    item.anchor.diagram !== undefined &&
    item.anchor.element?.id === figure.blockId
  );
}

/**
 * The places on this diagram, with the number each carries on screen.
 *
 * A panel row is numbered by its position in the panel. A place in an open
 * comment's pending strip (spec 24 §3.2) continues that comment's own numbering
 * — its targets first, then the strip — which is what the strip's chips show.
 * The figure is always the current pane's (`DocumentView` is the only pane
 * that opens a preview), so places taken in the original pane are not it.
 */
export function diagramPlacesFor(
  figure: PreviewFigure,
  selection: readonly SelectionItem[],
  pending: ReadonlyMap<string, SelectionItem[]>,
  threads: readonly ThreadWithMessages[],
  doc: OpenedDocument | null,
): LightboxPlace[] {
  if (figure.kind !== "diagram" || !doc) return [];
  const places: LightboxPlace[] = [];
  selection.forEach((item, at) => {
    if (item.pane === "current" && onDiagram(item, figure, doc.documentId) && item.anchor.diagram) {
      places.push({ number: at + 1, part: item.anchor.diagram.part });
    }
  });
  for (const [threadId, list] of pending) {
    const offset = threads.find((thread) => thread.id === threadId)?.targets.length ?? 0;
    list.forEach((item, at) => {
      if (
        item.pane === "current" &&
        onDiagram(item, figure, doc.documentId) &&
        item.anchor.diagram
      ) {
        places.push({ number: offset + at + 1, part: item.anchor.diagram.part });
      }
    });
  }
  return places;
}

/** The comments that already sit on a part of this diagram, with the state the last sweep gave them. */
export function diagramCommentsFor(
  figure: PreviewFigure,
  threads: readonly ThreadWithMessages[],
  doc: OpenedDocument | null,
): LightboxComment[] {
  if (figure.kind !== "diagram" || !doc) return [];
  const comments: LightboxComment[] = [];
  for (const thread of threads) {
    for (const target of thread.targets) {
      if (onDiagram(target, figure, doc.documentId) && target.anchor.diagram) {
        // Null is "nobody looked" (spec 05 §5.4), not orphaned; drawn as ok.
        comments.push({ part: target.anchor.diagram.part, state: target.state ?? "ok" });
      }
    }
  }
  return comments;
}
