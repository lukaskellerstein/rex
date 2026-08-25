// Spec 11 §7.3 — the surgery.
//
// Every operation is performed on a copy, in memory, and only the parts it
// names are rewritten. Nothing here ever touches the reviewer's file: the
// caller writes the result to a temporary path, shows it (§7.7), and moves it
// over the original only after the reviewer accepts (§7.1).
//
// One rule runs through all twelve operations and is worth stating once: an
// operation that cannot find what its `from` says it expects **refuses**, and a
// refusal fails the whole run. There is no partial application (§7.2.2 rule 5),
// so a plan is all-or-nothing and the reviewer never has to reason about a deck
// that is half edited.

import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDeck, usedFonts } from "../render/pptxText.ts";
import type { DeckMap, ShapeSpan } from "./deck.ts";
import { findShape, readDeckMap, relsPathFor, shapesOf, shapeTreeOf, slidePartAt } from "./deck.ts";
import { describeSource, type MediaResolver, resolveSource } from "./media.ts";
import type { DeckPackage } from "./package.ts";
import {
  addRelationship,
  declareContentType,
  embedIdOf,
  freeMediaPart,
  IMAGE_REL_TYPE,
  pictureXml,
  sweepOrphanMedia,
  VIDEO_REL_TYPE,
} from "./parts.ts";
import type { Box, EditPlan, ImageSource, Operation } from "./plan.ts";
import { deleteSlide, duplicateSlide, reorderSlides } from "./slides.ts";
import {
  applyStyle,
  checkExpectedStyle,
  readStyle,
  setThemeFontXml,
  themeFontsOf,
} from "./style.ts";
import { replaceText } from "./text.ts";
import { videoPicXml, withMediaTiming } from "./video.ts";
import {
  attributeOf,
  escapeXml,
  firstElement,
  scanElements,
  splice,
  unescapeXml,
  withAttribute,
} from "./xml.ts";

/** The package as bytes, for the one place that needs to re-parse it. */
async function packageBytes(pkg: DeckPackage): Promise<Buffer> {
  return pkg.toBuffer();
}

/**
 * The default diagram drawer, for every caller that has no renderer to ask.
 *
 * A test and the `rex export` CLI both open a package without a window, and a
 * plan asking for a diagram there is a plan that cannot be performed — said
 * plainly rather than by returning an empty picture.
 */
async function refuseDiagram(): Promise<Buffer> {
  throw new Error("A Mermaid diagram can only be drawn while REX's window is open.");
}

async function refusePoster(): Promise<{ png: Buffer; durationSeconds: number }> {
  throw new Error("A video's poster frame can only be made while REX's window is open.");
}

/** English Metric Units: OOXML's unit. 914,400 to the inch, 12,700 to the point. */
export const EMU_PER_POINT = 12700;

export interface SlideSize {
  cx: number;
  cy: number;
}

export interface EditContext {
  pkg: DeckPackage;
  map: DeckMap;
  size: SlideSize;
  /** §7.5.2 — the deck's palette, so a theme colour is written as one. */
  themeColors: readonly string[];
  /** §7.5.3 — every font the deck already uses. */
  usedFonts: ReadonlySet<string>;
  /**
   * §7.4.2 — how a Mermaid diagram becomes a picture.
   *
   * Injected because it cannot happen here: Mermaid measures text with a real
   * layout, so it runs in the renderer and hands back a PNG. Main asks; the
   * renderer draws.
   */
  resolver: MediaResolver;
}

/** What one operation did, in the words the preview shows (§7.7). */
export interface OperationOutcome {
  op: Operation["op"];
  /** One line naming the slide and the shape by the name a reviewer knows. */
  summary: string;
  /** Slide positions this operation changed, 1-based. */
  slides: number[];
  /**
   * Things the reviewer must be told before accepting: a flattened run, a font
   * the deck does not carry, a colour outside the palette, a shape that may
   * now overflow.
   */
  flags: string[];
}

export async function openContext(
  pkg: DeckPackage,
  resolver: MediaResolver = { drawDiagram: refuseDiagram, drawPoster: refusePoster },
): Promise<EditContext> {
  const map = await readDeckMap(pkg);
  const presentation = await pkg.readText("ppt/presentation.xml");
  const size = firstElement(presentation, "p:sldSz");
  if (!size) throw new Error("This deck does not declare a slide size.");

  // §7.5.2 and §7.5.3 — the palette and the fonts are read from the deck once,
  // because both rules are about what the deck already has rather than about
  // what a plan asks for. `usedFonts` comes from the content because the
  // library's own list is empty on every real deck (measured, §7.5.3).
  const parsed = await parseDeck(await packageBytes(pkg));

  return {
    pkg,
    map,
    resolver,
    themeColors: parsed.themeColors,
    usedFonts: usedFonts(parsed.slides, parsed.usedFonts),
    size: {
      cx: Number(attributeOf(presentation, size, "cx") ?? 0),
      cy: Number(attributeOf(presentation, size, "cy") ?? 0),
    },
  };
}

/** §7.2.2 rule 4 — fractions of the slide, converted to EMU on the way in. */
export function boxToEmu(
  box: Box,
  size: SlideSize,
): { x: number; y: number; cx: number; cy: number } {
  return {
    x: Math.round(box.x * size.cx),
    y: Math.round(box.y * size.cy),
    cx: Math.round(box.w * size.cx),
    cy: Math.round(box.h * size.cy),
  };
}

/** A shape's own `<a:xfrm>` as slide fractions, or null when it inherits one. */
export function boxOfShape(slideXml: string, shape: ShapeSpan, size: SlideSize): Box | null {
  const xfrm = firstElement(slideXml, "a:xfrm", shape.span.openEnd, shape.span.innerEnd);
  if (!xfrm) return null;
  const offset = firstElement(slideXml, "a:off", xfrm.openEnd, xfrm.end);
  const extent = firstElement(slideXml, "a:ext", xfrm.openEnd, xfrm.end);
  if (!offset || !extent) return null;
  return {
    x: Number(attributeOf(slideXml, offset, "x") ?? 0) / size.cx,
    y: Number(attributeOf(slideXml, offset, "y") ?? 0) / size.cy,
    w: Number(attributeOf(slideXml, extent, "cx") ?? 0) / size.cx,
    h: Number(attributeOf(slideXml, extent, "cy") ?? 0) / size.cy,
  };
}

/** Boxes agree when every side is within a point of the other — §7.8's tolerance. */
export function boxesAgree(a: Box, b: Box, size: SlideSize): boolean {
  const tolerance = EMU_PER_POINT / Math.min(size.cx, size.cy);
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.w - b.w) <= tolerance &&
    Math.abs(a.h - b.h) <= tolerance
  );
}

/**
 * The next free `<p:cNvPr id>` on a slide.
 *
 * Shape ids must be unique within a slide — §7.8 checks it — and PowerPoint
 * treats a duplicate as a corrupt file rather than as a warning.
 */
export function nextShapeId(slideXml: string): number {
  let highest = 1;
  for (const span of scanElements(slideXml, "p:cNvPr")) {
    const id = Number(attributeOf(slideXml, span, "id") ?? 0);
    if (Number.isFinite(id) && id > highest) highest = id;
  }
  return highest + 1;
}

/** A shape name nothing on the slide already uses. */
export function freeShapeName(slideXml: string, wanted: string): string {
  const taken = new Set(
    scanElements(slideXml, "p:cNvPr").map((span) => attributeOf(slideXml, span, "name") ?? ""),
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ── Building and placing a shape ────────────────────────────

/**
 * A new text box, as the `<p:sp>` PowerPoint writes for one.
 *
 * Deliberately minimal. Everything not stated here — the font, the colour, the
 * bullet style — is inherited from the layout and the master, which is what
 * makes a box REX added look like the deck it was added to. §7.5.1 protects the
 * same inheritance for an existing shape.
 */
export function textBoxXml(input: {
  id: number;
  name: string;
  box: Box;
  size: SlideSize;
  text: string;
}): string {
  const at = boxToEmu(input.box, input.size);
  const paragraphs = input.text
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
    )
    .join("");

  return (
    `<p:sp><p:nvSpPr>` +
    `<p:cNvPr id="${input.id}" name="${escapeXml(input.name)}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${at.x}" y="${at.y}"/><a:ext cx="${at.cx}" cy="${at.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
    `${paragraphs}</p:txBody></p:sp>`
  );
}

/**
 * Put a shape into the slide's tree, at the front or at the back.
 *
 * The two ends mean opposite things and both are needed. **Back** is the top of
 * the z-order — where PowerPoint puts a shape you draw, and where a new text
 * box belongs. **Front** is underneath everything, which is what
 * `placement: "background"` requires (§7.4.4): every existing shape must paint
 * over the new picture.
 *
 * Inserting at the front also renumbers every `slide-N-shape-M` id below it,
 * which is exactly the case §5.2 says the shape id cannot survive and the
 * fingerprint must catch.
 */
export function insertShapeXml(slideXml: string, fragment: string, at: "front" | "back"): string {
  const tree = shapeTreeOf(slideXml);
  if (at === "back") return splice(slideXml, tree.innerEnd, tree.innerEnd, fragment);

  // The front of a shape tree is *after* its two property elements, which are
  // not shapes: `<p:nvGrpSpPr>` and `<p:grpSpPr>`. Putting a shape before them
  // produces a file PowerPoint offers to repair.
  const groupProperties = firstElement(slideXml, "p:grpSpPr", tree.openEnd, tree.innerEnd);
  const start = groupProperties ? groupProperties.end : tree.openEnd;
  return splice(slideXml, start, start, fragment);
}

// ── The operations ──────────────────────────────────────────

async function performSetText(
  context: EditContext,
  operation: Extract<Operation, { op: "setText" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const shape = findShape(xml, operation.shape);

  const body = firstElement(xml, "p:txBody", shape.span.openEnd, shape.span.innerEnd);
  if (!body) throw new Error(`'${operation.shape}' on slide ${operation.slide} holds no text.`);

  const result = replaceText(xml, body, operation.from, operation.to);
  context.pkg.write(part, result.xml);

  const flags: string[] = [];
  // §7.3 — stated in the preview rather than discovered afterwards. A bolded
  // word inside a replaced sentence comes back unbolded.
  if (result.runsMerged) {
    flags.push("Formatting inside the replaced text was flattened to the first run's.");
  }
  if (result.paragraphsMerged) flags.push("The replacement spans more than one paragraph.");
  // §7.7 — PowerPoint does not shrink text unless <a:normAutofit/> is set, so a
  // lengthened sentence produces a deck that validates and has a paragraph
  // running off its card.
  if (operation.to.length > operation.from.length && !hasAutofit(xml, shape)) {
    flags.push("The text got longer and this shape does not shrink text to fit — it may overflow.");
  }

  return {
    op: "setText",
    summary: `Slide ${operation.slide}, "${operation.shape}": "${operation.from}" becomes "${operation.to}"`,
    slides: [operation.slide],
    flags,
  };
}

function hasAutofit(xml: string, shape: ShapeSpan): boolean {
  return firstElement(xml, "a:normAutofit", shape.span.openEnd, shape.span.innerEnd) !== null;
}

async function performInsertTextBox(
  context: EditContext,
  operation: Extract<Operation, { op: "insertTextBox" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const name = freeShapeName(xml, operation.name ?? "Text box");

  const fragment = textBoxXml({
    id: nextShapeId(xml),
    name,
    box: operation.box,
    size: context.size,
    text: operation.text,
  });
  // At the back — the top of the z-order, where PowerPoint puts a box you draw.
  context.pkg.write(part, insertShapeXml(xml, fragment, "back"));

  return {
    op: "insertTextBox",
    summary: `Slide ${operation.slide}: adds a text box "${name}" at ${describeBox(operation.box)} — "${operation.text}"`,
    slides: [operation.slide],
    flags:
      name === operation.name || operation.name === undefined
        ? []
        : [
            `The slide already had a shape called "${operation.name}", so the new one is "${name}".`,
          ],
  };
}

/**
 * §7.4 — a picture, written into all four of its places or into none of them.
 *
 * `placement: "background"` puts it at the **front** of the shape tree, sized to
 * the slide, so every existing shape paints over it. Anything else is placed at
 * the box the operation names, in slide fractions.
 */
async function performInsertImage(
  context: EditContext,
  operation: Extract<Operation, { op: "insertImage" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);

  const media = await resolveSource(operation.source, "image", context.resolver);
  const mediaPart = freeMediaPart(context.pkg, media.extension);
  context.pkg.write(mediaPart, media.bytes);
  await declareContentType(context.pkg, media.extension, media.contentType);
  const relationshipId = await addRelationship(context.pkg, part, IMAGE_REL_TYPE, mediaPart);

  const background = operation.placement === "background";
  const box = background ? { x: 0, y: 0, w: 1, h: 1 } : (operation.box as Box);
  const name = freeShapeName(xml, background ? "Background picture" : "Picture");

  const fragment = pictureXml({
    id: nextShapeId(xml),
    name,
    alt: operation.alt,
    relationshipId,
    box: boxToEmu(box, context.size),
  });
  context.pkg.write(part, insertShapeXml(xml, fragment, background ? "front" : "back"));

  return {
    op: "insertImage",
    summary:
      `Slide ${operation.slide}: adds "${name}"${background ? " as the slide background" : ` at ${describeBox(box)}`}` +
      ` — ${describeSource(operation.source)}`,
    slides: [operation.slide],
    flags: pictureFlags(operation.source),
  };
}

/**
 * §7.4 — new bytes, same box.
 *
 * A new media part rather than an overwrite, because one picture part can be
 * referenced by several slides: overwriting it would change every slide that
 * uses it, and only one of them was named. The old part is swept afterwards if
 * nothing else still points at it (§7.6.3).
 */
async function performReplaceImage(
  context: EditContext,
  operation: Extract<Operation, { op: "replaceImage" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const shape = findShape(xml, operation.shape);
  if (shape.tag !== "p:pic") {
    throw new Error(`'${operation.shape}' on slide ${operation.slide} is not a picture.`);
  }

  const currentEmbed = embedIdOf(xml, operation.shape);
  if (!currentEmbed) throw new Error(`'${operation.shape}' has no picture to replace.`);

  const description = shapeDescription(xml, shape);
  if (!matchesLoosely(description, operation.from)) {
    throw new Error(
      `'${operation.shape}' on slide ${operation.slide} is described as '${description}', not '${operation.from}'. Nothing was written.`,
    );
  }

  const media = await resolveSource(operation.source, "image", context.resolver);
  const mediaPart = freeMediaPart(context.pkg, media.extension);
  context.pkg.write(mediaPart, media.bytes);
  await declareContentType(context.pkg, media.extension, media.contentType);
  const relationshipId = await addRelationship(context.pkg, part, IMAGE_REL_TYPE, mediaPart);

  const blip = firstElement(xml, "a:blip", shape.span.openEnd, shape.span.innerEnd);
  if (!blip) throw new Error(`'${operation.shape}' has no picture reference.`);
  const properties = firstElement(xml, "p:cNvPr", shape.span.openEnd, shape.span.innerEnd);

  let out = splice(
    xml,
    blip.start,
    blip.openEnd,
    withAttribute(xml.slice(blip.start, blip.openEnd), "r:embed", relationshipId),
  );
  // The description is the picture's alt text, and it described the old one.
  if (properties && properties.start > blip.openEnd) {
    out = splice(
      out,
      properties.start,
      properties.openEnd,
      withAttribute(out.slice(properties.start, properties.openEnd), "descr", operation.alt),
    );
  } else if (properties) {
    out = splice(
      out,
      properties.start,
      properties.openEnd,
      withAttribute(xml.slice(properties.start, properties.openEnd), "descr", operation.alt),
    );
    // Re-apply the blip change, whose offsets the line above did not disturb
    // because `p:cNvPr` comes first in a `<p:pic>`.
    const movedBlip = firstElement(out, "a:blip", shape.span.openEnd, out.length);
    if (movedBlip) {
      out = splice(
        out,
        movedBlip.start,
        movedBlip.openEnd,
        withAttribute(out.slice(movedBlip.start, movedBlip.openEnd), "r:embed", relationshipId),
      );
    }
  }
  context.pkg.write(part, out);

  const swept = await sweepOrphanMedia(context.pkg);

  return {
    op: "replaceImage",
    summary: `Slide ${operation.slide}, "${operation.shape}": new picture — ${describeSource(operation.source)}`,
    slides: [operation.slide],
    flags: [
      ...pictureFlags(operation.source),
      ...(swept.length > 0
        ? [`The picture it replaced is referenced by nothing else and was removed.`]
        : []),
    ],
  };
}

/**
 * §7.4.5 — a video, which is six things at once and roughly double an image.
 *
 * The poster is made rather than asked for: REX writes the clip into the deck's
 * cache, the renderer decodes one frame out of it, and that frame becomes the
 * second media part. A video with no poster is a black rectangle in
 * PowerPoint's editing view, which is what the slide looks like until someone
 * presses play.
 */
async function performInsertVideo(
  context: EditContext,
  operation: Extract<Operation, { op: "insertVideo" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);

  const media = await resolveSource(operation.source, "video", context.resolver);

  // Written to disk first, because the renderer decodes it over `rex-doc://`
  // and a 50 MB clip base64'd across IPC would be 67 MB of string.
  const scratch = join(tmpdir(), `rex-video-${randomUUID()}.${media.extension}`);
  writeFileSync(scratch, media.bytes);
  let poster: { png: Buffer; durationSeconds: number };
  try {
    poster = await context.resolver.drawPoster(scratch);
  } finally {
    rmSync(scratch, { force: true });
  }

  // Thing 1 — the clip, and thing 2 — its poster, each its own part with its
  // own content type.
  const videoPart = freeMediaPart(context.pkg, media.extension, "video");
  context.pkg.write(videoPart, media.bytes);
  await declareContentType(context.pkg, media.extension, media.contentType);

  const posterPart = freeMediaPart(context.pkg, "png", "poster");
  context.pkg.write(posterPart, poster.png);
  await declareContentType(context.pkg, "png", "image/png");

  // Thing 3 — two relationships on the slide, one per part.
  const videoRelationshipId = await addRelationship(context.pkg, part, VIDEO_REL_TYPE, videoPart);
  const posterRelationshipId = await addRelationship(context.pkg, part, IMAGE_REL_TYPE, posterPart);

  // Things 4 and 5 — the picture, and the extension that makes it play.
  const shapeId = nextShapeId(xml);
  const name = freeShapeName(xml, "Video");
  const fragment = videoPicXml({
    id: shapeId,
    name,
    alt: operation.alt,
    videoRelationshipId,
    posterRelationshipId,
    box: boxToEmu(operation.box, context.size),
  });

  // Thing 6 — the timing entry, so the media node exists on the slide.
  context.pkg.write(part, withMediaTiming(insertShapeXml(xml, fragment, "back"), shapeId));

  const size = describeSize(media.bytes.length);
  return {
    op: "insertVideo",
    summary:
      `Slide ${operation.slide}: adds "${name}" at ${describeBox(operation.box)}` +
      ` — ${describeSource(operation.source)}`,
    slides: [operation.slide],
    flags: [
      ...pictureFlags(operation.source),
      // §7.4.5 — a deck that gains three clips gains tens of megabytes, and a
      // reviewer emailing it afterwards should not find that out from a bounce
      // message.
      `${size}, ${poster.durationSeconds.toFixed(1)} seconds long. The deck grows by that much.`,
    ],
  };
}

/** §7.4.5 — the size, in the unit a reviewer would use for it. */
function describeSize(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  // "0.0 MB" beside a real clip reads as "nothing was added".
  return megabytes >= 0.1 ? `${megabytes.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** §7.7 — what a reviewer must be told about a picture before accepting it. */
function pictureFlags(source: ImageSource): string[] {
  if (source.from === "web") {
    // §7.4.1 — REX does not check the licence, cannot check it, and must not
    // imply that it has.
    return [
      `Licence claimed by the agent: ${source.licence} (${source.credit}). REX has not verified it.`,
    ];
  }
  if (source.from === "generated") {
    // §7.4 — a reviewer about to put a picture in a customer deck must be told
    // it was generated, and by what instruction.
    return [`This picture was generated, not photographed. Prompt: "${source.prompt}"`];
  }
  return [];
}

/**
 * §7.5 — style, applied to exactly what the plan named and nothing else.
 *
 * The `from` is checked the way every other operation checks one: an operation
 * that states its expectation cannot silently act on something else. Here that
 * means the properties it claims to be changing are the ones that are there.
 */
async function performSetStyle(
  context: EditContext,
  operation: Extract<Operation, { op: "setStyle" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const shape = findShape(xml, operation.shape);

  // §7.2.2 rule 1 — the operation names what it expects to find, and REX
  // refuses when the shape says otherwise.
  const unverified =
    operation.from === undefined
      ? []
      : checkExpectedStyle(readStyle(xml, shape), operation.from, operation.shape);

  const applied = applyStyle(
    xml,
    shape,
    {
      scope: operation.scope,
      ...(operation.index === undefined ? {} : { index: operation.index }),
    },
    operation.set,
    {
      themeColors: context.themeColors,
      usedFonts: context.usedFonts,
      allowNewFont: operation.allowNewFont === true,
    },
  );
  context.pkg.write(part, applied.xml);

  const changed = Object.entries(operation.set)
    .map(([key, value]) => `${key} → ${String(value)}`)
    .join(", ");
  return {
    op: "setStyle",
    summary: `Slide ${operation.slide}, "${operation.shape}" (${operation.scope}): ${changed}`,
    slides: [operation.slide],
    flags: [
      ...applied.flags,
      ...(unverified.length === 0
        ? []
        : [
            `REX could not check ${unverified.join(", ")} — this shape inherits ${unverified.length === 1 ? "it" : "them"} from the layout rather than setting ${unverified.length === 1 ? "it" : "them"} directly.`,
          ]),
    ],
  };
}

/** §7.5.4 — one operation instead of a hundred, and inheritance kept. */
async function performSetThemeFont(
  context: EditContext,
  operation: Extract<Operation, { op: "setThemeFont" }>,
): Promise<OperationOutcome> {
  const themes = context.pkg.paths().filter((part) => /^ppt\/theme\/theme\d+\.xml$/.test(part));
  if (themes.length === 0) throw new Error("This deck has no theme to change.");

  let was = { major: null as string | null, minor: null as string | null };
  for (const theme of themes) {
    const xml = await context.pkg.readText(theme);
    if (was.major === null) was = themeFontsOf(xml);
    context.pkg.write(theme, setThemeFontXml(xml, operation.major, operation.minor));
  }

  return {
    op: "setThemeFont",
    summary:
      `The whole deck: heading font ${was.major ?? "(unset)"} becomes ${operation.major}, ` +
      `body font ${was.minor ?? "(unset)"} becomes ${operation.minor}`,
    slides: [],
    flags: [
      // §7.5.4 — a shape with a hardcoded typeface does not inherit, and the
      // preview shows that by rendering the result rather than claiming success.
      "Shapes with a font set directly on them do not follow the theme. The before-and-after pictures show which.",
    ],
  };
}

/** §7.6.1 — the cheapest operation in the spec: one list, rewritten. */
async function performReorderSlides(
  context: EditContext,
  operation: Extract<Operation, { op: "reorderSlides" }>,
): Promise<OperationOutcome> {
  await reorderSlides(context.pkg, operation.order);
  return {
    op: "reorderSlides",
    summary: `The deck's order becomes ${operation.order.join(", ")}`,
    slides: operation.order,
    flags: [],
  };
}

/** §7.6.2 — how a new slide is made: from one a human already approved. */
async function performDuplicateSlide(
  context: EditContext,
  operation: Extract<Operation, { op: "duplicateSlide" }>,
): Promise<OperationOutcome> {
  const outcome = await duplicateSlide(context.pkg, context.map, operation.slide);
  return {
    op: "duplicateSlide",
    summary: `Slide ${operation.slide} is copied, and the copy sits directly after it`,
    slides: [operation.slide, operation.slide + 1],
    flags: outcome.droppedNotes
      ? [
          // A notes part carries a relationship back to its own slide, so two
          // slides sharing one is a deck PowerPoint offers to repair.
          "The copy has no speaker notes. A notes page belongs to one slide and cannot be shared.",
        ]
      : [],
  };
}

/** §7.6.3 — remove a slide, and everything that was only there for it. */
async function performDeleteSlide(
  context: EditContext,
  operation: Extract<Operation, { op: "deleteSlide" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const present = shapesOf(xml)
    .map((shape) => shapeText(xml, shape))
    .filter((text) => text.length > 0)
    .join(" ");
  if (!matchesLoosely(present, operation.from)) {
    throw new Error(
      `Slide ${operation.slide} does not say '${operation.from}'. Nothing was deleted.`,
    );
  }

  const outcome = await deleteSlide(context.pkg, context.map, operation.slide);
  return {
    op: "deleteSlide",
    summary: `Slide ${operation.slide} is removed — "${operation.from}"`,
    slides: [operation.slide],
    flags:
      outcome.sweptMedia.length === 0
        ? []
        : [
            `${outcome.sweptMedia.length} picture(s) nothing else used were removed with it, so the file does not carry dead weight.`,
          ],
  };
}

async function performMoveShape(
  context: EditContext,
  operation: Extract<Operation, { op: "moveShape" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const shape = findShape(xml, operation.shape);

  const current = boxOfShape(xml, shape, context.size);
  if (!current) {
    // §7.3 — a shape with no `<a:xfrm>` of its own is a placeholder whose
    // geometry comes from the layout. Writing one here is how a deck loses its
    // template, silently, and looks identical on the day it happens.
    throw new Error(
      `'${operation.shape}' inherits its position from the slide layout. Moving it would detach it from the template, so REX refuses.`,
    );
  }
  if (!boxesAgree(current, operation.from, context.size)) {
    throw new Error(`'${operation.shape}' is not where the plan says it is. Nothing was written.`);
  }

  const xfrm = firstElement(xml, "a:xfrm", shape.span.openEnd, shape.span.innerEnd);
  if (!xfrm) throw new Error(`'${operation.shape}' has no geometry to change.`);
  const target = boxToEmu(operation.to, context.size);

  const offset = firstElement(xml, "a:off", xfrm.openEnd, xfrm.end);
  const extent = firstElement(xml, "a:ext", xfrm.openEnd, xfrm.end);
  if (!offset || !extent) throw new Error(`'${operation.shape}' has no offset or extent.`);

  // Back to front, so the earlier span's offsets are still valid.
  let out = xml;
  out = splice(
    out,
    extent.start,
    extent.openEnd,
    withAttribute(
      withAttribute(xml.slice(extent.start, extent.openEnd), "cx", String(target.cx)),
      "cy",
      String(target.cy),
    ),
  );
  out = splice(
    out,
    offset.start,
    offset.openEnd,
    withAttribute(
      withAttribute(xml.slice(offset.start, offset.openEnd), "x", String(target.x)),
      "y",
      String(target.y),
    ),
  );
  context.pkg.write(part, out);

  return {
    op: "moveShape",
    summary:
      `Slide ${operation.slide}, "${operation.shape}": ${describeBox(operation.from)} becomes ` +
      describeBox(operation.to),
    slides: [operation.slide],
    flags: [],
  };
}

function describeBox(box: Box): string {
  const percent = (value: number): string => `${Math.round(value * 1000) / 10}%`;
  return `${percent(box.x)},${percent(box.y)} ${percent(box.w)}×${percent(box.h)}`;
}

async function performDeleteShape(
  context: EditContext,
  operation: Extract<Operation, { op: "deleteShape" }>,
): Promise<OperationOutcome> {
  const part = slidePartAt(context.map, operation.slide);
  const xml = await context.pkg.readText(part);
  const shape = findShape(xml, operation.shape);

  const present = shapeText(xml, shape);
  if (!matchesLoosely(present, operation.from)) {
    throw new Error(
      `'${operation.shape}' on slide ${operation.slide} does not say '${operation.from}' — it says '${present}'. Nothing was deleted.`,
    );
  }

  context.pkg.write(part, splice(xml, shape.span.start, shape.span.end, ""));
  return {
    op: "deleteShape",
    summary: `Slide ${operation.slide}: removes "${operation.shape}"${present ? ` — "${present}"` : ""}`,
    slides: [operation.slide],
    flags: [],
  };
}

/**
 * Every `<a:t>` inside a shape, collapsed the way the sidecar collapses it.
 *
 * **Unescaped**, and that is not a detail. XML stores an apostrophe as
 * `&apos;`, so a plan whose `from` says "your subsidiaries' systems" — copied
 * from the sidecar, which is plain text — never matched the shape and every
 * `deleteShape` on a sentence with an apostrophe was refused. Measured on
 * 2026-08-25, on the first real diagram plan an agent wrote.
 */
export function shapeText(xml: string, shape: ShapeSpan): string {
  const parts: string[] = [];
  for (const span of scanElements(xml, "a:t", shape.span.openEnd, shape.span.innerEnd)) {
    parts.push(unescapeXml(xml.slice(span.openEnd, span.innerEnd)));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A `from` matches when its words match, whatever the whitespace.
 *
 * The agent reads the sidecar, where a shape's text is already collapsed to
 * single spaces (§6.2), so requiring byte equality would refuse almost every
 * honest plan while catching nothing a word comparison misses.
 */
function matchesLoosely(present: string, expected: string): boolean {
  const flatten = (value: string): string => value.replace(/\s+/g, " ").trim();
  return flatten(present) === flatten(expected) || flatten(present).includes(flatten(expected));
}

/**
 * A shape's description, for a `deleteShape` on something with no text — a
 * picture, a decoration. Its name is all there is, and the alt text if it has
 * one.
 */
export function shapeDescription(xml: string, shape: ShapeSpan): string {
  const properties = firstElement(xml, "p:cNvPr", shape.span.openEnd, shape.span.innerEnd);
  // `attributeOf` unescapes already, so alt text needs nothing more here.
  const description = properties ? attributeOf(xml, properties, "descr") : null;
  return description ?? shapeText(xml, shape) ?? shape.name;
}

const PERFORM: Record<
  string,
  ((context: EditContext, operation: never) => Promise<OperationOutcome>) | undefined
> = {
  setText: performSetText as never,
  insertTextBox: performInsertTextBox as never,
  insertImage: performInsertImage as never,
  replaceImage: performReplaceImage as never,
  insertVideo: performInsertVideo as never,
  setStyle: performSetStyle as never,
  setThemeFont: performSetThemeFont as never,
  reorderSlides: performReorderSlides as never,
  duplicateSlide: performDuplicateSlide as never,
  deleteSlide: performDeleteSlide as never,
  moveShape: performMoveShape as never,
  deleteShape: performDeleteShape as never,
};

/**
 * Perform every operation, in order, on the package.
 *
 * A refusal anywhere throws, and the caller discards the copy. That is the
 * whole of §7.2.2 rule 5: no partial application, ever.
 */
export async function performPlan(
  context: EditContext,
  plan: EditPlan,
): Promise<OperationOutcome[]> {
  const outcomes: OperationOutcome[] = [];
  for (const operation of plan.operations) {
    const perform = PERFORM[operation.op];
    if (!perform) {
      throw new Error(`REX cannot perform '${operation.op}' on a deck.`);
    }
    outcomes.push(await perform(context, operation as never));
  }
  return outcomes;
}

/** Convenience for callers that have bytes and a plan and want bytes back. */
export async function applyPlanToPackage(
  pkg: DeckPackage,
  plan: EditPlan,
  resolver?: MediaResolver,
): Promise<{ outcomes: OperationOutcome[]; bytes: Buffer }> {
  const context = await openContext(pkg, resolver);
  const outcomes = await performPlan(context, plan);
  return { outcomes, bytes: await pkg.toBuffer() };
}

/** Re-exported so callers need one import for "where does this slide live". */
export { relsPathFor, slidePartAt };
