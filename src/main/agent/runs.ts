// Spec 17 §2.1 — the runs that are in flight right now, so one can be stopped.
//
// A module-level map and not a field on anything, for the same reason
// `pendingRenders` in `ipc.ts` is one: it belongs to the process, nothing in it
// survives a restart, and a run that outlives its window is not a thing REX has.

/**
 * A **set** per thread, not one controller.
 *
 * A thread can have more than one run alive at once: `startApply` runs an agent
 * per repository (spec 01 §8.7), and "Ask all" can be firing while the reviewer
 * opens one comment and sends a reply. Stop means stop *this comment's* work,
 * all of it.
 */
const inFlight = new Map<string, Set<AbortController>>();

/** Registers a run and hands back the controller that stops it. */
export function beginRun(threadId: string): AbortController {
  const controller = new AbortController();
  const existing = inFlight.get(threadId);
  if (existing) existing.add(controller);
  else inFlight.set(threadId, new Set([controller]));
  return controller;
}

/**
 * Forgets a finished run. Safe to call for a run that was stopped — aborting
 * does not remove the controller, and the thread must not stay stoppable after
 * its last run has ended.
 */
export function endRun(threadId: string, controller: AbortController): void {
  const running = inFlight.get(threadId);
  if (!running) return;
  running.delete(controller);
  if (running.size === 0) inFlight.delete(threadId);
}

/**
 * Spec 17 §3.1 — stops every run this thread has, and says how many there were.
 *
 * Zero is the answer the card needs: it means the run finished between the
 * paint and the click, which is worth a sentence rather than a button that
 * appears to do nothing.
 */
export function stopRun(threadId: string): number {
  const running = inFlight.get(threadId);
  if (!running) return 0;
  for (const controller of running) controller.abort();
  return running.size;
}
