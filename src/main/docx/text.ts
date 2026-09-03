// Spec 19 §4.3 — the Markdown the agent reads instead of the `.docx`.
//
// A zip defeats `Read`, so without this the agent answers from the reviewer's
// comment alone while appearing to have read the document — the invisible
// failure spec 11 §6.1 named for a deck, in the format a reviewer is most
// likely to hand over.
//
// **Built from `word/document.xml`, never from mammoth's HTML.** mammoth drops
// empty paragraphs and merges consecutive ones under some style maps, and it
// has no positional map back to the XML. A sidecar built from it would number
// paragraphs differently from the surgery, and an off-by-one in a plan is an
// edit landing on the wrong sentence.
//
// A read artifact and never an edit target: it is regenerated from the file, it
// lives outside every repository, and nothing REX does writes from it back.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { openPackage } from "../ooxml/package.ts";
import { type DocxMap, type DocxParagraph, normalise, readDocxMap } from "./document.ts";

/** Everything REX caches for one Word file, keyed by its content hash. */
export function docxCacheDir(contentHash: string): string {
  const root = process.env.REX_CACHE_PATH ?? join(homedir(), ".rex", "cache");
  return join(root, "docx", contentHash);
}

export function sidecarPathFor(documentName: string, contentHash: string): string {
  return join(docxCacheDir(contentHash), `${documentName}.md`);
}

export function contentHashOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** How one paragraph is written into the sidecar. */
function line(paragraph: DocxParagraph): string {
  const key = paragraph.cell
    ? `[${paragraph.index}] [T${paragraph.cell.table}r${paragraph.cell.row}c${paragraph.cell.column}]`
    : `[${paragraph.index}]`;

  // The braces carry what the plan is allowed to say about this paragraph: the
  // style name it can name in `setHeadingLevel`, the level `setListLevel`
  // changes, and — the one that saves a whole refused run — whether §5.5 will
  // refuse to touch it at all.
  const marks: string[] = [];
  if (paragraph.styleName) marks.push(paragraph.styleName);
  if (paragraph.listLevel !== null) marks.push(`list·${paragraph.listLevel + 1}`);
  if (paragraph.locked) marks.push("locked");
  const prefix = marks.length > 0 ? `${key} {${marks.join("·")}}` : key;

  const text = normalise(paragraph.text);
  return text.length > 0 ? `${prefix} ${text}` : prefix;
}

/**
 * §4.3 — the whole sidecar.
 *
 * Empty paragraphs are listed and numbered (rule 3). They are paragraphs, and
 * `insertParagraph` addresses the one it goes after — including the blank one
 * that separates two sections.
 */
export function sidecarMarkdown(documentName: string, map: DocxMap): string {
  const lines = [`# ${documentName}`, ""];
  const locked = map.paragraphs.filter((paragraph) => paragraph.locked !== null);

  if (locked.length > 0) {
    lines.push(
      `> ${locked.length} of these ${map.paragraphs.length} paragraphs are marked \`locked\`.`,
      "> REX refuses every operation on one, so do not plan an edit to it.",
      "",
    );
  }

  // Measured while building 19.1: **8 of the 18 Word files on this machine
  // define no paragraph styles at all.** Their headings are a bold run at a
  // larger size — direct formatting, which carries no style name. §5.3 refuses
  // to invent a style definition, so `setHeadingLevel` cannot work there, and
  // the agent has to be told that before it writes a plan rather than after.
  if (!map.paragraphs.some((paragraph) => paragraph.styleId !== null)) {
    lines.push(
      "> This document uses direct formatting: none of its paragraphs carries a style.",
      "> Its headings are bold runs at a larger size, so setHeadingLevel would give a",
      "> paragraph the template's own heading look, which will not match them. Prefer",
      "> setStyle here. setListLevel is refused, because nothing is a list item.",
      "",
    );
  }

  for (const paragraph of map.paragraphs) lines.push(line(paragraph));
  lines.push("");
  return lines.join("\n");
}

/**
 * The sidecar for one file, written if it is not already there.
 *
 * Keyed by content hash, so a document that has changed gets a new one and a
 * document that has not is not rebuilt. Returns the path the agent is told to
 * read, or null when the file cannot be read as a Word document at all — the
 * caller turns that into a refusal rather than an empty edit.
 */
export async function ensureSidecar(path: string, bytes?: Buffer): Promise<string | null> {
  const source = bytes ?? readFileSync(path);
  const hash = contentHashOf(source);
  const target = sidecarPathFor(basename(path), hash);

  try {
    const map = await readDocxMap(await openPackage(source));
    mkdirSync(docxCacheDir(hash), { recursive: true });
    writeFileSync(target, sidecarMarkdown(basename(path), map), "utf8");
    return target;
  } catch {
    return null;
  }
}
