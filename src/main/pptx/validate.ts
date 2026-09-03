// Spec 11 §7.8 — what REX checks before it will show a reviewer an edited deck.
//
// Full XSD validation is not available: the reference implementation in
// `claude-my-marketplace/plugins/office-plugin` uses `lxml` against the
// ISO-IEC29500 schemas, and Node has no equivalent that does not pull in a
// native module or a Java runtime — both barred by spec 01 §12.
//
// That costs less than it looks, because reading that plugin's own
// `validators/pptx.py` shows its valuable checks are **structural, not schema**.
// All of them port directly, and two ideas are taken outright:
//
// 1. **Report only *new* problems.** Many real decks are already invalid in
//    small ways. REX cannot promise a deck is valid; it can prove **it did not
//    break anything that was working**. Same reasoning as the `nvim-tools`
//    baseline in `rules/02-understand.md`.
// 2. **Round-trip re-parse.** After surgery, parse the edited copy with
//    `pptxtojson` and compare it to what the plan intended. This catches
//    corruption no schema would, using a library already in the build.
//
// The recurring half of every intent check is the one that matters: not only
// that the change happened, but that **nothing else did**.

import { type OoxmlPackage, openPackage } from "../ooxml/package.ts";
import { attributeOf, scanElements } from "../ooxml/xml.ts";
import { parseDeck, slideTexts } from "../render/pptxText.ts";
import {
  type DeckMap,
  parseRelationships,
  readDeckMap,
  relsPathFor,
  resolveTarget,
  shapesOf,
} from "./deck.ts";
import { readNotes } from "./notes.ts";
import type { EditPlan, Operation } from "./plan.ts";

const CONTENT_TYPES = "[Content_Types].xml";
const LAYOUT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

/** One thing wrong with the package, in words a reviewer can act on. */
export interface Problem {
  /** Stable across the original and the copy, so "new" can be computed. */
  key: string;
  message: string;
}

/** Every `r:`-namespaced relationship id a part refers to. */
function relationshipIdsIn(xml: string): Set<string> {
  const ids = new Set<string>();
  for (const match of xml.matchAll(/\sr:(?:id|embed|link|pict|dm|lo|qs|cs)="([^"]+)"/g)) {
    ids.add(match[1]);
  }
  return ids;
}

async function contentTypeIndex(
  pkg: OoxmlPackage,
): Promise<{ defaults: Set<string>; overrides: Set<string> }> {
  const xml = await pkg.readText(CONTENT_TYPES);
  const defaults = new Set(
    scanElements(xml, "Default").map((span) =>
      (attributeOf(xml, span, "Extension") ?? "").toLowerCase(),
    ),
  );
  const overrides = new Set(
    scanElements(xml, "Override").map((span) => attributeOf(xml, span, "PartName") ?? ""),
  );
  return { defaults, overrides };
}

/**
 * Every structural problem in the package.
 *
 * Deliberately not "is this valid OOXML" — it is the seven checks that catch
 * the corruptions REX's own operations can cause, each of which produces a file
 * PowerPoint offers to repair rather than one it refuses outright.
 */
export async function structuralProblems(pkg: OoxmlPackage): Promise<Problem[]> {
  const problems: Problem[] = [];
  const parts = pkg.paths();
  const present = new Set(parts);

  const { defaults, overrides } = await contentTypeIndex(pkg);

  // Which media parts anything still points at, for the orphan sweep below.
  const referencedMedia = new Set<string>();

  for (const part of parts) {
    if (!part.endsWith(".xml") && !part.endsWith(".rels")) {
      // Check 2 — a part nothing declares is a part PowerPoint cannot open.
      const extension = part.slice(part.lastIndexOf(".") + 1).toLowerCase();
      if (!defaults.has(extension) && !overrides.has(`/${part}`)) {
        problems.push({
          key: `undeclared:${part}`,
          message: `${part} is not declared in [Content_Types].xml, so PowerPoint cannot open it.`,
        });
      }
      continue;
    }
    if (part.endsWith(".rels")) continue;

    if (!overrides.has(`/${part}`) && !defaults.has("xml")) {
      problems.push({
        key: `undeclared:${part}`,
        message: `${part} is not declared in [Content_Types].xml.`,
      });
    }

    const xml = await pkg.readText(part);
    const relsPath = relsPathFor(part);
    const rels = pkg.has(relsPath) ? parseRelationships(await pkg.readText(relsPath)) : [];
    const byId = new Map(rels.map((rel) => [rel.id, rel]));

    for (const rel of rels) {
      if (rel.external) continue;
      const target = resolveTarget(part, rel.target);
      if (target.startsWith("ppt/media/")) referencedMedia.add(target);
      if (!present.has(target)) {
        problems.push({
          key: `danglingrel:${part}:${rel.id}`,
          message: `${part} points at ${target}, which is not in the package.`,
        });
      }
    }

    // Check 1 — the commonest corruption there is.
    for (const id of relationshipIdsIn(xml)) {
      if (!byId.has(id)) {
        problems.push({
          key: `unresolved:${part}:${id}`,
          message: `${part} uses relationship ${id}, which its .rels file does not define.`,
        });
      }
    }

    if (part.startsWith("ppt/slides/slide")) {
      // Check 4 — a slide with no layout, or two, is a broken template link.
      const layouts = rels.filter((rel) => rel.type === LAYOUT_REL_TYPE).length;
      if (layouts !== 1) {
        problems.push({
          key: `layout:${part}`,
          message: `${part} has ${layouts} slide-layout relationships; it must have exactly one.`,
        });
      }

      // Check 3 — PowerPoint treats a duplicate shape id as a corrupt file.
      const seen = new Set<string>();
      for (const shape of shapesOf(xml)) {
        if (shape.id && seen.has(shape.id)) {
          problems.push({
            key: `dupeshape:${part}:${shape.id}`,
            message: `${part} has two shapes with id ${shape.id}.`,
          });
        }
        if (shape.id) seen.add(shape.id);
      }
    }
  }

  // Checks 5 and 6 — every slide the presentation lists still exists.
  try {
    const map = await readDeckMap(pkg);
    for (const slide of map.slides) {
      if (!present.has(slide)) {
        problems.push({
          key: `missingslide:${slide}`,
          message: `The presentation lists ${slide}, which is not in the package.`,
        });
      }
    }
  } catch (error) {
    problems.push({
      key: "slidelist",
      message: `The slide list could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Check 7 — the orphan sweep §7.6.3 is easy to skip, and a deck that keeps
  // the media of deleted slides grows every time it is edited with nothing
  // about it looking wrong.
  for (const part of parts) {
    if (!part.startsWith("ppt/media/") || referencedMedia.has(part)) continue;
    problems.push({
      key: `orphanmedia:${part}`,
      message: `${part} is referenced by nothing and is dead weight in the file.`,
    });
  }

  return problems;
}

/**
 * The problems the edit **introduced**, and only those.
 *
 * This is the honest guarantee for Apply on a deck: REX cannot promise a deck
 * is valid, because many real decks are not, but it can prove it did not break
 * anything that was working.
 */
export async function newProblems(
  original: OoxmlPackage,
  edited: OoxmlPackage,
): Promise<Problem[]> {
  const before = new Set((await structuralProblems(original)).map((problem) => problem.key));
  return (await structuralProblems(edited)).filter((problem) => !before.has(problem.key));
}

/**
 * Every shape's text on every slide, keyed so the key survives an insertion.
 *
 * By **name**, not by position. An earlier version keyed on the shape's index,
 * which meant a plan that added or removed one shape shifted every key below it
 * — and the only way to keep the comparison honest was to stop checking that
 * slide at all. §7.8 requires the opposite: after a `deleteShape`, "the shape is
 * gone, **and no other shape on that slide is**".
 *
 * A repeated name gets an occurrence suffix, because PowerPoint allows two
 * shapes called "Text 4" and the pair still has to be told apart.
 */
interface ShapeText {
  slide: number;
  name: string;
  /** Which shape of that name on that slide, counting from 1. */
  nth: number;
  text: string;
}

async function textMap(bytes: Buffer): Promise<Map<string, ShapeText>> {
  const deck = await parseDeck(bytes);
  const map = new Map<string, ShapeText>();
  for (const slide of slideTexts(deck.slides)) {
    const seen = new Map<string, number>();
    for (const shape of slide.shapes) {
      const nth = (seen.get(shape.name) ?? 0) + 1;
      seen.set(shape.name, nth);
      // The key is opaque; everything a message needs is in the value, so
      // nothing downstream ever has to take a shape name apart again.
      map.set(`${slide.number} ${shape.name} ${nth}`, {
        slide: slide.number,
        name: shape.name,
        nth,
        text: shape.text,
      });
    }
  }
  return map;
}

export interface IntentProblem {
  operation: Operation["op"];
  message: string;
}

/**
 * §7.8's second half — the edited copy is re-parsed and compared to what the
 * plan said it would do.
 *
 * A surgical edit that quietly altered a slide it was not asked about would
 * pass every structural check above and look completely fine, so every check
 * here has two halves: the change happened, and nothing else did.
 */
export async function intentProblems(
  originalBytes: Buffer,
  editedBytes: Buffer,
  plan: EditPlan,
): Promise<IntentProblem[]> {
  const problems: IntentProblem[] = [];

  const before = await textMap(originalBytes);
  let after: Map<string, ShapeText>;
  try {
    after = await textMap(editedBytes);
  } catch (error) {
    return [
      {
        operation: plan.operations[0].op,
        message: `The edited deck no longer parses: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  /** Shapes the plan named, as `slide\u0000name`. Those may change or vanish. */
  const named = new Set<string>();
  /** Slides the plan adds a shape to. Only those may gain one. */
  const gained = new Set<number>();
  /** True when the plan changes the slide list itself, so positions all move. */
  let restructuresDeck = false;

  for (const operation of plan.operations) {
    if ("shape" in operation && "slide" in operation) {
      named.add(`${operation.slide}\u0000${operation.shape}`);
    }
    if (
      operation.op === "insertTextBox" ||
      operation.op === "insertImage" ||
      operation.op === "insertVideo"
    ) {
      gained.add(operation.slide);
    }
    if (
      operation.op === "reorderSlides" ||
      operation.op === "duplicateSlide" ||
      operation.op === "deleteSlide" ||
      operation.op === "setThemeFont"
    ) {
      restructuresDeck = true;
    }
  }

  for (const operation of plan.operations) {
    if (operation.op !== "setText") continue;
    const found = [...after.values()].some(
      (shape) =>
        shape.slide === operation.slide &&
        shape.name === operation.shape &&
        shape.text.includes(operation.to),
    );
    if (!found && operation.to.length > 0) {
      problems.push({
        operation: operation.op,
        message: `Slide ${operation.slide}, "${operation.shape}" does not read back as "${operation.to}".`,
      });
    }
  }

  // A plan that moves, copies or removes slides renumbers every slide after it,
  // so shape-by-shape comparison is meaningless here. §7.8's rows for those
  // three operations are slide-level and are checked in `slideProblems`.
  if (restructuresDeck) {
    problems.push(...slideProblems(before, after, plan));
    return problems;
  }

  // The half that matters. Every shape the plan did not name must still be
  // there, holding exactly the text it held before.
  for (const [key, shape] of before) {
    if (named.has(`${shape.slide}\u0000${shape.name}`)) continue;
    const now = after.get(key);
    if (now === undefined) {
      problems.push({
        operation: plan.operations[0].op,
        message: `Slide ${shape.slide}: the shape "${shape.name}" is gone, and no operation named it.`,
      });
      continue;
    }
    if (now.text !== shape.text) {
      problems.push({
        operation: plan.operations[0].op,
        message: `Slide ${shape.slide}, "${shape.name}" changed from "${clip(shape.text)}" to "${clip(now.text)}", and no operation named it.`,
      });
    }
  }

  // And the other direction: a shape that appeared where the plan added none.
  // Without this, an operation could quietly leave a duplicate behind and every
  // check above would still pass.
  for (const [key, shape] of after) {
    if (before.has(key)) continue;
    if (gained.has(shape.slide)) continue;
    if (named.has(`${shape.slide}\u0000${shape.name}`)) continue;
    problems.push({
      operation: plan.operations[0].op,
      message: `Slide ${shape.slide} gained a shape "${shape.name}", and no operation added one there.`,
    });
  }

  return problems;
}

/**
 * §7.8 — `insertVideo`, whose fifth piece fails silently.
 *
 * The row in §7.8 spells out why this is checked explicitly rather than
 * inferred from the file opening: **a missing `p14:media` extension opens
 * fine and never plays.** So all six are looked for by name.
 */
export async function videoProblems(
  pkg: OoxmlPackage,
  slidePart: string,
): Promise<IntentProblem[]> {
  const problems: IntentProblem[] = [];
  const xml = await pkg.readText(slidePart);

  const rels = pkg.has(relsPathFor(slidePart))
    ? parseRelationships(await pkg.readText(relsPathFor(slidePart)))
    : [];

  const video = rels.find((rel) => rel.type.endsWith("/video"));
  if (!video) {
    problems.push({ operation: "insertVideo", message: "The slide has no video relationship." });
  } else if (!pkg.has(resolveTarget(slidePart, video.target))) {
    problems.push({
      operation: "insertVideo",
      message: "The video relationship points at nothing.",
    });
  }

  // §7.4.5 step 2 — a video with no poster is a black rectangle in the editing
  // view, so its absence is a defect rather than a cosmetic gap.
  if (!/<p:blipFill><a:blip r:embed="/.test(xml)) {
    problems.push({ operation: "insertVideo", message: "The video shape has no poster frame." });
  }

  if (!/<a:videoFile\s+r:link="/.test(xml)) {
    problems.push({ operation: "insertVideo", message: "The shape carries no <a:videoFile>." });
  }

  // Step 5 — the one that decides playable from inert, and the one a file
  // opening tells you nothing about.
  if (!/<p14:media[\s>]/.test(xml)) {
    problems.push({
      operation: "insertVideo",
      message:
        "The p14:media extension is missing. PowerPoint will open this deck and draw the poster, and the video will never play.",
    });
  }

  if (!/<p:timing>/.test(xml)) {
    problems.push({ operation: "insertVideo", message: "The slide has no timing tree." });
  }

  return problems;
}

/**
 * §7.8's slide-level rows, for the three operations that renumber slides.
 *
 * Compared by **content**, not by position: `reorderSlides` must leave the deck
 * with the same set of slides in a new order, and the only way to say that is to
 * ask what each slide says rather than where it sits.
 */
function slideProblems(
  before: Map<string, ShapeText>,
  after: Map<string, ShapeText>,
  plan: EditPlan,
): IntentProblem[] {
  const problems: IntentProblem[] = [];
  const operation = plan.operations[0];

  const fingerprint = (map: Map<string, ShapeText>): Map<number, string> => {
    const slides = new Map<number, string[]>();
    for (const shape of map.values()) {
      const list = slides.get(shape.slide) ?? [];
      list.push(`${shape.name}=${shape.text}`);
      slides.set(shape.slide, list);
    }
    return new Map([...slides].map(([slide, parts]) => [slide, parts.join("|")]));
  };

  const was = fingerprint(before);
  const now = fingerprint(after);

  if (operation.op === "reorderSlides") {
    // No part is added, removed or rewritten by a reorder (§7.6.1), so every
    // slide must reappear somewhere, unchanged.
    const missing = [...was].filter(([, content]) => ![...now.values()].includes(content));
    if (missing.length > 0) {
      problems.push({
        operation: operation.op,
        message: `Reordering lost slide ${missing[0][0]} — its content is not in the deck any more.`,
      });
    }
    if (was.size !== now.size) {
      problems.push({
        operation: operation.op,
        message: `The deck had ${was.size} slides and now has ${now.size}. A reorder must not change the count.`,
      });
    }
    for (const [position, wanted] of operation.order.entries()) {
      const expected = was.get(wanted);
      const actual = now.get(position + 1);
      if (expected !== undefined && actual !== undefined && expected !== actual) {
        problems.push({
          operation: operation.op,
          message: `Slide ${wanted} was asked to become slide ${position + 1}, and the slide there is a different one.`,
        });
      }
    }
    return problems;
  }

  const expectedCount =
    operation.op === "duplicateSlide"
      ? was.size + 1
      : operation.op === "deleteSlide"
        ? was.size - 1
        : was.size;
  if (now.size !== expectedCount) {
    problems.push({
      operation: operation.op,
      message: `The deck should have ${expectedCount} slides after this and has ${now.size}.`,
    });
  }

  if (operation.op === "setThemeFont") {
    // §7.8 — a font change must change no slide's text at all.
    for (const [slide, content] of was) {
      if (now.get(slide) !== content) {
        problems.push({
          operation: operation.op,
          message: `Changing the theme font changed slide ${slide}'s text, which it must never do.`,
        });
      }
    }
  }

  return problems;
}

function clip(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

/** Slides a plan claims to affect, for the preview (§7.7). */
/**
 * Spec 19 §7.3 — a `setNotes` changed the notes, **and the slide did not**.
 *
 * Its own pass, like `videoProblems`, because it is the one check whose failure
 * is invisible everywhere else: the preview draws the slide, a note is not on
 * the slide, and every existing check compares shape text on slides. A
 * `setNotes` that wrote into the slide instead of the notes would look
 * completely correct until somebody opened PowerPoint.
 */
export async function notesProblems(
  originalBytes: Buffer,
  editedBytes: Buffer,
  plan: EditPlan,
): Promise<IntentProblem[]> {
  const operations = plan.operations.filter((operation) => operation.op === "setNotes");
  if (operations.length === 0) return [];

  const problems: IntentProblem[] = [];
  const before = await openPackage(originalBytes);
  const after = await openPackage(editedBytes);
  const beforeMap = await readDeckMap(before);
  const afterMap = await readDeckMap(after);

  for (const operation of operations) {
    const part = afterMap.slides[operation.slide - 1];
    if (!part) {
      problems.push({
        operation: "setNotes",
        message: `Slide ${operation.slide} is not in the edited deck.`,
      });
      continue;
    }

    const now = (await readNotes(after, part)).replace(/\s+/g, " ").trim();
    const wanted = operation.to.replace(/\s+/g, " ").trim();
    if (now !== wanted) {
      problems.push({
        operation: "setNotes",
        message: `Slide ${operation.slide}'s notes say '${clip(now)}' and the plan said they would say '${clip(wanted)}'.`,
      });
    }

    // The half that matters. A note is not drawn on the slide, so nothing else
    // would ever notice this.
    const originalPart = beforeMap.slides[operation.slide - 1];
    if (originalPart && before.has(originalPart) && after.has(part)) {
      const was = await before.read(originalPart);
      const is = await after.read(part);
      if (!was.equals(is)) {
        problems.push({
          operation: "setNotes",
          message: `Slide ${operation.slide} itself was changed, and setNotes must only change its notes.`,
        });
      }
    }
  }
  return problems;
}

export function affectedSlides(plan: EditPlan, map: DeckMap): number[] {
  const slides = new Set<number>();
  for (const operation of plan.operations) {
    if (operation.op === "reorderSlides" || operation.op === "setThemeFont") {
      // "Affected" is the whole deck, shown as a strip of thumbnails.
      for (let n = 1; n <= map.slides.length; n++) slides.add(n);
      continue;
    }
    if ("slide" in operation) slides.add(operation.slide);
  }
  return [...slides].sort((a, b) => a - b);
}
