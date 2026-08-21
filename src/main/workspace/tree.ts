// Spec 02 §4 — scanning a workspace into a tree.
//
// A workspace can be a whole repository, so this refuses to scan forever, and
// when it stops early it says so. A silently truncated tree reads exactly like
// a complete one, and a reviewer who cannot see a file assumes it is not there.

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TreeEntry, WorkspaceTree } from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import { commentCountsByDocument } from "../db/queries.ts";
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

export function scanWorkspace(db: Db, root: string): WorkspaceTree {
  const counts = commentCountsByDocument(db);
  let remaining = MAX_ENTRIES;
  let truncated = false;

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

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        remaining--;
        entries.push({
          name: entry.name,
          path,
          kind: "directory",
          children: walk(path, depth + 1),
          comments: null,
          disabledReason: null,
        });
        continue;
      }

      if (!entry.isFile()) continue;

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
      });
    }

    return entries.sort(byKindThenName);
  };

  return { root, entries: walk(root, 0), truncated };
}

/** Every document path in the tree, depth first — what the graph starts from. */
export function documentPaths(tree: WorkspaceTree): string[] {
  const paths: string[] = [];
  const visit = (entries: TreeEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind === "document") paths.push(entry.path);
      else if (entry.kind === "directory") visit(entry.children);
    }
  };
  visit(tree.entries);
  return paths;
}
