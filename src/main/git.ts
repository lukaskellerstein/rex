// Git helpers. Not in §3.1's tree, but §8.4's backstop and §8.7 step 5 both
// specify git commands, and both main/ipc.ts and main/apply.ts need them.

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** The repository containing `path`, or its directory when there is none. */
export function repositoryRoot(path: string): string {
  const start = dirname(path);
  try {
    return git(start, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return start;
  }
}

export function isRepository(path: string): boolean {
  try {
    git(dirname(path), ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * SPEC.md §8.4 backstop — run after every `read` session. Anything listed here
 * is a bug in the gate, and must reach the UI rather than a log line.
 */
export function porcelainStatus(root: string): string[] {
  try {
    // Spec 15 §3.4 — `--untracked-files=all`, so an untracked TREE is listed as
    // its files rather than as one directory line. `?? docs/` was the whole of
    // spec 15 §1.2: one line for a thousand files, identical before and after
    // any edit to any of them.
    return git(root, ["status", "--porcelain", "--untracked-files=all"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/** Paths with uncommitted changes, relative to the repository root. */
export function changedFiles(root: string): string[] {
  return porcelainStatus(root).map((line) => line.slice(2).trim().split(" -> ").pop() ?? "");
}

export function diff(root: string, paths: string[]): string {
  try {
    // --no-index would be wrong here: these paths are tracked, and untracked
    // new files are reported separately by the caller.
    return git(root, ["diff", "--", ...paths]);
  } catch {
    return "";
  }
}

/**
 * Spec 15 §6.3 — a patch between any two files, in or out of a repository.
 *
 * `git diff` cannot draw one for a file it does not track, which is §1.3's
 * second consequence. `--no-index` can draw one for any two paths, and a
 * working copy's `base` and `current` are exactly two such paths.
 *
 * **It exits 1 when the files differ**, which is the normal case here, so the
 * patch is read from the error rather than from the return value. Reading only
 * the success path would silently produce an empty diff — the same failure this
 * whole spec exists to end.
 */
export function diffFiles(before: string, after: string): string {
  const args = ["diff", "--no-index", "--src-prefix=a/", "--dst-prefix=b/", "--", before, after];
  try {
    return git(process.cwd(), args);
  } catch (error) {
    const stdout = (error as { stdout?: string | Buffer }).stdout;
    if (typeof stdout === "string") return stdout;
    if (stdout) return stdout.toString("utf8");
    return "";
  }
}

/**
 * Spec 21 §2.3 — does git have this path, and therefore did it exist?
 *
 * The before-set (spec 15 §3.4) holds only what `git status` reported plus the
 * run's targets, so a **tracked, clean** file is absent from it. Without this
 * question, "not in the before-set" reads as "the agent created it" — and that
 * is wrong for every committed file in the repository, which is the whole of
 * them. Getting it wrong in one direction deletes a reviewer's file; in the
 * other it keeps a change they never agreed to.
 *
 * `--error-unmatch` is what makes it a question rather than a listing: git
 * exits non-zero for an untracked path, so the catch is the answer.
 */
export function isTracked(root: string, path: string): boolean {
  try {
    // stderr is discarded, not inherited: git prints "did not match any file(s)"
    // for the untracked case, and that case is an ANSWER here rather than a
    // fault. Inheriting it puts an error line in the log for every ordinary
    // stray-file check, which is how a log stops being worth reading.
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/** SPEC.md §8.7 step 5 — rejecting an Apply reverts exactly what it touched. */
export function revert(root: string, paths: string[]): void {
  if (paths.length === 0) return;
  git(root, ["checkout", "--", ...paths]);
}
