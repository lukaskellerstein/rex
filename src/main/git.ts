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
    return git(root, ["status", "--porcelain"])
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

/** SPEC.md §8.7 step 5 — rejecting an Apply reverts exactly what it touched. */
export function revert(root: string, paths: string[]): void {
  if (paths.length === 0) return;
  git(root, ["checkout", "--", ...paths]);
}
