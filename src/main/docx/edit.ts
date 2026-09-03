// Spec 19 §5 — the surgery.
//
// Every operation turns into one or more **splices against the original
// `word/document.xml`**, and the applier performs them back to front. That is
// what makes §4.4 rule 3 true: every position in a plan names the document as
// the agent read it, and an insertion cannot renumber the paragraph a later
// operation names, because no operation ever sees a string another one changed.
//
// String surgery, never a DOM round-trip (spec 11 §7.3). §5.6 has to be able to
// say "nothing it did not name changed", and that is only provable when the
// bytes it did not name are the bytes that were there.

import type { OoxmlPackage } from "../ooxml/package.ts";
import { type ElementSpan, escapeXml, firstElement, scanElements, splice } from "../ooxml/xml.ts";
import { describeSource, type MediaResolver, resolveSource } from "../pptx/media.ts";
import {
  DOCUMENT_PART,
  type DocxMap,
  type DocxParagraph,
  normalise,
  readDocxMap,
} from "./document.ts";
import {
  embedImage,
  fitToColumn,
  imageSize,
  inlinePictureXml,
  nextDrawingId,
  textWidthEmu,
} from "./parts.ts";
import type { EditPlan, Operation, OperationKind, StyleSet } from "./plan.ts";

/** One operation's result, as the preview reports it (§5.7). */
export interface Outcome {
  op: OperationKind;
  summary: string;
  /** Costs the reviewer must be told about, such as lost formatting. */
  flags: string[];
}

export interface EditResult {
  outcomes: Outcome[];
  bytes: Buffer;
}

/** A replacement of `[start, end)` in the original string. */
interface Edit {
  start: number;
  end: number;
  replacement: string;
}

export class EditError extends Error {}

function refuse(reason: string): never {
  throw new EditError(reason);
}

/** §4.4 — the paragraph an operation names, with both halves checked. */
function target(
  map: DocxMap,
  at: number,
  expected: string | null,
  op: OperationKind,
): DocxParagraph {
  const paragraph = map.paragraphs[at - 1];
  if (!paragraph) {
    refuse(
      `${op} names paragraph ${at}, and this document has ${map.paragraphs.length}. ` +
        "Positions come from the sidecar REX gave you.",
    );
  }
  if (paragraph.locked) {
    // §5.5 — refused, never attempted. The sidecar marked it `locked` before
    // the plan was written, so this is the backstop and not the first warning.
    refuse(`${op} names paragraph ${at}, which REX will not change because ${paragraph.locked}.`);
  }
  if (expected !== null && normalise(paragraph.text) !== normalise(expected)) {
    refuse(
      `${op} expected paragraph ${at} to say "${clip(expected)}" and it says "${clip(paragraph.text)}". ` +
        "Nothing was written.",
    );
  }
  return paragraph;
}

function clip(text: string): string {
  const flat = normalise(text);
  return flat.length > 70 ? `${flat.slice(0, 67)}…` : flat;
}

/** `xml:space="preserve"` matters whenever an edge of the text is a space. */
function textElement(value: string): string {
  const preserve = value !== value.trim() ? ' xml:space="preserve"' : "";
  return `<w:t${preserve}>${escapeXml(value)}</w:t>`;
}

/** The run properties of a paragraph's first run, so a rewrite keeps its look. */
function firstRunProperties(xml: string, paragraph: ElementSpan): string {
  const run = firstElement(xml, "w:r", paragraph.openEnd, paragraph.innerEnd);
  if (!run) return "";
  const properties = firstElement(xml, "w:rPr", run.openEnd, run.innerEnd);
  return properties ? xml.slice(properties.start, properties.end) : "";
}

/** The paragraph's own properties, cloned onto a paragraph inserted beside it. */
function paragraphProperties(xml: string, paragraph: ElementSpan): string {
  const properties = firstElement(xml, "w:pPr", paragraph.openEnd, paragraph.innerEnd);
  return properties ? xml.slice(properties.start, properties.end) : "";
}

/**
 * §5.2 — the run-merge rule.
 *
 * Word splits a paragraph across runs whenever formatting, spell-check state or
 * a revision id changes mid-sentence — §2.2 measured one paragraph in seven, up
 * to twelve runs. So "replace this sentence" is rarely one `<w:t>`:
 *
 *   - the replacement goes into the **first** `<w:t>` of the paragraph,
 *   - every other `<w:t>` in it is emptied,
 *   - the first run's `<w:rPr>` is kept.
 *
 * **This loses mid-sentence formatting.** A bolded word inside a replaced
 * sentence comes back unbolded. It is the cost spec 11 §7.3 accepted for a deck
 * and §5.7 requires it to be stated in the preview rather than discovered.
 */
function setTextEdits(
  xml: string,
  paragraph: DocxParagraph,
  to: string,
): { edits: Edit[]; flags: string[] } {
  const texts = scanElements(xml, "w:t", paragraph.span.openEnd, paragraph.span.innerEnd);
  const flags: string[] = [];

  if (texts.length === 0) {
    // An empty paragraph has no run to write into. One is built, carrying the
    // paragraph's own properties, and inserted after `<w:pPr>` if there is one.
    if (to.length === 0) return { edits: [], flags: [] };
    const properties = firstElement(xml, "w:pPr", paragraph.span.openEnd, paragraph.span.innerEnd);
    const at = properties ? properties.end : paragraph.span.openEnd;
    return { edits: [{ start: at, end: at, replacement: `<w:r>${textElement(to)}</w:r>` }], flags };
  }

  if (texts.length > 1) {
    flags.push(
      `the paragraph was written in ${texts.length} runs, so any bold or italic inside the sentence is now gone`,
    );
  }

  const edits: Edit[] = [
    { start: texts[0].start, end: texts[0].end, replacement: textElement(to) },
  ];
  for (const rest of texts.slice(1)) {
    edits.push({ start: rest.start, end: rest.end, replacement: "<w:t></w:t>" });
  }
  return { edits, flags };
}

/**
 * A hyperlink is structure the paragraph carries, not text (§5.5).
 *
 * `setText` on a paragraph holding one would rewrite the link's own runs and
 * leave a hyperlink pointing at a sentence that no longer says what it linked.
 * So the operation is refused when the paragraph's text lives partly inside a
 * `<w:hyperlink>` — which is the only case where the run-merge rule would touch
 * it, because the first `<w:t>` is the one that gets the replacement.
 */
function refuseIfHyperlinkAffected(xml: string, paragraph: DocxParagraph, op: OperationKind): void {
  const links = scanElements(xml, "w:hyperlink", paragraph.span.openEnd, paragraph.span.innerEnd);
  if (links.length === 0) return;
  refuse(
    `${op} names paragraph ${paragraph.index}, which holds a hyperlink. ` +
      "Rewriting it would leave the link pointing at text that is no longer there.",
  );
}

/** The style id whose name or id matches `Heading N`, or null when none does. */
function headingStyleId(map: DocxMap, level: number): string | null {
  if (level === 0) {
    for (const id of ["Normal", "BodyText", "Standard"]) if (map.styles.has(id)) return id;
    return null;
  }
  for (const [id, name] of map.styles) {
    if (id.toLowerCase() === `heading${level}`) return id;
    if (name.toLowerCase() === `heading ${level}`) return id;
  }
  return null;
}

/** Replace, add or remove one child of `<w:pPr>`, building the pPr if absent. */
function withParagraphProperty(
  xml: string,
  paragraph: DocxParagraph,
  name: string,
  replacement: string,
): Edit {
  const properties = firstElement(xml, "w:pPr", paragraph.span.openEnd, paragraph.span.innerEnd);
  if (!properties) {
    // `<w:pPr>` must be the first child of `<w:p>` — Word rejects it anywhere
    // else — so it goes immediately after the open tag.
    return {
      start: paragraph.span.openEnd,
      end: paragraph.span.openEnd,
      replacement: `<w:pPr>${replacement}</w:pPr>`,
    };
  }
  const existing = firstElement(xml, name, properties.openEnd, properties.innerEnd);
  if (existing) {
    return { start: existing.start, end: existing.end, replacement };
  }
  // Order inside `<w:pPr>` is schema-defined and `<w:pStyle>` comes first;
  // everything else this file writes is happy at the end.
  const at = name === "w:pStyle" ? properties.openEnd : properties.innerEnd;
  return { start: at, end: at, replacement };
}

/** §5.3 — the run properties `setStyle` writes, merged onto what is there. */
function runPropertiesXml(set: StyleSet, existing: string): string {
  const parts: string[] = [];
  const keep = (name: string): string => {
    const found = new RegExp(`<${name}(?: [^>]*)?/>|<${name}(?: [^>]*)?>.*?</${name}>`).exec(
      existing,
    );
    return found ? found[0] : "";
  };

  if (set.fontFace !== undefined) {
    parts.push(
      `<w:rFonts w:ascii="${escapeXml(set.fontFace)}" w:hAnsi="${escapeXml(set.fontFace)}"/>`,
    );
  } else parts.push(keep("w:rFonts"));

  if (set.bold !== undefined) parts.push(set.bold ? "<w:b/>" : '<w:b w:val="0"/>');
  else parts.push(keep("w:b"));

  if (set.italic !== undefined) parts.push(set.italic ? "<w:i/>" : '<w:i w:val="0"/>');
  else parts.push(keep("w:i"));

  if (set.underline !== undefined) {
    parts.push(set.underline ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>');
  } else parts.push(keep("w:u"));

  if (set.color !== undefined) {
    parts.push(`<w:color w:val="${set.color.replace("#", "").toUpperCase()}"/>`);
  } else parts.push(keep("w:color"));

  if (set.fontSize !== undefined) {
    // Half-points, which is what `w:sz` counts. 14pt is `28`.
    const half = Math.round(set.fontSize * 2);
    parts.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  } else parts.push(keep("w:sz") + keep("w:szCs"));

  return `<w:rPr>${parts.join("")}</w:rPr>`;
}

/** Every `<w:r>` in the paragraph gets the same properties. */
function setStyleEdits(xml: string, paragraph: DocxParagraph, set: StyleSet): Edit[] {
  const edits: Edit[] = [];

  for (const run of scanElements(xml, "w:r", paragraph.span.openEnd, paragraph.span.innerEnd)) {
    const existing = firstElement(xml, "w:rPr", run.openEnd, run.innerEnd);
    const current = existing ? xml.slice(existing.start, existing.end) : "";
    const replacement = runPropertiesXml(set, current);
    if (existing) edits.push({ start: existing.start, end: existing.end, replacement });
    // `<w:rPr>` must be the first child of `<w:r>`.
    else edits.push({ start: run.openEnd, end: run.openEnd, replacement });
  }

  if (set.align !== undefined) {
    const value = set.align === "center" ? "center" : set.align === "right" ? "right" : set.align;
    edits.push(withParagraphProperty(xml, paragraph, "w:jc", `<w:jc w:val="${value}"/>`));
  }
  return edits;
}

/** The row a paragraph sits in, as a span, or a refusal. */
function rowOf(xml: string, paragraph: DocxParagraph, op: OperationKind): ElementSpan {
  if (!paragraph.cell) {
    refuse(`${op} names paragraph ${paragraph.index}, which is not inside a table.`);
  }
  for (const table of scanElements(xml, "w:tbl")) {
    for (const row of scanElements(xml, "w:tr", table.openEnd, table.innerEnd)) {
      if (paragraph.span.start > row.openEnd && paragraph.span.end <= row.innerEnd) return row;
    }
  }
  refuse(`${op} could not find the row paragraph ${paragraph.index} is in.`);
}

/** The text of each cell in a row, for `deleteRow`'s expectation check. */
function rowTexts(xml: string, row: ElementSpan): string[] {
  return scanElements(xml, "w:tc", row.openEnd, row.innerEnd).map((cell) => {
    let text = "";
    for (const t of scanElements(xml, "w:t", cell.openEnd, cell.innerEnd)) {
      text += xml.slice(t.openEnd, t.innerEnd);
    }
    return normalise(text);
  });
}

/**
 * A new row, cloned from the one it follows.
 *
 * Never built from scratch: a `<w:tr>` carries `<w:tcPr>` on every cell with the
 * column widths, and a row without them collapses the table's layout. Cloning
 * and replacing the text is the only version of this that leaves a table
 * looking like itself.
 */
function clonedRow(xml: string, row: ElementSpan, cells: string[]): string {
  const sources = scanElements(xml, "w:tc", row.openEnd, row.innerEnd);
  if (cells.length !== sources.length) {
    refuse(
      `insertRow was given ${cells.length} cells and this table's rows have ${sources.length}.`,
    );
  }

  let clone = xml.slice(row.start, row.end);
  // Right to left, so each splice leaves the offsets of the cells before it
  // untouched — the same reason the whole applier runs back to front. Each
  // cell's whole content is replaced at once: its `<w:tcPr>` (the widths, which
  // are the thing that must survive) and exactly one paragraph.
  for (let index = sources.length - 1; index >= 0; index--) {
    const cell = sources[index];
    const cellProperties = firstElement(xml, "w:tcPr", cell.openEnd, cell.innerEnd);
    const widths = cellProperties ? xml.slice(cellProperties.start, cellProperties.end) : "";

    const paragraphs = scanElements(xml, "w:p", cell.openEnd, cell.innerEnd);
    const first = paragraphs[0];
    const openTag = first ? xml.slice(first.start, first.openEnd) : "<w:p>";
    const paragraphProps = first ? firstElement(xml, "w:pPr", first.openEnd, first.innerEnd) : null;
    const alignment = paragraphProps ? xml.slice(paragraphProps.start, paragraphProps.end) : "";
    const runProps = first ? firstRunProperties(xml, first) : "";

    const rebuilt = `${widths}${openTag}${alignment}<w:r>${runProps}${textElement(cells[index])}</w:r></w:p>`;
    clone =
      clone.slice(0, cell.openEnd - row.start) + rebuilt + clone.slice(cell.innerEnd - row.start);
  }
  return clone;
}

/** Where an insertion goes: after paragraph `after`, or before the first. */
function insertionPoint(map: DocxMap, xml: string, after: number, op: OperationKind): number {
  if (after === 0) {
    const first = map.paragraphs[0];
    if (first) return first.span.start;
    const body = firstElement(xml, "w:body");
    return body ? body.openEnd : 0;
  }
  const paragraph = map.paragraphs[after - 1];
  if (!paragraph) {
    refuse(`${op} goes after paragraph ${after}, and this document has ${map.paragraphs.length}.`);
  }
  return paragraph.span.end;
}

/** A paragraph built to sit beside the one it follows, wearing its formatting. */
function newParagraph(input: {
  xml: string;
  neighbour: DocxParagraph | null;
  text: string;
  styleId: string | null;
}): { xml: string; flags: string[] } {
  const flags: string[] = [];
  let properties = "";
  let runProperties = "";

  if (input.styleId) {
    properties = `<w:pPr><w:pStyle w:val="${escapeXml(input.styleId)}"/></w:pPr>`;
  } else if (input.neighbour) {
    // §2 measured that 8 of 18 documents carry no styles at all: their headings
    // and body text are direct formatting. A paragraph inserted into one of
    // those with no properties of its own looks nothing like its neighbours, so
    // it inherits them instead.
    properties = paragraphProperties(input.xml, input.neighbour.span);
    runProperties = firstRunProperties(input.xml, input.neighbour.span);
    if (properties || runProperties) {
      flags.push("the new paragraph copies the formatting of the one above it");
    }
    // A list item's neighbour brings `<w:numPr>` with it, which would silently
    // make the new paragraph another bullet. That is usually right, and when it
    // is not the reviewer can see it in the preview.
  }

  const run = input.text.length > 0 ? `<w:r>${runProperties}${textElement(input.text)}</w:r>` : "";
  return { xml: `<w:p>${properties}${run}</w:p>`, flags };
}

/** One operation, as splices against the original XML. */
function editsFor(
  xml: string,
  map: DocxMap,
  operation: Operation,
  prepared: ReadonlyMap<Operation, string>,
): { edits: Edit[]; outcome: Outcome } {
  switch (operation.op) {
    case "setText": {
      const paragraph = target(map, operation.at, operation.from, operation.op);
      refuseIfHyperlinkAffected(xml, paragraph, operation.op);
      const { edits, flags } = setTextEdits(xml, paragraph, operation.to);
      return {
        edits,
        outcome: {
          op: operation.op,
          summary: `paragraph ${operation.at}: "${clip(operation.from)}" → "${clip(operation.to)}"`,
          flags,
        },
      };
    }

    case "deleteParagraph": {
      const paragraph = target(map, operation.at, operation.from, operation.op);
      const fragment = xml.slice(paragraph.span.start, paragraph.span.end);
      if (/<w:sectPr/.test(fragment)) {
        refuse(
          `deleteParagraph names paragraph ${operation.at}, which carries a section break. ` +
            "Removing it would change the page setup of everything around it.",
        );
      }
      return {
        edits: [{ start: paragraph.span.start, end: paragraph.span.end, replacement: "" }],
        outcome: {
          op: operation.op,
          summary: `paragraph ${operation.at} removed: "${clip(operation.from)}"`,
          flags: [],
        },
      };
    }

    case "moveParagraph": {
      const paragraph = target(map, operation.at, operation.from, operation.op);
      if (paragraph.cell) {
        refuse("moveParagraph will not move a paragraph out of a table cell.");
      }
      const destination = map.paragraphs[operation.after - 1] ?? null;
      if (operation.after !== 0 && !destination) {
        refuse(`moveParagraph goes after paragraph ${operation.after}, which does not exist.`);
      }
      if (destination?.cell) {
        refuse("moveParagraph will not move a paragraph into a table cell.");
      }
      const at = insertionPoint(map, xml, operation.after, operation.op);
      if (at > paragraph.span.start && at < paragraph.span.end) {
        refuse("moveParagraph was asked to move a paragraph inside itself.");
      }
      const moved = xml.slice(paragraph.span.start, paragraph.span.end);
      return {
        edits: [
          { start: paragraph.span.start, end: paragraph.span.end, replacement: "" },
          { start: at, end: at, replacement: moved },
        ],
        outcome: {
          op: operation.op,
          summary: `paragraph ${operation.at} moved after ${operation.after}: "${clip(operation.from)}"`,
          flags: [],
        },
      };
    }

    case "insertParagraph": {
      if (operation.style && !map.styles.has(operation.style)) {
        refuse(
          `insertParagraph names the style "${operation.style}", which this document does not define. ` +
            "REX will not invent a style definition.",
        );
      }
      const at = insertionPoint(map, xml, operation.after, operation.op);
      const neighbour = map.paragraphs[operation.after - 1] ?? null;
      const built = newParagraph({
        xml,
        neighbour,
        text: operation.text,
        styleId: operation.style ?? null,
      });
      return {
        edits: [{ start: at, end: at, replacement: built.xml }],
        outcome: {
          op: operation.op,
          summary: `after paragraph ${operation.after}: "${clip(operation.text)}"`,
          flags: built.flags,
        },
      };
    }

    case "setStyle": {
      const paragraph = target(map, operation.at, null, operation.op);
      const named = Object.entries(operation.set)
        .map(([key, value]) => `${key} ${String(value)}`)
        .join(", ");
      return {
        edits: setStyleEdits(xml, paragraph, operation.set),
        outcome: {
          op: operation.op,
          summary: `paragraph ${operation.at}: ${named}`,
          flags: [],
        },
      };
    }

    case "setHeadingLevel": {
      const paragraph = target(map, operation.at, operation.from, operation.op);
      const styleId = headingStyleId(map, operation.level);
      if (!styleId) {
        refuse(
          operation.level === 0
            ? "setHeadingLevel cannot make this body text: the document defines no body style to return it to."
            : `setHeadingLevel asks for level ${operation.level}, and this document defines no such heading style. ` +
                "Its headings are direct formatting, so use setStyle instead.",
        );
      }
      // Word puts its whole latent style set in `styles.xml`, so `Heading2` is
      // usually *defined* even in a document that never uses it — §2 measured
      // 8 of 18 documents whose headings are direct formatting instead. The
      // operation still works there, and the result will not match the
      // document's own headings, so the reviewer is told before they approve.
      const usesHeadings = map.paragraphs.some((other) => /^heading\d$/i.test(other.styleId ?? ""));
      const flags = usesHeadings
        ? []
        : [
            "this document's headings are direct formatting, not styles, so the " +
              `paragraph will take the template's ${styleId} and will not match them`,
          ];

      return {
        edits: [
          withParagraphProperty(
            xml,
            paragraph,
            "w:pStyle",
            `<w:pStyle w:val="${escapeXml(styleId)}"/>`,
          ),
        ],
        outcome: {
          op: operation.op,
          summary: `paragraph ${operation.at} is now ${styleId}`,
          flags,
        },
      };
    }

    case "setListLevel": {
      const paragraph = target(map, operation.at, operation.from, operation.op);
      if (paragraph.listLevel === null) {
        refuse(
          `setListLevel names paragraph ${operation.at}, which is not a list item. ` +
            "Making one needs a numbering definition this document may not have, so REX will not.",
        );
      }
      const properties = firstElement(
        xml,
        "w:pPr",
        paragraph.span.openEnd,
        paragraph.span.innerEnd,
      );
      const numbering = properties
        ? firstElement(xml, "w:numPr", properties.openEnd, properties.innerEnd)
        : null;
      const level = numbering
        ? firstElement(xml, "w:ilvl", numbering.openEnd, numbering.innerEnd)
        : null;
      if (!level)
        refuse(`setListLevel could not find the list level of paragraph ${operation.at}.`);
      return {
        edits: [
          {
            start: level.start,
            end: level.end,
            replacement: `<w:ilvl w:val="${operation.level - 1}"/>`,
          },
        ],
        outcome: {
          op: operation.op,
          summary: `paragraph ${operation.at} is now at list level ${operation.level}`,
          flags: [],
        },
      };
    }

    case "insertRow": {
      const paragraph = target(map, operation.at, null, operation.op);
      const row = rowOf(xml, paragraph, operation.op);
      return {
        edits: [
          { start: row.end, end: row.end, replacement: clonedRow(xml, row, operation.cells) },
        ],
        outcome: {
          op: operation.op,
          summary: `a row after the one holding paragraph ${operation.at}: ${operation.cells.map(clip).join(" | ")}`,
          flags: [],
        },
      };
    }

    case "deleteRow": {
      const paragraph = target(map, operation.at, null, operation.op);
      const row = rowOf(xml, paragraph, operation.op);
      const present = rowTexts(xml, row);
      const expected = operation.from.map(normalise);
      if (present.length !== expected.length || present.some((cell, i) => cell !== expected[i])) {
        refuse(
          `deleteRow expected the row to hold [${expected.map(clip).join(" | ")}] ` +
            `and it holds [${present.map(clip).join(" | ")}]. Nothing was written.`,
        );
      }
      // A table with no rows is a table Word offers to repair, so the last one
      // is never removed. Counted in **this** table, not across the document.
      const table = scanElements(xml, "w:tbl").find(
        (candidate) => row.start > candidate.openEnd && row.end <= candidate.innerEnd,
      );
      const siblings = table ? scanElements(xml, "w:tr", table.openEnd, table.innerEnd).length : 1;
      if (siblings <= 1) {
        refuse(
          "deleteRow would leave the table with no rows, which Word cannot open. " +
            "Delete the table itself, or empty the row instead.",
        );
      }
      return {
        edits: [{ start: row.start, end: row.end, replacement: "" }],
        outcome: {
          op: operation.op,
          summary: `the row holding paragraph ${operation.at} removed`,
          flags: [],
        },
      };
    }

    case "insertImage": {
      // §5.4 — the three package places were written before this pass ran, and
      // `prepared` holds the paragraph they produced. Doing it here would mean
      // an async dispatch, and every offset in this function is computed
      // against one unchanging string.
      const paragraph = prepared.get(operation);
      if (!paragraph) refuse("insertImage was not prepared before the edit pass.");
      const at = insertionPoint(map, xml, operation.after, operation.op);
      return {
        edits: [{ start: at, end: at, replacement: paragraph }],
        outcome: {
          op: operation.op,
          summary: `a picture after paragraph ${operation.after}: ${describeSource(operation.source)}`,
          flags: [],
        },
      };
    }
  }
}

/** Two operations that overlap cannot both be true of the state they named. */
function refuseOverlaps(edits: readonly Edit[]): void {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    // An insertion at a boundary (start === end) is not an overlap; two
    // replacements sharing a byte are.
    if (current.start < previous.end) {
      refuse(
        "Two of this plan's operations change the same part of the document. " +
          "Nothing was written — make it one operation, or use two Applies.",
      );
    }
  }
}

/**
 * §5.1 — perform the whole plan on the package, or none of it.
 *
 * The package is modified in place and its bytes returned; the caller throws it
 * away whole if any later check fails. Nothing here writes to disk.
 */
export async function applyPlanToPackage(
  pkg: OoxmlPackage,
  plan: EditPlan,
  resolver?: MediaResolver,
): Promise<EditResult> {
  const map = await readDocxMap(pkg);
  const xml = await pkg.readText(DOCUMENT_PART);

  // §5.4 — the picture pass, first and separately. It is the only operation
  // that touches parts other than `word/document.xml`, and it has to resolve
  // bytes over the network or through the renderer, so it cannot happen inside
  // the offset arithmetic below.
  const prepared = new Map<Operation, string>();
  let nextId = nextDrawingId(xml);
  for (const operation of plan.operations) {
    if (operation.op !== "insertImage") continue;
    if (!resolver) {
      refuse("A picture can only be inserted while REX's window is open, so it can draw one.");
    }
    const media = await resolveSource(operation.source, "image", resolver);
    const pixels = imageSize(media.bytes);
    if (!pixels) {
      refuse("REX could not read the size of that picture, so it will not insert it.");
    }
    const relationshipId = await embedImage(pkg, media.bytes, media);
    prepared.set(
      operation,
      inlinePictureXml({
        id: nextId,
        name: `Picture ${nextId}`,
        alt: operation.alt,
        relationshipId,
        ...fitToColumn(pixels, textWidthEmu(xml)),
      }),
    );
    nextId += 1;
  }

  const outcomes: Outcome[] = [];
  const edits: Edit[] = [];
  for (const operation of plan.operations) {
    const result = editsFor(xml, map, operation, prepared);
    outcomes.push(result.outcome);
    edits.push(...result.edits);
  }
  refuseOverlaps(edits);

  // Back to front, so every offset an operation computed stays valid.
  let next = xml;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    next = splice(next, edit.start, edit.end, edit.replacement);
  }

  pkg.write(DOCUMENT_PART, next);
  return { outcomes, bytes: await pkg.toBuffer() };
}
