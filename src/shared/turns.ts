// Spec 55 §2 — what one turn is, counted once, for both processes.
//
// Spec 51 built turns in the renderer, inside `trace.ts`, because only the
// renderer drew them. Spec 55 gives main a report about the same turn, and main
// may not import a renderer file — so the part that is arithmetic over
// `message` rows moves here and the part that is blocks on a screen stays
// there.
//
// The split is the one `totals.ts` already makes, for the same reason it makes
// it: a report that disagrees with the screen it was copied from is worse than
// no report, because by then nobody can check it. Spec 08 §6.2.
//
// Counted from the MESSAGES and never from the blocks a view draws. A
// `completed` row carries the duration, the cost and the tokens and is drawn
// nowhere, so a count over blocks reports a run that took no time.
//
// No DOM, no database, no Electron: `node --test` imports this directly.

import type { AgentSdk } from "./agent-protocol.ts";
import type { Message, SendMode } from "./types.ts";

/**
 * One turn — one Ask or one Apply — as facts rather than as blocks.
 *
 * **A turn is `message.run_id` and nothing else** (spec 51 §5.2). Not a time
 * window and not "from one user message to the next": both are guesses that
 * look exactly as confident as the truth, and the id is on the row.
 */
export interface TurnFacts {
  /** `message.run_id`, or null for the rows written before it existed. */
  runId: string | null;
  /** 1-based, oldest first, so "Turn 4" means the fourth thing this chat did. */
  number: number;
  /** The mode the reviewer sent it in — the pill, from their own message. */
  mode: SendMode | null;
  /** The four "who answered" facts, from the newest row that names each. */
  sdk: AgentSdk | null;
  gatewayName: string | null;
  baseUrl: string | null;
  model: string | null;
  style: string | null;
  /**
   * The run's first row and its last.
   *
   * Spec 55 §6 rule 3 — the last row and not the last *drawn* row. A run ends
   * with `completed`, which no view draws, and timing to the final block
   * reported an end before the run had one. `runStatsOf` has always ended the
   * elapsed clock there, so this makes two numbers agree rather than moving one.
   */
  startedAt: string;
  endedAt: string;
  /** What the run reported it spent. Null is "nobody reported one" (spec 43 §8.1). */
  costUsd: number | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCalls: number;
  /** Calls that were refused or failed — the mark that turns a row red. */
  failed: number;
  /** How many `message` rows the run wrote. What `READ` will find. */
  messages: number;
}

/** The newest non-null value of one field, down a run's rows. */
function newest<K extends keyof Message>(messages: readonly Message[], key: K): Message[K] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index]?.[key];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** A sum that stays null when nothing reported a number, never a zero nobody claimed. */
function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) if (value !== null) total = (total ?? 0) + value;
  return total;
}

/**
 * Every turn in this chat, oldest first.
 *
 * Rows with no `run_id` collect into one turn with `runId: null`. They are the
 * rows written before spec 51 and they are reported, not hidden — a chat from
 * last week has real machinery in it, and dropping it would say REX had never
 * run. Its number is 0, because it is not the first turn of anything: it is
 * every turn nobody recorded, together.
 */
export function turnFactsOf(messages: readonly Message[]): TurnFacts[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  const byRun = new Map<string | null, Message[]>();
  for (const message of ordered) {
    // `?? null` because this is a Map KEY: an `undefined` would make a second
    // "no turn" group beside the null one, and two groups for one absence draw
    // as two turns that never happened.
    const runId = message.runId ?? null;
    const list = byRun.get(runId) ?? [];
    list.push(message);
    byRun.set(runId, list);
  }

  let number = 0;
  const turns: TurnFacts[] = [];
  for (const [runId, list] of byRun) {
    if (runId !== null) number += 1;
    turns.push({
      runId,
      number: runId === null ? 0 : number,
      // The reviewer's own send is the only row that carries a mode.
      mode: list.find((message) => message.role === "user" && message.mode)?.mode ?? null,
      sdk: newest(list, "sdk"),
      gatewayName: newest(list, "gatewayName"),
      baseUrl: newest(list, "baseUrl"),
      model: newest(list, "model"),
      style: newest(list, "style"),
      startedAt: list[0]?.createdAt ?? "",
      endedAt: list.at(-1)?.createdAt ?? "",
      costUsd: sumOrNull(list.map((message) => message.costUsd)),
      durationMs: list.reduce((total, message) => total + (message.durationMs ?? 0), 0),
      inputTokens: sumOrNull(list.map((message) => message.inputTokens)),
      outputTokens: sumOrNull(list.map((message) => message.outputTokens)),
      toolCalls: list.filter((message) => message.kind === "tool_call").length,
      // Both halves, as `totalsOf` counts them: the gate's refusals and the
      // calls that ran and failed. They are one number here because a row that
      // did not do its job is one mark on a turn either way; the report tells
      // them apart under two headings, because they send a reader to different
      // places.
      failed: list.filter(
        (message) => message.kind === "tool_result" && (message.denied || message.isError),
      ).length,
      messages: list.length,
    });
  }
  return turns;
}
