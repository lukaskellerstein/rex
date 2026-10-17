// What a `rex-doc://` response says about itself.
//
// Apart from `protocol.ts` so that a plain `node --test` can import it: that
// module needs `electron`, and this one is the part a test has to read.

import { extname } from "node:path";
import { isHtmlPath } from "../shared/formats.ts";

const MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  // Spec 11 §4.8 — a deck's own media parts. Measured on 2026-08-24: both an
  // animated GIF and a <video> play inside a frame sandboxed without
  // `allow-scripts`, because decoding a media file is the user agent's own work.
  // They are served with a real type or Chromium refuses to decode them.
  ".m4a": "audio/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  // Not a guard. Measured 2026-10-17 (spec 59): Chromium runs a `<script src>`
  // served as text/plain, because nothing sends `nosniff`. What keeps a script
  // out of the review frame is its sandbox; the Live frame runs this one.
  ".js": "text/plain",
  ".json": "application/json",
  // Spec 03 §7.1 — PDF.js range-fetches the file over this scheme, which is
  // also why the renderer's CSP gains `connect-src rex-doc:`.
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Spec 59 §3.2 — the policy a page runs under in the Live frame.
 *
 * Only the Live frame loads HTML by URL: the review frame is a `srcdoc`, and
 * spec 53 stops every link in it from navigating. So this governs nothing else.
 * The sandbox — `allow-scripts` without `allow-same-origin` — is what keeps the
 * script away from REX. This list is what keeps it from talking to anyone else.
 */
export const LIVE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' rex-doc: https:",
  "style-src 'unsafe-inline' rex-doc: https:",
  "img-src rex-doc: data: blob: https:",
  "font-src rex-doc: data: https:",
  "media-src rex-doc: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");

export function headersFor(path: string): Record<string, string> {
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  return isHtmlPath(path)
    ? { "content-type": type, "content-security-policy": LIVE_POLICY }
    : { "content-type": type };
}
