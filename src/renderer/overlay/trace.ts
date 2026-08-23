// Spec 08 §6.5 — the trace's own view of a thread's messages.
//
// The card keeps `conversation()`, which filters to `text` and `error`; that
// filter is not a bug to fix but the rule that makes the answer outrank the
// machinery in the one column where it matters most. This is the second
// selector beside it, and it throws nothing away.
//
// `thinking`, `diff` and `completed` have been written to the database since
// spec 01 and drawn nowhere. Thinking is drawn HERE and nowhere else.

import type { Message, ThreadWithMessages } from "../../shared/types.ts";

export type TraceKind =
  | "you"
  | "thinking"
  | "tool"
  | "denied"
  | "answer"
  | "note"
  | "diff"
  | "error";

export interface TraceEntry {
  id: string;
  kind: TraceKind;
  /** The word in the block's corner: YOU, BASH, DENIED, ANSWER. */
  label: string;
  /** The prose, or — for a tool — the one argument worth showing. */
  body: string;
  /**
   * REX's own sentence about this step, above the mono line rather than
   * folded into it. Only a refusal has one: the gate's reason is prose, it is
   * the whole safety story of the read profile in one line, and it has to be
   * readable without unfolding anything.
   */
  reason: string | null;
  /** A tool's own output. Collapsed until the answer looks wrong. */
  result: string | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Input + output, for the blocks that spend them. Null where none were. */
  tokens: number | null;
  /** When it happened — what a block with no duration shows instead. */
  at: string;
}

/**
 * The argument that matters for this tool: the command for Bash, the path for
 * Read, the pattern for Grep. Falling back to the whole input is deliberate —
 * a tool REX has never seen still shows what it was given.
 */
export function argumentOf(message: Message): string {
  const input = (message.toolInput ?? {}) as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "path", "url", "prompt", "query"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return Object.keys(input).length > 0 ? JSON.stringify(input) : "";
}

/** How much output a collapsed result is hiding. Counted, never summarised. */
export function resultSummary(result: string): string {
  const lines = result.split("\n").length;
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

function entry(message: Message, kind: TraceKind, label: string, body: string): TraceEntry {
  const tokens = (message.inputTokens ?? 0) + (message.outputTokens ?? 0);
  return {
    id: message.id,
    kind,
    label,
    body,
    reason: null,
    result: null,
    durationMs: message.durationMs,
    costUsd: message.costUsd,
    tokens: tokens > 0 ? tokens : null,
    at: message.createdAt,
  };
}

/**
 * Every message, in `seq` order, as blocks.
 *
 * A tool RESULT is never a block of its own — it belongs to the call above it,
 * the same rule the card's step strip follows. Two rows for one call is how the
 * strip came to draw one more bar than there were calls.
 */
export function traceOf(thread: ThreadWithMessages): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const messages = [...thread.messages].sort((a, b) => a.seq - b.seq);

  for (const message of messages) {
    switch (message.kind) {
      case "text": {
        if (!message.content) break;
        const kind =
          message.role === "user" ? "you" : message.role === "system" ? "note" : "answer";
        const label = kind === "you" ? "YOU" : kind === "note" ? "NOTE" : "ANSWER";
        entries.push(entry(message, kind, label, message.content));
        break;
      }

      case "thinking":
        if (message.content) entries.push(entry(message, "thinking", "THINKING", message.content));
        break;

      case "tool_call":
        entries.push(
          entry(message, "tool", (message.toolName ?? "tool").toUpperCase(), argumentOf(message)),
        );
        break;

      case "tool_result": {
        // The call it answers is the most recent one still waiting. Matching on
        // `toolName` would be wrong: a result does not always carry one.
        const call = entries.findLast(
          (candidate) => candidate.kind === "tool" && candidate.result === null,
        );
        if (!call) break;
        if (message.isError) {
          call.kind = "denied";
          call.label = "DENIED";
          // The gate's own words, promoted out of the collapsed result: a
          // refusal nobody unfolds is a refusal nobody reads, and the block
          // opens itself for the same reason.
          call.reason = message.content;
        } else {
          call.result = message.content;
        }
        break;
      }

      case "diff":
        if (message.content) entries.push(entry(message, "diff", "DIFF", message.content));
        break;

      case "error":
        if (message.content) entries.push(entry(message, "error", "ERROR", message.content));
        break;

      // A lifecycle marker carrying a word, not a step. Its totals are already
      // in the sheet's head and in the card's meta strip.
      case "completed":
        break;
    }
  }
  return entries;
}

export interface ThreadTotals {
  steps: number;
  denied: number;
  durationMs: number;
  costUsd: number;
}

/**
 * What a thread cost, counted once.
 *
 * The card's meta strip and the trace sheet's head both say this, and they must
 * agree — a sheet that reports different numbers from the card that opened it
 * is worse than a sheet that reports none.
 *
 * Counted from the MESSAGES, never from the blocks the sheet draws: a
 * `completed` message carries duration and cost and is drawn nowhere, so
 * summing the blocks reported a run that took no time and cost nothing.
 * Measured on 2026-08-22.
 */
export function totalsOf(thread: ThreadWithMessages): ThreadTotals {
  return {
    steps: thread.messages.filter((m) => m.kind === "tool_call").length,
    denied: thread.messages.filter((m) => m.kind === "tool_result" && m.isError).length,
    durationMs: thread.messages.reduce((total, m) => total + (m.durationMs ?? 0), 0),
    costUsd: thread.messages.reduce((total, m) => total + (m.costUsd ?? 0), 0),
  };
}
