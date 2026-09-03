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

import { existsSync, renameSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  WorkspaceDeleteRequest,
  WorkspaceFileResult,
  WorkspaceRenameRequest,
} from "../../shared/channels.ts";
import type { Db } from "../db/database.ts";
import { documentsUnder, moveDocumentPaths, moveWorkspaceRulePaths } from "../db/queries.ts";
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
 * Spec 23 §2.2 — the four checks both acts share, in order.
 *
 * Returns the sentence to show, or null when the path may be acted on. Order
 * matters: "outside the workspace" must be answered before anything reads the
 * file, and every answer is about the path the reviewer can see.
 */
function refuseTarget(root: string, path: string, want: "file" | "either"): string | null {
  if (!scannedRoots.has(resolve(root))) {
    return "REX has not opened that folder as a workspace, so it will not change anything in it.";
  }
  if (!isInsideWorkspace(root, path)) {
    return "That path is not inside the open workspace.";
  }
  const segments = relative(resolve(root), resolve(path)).split(sep);
  const skipped = segments.find((segment) => SKIP_DIRECTORIES.has(segment));
  if (skipped !== undefined) {
    return `${skipped} is a folder REX never touches — build output, dependencies and \`.git\` are left to the tools that own them.`;
  }
  if (!existsSync(path)) {
    return "That file is no longer there. Press reload to bring the tree up to date.";
  }
  if (want === "file" && !statSync(path).isFile()) {
    return "That is a folder. REX deletes files one at a time and never a folder — see spec 23 §8.";
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
 * Spec 23 §4.2 — the name, before anything touches the disk.
 *
 * Returns the sentence to show, or null when `target` may be written.
 */
function refuseName(path: string, name: string, target: string): string | null {
  if (name.length === 0) return "A file needs a name.";
  if (name === "." || name === "..") return `"${name}" is not a name.`;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return "A name, not a path — REX renames a file where it is and never moves it.";
  }
  // `renameSync` overwrites silently, so this check is what stands between a
  // typo and a file nobody meant to lose. A case-only rename on a
  // case-insensitive volume answers `existsSync` yes about the file being
  // renamed, which is why the same file is not "already taken" (§4.2).
  if (existsSync(target) && !isSameFile(path, target)) {
    return `There is already something called "${name}" in that folder.`;
  }
  return null;
}

/**
 * Spec 23 §4 — the file, and every record REX keys on its path.
 *
 * The disk act happens first and the database follows, because a database that
 * describes a rename which did not happen is worse than one that has not caught
 * up yet. If the rows cannot be moved the file is renamed back, so the pair
 * lands together or not at all (§4.1).
 */
export function renameEntry(db: Db, request: WorkspaceRenameRequest): WorkspaceFileResult {
  const name = request.name.trim();
  const target = join(dirname(request.path), name);

  const refusal = refuseTarget(request.root, request.path, "either");
  if (refusal !== null) return { ok: false, reason: refusal };

  // Renaming a file to what it is already called is what a reviewer who opened
  // the box and clicked away has done. It is not an error and not an act.
  if (target === request.path) return { ok: true, path: request.path };

  const nameRefusal = refuseName(request.path, name, target);
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

  try {
    renameSync(request.path, target);
  } catch (error) {
    return { ok: false, reason: `That file could not be renamed: ${String(error)}` };
  }

  try {
    db.transaction(() => {
      moveDocumentPaths(db, request.path, target);
      moveWorkspaceRulePaths(db, request.root, request.path, target);
    })();
    moveWorkingCopies(request.path, target);
  } catch (error) {
    // The rename landed and its record did not, which is precisely the state
    // this feature exists to prevent — a comment keyed to a name that is gone.
    // So the file goes back, and the reviewer is told nothing changed.
    try {
      renameSync(target, request.path);
    } catch {
      return {
        ok: false,
        reason: `The file was renamed to "${name}" but REX could not move the comments onto the new name, and could not rename it back either. Rename it to its old name by hand.`,
      };
    }
    return {
      ok: false,
      reason: `REX could not move the comments onto the new name, so nothing was renamed: ${String(error)}`,
    };
  }

  return { ok: true, path: target };
}

/**
 * Spec 23 §3 — one file, to the system Bin, with its comments kept.
 *
 * Nothing is deleted from the database. The `document` row and every comment on
 * it stay exactly where they are, so putting the file back in the Finder brings
 * the review back with it (§3.2).
 */
export async function deleteEntry(
  request: WorkspaceDeleteRequest,
  trash: Trash,
): Promise<WorkspaceFileResult> {
  const refusal = refuseTarget(request.root, request.path, "file");
  if (refusal !== null) return { ok: false, reason: refusal };

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
