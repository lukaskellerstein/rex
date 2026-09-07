// The line under an answer: what produced it, and what it cost.
//
// One component, drawn by the chat card and by the trace sheet. They had a copy
// each, and the copies had already drifted — the card named the gateway and the
// sheet did not — which is the reviewer's report of 2026-09-04: *"In the trace
// view I'm missing, in the answer, information about what gateway it came
// from."* A shared component is the only fix that cannot drift again.

import { costText, type RunStats, spentText, stepsText } from "../../shared/totals.ts";
import type { ModelChoice } from "../../shared/types.ts";
import { modelLabel } from "./ModelPick.tsx";

/**
 * Spec 43 §5.3 — the evidence copied onto every message the run produced.
 *
 * Null in any field means nobody recorded it: a message written before the
 * column existed, or a turn no agent was in.
 */
export interface AnswerEvidence {
  /** Spec 44 §3 — which agent answered, first on the line as it is in the row. */
  agent: string | null;
  gatewayName: string | null;
  baseUrl: string | null;
  model: string | null;
  style: string | null;
}

/** One item on the line. The key is the fact it states, so it is stable. */
interface Fact {
  key: string;
  node: React.JSX.Element;
}

/**
 * One end of the line. Empty draws nothing, so an answer with no numbers is a
 * left group alone rather than a left group and a gap.
 */
function Group({
  facts,
  className,
}: {
  facts: Fact[];
  className: string;
}): React.JSX.Element | null {
  if (facts.length === 0) return null;
  return (
    <span className={className}>
      {facts.map((fact) => (
        <span key={fact.key} className="rex-foot-fact">
          {fact.node}
        </span>
      ))}
    </span>
  );
}

/**
 * Spec 43 §13 criterion 11 — the foot names the gateway, the model and, for
 * Claude, the style; then how long the answer took, how many steps it needed and
 * what it cost.
 *
 * Two groups, one at each end of the line: **what produced this answer** on the
 * left, **what it cost** on the right. The first three are the controls in the
 * order the composer offers them, so the left half reads back the row the
 * reviewer picked; the right half is the price of it.
 *
 * The reviewer asked for the split on 2026-09-04, and it does more than tidy
 * the line up. The numbers now start at the same right edge on every answer, so
 * a column of them can be compared down the thread — which is the only reason
 * to put a duration on an answer at all. Ranged left they moved with the length
 * of whatever gateway name sat in front of them.
 *
 * **`Original` is named like any other gateway.** It was deliberately hidden
 * until 2026-09-04, reasoning that REX's own default is not a fact about a turn
 * and that a word on thousands of rows earns nothing. The reviewer overruled it:
 * *"Show the gateway name always in all the answers in the trace view and in the
 * chat."* The reasoning was wrong about what silence says. A blank where the
 * gateway goes is indistinguishable from a message written before the column
 * existed, so the reader of an old thread could not tell "this ran on the
 * subscription" from "nobody wrote it down".
 *
 * No pill and no colour on any of it. A pill in REX means the mode the reviewer
 * picked (spec 12 §7.1) and a colour means one of spec 18's seven facts, so
 * either would spend a word from a vocabulary that is already saying something
 * else. Order and brightness are the whole treatment.
 */
export function AnswerFoot({
  evidence,
  stats,
  models,
}: {
  evidence: AnswerEvidence;
  /** What this run spent, or null when the run's end was never recorded. */
  stats: RunStats | null;
  /** To turn a stored model value into the name it was picked by. */
  models: ModelChoice[];
}): React.JSX.Element | null {
  /** The left group: what produced this answer. */
  const made: Fact[] = [];
  /** The right group: what it cost. */
  const spent: Fact[] = [];

  // Spec 44 §3 — the agent, before the gateway, in the order the composer
  // offers them. Named by its label and never by its id: `codex` is a value in
  // a database column, and `Codex` is what the reviewer picked.
  if (evidence.agent) {
    made.push({
      key: "agent",
      node: (
        <span className="rex-foot-agent" title="The agent that answered">
          {evidence.agent}
        </span>
      ),
    });
  }
  if (evidence.gatewayName) {
    made.push({
      key: "gateway",
      node: (
        <span
          className="rex-foot-gateway"
          title={
            evidence.baseUrl
              ? `This answer came through ${evidence.gatewayName} at ${evidence.baseUrl}`
              : `This answer came through ${evidence.gatewayName}`
          }
        >
          {evidence.gatewayName}
        </span>
      ),
    });
  }
  if (evidence.model) {
    made.push({
      key: "model",
      node: (
        <span className="rex-foot-model" title="The model that wrote this answer">
          {modelLabel(models, evidence.model, evidence.model)}
        </span>
      ),
    });
  }
  if (evidence.style) {
    made.push({
      key: "style",
      node: (
        <span className="rex-foot-style" title="The output style this answer was written in">
          {evidence.style}
        </span>
      ),
    });
  }

  // The three numbers arrive together or not at all: they are one run's, counted
  // once, and a foot that showed the time but not the price would read as a
  // price of nothing.
  if (stats) {
    spent.push({
      key: "spent",
      node: (
        <span
          className="rex-foot-spent"
          title="How long this took — from your send to this answer, tool calls and all"
        >
          {spentText(stats.elapsedMs)}
        </span>
      ),
    });
    spent.push({
      key: "steps",
      node: (
        <span className="rex-foot-steps" title="Tool calls the agent made to answer this">
          {stepsText(stats.steps)}
        </span>
      ),
    });
    spent.push({
      key: "cost",
      node: (
        <span
          className="rex-foot-cost"
          // Spec 43 §8.1 and spec 44 §11 criterion 12 — a cost nobody reported
          // is drawn as unknown and never as `$0.00`. The two are not the same
          // fact: a local model behind a gateway reports nothing, and so does a
          // run REX failed to record, but `$0.000` on both makes the second
          // invisible and invites the first to be added up.
          title={
            stats.costUsd === null
              ? "This answer's cost was not reported. A local model behind a gateway reports none, and REX will not invent one."
              : "What this answer cost, as the SDK reported it."
          }
        >
          {costText(stats.costUsd)}
        </span>
      ),
    });
  }

  if (made.length === 0 && spent.length === 0) return null;
  // The `·` between two facts is drawn by CSS and not written here, so that it
  // can never be separated from the fact it belongs to when the line wraps —
  // and so that no dot appears where the two GROUPS meet, which is a gap and
  // not another separator.
  return (
    <div className="rex-turn-foot">
      <Group facts={made} className="rex-foot-made" />
      <Group facts={spent} className="rex-foot-spent-group" />
    </div>
  );
}
