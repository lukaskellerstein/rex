// SPEC.md §5.2 — dispatch on DocumentRef, and say honestly when Apply cannot
// work. Tier 3 (PDF, DOCX) is not scheduled and must not be guessed at.

import { readFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
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
 * The stylesheet REX supplies for Markdown, which has none of its own. HTML
 * documents keep theirs untouched (§5.4 point 3) and never see this.
 */
const MARKDOWN_STYLESHEET = `
  :root {
    color-scheme: light dark;
    --rex-bg: #ffffff;
    --rex-fg: #1c1f23;
    --rex-muted: #5b6570;
    --rex-rule: #e3e7ea;
    --rex-code-bg: #f4f6f8;
    --rex-link: #1a56b8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --rex-bg: #16191c;
      --rex-fg: #e6e9ec;
      --rex-muted: #9aa4ae;
      --rex-rule: #2c3238;
      --rex-code-bg: #1e2226;
      --rex-link: #7fb0ff;
    }
  }
  body {
    margin: 0 auto;
    padding: 3rem 1.5rem 6rem;
    max-width: 46rem;
    background: var(--rex-bg);
    color: var(--rex-fg);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  h1, h2, h3, h4 { line-height: 1.25; margin: 2.2rem 0 0.8rem; }
  h1 { font-size: 2rem; }
  h2 { font-size: 1.5rem; border-bottom: 1px solid var(--rex-rule); padding-bottom: 0.3rem; }
  h3 { font-size: 1.2rem; }
  p, ul, ol, blockquote, table { margin: 0 0 1rem; }
  a { color: var(--rex-link); }
  code { background: var(--rex-code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
  pre { background: var(--rex-code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid var(--rex-rule); margin-left: 0; padding-left: 1rem; color: var(--rex-muted); }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--rex-rule); padding: 0.4rem 0.6rem; text-align: left; }
  hr { border: none; border-top: 1px solid var(--rex-rule); margin: 2rem 0; }
  img { max-width: 100%; }
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
