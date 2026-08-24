// Spec 02 §4 — scanning a workspace into a tree.
//
// A workspace can be a whole repository, so this refuses to scan forever, and
// when it stops early it says so. A silently truncated tree reads exactly like
// a complete one, and a reviewer who cannot see a file assumes it is not there.

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Exclusion, TreeEntry, WorkspaceTree } from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import { commentCountsByDocument, workspaceRules } from "../db/queries.ts";
import { isDocumentPath, unopenableReason } from "../render/formats.ts";

/** Build output and dependency trees are never review material (§4.2). */
const SKIP_DIRECTORIES = new Set([
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

const MAX_DEPTH = 12;
const MAX_ENTRIES = 5000;

/** Directories first, then files, each alphabetically — the VS Code ordering. */
function byKindThenName(a: TreeEntry, b: TreeEntry): number {
  if (a.kind === "directory" && b.kind !== "directory") return -1;
  if (a.kind !== "directory" && b.kind === "directory") return 1;
  return a.name.localeCompare(b.name);
}

function readEntries(directory: string): Dirent[] {
  try {
    // withFileTypes gives the kind without a stat per entry, and a symlink
    // reports as a symlink rather than as its target — so a cycle cannot be
    // walked into, because neither isDirectory() nor isFile() is true for one.
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Spec 10 §3.5 — `reveal` lists the folders REX skips **on its own**.
 *
 * It does not govern the reviewer's own exclusions, and the difference is the
 * point. A rule somebody wrote is always drawn: excluding is a decision, it is
 * reversible, and a decision that removes its own undo is a trap. A row that
 * vanishes also says nothing about whether it vanished — "did I exclude that, or
 * is it gone?" is a question the tree should never provoke.
 *
 * The built-in list is the opposite case. It is not the reviewer's decision,
 * there are a dozen of its names in a typical repository, and drawing `.git`,
 * `node_modules`, `out` and `dist` in every tree is the noise spec 02 §4.2
 * removed. So it stays behind this flag — findable, not permanent furniture.
 */
export interface ScanOptions {
  reveal?: boolean;
}

export function scanWorkspace(db: Db, root: string, options: ScanOptions = {}): WorkspaceTree {
  const counts = commentCountsByDocument(db);
  const rules = workspaceRules(db, root);
  const reveal = options.reveal === true;
  const excluded: string[] = [];
  let remaining = MAX_ENTRIES;
  let truncated = false;

  /**
   * §3.1 — an exact rule beats the built-in list, and the built-in list is by
   * directory name at any depth, exactly as it was before rules existed.
   */
  const exclusionOf = (path: string, name: string, isDirectory: boolean): Exclusion | null => {
    const rule = rules.get(path);
    if (rule === "exclude") return "user";
    if (rule === "include") return null;
    return isDirectory && SKIP_DIRECTORIES.has(name) ? "default" : null;
  };

  const walk = (directory: string, depth: number): TreeEntry[] => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return [];
    }

    const entries: TreeEntry[] = [];
    for (const entry of readEntries(directory)) {
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const path = join(directory, entry.name);
      const isDirectory = entry.isDirectory();
      if (!isDirectory && !entry.isFile()) continue;

      const exclusion = exclusionOf(path, entry.name, isDirectory);
      if (exclusion !== null) {
        // "Ask all" needs the paths whether or not the row is drawn. A rule
        // inside an already-pruned subtree is never reached, and does not need
        // to be — the ancestor listed here covers every path beneath it.
        if (exclusion === "user") excluded.push(path);
        // A default skip is behind the flag; the reviewer's own rule never is.
        if (exclusion === "default" && !reveal) continue;
        remaining--;
        const document = !isDirectory && isDocumentPath(path);
        entries.push({
          name: entry.name,
          path,
          kind: isDirectory ? "directory" : document ? "document" : "other",
          // Never walked, in either case. Revealing `node_modules` must cost one
          // row, not the whole entry budget and a tree nobody can read — and an
          // excluded folder that could be opened up would be excluded in name
          // only, since the walk is the whole cost.
          children: [],
          // §3.3 — excluding narrows what REX looks at, never what it holds, so
          // an excluded document still says how many comments are on it. That is
          // the number somebody needs to judge whether the exclusion was right.
          // A folder honestly cannot say: its subtree was not walked.
          comments: document ? (counts.get(path) ?? null) : null,
          disabledReason: null,
          exclusion,
        });
        continue;
      }

      if (isDirectory) {
        remaining--;
        entries.push({
          name: entry.name,
          path,
          kind: "directory",
          children: walk(path, depth + 1),
          comments: null,
          disabledReason: null,
          exclusion: null,
        });
        continue;
      }

      remaining--;
      const document = isDocumentPath(path);
      entries.push({
        name: entry.name,
        path,
        kind: document ? "document" : "other",
        children: [],
        // §4.3 — null means "REX has never seen this file", which is not the
        // same as a document with zero comments, and the tree must not blur it.
        comments: document ? (counts.get(path) ?? null) : null,
        disabledReason: document ? null : unopenableReason(path),
        exclusion: null,
      });
    }

    return entries.sort(byKindThenName);
  };

  return { root, entries: walk(root, 0), truncated, excluded };
}

/** Every document path in the tree, depth first — what the graph starts from. */
export function documentPaths(tree: WorkspaceTree): string[] {
  const paths: string[] = [];
  const visit = (entries: TreeEntry[]): void => {
    for (const entry of entries) {
      // A revealed row is shown so it can be un-excluded, never so it can be
      // acted on. The graph asks this question of a scan that reveals nothing,
      // so the guard costs a comparison and closes the case where it does not.
      if (entry.exclusion !== null) continue;
      if (entry.kind === "document") paths.push(entry.path);
      else if (entry.kind === "directory") visit(entry.children);
    }
  };
  visit(tree.entries);
  return paths;
}
