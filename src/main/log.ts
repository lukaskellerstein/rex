// Spec 13 §3 — one ring of recent lines, in main.
//
// Main is the only process that can hold it. It already sees the renderer's
// console (`diagnostics.ts`), it outlives a renderer reload, and it is the one
// process with a terminal attached — which is what §1.2 is about: Electron does
// not forward renderer output to whoever ran `npm run dev`, so a window that
// broke because the renderer threw leaves the terminal silent.
//
// No `electron` import, so `test/debug.spec.ts` can exercise the ring directly.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DB_PATH } from "./db/location.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  at: string;
  level: LogLevel;
  /** `ipc`, `renderer`, `guest`, `load`, `crash`, `main`, `cdp`. */
  source: string;
  message: string;
}

/** Enough to hold the run-up to a failure, small enough to paste. */
const RING = 300;

/**
 * One line is a symptom, not a document. Anything longer is a stack or a blob,
 * and §3.4 keeps document and comment text out of a report that gets pasted to
 * a stranger — a clip is the cheap half of that guarantee.
 */
const MAX_MESSAGE = 400;

/** Beyond this the file has stopped being a log and started being a disk leak. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Beside `rex.db`, so `REX_DB_PATH` moves both together. */
export const LOG_PATH = join(dirname(DB_PATH), "rex.log");

const ring: LogEntry[] = [];
let filePath: string | null = null;
let fileBytes = 0;
let fileCapped = false;
let written = 0;

function clip(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE)}…` : flat;
}

/**
 * Truncated per run, not appended to.
 *
 * A log that spans runs cannot answer "what happened this time", and this file
 * exists for one question: the reviewer just saw REX misbehave, and whoever is
 * fixing it may have no debugger to attach. Yesterday's lines only get in the
 * way of that.
 */
export function openLogFile(path: string = LOG_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    // The header names the run that truncated it. Two REX instances share this
    // path — the second one takes it over — and without a name on the first
    // line there is no way to tell whose lines you are reading. §2.2's probe
    // says the same thing from the other side: a REX that could not get the
    // port is a REX that is not alone.
    writeFileSync(path, `--- REX pid ${process.pid} · ${new Date().toISOString()} ---\n`);
    filePath = path;
    fileBytes = 0;
    fileCapped = false;
  } catch {
    // A log that cannot be written must not be the reason REX will not start.
    filePath = null;
  }
}

function toFile(entry: LogEntry): void {
  if (filePath === null || fileCapped) return;
  const line = `${entry.at}  ${entry.level.padEnd(5)} ${entry.source.padEnd(8)} ${entry.message}\n`;
  fileBytes += Buffer.byteLength(line);
  if (fileBytes > MAX_FILE_BYTES) {
    fileCapped = true;
    try {
      appendFileSync(filePath, `--- capped at ${MAX_FILE_BYTES} bytes ---\n`);
    } catch {
      filePath = null;
    }
    return;
  }
  try {
    appendFileSync(filePath, line);
  } catch {
    filePath = null;
  }
}

/**
 * `warn` and `error` also go to stderr, prefixed so they are distinguishable
 * from Vite's and Chromium's own output in the same terminal. `info` does not:
 * the ring and the file want the full sequence, a terminal wants only the part
 * that is wrong.
 */
export function record(level: LogLevel, source: string, message: string): void {
  const entry: LogEntry = { at: new Date().toISOString(), level, source, message: clip(message) };
  ring.push(entry);
  if (ring.length > RING) ring.shift();
  written += 1;
  toFile(entry);
  if (level !== "info") process.stderr.write(`[rex] ${level} ${source}: ${entry.message}\n`);
}

/** An `unknown` from a `catch`, said the same way every time. */
export function recordError(source: string, error: unknown): void {
  record("error", source, error instanceof Error ? (error.stack ?? error.message) : String(error));
}

export function entries(limit = RING): readonly LogEntry[] {
  return limit >= ring.length ? [...ring] : ring.slice(ring.length - limit);
}

/** How many lines this run produced — the ring only kept the last few hundred. */
export function lineCount(): number {
  return written;
}

/** `null` when the file could not be opened, which the report says out loud. */
export function logFile(): string | null {
  return filePath;
}

/** Tests only: a ring shared between cases is a test that passes by accident. */
export function resetLog(): void {
  ring.length = 0;
  written = 0;
  filePath = null;
  fileBytes = 0;
  fileCapped = false;
}
