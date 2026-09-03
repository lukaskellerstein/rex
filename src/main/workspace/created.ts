// Spec 21 §2 and §3 — the file the agent creates, and where REX lets it stay.
//
// Split out of `tree.ts` so the rule is testable without a database: `tree.ts`
// needs SQLite for comment counts and exclusion rules, and this decides whether
// a path survives a run, which is filesystem reasoning and nothing else. The
// skip list lives here for the same reason — both files need it, and it is a
// fact about paths rather than about scanning.

import { relative, resolve, sep } from "node:path";
import { isTextDocumentPath } from "../render/formats.ts";

/**
 * Build output and dependency trees are never review material (spec 02 §4.2).
 *
 * `tree.ts` prunes them from the scan; §3 refuses to keep a created file inside
 * one. The two uses are the same statement: these directories hold nothing a
 * reviewer reads, so a file REX kept in one would be a file nobody can see —
 * which is the bug spec 21 exists to fix, in a new place.
 */
export const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  ".vite",
  ".next",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  "release",
  "releases",
]);

/**
 * Whether `path` is inside `root` — by resolved path, never by string prefix.
 *
 * `relative()` answers it exactly: a path inside the root has a relative form
 * with no leading `..` and is not absolute. That is what stops a symlink or a
 * `../../etc/passwd` from reading as "inside the workspace", and it is also why
 * `root` itself is not inside itself — an empty relative path is the root, and
 * a file is what this is asked about.
 */
export function isInsideWorkspace(root: string, path: string): boolean {
  const from = relative(resolve(root), resolve(path));
  if (from.length === 0) return false;
  return !from.startsWith(`..${sep}`) && from !== ".." && !from.startsWith(sep);
}

/**
 * Spec 21 §2 — whether a file the agent CREATED is kept where it wrote it.
 *
 * The caller has already established that the path did not exist when the run
 * started (spec 21 §2.3). This answers the second question only: is it
 * somewhere the reviewer will actually see it.
 *
 * A `null` root means no workspace is open, and then the answer is no. REX
 * cannot show a file in a tree that is not on screen, and keeping one it cannot
 * draw would be the silent case again.
 *
 * Spec 22 §2.1 asks it the same question about a file the agent EDITED, and
 * for the same reason: a working copy of a file the tree never draws is a
 * change the reviewer cannot find.
 */
export function keepsCreatedFile(root: string | null, path: string): boolean {
  if (root === null) return false;
  if (!isInsideWorkspace(root, path)) return false;

  // Every segment between the root and the file, the file's own name excluded:
  // a directory named `build` hides everything under it, and a FILE named
  // `build` hides nothing.
  const segments = relative(resolve(root), resolve(path)).split(sep);
  return !segments.slice(0, -1).some((segment) => SKIP_DIRECTORIES.has(segment));
}

/** What a run should do with one file it wrote outside its own list. */
export type StrayAct =
  /** Spec 15 §4.3 — it existed and REX holds its bytes. Write them back. */
  | "restore-bytes"
  /** Spec 21 §2.3 — it existed and git is the only copy. `git checkout`. */
  | "restore-git"
  /** Spec 21 §2 — it did not exist, and the reviewer will see it. Leave it. */
  | "keep"
  /** It did not exist, and nothing would ever show it. Remove it. */
  | "delete"
  /**
   * Spec 22 §2 — it existed, it is a text document, and it is under the open
   * workspace. Put the original back and hold the agent's version as a working
   * copy, exactly as the anchored document's is held.
   */
  | "adopt";

/**
 * Spec 21 §2 — the whole rule, as one decision with no side effects.
 *
 * Separated from the file operations so it can be tested for what it decides
 * rather than for what it moved. Getting this backwards is the failure that
 * matters in both directions: treating a modification as a creation keeps a
 * change nobody agreed to, and treating a creation as a modification deletes
 * the file the reviewer asked for — which is the bug spec 21 §1 reported.
 *
 * `inBeforeSet` and `tracked` are two answers to one question — *did this path
 * exist when the run started* — and neither is enough alone. The before-set
 * (spec 15 §3.4) holds what `git status` reported plus the run's targets, so it
 * misses every tracked, clean file. Git misses everything untracked. Together
 * they miss only a path that is **ignored** and was already there, and for that
 * one `keep` is still the best available answer: its old bytes are gone from
 * disk either way, REX never had a copy, and `git checkout` has nothing to
 * restore — so deleting would lose both versions instead of one.
 *
 * Spec 22 §2 adds the one act that is neither a put-back nor a keep. A file
 * that existed is not put back when it is a Markdown or HTML document the tree
 * draws: REX has the original from the same two sources, so it can hold both
 * versions and let the reviewer choose — the answer spec 15 already gives for
 * the document under review. The format test is the reviewer's own line, *"if
 * it allows for editing"*: a `.docx` is a zip an `Edit` corrupts, and REX cannot
 * draw two versions of a `.json`, so both keep the put-back.
 */
export function classifyStray(input: {
  path: string;
  inBeforeSet: boolean;
  tracked: boolean;
  workspaceRoot: string | null;
}): StrayAct {
  const existed = input.inBeforeSet || input.tracked;
  if (
    existed &&
    isTextDocumentPath(input.path) &&
    keepsCreatedFile(input.workspaceRoot, input.path)
  ) {
    return "adopt";
  }
  if (input.inBeforeSet) return "restore-bytes";
  if (input.tracked) return "restore-git";
  return keepsCreatedFile(input.workspaceRoot, input.path) ? "keep" : "delete";
}
