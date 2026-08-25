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

import { useLayoutEffect, useRef, useState } from "react";
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

/** One bar and the gap after it — `.rex-strip-bars` in the stylesheet. */
const BAR_PITCH = 5;

/**
 * How much of the row the shape may take before it is dropped.
 *
 * The words are the fact and the bars are the picture, so when both cannot fit
 * the picture goes. A third leaves room for `32 steps · 2 denied` and
 * `show trace ›` at every width the splitter allows, and those must never wrap:
 * a strip that wraps to three lines is a paragraph, and the whole point of it
 * is being one row you take in without reading.
 */
const BAR_SHARE = 0.35;

/**
 * The whole row, on the comment card.
 *
 * It opens the trace (§6), which takes the document pane. It does not open a
 * list in place any more: a bash line, a path or a diff is wide, and 384px
 * wraps all three into mush.
 *
 * The bars are drawn only while ALL of them fit. Never a clipped run: a
 * truncated strip is a picture of a shorter run, and the bar it drops may be
 * the red one. The count and the refusals stay whichever way it goes, and the
 * trace's own head — a whole pane wide — always has the full shape.
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
  const row = useRef<HTMLButtonElement>(null);
  /** The row's content box, watched: the reviewer drags this column's width. */
  const [room, setRoom] = useState(0);

  useLayoutEffect(() => {
    const box = row.current;
    if (!box) return;
    const watch = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  return (
    <div className={tracing ? "rex-steps rex-steps-on" : "rex-steps"}>
      <button type="button" className="rex-steps-toggle" ref={row} onClick={onShowTrace}>
        {steps.length * BAR_PITCH <= room * BAR_SHARE ? <StepBars steps={steps} /> : null}
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
