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
  denied: number;
  durationMs: number;
  costUsd: number;
}

export function totalsOf(messages: readonly Message[]): ThreadTotals {
  return {
    steps: messages.filter((m) => m.kind === "tool_call").length,
    denied: messages.filter((m) => m.kind === "tool_result" && m.isError).length,
    durationMs: messages.reduce((total, m) => total + (m.durationMs ?? 0), 0),
    costUsd: messages.reduce((total, m) => total + (m.costUsd ?? 0), 0),
  };
}
