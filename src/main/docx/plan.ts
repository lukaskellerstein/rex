// Spec 19 §4.4 — the edit plan for a Word file, and the rules that decide
// whether it may run.
//
// Apply on a `.docx` inverts who does the writing, exactly as spec 11 §7.2 did
// for a deck: the agent produces this document, REX performs it. It exists
// because the alternative is an agent unzipping the reviewer's file, rewriting
// XML and rezipping it, with nothing between it and the document.
//
// Every refusal below happens **before a single byte is written**, and a
// refusal is whole: §4.4 rule 4, no partial application, ever.

import type { ImageSource } from "../pptx/plan.ts";

export type { ImageSource };

/**
 * §4.5 — what `setStyle` may change.
 *
 * Deliberately smaller than the deck's `StyleSet` (spec 11 §7.5). A Word
 * paragraph has no box to fill and no border to draw, so the properties that
 * exist here are the ones a run or a paragraph actually carries.
 */
export interface StyleSet {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Points. Written as half-points, so 14 becomes `w:sz w:val="28"`. */
  fontSize?: number;
  /** A six-digit hex colour, with or without the `#`. */
  color?: string;
  fontFace?: string;
  align?: "left" | "center" | "right" | "justify";
}

export type Operation =
  | { op: "setText"; at: number; from: string; to: string }
  | { op: "insertParagraph"; after: number; text: string; style?: string }
  | { op: "deleteParagraph"; at: number; from: string }
  | { op: "moveParagraph"; at: number; from: string; after: number }
  | { op: "setStyle"; at: number; from?: StyleSet; set: StyleSet }
  | { op: "setHeadingLevel"; at: number; from: string; level: number }
  | { op: "setListLevel"; at: number; from: string; level: number }
  | { op: "insertRow"; at: number; cells: string[] }
  | { op: "deleteRow"; at: number; from: string[] }
  | { op: "insertImage"; after: number; source: ImageSource; alt: string };

export type OperationKind = Operation["op"];

export interface EditPlan {
  /** Absolute path to the Word file this plan is for. */
  document: string;
  operations: Operation[];
}

/**
 * §4.5 — the nine, grouped as the spec groups them.
 *
 * **Nine, not the ten §4.5 listed.** `setCellText` was dropped while building
 * 19.2: §4.1 already decided that a cell is a paragraph inside a table and
 * needs no separate model, and §4.3 gives every cell paragraph a body position
 * in the sidecar. So `setText` at that position already changes a cell, and a
 * second name for one surgery is only a second way to get it wrong. A row is
 * not a paragraph, so `insertRow` and `deleteRow` stay.
 */
export const OPERATIONS: readonly OperationKind[] = [
  "setText",
  "insertParagraph",
  "deleteParagraph",
  "moveParagraph",
  "setStyle",
  "setHeadingLevel",
  "setListLevel",
  "insertRow",
  "deleteRow",
  "insertImage",
];

/**
 * §4.4 rule 1 — every operation that changes something that already exists
 * names what it expects to find.
 *
 * The check that the expectation *holds* happens in the surgery, against the
 * real XML. This is only the check that the agent stated one.
 */
const NEEDS_FROM = new Set<OperationKind>([
  "setText",
  "deleteParagraph",
  "moveParagraph",
  "setHeadingLevel",
  "setListLevel",
  "deleteRow",
]);

export class PlanError extends Error {}

function fail(reason: string): never {
  throw new PlanError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${what} must be a non-empty string.`);
  return value;
}

/**
 * What an operation expects to find — which may legitimately be nothing.
 *
 * `from` must be **present**, and it may be empty: a blank line between two
 * sections is a paragraph, it says nothing, and `setText` on it is how a
 * reviewer's "add a sentence here" gets carried out. Requiring a non-empty
 * string here made every empty paragraph in the document unaddressable, which
 * is how this was found — building 19.3 against a real file.
 */
function requireExpectation(value: unknown, what: string): string {
  if (typeof value !== "string") fail(`${what} must be a string — what you expect to find.`);
  return value;
}

/** §4.4 — a paragraph is named by its position in the sidecar, counting from 1. */
function requirePosition(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(
      `${what} must be a whole paragraph position counting from 1, as the sidecar numbers them.`,
    );
  }
  return value;
}

/** `after: 0` is the one legal zero — it means "before the first paragraph". */
function requireAfter(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(`${what} must be a paragraph position, or 0 to go before the first paragraph.`);
  }
  return value;
}

const STYLE_KEYS = new Set([
  "bold",
  "italic",
  "underline",
  "fontSize",
  "color",
  "fontFace",
  "align",
]);

function requireStyle(value: unknown, what: string): StyleSet {
  if (!isRecord(value)) fail(`${what} must be an object of style properties.`);
  const unknown = Object.keys(value).filter((key) => !STYLE_KEYS.has(key));
  if (unknown.length > 0) {
    fail(`${what} names ${unknown.join(", ")}, which ${what} cannot set.`);
  }
  if (Object.keys(value).length === 0) fail(`${what} names no property to change.`);
  if (value.align !== undefined) {
    const allowed = ["left", "center", "right", "justify"];
    if (typeof value.align !== "string" || !allowed.includes(value.align)) {
      fail(`${what}.align must be one of: ${allowed.join(", ")}.`);
    }
  }
  if (value.color !== undefined) {
    if (typeof value.color !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(value.color)) {
      fail(`${what}.color must be a six-digit hex colour such as "1a1a1a".`);
    }
  }
  if (value.fontSize !== undefined) {
    if (typeof value.fontSize !== "number" || value.fontSize <= 0 || value.fontSize > 400) {
      fail(`${what}.fontSize must be a size in points.`);
    }
  }
  return value as StyleSet;
}

/**
 * §5.3 — a heading level, where 0 means "make this body text again".
 *
 * Six is Word's limit and it is not arbitrary: `Heading7` is not a style Word
 * defines, so a plan asking for one names a style no document has.
 */
function requireLevel(value: unknown, what: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    fail(`${what} must be a whole number from 0 to ${max}.`);
  }
  return value;
}

/** Reuses the deck's four source shapes unchanged — §5.4. */
function requireSource(value: unknown, what: string): ImageSource {
  if (!isRecord(value)) fail(`${what} must name where the picture comes from.`);
  switch (value.from) {
    case "web":
      return {
        from: "web",
        query: requireString(value.query, `${what}.query`),
        url: requireString(value.url, `${what}.url`),
        credit: requireString(value.credit, `${what}.credit`),
        licence: requireString(value.licence, `${what}.licence`),
      };
    case "diagram":
      if (value.engine !== "mermaid") fail(`${what}.engine must be "mermaid".`);
      return {
        from: "diagram",
        engine: "mermaid",
        source: requireString(value.source, `${what}.source`),
      };
    case "file":
      return { from: "file", path: requireString(value.path, `${what}.path`) };
    default:
      // §9 — generated media is a deck feature and is not offered here. A Word
      // document under review is prose, and the one picture operation it has
      // exists for the diagram a reviewer asked for.
      fail(`${what}.from must be "web", "diagram" or "file".`);
  }
}

function parseOperation(raw: unknown, at: number): Operation {
  if (!isRecord(raw)) fail(`Operation ${at + 1} is not an object.`);
  const kind = raw.op;
  if (typeof kind !== "string" || !OPERATIONS.includes(kind as OperationKind)) {
    fail(
      `Operation ${at + 1} has op '${String(kind)}', which is not one of: ${OPERATIONS.join(", ")}.`,
    );
  }
  const op = kind as OperationKind;
  const where = `operation ${at + 1} (${op})`;

  if (NEEDS_FROM.has(op) && raw.from === undefined) {
    fail(`${where} must carry 'from' — what it expects the paragraph to say before it changes it.`);
  }

  switch (op) {
    case "setText":
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        from: requireExpectation(raw.from, `${where}.from`),
        // An empty `to` is a deliberate way to clear a paragraph without
        // removing it — the blank line between two sections stays a blank line.
        to: typeof raw.to === "string" ? raw.to : fail(`${where}.to must be a string.`),
      };
    case "insertParagraph":
      return {
        op,
        after: requireAfter(raw.after, `${where}.after`),
        text: typeof raw.text === "string" ? raw.text : fail(`${where}.text must be a string.`),
        ...(raw.style !== undefined ? { style: requireString(raw.style, `${where}.style`) } : {}),
      };
    case "deleteParagraph":
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        from: requireExpectation(raw.from, `${where}.from`),
      };
    case "moveParagraph":
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        from: requireExpectation(raw.from, `${where}.from`),
        after: requireAfter(raw.after, `${where}.after`),
      };
    case "setStyle":
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        ...(raw.from !== undefined ? { from: requireStyle(raw.from, `${where}.from`) } : {}),
        set: requireStyle(raw.set, `${where}.set`),
      };
    case "setHeadingLevel":
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        from: requireExpectation(raw.from, `${where}.from`),
        level: requireLevel(raw.level, `${where}.level`, 6),
      };
    case "setListLevel":
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        from: requireExpectation(raw.from, `${where}.from`),
        // Word allows nine list levels, numbered 0 to 8 in the XML. The plan
        // counts from 1, as the sidecar prints it.
        level: requireLevel(raw.level, `${where}.level`, 9),
      };
    case "insertRow": {
      if (!Array.isArray(raw.cells)) fail(`${where}.cells must be a list of cell texts.`);
      return {
        op,
        // One addressing rule for the whole plan: a paragraph position. The new
        // row goes after the row that paragraph is in, so the sidecar needs no
        // second numbering scheme for rows.
        at: requirePosition(raw.at, `${where}.at`),
        cells: raw.cells.map((cell, index) =>
          typeof cell === "string" ? cell : fail(`${where}.cells[${index}] must be a string.`),
        ),
      };
    }
    case "deleteRow": {
      if (!Array.isArray(raw.from)) {
        fail(`${where}.from must be the list of cell texts the row holds now.`);
      }
      return {
        op,
        at: requirePosition(raw.at, `${where}.at`),
        from: raw.from.map((cell, index) =>
          typeof cell === "string" ? cell : fail(`${where}.from[${index}] must be a string.`),
        ),
      };
    }
    case "insertImage":
      return {
        op,
        after: requireAfter(raw.after, `${where}.after`),
        source: requireSource(raw.source, `${where}.source`),
        // A document REX has edited must not be less accessible than the one it
        // was handed. Spec 11 §7.4.4 made the same requirement of a deck.
        alt: requireString(raw.alt, `${where}.alt`),
      };
  }
}

/**
 * §4.4 rule 3 — one plan is a set of edits to **one state**.
 *
 * Every position refers to the document as the agent read it, not to the
 * document as earlier operations will leave it. The surgery keeps that true by
 * applying back to front (§5.1), and this is the check that the plan does not
 * name the same paragraph twice — two edits to one paragraph in one plan cannot
 * both be true of the state they were written against.
 */
function refuseRepeatedTargets(operations: readonly Operation[]): void {
  const seen = new Map<number, OperationKind>();
  for (const operation of operations) {
    if (!("at" in operation)) continue;
    const already = seen.get(operation.at);
    if (already !== undefined) {
      fail(
        `This plan changes paragraph ${operation.at} twice (${already}, then ${operation.op}). ` +
          "Every position in a plan names the document as you read it, so two edits to one " +
          "paragraph cannot both be right. Make it one operation, or use two Applies.",
      );
    }
    seen.set(operation.at, operation.op);
  }
}

/** Parse and check a plan, or refuse it with a reason a reviewer can act on. */
export function parsePlan(raw: unknown): EditPlan {
  if (typeof raw === "string") {
    try {
      return parsePlan(JSON.parse(raw));
    } catch (error) {
      if (error instanceof PlanError) throw error;
      fail(`The plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isRecord(raw)) fail("The plan must be a JSON object.");

  const document = requireString(raw.document, "plan.document");
  if (!Array.isArray(raw.operations)) fail("plan.operations must be a list.");
  if (raw.operations.length === 0) fail("This plan has no operations.");

  const operations = raw.operations.map(parseOperation);
  refuseRepeatedTargets(operations);

  return { document, operations };
}
