import * as React from "react";
import { cx } from "../internal/cx";

export type AnswerRole = "agent" | "user" | "error";

export interface AnswerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `agent` is the answer — full contrast, no chrome. `user` is your own turn,
   * dim and ruled. `error` is the run failing, in the write red.
   * @default 'agent'
   */
  role?: AnswerRole;
  children: React.ReactNode;
}

/**
 * One turn of the conversation about a comment.
 *
 * **The answer outranks the machinery**, and this component is where that rule
 * is spent: the agent's turn gets 13px body text at full contrast with no
 * border, no card and no avatar. Your own question is a step dimmer behind a
 * rule, because you already know what you asked.
 *
 * Nothing about the run appears here. The cost, the duration and the profile go
 * in a `Meta` strip above; the tool calls collapse into `ToolSteps` below; the
 * thinking is drawn in the trace sheet and nowhere else. An answer with its
 * machinery threaded through it is how a reviewer stops reading answers.
 */
export const Answer = React.forwardRef<HTMLDivElement, AnswerProps>(function Answer(
  { role = "agent", className, children, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      className={cx("rex-answer", role !== "agent" && `rex-answer-${role}`, className)}
    >
      {children}
    </div>
  );
});
