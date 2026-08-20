// SPEC.md §5.4 — tier 1 HTML.
//
// Deviation from §3.1, and the reason for it: §3.1 files "sanitise + serve"
// here in main, but DOMPurify needs a DOM and main has none — running it here
// would mean adding `jsdom`, which §3.2 does not name. So main does the part
// that needs the filesystem (read, hash, title) and the renderer sanitises
// immediately on receipt, before the string reaches the iframe. The iframe is
// additionally `sandbox="allow-same-origin"` with no `allow-scripts`, so
// nothing in the document can execute either way.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface LoadedFile {
  source: string;
  /** SHA-256 of the source bytes (§5.1). */
  contentHash: string;
  title: string | null;
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function loadHtmlFile(path: string): LoadedFile {
  const bytes = readFileSync(path);
  const source = bytes.toString("utf8");
  const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    source,
    contentHash: sha256(bytes),
    title: match ? match[1].trim() : null,
  };
}
