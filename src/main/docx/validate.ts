// Spec 19 §5.6 — the edited copy is re-opened and compared to what the plan
// said it would do.
//
// The shape is spec 11 §7.8's, and so is the honest guarantee: REX cannot
// promise a Word file is valid, because plenty of real ones are not. It can
// prove it **broke nothing that was working** and **changed nothing it did not
// name** — and every check below has those two halves.
//
// A surgical edit that quietly altered a paragraph nobody asked about would
// pass every structural check and look completely fine in the preview, because
// the preview only shows the paragraphs the plan named. I1–I3 are what catch it.

import type { OoxmlPackage } from "../ooxml/package.ts";
import { scanElements } from "../ooxml/xml.ts";
import { DOCUMENT_PART, type DocxMap, normalise, readDocxMap } from "./document.ts";
import type { EditPlan } from "./plan.ts";

export interface Problem {
  message: string;
}

const CONTENT_TYPES = "[Content_Types].xml";
const RELS = "word/_rels/document.xml.rels";

/**
 * S5 — the parts no operation in §4.5 may touch, ever.
 *
 * §2.4 measured what is at stake: 6 of 18 documents carry Word comments and 9
 * carry headers. None of them is what a review comment is about, and all of
 * them are easy to damage from a distance — so instead of being careful, they
 * are compared.
 */
function isUntouchable(path: string): boolean {
  return (
    path === "word/comments.xml" ||
    path === "word/commentsExtended.xml" ||
    path === "word/footnotes.xml" ||
    path === "word/endnotes.xml" ||
    path === "word/numbering.xml" ||
    /^word\/(header|footer)\d*\.xml$/.test(path)
  );
}

/** Every element of this name that is opened is closed, and none is orphaned. */
function balanced(xml: string, name: string): boolean {
  const opens = (xml.match(new RegExp(`<${name}(?:[ >])`, "g")) ?? []).length;
  const selfClosing = (xml.match(new RegExp(`<${name}(?:\\s[^>]*)?/>`, "g")) ?? []).length;
  const closes = (xml.match(new RegExp(`</${name}>`, "g")) ?? []).length;
  return opens - selfClosing === closes;
}

/**
 * S1–S5 — the problems the edit **introduced**, and only those.
 *
 * Both packages are needed: a document that was already missing a content type
 * is not this run's fault, and reporting it would teach the reviewer to ignore
 * the report.
 */
export async function newProblems(before: OoxmlPackage, after: OoxmlPackage): Promise<Problem[]> {
  const problems: Problem[] = [];
  const xml = await after.readText(DOCUMENT_PART);

  // S1 — it parses, in the only sense this file's surgery can break.
  for (const element of ["w:p", "w:r", "w:t", "w:tbl", "w:tr", "w:tc", "w:pPr", "w:rPr"]) {
    if (!balanced(xml, element)) {
      problems.push({ message: `<${element}> elements are no longer balanced in the document.` });
    }
  }

  // S2 — every relationship the document points at still exists. A dangling
  // `r:id` is what makes Word offer to repair a file rather than open it.
  if (after.has(RELS)) {
    const rels = await after.readText(RELS);
    const declared = new Set([...rels.matchAll(/\sId="([^"]+)"/g)].map((match) => match[1]));
    const referenced = new Set(
      [...xml.matchAll(/r:(?:id|embed|link)="([^"]+)"/g)].map((match) => match[1]),
    );
    for (const id of referenced) {
      if (!declared.has(id)) {
        problems.push({
          message: `The document points at relationship ${id}, which is not declared.`,
        });
      }
    }
  }

  // S3 — every part has a content type, by extension or by override.
  if (after.has(CONTENT_TYPES)) {
    const types = await after.readText(CONTENT_TYPES);
    const defaults = new Set(
      [...types.matchAll(/<Default[^>]*Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()),
    );
    const overrides = new Set(
      [...types.matchAll(/<Override[^>]*PartName="\/([^"]+)"/g)].map((m) => m[1]),
    );
    for (const path of after.paths()) {
      if (path === CONTENT_TYPES) continue;
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      if (!defaults.has(extension) && !overrides.has(path)) {
        problems.push({ message: `The part ${path} has no content type, so Word cannot open it.` });
      }
    }
  }

  // S4 — no part was lost. §2.3's measurement is the baseline.
  const had = new Set(before.paths());
  const has = new Set(after.paths());
  for (const path of had) {
    if (!has.has(path)) problems.push({ message: `The part ${path} was lost.` });
  }

  // S5 — and the parts nothing may touch are the bytes that were there.
  for (const path of had) {
    if (!isUntouchable(path) || !has.has(path)) continue;
    const original = await before.read(path);
    const now = await after.read(path);
    if (!original.equals(now)) {
      problems.push({ message: `${path} was changed, and no operation is allowed to change it.` });
    }
  }

  return problems;
}

/** What the plan says each paragraph's text should become. */
interface Expectation {
  /** Texts the document should no longer hold, one entry per occurrence. */
  removed: string[];
  /** Texts it should now hold that it did not. */
  added: string[];
  /** How much the paragraph count should have moved. */
  countDelta: number;
}

function expectationOf(plan: EditPlan): Expectation {
  const removed: string[] = [];
  const added: string[] = [];
  let countDelta = 0;

  for (const operation of plan.operations) {
    switch (operation.op) {
      case "setText":
        removed.push(normalise(operation.from));
        added.push(normalise(operation.to));
        break;
      case "insertParagraph":
        added.push(normalise(operation.text));
        countDelta += 1;
        break;
      case "deleteParagraph":
        removed.push(normalise(operation.from));
        countDelta -= 1;
        break;
      case "insertRow":
        // One paragraph per cell, so the count moves by the number of cells.
        for (const cell of operation.cells) added.push(normalise(cell));
        countDelta += operation.cells.length;
        break;
      case "deleteRow":
        for (const cell of operation.from) removed.push(normalise(cell));
        countDelta -= operation.from.length;
        break;
      case "insertImage":
        added.push("");
        countDelta += 1;
        break;
      // `moveParagraph`, `setStyle`, `setHeadingLevel` and `setListLevel` change
      // where a paragraph is or how it looks, never what it says. Their texts
      // must appear on both sides of the comparison, which is what an empty
      // entry here means.
      default:
        break;
    }
  }

  // A paragraph the plan emptied leaves an empty string behind rather than
  // disappearing, and an insertion of empty text adds one. Both are real
  // paragraphs and both are counted; nothing is filtered out here.
  return { removed, added, countDelta };
}

function tally(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  return counts;
}

/**
 * I1–I3 — the edited copy holds what the plan said, and nothing else moved.
 *
 * Compared by **text, counted**, not by position: an insertion shifts every
 * paragraph below it, so a position-keyed comparison would report the whole
 * back half of the document as changed and the check would have to be switched
 * off to be usable. A multiset says the true thing — these texts left, those
 * arrived, everything else is exactly as many as it was.
 */
export function intentProblems(before: DocxMap, after: DocxMap, plan: EditPlan): Problem[] {
  const problems: Problem[] = [];
  const expected = expectationOf(plan);

  // I3 — the count moved by exactly what the plan accounts for.
  const actualDelta = after.paragraphs.length - before.paragraphs.length;
  if (actualDelta !== expected.countDelta) {
    problems.push({
      message:
        `The document went from ${before.paragraphs.length} paragraphs to ${after.paragraphs.length}, ` +
        `and the plan accounts for ${expected.countDelta >= 0 ? "+" : ""}${expected.countDelta}.`,
    });
  }

  const wanted = tally(before.paragraphs.map((paragraph) => normalise(paragraph.text)));
  for (const text of expected.removed) {
    const count = wanted.get(text) ?? 0;
    if (count === 0) {
      problems.push({ message: `The plan expected to remove "${text}", which was not there.` });
      continue;
    }
    wanted.set(text, count - 1);
  }
  for (const text of expected.added) wanted.set(text, (wanted.get(text) ?? 0) + 1);

  const found = tally(after.paragraphs.map((paragraph) => normalise(paragraph.text)));

  // I1 and I2 in one pass: every text is present exactly as often as it should
  // be. A paragraph the plan named that did not change fails here, and so does
  // one it never mentioned that did.
  for (const [text, count] of wanted) {
    const now = found.get(text) ?? 0;
    if (now !== count) {
      problems.push({
        message: `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}" appears ${now} times and should appear ${count}.`,
      });
    }
  }
  for (const [text, count] of found) {
    if (!wanted.has(text)) {
      problems.push({
        message: `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}" appears ${count} times and the plan never asked for it.`,
      });
    }
  }

  return problems;
}

/** Both halves, run against the two packages. The caller discards on any. */
export async function checkEdit(
  before: OoxmlPackage,
  after: OoxmlPackage,
  plan: EditPlan,
): Promise<Problem[]> {
  const structural = await newProblems(before, after);
  if (structural.length > 0) return structural;
  return intentProblems(await readDocxMap(before), await readDocxMap(after), plan);
}

/** Which table rows an edited document has, for a test that wants to count. */
export async function rowCount(pkg: OoxmlPackage): Promise<number> {
  const xml = await pkg.readText(DOCUMENT_PART);
  return scanElements(xml, "w:tbl").reduce(
    (total, table) => total + scanElements(xml, "w:tr", table.openEnd, table.innerEnd).length,
    0,
  );
}
