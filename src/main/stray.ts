// Spec 15 §4.3, spec 21 §2 and spec 22 §3 — the files a run wrote outside its
// own list.
//
// Split out of `apply.ts` so it can be tested against real files and a real
// repository: `apply.ts` reaches the Agent SDK and therefore `electron`, which
// a `node --test` process cannot load. That is not a technicality here. This
// module is where REX decides whether to delete one of the reviewer's files,
// and a decision of that weight should be provable without launching an app.

import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { isTracked, revert } from "./git.ts";
import {
  adoptWorkingCopy,
  type BeforeSet,
  movedSince,
  restoreFromBeforeSet,
  stashFound,
  type WorkingMeta,
  workRoot,
} from "./work.ts";
import { classifyStray } from "./workspace/created.ts";

/** Spec 21 §4.2 — what a run did with the files it wrote outside its list. */
export interface StrayFiles {
  /** Spec 15 §4.3 — modified, and put back. */
  restored: string[];
  /** Spec 21 §2 — created, and kept where the agent wrote it. */
  created: string[];
  /**
   * Spec 21 §13 — written into REX's own store, where nothing shows it.
   *
   * Absolute, unlike the other two: the path is not under `root`, and it is the
   * only way back to the bytes. REX neither deletes nor moves these — it says
   * where they are and lets the reviewer decide.
   */
  misplaced: string[];
  /**
   * Spec 22 §3 — text documents under the workspace root the agent edited, now
   * held as working copies. The disk holds the reviewer's bytes again; the
   * agent's are in `.new`, as one revision of this run.
   */
  adopted: WorkingMeta[];
}

export interface StrayInput {
  applyRunId: string;
  /** Spec 22 §3 step 4 — the revision an adopted file records belongs to this thread. */
  threadId: string;
  /** The repository the run wrote in — what the reported names are relative to. */
  root: string;
  /** Spec 21 §3 — the open workspace. Null keeps nothing. */
  workspaceRoot: string | null;
  beforeSet: BeforeSet;
  /** Every path a write tool named, exactly (spec 15 §4.3, first source). */
  wrote: ReadonlySet<string>;
  /** The working copies this run was allowed to edit. */
  allowed: ReadonlySet<string>;
  /**
   * Spec 22 §3 step 2 — the document row for a file this run adopts, made on
   * demand. A callback because this module stays clear of SQLite (see the head
   * of the file), and the id is the one thing about a working copy that only
   * the database can give. Called only when there is a real change to hold.
   */
  documentIdFor: (path: string) => string;
}

/**
 * Spec 22 §3 step 1 — the reviewer's bytes back on disk, from whichever of the
 * two sources has them. Nothing is stashed: the agent's version is not being
 * thrown away, the caller has it and is about to keep it.
 */
function restoreOriginal(set: BeforeSet, root: string, path: string): boolean {
  const bytes = set.contents.get(path);
  try {
    if (bytes !== undefined) writeFileSync(path, bytes);
    else revert(root, [relative(root, path)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spec 15 §4.3 and spec 21 §2 — every file the agent wrote outside its list,
 * sorted into the acts that need different answers.
 *
 * Two sources for finding them, because neither is complete on its own. `wrote`
 * is exact but blind to `Bash` — the write profile allows it (spec 11 §6.4.4),
 * so `sed -i` is a write no tool call names. The before-set catches those by
 * content, but only for paths git listed.
 *
 * **Then the classification, which is the part that has to be right.** A
 * modification destroys bytes the reviewer had, so it is put back. A creation
 * destroys nothing, so it is kept and shown (spec 21 §1.1). Getting it backwards
 * is a fault in either direction: keeping a modification hides a change nobody
 * agreed to, and "putting back" a creation is a delete.
 *
 * Spec 21 §2.3 — "did it exist when the run started" is asked of two sources,
 * because the before-set alone answers it wrongly for the commonest case in any
 * repository. It holds what `git status` reported plus the run's targets, so
 * every **tracked, clean** file is missing from it and would read as new.
 *
 * Spec 21 §13 — a write into REX's own store is a third act. It is neither put
 * back nor kept, because both of those are wrong for it: there is nothing to
 * restore and nowhere for it to show. It is reported, and that is the whole
 * remedy — the reviewer is told where the bytes are.
 *
 * Spec 22 §3 — a modification of a text document under the workspace root is
 * the fourth act, and the one that stops being a loss: the original goes back
 * on disk, and the agent's version becomes a working copy the two panes can
 * draw. Same sources, same order, one more destination.
 */
export function putBack(input: StrayInput): StrayFiles {
  const { applyRunId, threadId, root, workspaceRoot, beforeSet, wrote, allowed } = input;
  const store = `${workRoot()}/`;
  const suspects = new Set<string>();
  for (const path of wrote) if (!allowed.has(path)) suspects.add(path);
  for (const path of beforeSet.contents.keys()) {
    if (!allowed.has(path) && movedSince(beforeSet, path)) suspects.add(path);
  }

  const stray: StrayFiles = { restored: [], created: [], misplaced: [], adopted: [] };
  for (const path of suspects) {
    // Never REX's own store. A stray write to a working copy's `base` would be
    // "restored" by deleting it, and `base` is the only copy of the reviewer's
    // original bytes — the one file in this design that must never be lost.
    //
    // Spec 21 §13 — but not silent either. Nothing in the store reaches the
    // reviewer: the tree does not draw it and no notice named it, so a run that
    // wrote its whole answer here ended with "Applied to 0 file(s)" and 9.5 KB
    // nobody could find. Reported, still not touched.
    if (path.startsWith(store)) {
      stray.misplaced.push(path);
      continue;
    }
    // A path the agent named but never changed is not a write. It happens: an
    // Edit that fails leaves the tool call in the transcript and the file alone.
    if (beforeSet.contents.has(path) && !movedSince(beforeSet, path)) continue;
    const name = relative(root, path) || path;
    const inBeforeSet = beforeSet.contents.has(path);

    switch (
      classifyStray({
        path,
        inBeforeSet,
        // Only asked when it has to be: `git ls-files` is a process, and the
        // before-set already answers for every path it holds.
        tracked: inBeforeSet ? false : isTracked(root, path),
        workspaceRoot,
      })
    ) {
      case "restore-bytes":
        if (restoreFromBeforeSet(beforeSet, path, applyRunId)) stray.restored.push(name);
        break;

      case "restore-git":
        // Spec 21 §2.3 — the branch spec 15 §4.3 always described and the code
        // never had. Without it a tracked, clean file the agent touched was
        // DELETED: "no bytes in the before-set" was read as "it was never
        // there", and the restore for that is `rmSync`.
        stashFound(applyRunId, path);
        try {
          revert(root, [relative(root, path)]);
        } catch {
          // A submodule boundary, or a permission. Reported either way: the
          // reviewer can see what moved, and REX guessing further here would be
          // the destructive option.
        }
        stray.restored.push(name);
        break;

      case "keep":
        stray.created.push(name);
        break;

      case "delete":
        // Created somewhere nothing would ever show it — outside the workspace,
        // or under a directory the tree does not draw. Removing it is the
        // restore, and `restoreFromBeforeSet` stashes it on the way out.
        if (restoreFromBeforeSet(beforeSet, path, applyRunId)) stray.restored.push(name);
        break;

      case "adopt": {
        // Spec 22 §3 — the agent's bytes first, because the restore is about to
        // replace them; then the original back on disk; then the fork, which
        // takes the disk as `base` and is therefore honest only in this order.
        const agentBytes = readFileSync(path);
        if (!restoreOriginal(beforeSet, root, path)) {
          // Nothing honest to fork from: a copy made now would call the agent's
          // bytes the original. Left as written and said in the log, which is
          // what the other restore branches do with the same failure.
          console.warn(`[rex] could not put ${name} back, so it was not adopted`);
          break;
        }
        // A tracked, clean file the agent named and wrote unchanged is a
        // suspect from `wrote` alone — the before-set never held it, so the
        // "never changed" test above could not exclude it. No change, no copy,
        // and no document row for a file nothing happened to.
        if (agentBytes.equals(readFileSync(path))) break;
        stray.adopted.push(
          adoptWorkingCopy(input.documentIdFor(path), path, agentBytes, { applyRunId, threadId }),
        );
        break;
      }
    }
  }
  return stray;
}
