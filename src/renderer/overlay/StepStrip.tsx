// Spec 08 §5.4 — the machinery, standing in for itself.
//
// One bar per tool CALL, in order, so the SHAPE of a run reads at a glance
// without opening anything: four quick reads look nothing like one long search.
//
// The bars are neutral ON PURPOSE. Colour means state in this design, and
// "which tool ran" is not a state. A step that went wrong is a state, and there
// are two of those: a denied write — taller, and in the same red the
// write-capable agent wears everywhere else — because the gate firing is the one
// step worth seeing at a glance, and a call that failed, red at the ordinary
// height. The height is what keeps them apart at a glance; the marks beside the
// bars are what keep them apart exactly.
//
// It lives in its own file because three views draw it: the list row and the
// card head, where the bars and the numbers make one line (spec 33 §2.2, spec
// 35 §2.2), and the trace's own head, where the bars sit beside the numbers
// they are the shape of. One strip, one rule for what a bar means.

import type { Message, ThreadWithMessages } from "../../shared/types.ts";
import { Blocked, Check, Warning } from "./Icons.tsx";
import { argumentOf } from "./trace.ts";

export interface Step {
  id: string;
  name: string;
  detail: string;
  denied: boolean;
  /** It ran and did not succeed. Never true at the same time as `denied`. */
  failed: boolean;
}

/**
 * The machinery, in order. One step per tool CALL — never one per message.
 *
 * A refused call arrives as two rows: the `tool_call`, and a `tool_result`
 * carrying the refusal. Pushing both made the strip draw eight bars for seven
 * calls and disagree with the meta strip beside it, which counts calls. So an
 * error result marks the call it belongs to instead of adding to the list: a
 * result follows its own call in `seq` order, so the most recent step that is
 * not already marked is that call.
 *
 * The refusal is kept, not dropped. `deny` in red is how the read profile's
 * gate becomes visible, and that is worth a whole design rule. A FAILED call is
 * marked too and marked differently: it is red as well — spec 18 §3 gives an
 * error the same red — but it is not the gate, so it does not get the gate's
 * extra height and it is never counted with the refusals.
 */
export function stepsOf(thread: ThreadWithMessages): Step[] {
  const steps: Step[] = [];
  for (const message of thread.messages as Message[]) {
    if (message.kind === "tool_call") {
      steps.push({
        id: message.id,
        name: message.toolName ?? "tool",
        detail: argumentOf(message),
        denied: false,
        failed: false,
      });
      continue;
    }
    if (message.kind !== "tool_result" || !message.isError) continue;

    const call = steps.findLast((step) => !step.denied && !step.failed);
    if (call) {
      if (message.denied) call.denied = true;
      else call.failed = true;
      const what = message.denied ? "refused" : "failed";
      call.detail = `${call.detail} — ${message.content ?? what}`;
    }
  }
  return steps;
}

/** The bars alone, for a head that already carries the numbers. */
export function StepBars({ steps }: { steps: Step[] }): React.JSX.Element {
  return (
    <span className="rex-strip-bars" aria-hidden="true">
      {steps.map((step) => (
        <i
          key={step.id}
          className={step.denied ? "rex-strip-deny" : step.failed ? "rex-strip-fail" : ""}
          title={`${step.name} · ${step.detail}`}
        />
      ))}
    </span>
  );
}

/** "32 steps", and the refusals when there are any. */
export function stepCount(steps: number): string {
  return `${steps} step${steps === 1 ? "" : "s"}`;
}

/**
 * Spec 33 §2.2 — the numbers beside the bars: the count, and the two failure
 * kinds as the trace's own marks — a circled `!` for a call that failed, a
 * barred circle for one the gate refused — each with its number, in red.
 *
 * Marks and not words, because `72 steps · 2 failed · 1 denied` broke inside
 * itself at the sidebar's 300px minimum and put `denied` on a line of its own.
 * One non-wrapping unit, drawn by the list row, the card head (spec 35 §2.2)
 * and the trace head (spec 38 §2) so the three cannot count differently.
 * Hover has the words.
 *
 * Spec 38 §2.1 — the calls that ran and succeeded come first, as a check in
 * the muted grey, so the marks add up to the count beside them. The reviewer's
 * words: *"show not only how many failed but how many succeeded as well."*
 */
export function RunNums({ steps }: { steps: Step[] }): React.JSX.Element {
  const denied = steps.filter((step) => step.denied).length;
  const failed = steps.filter((step) => step.failed).length;
  const ok = steps.length - denied - failed;
  return (
    <span className="rex-run-nums">
      <span>{stepCount(steps.length)}</span>
      <span className="rex-run-ok" title={`${ok} call${ok === 1 ? "" : "s"} ran and succeeded`}>
        <Check size={12} />
        {ok}
      </span>
      {failed > 0 ? (
        <span className="rex-run-bad" title={`${failed} call${failed === 1 ? "" : "s"} failed`}>
          <Warning size={12} />
          {failed}
        </span>
      ) : null}
      {denied > 0 ? (
        <span
          className="rex-run-bad"
          title={`${denied} call${denied === 1 ? "" : "s"} refused by the gate`}
        >
          <Blocked size={12} />
          {denied}
        </span>
      ) : null}
    </span>
  );
}
