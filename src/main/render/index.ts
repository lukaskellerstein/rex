// SPEC.md §5.2 — dispatch on DocumentRef, and say honestly when Apply cannot
// work.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname } from "node:path";
import type { DocumentPresentation, DocumentRef } from "../../shared/types.ts";
import { allowDirectory, baseHrefFor } from "../protocol.ts";
import { renderDocx } from "./docx.ts";
import {
  applyDisabledReason,
  isDocxPath,
  isHtmlPath,
  isMarkdownPath,
  isPdfPath,
} from "./formats.ts";
import { loadHtmlFile, sha256 } from "./html.ts";
import { markdownTitle, renderMarkdown } from "./markdown.ts";
import { MARKDOWN_STYLESHEET } from "./stylesheet.ts";

export interface RenderedDocument {
  /** Spec 03 §9 — what the renderer should draw, and how. */
  presentation: DocumentPresentation;
  contentHash: string | null;
  title: string | null;
  baseDir: string | null;
  applyEnabled: boolean;
  applyDisabledReason: string | null;
}

/**
 * KaTeX's stylesheet, served over `rex-doc://` (spec 03 §5.6).
 *
 * Resolved through `require.resolve` rather than assembled from
 * `import.meta.dirname`, because the two differ: in development the package
 * sits in the repo's `node_modules`, and in a packaged build it sits inside
 * `app.asar`. `readFile` works in both, and `require.resolve` is what knows
 * which one is true right now.
 *
 * The stylesheet's own font URLs are relative, so they resolve against its
 * `rex-doc://` URL and come from the same allowed root. Serving `katex/dist`
 * is therefore all that is needed for the fonts as well — without them KaTeX
 * falls back to system glyphs and the maths is subtly wrong rather than
 * visibly broken.
 */
function katexStylesheetUrl(): string {
  const require = createRequire(import.meta.url);
  const cssPath = require.resolve("katex/dist/katex.min.css");
  const dist = dirname(cssPath);
  allowDirectory(dist);
  return `${baseHrefFor(dist)}${basename(cssPath)}`;
}

/**
 * PDF.js's own asset directories — `standard_fonts/`, `cmaps/`, `wasm/`,
 * `iccs/` — served over `rex-doc://` by the same route, and for the same
 * reason: only main knows where the package sits, and a checkout and an
 * `app.asar` disagree.
 *
 * This is not a nicety. A PDF that uses the base-14 fonts embeds none of them,
 * and without `standardFontDataUrl` PDF.js's render task never settles: the
 * page fills white and no glyph is ever drawn, with one warning in the console
 * and no rejection to catch.
 */
function pdfjsAssetsUrl(): string {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  allowDirectory(root);
  return baseHrefFor(root);
}

/** Resolved once each: neither path can change while the process is running. */
let pdfAssets: string | null = null;

/** Resolved once: the path cannot change while the process is running. */
let katexUrl: string | null = null;

function markdownPage(title: string, body: string): string {
  katexUrl ??= katexStylesheetUrl();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${katexUrl}">
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

/**
 * Asynchronous because of DOCX: `mammoth.convertToHtml` is a promise and
 * spec 03 §8.1 prefers making the whole dispatch async over giving DOCX a
 * separate path. The IPC handler that calls this already awaits.
 */
export async function renderDocument(ref: DocumentRef): Promise<RenderedDocument> {
  if (ref.kind === "url") {
    // Tier 2 (§5.2): shown in a <webview>, so there is no HTML to hand over
    // and no local file to write back into.
    return {
      presentation: { kind: "url" },
      contentHash: null,
      title: null,
      baseDir: null,
      applyEnabled: false,
      applyDisabledReason: "Apply needs a local source file; this document is a URL.",
    };
  }

  if (isMarkdownPath(ref.value)) {
    const bytes = readFileSync(ref.value);
    const source = bytes.toString("utf8");
    const title = markdownTitle(source) ?? basename(ref.value);
    return {
      presentation: { kind: "html", html: markdownPage(title, renderMarkdown(source)) },
      contentHash: sha256(bytes),
      title,
      baseDir: dirname(ref.value),
      applyEnabled: true,
      applyDisabledReason: null,
    };
  }

  if (isHtmlPath(ref.value)) {
    const loaded = loadHtmlFile(ref.value);
    return {
      presentation: { kind: "html", html: loaded.source },
      contentHash: loaded.contentHash,
      title: loaded.title ?? basename(ref.value),
      baseDir: dirname(ref.value),
      applyEnabled: true,
      applyDisabledReason: null,
    };
  }

  if (isDocxPath(ref.value)) {
    // Spec 03 §8.1 — mammoth needs no DOM, so DOCX arrives as static HTML on
    // exactly the Markdown path and runs no enrichment pass at all.
    const bytes = readFileSync(ref.value);
    const rendered = await renderDocx(ref.value);
    const title = rendered.title ?? basename(ref.value);
    return {
      presentation: { kind: "html", html: markdownPage(title, rendered.html) },
      contentHash: sha256(bytes),
      title,
      baseDir: dirname(ref.value),
      applyEnabled: false,
      applyDisabledReason: applyDisabledReason(ref.value),
    };
  }

  if (isPdfPath(ref.value)) {
    // Spec 03 §7.1 — main does not read the bytes. It hands over a rex-doc://
    // URL and PDF.js range-fetches it from the renderer, which is where the
    // canvas is. The hash still comes from the bytes, so §6.6 can tell whether
    // the file changed under the anchors.
    const bytes = readFileSync(ref.value);
    const directory = dirname(ref.value);
    allowDirectory(directory);
    pdfAssets ??= pdfjsAssetsUrl();
    return {
      presentation: {
        kind: "pdf",
        url: `${baseHrefFor(directory)}${encodeURIComponent(basename(ref.value))}`,
        assetsUrl: pdfAssets,
      },
      contentHash: sha256(bytes),
      title: basename(ref.value),
      baseDir: directory,
      applyEnabled: false,
      applyDisabledReason: applyDisabledReason(ref.value),
    };
  }

  const extension = extname(ref.value).toLowerCase();
  throw new Error(
    `REX renders Markdown, HTML, PDF and DOCX. ${extension || "This file"} is none of them.`,
  );
}
