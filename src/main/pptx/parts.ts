// Spec 11 §7.4.4 — what REX writes when a picture goes into a deck.
//
// An image lives in **four** places, and missing any one of them is what makes
// PowerPoint report the file as corrupt rather than refuse it outright — the
// "do you want me to repair this?" prompt is what a missing one looks like:
//
//   1. `ppt/media/imageN.<ext>` — the bytes.
//   2. A `<Relationship>` in the slide's `.rels`.
//   3. A `<Default>` or `<Override>` in `[Content_Types].xml`.
//   4. A `<p:pic>` in the slide's `spTree`.
//
// All four are written, or none is. Everything in this file is therefore
// staged on the in-memory package, which the caller throws away whole if any
// later check fails.

import type { OoxmlPackage } from "../ooxml/package.ts";
import { escapeXml, firstElement, scanElements, splice } from "../ooxml/xml.ts";
import { parseRelationships, relsPathFor, resolveTarget, shapesOf } from "./deck.ts";

const CONTENT_TYPES = "[Content_Types].xml";

export const IMAGE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
export const VIDEO_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video";

/**
 * Place 1 — a media part name nothing in the package already uses.
 *
 * Named for what it is: a clip called `rex-image1.mp4` is a small lie that
 * anyone unzipping the deck later has to see through.
 */
export function freeMediaPart(pkg: OoxmlPackage, extension: string, kind = "image"): string {
  const taken = new Set(pkg.paths());
  for (let n = 1; ; n++) {
    const candidate = `ppt/media/rex-${kind}${n}.${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Place 2 — a relationship id free in this part's own `.rels`. */
export async function addRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  type: string,
  targetPart: string,
): Promise<string> {
  const relsPath = relsPathFor(ownerPart);
  const xml = pkg.has(relsPath)
    ? await pkg.readText(relsPath)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const existing = parseRelationships(xml);
  let highest = 0;
  for (const rel of existing) {
    const number = Number(/^rId(\d+)$/.exec(rel.id)?.[1] ?? 0);
    if (number > highest) highest = number;
  }
  const id = `rId${highest + 1}`;

  // The target is relative to the owning part's own directory, which for a
  // slide means `../media/…`. An absolute-looking target is what produces a
  // deck that opens with every picture missing.
  const ownerDir = ownerPart.slice(0, ownerPart.lastIndexOf("/"));
  const target = relativeTarget(ownerDir, targetPart);

  const list = firstElement(xml, "Relationships");
  if (!list) throw new Error(`${relsPath} is not a relationships part.`);
  const entry = `<Relationship Id="${id}" Type="${escapeXml(type)}" Target="${escapeXml(target)}"/>`;
  pkg.write(relsPath, splice(xml, list.innerEnd, list.innerEnd, entry));
  return id;
}

function relativeTarget(fromDir: string, target: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  return [...Array(from.length - shared).fill(".."), ...to.slice(shared)].join("/");
}

/**
 * Place 3 — the package's own manifest of what each part is.
 *
 * A `<Default>` covers every part with that extension, which is what Office
 * writes for media, so one entry serves every picture of the same kind.
 */
export async function declareContentType(
  pkg: OoxmlPackage,
  extension: string,
  contentType: string,
): Promise<void> {
  const xml = await pkg.readText(CONTENT_TYPES);
  const already = scanElements(xml, "Default").some((span) =>
    new RegExp(`Extension="${extension}"`, "i").test(xml.slice(span.start, span.openEnd)),
  );
  if (already) return;

  const list = firstElement(xml, "Types");
  if (!list) throw new Error("[Content_Types].xml is not readable.");
  const entry = `<Default Extension="${escapeXml(extension)}" ContentType="${escapeXml(contentType)}"/>`;
  // Defaults come before overrides in every package Office writes, and
  // PowerPoint is not fussy about it — but a file that reads like the ones
  // beside it is a file a human can diff.
  pkg.write(CONTENT_TYPES, splice(xml, list.openEnd, list.openEnd, entry));
}

/** Place 4 — the `<p:pic>` itself. */
export function pictureXml(input: {
  id: number;
  name: string;
  alt: string;
  relationshipId: string;
  box: { x: number; y: number; cx: number; cy: number };
}): string {
  return (
    `<p:pic><p:nvPicPr>` +
    // §7.4.4 — `alt` is required and becomes the picture's description. A deck
    // REX has edited should not be less accessible than the one it was handed.
    `<p:cNvPr id="${input.id}" name="${escapeXml(input.name)}" descr="${escapeXml(input.alt)}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${input.relationshipId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${input.box.x}" y="${input.box.y}"/>` +
    `<a:ext cx="${input.box.cx}" cy="${input.box.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

/**
 * §7.6.3's orphan sweep, applied wherever a media part stops being referenced.
 *
 * Easy to skip, and skipping it is invisible: a deck that keeps the media of
 * everything it ever removed grows every time it is edited and nothing about it
 * looks wrong. §7.8 checks for exactly this, so a missed sweep fails the run
 * rather than shipping.
 */
export async function sweepOrphanMedia(pkg: OoxmlPackage): Promise<string[]> {
  const referenced = new Set<string>();
  for (const part of pkg.paths()) {
    if (!part.endsWith(".rels")) continue;
    for (const rel of parseRelationships(await pkg.readText(part))) {
      if (rel.external) continue;
      // A `.rels` file describes the part it sits beside, so its targets
      // resolve against that part's directory rather than its own.
      const owner = part.replace("/_rels/", "/").replace(/\.rels$/, "");
      referenced.add(resolveTarget(owner, rel.target));
    }
  }

  const removed: string[] = [];
  for (const part of pkg.paths()) {
    if (!part.startsWith("ppt/media/") || referenced.has(part)) continue;
    pkg.remove(part);
    removed.push(part);
  }
  return removed;
}

/** The relationship a `<p:pic>` embeds, so `replaceImage` knows what to repoint. */
export function embedIdOf(slideXml: string, shapeName: string): string | null {
  const shape = shapesOf(slideXml).find((candidate) => candidate.name === shapeName);
  if (!shape) return null;
  const blip = firstElement(slideXml, "a:blip", shape.span.openEnd, shape.span.innerEnd);
  if (!blip) return null;
  return /r:embed="([^"]+)"/.exec(slideXml.slice(blip.start, blip.openEnd))?.[1] ?? null;
}
