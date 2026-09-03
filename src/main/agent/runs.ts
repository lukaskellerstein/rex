// Spec 17 §2.1 — the runs that are in flight right now, so one can be stopped.
//
// A module-level map and not a field on anything, for the same reason
// `pendingRenders` in `ipc.ts` is one: it belongs to the process, nothing in it
// survives a restart, and a run that outlives its window is not a thing REX has.
//
// Spec 34 §5 — and the documents each run holds. A run is pointed at a
// document's working copy by its prompt, and while it runs nobody may replace
// that copy's content under it: approve, discard and undo ask here first.

/**
 * A **set** per thread, not one controller.
 *
 * A thread can have more than one run alive at once: `startApply` runs an agent
 * per repository (spec 01 §8.7), and "Ask all" can be firing while the reviewer
 * opens one comment and sends a reply. Stop means stop *this comment's* work,
 * all of it.
 */
const inFlight = new Map<string, Set<AbortController>>();

/** Spec 34 §5.1 — the documents each run was pointed at, released with it. */
const holdsOf = new Map<AbortController, readonly string[]>();

/**
 * Spec 34 §5.1 — how many runs hold each document. A count and not a flag,
 * because two runs on one document is the case the spec exists for.
 */
const held = new Map<string, number>();

/**
 * Registers a run and hands back the controller that stops it.
 *
 * `documentIds` are the documents the run's prompt named (spec 34 §5.1): the
 * thread's own for ASK, the "files you may edit" list for ACT.
 */
export function beginRun(threadId: string, documentIds: readonly string[] = []): AbortController {
  const controller = new AbortController();
  const existing = inFlight.get(threadId);
  if (existing) existing.add(controller);
  else inFlight.set(threadId, new Set([controller]));

  const ids = [...new Set(documentIds)];
  holdsOf.set(controller, ids);
  for (const id of ids) held.set(id, (held.get(id) ?? 0) + 1);
  return controller;
}

/**
 * Forgets a finished run. Safe to call for a run that was stopped — aborting
 * does not remove the controller, and the thread must not stay stoppable after
 * its last run has ended.
 */
export function endRun(threadId: string, controller: AbortController): void {
  for (const id of holdsOf.get(controller) ?? []) {
    const count = (held.get(id) ?? 0) - 1;
    if (count > 0) held.set(id, count);
    else held.delete(id);
  }
  holdsOf.delete(controller);

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

/** Spec 34 §5.2 — some run is pointed at this document right now. */
export function isHeld(documentId: string): boolean {
  return (held.get(documentId) ?? 0) > 0;
}

/**
 * Spec 34 §5.2 — the refusal, in the words the reviewer sees. One string, so
 * the three handlers that refuse and the button that greys out cannot drift.
 */
export const HELD_REASON =
  "An agent is working on this document. Wait for it to finish, or press Stop on its comment.";
