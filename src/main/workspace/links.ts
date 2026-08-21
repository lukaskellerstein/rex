// Spec 02 §5.1 and §5.2 — pull links out of a document and work out what they
// point at.
//
// This file must not import graph.ts. Link extraction is the half of the
// feature with a right answer, and it is tested on its own.

import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isDocumentPath, isMarkdownPath, isTextDocumentPath } from "../render/formats.ts";
import { parseMarkdownLinks } from "../render/markdown.ts";

/** A link exactly as the document wrote it, before resolution. */
export interface RawLink {
  href: string;
  /** 1-indexed, when the format gives it. */
  line: number | null;
}

export type LinkTarget =
  | { kind: "url" }
  | { kind: "self" }
  | { kind: "file"; path: string; fragment: string | null; exists: boolean };

/** `href` values that name a protocol rather than a path (§5.2 step 3). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `[[Target]]` and `[[Target|label]]` — markdown-it has no concept of these. */
const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

const HTML_HREF = /href\s*=\s*["']([^"']+)["']/gi;

/**
 * Spec 02 §5.1 — extract every link.
 *
 * Markdown goes through the token stream rather than a regular expression,
 * because the token stream already knows that a link inside a fenced code
 * block is not a link. HTML uses a pattern: the alternative is a DOM parser in
 * main, which spec 01 §5.4 already declined for the same reason.
 */
export function extractLinks(path: string, source: string): RawLink[] {
  // A PDF or a DOCX has no text to read links out of, and pattern-matching its
  // bytes invents them — `isTextDocumentPath` records what that looked like.
  // Guarded here as well as at the caller, because the caller is the one that
  // would be forgotten.
  if (!isTextDocumentPath(path)) return [];

  const links: RawLink[] = isMarkdownPath(path)
    ? parseMarkdownLinks(source)
    : extractHtmlLinks(source);

  return [...links, ...extractWikilinks(source)];
}

function extractHtmlLinks(source: string): RawLink[] {
  const links: RawLink[] = [];
  for (const match of source.matchAll(HTML_HREF)) {
    links.push({ href: match[1], line: lineOf(source, match.index ?? 0) });
  }
  return links;
}

function extractWikilinks(source: string): RawLink[] {
  const links: RawLink[] = [];
  for (const match of source.matchAll(WIKILINK)) {
    links.push({ href: match[1].trim(), line: lineOf(source, match.index ?? 0) });
  }
  return links;
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** True when `path` is `root` or sits underneath it. */
export function isInside(root: string, path: string): boolean {
  const a = resolve(root);
  const b = resolve(path);
  return b === a || b.startsWith(a + sep);
}

/**
 * Spec 02 §5.2 — resolve one link.
 *
 * `documentsByBasename` resolves wikilinks, which name a document rather than
 * a path; an ambiguous basename is left unresolved rather than guessed at.
 */
export function resolveTarget(
  fromFile: string,
  href: string,
  documentsByBasename?: Map<string, string[]>,
): LinkTarget {
  const trimmed = href.trim();
  if (trimmed.length === 0) return { kind: "self" };
  if (trimmed.startsWith("#")) return { kind: "self" };
  if (HAS_SCHEME.test(trimmed) || trimmed.startsWith("//")) return { kind: "url" };

  const hash = trimmed.indexOf("#");
  const rawPath = hash === -1 ? trimmed : trimmed.slice(0, hash);
  const fragment = hash === -1 ? null : trimmed.slice(hash + 1) || null;
  if (rawPath.length === 0) return { kind: "self" };

  const decoded = decodeUriSafely(rawPath);

  // A wikilink names a document, not a path: no separator, no extension.
  if (documentsByBasename && !decoded.includes("/") && !decoded.includes(".")) {
    const matches = documentsByBasename.get(decoded.toLowerCase()) ?? [];
    if (matches.length === 1) {
      return { kind: "file", path: matches[0], fragment, exists: true };
    }
    if (matches.length > 1) {
      // §5.1 — the shallowest match wins, but a genuine tie is reported as
      // broken rather than guessed at.
      const depth = (path: string): number => path.split(sep).length;
      const ambiguous = depth(matches[0]) === depth(matches[1]);
      return ambiguous
        ? { kind: "file", path: decoded, fragment, exists: false }
        : { kind: "file", path: matches[0], fragment, exists: true };
    }
  }

  const target = isAbsolute(decoded) ? decoded : resolve(dirname(fromFile), decoded);
  return { kind: "file", ...describeFile(target), fragment };
}

function describeFile(target: string): { path: string; exists: boolean } {
  if (!existsSync(target)) return { path: target, exists: false };

  try {
    if (statSync(target).isDirectory()) {
      // §5.2 — a link to a directory means its index, or it is broken.
      for (const index of ["index.md", "index.html", "README.md"]) {
        const candidate = join(target, index);
        if (existsSync(candidate)) return { path: candidate, exists: true };
      }
      return { path: target, exists: false };
    }
  } catch {
    return { path: target, exists: false };
  }

  return { path: target, exists: true };
}

function decodeUriSafely(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Lowercased basename → the documents carrying it, for wikilink resolution. */
export function indexByBasename(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const path of paths) {
    if (!isDocumentPath(path)) continue;
    const name = path.split(sep).pop() ?? path;
    const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
    index.set(stem, [...(index.get(stem) ?? []), path]);
  }
  // §5.1 — ties are left unresolved, so a shallower path wins only when it is
  // genuinely shallower rather than merely first.
  for (const [stem, matches] of index) {
    index.set(
      stem,
      [...matches].sort((a, b) => a.split(sep).length - b.split(sep).length),
    );
  }
  return index;
}
