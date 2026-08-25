// Spec 11 §7 — the structural map of a deck: which part is which slide, and
// which shape on it answers to a name.
//
// Two facts drive everything here, and both are easy to get wrong:
//
// 1. **A slide's position is not its file number.** `ppt/slides/slide7.xml` can
//    be the fourth slide. Order lives in `<p:sldIdLst>` in
//    `ppt/presentation.xml`, which points at relationship ids, which
//    `ppt/_rels/presentation.xml.rels` resolves to part paths. §7.6.1 depends on
//    exactly this: a reorder rewrites the list and renames nothing.
// 2. **A shape is addressed by name, never by index** (§7.2.2 rule 2). The name
//    is `<p:cNvPr name="…">`, which is what the reader puts in `data-name` and
//    what the reviewer, the sidecar and the plan all call it.

import type { DeckPackage } from "./package.ts";
import { attributeOf, type ElementSpan, firstElement, scanElements } from "./xml.ts";

export const PRESENTATION_PART = "ppt/presentation.xml";

/** `ppt/slides/slide4.xml` → `ppt/slides/_rels/slide4.xml.rels`. */
export function relsPathFor(partPath: string): string {
  const cut = partPath.lastIndexOf("/");
  return `${partPath.slice(0, cut)}/_rels/${partPath.slice(cut + 1)}.rels`;
}

/** A relationship target is relative to the *owning part's* directory. */
export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = partPath.slice(0, partPath.lastIndexOf("/"));
  const segments = `${base}/${target}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
  /** Absent for an external target, which REX never follows. */
  external: boolean;
}

export function parseRelationships(xml: string): Relationship[] {
  return scanElements(xml, "Relationship").map((span) => ({
    id: attributeOf(xml, span, "Id") ?? "",
    type: attributeOf(xml, span, "Type") ?? "",
    target: attributeOf(xml, span, "Target") ?? "",
    external: attributeOf(xml, span, "TargetMode") === "External",
  }));
}

export interface DeckMap {
  /** Slide part paths in **presentation order**; index 0 is slide 1. */
  slides: string[];
  /** The `r:id` on each `<p:sldId>`, in the same order. */
  relIds: string[];
  /** The `id` on each `<p:sldId>`, in the same order. */
  slideIds: string[];
}

const SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

export async function readDeckMap(pkg: DeckPackage): Promise<DeckMap> {
  const presentation = await pkg.readText(PRESENTATION_PART);
  const rels = parseRelationships(await pkg.readText(relsPathFor(PRESENTATION_PART)));
  const byId = new Map(
    rels.filter((rel) => rel.type === SLIDE_REL_TYPE).map((rel) => [rel.id, rel]),
  );

  const list = firstElement(presentation, "p:sldIdLst");
  if (!list) throw new Error("This deck has no slide list — ppt/presentation.xml is not readable.");

  const slides: string[] = [];
  const relIds: string[] = [];
  const slideIds: string[] = [];
  for (const span of scanElements(presentation, "p:sldId", list.openEnd, list.innerEnd)) {
    const relId = attributeOf(presentation, span, "r:id") ?? "";
    const rel = byId.get(relId);
    if (!rel) throw new Error(`Slide entry ${relId} has no relationship in this deck.`);
    slides.push(resolveTarget(PRESENTATION_PART, rel.target));
    relIds.push(relId);
    slideIds.push(attributeOf(presentation, span, "id") ?? "");
  }
  return { slides, relIds, slideIds };
}

/** The slide part for a 1-based presentation position, or a refusal. */
export function slidePartAt(map: DeckMap, position: number): string {
  const part = map.slides[position - 1];
  if (!part) {
    throw new Error(`This deck has ${map.slides.length} slides, so there is no slide ${position}.`);
  }
  return part;
}

/** Every kind of thing that can sit directly in a slide's shape tree. */
export const SHAPE_TAGS = ["p:sp", "p:pic", "p:graphicFrame", "p:grpSp", "p:cxnSp"] as const;
export type ShapeTag = (typeof SHAPE_TAGS)[number];

export interface ShapeSpan {
  tag: ShapeTag;
  span: ElementSpan;
  name: string;
  /** The OOXML shape id, which the reader cannot see and an edit must not break. */
  id: string;
}

/** The `<p:spTree>` of a slide part. */
export function shapeTreeOf(slideXml: string): ElementSpan {
  const tree = firstElement(slideXml, "p:spTree");
  if (!tree) throw new Error("This slide has no shape tree.");
  return tree;
}

/**
 * Every top-level shape on the slide, in document order — which is also paint
 * order, and therefore the order the reader numbers `slide-N-shape-M` in.
 */
export function shapesOf(slideXml: string): ShapeSpan[] {
  const tree = shapeTreeOf(slideXml);
  const found: ShapeSpan[] = [];

  for (const tag of SHAPE_TAGS) {
    for (const span of scanElements(slideXml, tag, tree.openEnd, tree.innerEnd)) {
      const properties = firstElement(slideXml, "p:cNvPr", span.openEnd, span.innerEnd);
      found.push({
        tag,
        span,
        name: properties ? (attributeOf(slideXml, properties, "name") ?? "") : "",
        id: properties ? (attributeOf(slideXml, properties, "id") ?? "") : "",
      });
    }
  }

  return found.sort((a, b) => a.span.start - b.span.start);
}

/**
 * The one shape with this name, or a refusal naming what is actually there.
 *
 * A duplicate name is refused rather than resolved by position: PowerPoint
 * allows two shapes called "Text 4", and picking one of them by index is the
 * silent wrong-place failure §5.2 exists to prevent, moved from anchoring into
 * editing.
 */
export function findShape(slideXml: string, name: string): ShapeSpan {
  const shapes = shapesOf(slideXml);
  const matches = shapes.filter((shape) => shape.name === name);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const available = shapes
      .map((shape) => shape.name)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `No shape named '${name}' on this slide. It has: ${available || "no named shapes"}.`,
    );
  }
  throw new Error(
    `This slide has ${matches.length} shapes named '${name}', so the operation cannot say which one it means.`,
  );
}
