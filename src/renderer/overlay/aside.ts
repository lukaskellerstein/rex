// Spec 08 §5.3, corrected — the agent speaks more than once in a run, and only
// the last of those is the answer.
//
// §5.3 says a turn is a run of consecutive messages from one voice, because the
// SDK splits ONE answer across several `text` rows and labelling each of them
// `ANSWER` printed the word three times down one reply. That rule is right for
// the case it was written for. It is wrong for this one: the agent also speaks
// BEFORE it works — "First, let me read the source material" — and the card
// filters every tool row out before it merges, so a remark and the answer that
// arrived seven tool calls later became neighbours and were printed as one
// block, under the remark's label, model and clock.
//
// Measured on 2026-09-01, thread `13a69052`: the rows are text(seq 1), then 19
// tool rows, then text(seq 20). The card drew one `ANSWER` block whose first
// paragraph was "I'll create the scenario documents" and whose second was the
// answer, 1,536px of prose down a 447px column. The reviewer read the first
// paragraph, found the answer only in the trace sheet, and reported the answer
// as missing.
//
// One pass over the RAW messages — tool rows included, which is the whole point
// — answers the two questions the card and the trace sheet both have.

import type { Message, MessageKind } from "../../shared/types.ts";

/** The kinds a reader sees as speech. Everything else is machinery. */
const SPOKEN = new Set<MessageKind>(["text", "error", "stopped"]);

/**
 * Machinery that means the agent went back to work between two spoken rows.
 *
 * `thinking` is deliberately absent. It is drawn in the trace sheet and nowhere
 * else, so counting it here would split an answer into two blocks for a reason
 * the reader of the card cannot see.
 */
const WORK = new Set<MessageKind>(["tool_call", "tool_result", "diff"]);

export interface AgentText {
  /** Agent text that is not the last thing the agent said in its run. */
  asides: Set<string>;
  /** Messages that must open a new block: tool work came before them. */
  breaks: Set<string>;
}

/**
 * Which agent text is an aside, and which messages may not be merged upward.
 *
 * The rule for an aside is "the agent spoke again after working". The last
 * thing it says before the reviewer, before one of REX's own notices, or at the
 * end of the thread is the answer — including in a run that failed or was
 * stopped, where a remark is the only answer there is.
 */
export function agentText(messages: Message[]): AgentText {
  const asides = new Set<string>();
  const breaks = new Set<string>();
  /** Ids of the agent block being built. Empty when the agent is not speaking. */
  let block: string[] = [];
  let worked = false;

  for (const message of messages) {
    if (!SPOKEN.has(message.kind) || !message.content) {
      if (WORK.has(message.kind)) worked = true;
      continue;
    }

    const agent = message.role === "assistant";
    if (worked) breaks.add(message.id);

    if (agent && block.length > 0 && !worked) {
      // The SDK split one answer across several rows. Same block, as §5.3 says.
      block.push(message.id);
    } else {
      // The agent starting again is what makes everything above it an aside.
      // Any other voice ends the block without demoting it.
      if (agent) for (const id of block) asides.add(id);
      block = agent ? [message.id] : [];
    }
    worked = false;
  }

  return { asides, breaks };
}
