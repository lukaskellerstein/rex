// Spec 08 §5.4 — the machinery, standing in for itself.
//
// One bar per tool CALL, in order, so the SHAPE of a run reads at a glance
// without opening anything: four quick reads look nothing like one long search.
//
// The bars are neutral ON PURPOSE. Colour means state in this design, and
// "which tool ran" is not a state. The single exception is a denied write —
// taller, and in the same red the write-capable agent wears everywhere else —
// because the gate firing is the one step worth seeing at a glance.
//
// It lives in its own file because two views draw it: the comment card, where
// the whole row is the button that opens the trace, and the trace's own head,
// where the bars sit beside the numbers they are the shape of. One strip, one
// rule for what a bar means.

import type { Message, ThreadWithMessages } from "../../shared/types.ts";
import { ChevronRight } from "./Icons.tsx";
import { argumentOf } from "./trace.ts";

export interface Step {
  id: string;
  name: string;
  detail: string;
  denied: boolean;
}

/**
 * The machinery, in order. One step per tool CALL — never one per message.
 *
 * A refused call arrives as two rows: the `tool_call`, and a `tool_result`
 * carrying the refusal. Pushing both made the strip draw eight bars for seven
 * calls and disagree with the meta strip beside it, which counts calls. So an
 * error result marks the call it belongs to instead of adding to the list: a
 * result follows its own call in `seq` order, so the most recent step that is
 * not already denied is that call.
 *
 * The refusal is kept, not dropped. `deny` in red is how the read profile's
 * gate becomes visible, and that is worth a whole design rule.
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
      });
      continue;
    }
    if (message.kind !== "tool_result" || !message.isError) continue;

    const call = steps.findLast((step) => !step.denied);
    if (call) {
      call.denied = true;
      call.detail = `${call.detail} — ${message.content ?? "refused"}`;
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
          className={step.denied ? "rex-strip-deny" : ""}
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
 * The whole row, on the comment card.
 *
 * It opens the trace (§6), which takes the document pane. It does not open a
 * list in place any more: a bash line, a path or a diff is wide, and 384px
 * wraps all three into mush.
 */
export function StepStrip({
  steps,
  tracing,
  onShowTrace,
}: {
  steps: Step[];
  tracing: boolean;
  onShowTrace: () => void;
}): React.JSX.Element {
  const denied = steps.filter((step) => step.denied).length;

  return (
    <div className={tracing ? "rex-steps rex-steps-on" : "rex-steps"}>
      <button type="button" className="rex-steps-toggle" onClick={onShowTrace}>
        <StepBars steps={steps} />
        {stepCount(steps.length)}
        {denied > 0 ? <span className="rex-strip-denied">· {denied} denied</span> : null}
        <span className="rex-steps-show">
          {tracing ? "showing" : "show trace"}
          {tracing ? null : <ChevronRight />}
        </span>
      </button>
    </div>
  );
}
