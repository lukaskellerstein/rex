// Spec 28 §4.2 — a search across the workspace, in main.
//
// The renderer names a root and a query and nothing more (invariant I2): which
// files exist, which are in the review, and what each one says are all decided
// here. The list of documents is the tree's own — the same scan, the same
// exclusions (spec 10 §3), the same skip list — so a file the explorer would
// not draw is a file the search does not read.

import {
  CONTEXT_CHARS,
  contextOf,
  findMatches,
  MAX_HITS_PER_FILE,
  MAX_HITS_TOTAL,
  MAX_PAGE_MATCHES,
  normaliseQuery,
} from "../../shared/find.ts";
import type { SearchFileHits, SearchSkipped, WorkspaceSearchResult } from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import { currentPath, pendingCopy } from "../work.ts";
import { documentPaths, scanWorkspace } from "../workspace/tree.ts";
import { documentText } from "./text.ts";

export async function searchWorkspace(
  db: Db,
  root: string,
  query: string,
): Promise<WorkspaceSearchResult> {
  const needle = normaliseQuery(query);
  const tree = scanWorkspace(db, root);
  const result: WorkspaceSearchResult = {
    query: needle,
    files: [],
    skipped: [],
    searched: 0,
    matches: 0,
    capped: false,
    truncated: tree.truncated,
  };
  if (needle.length === 0) return result;

  let kept = 0;
  for (const path of documentPaths(tree)) {
    // Spec 15 §6.1 — the version the reviewer sees is the version searched.
    // Spec 34 §4 — that is the copy while a change is pending, and the file
    // otherwise; a copy that equals the file is not consulted.
    const meta = pendingCopy(path);
    const contentPath = meta ? currentPath(meta) : path;

    let text: string;
    try {
      text = await documentText(path, contentPath);
    } catch (error) {
      result.skipped.push(skipped(path, error));
      continue;
    }
    result.searched++;

    // Every match is counted, so the summary line and the file's count are
    // true; only the ROWS are capped. A file with more than a thousand
    // matches of one query is a one-letter query, and reads `1000` here.
    const { matches } = findMatches(text, needle, MAX_PAGE_MATCHES);
    if (matches.length === 0) continue;
    result.matches += matches.length;

    const room = Math.max(0, Math.min(MAX_HITS_PER_FILE, MAX_HITS_TOTAL - kept));
    if (room < Math.min(MAX_HITS_PER_FILE, matches.length)) result.capped = true;
    const file: SearchFileHits = {
      path,
      hits: matches.slice(0, room).map((position, ordinal) => ({
        ordinal,
        ...contextOf(text, position, CONTEXT_CHARS),
      })),
      total: matches.length,
    };
    kept += file.hits.length;
    result.files.push(file);
  }
  return result;
}

function skipped(path: string, error: unknown): SearchSkipped {
  const message = error instanceof Error ? error.message : String(error);
  return { path, reason: message };
}
