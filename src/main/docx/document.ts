// Spec 19 §4.1 — a Word file as a numbered list of paragraphs.
//
// The unit is the paragraph, not the box. `word/document.xml` is one flat
// stream of `<w:p>`, each holding `<w:r>` runs, each holding a `<w:t>`, and
// everything this feature does — address, edit, validate — is expressed against
// that list. There is no geometry to model and no z-order to respect, which is
// what makes ten operations enough where a deck needed twelve.
//
// Read with the same string scanners a deck uses (`ooxml/xml.ts`), and for the
// same reason (spec 11 §7.3): a DOM round-trip rewrites attribute order,
// namespace declarations and entity choices across the whole part, and §5.6 can
// only claim "nothing it did not name changed" when the bytes it did not name
// are the bytes that were there.

import type { OoxmlPackage } from "../ooxml/package.ts";
import {
  attributeOf,
  type ElementSpan,
  firstElement,
  scanElements,
  unescapeXml,
} from "../ooxml/xml.ts";

export const DOCUMENT_PART = "word/document.xml";
const STYLES_PART = "word/styles.xml";

/** Spec 19 §4.3 — where a paragraph sits when it is inside a table. */
export interface CellRef {
  /** 1-based, in document order. */
  table: number;
  row: number;
  column: number;
}

export interface DocxParagraph {
  /** §4.3 rule 1 — its position in the body, counting from 1. The plan's `at`. */
  index: number;
  /** Every `<w:t>` in it, concatenated. Not collapsed — see `normalise`. */
  text: string;
  /** The `<w:pStyle>` id, or null when the paragraph uses the default style. */
  styleId: string | null;
  /** That style's display name from `styles.xml`, falling back to the id. */
  styleName: string | null;
  /** `<w:numPr><w:ilvl>`, or null when this is not a list item. */
  listLevel: number | null;
  /** §5.5 — why no operation may touch this paragraph, or null. */
  locked: string | null;
  /** Its place in `word/document.xml`. Offsets, not a parsed node. */
  span: ElementSpan;
  cell: CellRef | null;
}

export interface DocxMap {
  /** In document order, table paragraphs included, numbered from 1. */
  paragraphs: DocxParagraph[];
  /** styleId → display name, for the whole document. */
  styles: Map<string, string>;
}

/**
 * The form two pieces of text are compared in.
 *
 * A plan's `from` is written by an agent reading the sidecar, and the sidecar
 * collapses whitespace because `document.xml` is full of newlines and indent
 * that carry no meaning. So the comparison collapses too — otherwise every
 * operation would be refused for a difference nobody can see.
 */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The body, which is what gets numbered.
 *
 * `<w:sectPr>` at the end of the body is page setup, not content, and it holds
 * no paragraphs — so the range is the whole body and the scanners simply find
 * nothing in it.
 */
function bodyRange(xml: string): { start: number; end: number } {
  const body = firstElement(xml, "w:body");
  if (!body) return { start: 0, end: xml.length };
  return { start: body.openEnd, end: body.innerEnd };
}

/**
 * The text of one paragraph.
 *
 * `<w:delText>` is deliberately not included: it is text a tracked deletion has
 * already removed, so it is not what the paragraph says. Nothing on this
 * machine carries any (§2.4), and the day something does, this is the reading
 * that stays correct.
 */
export function paragraphText(xml: string, span: ElementSpan): string {
  // A tab and a line break separate words on the page and are elements of their
  // own, not characters inside a `<w:t>`. Reading only the `<w:t>` values runs
  // the words either side of one together — `Week1Topic` for a tabbed line —
  // and the agent then quotes that back in `from`, which never matches. So they
  // are collected in document order alongside the text, and each becomes the
  // single space `normalise` would have made of them anyway.
  const pieces: { at: number; value: string }[] = [];
  for (const t of scanElements(xml, "w:t", span.openEnd, span.innerEnd)) {
    pieces.push({ at: t.start, value: unescapeXml(xml.slice(t.openEnd, t.innerEnd)) });
  }
  for (const name of ["w:tab", "w:br"]) {
    for (const element of scanElements(xml, name, span.openEnd, span.innerEnd)) {
      pieces.push({ at: element.start, value: " " });
    }
  }
  return pieces
    .sort((a, b) => a.at - b.at)
    .map((piece) => piece.value)
    .join("");
}

/**
 * §5.5 — the four things that make a paragraph un-editable, and why.
 *
 * Each one is structure that the run-merge rule (§5.2) would drop or detach,
 * and each is rare: §2.4 measured at most 2 files in 18 carrying any of them.
 * Refusing is therefore nearly free, and getting one wrong is not.
 */
function lockReason(fragment: string): string | null {
  if (/<w:fldChar|<w:instrText/.test(fragment)) {
    return "it holds a field, whose visible text is a cached result Word rewrites";
  }
  if (/<w:sdt[\s>]/.test(fragment)) {
    return "it is inside a content control, which the document's template owns";
  }
  if (/<w:footnoteReference|<w:endnoteReference/.test(fragment)) {
    return "it carries a footnote reference, which is a pointer into another part";
  }
  // Word's own hidden bookmarks — `_GoBack`, `_Toc…` — are cursor memory and
  // generated table-of-contents targets. Locking on those would lock every
  // heading in any document with a contents page, which is most of them. A
  // bookmark somebody named is a cross-reference target and is locked.
  const named = [...fragment.matchAll(/<w:bookmarkStart[^>]*w:name="([^"]*)"/g)].map(
    (match) => match[1],
  );
  if (named.some((name) => !name.startsWith("_"))) {
    return "a named bookmark starts in it, and a cross-reference elsewhere points at that name";
  }
  return null;
}

/** styleId → the name Word shows for it. */
function readStyles(xml: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const style of scanElements(xml, "w:style")) {
    const id = attributeOf(xml, style, "w:styleId");
    if (!id) continue;
    const name = firstElement(xml, "w:name", style.openEnd, style.innerEnd);
    const shown = name ? attributeOf(xml, name, "w:val") : null;
    styles.set(id, shown ?? id);
  }
  return styles;
}

/** Which cell, if any, each paragraph offset falls inside. */
function cellIndex(xml: string, from: number, to: number): { at: number; cell: CellRef }[] {
  const cells: { at: number; cell: CellRef }[] = [];
  scanElements(xml, "w:tbl", from, to).forEach((table, tableIndex) => {
    scanElements(xml, "w:tr", table.openEnd, table.innerEnd).forEach((row, rowIndex) => {
      scanElements(xml, "w:tc", row.openEnd, row.innerEnd).forEach((cell, columnIndex) => {
        for (const paragraph of scanElements(xml, "w:p", cell.openEnd, cell.innerEnd)) {
          cells.push({
            at: paragraph.start,
            cell: { table: tableIndex + 1, row: rowIndex + 1, column: columnIndex + 1 },
          });
        }
      });
    });
  });
  return cells;
}

/** The paragraph list for one `word/document.xml`. */
export function mapDocument(xml: string, styles: Map<string, string>): DocxParagraph[] {
  const { start, end } = bodyRange(xml);
  const cells = new Map(cellIndex(xml, start, end).map((entry) => [entry.at, entry.cell]));

  return scanElements(xml, "w:p", start, end).map((span, position) => {
    const fragment = xml.slice(span.start, span.end);
    const properties = firstElement(xml, "w:pPr", span.openEnd, span.innerEnd);
    const styleElement = properties
      ? firstElement(xml, "w:pStyle", properties.openEnd, properties.innerEnd)
      : null;
    const styleId = styleElement ? attributeOf(xml, styleElement, "w:val") : null;

    const numbering = properties
      ? firstElement(xml, "w:numPr", properties.openEnd, properties.innerEnd)
      : null;
    const level = numbering
      ? firstElement(xml, "w:ilvl", numbering.openEnd, numbering.innerEnd)
      : null;
    const listLevel = level ? Number(attributeOf(xml, level, "w:val") ?? "0") : null;

    return {
      index: position + 1,
      text: paragraphText(xml, span),
      styleId,
      styleName: styleId ? (styles.get(styleId) ?? styleId) : null,
      listLevel: listLevel !== null && Number.isFinite(listLevel) ? listLevel : null,
      locked: lockReason(fragment),
      span,
      cell: cells.get(span.start) ?? null,
    };
  });
}

/** The map for a whole package. Read once per run and re-read after surgery. */
export async function readDocxMap(pkg: OoxmlPackage): Promise<DocxMap> {
  if (!pkg.has(DOCUMENT_PART)) {
    throw new Error("This file has no word/document.xml, so it is not a Word document.");
  }
  const styles = pkg.has(STYLES_PART) ? readStyles(await pkg.readText(STYLES_PART)) : new Map();
  return { paragraphs: mapDocument(await pkg.readText(DOCUMENT_PART), styles), styles };
}

/**
 * §4.4 — the paragraph a plan's `at` names, when its text also matches.
 *
 * Both, always. §2.2 measured that 97.7% of paragraphs of 25 characters or more
 * are unique by text alone, so the text is nearly enough on its own — and the
 * 2.3% that are not are the short ones (`"12"`, `"Assessment"`) an agent is most
 * likely to mis-target. The position disambiguates those; the text catches a
 * position that has drifted.
 */
export function paragraphAt(map: DocxMap, index: number): DocxParagraph | null {
  return map.paragraphs[index - 1] ?? null;
}
