// Spec 27 §5.2 — the one question about a file name that BOTH processes ask.
//
// Main asks it to decide how to render a document (`render/formats.ts`). The
// renderer asks it to decide whether the paper strip is drawn, because the two
// switches exist only on the page REX typeset itself (§4.2).
//
// It lives here rather than in main because the renderer cannot import
// `render/formats.ts`: that module uses `node:path`, which is not in the
// renderer's bundle. The alternative was a second copy of the extension list in
// the renderer, guarded by a test asserting the two agree — a test that exists
// only because the duplication does. One list, in the one place both may
// import, is the smaller answer.
//
// `node:path` is deliberately absent, so this module is importable from either
// side and from a plain `node --test`.

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

/**
 * The file's extension, lower-cased, including the dot. `""` when it has none.
 *
 * Matches `node:path`'s `extname` on the shapes REX meets, the dotfile included:
 * `extname(".md")` is `""`, because a leading dot names the file rather than its
 * type — hence `dot <= 0` rather than `dot < 0`.
 */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path));
}
