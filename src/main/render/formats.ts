// What counts as a document, by file extension. SPEC.md §5.2, spec 02 §4.1,
// spec 03 §2.
//
// Its own module, with no imports beyond `node:path`, because three very
// different callers need the same answer: the renderer dispatch (`index.ts`),
// the explorer (`workspace/tree.ts`) and the reference graph
// (`workspace/links.ts`). The first of those reaches Electron — it registers
// `rex-doc://` roots — and the other two are pure and are tested with plain
// `node --test`. Keeping the predicates here is what stops a test of link
// extraction from having to boot Electron, which is the same separation
// spec 03 §10 asks for between the token-stream rules and `markdown.ts`.

import { extname } from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isHtmlPath(path: string): boolean {
  return HTML_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isPdfPath(path: string): boolean {
  return extname(path).toLowerCase() === ".pdf";
}

export function isDocxPath(path: string): boolean {
  return extname(path).toLowerCase() === ".docx";
}

/** Spec 02 §4.1 — the test the explorer and the renderer dispatch share. */
export function isDocumentPath(path: string): boolean {
  return isMarkdownPath(path) || isHtmlPath(path) || isPdfPath(path) || isDocxPath(path);
}

/**
 * True when the file's own bytes are prose that a link can be read out of.
 *
 * PDF and DOCX are documents REX renders and are not this. A DOCX is a zip and
 * a PDF is a binary object graph, and reading either as UTF-8 gives mojibake
 * that still matches `href="…"` and `[[…]]` — so the reference graph grew a
 * node labelled with a run of replacement characters, linked from the DOCX.
 * Measured on 2026-08-21 against `sample-files/sample-document.docx`.
 *
 * Both formats can hold real hyperlinks. Reading them would mean unzipping and
 * running mammoth inside the graph scan, which spec 02 §1.1 rules out — the
 * graph is computed on demand and must stay in milliseconds. So they are nodes
 * with no outgoing links, which is honest, and never a source of invented ones.
 */
export function isTextDocumentPath(path: string): boolean {
  return isMarkdownPath(path) || isHtmlPath(path);
}

/**
 * Why a listed file cannot be opened. Spec 02 §4.1 shows this rather than
 * hiding the file: a reviewer needs to see the file is there even though REX
 * cannot render it.
 */
export function unopenableReason(_path: string): string {
  return "REX renders Markdown, HTML, PDF and DOCX.";
}

/**
 * Spec 01 §5.2 — Apply needs a local source file it can edit by line. There is
 * no honest way to write a prose edit back into a PDF or a DOCX, so Apply is
 * off for both and says why on hover.
 */
export function applyDisabledReason(path: string): string | null {
  if (isPdfPath(path)) return "Apply cannot edit a PDF — there is no source line to write back to.";
  if (isDocxPath(path)) {
    return "Apply cannot edit a DOCX — REX renders its prose, not its document model.";
  }
  return null;
}
