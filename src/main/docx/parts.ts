// Spec 19 §5.4 — what REX writes when a picture goes into a Word document.
//
// The same four places spec 11 §7.4.4 named for a deck, with Word's part names:
//
//   1. `word/media/rex-imageN.<ext>` — the bytes.
//   2. A `<Relationship>` in `word/_rels/document.xml.rels`.
//   3. A `<Default>` in `[Content_Types].xml`.
//   4. A `<w:drawing>` inside a new paragraph.
//
// All four are written, or none is — everything here is staged on the in-memory
// package, which the caller throws away whole if any later check fails.

import type { OoxmlPackage } from "../ooxml/package.ts";
import { attributeOf, escapeXml, firstElement, scanElements } from "../ooxml/xml.ts";
import { addRelationship, declareContentType, IMAGE_REL_TYPE } from "../pptx/parts.ts";

/** 914,400 EMU to the inch; a CSS pixel is 1/96 of one. */
const EMU_PER_PIXEL = 9525;
/** A twip is 1/20 of a point, and a point is 12,700 EMU. */
const EMU_PER_TWIP = 635;
/** What a page is when the document does not say — US Letter, Word's default. */
const DEFAULT_TEXT_WIDTH_EMU = 6 * 914_400;

export interface Pixels {
  width: number;
  height: number;
}

/**
 * A picture's real size, read from its own bytes.
 *
 * Needed because an inline `<w:drawing>` must state `cx` and `cy` — Word does
 * not measure the image for you, and a wrong aspect ratio is a stretched
 * picture rather than an error. Four formats, which is exactly the four
 * `sniffMediaType` recognises.
 */
export function imageSize(bytes: Buffer): Pixels | null {
  // PNG: IHDR is always the first chunk, at a fixed offset.
  if (bytes.length > 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // GIF: the logical screen descriptor, little-endian, right after the header.
  if (bytes.length > 10 && bytes.toString("ascii", 0, 3) === "GIF") {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }

  // WEBP: three sub-formats, and only the two common ones are handled. VP8X's
  // 24-bit sizes are stored minus one.
  if (bytes.length > 30 && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8 ") {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8X") {
      const read24 = (at: number): number =>
        bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
    return null;
  }

  // JPEG: walk the marker chain to a start-of-frame, which is the only place
  // the dimensions live. Length-prefixed, so this is a walk and not a search —
  // searching for the marker bytes finds them inside the entropy-coded data.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = bytes[at + 1];
      // SOF0–SOF15, minus the four that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }

  return null;
}

/**
 * How wide the text column is, in EMU — the width a picture is fitted to.
 *
 * From the document's own `<w:sectPr>`: page width minus the two margins, all
 * in twips. A picture sized to the page rather than to the column runs into the
 * margin and Word silently scales it down on print, so the number matters.
 */
export function textWidthEmu(documentXml: string): number {
  const sections = scanElements(documentXml, "w:sectPr");
  const section = sections[sections.length - 1];
  if (!section) return DEFAULT_TEXT_WIDTH_EMU;

  const size = firstElement(documentXml, "w:pgSz", section.openEnd, section.innerEnd);
  const margin = firstElement(documentXml, "w:pgMar", section.openEnd, section.innerEnd);
  const pageWidth = size ? Number(attributeOf(documentXml, size, "w:w") ?? 0) : 0;
  const left = margin ? Number(attributeOf(documentXml, margin, "w:left") ?? 0) : 0;
  const right = margin ? Number(attributeOf(documentXml, margin, "w:right") ?? 0) : 0;

  const twips = pageWidth - left - right;
  return twips > 0 ? twips * EMU_PER_TWIP : DEFAULT_TEXT_WIDTH_EMU;
}

/** A picture's size in EMU, scaled down to fit the column and never up. */
export function fitToColumn(pixels: Pixels, columnEmu: number): { cx: number; cy: number } {
  const cx = pixels.width * EMU_PER_PIXEL;
  const cy = pixels.height * EMU_PER_PIXEL;
  if (cx <= columnEmu) return { cx: Math.round(cx), cy: Math.round(cy) };
  const scale = columnEmu / cx;
  return { cx: Math.round(cx * scale), cy: Math.round(cy * scale) };
}

/** Place 1 — a media part name nothing in the package already uses. */
export function freeWordMediaPart(pkg: OoxmlPackage, extension: string): string {
  const taken = new Set(pkg.paths());
  for (let n = 1; ; n++) {
    const candidate = `word/media/rex-image${n}.${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Place 4 — the paragraph that holds the picture.
 *
 * **Every namespace it uses is declared on the elements that use them**, rather
 * than assumed to be on `<w:document>`. A document written by something other
 * than Word may not declare `wp` or `pic` at the root, and a fragment that
 * relies on a declaration that is not there is a file Word offers to repair.
 * XML allows a declaration on any element, so the fragment carries its own.
 */
export function inlinePictureXml(input: {
  id: number;
  name: string;
  alt: string;
  relationshipId: string;
  cx: number;
  cy: number;
}): string {
  const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  return (
    "<w:p><w:r><w:drawing>" +
    `<wp:inline xmlns:wp="${wp}" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${input.cx}" cy="${input.cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    // §5.4 — `alt` is required by the plan and becomes the picture's
    // description. A document REX has edited must not be less accessible than
    // the one it was handed.
    `<wp:docPr id="${input.id}" name="${escapeXml(input.name)}" descr="${escapeXml(input.alt)}"/>` +
    `<wp:cNvGraphicFramePr xmlns:a="${a}"><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}">` +
    `<pic:pic xmlns:pic="${pic}">` +
    `<pic:nvPicPr><pic:cNvPr id="${input.id}" name="${escapeXml(input.name)}" descr="${escapeXml(input.alt)}"/>` +
    "<pic:cNvPicPr/></pic:nvPicPr>" +
    `<pic:blipFill><a:blip xmlns:r="${r}" r:embed="${input.relationshipId}"/>` +
    "<a:stretch><a:fillRect/></a:stretch></pic:blipFill>" +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${input.cx}" cy="${input.cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
  );
}

/** The next free `<wp:docPr id>`, which must be unique in the document. */
export function nextDrawingId(documentXml: string): number {
  let highest = 0;
  for (const match of documentXml.matchAll(/<wp:docPr[^>]*\sid="(\d+)"/g)) {
    const id = Number(match[1]);
    if (id > highest) highest = id;
  }
  return highest + 1;
}

/**
 * Places 1, 2 and 3 — the bytes, the relationship and the content type.
 *
 * Returns the relationship id place 4 needs. Nothing is written to disk: the
 * package is in memory and the caller discards it whole on any later failure.
 */
export async function embedImage(
  pkg: OoxmlPackage,
  bytes: Buffer,
  media: { extension: string; contentType: string },
): Promise<string> {
  const part = freeWordMediaPart(pkg, media.extension);
  pkg.write(part, bytes);
  await declareContentType(pkg, media.extension, media.contentType);
  return addRelationship(pkg, "word/document.xml", IMAGE_REL_TYPE, part);
}
