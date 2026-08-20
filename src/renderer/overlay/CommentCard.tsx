// SPEC.md §7 — the note, the full transcript, a message box, and
// Resolve / Apply.

import { useState } from "react";
import type { AnchorState, Message, ThreadWithMessages } from "../../shared/types.ts";

interface Props {
  thread: ThreadWithMessages;
  anchorState: AnchorState | null;
  busy: boolean;
  applyEnabled: boolean;
  applyDisabledReason: string | null;
  onBack: () => void;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  onApply: () => void;
}

/** Thinking and raw tool results are machinery; the conversation is the record. */
function summarise(message: Message): string {
  switch (message.kind) {
    case "tool_call":
      return `used ${message.toolName ?? "a tool"}`;
    case "tool_result":
      return message.isError ? `tool error: ${message.content ?? ""}` : "tool result";
    case "completed":
      return message.content ?? "completed";
    default:
      return message.content ?? "";
  }
}

export function CommentCard(props: Props): React.JSX.Element {
  const [reply, setReply] = useState("");
  const { thread } = props;
  const answered = thread.messages.some((m) => m.role === "assistant" && m.kind === "text");

  return (
    <section className="rex-card">
      <header className="rex-card-head">
        <button type="button" className="rex-link" onClick={props.onBack}>
          ← all comments
        </button>
        {props.anchorState && props.anchorState !== "ok" ? (
          <span className={`rex-badge rex-badge-${props.anchorState}`}>
            {props.anchorState === "moved" ? "text changed" : "orphaned"}
          </span>
        ) : null}
      </header>

      {thread.anchor?.quote ? (
        <blockquote className="rex-quote">{thread.anchor.quote.exact}</blockquote>
      ) : null}
      {thread.kind === "synthesis" ? (
        <p className="rex-meta">Synthesis of {thread.refThreadIds.length} comments</p>
      ) : null}
      <p className="rex-note">{thread.note}</p>

      <div className="rex-transcript">
        {thread.messages.map((message) => (
          <div
            key={message.id}
            className={`rex-msg rex-msg-${message.kind} rex-msg-${message.role}`}
          >
            <span className="rex-msg-role">{message.role}</span>
            <span className="rex-msg-body">{summarise(message)}</span>
          </div>
        ))}
        {props.busy ? <div className="rex-msg rex-msg-pending">working…</div> : null}
      </div>

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
          className="rex-button"
          disabled={props.busy || !answered || !props.applyEnabled}
          title={
            props.applyEnabled
              ? "Let a write-capable agent make this change"
              : (props.applyDisabledReason ?? "")
          }
          onClick={props.onApply}
        >
          Apply
        </button>
      </div>
    </section>
  );
}
