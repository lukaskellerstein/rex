// Spec 15 §3 — the working copy.
//
// The agent never edits the reviewer's file. REX forks a copy the first time a
// document is changed, every ACT run after that edits the copy, and the file is
// replaced only when the whole new version is approved (§7.2).
//
// A directory and not a table, deliberately (§9). It has to survive a database
// that was deleted and a REX that was killed, and the one thing that must never
// be lost is the reviewer's own bytes — `base` is written before the agent's
// first tool call.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { sha256 } from "./render/html.ts";

/** One ACT run's result, kept so §3.3's undo is a step back and not a loss. */
export interface WorkingRevision {
  n: number;
  applyRunId: string;
  threadId: string;
  at: string;
  sha256: string;
}

export interface WorkingMeta {
  documentId: string;
  /** The reviewer's file. Absolute. */
  path: string;
  /** The file's hash at the fork. §7.3 compares it again before approving. */
  baseSha256: string;
  forkedAt: string;
  revisions: WorkingRevision[];
  /** Which revision `current` holds. 0 is `base` — every change undone. */
  current: number;
}

/**
 * `work`, not `tmp` (§3.1).
 *
 * `scratch` and `cache` beside it both mean "nobody minds if this is deleted".
 * This directory holds work the reviewer has not approved and cannot get back.
 */
export function workRoot(): string {
  return process.env.REX_WORK_PATH ?? join(homedir(), ".rex", "work");
}

export function workDir(documentId: string): string {
  return join(workRoot(), documentId);
}

function metaPath(documentId: string): string {
  return join(workDir(documentId), "meta.json");
}

/**
 * The original's extension, so every renderer that dispatches on one
 * (`render/formats.ts`) works on a working copy with no special case.
 */
function suffix(meta: WorkingMeta): string {
  return extname(meta.path);
}

/**
 * The document's own name, without its extension — `user-interaction-flow`.
 *
 * Every file in the directory is built from it, and that is the point. The
 * first version named them `base.md`, `current.md` and `rev-1.md`: the agent
 * reads the working copy (§5), so it answered *"the joke at `current.md:31`"*,
 * and the reviewer read that as some **other file entirely**. A name that says
 * which document it belongs to costs nothing and removes the question.
 * Reported on 2026-08-26.
 */
function stem(meta: WorkingMeta): string {
  return basename(meta.path, suffix(meta));
}

/** The version on disk — the left-hand pane's `ORIGINAL`. */
export function basePath(meta: WorkingMeta): string {
  return join(workDir(meta.documentId), `${stem(meta)}.original${suffix(meta)}`);
}

/**
 * What the right-hand pane shows, and the one file the agent may edit.
 *
 * `.new`, in the words the pane above it already uses: the reviewer is looking
 * at `ORIGINAL` beside `NEW VERSION`, and the two files are named after the two
 * things they are.
 */
export function currentPath(meta: WorkingMeta): string {
  return join(workDir(meta.documentId), `${stem(meta)}.new${suffix(meta)}`);
}

/** One ACT run's output, kept so §3.3's undo is a step back and not a loss. */
function revisionPath(meta: WorkingMeta, n: number): string {
  return join(workDir(meta.documentId), `${stem(meta)}.v${n}${suffix(meta)}`);
}

export function readMeta(documentId: string): WorkingMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(documentId), "utf8")) as WorkingMeta;
  } catch {
    // No working copy, or one written by a version that cannot be read. Both
    // mean "this document has no copy", which is the safe answer: the reviewer's
    // file is the truth and nothing is lost by re-forking.
    return null;
  }
}

function writeMeta(meta: WorkingMeta): void {
  mkdirSync(workDir(meta.documentId), { recursive: true });
  writeFileSync(metaPath(meta.documentId), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * The working copy of a document named by its path.
 *
 * By path and not by documentId, because `doc:open` has to know whether one
 * exists *before* it decides what to render — and the row that carries the id
 * is written after, from what the render found.
 */
export function readMetaByPath(path: string): WorkingMeta | null {
  return listWorkingCopies().find((meta) => meta.path === path) ?? null;
}

/** Every working copy on this machine, newest fork first. */
export function listWorkingCopies(): WorkingMeta[] {
  const root = workRoot();
  if (!existsSync(root)) return [];
  const metas: WorkingMeta[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = readMeta(entry.name);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.forkedAt.localeCompare(a.forkedAt));
}

/**
 * §3.1 — the file names, brought up to date.
 *
 * A working copy outlives the app that made it, so a reviewer with a change
 * still open when this shipped would otherwise find an empty right-hand pane
 * and a discarded change. This renames what is already there instead: the
 * bytes, the revisions and the review all survive.
 *
 * Safe at every start. A directory that already carries the new names has
 * nothing to move, and a rename that cannot be made is left alone — the old
 * file is still the reviewer's only copy of work they have not approved, so
 * this never removes one.
 */
export function migrateWorkingCopyNames(): void {
  for (const meta of listWorkingCopies()) {
    const dir = workDir(meta.documentId);
    const ext = suffix(meta);
    const moves: Array<[string, string]> = [
      [join(dir, `base${ext}`), basePath(meta)],
      [join(dir, `current${ext}`), currentPath(meta)],
      ...meta.revisions.map((revision): [string, string] => [
        join(dir, `rev-${revision.n}${ext}`),
        revisionPath(meta, revision.n),
      ]),
    ];

    for (const [from, to] of moves) {
      // A document actually named `base.md` would move a file onto itself.
      if (from === to || !existsSync(from) || existsSync(to)) continue;
      try {
        renameSync(from, to);
      } catch {
        // Locked, or on a filesystem that refuses the move. The old name stays
        // and the pane comes up empty, which is visible — losing the bytes
        // would not be.
      }
    }
  }
}

/**
 * §3.3 — forked from the file, once. Calling it again returns what exists.
 *
 * Idempotent because every ACT run calls it and only the first one forks. A
 * second fork would throw away every revision before it, which is the one thing
 * this directory exists to prevent.
 */
export function forkWorkingCopy(documentId: string, path: string): WorkingMeta {
  const existing = readMeta(documentId);
  if (existing) return existing;

  const bytes = readFileSync(path);
  const meta: WorkingMeta = {
    documentId,
    path,
    baseSha256: sha256(bytes),
    forkedAt: new Date().toISOString(),
    revisions: [],
    current: 0,
  };
  mkdirSync(workDir(documentId), { recursive: true });
  writeFileSync(basePath(meta), bytes);
  writeFileSync(currentPath(meta), bytes);
  writeMeta(meta);
  return meta;
}

/** The hash of `current` right now — what §4.2 compares before and after a run. */
export function currentHash(meta: WorkingMeta): string {
  try {
    return sha256(readFileSync(currentPath(meta)));
  } catch {
    return "";
  }
}

/**
 * §3.3 — the agent changed `current`, so keep it as a revision.
 *
 * Returns null when the content did not move: §4.2's rule is that a file is
 * changed when its hash moved, so a rewrite with identical bytes is not a run
 * anybody needs to be able to undo.
 */
export function saveRevision(
  meta: WorkingMeta,
  run: { applyRunId: string; threadId: string; before: string },
): WorkingMeta | null {
  const after = currentHash(meta);
  if (after === run.before) return null;

  // The numbering follows the highest revision ever taken, not the length of
  // the list: undoing to rev-1 and running again must not overwrite rev-2's
  // file while its entry is still in the list.
  const n = (meta.revisions.at(-1)?.n ?? 0) + 1;
  copyFileSync(currentPath(meta), revisionPath(meta, n));
  const next: WorkingMeta = {
    ...meta,
    revisions: [
      ...meta.revisions,
      {
        n,
        applyRunId: run.applyRunId,
        threadId: run.threadId,
        at: new Date().toISOString(),
        sha256: after,
      },
    ],
    current: n,
  };
  writeMeta(next);
  return next;
}

/**
 * §3.3 — one run back. The revision file stays, so this is a step and not a
 * deletion.
 *
 * Returns null when there is nothing to undo, which the caller reports rather
 * than treating as a failure.
 */
export function undoLastRevision(documentId: string): WorkingMeta | null {
  const meta = readMeta(documentId);
  if (!meta || meta.revisions.length === 0) return null;

  const dropped = meta.revisions.at(-1) as WorkingRevision;
  const remaining = meta.revisions.slice(0, -1);
  const previous = remaining.at(-1) ?? null;
  copyFileSync(previous ? revisionPath(meta, previous.n) : basePath(meta), currentPath(meta));
  rmSync(revisionPath(meta, dropped.n), { force: true });

  const next: WorkingMeta = { ...meta, revisions: remaining, current: previous?.n ?? 0 };
  writeMeta(next);
  return next;
}

export interface ApproveResult {
  ok: boolean;
  /** Present when `ok` is false — §7.3, in the words the reviewer sees. */
  reason?: string;
}

/**
 * §7.2 — `current` replaces the file. §7.3 is the one refusal.
 *
 * The hash comparison is not a formality: a reviewer who edited the document in
 * their own editor while a working copy existed would otherwise have that edit
 * silently overwritten, and REX does not merge (§12).
 */
export function approveWorkingCopy(documentId: string): ApproveResult {
  const meta = readMeta(documentId);
  if (!meta) return { ok: false, reason: "There is no working copy for this document." };

  let onDisk: Buffer;
  try {
    onDisk = readFileSync(meta.path);
  } catch {
    return {
      ok: false,
      reason: `${meta.path} cannot be read any more, so REX will not write over it. Discard the working copy, or put the file back.`,
    };
  }

  if (sha256(onDisk) !== meta.baseSha256) {
    return {
      ok: false,
      reason:
        "This file has changed on disk since REX made its copy. Approving would throw your own edit away. Discard the copy and ask again, or open the two versions and copy across what you want.",
    };
  }

  writeFileSync(meta.path, readFileSync(currentPath(meta)));
  discardWorkingCopy(documentId);
  return { ok: true };
}

/** §3.3 — the file was never touched, so there is nothing else to undo. */
export function discardWorkingCopy(documentId: string): void {
  rmSync(workDir(documentId), { recursive: true, force: true });
}

// ── The before-set (§3.4) ───────────────────────────────────────

/** 32 MB. Above it a run is refused before the agent starts. */
export const BEFORE_SET_CAP = 32 * 1024 * 1024;

export interface BeforeSet {
  /** Absolute path → the bytes it held before the run. */
  contents: Map<string, Buffer>;
}

export class BeforeSetTooLarge extends Error {}

/**
 * §3.4 — everything REX might have to put back, copied before the agent runs.
 *
 * Its job is narrow and worth stating: the working copy is where the change
 * lives, so this exists only to undo a write the agent had no business making
 * (§4.3). Every path here is one `git checkout` could not restore — untracked,
 * or already modified when the run started.
 */
export function takeBeforeSet(root: string, paths: readonly string[]): BeforeSet {
  const contents = new Map<string, Buffer>();
  let total = 0;
  const sized: Array<{ path: string; size: number }> = [];

  for (const path of paths) {
    let size: number;
    try {
      const info = statSync(path);
      if (!info.isFile()) continue;
      size = info.size;
    } catch {
      // Gone between the listing and now, or unreadable. There is nothing to
      // put back, and `existed: false` is what a missing entry means below.
      continue;
    }
    sized.push({ path, size });
    total += size;
  }

  if (total > BEFORE_SET_CAP) {
    const largest = sized
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
      .map((entry) => `${relativeTo(root, entry.path)} (${megabytes(entry.size)})`)
      .join(", ");
    throw new BeforeSetTooLarge(
      `Apply would have to copy ${megabytes(total)} before it could promise to undo itself — ${largest}. Add those to .gitignore, or commit them, and try again.`,
    );
  }

  for (const entry of sized) {
    try {
      contents.set(entry.path, readFileSync(entry.path));
    } catch {
      // Same race as above, and the same answer.
    }
  }
  return { contents };
}

function relativeTo(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * §4.3 — put one file back exactly as it was. Deletes a file that did not exist.
 *
 * **What it found is kept first.** REX cannot tell an agent's stray write from
 * the reviewer saving that same file in their own editor mid-run, and a restore
 * that could destroy the second is not one worth having. The bytes go to
 * `~/.rex/work/_restored/<applyRunId>/`, and the message names the directory.
 */
export function restoreFromBeforeSet(set: BeforeSet, path: string, applyRunId: string): boolean {
  stash(applyRunId, path);
  const bytes = set.contents.get(path);
  if (bytes === undefined) {
    // It was not there before the run, so the agent created it. Removing it is
    // the restore.
    rmSync(path, { force: true });
    return true;
  }
  try {
    writeFileSync(path, bytes);
    return true;
  } catch {
    return false;
  }
}

export function restoredDir(applyRunId: string): string {
  return join(workRoot(), "_restored", applyRunId);
}

function stash(applyRunId: string, path: string): void {
  try {
    const bytes = readFileSync(path);
    const dir = restoredDir(applyRunId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, basename(path)), bytes);
  } catch {
    // Nothing there to keep, which is the ordinary case for a file the agent
    // created and REX is about to remove.
  }
}

/** Whether this path's content moved since the before-set was taken. */
export function movedSince(set: BeforeSet, path: string): boolean {
  const before = set.contents.get(path) ?? null;
  let now: Buffer | null;
  try {
    now = readFileSync(path);
  } catch {
    now = null;
  }
  if (before === null) return now !== null;
  if (now === null) return true;
  return !before.equals(now);
}
