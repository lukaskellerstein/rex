// What a run cost, counted once — for both processes.
//
// Three places now say this number: the comment card's meta strip, the trace
// sheet's head, and the debug report a reviewer pastes into a bug report. Spec
// 08 §6.2's rule is that they must agree — a sheet that reports different
// numbers from the card that opened it is worse than a sheet that reports none —
// and a report that disagrees with the sheet it was copied from is worse again,
// because by then nobody can check it.
//
// Counted from the MESSAGES, never from the blocks a view draws: a `completed`
// message carries duration and cost and is drawn nowhere, so summing the blocks
// reported a run that took no time and cost nothing. Measured on 2026-08-22.
//
// No DOM, no database, no Electron: `node --test` imports this directly.

import type { Message } from "./types.ts";

export interface ThreadTotals {
  steps: number;
  /** Calls the gate refused. */
  denied: number;
  /**
   * Calls that ran and failed. Counted apart from `denied`, and the split is
   * the whole reason this pair exists: both were `denied` until 2026-09-01, so
   * a run whose only trouble was a `grep` exiting 1 reported "2 denied" and read
   * as the safety gate firing twice.
   */
  failed: number;
  durationMs: number;
  costUsd: number;
}

export function totalsOf(messages: readonly Message[]): ThreadTotals {
  return {
    steps: messages.filter((m) => m.kind === "tool_call").length,
    denied: messages.filter((m) => m.kind === "tool_result" && m.denied).length,
    failed: messages.filter((m) => m.kind === "tool_result" && m.isError && !m.denied).length,
    durationMs: messages.reduce((total, m) => total + (m.durationMs ?? 0), 0),
    costUsd: messages.reduce((total, m) => total + (m.costUsd ?? 0), 0),
  };
}

// ── What ONE answer cost ────────────────────────────────────
// The reviewer's ask, 2026-09-04: *"I would like to show in the answer how long
// it took to answer me: the time difference in seconds between when I am
// sending a prompt and when I am getting the answer."* And beside it, the price
// and the number of steps.
//
// `totalsOf` above cannot answer that. It sums a whole comment, and a comment is
// often five sends over a week. These are the same three facts per RUN.

/** What one run — one send and everything it produced — spent. */
export interface RunStats {
  /**
   * Wall clock: the reviewer's send to the run's last message.
   *
   * NOT the SDK's own `durationMs`, which is on the `completed` row and is
   * always the smaller number — it starts when the SDK is called and stops when
   * it returns, so REX's own work around it is missing. Measured on the
   * reviewer's own database, 2026-09-04: a run the SDK reported as 26,536ms took
   * 27,371ms from the send. The larger number is the one the reviewer waited,
   * and it is the one they asked for.
   */
  elapsedMs: number;
  /**
   * What the run reported it cost, in dollars.
   *
   * **Zero is the ordinary answer, not a missing one.** A local model behind a
   * gateway bills nothing and reports nothing, so `cost_usd` is null on every
   * row of such a run; the reviewer asked for `$0` there rather than a blank
   * (2026-09-04). Only the official endpoint has ever filled this column.
   */
  costUsd: number;
  /** Tool calls the run made. */
  steps: number;
}

/**
 * Each run's stats, keyed by the id of the last message a view DRAWS for it.
 *
 * The key is what makes one map serve both the chat card and the trace sheet.
 * The card merges an answer's several `text` rows into one turn and the sheet
 * keeps them apart, so no shape they share could be the key — but both draw the
 * run's **final** message, and both know its id.
 *
 * That message is the last answer the agent wrote. A run that produced no answer
 * is keyed on its error or its stop instead, because those are drawn too and
 * "it failed after twelve minutes" is worth more than "it failed".
 *
 * The `completed` row is never the key: it carries the SDK's numbers and is
 * drawn nowhere, which is the whole reason this function exists.
 */
export function runStatsOf(messages: readonly Message[]): Map<string, RunStats> {
  const stats = new Map<string, RunStats>();
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);

  let startedAt: number | null = null;
  let costUsd = 0;
  let steps = 0;
  let drawn: string | null = null;

  for (const message of ordered) {
    // A send starts the run, and starting one throws away any run still open.
    // Two sends with no answer between them mean the first produced nothing, so
    // it has no honest elapsed time — and the reviewer's question is about the
    // send they are still waiting on.
    if (message.role === "user" && message.kind === "text") {
      startedAt = Date.parse(message.createdAt);
      costUsd = 0;
      steps = 0;
      drawn = null;
      continue;
    }
    if (startedAt === null || Number.isNaN(startedAt)) continue;

    costUsd += message.costUsd ?? 0;
    if (message.kind === "tool_call") steps += 1;
    if (message.role === "assistant" && message.kind === "text" && message.content) {
      drawn = message.id;
    }

    // `completed` is the ordinary end. `error` and `stopped` are ends too, and
    // unlike `completed` they are on the screen, so they can carry the numbers
    // themselves when nothing was answered.
    if (message.kind !== "completed" && message.kind !== "error" && message.kind !== "stopped") {
      continue;
    }
    const endedAt = Date.parse(message.createdAt);
    const key = drawn ?? (message.kind === "completed" ? null : message.id);
    if (key !== null && !Number.isNaN(endedAt)) {
      stats.set(key, { elapsedMs: Math.max(0, endedAt - startedAt), costUsd, steps });
    }
    startedAt = null;
    drawn = null;
  }
  return stats;
}

/**
 * How long something took, in the unit a person would say it in.
 *
 * One formatter for the whole app. There were three — `27.4s` then `2m` on the
 * card and in the trace head, `2:03` in the running clock — and they disagreed
 * about every run over a minute, which is exactly the run somebody is measuring.
 * `2m` also threw away the seconds, and a local model's turn is often minutes.
 */
export function spentText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${Math.max(0, ms / 1000).toFixed(1)}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  const minutes = Math.floor((total % 3600) / 60);
  return `${Math.floor(total / 3600)}h ${String(minutes).padStart(2, "0")}m`;
}

/** A price, always three decimals, so a column of them lines up. */
export function costText(usd: number): string {
  return `$${usd.toFixed(3)}`;
}

/** `1 step`, `4 steps` — and `0 steps`, which is what an answer with no tools is. */
export function stepsText(steps: number): string {
  return `${steps} step${steps === 1 ? "" : "s"}`;
}
