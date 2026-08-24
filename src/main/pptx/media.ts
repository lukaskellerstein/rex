// Spec 11 §7.4 — pictures: where they come from, and the four places each one
// has to be written.
//
// The rule at the top of the spec is the one this file exists to keep:
//
//   **The agent never fetches an image, never draws one, and never touches the
//   zip.** It writes a plan; REX validates it, performs it on a copy, and shows
//   the result.
//
// The write profile's hook allows every tool that is not MCP, so an agent asked
// to insert a picture *could* `curl` an arbitrary URL and splice bytes into the
// reviewer's deck with nothing in between. Instead the plan carries a URL, a
// path, or Mermaid source, and every byte that reaches a slide passes the size,
// type and magic-byte checks below first.

import { readFile } from "node:fs/promises";
import type { ImageSource } from "./plan.ts";

/**
 * Spec 11 §6.4.3 — whether generated media is available at all.
 *
 * `image-generation` and `video-generation` both go through `uvx media-mcp`,
 * which needs `GEMINI_API_KEY`. Without it the tools would be present and would
 * fail, which is the half-working state §6.4.3 refuses: the feature is absent,
 * the plan schema says so, and the write prompt says so too.
 */
export function generationAvailable(): boolean {
  return (process.env.GEMINI_API_KEY ?? "").length > 0;
}

/**
 * §6.4.3 — where the media server writes what it makes.
 *
 * Without it the server returns the media as base64 **in the tool response**,
 * which for a video means a multi-megabyte blob in the agent transcript, stored
 * in SQLite, and replayed on every thread open.
 */
export function setMediaOutputDir(directory: string): void {
  process.env.MEDIA_OUTPUT_DIR = directory;
}

/** §7.4.1 — hard caps. A deck that gains three clips gains tens of megabytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** §7.4.1 — a redirect chain is followed, but not forever. */
const MAX_REDIRECTS = 3;

export interface FetchedMedia {
  bytes: Buffer;
  /** The extension REX will give the part, from the bytes rather than the name. */
  extension: string;
  contentType: string;
}

/**
 * What these bytes actually are, read from their first few bytes.
 *
 * §7.4.1 requires the check to be on the magic bytes rather than on the header,
 * because a `Content-Type: image/png` costs a server nothing to write and the
 * deck is what has to open afterwards. A file whose type cannot be recognised
 * here is refused rather than guessed at.
 */
export function sniffMediaType(bytes: Buffer): { extension: string; contentType: string } | null {
  const starts = (...magic: number[]): boolean =>
    magic.every((byte, index) => bytes[index] === byte);

  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { extension: "png", contentType: "image/png" };
  }
  if (starts(0xff, 0xd8, 0xff)) return { extension: "jpeg", contentType: "image/jpeg" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { extension: "gif", contentType: "image/gif" };
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  // An mp4 or mov declares its brand in an `ftyp` box, four bytes in.
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand.startsWith("qt")) return { extension: "mov", contentType: "video/quicktime" };
    return { extension: "mp4", contentType: "video/mp4" };
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return { extension: "webm", contentType: "video/webm" };
  return null;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function checkKind(
  found: { extension: string; contentType: string },
  kind: "image" | "video",
  what: string,
): void {
  const allowed = kind === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  if (!allowed.has(found.contentType)) {
    throw new Error(`${what} is ${found.contentType}, which is not a ${kind} REX can insert.`);
  }
}

function checkSize(bytes: Buffer, kind: "image" | "video", what: string): void {
  const cap = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (bytes.length > cap) {
    throw new Error(
      `${what} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, over the ${cap / 1024 / 1024} MB limit.`,
    );
  }
}

/**
 * §7.4.1 — **the agent chooses the URL. It never downloads it.** REX fetches
 * the bytes, here in main, with the limits above.
 *
 * A fetch failing any check fails the operation with a reason and writes
 * nothing, which is the same all-or-nothing rule every other operation follows.
 */
async function fetchUrl(url: string, kind: "image" | "video"): Promise<FetchedMedia> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(target, { redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error(`${target} redirected with no destination.`);
      target = new URL(next, target).toString();
      continue;
    }
    if (!response.ok) throw new Error(`${target} answered ${response.status}.`);

    const bytes = Buffer.from(await response.arrayBuffer());
    checkSize(bytes, kind, target);

    const found = sniffMediaType(bytes);
    if (!found) {
      // The commonest form of this is a URL that serves an HTML page — a search
      // result, a login wall, a "this content is unavailable" notice. Its header
      // often still claims an image type.
      throw new Error(
        `${target} did not return a picture. Its first bytes are not any image format REX accepts.`,
      );
    }
    checkKind(found, kind, target);
    return { bytes, ...found };
  }
  throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times.`);
}

async function readLocal(path: string, kind: "image" | "video"): Promise<FetchedMedia> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`REX cannot read ${path}.`);
  }
  checkSize(bytes, kind, path);
  const found = sniffMediaType(bytes);
  if (!found) throw new Error(`${path} is not any media format REX accepts.`);
  checkKind(found, kind, path);
  return { bytes, ...found };
}

/**
 * §7.4.2 — a diagram arrives as **Mermaid source**, not as a picture.
 *
 * That is the better half of the "replace it with a graph" gesture, and it is
 * better precisely because source is reviewable text: it draws in REX's own
 * house style, it stays regenerable when the numbers change, and it cannot
 * arrive with someone else's watermark on it.
 *
 * Mermaid cannot run here. It appends a temporary element to a document and
 * measures text with a real layout, so it runs in the renderer and hands back a
 * PNG — the same reason spec 03 §5.8 gives for the document view's own diagrams.
 * PNG rather than SVG because PowerPoint's SVG support needs an
 * `<asvg:svgBlip>` extension *and* a raster fallback, which is two
 * representations to keep in step for a sharpness gain a 2× PNG mostly closes.
 */
export type DrawDiagram = (source: string) => Promise<Buffer>;

/**
 * §7.4.5 step 2 — one frame out of a video, plus how long the clip runs.
 *
 * Takes a path rather than bytes: the renderer decodes the file over
 * `rex-doc://`, and a 50 MB clip base64'd across IPC would be 67 MB of string
 * for one still picture.
 */
export type DrawPoster = (videoPath: string) => Promise<{
  png: Buffer;
  durationSeconds: number;
}>;

export interface MediaResolver {
  drawDiagram: DrawDiagram;
  drawPoster: DrawPoster;
}

/** The bytes for one `source`, whatever kind it is, checked and ready. */
export async function resolveSource(
  source: ImageSource,
  kind: "image" | "video",
  resolver: MediaResolver,
): Promise<FetchedMedia> {
  switch (source.from) {
    case "web":
      return fetchUrl(source.url, kind);
    case "file":
      return readLocal(source.path, kind);
    case "generated":
      // §7.4 — the agent may produce a file on disk through an allowlisted tool.
      // It never opens the zip, and REX still checks the type, the size and the
      // magic bytes before anything of it reaches a slide.
      return readLocal(source.path, kind);
    case "diagram": {
      if (kind !== "image") throw new Error("A diagram cannot be inserted as a video.");
      const bytes = await resolver.drawDiagram(source.source);
      checkSize(bytes, "image", "the drawn diagram");
      const found = sniffMediaType(bytes);
      if (!found) throw new Error("The diagram did not come back as a picture REX recognises.");
      return { bytes, ...found };
    }
  }
}

/** §7.7 — what the preview says about where this picture came from. */
export function describeSource(source: ImageSource): string {
  switch (source.from) {
    case "web":
      // §7.4.1 — the credit is a required field on the operation and is SHOWN
      // rather than logged. REX cannot verify a licence, cannot check it, and
      // must not imply that it has: a deck that goes to a customer with a stock
      // photograph in it is the reviewer's decision, made with this in front of
      // them.
      return `from the web — searched "${source.query}" · ${source.url} · ${source.credit} · ${source.licence}`;
    case "file":
      return `from a file on this machine — ${source.path}`;
    case "generated":
      return `GENERATED by ${source.engine} — prompt: "${source.prompt}"`;
    case "diagram":
      return `drawn by REX from Mermaid source:\n${source.source}`;
  }
}
