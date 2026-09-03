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
// Spec 27 §5.2 — the renderer needs this same answer and cannot have `node:path`,
// so the Markdown list moved to `shared/` and is re-exported here. Every caller
// of `isMarkdownPath` keeps importing it from this module; there is one list.
import { isMarkdownPath } from "../../shared/formats.ts";

export { isMarkdownPath };

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

export function isHtmlPath(path: string): boolean {
  return HTML_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isPdfPath(path: string): boolean {
  return extname(path).toLowerCase() === ".pdf";
}

export function isDocxPath(path: string): boolean {
  return extname(path).toLowerCase() === ".docx";
}

/**
 * Spec 11 §4.1 — a deck.
 *
 * `.ppt` — the pre-2007 binary format — is deliberately absent and must stay
 * absent. It is not a zip, `pptxtojson` cannot read it, and a gate that
 * accepted it would fail at parse time with a confusing message instead of at
 * listing time with a clear one.
 */
export function isPptxPath(path: string): boolean {
  return extname(path).toLowerCase() === ".pptx";
}

/** Spec 02 §4.1 — the test the explorer and the renderer dispatch share. */
export function isDocumentPath(path: string): boolean {
  return (
    isMarkdownPath(path) ||
    isHtmlPath(path) ||
    isPdfPath(path) ||
    isDocxPath(path) ||
    isPptxPath(path)
  );
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
  return "REX renders Markdown, HTML, PDF, DOCX and PPTX.";
}

/**
 * Spec 01 §5.2 said Apply needs a local source file it can edit by line, and
 * therefore refused every binary format. Two specs have since replaced that
 * rule rather than worked around it:
 *
 * - Spec 11 §7 — a `.pptx`. The agent writes a plan, REX performs it on a copy,
 *   and the reviewer accepts a picture of the result rather than a diff.
 * - Spec 19 §4.2 — a `.docx`, the same way, on the working copy spec 15 §3
 *   already forks. A Word file is prose, so the two panes show it as text and
 *   it needs no picture and no second store.
 *
 * What is left is the PDF, and it is refused **by decision** (spec 19 §8), not
 * for want of a mechanism. A deck or a document that did not parse is refused by
 * the dispatch in `index.ts` instead, because that is where the parse happened.
 */
export function applyDisabledReason(path: string): string | null {
  if (isPdfPath(path)) {
    // Spec 19 §8.4 — a decision, not a gap, and the message says what the
    // format is rather than what REX lacks. §8.2 is the measurement behind it:
    // 92% of the fonts in a PDF are subsets that cannot spell a word which is
    // not already on the page, and nothing in the format reflows.
    return (
      "Apply cannot edit a PDF. A PDF is a picture of a page — it has no paragraphs " +
      "to change. Comment on it, and edit the document it came from."
    );
  }
  return null;
}
