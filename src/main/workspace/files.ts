// Spec 23 — renaming a file, and moving one to the Bin.
//
// The second door REX has into the folder under review. Apply is the first, and
// everything about it — the diff, the accept step, the working copy — is
// machinery for reviewing an agent's proposal (spec 01 §8.7). None of that
// applies here: the reviewer picked the row and typed the name, so what is
// needed instead is a set of guards and one honest sentence when they refuse.
//
// Every check lives in main, per invariant I2 — the renderer names a path, and
// nothing more. Split out of `ipc.ts` so the guards can be proven under
// `node --test`: this is where REX decides whether to move one of the
// reviewer's files, and a decision of that weight should be readable, and
// testable, in one place. Electron's `shell` is injected for the same reason.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type {
  WorkspaceCreateRequest,
  WorkspaceCreateResult,
  WorkspaceDeleteRequest,
  WorkspaceFileResult,
  WorkspaceMoveRequest,
  WorkspaceRenameRequest,
} from "../../shared/channels.ts";
import type { Db } from "../db/database.ts";
import {
  countThreadsFor,
  documentsUnder,
  moveDocumentPaths,
  moveWorkspaceRulePaths,
} from "../db/queries.ts";
import { isDocumentPath } from "../render/formats.ts";
import { moveWorkingCopies, pendingCopy } from "../work.ts";
import { isInsideWorkspace, SKIP_DIRECTORIES } from "./created.ts";

/** What moves a file to the system Bin. `shell.trashItem` in the app. */
export type Trash = (path: string) => Promise<void>;

/**
 * Spec 23 §2.2, check 1 — the roots REX has actually drawn this session.
 *
 * The renderer sends the root it is drawing, exactly as spec 10's exclusions
 * do, and main does not have to believe it. A root that has never been scanned
 * is not a folder the reviewer is looking at, so it is not a folder REX will
 * rename inside.
 */
const scannedRoots = new Set<string>();

export function noteWorkspaceRoot(root: string): void {
  scannedRoots.add(resolve(root));
}

/** Test seam, and nothing else: the app only ever adds roots. */
export function forgetWorkspaceRoots(): void {
  scannedRoots.clear();
}

/**
 * Spec 23 §2.2 — the four checks every act shares, in order.
 *
 * Returns the sentence to show, or null when the path may be acted on. Order
 * matters: "outside the workspace" must be answered before anything reads the
 * file, and every answer is about the path the reviewer can see.
 *
 * Spec 39 §3 adds `"directory"`, which is the same walk asked about the folder a
 * new path goes in rather than about the path itself.
 *
 * There is no `"file"` want. Delete had one until spec 39 §5.5, which let an
 * empty folder go to the Bin — and the sentence it refused with had to name the
 * folder and say why, which is a question about the folder's contents rather
 * than about its path. `deleteEntry` asks it itself.
 */
function refuseTarget(root: string, path: string, want: "directory" | "either"): string | null {
  if (!scannedRoots.has(resolve(root))) {
    return "REX has not opened that folder as a workspace, so it will not change anything in it.";
  }
  // Spec 39 §5.2 — the workspace root is a legitimate parent for a create, and
  // it is the one path `isInsideWorkspace` answers no about: nothing is inside
  // itself. It is never a legitimate target for a rename or a delete, so the
  // allowance is tied to the `directory` want and to nothing else.
  const atRoot = want === "directory" && resolve(path) === resolve(root);
  if (!atRoot && !isInsideWorkspace(root, path)) {
    return "That path is not inside the open workspace.";
  }
  const segments = relative(resolve(root), resolve(path)).split(sep);
  const skipped = segments.find((segment) => SKIP_DIRECTORIES.has(segment));
  if (skipped !== undefined) {
    return `${skipped} is a folder REX never touches — build output, dependencies and \`.git\` are left to the tools that own them.`;
  }
  if (!existsSync(path)) {
    return want === "directory"
      ? "That folder is no longer there. Press reload to bring the tree up to date."
      : "That file is no longer there. Press reload to bring the tree up to date.";
  }
  if (want === "directory" && !statSync(path).isDirectory()) {
    return "That is a file. A new file or folder goes inside a folder.";
  }
  return null;
}

/** Spec 23 §4.2 — the same file, seen through a case-insensitive filesystem. */
function isSameFile(a: string, b: string): boolean {
  try {
    const left = statSync(a);
    const right = statSync(b);
    return left.ino === right.ino && left.dev === right.dev;
  } catch {
    return false;
  }
}

/**
 * Spec 23 §4.2 and spec 39 §3 — the name, before anything touches the disk.
 *
 * Returns the sentence to show, or null when `target` may be written.
 *
 * `from` is the path being renamed, and null when there is none — which is what
 * tells the two acts apart. A create has no source, so every existing target is
 * taken, and the sentence about a path says "makes" rather than "renames".
 */
function refuseName(input: {
  name: string;
  target: string;
  from: string | null;
  noun: "file" | "folder";
}): string | null {
  const { name, target, from, noun } = input;
  if (name.length === 0) return `A ${noun} needs a name.`;
  if (name === "." || name === "..") return `"${name}" is not a name.`;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return from === null
      ? "A name, not a path — REX makes one thing, in the folder you picked."
      : "A name, not a path — REX renames a file where it is and never moves it.";
  }
  // `renameSync` overwrites silently, so this check is what stands between a
  // typo and a file nobody meant to lose. A case-only rename on a
  // case-insensitive volume answers `existsSync` yes about the file being
  // renamed, which is why the same file is not "already taken" (§4.2).
  if (existsSync(target) && !(from !== null && isSameFile(from, target))) {
    return `There is already something called "${name}" in that folder.`;
  }
  return null;
}

/**
 * Spec 23 §4 — the file, and every record REX keys on its path.
 *
 * A name and never a path (§8): this changes the last segment and nothing else.
 * Moving it somewhere is spec 40's `moveEntry`, and the two share `relocate`.
 */
export function renameEntry(db: Db, request: WorkspaceRenameRequest): WorkspaceFileResult {
  const name = request.name.trim();
  const target = join(dirname(request.path), name);

  const refusal = refuseTarget(request.root, request.path, "either");
  if (refusal !== null) return { ok: false, reason: refusal };

  // Renaming a file to what it is already called is what a reviewer who opened
  // the box and clicked away has done. It is not an error and not an act.
  if (target === request.path) return { ok: true, path: request.path };

  const nameRefusal = refuseName({ name, target, from: request.path, noun: "file" });
  if (nameRefusal !== null) return { ok: false, reason: nameRefusal };

  // §4.2 — `document` carries UNIQUE (kind, value), so a row already sitting on
  // the new name would make the update below throw with the file already
  // renamed. Asked here, while nothing has happened yet.
  const inTheWay = documentsUnder(db, target);
  if (inTheWay.length > 0 && !isSameFile(request.path, target)) {
    const held = inTheWay.length === 1 ? "a file" : `${inTheWay.length} files`;
    return {
      ok: false,
      reason: `REX still holds comments written on ${held} called that. Choose another name, or delete those comments first.`,
    };
  }

  return relocate(db, { root: request.root, from: request.path, to: target, act: "renamed" });
}

/**
 * Spec 23 §4.1 and spec 40 §2.1 — the path changes, and every record REX keys
 * on it changes with it.
 *
 * One function for both acts, because a rename and a move differ only in which
 * part of the path moved. `movedPath` inside each mover answers for the path
 * AND everything under it, which is what carries forty documents when a folder
 * is the thing that moved.
 *
 * The disk act happens first and the database follows, because a database that
 * describes a change which did not happen is worse than one that has not caught
 * up yet. If the rows cannot be moved the file goes back, so the pair lands
 * together or not at all.
 *
 * `act` is the past participle for the sentences — "renamed", "moved". It is
 * the only thing the two callers do not share, and two copies of a rollback is
 * one copy too many: the copy that rots is the rollback, and the rollback is
 * the part that matters.
 */
function relocate(
  db: Db,
  input: { root: string; from: string; to: string; act: "renamed" | "moved" },
): WorkspaceFileResult {
  const { root, from, to, act } = input;

  try {
    renameSync(from, to);
  } catch (error) {
    return { ok: false, reason: `That file could not be ${act}: ${String(error)}` };
  }

  try {
    db.transaction(() => {
      moveDocumentPaths(db, from, to);
      moveWorkspaceRulePaths(db, root, from, to);
    })();
    moveWorkingCopies(from, to);
  } catch (error) {
    // The disk act landed and its record did not, which is precisely the state
    // this feature exists to prevent — a comment keyed to a path that is gone.
    // So the file goes back, and the reviewer is told nothing changed.
    try {
      renameSync(to, from);
    } catch {
      return {
        ok: false,
        reason: `The file was ${act} but REX could not bring the comments with it, and could not put it back either. Put it back by hand.`,
      };
    }
    return {
      ok: false,
      reason: `REX could not bring the comments with it, so nothing was ${act}: ${String(error)}`,
    };
  }

  return { ok: true, path: to };
}

/**
 * Spec 40 §2 — one row, into one folder, with everything keyed on its path.
 *
 * Every check the tree already made is made again here. The renderer displays
 * untrusted document content (invariant I2), so a guard that exists only there
 * is not a guard — and the tree can be stale besides: the folder it drew may
 * have gone between the drag starting and the drop landing.
 */
export function moveEntry(db: Db, request: WorkspaceMoveRequest): WorkspaceFileResult {
  const sourceRefusal = refuseTarget(request.root, request.path, "either");
  if (sourceRefusal !== null) return { ok: false, reason: sourceRefusal };

  const destinationRefusal = refuseTarget(request.root, request.parent, "directory");
  if (destinationRefusal !== null) return { ok: false, reason: destinationRefusal };

  // §3.1 checks 2 and 3 — a folder into itself takes its own subtree with it,
  // and `renameSync` performs it: the tree the reviewer dragged ends up inside
  // a path that no longer exists at the level they were looking at.
  // `isInsideWorkspace(a, b)` is "b is inside a", and it answers no when the two
  // are equal, so the equality is asked separately.
  if (resolve(request.parent) === resolve(request.path)) {
    return { ok: false, reason: "A folder cannot go inside itself." };
  }
  if (isInsideWorkspace(request.path, request.parent)) {
    return { ok: false, reason: "A folder cannot go inside something it holds." };
  }

  // §3.1 check 1 — already there. Not an error and not an act, exactly as a
  // rename to the name a file already has (spec 23 §4.2).
  if (resolve(dirname(request.path)) === resolve(request.parent)) {
    return { ok: true, path: request.path };
  }

  const name = basename(request.path);
  const target = join(request.parent, name);

  const nameRefusal = refuseName({ name, target, from: request.path, noun: "file" });
  if (nameRefusal !== null) return { ok: false, reason: nameRefusal };

  // Spec 23 §4.2's check, in a second place and for the same reason: `document`
  // carries UNIQUE (kind, value), so a row already sitting on the destination
  // path would make the update throw with the file already moved.
  const inTheWay = documentsUnder(db, target);
  if (inTheWay.length > 0 && !isSameFile(request.path, target)) {
    const held = inTheWay.length === 1 ? "a file" : `${inTheWay.length} files`;
    return {
      ok: false,
      reason: `REX still holds comments written on ${held} at that path. Move it somewhere else, or delete those comments first.`,
    };
  }

  return relocate(db, { root: request.root, from: request.path, to: target, act: "moved" });
}

/**
 * Spec 23 §3 — one file, to the system Bin, with its comments kept.
 *
 * Nothing is deleted from the database. The `document` row and every comment on
 * it stay exactly where they are, so putting the file back in the Finder brings
 * the review back with it (§3.2).
 *
 * Spec 39 §5.5 adds one folder: an EMPTY one. Spec 23 §3.1 refused every folder
 * because "a folder holds a tree, and one click must not be able to take a whole
 * `docs/` with it" — and an empty folder holds no tree, so the sentence has
 * nothing left to protect. What made the gap worth closing is that spec 39 lets
 * a reviewer make one in two keystrokes and left them no way to undo it.
 */
export async function deleteEntry(
  request: WorkspaceDeleteRequest,
  trash: Trash,
): Promise<WorkspaceFileResult> {
  const refusal = refuseTarget(request.root, request.path, "either");
  if (refusal !== null) return { ok: false, reason: refusal };

  // §5.5 — emptiness is read from the disk and never from the tree. The tree is
  // what the reviewer is looking at, and it can be a scan old enough that the
  // folder has filled up since; `readdirSync` is what is actually there.
  if (statSync(request.path).isDirectory()) {
    let held: string[];
    try {
      held = readdirSync(request.path);
    } catch (error) {
      return { ok: false, reason: `REX could not read that folder: ${String(error)}` };
    }
    if (held.length > 0) {
      return {
        ok: false,
        reason: `"${basename(request.path)}" is not empty. REX only bins a folder with nothing in it, so one click can never take a tree of files with it.`,
      };
    }
  }

  // §3.1 — the one destructive case, and it is refused rather than confirmed.
  // The agent's new version lives in REX's own store, not in the file, so the
  // Bin would not hold it and nothing could bring it back.
  // Spec 34 §4 — pending, not present: a copy that equals the file holds
  // nothing the Bin would lose.
  const working = pendingCopy(request.path);
  if (working !== null) {
    return {
      ok: false,
      reason:
        "That file has a new version waiting. Approve it or discard it first — the Bin would not hold it, and REX cannot get it back.",
    };
  }

  try {
    await trash(request.path);
  } catch (error) {
    return { ok: false, reason: `That file could not be moved to the Bin: ${String(error)}` };
  }
  return { ok: true, path: request.path };
}

/**
 * Spec 39 §2.2 — the comments REX still holds on a path nothing is at.
 *
 * Spec 23 §3.2 keeps them when a file goes to the Bin, so a reviewer can make a
 * new file exactly where an old one's review still lives. That is not a reason
 * to refuse — the reason is invisible, and refusing on it would be too — but it
 * is a reason to say so, because every anchor in those comments will orphan
 * against an empty file.
 *
 * Returns null when there are none, which is almost always.
 */
function commentsHeldAt(db: Db, target: string): string | null {
  const documents = documentsUnder(db, target);
  if (documents.length === 0) return null;

  const held = countThreadsFor(
    db,
    documents.map((record) => record.id),
  );
  if (held === 0) return null;

  return `REX still holds ${held} ${held === 1 ? "comment" : "comments"} written on that name; ${held === 1 ? "it" : "they"} will show as gone until the text comes back.`;
}

/**
 * Spec 39 §2 — an empty file, or an empty folder, and nothing else.
 *
 * No transaction, and that is the whole difference from `renameEntry`. A path
 * that did not exist has no comments, no exclusion rule and no working copy, so
 * there is no second act to keep in step and nothing to put back when the disk
 * write fails (§2.1).
 */
export function createEntry(db: Db, request: WorkspaceCreateRequest): WorkspaceCreateResult {
  const name = request.name.trim();
  const folder = request.kind === "directory";

  const refusal = refuseTarget(request.root, request.parent, "directory");
  if (refusal !== null) return { ok: false, reason: refusal };

  const target = join(request.parent, name);
  const nameRefusal = refuseName({
    name,
    target,
    from: null,
    noun: folder ? "folder" : "file",
  });
  if (nameRefusal !== null) return { ok: false, reason: nameRefusal };

  // §3.2 — the skip list is by directory name at any depth, so a folder called
  // `out` would be made and then never drawn. That reads as a create which
  // silently failed. A FILE called `out` is drawn perfectly well, which is why
  // this asks about the kind — spec 21 §3 draws the same line.
  if (folder && SKIP_DIRECTORIES.has(name)) {
    return {
      ok: false,
      reason: `REX never draws a folder called "${name}", so it will not make one.`,
    };
  }

  try {
    // §4.1 — `wx` and a non-recursive `mkdir` both fail on a path that exists,
    // which is what closes the gap between the check above and the write.
    if (folder) mkdirSync(target);
    else writeFileSync(target, "", { flag: "wx" });
  } catch (error) {
    const what = folder ? "That folder" : "That file";
    return { ok: false, reason: `${what} could not be created: ${String(error)}` };
  }

  return {
    ok: true,
    path: target,
    // §5.3 — a folder is never opened, and neither is a file REX cannot render.
    opens: !folder && isDocumentPath(target),
    note: commentsHeldAt(db, target),
  };
}
