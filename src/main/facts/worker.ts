// Spec 07 §10.1 — the `utilityProcess` entry point. WORKER (§10.2).
//
// `utilityProcess.fork()` takes a path to a built script, so this cannot be
// bundled into `out/main/index.js` — it is its own entry in
// `electron.vite.config.ts`.
//
// Why this process exists at all: stage 3 is 60,000 claims each needing two
// synchronous `sqlite-vec` scans, and `better-sqlite3` is synchronous by design.
// On the thread that draws the window that is roughly an hour of 30-millisecond
// blocks back to back — not a freeze, a stutter, which is worse because it looks
// like a bug. A `utilityProcess` is also a separate OS process, so a native
// module that crashes can be noticed and restarted rather than taking the app
// down with it.
//
// It holds a database handle and the gateway key. It holds no untrusted document
// content beyond the chunk it is working on, and it never touches the DOM —
// which is what makes the I2 widening in §2 acceptable.

import Database from "better-sqlite3";
import type { FactStage } from "../../shared/types.ts";
import { configureConnection, loadVectorExtension } from "../db/database.ts";
import { DB_PATH } from "../db/location.ts";
import { type BuildReport, runBuild } from "./build.ts";
import { Gateway } from "./gateway.ts";
import { finishRun, getRun } from "./store.ts";

/** §10.1 — the messages that cross the `MessagePort`. Not a socket. */
export type ToWorker =
  | {
      type: "start";
      runId: string;
      root: string;
      documents: string[];
      aliases: { extract: string; judge: string; embed: string };
      apiKey: string;
    }
  | { type: "cancel" };

export type FromWorker =
  | { type: "progress"; stage: FactStage; done: number; total: number; message: string }
  | { type: "done"; report: BuildReport }
  | { type: "failed"; stage: FactStage; error: string };

let cancelling = false;

function send(message: FromWorker): void {
  process.parentPort.postMessage(message);
}

/**
 * §9 — `facts:progress` fires at most once per second. Throttled here rather
 * than in main, because a build emitting an event per chunk would flood the
 * `MessagePort` for hours before main ever got the chance to drop one.
 *
 * Two kinds of event are never dropped, and both are about not lying:
 *
 *   · The LAST of a stage. A bar that stops at 39 of 40 because the final tick
 *     was throttled is a bar that looks stuck.
 *   · The FIRST of a stage, or any event whose words change. This one was
 *     missing, and it cost far more than the other. `chunk` ends at 56 of 56,
 *     which is a `done === total` event and therefore always sent — and it
 *     resets the clock. The `extract` event that follows a millisecond later is
 *     0 of 56, so it was dropped, and nothing else was sent until the first
 *     passage came back from the model six to eleven minutes later. For all
 *     that time the strip read "Splitting documents · 56 / 56" with a full bar:
 *     a stage that takes milliseconds, shown complete, while the build was
 *     actually deep in the stage that takes hours. Measured on 2026-08-22.
 *
 * Neither exception can flood. A stage changes six times in a build, and the
 * message changes once per document.
 */
function throttledProgress(): (
  stage: FactStage,
  done: number,
  total: number,
  message: string,
) => void {
  let last = 0;
  let lastStage: FactStage | null = null;
  let lastMessage: string | null = null;

  return (stage, done, total, message) => {
    const now = Date.now();
    const changed = stage !== lastStage || message !== lastMessage;
    if (!changed && done < total && now - last < 1000) return;
    last = now;
    lastStage = stage;
    lastMessage = message;
    send({ type: "progress", stage, done, total, message });
  };
}

async function start(message: Extract<ToWorker, { type: "start" }>): Promise<void> {
  const db = new Database(DB_PATH);
  configureConnection(db);
  loadVectorExtension(db);

  // Only for reporting which stage a failure happened in; §4.7's resume point
  // comes from the documents themselves, not from this row.
  const stage: FactStage = getRun(db, message.runId)?.stage ?? "scan";

  try {
    const report = await runBuild({
      db,
      gateway: new Gateway(undefined, message.apiKey),
      runId: message.runId,
      root: message.root,
      documents: message.documents,
      aliases: message.aliases,
      onProgress: throttledProgress(),
      cancelled: () => cancelling,
    });

    if (report.cancelled) finishRun(db, message.runId, "cancelled");
    send({ type: "done", report });
  } catch (error) {
    // The run row is left `failed` with its cursor intact, so §8.5 offers Resume
    // rather than losing the work.
    finishRun(db, message.runId, "failed");
    send({
      type: "failed",
      stage: getRun(db, message.runId)?.stage ?? stage,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }
}

process.parentPort.on("message", (event) => {
  const message = event.data as ToWorker;
  if (message.type === "cancel") {
    // §4.7 — cancel sets a flag; the running stage finishes its current call and
    // stops. Killing mid-call would leave the gateway holding a request that
    // still counts against its route timeout.
    cancelling = true;
    return;
  }
  void start(message);
});
