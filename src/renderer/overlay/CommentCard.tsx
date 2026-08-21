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
  /**
   * The state of each target, in target order — spec 05 §5.4.
   *
   * Null means the sweep could not check it, because its document is not the
   * one on screen. That is emphatically not orphaned, and the card says so in
   * the words the design uses for absence.
   */
  targetStates: Array<AnchorState | null>;
  busy: boolean;
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

/**
 * One place's state, in words. Spec 05 §5.4.
 *
 * `null` is the case worth being careful about: it means nobody has looked,
 * because that document has not been open. An orphan means the text is gone.
 * Showing one as the other sends a reviewer hunting for damage that never
 * happened, so it gets the muted grey the design uses for absence and never the
 * red it uses for loss.
 */
function PlaceState({ state }: { state: AnchorState | null }): React.JSX.Element {
  if (state === "orphaned") return <span className="rex-state-orphaned">anchor lost</span>;
  if (state === "moved") return <span className="rex-state-moved">text moved</span>;
  if (state === "ok") return <span className="rex-meta">found</span>;
  return <span className="rex-meta">not checked here</span>;
}

/** "anchored", or "anchored in 3 places" when the comment has several targets. */
function anchoredIn(targets: number): string {
  return targets <= 1 ? "anchored" : `anchored in ${targets} places`;
}

export function CommentCard(props: Props): React.JSX.Element {
  const [reply, setReply] = useState("");
  const { thread } = props;
  const steps = stepsOf(thread);
  const messages = conversation(thread);
  const { answered } = progressOf(thread);
  // Spec 06 §4.3 — a section anchor stores its *heading's* text, so showing
  // that as the card's blockquote would claim the comment is about eight words
  // when it is about everything under them. `label` says `Section · "…"`, which
  // is what the panel row and the prompt both say.
  const quote = thread.targets[0]?.anchor.extent
    ? null
    : (thread.targets[0]?.anchor.quote?.exact ?? null);
  const spansDocuments = thread.documentNames.length > 1;

  // The design's meta line: what the comment is attached to, and how that went.
  //
  // Spec 05 §5.4 — a null state is "nobody looked", which is neither good news
  // nor bad. Reporting it as "resolved exactly" would be a claim REX cannot
  // make about a document that has not been open.
  const anchorNote =
    thread.kind === "synthesis" ? null : thread.status === "resolved" ? (
      <span className="rex-state-resolved">closed</span>
    ) : props.anchorState === "orphaned" ? (
      <span className="rex-state-orphaned">the text it was written on is gone</span>
    ) : props.anchorState === "moved" ? (
      <span className="rex-state-moved">re-found after the file changed</span>
    ) : props.anchorState === null ? (
      <span className="rex-meta">not checked here</span>
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
                  anchoredIn(thread.targets.length)}
              {anchorNote ? " · " : null}
              {anchorNote}
            </span>
          </div>

          {/* Spec 05 §5.3 — which documents, always. */}
          <span className="rex-thread-docs">{thread.documentNames.join(" · ")}</span>

          {/*
            Spec 05 §3.2 and §5.4 — every place, numbered as the panel numbered
            it, each saying where it is and how it last resolved. Without this a
            comment about three places shows one quote and claims a single state
            for all of them.
          */}
          {thread.targets.length > 1 ? (
            <ol className="rex-places">
              {thread.targets.map((target, position) => (
                <li key={`${target.documentId}-${position}`}>
                  <span className="rex-place-index">{position + 1}</span>
                  <span className="rex-place-doc">{thread.targetNames[position] ?? ""}</span>
                  <PlaceState state={props.targetStates[position] ?? null} />
                </li>
              ))}
            </ol>
          ) : null}

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
            disabled={props.busy || !answered || !thread.applyEnabled}
            title={
              thread.applyEnabled
                ? `Let a write-capable agent make this change in ${thread.documentNames.join(", ")} — you will see it before anything is kept`
                : (thread.applyDisabledReason ?? "")
            }
            onClick={props.onApply}
          >
            <Pencil />
            Apply…
          </button>
        </div>

        {/*
          Spec 05 §5.6 — said before the button is pressed, not after. A comment
          about three documents leads to a change in three documents, and the
          reviewer should know that while deciding, not while reading a diff.
        */}
        {spansDocuments && thread.applyEnabled ? (
          <span className="rex-meta">
            Apply edits {thread.documentNames.join(", ")}. You see every change, in each document,
            before anything is kept.
          </span>
        ) : null}
      </div>
    </>
  );
}
