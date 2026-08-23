// Spec 07 §8.5 and §9 — the queries behind `facts:status`, `facts:findings` and
// `facts:graph`. MAIN (§10.2).
//
// Main only ever reads the fact tables; the `utilityProcess` is the only writer
// (§10.1). WAL exists for exactly this shape, so a reader never blocks the
// writer and the findings list stays scrollable while a build runs — which §8.5
// requires: "a build is not a modal state".

import { statSync } from "node:fs";
import type {
  FactGraph,
  FactRunSummary,
  Finding,
  FindingFilter,
  WorkspaceTree,
} from "../../shared/types.ts";
import { type Db, vectorSearchStatus } from "../db/database.ts";
import { isDocumentPath, isFactReadablePath } from "../render/formats.ts";
import { documentPaths } from "../workspace/tree.ts";
import { gatewayBuildBlockedReason } from "./gateway.ts";
import { documentExtractedAt, latestRun, listFindings, readGraph } from "./store.ts";
import { currentBuild } from "./supervisor.ts";

/**
 * §8.5 — the five states of the Facts tab, decided in one place.
 *
 * Clicking the tab is the trigger and nothing else is; opening a workspace never
 * starts a build. Only two of these five states build, and the dividing line is
 * whether a previous build exists — because that is exactly what separates the
 * incremental path (seconds) from the first one (up to three days, §7.3).
 */
export type FactsState =
  | "unavailable"
  | "never-built"
  | "up-to-date"
  | "stale"
  | "running"
  | "interrupted";

export interface FactsStatus {
  state: FactsState;
  /** Null until a build has been started for this workspace. */
  run: FactRunSummary | null;
  /** How many documents the pipeline can read. Drives the §7.3 estimate shown. */
  documentCount: number;
  /**
   * §8.5 — "the changed count comes from stage 0". Null while it has not been
   * computed, because hashing a large tree is disk I/O and the tab must not wait
   * for it before showing the last findings.
   */
  changedCount: number | null;
  /** Why the feature cannot run here, when `state` is `unavailable`. */
  reason: string | null;
  /**
   * §7.3 — whether a build can be started at all, and why not.
   *
   * Separate from `state` because they answer different questions. `state` is
   * about the DATA — has this workspace been read, is it stale. This is about
   * the MACHINE: the pipeline calls the local AI gateway, and a machine with no
   * key for it can still read every finding a previous build produced. Reading
   * is pure SQLite; only building needs the gateway.
   *
   * The same pair as `applyEnabled` / `applyDisabledReason` on a document, for
   * the same reason: a button that cannot work should say so before it is
   * pressed, in the words of the thing that has to be fixed.
   */
  buildEnabled: boolean;
  buildDisabledReason: string | null;
}

/**
 * Every document in the workspace the build should be *handed*.
 *
 * PDFs are included on purpose even though the pipeline cannot read them: the
 * build is what names each one as skipped in its report, and §7.4 forbids a
 * coverage limit that is not stated. Excluding them here would make them vanish
 * silently instead.
 */
export function factDocuments(tree: WorkspaceTree): string[] {
  return documentPaths(tree).filter((path) => isDocumentPath(path));
}

/**
 * The documents the build can actually turn into text — which is a different
 * question, and the one staleness must be measured over. `isFactReadablePath`
 * carries why.
 */
function readableDocuments(tree: WorkspaceTree): string[] {
  return documentPaths(tree).filter((path) => isFactReadablePath(path));
}

export function factsStatus(db: Db, root: string, tree: WorkspaceTree): FactsStatus {
  const vectors = vectorSearchStatus();
  /*
    The documents the build will actually READ, not the ones REX can render.

    These are different sets and the difference is not small: `isDocumentPath`
    includes PDF, and `isFactReadablePath` deliberately does not — §4.1 reads
    Markdown, HTML and DOCX and nothing else. Measured on 2026-08-22 against
    `documentation-sample`: seven renderable documents, five readable ones, and
    the strip said "7 documents. Reading them takes many hours" about a build
    that would never open two of them.

    That is the over-claim §7.4 and §11 rule 6 both forbid, made worse by
    `estimate()` deriving the time from the same inflated figure — and the count
    is on screen precisely when the reviewer is deciding whether to start an
    overnight job.
  */
  const documentCount = readableDocuments(tree).length;
  // Asked once, and carried into every state below: a build is blocked by the
  // machine's configuration whatever the data happens to look like.
  const blocked = gatewayBuildBlockedReason();
  const build = { buildEnabled: blocked === null, buildDisabledReason: blocked };

  if (!vectors.loaded) {
    return {
      state: "unavailable",
      run: null,
      documentCount,
      changedCount: null,
      reason:
        `sqlite-vec did not load on this machine, so claims cannot be compared. ${vectors.reason ?? ""}`.trim(),
      ...build,
    };
  }

  const run = latestRun(db, root);
  const active = currentBuild();

  if (active && active.root === root) {
    return { state: "running", run, documentCount, changedCount: null, reason: null, ...build };
  }
  if (!run) {
    return {
      state: "never-built",
      run: null,
      documentCount,
      changedCount: null,
      reason: null,
      ...build,
    };
  }
  if (run.state === "running" || run.state === "failed") {
    // `running` with no process is a build that died with the app; both offer
    // Resume, with the cursor intact (§10.1 rule 3).
    return { state: "interrupted", run, documentCount, changedCount: null, reason: null, ...build };
  }

  // `done` or `cancelled`. §8.5 — "the changed count comes from stage 0".
  //
  // Not literally: stage 0's hash is of the **rendered text** (§4.1), so
  // computing it here would mean running markdown-it over every document in the
  // tree on the thread that draws the window — tens of seconds on a large
  // workspace, to decide what a button should say.
  //
  // A modification time answers the same question for one `stat` per file. It
  // over-reports, and that costs *almost* nothing: a document touched without
  // its text changing makes the tab offer a rebuild, and stage 0 then compares
  // the real hash, skips it, and the build finishes in seconds having called no
  // model.
  //
  // "Almost", because one kind of over-reporting is not free at all. A document
  // that can never be read is changed for ever, so §8.5's incremental path
  // rebuilds on every refresh — which is why this counts readable documents
  // only, and why `isFactReadablePath` exists.
  const changedCount = countChanged(db, root, tree);
  return {
    state: changedCount > 0 ? "stale" : "up-to-date",
    run,
    documentCount,
    changedCount,
    reason: null,
    ...build,
  };
}

/** Documents added, or modified since the build that last read them. */
function countChanged(db: Db, root: string, tree: WorkspaceTree): number {
  const seen = documentExtractedAt(db, root);
  let changed = 0;
  for (const path of readableDocuments(tree)) {
    const extractedAt = seen.get(path);
    if (extractedAt === undefined) {
      changed++;
      continue;
    }
    try {
      if (statSync(path).mtimeMs > extractedAt) changed++;
    } catch {
      // Unreadable now: stage 0 will treat it as gone and drop its evidence.
      changed++;
    }
  }
  return changed;
}

export function findings(db: Db, root: string, filter: FindingFilter): Finding[] {
  return listFindings(db, root, filter);
}

export function graph(db: Db, root: string, topicId?: number): FactGraph {
  return readGraph(db, root, topicId);
}
