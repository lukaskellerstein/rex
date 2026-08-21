// design/screens/Main — one comment, its answer, and what to do next.
//
// The answer outranks the machinery. Tool steps collapse to a single row and
// keep their own monospace register when opened, so they can never be mistaken
// for the agent's reply; a denied write stays visible in red, because the gate
// firing is worth seeing.

import { useState } from "react";
import type { AnchorState, Message, ThreadWithMessages } from "../../shared/types.ts";
import { tokenClass } from "./Gutter.tsx";
import { ChevronLeft, Pencil, TableGlyph, TriangleDown, TriangleRight } from "./Icons.tsx";
import { progressOf, washClass } from "./ThreadRow.tsx";

interface Props {
  thread: ThreadWithMessages;
  number: number;
  anchorState: AnchorState | null;
  /** What the anchor resolved onto, for a thread with no quote to show. */
  label: string | null;
  busy: boolean;
  applyEnabled: boolean;
  applyDisabledReason: string | null;
  onBack: () => void;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  onApply: () => void;
}

interface Step {
  id: string;
  name: string;
  detail: string;
  denied: boolean;
}

/** The argument worth showing for a call — the command, the path, the pattern. */
function stepDetail(message: Message): string {
  const input = (message.toolInput ?? {}) as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "path", "url", "prompt"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return Object.keys(input).length > 0 ? JSON.stringify(input).slice(0, 160) : "";
}

/**
 * The machinery, in order. A failed result is folded onto its own row rather
 * than hidden: `deny` in red is how the read profile's gate becomes visible.
 */
function stepsOf(thread: ThreadWithMessages): Step[] {
  const steps: Step[] = [];
  for (const message of thread.messages) {
    if (message.kind === "tool_call") {
      steps.push({
        id: message.id,
        name: message.toolName ?? "tool",
        detail: stepDetail(message),
        denied: false,
      });
    } else if (message.kind === "tool_result" && message.isError) {
      steps.push({
        id: message.id,
        name: "deny",
        detail: `${message.toolName ?? "tool"} — ${message.content ?? "refused"}`,
        denied: true,
      });
    }
  }
  return steps;
}

/** The conversation: what the agent said, and what the reviewer said back. */
function conversation(thread: ThreadWithMessages): Message[] {
  return thread.messages.filter(
    (message) =>
      (message.kind === "text" && message.content) || (message.kind === "error" && message.content),
  );
}

function ToolSteps({ steps }: { steps: Step[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const names = [...new Set(steps.map((step) => step.name))].slice(0, 3).join(", ");

  return (
    <div className={open ? "rex-steps rex-steps-open" : "rex-steps"}>
      <button type="button" className="rex-steps-toggle" onClick={() => setOpen(!open)}>
        {open ? <TriangleDown /> : <TriangleRight />}
        {steps.length} step{steps.length === 1 ? "" : "s"}
        {open ? "" : ` · ${names}`}
        <span className="rex-steps-show">{open ? "hide" : "show"}</span>
      </button>

      {open ? (
        <div className="rex-steps-list">
          {steps.map((step) => (
            <div key={step.id} className={step.denied ? "rex-step rex-step-deny" : "rex-step"}>
              <span className="rex-step-name" title={step.name}>
                {step.name}
              </span>
              <span className="rex-step-arg" title={step.detail}>
                {step.detail}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "anchored", or "anchored in 3 places" when the comment has extra targets. */
function anchoredIn(extras: number): string {
  return extras === 0 ? "anchored" : `anchored in ${extras + 1} places`;
}

export function CommentCard(props: Props): React.JSX.Element {
  const [reply, setReply] = useState("");
  const { thread } = props;
  const steps = stepsOf(thread);
  const messages = conversation(thread);
  const { answered } = progressOf(thread);
  const quote = thread.anchor?.quote?.exact ?? null;

  // The design's meta line: what the comment is attached to, and how that went.
  const anchorNote =
    thread.kind === "synthesis" ? null : thread.status === "resolved" ? (
      <span className="rex-state-resolved">closed</span>
    ) : props.anchorState === "orphaned" ? (
      <span className="rex-state-orphaned">the text it was written on is gone</span>
    ) : props.anchorState === "moved" ? (
      <span className="rex-state-moved">re-found after the file changed</span>
    ) : (
      <span>resolved exactly</span>
    );

  return (
    <>
      <header className="rex-side-head">
        <button type="button" className="rex-link" onClick={props.onBack}>
          <ChevronLeft />
          all comments
        </button>
        <span className="rex-spacer" />
        {thread.status === "resolved" ? (
          <span className="rex-pill rex-pill-ok">RESOLVED</span>
        ) : props.anchorState === "orphaned" ? (
          <span className="rex-pill rex-pill-lost">ANCHOR LOST</span>
        ) : props.anchorState === "moved" ? (
          <span className="rex-pill rex-pill-moved">TEXT MOVED</span>
        ) : null}
      </header>

      <div className="rex-card">
        <div className={`rex-card-anchor ${washClass(thread.status, props.anchorState)}`}>
          <div className="rex-card-anchor-head">
            <span className={`rex-token ${tokenClass(thread.status, props.anchorState)}`}>
              {props.number}
            </span>
            <span className="rex-meta">
              {thread.kind === "synthesis"
                ? `synthesis of ${thread.refThreadIds.length} comments`
                : // A multi-target comment says so: the quote below is only the
                  // first of its places, and without this the card claims to be
                  // about one passage when the reader asked about several.
                  anchoredIn(thread.extraAnchors.length)}
              {anchorNote ? " · " : null}
              {anchorNote}
            </span>
          </div>

          {quote ? (
            <blockquote className="rex-quote">{quote}</blockquote>
          ) : props.label ? (
            <span className="rex-kind">
              <TableGlyph />
              <span className="rex-kind-text">
                <span className="rex-kind-title">{props.label}</span>
              </span>
            </span>
          ) : null}

          <p className="rex-card-note">{thread.note}</p>
        </div>

        {messages.length > 0 ? (
          <div className="rex-answer">
            <span className="rex-label">{answered ? "ANSWER" : "TRANSCRIPT"}</span>
            {messages.map((message) => (
              <p
                key={message.id}
                className={
                  message.kind === "error"
                    ? "rex-answer-error"
                    : message.role === "user"
                      ? "rex-answer-user"
                      : ""
                }
              >
                {message.content}
              </p>
            ))}
          </div>
        ) : null}

        {props.busy ? (
          <span className="rex-working">
            <span className="rex-spinner" />
            working…
          </span>
        ) : null}

        {steps.length > 0 ? <ToolSteps steps={steps} /> : null}
      </div>

      <div className="rex-reply">
        <textarea
          className="rex-input"
          placeholder="Reply to this thread"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
        <div className="rex-row">
          <button
            type="button"
            className="rex-button rex-primary"
            disabled={props.busy || reply.trim().length === 0}
            onClick={() => {
              props.onReply(reply.trim());
              setReply("");
            }}
          >
            Send
          </button>
          <button
            type="button"
            className="rex-button"
            disabled={props.busy}
            onClick={() => props.onResolve(thread.status === "open")}
          >
            {thread.status === "open" ? "Resolve" : "Reopen"}
          </button>
          <button
            type="button"
            className="rex-button rex-button-write"
            disabled={props.busy || !answered || !props.applyEnabled}
            title={
              props.applyEnabled
                ? "Let a write-capable agent make this change — you will see a diff first"
                : (props.applyDisabledReason ?? "")
            }
            onClick={props.onApply}
          >
            <Pencil />
            Apply…
          </button>
        </div>
      </div>
    </>
  );
}
