// Spec 11 §7.6 — the three operations that change the deck rather than a slide.
//
// The one that matters most is the cheapest. **Slide order lives entirely in
// `<p:sldIdLst>`**, so moving slide 7 before slide 5 reorders a list of
// `<p:sldId>` elements and nothing else: no part is added, removed, renamed or
// rewritten, `slide7.xml` keeps its name and its contents, and the file
// numbering never has to match the presentation order. A reorder that rewrote
// parts would be a rebuild, which is what §2.4 rejected `pptx-automizer` for.
//
// `deleteSlide` carries the piece that is easy to skip and invisible when it
// is: the **orphan sweep**. A deck that keeps the media of deleted slides grows
// every time it is edited and nothing about it looks wrong. §7.8 checks for it,
// so a missed sweep fails the run rather than shipping.

import type { OoxmlPackage } from "../ooxml/package.ts";
import { escapeXml, firstElement, scanElements, splice } from "../ooxml/xml.ts";
import { type DeckMap, PRESENTATION_PART, relsPathFor, resolveTarget } from "./deck.ts";
import { sweepOrphanMedia } from "./parts.ts";

const CONTENT_TYPES = "[Content_Types].xml";
const SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const NOTES_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

/**
 * §7.6.1 — a new order, written into the one place order lives.
 *
 * `order` is a full permutation of the current positions, which the plan schema
 * has already checked: "move 7 to position 4" reads as an instruction whose
 * meaning depends on what else moved, and a full permutation cannot be
 * ambiguous.
 */
export async function reorderSlides(pkg: OoxmlPackage, order: readonly number[]): Promise<void> {
  const xml = await pkg.readText(PRESENTATION_PART);
  const list = firstElement(xml, "p:sldIdLst");
  if (!list) throw new Error("This deck has no slide list.");

  const entries = scanElements(xml, "p:sldId", list.openEnd, list.innerEnd);
  if (entries.length !== order.length) {
    throw new Error(
      `This deck has ${entries.length} slides and the new order names ${order.length}.`,
    );
  }

  // The elements are moved verbatim, so each slide keeps its own id and its own
  // relationship. Rebuilding them would be a chance to lose one.
  const moved = order.map((position) =>
    xml.slice(entries[position - 1].start, entries[position - 1].end),
  );
  pkg.write(PRESENTATION_PART, splice(xml, list.openEnd, list.innerEnd, moved.join("")));
}

/** A part path in `directory` that nothing in the package uses yet. */
function freePart(pkg: OoxmlPackage, directory: string, stem: string, extension: string): string {
  const taken = new Set(pkg.paths());
  for (let n = 1; ; n++) {
    const candidate = `${directory}/${stem}${n}.${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A `<p:sldId>` id nothing in the list already uses. Office starts these at 256. */
function freeSlideId(presentationXml: string): number {
  let highest = 255;
  const list = firstElement(presentationXml, "p:sldIdLst");
  if (!list) return 256;
  for (const span of scanElements(presentationXml, "p:sldId", list.openEnd, list.innerEnd)) {
    const id = Number(
      /\sid="(\d+)"/.exec(presentationXml.slice(span.start, span.openEnd))?.[1] ?? 0,
    );
    if (id > highest) highest = id;
  }
  return highest + 1;
}

function freeRelationshipId(relsXml: string): string {
  let highest = 0;
  for (const span of scanElements(relsXml, "Relationship")) {
    const id = Number(/\sId="rId(\d+)"/.exec(relsXml.slice(span.start, span.openEnd))?.[1] ?? 0);
    if (id > highest) highest = id;
  }
  return `rId${highest + 1}`;
}

export interface DuplicateOutcome {
  newPart: string;
  /** True when the source slide's speaker notes were left behind (§7.6.2). */
  droppedNotes: boolean;
}

/**
 * §7.6.2 — copy a slide, its `.rels` and its media references.
 *
 * This, followed by `setText` and `insertImage`, is **how a new slide is made**.
 * It produces a better slide than building one from a layout would, because it
 * starts from a slide a human already approved: creating one from a bare layout
 * means resolving placeholder inheritance to work out where anything goes, for
 * a worse result.
 */
export async function duplicateSlide(
  pkg: OoxmlPackage,
  map: DeckMap,
  position: number,
): Promise<DuplicateOutcome> {
  const sourcePart = map.slides[position - 1];
  if (!sourcePart) throw new Error(`This deck has no slide ${position}.`);

  const newPart = freePart(pkg, "ppt/slides", "slide", "xml");
  pkg.write(newPart, await pkg.read(sourcePart));

  // The copy's relationships are the source's, minus its notes. A notes part
  // carries a relationship back to the slide it belongs to, so two slides
  // sharing one is a deck PowerPoint offers to repair.
  const sourceRels = relsPathFor(sourcePart);
  let droppedNotes = false;
  if (pkg.has(sourceRels)) {
    let relsXml = await pkg.readText(sourceRels);
    for (const span of [...scanElements(relsXml, "Relationship")].reverse()) {
      const tag = relsXml.slice(span.start, span.openEnd);
      if (tag.includes(NOTES_REL_TYPE)) {
        relsXml = splice(relsXml, span.start, span.end, "");
        droppedNotes = true;
      }
    }
    pkg.write(relsPathFor(newPart), relsXml);
  }

  const types = await pkg.readText(CONTENT_TYPES);
  const typesList = firstElement(types, "Types");
  if (!typesList) throw new Error("[Content_Types].xml is not readable.");
  pkg.write(
    CONTENT_TYPES,
    splice(
      types,
      typesList.innerEnd,
      typesList.innerEnd,
      `<Override PartName="/${escapeXml(newPart)}" ContentType="${SLIDE_CONTENT_TYPE}"/>`,
    ),
  );

  const presentationRelsPath = relsPathFor(PRESENTATION_PART);
  const presentationRels = await pkg.readText(presentationRelsPath);
  const relationshipId = freeRelationshipId(presentationRels);
  const relsList = firstElement(presentationRels, "Relationships");
  if (!relsList) throw new Error("The presentation's relationships are not readable.");
  pkg.write(
    presentationRelsPath,
    splice(
      presentationRels,
      relsList.innerEnd,
      relsList.innerEnd,
      `<Relationship Id="${relationshipId}" Type="${SLIDE_REL_TYPE}" Target="${escapeXml(newPart.replace("ppt/", ""))}"/>`,
    ),
  );

  const presentation = await pkg.readText(PRESENTATION_PART);
  const list = firstElement(presentation, "p:sldIdLst");
  if (!list) throw new Error("This deck has no slide list.");
  const entries = scanElements(presentation, "p:sldId", list.openEnd, list.innerEnd);
  const after = entries[position - 1];
  if (!after) throw new Error(`This deck has no slide ${position}.`);

  // Directly after its source, which is where a duplicate belongs and where a
  // reviewer will look for it.
  pkg.write(
    PRESENTATION_PART,
    splice(
      presentation,
      after.end,
      after.end,
      `<p:sldId id="${freeSlideId(presentation)}" r:id="${relationshipId}"/>`,
    ),
  );

  return { newPart, droppedNotes };
}

export interface DeleteOutcome {
  /** Media parts nothing referenced any more, removed by the sweep (§7.6.3). */
  sweptMedia: string[];
}

/** §7.6.3 — remove a slide, and everything that was only there for it. */
export async function deleteSlide(
  pkg: OoxmlPackage,
  map: DeckMap,
  position: number,
): Promise<DeleteOutcome> {
  const part = map.slides[position - 1];
  if (!part) throw new Error(`This deck has no slide ${position}.`);
  if (map.slides.length === 1) throw new Error("A deck must keep at least one slide.");

  const relationshipId = map.relIds[position - 1];

  const presentation = await pkg.readText(PRESENTATION_PART);
  const list = firstElement(presentation, "p:sldIdLst");
  if (!list) throw new Error("This deck has no slide list.");
  const entry = scanElements(presentation, "p:sldId", list.openEnd, list.innerEnd)[position - 1];
  if (!entry) throw new Error(`This deck has no slide ${position}.`);
  pkg.write(PRESENTATION_PART, splice(presentation, entry.start, entry.end, ""));

  const presentationRelsPath = relsPathFor(PRESENTATION_PART);
  const presentationRels = await pkg.readText(presentationRelsPath);
  for (const span of [...scanElements(presentationRels, "Relationship")].reverse()) {
    const tag = presentationRels.slice(span.start, span.openEnd);
    if (tag.includes(`Id="${relationshipId}"`)) {
      pkg.write(presentationRelsPath, splice(presentationRels, span.start, span.end, ""));
      break;
    }
  }

  // The slide's own parts. Its notes go with it: a notes slide exists only for
  // the slide it belongs to.
  const relsPath = relsPathFor(part);
  if (pkg.has(relsPath)) {
    for (const rel of scanElements(await pkg.readText(relsPath), "Relationship")) {
      const xml = await pkg.readText(relsPath);
      const tag = xml.slice(rel.start, rel.openEnd);
      if (!tag.includes(NOTES_REL_TYPE)) continue;
      const target = /\sTarget="([^"]+)"/.exec(tag)?.[1];
      if (!target) continue;
      const notes = resolveTarget(part, target);
      pkg.remove(notes);
      if (pkg.has(relsPathFor(notes))) pkg.remove(relsPathFor(notes));
    }
    pkg.remove(relsPath);
  }
  pkg.remove(part);

  const types = await pkg.readText(CONTENT_TYPES);
  let remaining = types;
  for (const span of [...scanElements(types, "Override")].reverse()) {
    const tag = types.slice(span.start, span.openEnd);
    if (tag.includes(`PartName="/${part}"`))
      remaining = splice(remaining, span.start, span.end, "");
  }
  pkg.write(CONTENT_TYPES, remaining);

  return { sweptMedia: await sweepOrphanMedia(pkg) };
}
