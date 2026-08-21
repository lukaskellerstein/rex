// Spec 07 §10.1 — forks, kills and watches the `utilityProcess`. MAIN (§10.2).
//
// Main owns the lifecycle and forwards the worker's progress to the renderer. It
// does **not** invent progress events of its own, so what the user sees is what
// the build actually did.

import { join } from "node:path";
import { type BrowserWindow, type UtilityProcess, utilityProcess } from "electron";
import type { FactRunSummary, FactStage } from "../../shared/types.ts";
import type { Db } from "../db/database.ts";
import { gatewayKey } from "./gateway.ts";
import { createRun, failStaleRuns, finishRun, getRun } from "./store.ts";
import type { FromWorker, ToWorker } from "./worker.ts";

/** §5.1 — the three aliases, and §5.4's rule that local is the default. */
export interface BuildAliases {
  extract: string;
  judge: string;
  embed: string;
}

/**
 * §5.4 — "The default is local. REX is pointed at the user's own documents.
 * Those documents leaving the machine is a decision, not a default."
 *
 * `local-31b` and `embed` are the two terminal aliases: they have no fallback
 * chain, so a stopped LMStudio fails the build rather than quietly sending the
 * documents to OpenRouter. `local` is deliberately *not* the extract default,
 * even though §5.1 assigns it: it falls through to `cheap` when LMStudio is not
 * serving its model, which was measured happening on 2026-08-21. Spending money
 * silently on a build the user asked to keep local is the one failure this
 * setting exists to prevent.
 */
export const LOCAL_ONLY_ALIASES: BuildAliases = {
  extract: "local-31b",
  judge: "local-31b",
  embed: "embed",
};

export interface BuildProgress {
  runId: string;
  stage: FactStage;
  done: number;
  total: number;
  message: string;
}

export interface SupervisorContext {
  db: Db;
  getWindow: () => BrowserWindow | null;
  onProgress: (progress: BuildProgress) => void;
}

/**
 * §10.1 rule 4 — **one build at a time, per application**, not per workspace.
 * Two builds would contend for the same LMStudio, and §5.6's per-alias caps
 * would each be honoured while the machine saw twice the load.
 */
let running: { runId: string; root: string; child: UtilityProcess } | null = null;

/** The path `utilityProcess.fork` needs: its own entry, never bundled into main. */
function workerEntry(): string {
  return join(import.meta.dirname, "facts-worker.js");
}

export function currentBuild(): { runId: string; root: string } | null {
  return running ? { runId: running.runId, root: running.root } : null;
}

/**
 * Marks any run still labelled `running` as failed.
 *
 * Called once at startup: a row that says `running` when no process exists is a
 * build that died with the app, and leaving it would make the Facts tab attach
 * to a process that is not there. Its cursor is untouched, so §8.5 offers
 * Resume.
 */
export function reconcileRuns(db: Db): void {
  failStaleRuns(db);
}

export interface StartInput {
  root: string;
  documents: string[];
  aliases?: Partial<BuildAliases>;
  /** Resume the interrupted run with this id rather than starting a new one. */
  resumeRunId?: string;
}

export function startBuild(context: SupervisorContext, input: StartInput): FactRunSummary {
  if (running) {
    throw new Error(
      "A fact build is already running. REX runs one at a time, because two would contend for the same local model.",
    );
  }

  const aliases: BuildAliases = { ...LOCAL_ONLY_ALIASES, ...input.aliases };

  // Read before the fork, and in main: if the key is missing this must fail as a
  // clean error the tab can show, not as a process that starts and dies.
  const apiKey = gatewayKey();

  const runId =
    input.resumeRunId ??
    createRun(context.db, {
      root: input.root,
      aliasExtract: aliases.extract,
      aliasJudge: aliases.judge,
    });

  if (input.resumeRunId) {
    context.db
      .prepare("UPDATE fact_run SET state = 'running', finished_at = NULL WHERE id = ?")
      .run(input.resumeRunId);
  }

  const child = utilityProcess.fork(workerEntry(), [], {
    serviceName: "rex-facts",
    // The build reads documents and talks to localhost; it needs no window and
    // no renderer privileges.
    stdio: "inherit",
  });

  running = { runId, root: input.root, child };

  /**
   * The last thing the renderer hears about a build, whatever ended it.
   *
   * §9 gives the renderer exactly one event, `facts:progress`, so "the build is
   * over, re-read everything" has to travel on it. Without this the tab learns a
   * build finished only if it happened to end by completing its final stage — a
   * cancelled or failed one would leave the progress bar on screen for ever,
   * over findings that are now stale. It is still main forwarding what the build
   * actually did (§10.1) rather than inventing progress: `ended` is a fact.
   */
  const announceEnd = (): void => {
    const summary = getRun(context.db, runId);
    if (!summary) return;
    context.onProgress({
      runId,
      stage: summary.stage,
      done: summary.done,
      total: summary.total,
      message: "ended",
    });
  };

  child.on("message", (message: FromWorker) => {
    if (message.type === "progress") {
      context.onProgress({ runId, ...message });
      return;
    }
    if (message.type === "failed") {
      console.warn(`[rex] fact build failed in ${message.stage}: ${message.error}`);
    }
    // `done` and `failed` both end the build; the worker has already written the
    // run row's final state.
    running = null;
    announceEnd();
  });

  child.on("exit", (code) => {
    if (!running || running.runId !== runId) return;
    // §10.1 rule 3 — an unexpected exit marks the row `failed` and **leaves the
    // cursor where it was**. The user sees "interrupted" and a Resume button,
    // not a lost build.
    const summary = getRun(context.db, runId);
    if (summary?.state === "running") finishRun(context.db, runId, "failed");
    if (code !== 0) console.warn(`[rex] fact build worker exited with ${code}`);
    running = null;
    announceEnd();
  });

  const start: ToWorker = {
    type: "start",
    runId,
    root: input.root,
    documents: input.documents,
    aliases,
    apiKey,
  };
  // `postMessage` before the child has finished booting is safe: Electron queues
  // messages on the port until the child attaches its own listener.
  child.postMessage(start);

  const summary = getRun(context.db, runId);
  if (!summary) throw new Error(`the run row for ${runId} vanished`);
  return summary;
}

/** §4.7 — cancel sets a flag; the running stage finishes its call and stops. */
export function cancelBuild(runId: string): void {
  if (!running || running.runId !== runId) return;
  const cancel: ToWorker = { type: "cancel" };
  running.child.postMessage(cancel);
}

/**
 * §10.1 rule 2 — main kills the process on `before-quit`.
 *
 * A build survives the app closing in the sense that matters (§8.5): the run row
 * keeps its cursor, so reopening REX offers Resume. What must not survive is the
 * process itself, orphaned and still calling the gateway with no window to
 * report to.
 */
export function stopBuild(db: Db): void {
  if (!running) return;
  const { runId, child } = running;
  running = null;
  const summary = getRun(db, runId);
  if (summary?.state === "running") finishRun(db, runId, "failed");
  child.kill();
}
