// Spec 19 §7 — the speaker notes on a slide, read and changed.
//
// Spec 11 shipped twelve operations and could not touch a note. §2.5 measured
// what that costs on this machine: **33 of 72 decks carry notes, 642 notes
// slides in all**, the agent already reads them in the sidecar (spec 11 §6.2)
// and the reviewer can already comment on one. This is the operation that
// closes the loop.
//
// The notes for slide N live in their own part, related from the slide, and
// hold an ordinary shape tree whose body placeholder carries the text. So the
// surgery is spec 11 §7.3's `replaceText` against a different part, and the
// only new work is §7.1 rule 2: a slide with no notes part gets one, in all
// four of the places a new part has to appear.

import type { OoxmlPackage } from "../ooxml/package.ts";
import { escapeXml, firstElement, scanElements, splice } from "../ooxml/xml.ts";
import { parseRelationships, relsPathFor, resolveTarget } from "./deck.ts";
import { replaceText, textPieces } from "./text.ts";

const CONTENT_TYPES = "[Content_Types].xml";
const NOTES_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const NOTES_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const NOTES_MASTER_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";

/** The notes part for one slide, or null when the slide has none. */
export async function notesPartFor(pkg: OoxmlPackage, slidePart: string): Promise<string | null> {
  const relsPath = relsPathFor(slidePart);
  if (!pkg.has(relsPath)) return null;
  const rel = parseRelationships(await pkg.readText(relsPath)).find(
    (candidate) => candidate.type === NOTES_REL_TYPE && !candidate.external,
  );
  if (!rel) return null;
  const target = resolveTarget(slidePart, rel.target);
  return pkg.has(target) ? target : null;
}

/**
 * The body placeholder of a notes slide — the shape the note is actually in.
 *
 * A notes slide carries two placeholders: a thumbnail of the slide itself, and
 * the body. Writing into the wrong one puts the reviewer's note inside a
 * picture frame, which PowerPoint renders as nothing at all.
 */
function bodyOf(xml: string): ReturnType<typeof firstElement> {
  for (const shape of scanElements(xml, "p:sp")) {
    const placeholder = firstElement(xml, "p:ph", shape.openEnd, shape.innerEnd);
    const type = placeholder
      ? /type="([^"]*)"/.exec(xml.slice(placeholder.start, placeholder.openEnd))?.[1]
      : null;
    if (type !== "body") continue;
    return firstElement(xml, "p:txBody", shape.openEnd, shape.innerEnd);
  }
  // A notes slide someone built by hand may have no placeholder type at all.
  // Its first text body is then the only candidate, and using it is better than
  // refusing a note the reviewer can plainly see.
  return firstElement(xml, "p:txBody");
}

/** What the notes for this slide say now. Empty when the slide has none. */
export async function readNotes(pkg: OoxmlPackage, slidePart: string): Promise<string> {
  const part = await notesPartFor(pkg, slidePart);
  if (!part) return "";
  const xml = await pkg.readText(part);
  const body = bodyOf(xml);
  return body ? textPieces(xml, body).text : "";
}

/** A minimal, valid notes slide carrying one paragraph of text. */
function newNotesXml(text: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    "<p:cSld><p:spTree>" +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    "<p:sp>" +
    '<p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/>' +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    "<p:spPr/>" +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody>` +
    "</p:sp>" +
    "</p:spTree></p:cSld></p:notes>"
  );
}

/** A part path nothing in the package uses yet. */
function freeNotesPart(pkg: OoxmlPackage): string {
  const taken = new Set(pkg.paths());
  for (let n = 1; ; n++) {
    const candidate = `ppt/notesSlides/notesSlide${n}.xml`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** An `Id` nothing in this rels part uses yet. */
function freeRelId(xml: string): string {
  const taken = new Set(parseRelationships(xml).map((rel) => rel.id));
  for (let n = 1; ; n++) {
    const candidate = `rId${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const EMPTY_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

/** Adds one `<Relationship>` to a rels part, creating the part if it is absent. */
async function addRelationship(
  pkg: OoxmlPackage,
  relsPath: string,
  type: string,
  target: string,
): Promise<string> {
  const xml = pkg.has(relsPath) ? await pkg.readText(relsPath) : EMPTY_RELS;
  const id = freeRelId(xml);
  const root = firstElement(xml, "Relationships");
  if (!root) throw new Error(`${relsPath} is not a relationships part.`);
  pkg.write(
    relsPath,
    splice(
      xml,
      root.innerEnd,
      root.innerEnd,
      `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`,
    ),
  );
  return id;
}

/** Declares a part's content type, which is the piece whose absence looks like corruption. */
async function addContentType(pkg: OoxmlPackage, partPath: string, type: string): Promise<void> {
  const xml = await pkg.readText(CONTENT_TYPES);
  if (xml.includes(`PartName="/${partPath}"`)) return;
  const root = firstElement(xml, "Types");
  if (!root) throw new Error("This deck has no [Content_Types].xml root.");
  pkg.write(
    CONTENT_TYPES,
    splice(
      xml,
      root.innerEnd,
      root.innerEnd,
      `<Override PartName="/${partPath}" ContentType="${type}"/>`,
    ),
  );
}

/**
 * §7.1 rule 2 — a slide with no notes part gets one.
 *
 * Four places, or none: the bytes, the slide's relationship to them, the
 * content-type override, and — the one that is easy to miss — the new notes
 * slide's own relationship to the deck's notes master, when the deck has one.
 * A missing content-type override is exactly what makes PowerPoint offer to
 * repair a file rather than open it.
 */
async function createNotes(pkg: OoxmlPackage, slidePart: string, text: string): Promise<string> {
  const part = freeNotesPart(pkg);
  pkg.write(part, newNotesXml(text));
  await addContentType(pkg, part, NOTES_CONTENT_TYPE);

  // A relationship target is relative to the owning part's directory, and the
  // owner is `ppt/slides/slideN.xml`. So `ppt/notesSlides/notesSlideM.xml` is
  // reached as `../notesSlides/notesSlideM.xml`.
  const target = `../${part.slice("ppt/".length)}`;
  await addRelationship(pkg, relsPathFor(slidePart), NOTES_REL_TYPE, target);

  // The notes master, when this deck has one. Without the relationship the
  // notes slide inherits nothing and PowerPoint still opens it, so this is
  // best-effort rather than a refusal.
  const presentationRels = "ppt/_rels/presentation.xml.rels";
  if (pkg.has(presentationRels)) {
    const master = parseRelationships(await pkg.readText(presentationRels)).find(
      (rel) => rel.type === NOTES_MASTER_REL_TYPE,
    );
    if (master) {
      await addRelationship(
        pkg,
        relsPathFor(part),
        NOTES_MASTER_REL_TYPE,
        `../${master.target.replace(/^\.\.\//, "")}`,
      );
    }
  }
  return part;
}

export interface NotesOutcome {
  /** Costs the reviewer must be told about, exactly as `setText` reports them. */
  flags: string[];
  /** True when this slide had no notes part before. */
  created: boolean;
}

/**
 * §7.1 — change the notes on one slide.
 *
 * `from` is required and may be empty, which means "this slide has no notes
 * now". That is the same expectation rule every other operation carries
 * (spec 11 §7.2.2 rule 1): an operation that names what it expects to find
 * cannot silently act on something else.
 */
export async function setNotes(
  pkg: OoxmlPackage,
  slidePart: string,
  from: string,
  to: string,
): Promise<NotesOutcome> {
  const existing = await notesPartFor(pkg, slidePart);
  const present = existing ? await readNotes(pkg, slidePart) : "";

  if (present.replace(/\s+/g, " ").trim() !== from.replace(/\s+/g, " ").trim()) {
    throw new Error(
      present.length === 0
        ? "This slide has no speaker notes, and the plan expected it to say something. Nothing was written."
        : `The notes on this slide say '${present.slice(0, 60)}', not '${from.slice(0, 60)}'. Nothing was written.`,
    );
  }

  if (!existing) {
    await createNotes(pkg, slidePart, to);
    return { flags: [], created: true };
  }

  const xml = await pkg.readText(existing);
  const body = bodyOf(xml);
  if (!body) throw new Error("This slide's notes part holds no text body to write into.");

  // A notes part that exists but says nothing has no text to replace, so the
  // first note is written as a new paragraph rather than through the run-merge
  // rule. `replaceText` would refuse an empty `from`, correctly — it is built
  // to refuse a match it cannot find.
  if (present.length === 0) {
    pkg.write(
      existing,
      splice(xml, body.openEnd, body.innerEnd, `<a:p><a:r><a:t>${escapeXml(to)}</a:t></a:r></a:p>`),
    );
    return { flags: [], created: false };
  }

  const result = replaceText(xml, body, from, to);
  pkg.write(existing, result.xml);

  const flags: string[] = [];
  if (result.runsMerged) {
    flags.push("Formatting inside the replaced note was flattened to the first run's.");
  }
  return { flags, created: false };
}
