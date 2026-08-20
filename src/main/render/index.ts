// SPEC.md §5.2 — dispatch on DocumentRef, and say honestly when Apply cannot
// work. Tier 3 (PDF, DOCX) is not scheduled and must not be guessed at.

import { readFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { MEASURE, PAPER } from "../../shared/tokens.ts";
import type { DocumentRef } from "../../shared/types.ts";
import { loadHtmlFile, sha256 } from "./html.ts";
import { markdownTitle, renderMarkdown } from "./markdown.ts";

export interface RenderedDocument {
  /** Full HTML document for tiers 1; null for a URL shown in a <webview>. */
  html: string | null;
  contentHash: string | null;
  title: string | null;
  baseDir: string | null;
  applyEnabled: boolean;
  applyDisabledReason: string | null;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Spec 02 §4.1 — the same test §5.2 already uses, shared with the explorer. */
export function isDocumentPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(extension) || HTML_EXTENSIONS.has(extension);
}

/**
 * Why a listed file cannot be opened. Spec 02 §4.1 shows this rather than
 * hiding the file: a reviewer needs to see the PDF is there even though REX
 * cannot render it.
 */
export function unopenableReason(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf" || extension === ".docx") {
    return `${extension} is tier 3 (SPEC.md §5.2) and is not scheduled.`;
  }
  return "REX renders Markdown and HTML.";
}

/**
 * The stylesheet REX supplies for Markdown, which has none of its own.
 *
 * This is the one document REX is entitled to set: the 620px measure at 15/1.68
 * and the paper ground are its own typography, not the author's. HTML documents
 * keep their styles untouched (§5.4 point 3) and never see this, and a
 * `<webview>` URL is untouchable — for both of those the pane supplies only the
 * paper ground and the gutter.
 *
 * Light only, deliberately. The design draws documents on paper and REX's
 * chrome in the dark around them; following the system into dark mode would
 * make a Markdown file look nothing like the HTML file beside it in the
 * explorer, and would put a review's two halves on different grounds.
 */
const MARKDOWN_STYLESHEET = `
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    padding: 40px 24px 96px;
    max-width: ${MEASURE.width};
    background: ${PAPER.bg};
    color: ${PAPER.inkBody};
    font: ${MEASURE.fontSize}/${MEASURE.lineHeight} "IBM Plex Sans", system-ui, -apple-system, sans-serif;
  }
  h1, h2, h3, h4, h5, h6 { color: ${PAPER.ink}; line-height: 1.2; margin: 30px 0 12px; }
  h1 { font-size: 27px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; margin-top: 0; }
  h2 { font-size: 20px; font-weight: 600; }
  h3 { font-size: 17px; font-weight: 600; }
  h4, h5, h6 { font-size: 15px; font-weight: 600; }
  p, ul, ol, blockquote, table, figure, pre { margin: 0 0 18px; }
  a { color: ${PAPER.link}; }
  code {
    background: ${PAPER.wash};
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em;
  }
  pre {
    background: ${PAPER.wash};
    padding: 14px 16px;
    border-radius: 5px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.55;
  }
  pre code { background: none; padding: 0; font-size: inherit; }
  blockquote {
    margin-left: 0;
    padding-left: 14px;
    border-left: 2px solid ${PAPER.rule};
    color: ${PAPER.inkMuted};
  }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th, td { border: 1px solid ${PAPER.rule}; padding: 7px 10px; text-align: left; }
  th { background: ${PAPER.wash}; font-weight: 600; color: ${PAPER.ink}; }
  figure { padding: 9px; border-radius: 4px; background: ${PAPER.wash}; }
  figcaption { margin-top: 7px; font-size: 12.5px; color: ${PAPER.inkMuted}; }
  hr { border: none; border-top: 1px solid ${PAPER.rule}; margin: 30px 0; }
  img { max-width: 100%; }
  ::selection { background: #b6d0f2; }
`;

function markdownPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${MARKDOWN_STYLESHEET}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

export function renderDocument(ref: DocumentRef): RenderedDocument {
  if (ref.kind === "url") {
    // Tier 2 (§5.2): shown in a <webview>, so there is no HTML to hand over
    // and no local file to write back into.
    return {
      html: null,
      contentHash: null,
      title: null,
      baseDir: null,
      applyEnabled: false,
      applyDisabledReason: "Apply needs a local source file; this document is a URL.",
    };
  }

  const extension = extname(ref.value).toLowerCase();

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    const bytes = readFileSync(ref.value);
    const source = bytes.toString("utf8");
    const title = markdownTitle(source) ?? basename(ref.value);
    return {
      html: markdownPage(title, renderMarkdown(source)),
      contentHash: sha256(bytes),
      title,
      baseDir: dirname(ref.value),
      applyEnabled: true,
      applyDisabledReason: null,
    };
  }

  if (HTML_EXTENSIONS.has(extension)) {
    const loaded = loadHtmlFile(ref.value);
    return {
      html: loaded.source,
      contentHash: loaded.contentHash,
      title: loaded.title ?? basename(ref.value),
      baseDir: dirname(ref.value),
      applyEnabled: true,
      applyDisabledReason: null,
    };
  }

  throw new Error(
    `REX renders Markdown and HTML. ${extension || "This file"} is tier 3 (SPEC.md §5.2) and is not scheduled.`,
  );
}
