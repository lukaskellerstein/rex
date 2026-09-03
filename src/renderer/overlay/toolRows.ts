// Spec 36 §3 — the tool calls between two turns, as a row of glyphs.
//
// `aside.ts` already says that tool work ends a turn: two asides with a `Read`
// between them are two blocks. So every tool call sits BETWEEN two turns, or
// after the last one, never inside one — and the rows are one more step of the
// same walk over the raw messages: the calls since the previous turn are the
// row before the next turn, and the calls since the last turn are the trailing
// row, which is what a run in progress looks like.
//
// A `.ts` module rather than a corner of `CommentCard.tsx`, so `node --test`
// can load it — plain node cannot read `.tsx`.

import type { Message } from "../../shared/types.ts";
import { argumentOf, glyphOf, type ToolGlyph } from "./trace.ts";

// `glyphOf` and `ToolGlyph` live in `trace.ts` since spec 38 §3.4 — the trace
// pairs a diff with its change through them, and this file already imports
// from there. Re-exported, so everything that learned them here still finds them.
export { glyphOf, type ToolGlyph };

export interface ToolMark {
  id: string;
  /** The tool's name — `Read`, `Bash` — or `diff` for a change REX drew. */
  name: string;
  /** The command, the path, the pattern: what hover says. */
  detail: string;
  glyph: ToolGlyph;
}

export interface ToolRows {
  /** The calls before each turn, by the id of the turn's first message. */
  before: Map<string, ToolMark[]>;
  /** The calls after the last turn — a run that is still going, or one that ended in tool work. */
  trailing: ToolMark[];
}

/**
 * `turnStarts` is the id of each turn's FIRST message — the ids `turnsOf`
 * gives its turns — and it is what a row is keyed by. A conversation message
 * that is not a turn start is a later part of a turn, and no call can sit
 * before it, because tool work would have started a new turn.
 *
 * A refused or failed call arrives as two rows, the call and its result, and
 * the result marks the most recent call not already marked — the rule
 * `stepsOf` applies, for the same reason: a result follows its own call in
 * `seq` order.
 */
export function toolRowsOf(
  messages: readonly Message[],
  turnStarts: ReadonlySet<string>,
): ToolRows {
  const before = new Map<string, ToolMark[]>();
  let pending: ToolMark[] = [];

  for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
    if (message.kind === "tool_call") {
      const name = message.toolName ?? "tool";
      pending.push({
        id: message.id,
        name,
        detail: argumentOf(message),
        glyph: glyphOf(name, false, false),
      });
      continue;
    }
    if (message.kind === "tool_result") {
      if (!message.isError) continue;
      const call = pending.findLast((mark) => mark.glyph !== "failed" && mark.glyph !== "denied");
      if (call) call.glyph = message.denied ? "denied" : "failed";
      continue;
    }
    if (message.kind === "diff") {
      // The first line of a diff message is the path it changes (`diffStep`).
      pending.push({
        id: message.id,
        name: "diff",
        detail: message.content?.split("\n", 1)[0] ?? "",
        glyph: "diff",
      });
      continue;
    }
    if (turnStarts.has(message.id)) {
      if (pending.length > 0) before.set(message.id, pending);
      pending = [];
    }
  }

  return { before, trailing: pending };
}
