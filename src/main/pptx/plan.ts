// Spec 11 §7.2 — the edit plan, and the rules that decide whether it may run.
//
// Apply on a deck **inverts who does the writing**. The agent produces this
// document; REX performs it. That is the shape spec 01 §8.7 already has — the
// agent proposes, the user accepts, REX performs — applied to bytes instead of
// prose, and it exists because the alternative is an agent splicing arbitrary
// bytes into the reviewer's file with nothing between it and the deck.
//
// Validation here is not decoration. §7.2.2 rule 5: an unparseable or
// schema-invalid plan fails the run, with no partial application, ever. Every
// refusal below happens before a single byte is written.

/** §7.2.2 rule 4 — a box is fractions of the slide, never points. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** §7.4 — the three places a picture can come from, plus the generated one. */
export type ImageSource =
  | { from: "web"; query: string; url: string; credit: string; licence: string }
  | { from: "diagram"; engine: "mermaid"; source: string }
  | { from: "file"; path: string }
  | { from: "generated"; engine: "image" | "video"; prompt: string; path: string };

/** §7.5 — only the properties the plan names are written. */
export interface StyleSet {
  fontFace?: string;
  /** Points. Written as hundredths of a point, so 32 becomes `sz="3200"`. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** A hex colour, or a theme name such as `accent1` (§7.5.2). */
  color?: string;
  align?: "left" | "center" | "right" | "justify";
  vAlign?: "top" | "middle" | "bottom";
  /** A multiplier: 1.2 is written as `val="120000"`. */
  lineSpacing?: number;
  fill?: string;
  borderColor?: string;
  /** Points. */
  borderWidth?: number;
}

export type Operation =
  | { op: "setText"; slide: number; shape: string; from: string; to: string }
  | { op: "insertTextBox"; slide: number; box: Box; text: string; name?: string; style?: StyleSet }
  | {
      op: "insertImage";
      slide: number;
      placement?: "background";
      box?: Box;
      source: ImageSource;
      alt: string;
    }
  | {
      op: "replaceImage";
      slide: number;
      shape: string;
      from: string;
      source: ImageSource;
      alt: string;
    }
  | { op: "insertVideo"; slide: number; box: Box; source: ImageSource; alt: string }
  | { op: "moveShape"; slide: number; shape: string; from: Box; to: Box }
  | {
      op: "setStyle";
      slide: number;
      shape: string;
      scope: "shape" | "paragraph" | "run";
      index?: number;
      from?: StyleSet;
      set: StyleSet;
      allowNewFont?: boolean;
    }
  | { op: "deleteShape"; slide: number; shape: string; from: string }
  | { op: "reorderSlides"; order: number[] }
  | { op: "duplicateSlide"; slide: number }
  | { op: "deleteSlide"; slide: number; from: string }
  | { op: "setThemeFont"; major: string; minor: string };

export type OperationKind = Operation["op"];

export interface EditPlan {
  /** Absolute path to the deck this plan is for. */
  deck: string;
  operations: Operation[];
}

/** §7.2.1 — the twelve, grouped as the spec groups them. */
export const OPERATIONS: readonly OperationKind[] = [
  "setText",
  "insertTextBox",
  "insertImage",
  "replaceImage",
  "insertVideo",
  "moveShape",
  "setStyle",
  "deleteShape",
  "reorderSlides",
  "duplicateSlide",
  "deleteSlide",
  "setThemeFont",
];

/**
 * §7.2.2 rule 1 — every operation that changes something that already exists
 * names what it expects to find.
 *
 * This is the anchor fingerprint idea (§5.2) applied to edits: an operation
 * that states its expectation cannot silently act on something else. The check
 * that the expectation *holds* happens in the surgery, against the real XML.
 */
const NEEDS_FROM = new Set<OperationKind>([
  "setText",
  "setStyle",
  "moveShape",
  "deleteShape",
  "replaceImage",
  "deleteSlide",
]);

/** Operations that change slide order or slide count. */
const SLIDE_STRUCTURE = new Set<OperationKind>(["reorderSlides", "duplicateSlide", "deleteSlide"]);

export class PlanError extends Error {}

/**
 * Spec 11 §6.4.3 — whether a plan may use `from: "generated"` at all.
 *
 * Set once at start-up from whether `GEMINI_API_KEY` is present. A plan that
 * names generated media without it is refused here rather than failing later
 * with a tool error: §6.4.3 wants the feature **absent**, not half-working, and
 * absent means the contract says no.
 */
let generationEnabled = false;

export function setGenerationEnabled(enabled: boolean): void {
  generationEnabled = enabled;
}

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

function requirePosition(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(`${what} must be a whole slide position counting from 1.`);
  }
  return value;
}

/**
 * §7.2.2 rule 4 — a deck can be 16:9 or 4:3, and a plan written in points
 * silently misplaces everything on the other one. Fractions cannot.
 */
function requireBox(value: unknown, what: string): Box {
  if (!isRecord(value)) fail(`${what} must be a box with x, y, w and h.`);
  const box = { x: value.x, y: value.y, w: value.w, h: value.h };
  for (const [key, side] of Object.entries(box)) {
    if (typeof side !== "number" || !Number.isFinite(side)) {
      fail(`${what}.${key} must be a number.`);
    }
    if (side < -1 || side > 2) {
      fail(`${what}.${key} is ${side}, which is not a fraction of the slide. Boxes are 0 to 1.`);
    }
  }
  if ((box.w as number) <= 0 || (box.h as number) <= 0) {
    fail(`${what} must have a positive width and height.`);
  }
  return box as Box;
}

function requireSource(value: unknown, what: string): ImageSource {
  if (!isRecord(value)) fail(`${what} must name where the picture comes from.`);
  switch (value.from) {
    case "web":
      return {
        from: "web",
        query: requireString(value.query, `${what}.query`),
        url: requireString(value.url, `${what}.url`),
        // §7.4.1 — required and shown, never logged. A deck that goes to a
        // customer with a stock photograph in it is the reviewer's decision,
        // made with the credit line in front of them.
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
    case "generated":
      if (!generationEnabled) {
        fail(
          `${what} asks for generated media, which is off: REX only offers it when GEMINI_API_KEY is set.`,
        );
      }
      if (value.engine !== "image" && value.engine !== "video") {
        fail(`${what}.engine must be "image" or "video".`);
      }
      return {
        from: "generated",
        engine: value.engine,
        // §7.4 — shown in the preview. A reviewer about to put a picture in a
        // customer deck must be told it was generated, and by what instruction.
        prompt: requireString(value.prompt, `${what}.prompt`),
        path: requireString(value.path, `${what}.path`),
      };
    default:
      fail(`${what}.from must be "web", "diagram", "file" or "generated".`);
  }
}

const STYLE_KEYS = new Set([
  "fontFace",
  "fontSize",
  "bold",
  "italic",
  "underline",
  "color",
  "align",
  "vAlign",
  "lineSpacing",
  "fill",
  "borderColor",
  "borderWidth",
]);

function requireStyle(value: unknown, what: string): StyleSet {
  if (!isRecord(value)) fail(`${what} must be an object of style properties.`);
  const unknownKeys = Object.keys(value).filter((key) => !STYLE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    fail(`${what} names ${unknownKeys.join(", ")}, which ${what} cannot set.`);
  }
  if (Object.keys(value).length === 0) fail(`${what} names no property to change.`);
  return value as StyleSet;
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
    fail(`${where} must carry 'from' — what it expects to find before it changes anything.`);
  }

  switch (op) {
    case "setText":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        shape: requireString(raw.shape, `${where}.shape`),
        from: requireString(raw.from, `${where}.from`),
        // An empty `to` is a deliberate way to clear a shape's text.
        to: typeof raw.to === "string" ? raw.to : fail(`${where}.to must be a string.`),
      };
    case "insertTextBox":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        box: requireBox(raw.box, `${where}.box`),
        text: requireString(raw.text, `${where}.text`),
        ...(typeof raw.name === "string" ? { name: raw.name } : {}),
        ...(raw.style !== undefined ? { style: requireStyle(raw.style, `${where}.style`) } : {}),
      };
    case "insertImage": {
      if (raw.placement !== undefined && raw.placement !== "background") {
        fail(`${where}.placement can only be "background".`);
      }
      if (raw.placement !== "background" && raw.box === undefined) {
        fail(`${where} must name a box, or placement "background".`);
      }
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        ...(raw.placement === "background" ? { placement: "background" as const } : {}),
        ...(raw.box !== undefined ? { box: requireBox(raw.box, `${where}.box`) } : {}),
        source: requireSource(raw.source, `${where}.source`),
        // §7.4.4 — a deck REX has edited must not be less accessible than the
        // one it was handed.
        alt: requireString(raw.alt, `${where}.alt`),
      };
    }
    case "replaceImage":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        shape: requireString(raw.shape, `${where}.shape`),
        from: requireString(raw.from, `${where}.from`),
        source: requireSource(raw.source, `${where}.source`),
        alt: requireString(raw.alt, `${where}.alt`),
      };
    case "insertVideo":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        box: requireBox(raw.box, `${where}.box`),
        source: requireSource(raw.source, `${where}.source`),
        alt: requireString(raw.alt, `${where}.alt`),
      };
    case "moveShape":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        shape: requireString(raw.shape, `${where}.shape`),
        from: requireBox(raw.from, `${where}.from`),
        to: requireBox(raw.to, `${where}.to`),
      };
    case "setStyle": {
      const scope = raw.scope;
      if (scope !== "shape" && scope !== "paragraph" && scope !== "run") {
        fail(`${where}.scope must be "shape", "paragraph" or "run".`);
      }
      if (scope !== "shape" && typeof raw.index !== "number") {
        fail(`${where}.scope "${scope}" needs an index saying which one.`);
      }
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        shape: requireString(raw.shape, `${where}.shape`),
        scope,
        ...(typeof raw.index === "number" ? { index: raw.index } : {}),
        ...(raw.from !== undefined ? { from: requireStyle(raw.from, `${where}.from`) } : {}),
        set: requireStyle(raw.set, `${where}.set`),
        ...(raw.allowNewFont === true ? { allowNewFont: true } : {}),
      };
    }
    case "deleteShape":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        shape: requireString(raw.shape, `${where}.shape`),
        from: requireString(raw.from, `${where}.from`),
      };
    case "reorderSlides": {
      if (!Array.isArray(raw.order)) fail(`${where}.order must be a list of slide positions.`);
      const order = raw.order.map((position, index) =>
        requirePosition(position, `${where}.order[${index}]`),
      );
      // §7.6.1 — a full permutation cannot be ambiguous; "move 7 to position 4"
      // reads as an instruction whose meaning depends on what else moved.
      const seen = new Set(order);
      if (seen.size !== order.length) fail(`${where}.order repeats a slide.`);
      for (let position = 1; position <= order.length; position++) {
        if (!seen.has(position)) {
          fail(`${where}.order leaves out slide ${position}. It must be a full permutation.`);
        }
      }
      return { op, order };
    }
    case "duplicateSlide":
      return { op, slide: requirePosition(raw.slide, `${where}.slide`) };
    case "deleteSlide":
      return {
        op,
        slide: requirePosition(raw.slide, `${where}.slide`),
        from: requireString(raw.from, `${where}.from`),
      };
    case "setThemeFont":
      return {
        op,
        major: requireString(raw.major, `${where}.major`),
        minor: requireString(raw.minor, `${where}.minor`),
      };
  }
}

/**
 * §7.2.2 rule 3 — a plan may not both reorder slides and edit them.
 *
 * Slides are addressed by their current position, and position means nothing
 * halfway through a reorder. Resolving that ambiguity by guessing is how an
 * edit lands on the wrong slide, so it is refused instead: reorder in one
 * Apply, edit in another.
 */
function refuseMixedStructure(operations: readonly Operation[]): void {
  const structural = operations.filter((operation) => SLIDE_STRUCTURE.has(operation.op));
  if (structural.length === 0) return;
  const others = operations.filter((operation) => !SLIDE_STRUCTURE.has(operation.op));
  if (others.length > 0) {
    fail(
      `This plan both changes the slide order and edits slides (${structural[0].op} with ${others[0].op}). ` +
        "A slide position means nothing halfway through a reorder. Do them in separate Applies.",
    );
  }
  if (structural.length > 1) {
    fail("A plan may carry only one slide-order operation, for the same reason.");
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

  const deck = requireString(raw.deck, "plan.deck");
  if (!Array.isArray(raw.operations)) fail("plan.operations must be a list.");
  if (raw.operations.length === 0) fail("This plan has no operations.");

  // §7.2.2 rule 6 — no cap on how many slides a plan may touch. The protection
  // is §7.7, which shows every affected slide before and after; a cap would
  // only teach the agent to split a bad change across two runs.
  const operations = raw.operations.map(parseOperation);
  refuseMixedStructure(operations);

  return { deck, operations };
}
