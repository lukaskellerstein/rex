// Spec 11 §7.5 — changing style.
//
// "Make this heading bigger", "this blue is wrong", "use Georgia for the
// titles" are ordinary review comments, and a tool that cannot act on them
// sends the reviewer back to PowerPoint for half of what they wanted.
//
// It is also the operation class most able to ruin a deck **quietly**, so four
// rules make it safe enough to enable, and each is implemented here:
//
//  §7.5.1  Named properties only, never a replacement. A shape inherits most of
//          its formatting from the layout and the master; an operation that
//          rewrote the properties block would flatten that — the slide looks
//          identical today and stops following the template forever.
//  §7.5.2  A colour that is in the deck's theme is written as a theme
//          reference. A hardcoded hex looks right today and is wrong the moment
//          the deck is re-themed, with nothing about the slide showing it.
//  §7.5.3  A font must already be in the deck, or be declared new. Silent font
//          substitution is the classic way a deck degrades.
//  §7.5.5  REX checks the mechanical result and has no opinion on the visual
//          one. That is the reviewer's call, and §7.7's pictures are what put
//          it in front of them.

import {
  attributeOf,
  type ElementSpan,
  escapeXml,
  firstElement,
  scanElements,
  splice,
  withAttribute,
} from "../ooxml/xml.ts";
import type { ShapeSpan } from "./deck.ts";
import type { StyleSet } from "./plan.ts";

/** §7.5.2 — the six accents a deck's theme names, in the library's order. */
export function schemeNameFor(colour: string, themeColors: readonly string[]): string | null {
  const wanted = colour.trim().toLowerCase();
  if (/^(accent[1-6]|dk1|dk2|lt1|lt2|hlink|folHlink|tx1|tx2|bg1|bg2)$/i.test(wanted)) {
    return wanted;
  }
  const at = themeColors.findIndex((theme) => theme.trim().toLowerCase() === wanted);
  return at === -1 ? null : `accent${at + 1}`;
}

/** `#F39C12` or `F39C12` → the six hex digits OOXML wants. */
function srgb(colour: string): string {
  return colour.replace(/^#/, "").toUpperCase();
}

/**
 * A colour as OOXML, preferring the theme.
 *
 * `pptxtojson` returns `themeColors`, so REX knows the deck's palette at parse
 * time and can make this substitution without asking. It closes the one failure
 * mode that made this operation look too dangerous to include.
 */
export function colourXml(colour: string, themeColors: readonly string[]): string {
  const scheme = schemeNameFor(colour, themeColors);
  return scheme
    ? `<a:schemeClr val="${escapeXml(scheme)}"/>`
    : `<a:srgbClr val="${escapeXml(srgb(colour))}"/>`;
}

/**
 * Set or replace one child element inside a properties block, leaving every
 * other child exactly where it was.
 *
 * This is §7.5.1 in one function: the block is never rebuilt, only the one
 * element the plan named is written.
 */
function setChild(xml: string, parent: ElementSpan, name: string, replacement: string): string {
  const existing = firstElement(xml, name, parent.openEnd, parent.innerEnd);
  if (existing) return splice(xml, existing.start, existing.end, replacement);
  // A properties block's children are order-sensitive in OOXML's schema, and
  // the fill family comes first. Prepending is right for every element written
  // here and is what PowerPoint itself produces.
  return splice(xml, parent.openEnd, parent.openEnd, replacement);
}

/** The `<a:rPr>` of a run, created empty when the run has none. */
function ensureRunProperties(xml: string, run: ElementSpan): { xml: string; at: ElementSpan } {
  const existing = firstElement(xml, "a:rPr", run.openEnd, run.innerEnd);
  if (existing) return { xml, at: existing };
  const out = splice(xml, run.openEnd, run.openEnd, `<a:rPr lang="en-US" dirty="0"/>`);
  const created = firstElement(out, "a:rPr", run.openEnd, run.innerEnd + 32);
  if (!created) throw new Error("The run's properties could not be created.");
  return { xml: out, at: created };
}

/** The `<a:pPr>` of a paragraph, created empty when it has none. */
function ensureParagraphProperties(
  xml: string,
  paragraph: ElementSpan,
): { xml: string; at: ElementSpan } {
  const existing = firstElement(xml, "a:pPr", paragraph.openEnd, paragraph.innerEnd);
  if (existing) return { xml, at: existing };
  const out = splice(xml, paragraph.openEnd, paragraph.openEnd, `<a:pPr/>`);
  const created = firstElement(out, "a:pPr", paragraph.openEnd, paragraph.innerEnd + 16);
  if (!created) throw new Error("The paragraph's properties could not be created.");
  return { xml: out, at: created };
}

export interface StyleContext {
  themeColors: readonly string[];
  /** Every font the deck already uses, for §7.5.3. */
  usedFonts: ReadonlySet<string>;
  allowNewFont: boolean;
}

/** What the reviewer must be told about a style change before accepting it. */
export interface StyleFlags {
  flags: string[];
}

/**
 * Write the run-level properties a `StyleSet` names, and nothing else.
 *
 * A self-closing `<a:rPr/>` is expanded on the way, because a property like
 * `color` is a child element and a self-closing tag has nowhere to put one.
 */
function applyRunStyle(
  xml: string,
  properties: ElementSpan,
  set: StyleSet,
  context: StyleContext,
): string {
  let out = xml;
  let at = properties;

  if (at.selfClosing && (set.color !== undefined || set.fontFace !== undefined)) {
    const open = out.slice(at.start, at.openEnd);
    out = splice(out, at.start, at.end, `${open.slice(0, -2)}></a:rPr>`);
    const reopened = firstElement(out, "a:rPr", at.start, out.length);
    if (!reopened) throw new Error("The run's properties could not be opened.");
    at = reopened;
  }

  const attribute = (name: string, value: string): void => {
    const open = out.slice(at.start, at.openEnd);
    const replaced = withAttribute(open, name, value);
    out = splice(out, at.start, at.openEnd, replaced);
    at = {
      ...at,
      openEnd: at.openEnd + (replaced.length - open.length),
      innerEnd: at.innerEnd + (replaced.length - open.length),
      end: at.end + (replaced.length - open.length),
    };
  };

  // §7.5 — `sz` is in HUNDREDTHS of a point, so 32pt is `3200`. Writing 32
  // produces a third-of-a-point heading that looks like the text vanished.
  if (set.fontSize !== undefined) attribute("sz", String(Math.round(set.fontSize * 100)));
  if (set.bold !== undefined) attribute("b", set.bold ? "1" : "0");
  if (set.italic !== undefined) attribute("i", set.italic ? "1" : "0");
  if (set.underline !== undefined) attribute("u", set.underline ? "sng" : "none");

  if (set.color !== undefined) {
    out = setChild(
      out,
      at,
      "a:solidFill",
      `<a:solidFill>${colourXml(set.color, context.themeColors)}</a:solidFill>`,
    );
    const again = firstElement(out, "a:rPr", at.start, out.length);
    if (again) at = again;
  }

  if (set.fontFace !== undefined) {
    // All three, because a deck with Czech or CJK text falls back to `ea`/`cs`
    // and a change to `latin` alone leaves half the deck on the old face.
    for (const tag of ["a:latin", "a:ea", "a:cs"]) {
      out = setChild(out, at, tag, `<${tag} typeface="${escapeXml(set.fontFace)}"/>`);
      const again = firstElement(out, "a:rPr", at.start, out.length);
      if (again) at = again;
    }
  }

  return out;
}

function applyParagraphStyle(xml: string, properties: ElementSpan, set: StyleSet): string {
  let out = xml;
  let at = properties;

  if (set.align !== undefined) {
    const map: Record<string, string> = { left: "l", center: "ctr", right: "r", justify: "just" };
    const open = out.slice(at.start, at.openEnd);
    const replaced = withAttribute(open, "algn", map[set.align] ?? "l");
    out = splice(out, at.start, at.openEnd, replaced);
    const again = firstElement(out, "a:pPr", at.start, out.length);
    if (again) at = again;
  }

  if (set.lineSpacing !== undefined) {
    // §7.5 — a multiplier, written as a percentage in thousandths: 1.2 is
    // `val="120000"`.
    if (at.selfClosing) {
      const open = out.slice(at.start, at.openEnd);
      out = splice(out, at.start, at.end, `${open.slice(0, -2)}></a:pPr>`);
      const reopened = firstElement(out, "a:pPr", at.start, out.length);
      if (!reopened) throw new Error("The paragraph's properties could not be opened.");
      at = reopened;
    }
    out = setChild(
      out,
      at,
      "a:lnSpc",
      `<a:lnSpc><a:spcPct val="${Math.round(set.lineSpacing * 100000)}"/></a:lnSpc>`,
    );
  }

  return out;
}

function applyShapeStyle(
  xml: string,
  shape: ShapeSpan,
  set: StyleSet,
  context: StyleContext,
): string {
  let out = xml;

  if (set.vAlign !== undefined) {
    const body = firstElement(out, "a:bodyPr", shape.span.openEnd, shape.span.innerEnd);
    if (body) {
      const map: Record<string, string> = { top: "t", middle: "ctr", bottom: "b" };
      const open = out.slice(body.start, body.openEnd);
      out = splice(out, body.start, body.openEnd, withAttribute(open, "anchor", map[set.vAlign]));
    }
  }

  if (set.fill !== undefined || set.borderColor !== undefined || set.borderWidth !== undefined) {
    const properties = firstElement(out, "p:spPr", shape.span.openEnd, shape.span.innerEnd);
    if (!properties) throw new Error(`'${shape.name}' has no shape properties to style.`);

    if (set.fill !== undefined) {
      out = setChild(
        out,
        properties,
        "a:solidFill",
        `<a:solidFill>${colourXml(set.fill, context.themeColors)}</a:solidFill>`,
      );
    }
    if (set.borderColor !== undefined || set.borderWidth !== undefined) {
      const again = firstElement(out, "p:spPr", shape.span.openEnd, out.length);
      if (!again) throw new Error(`'${shape.name}' lost its shape properties.`);
      const width =
        set.borderWidth === undefined ? "" : ` w="${Math.round(set.borderWidth * 12700)}"`;
      const colour =
        set.borderColor === undefined
          ? ""
          : `<a:solidFill>${colourXml(set.borderColor, context.themeColors)}</a:solidFill>`;
      out = setChild(out, again, "a:ln", `<a:ln${width}>${colour}</a:ln>`);
    }
  }

  return out;
}

/**
 * §7.2.2 rule 1 for style — what the shape says about itself right now.
 *
 * Only what is written **on the shape**. A property a shape inherits from the
 * layout or the master is not here, and cannot be: reading it would mean
 * resolving the whole placeholder chain, and a `from` checked against a guessed
 * value is worse than one not checked at all. `applyStyle` flags the properties
 * it could not verify rather than passing silently.
 */
export function readStyle(xml: string, shape: ShapeSpan): StyleSet {
  const body = firstElement(xml, "p:txBody", shape.span.openEnd, shape.span.innerEnd);
  const found: StyleSet = {};
  if (!body) return found;

  const run = firstElement(xml, "a:rPr", body.openEnd, body.innerEnd);
  if (run) {
    const size = attributeOf(xml, run, "sz");
    if (size) found.fontSize = Number(size) / 100;
    const bold = attributeOf(xml, run, "b");
    if (bold) found.bold = bold === "1";
    const italic = attributeOf(xml, run, "i");
    if (italic) found.italic = italic === "1";
    const underline = attributeOf(xml, run, "u");
    if (underline) found.underline = underline !== "none";
    const latin = firstElement(xml, "a:latin", run.openEnd, run.innerEnd);
    const face = latin ? attributeOf(xml, latin, "typeface") : null;
    if (face) found.fontFace = face;
  }

  const paragraph = firstElement(xml, "a:pPr", body.openEnd, body.innerEnd);
  const align = paragraph ? attributeOf(xml, paragraph, "algn") : null;
  if (align) {
    const map: Record<string, StyleSet["align"]> = {
      l: "left",
      ctr: "center",
      r: "right",
      just: "justify",
    };
    found.align = map[align];
  }

  return found;
}

/**
 * §7.2.2 rule 1 — refuse when the shape is not in the state the plan expects.
 *
 * A property the shape does not set directly is *unverifiable* rather than
 * wrong, and it is reported as such: the operation still runs, and the preview
 * says which parts of the expectation could not be checked.
 */
export function checkExpectedStyle(
  present: StyleSet,
  expected: StyleSet,
  shapeName: string,
): string[] {
  const unverified: string[] = [];
  for (const [key, wanted] of Object.entries(expected) as Array<[keyof StyleSet, unknown]>) {
    const now = present[key];
    if (now === undefined) {
      unverified.push(key);
      continue;
    }
    if (now !== wanted) {
      throw new Error(
        `'${shapeName}' has ${key} ${String(now)}, not ${String(wanted)} as the plan expects. Nothing was written.`,
      );
    }
  }
  return unverified;
}

export interface StyleTarget {
  scope: "shape" | "paragraph" | "run";
  index?: number;
}

/**
 * §7.5 — apply a style set to a shape, a paragraph, or one run.
 *
 * `scope: "run"` is how "bold just that one word" is expressed, and it is the
 * reason the scope exists at all.
 */
export function applyStyle(
  xml: string,
  shape: ShapeSpan,
  target: StyleTarget,
  set: StyleSet,
  context: StyleContext,
): { xml: string; flags: string[] } {
  const flags: string[] = [];

  // §7.5.3 — silent font substitution is the classic way a deck degrades: the
  // machine that edits it has the font, the machine that opens it does not, and
  // PowerPoint quietly swaps in something with different metrics.
  if (set.fontFace !== undefined && !context.usedFonts.has(set.fontFace)) {
    if (!context.allowNewFont) {
      throw new Error(
        `'${set.fontFace}' is not a font this deck already uses. Set "allowNewFont": true if that is deliberate.`,
      );
    }
    flags.push(
      `"${set.fontFace}" is not already in this deck. A machine without it will substitute another face.`,
    );
  }

  // §7.5.2 — a colour outside the palette is a design decision, and the
  // reviewer should see that they are making one.
  for (const colour of [set.color, set.fill, set.borderColor]) {
    if (colour !== undefined && schemeNameFor(colour, context.themeColors) === null) {
      flags.push(`${colour} is not in this deck's theme, so it is written as a fixed colour.`);
    }
  }

  const body = firstElement(xml, "p:txBody", shape.span.openEnd, shape.span.innerEnd);
  let out = xml;

  const touchesText =
    set.fontFace !== undefined ||
    set.fontSize !== undefined ||
    set.bold !== undefined ||
    set.italic !== undefined ||
    set.underline !== undefined ||
    set.color !== undefined ||
    set.align !== undefined ||
    set.lineSpacing !== undefined;

  if (touchesText) {
    if (!body) throw new Error(`'${shape.name}' holds no text to style.`);
    const paragraphs = scanElements(out, "a:p", body.openEnd, body.innerEnd);
    const chosen =
      target.scope === "paragraph" || target.scope === "run"
        ? paragraphs.slice(
            pickIndex(target, paragraphs.length),
            pickIndex(target, paragraphs.length) + 1,
          )
        : paragraphs;
    if (chosen.length === 0) throw new Error(`'${shape.name}' has no such paragraph.`);

    // Back to front, so an earlier paragraph's offsets stay valid after a later
    // one grows.
    for (let p = chosen.length - 1; p >= 0; p--) {
      const paragraph = refind(out, chosen[p], "a:p");
      if (set.align !== undefined || set.lineSpacing !== undefined) {
        const ensured = ensureParagraphProperties(out, paragraph);
        out = applyParagraphStyle(ensured.xml, ensured.at, set);
      }

      const runs = scanElements(
        out,
        "a:r",
        refind(out, paragraph, "a:p").openEnd,
        refind(out, paragraph, "a:p").innerEnd,
      );
      const runTargets =
        target.scope === "run"
          ? runs.slice(pickIndex(target, runs.length), pickIndex(target, runs.length) + 1)
          : runs;
      if (target.scope === "run" && runTargets.length === 0) {
        throw new Error(`'${shape.name}' has no run ${target.index}.`);
      }

      for (let r = runTargets.length - 1; r >= 0; r--) {
        const ensured = ensureRunProperties(out, runTargets[r]);
        out = applyRunStyle(ensured.xml, ensured.at, set, context);
      }
    }
  }

  out = applyShapeStyle(out, refindShape(out, shape), set, context);

  // §7.5.5 — the one thing worth watching: PowerPoint only shrinks text when
  // `<a:normAutofit/>` is set, so raising a font size on a shape without it is
  // the most likely way to push text off its card.
  const refreshed = refindShape(out, shape);
  if (
    set.fontSize !== undefined &&
    firstElement(out, "a:normAutofit", refreshed.span.openEnd, refreshed.span.innerEnd) === null
  ) {
    flags.push("This shape does not shrink text to fit, so a larger size may overflow it.");
  }

  return { xml: out, flags };
}

function pickIndex(target: StyleTarget, count: number): number {
  const index = (target.index ?? 1) - 1;
  if (index < 0 || index >= count) {
    throw new Error(`There is no ${target.scope} ${target.index} here — there are ${count}.`);
  }
  return index;
}

/** The same element after the string around it moved. */
function refind(xml: string, span: ElementSpan, name: string): ElementSpan {
  const found = firstElement(xml, name, span.start, xml.length);
  return found ?? span;
}

function refindShape(xml: string, shape: ShapeSpan): ShapeSpan {
  const found = firstElement(xml, shape.tag, shape.span.start, xml.length);
  return found ? { ...shape, span: found } : shape;
}

/**
 * §7.5.4 — how a whole deck changes font.
 *
 * Changing every shape one at a time would be a hundred operations and would
 * flatten the inheritance §7.5.1 protects. The correct edit is one: rewrite
 * `<a:fontScheme>`, and every shape that inherits — which is most of them —
 * follows. Shapes with a hardcoded `<a:latin>` do not, and the preview shows
 * that by rendering the result rather than by claiming success.
 */
export function setThemeFontXml(themeXml: string, major: string, minor: string): string {
  const scheme = firstElement(themeXml, "a:fontScheme");
  if (!scheme) throw new Error("This theme has no font scheme.");

  let out = themeXml;
  for (const [tag, face] of [
    ["a:majorFont", major],
    ["a:minorFont", minor],
  ] as const) {
    const block = firstElement(out, tag, scheme.openEnd, scheme.innerEnd);
    if (!block) continue;
    const latin = firstElement(out, "a:latin", block.openEnd, block.innerEnd);
    const replacement = `<a:latin typeface="${escapeXml(face)}"/>`;
    out = latin
      ? splice(out, latin.start, latin.end, replacement)
      : splice(out, block.openEnd, block.openEnd, replacement);
  }
  return out;
}

/** The typefaces a theme currently names, for the preview's before-and-after. */
export function themeFontsOf(themeXml: string): { major: string | null; minor: string | null } {
  const scheme = firstElement(themeXml, "a:fontScheme");
  if (!scheme) return { major: null, minor: null };
  const read = (tag: string): string | null => {
    const block = firstElement(themeXml, tag, scheme.openEnd, scheme.innerEnd);
    if (!block) return null;
    const latin = firstElement(themeXml, "a:latin", block.openEnd, block.innerEnd);
    return latin ? attributeOf(themeXml, latin, "typeface") : null;
  };
  return { major: read("a:majorFont"), minor: read("a:minorFont") };
}
