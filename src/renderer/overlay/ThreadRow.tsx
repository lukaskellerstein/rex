// design/cards — treatment C, the wash.
//
// The card carries its own anchor state as a low-saturation wash of the state
// colour with a matching border, and the numbered token repeats that colour at
// full strength. Selection deepens the same wash and brightens the same border:
// a card never changes hue when you select it, only intensity, which is what
// keeps state and selection legible on one surface.
//
// The state is named in words in the meta line too, so nothing rests on colour.

import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { tokenClass } from "./Gutter.tsx";
import { TableGlyph } from "./Icons.tsx";

interface Props {
  thread: ThreadWithMessages;
  number: number;
  state: AnchorState | null;
  /** What the anchor resolved onto, for a card with no quote to show. */
  label: string | null;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  /** Spec 06 §6.4 — the ink follows the pointer down the comment list. */
  onHover?: (over: boolean) => void;
}

/** The wash: status first, because a resolved thread is not an alarm. */
export function washClass(status: string, state: AnchorState | null): string {
  if (status === "resolved") return "rex-thread-done";
  if (state === "orphaned") return "rex-thread-orphaned";
  if (state === "moved") return "rex-thread-moved";
  return "";
}

/** How far the agent got, in the two numbers the design shows. */
export function progressOf(thread: ThreadWithMessages): { answered: boolean; steps: number } {
  return {
    answered: thread.messages.some((m) => m.role === "assistant" && m.kind === "text"),
    steps: thread.messages.filter((m) => m.kind === "tool_call").length,
  };
}

/** The state, in words. Colour is the second signal, never the only one. */
export function StateWord({
  status,
  state,
}: {
  status: string;
  state: AnchorState | null;
}): React.JSX.Element | null {
  if (status === "resolved") return <span className="rex-state-resolved">resolved</span>;
  if (state === "orphaned") return <span className="rex-state-orphaned">anchor lost</span>;
  if (state === "moved") return <span className="rex-state-moved">text moved</span>;
  return null;
}

export function ThreadRow(props: Props): React.JSX.Element {
  const { thread } = props;
  // Spec 06 §4.3 — a section anchor stores its *heading's* text, so quoting it
  // here would claim the comment is about a title. `label` says `Section · "…"`.
  const quote = thread.targets[0]?.anchor.extent
    ? null
    : (thread.targets[0]?.anchor.quote?.exact ?? null);
  const { answered, steps } = progressOf(thread);
  const word = <StateWord status={thread.status} state={props.state} />;

  const classes = [
    "rex-thread",
    washClass(thread.status, props.state),
    props.selected ? "rex-thread-on" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      onClick={props.onSelect}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      <span
        className={`rex-token ${tokenClass(thread.status, props.state)} ${
          props.selected ? "rex-token-active" : ""
        }`}
      >
        {props.number}
      </span>

      <span className="rex-thread-body">
        <span className="rex-thread-note">{thread.note}</span>

        {quote ? (
          <span className="rex-quote rex-quote-small">{quote}</span>
        ) : props.label ? (
          // A figure or a table has no quote. The line says what the anchor is
          // rather than sitting blank or carrying a description REX invented.
          <span className="rex-kind">
            <TableGlyph />
            <span className="rex-kind-text">
              <span className="rex-kind-title">{props.label}</span>
            </span>
          </span>
        ) : null}

        {/*
          Spec 05 §5.3 — the comment list is the workspace's now, so every row
          says which documents it is about. Always, not only when there are two:
          a list where the document appears sometimes is a list you read twice.
        */}
        <span className="rex-thread-docs">{thread.documentNames.join(" · ")}</span>

        <span className="rex-thread-meta">
          {word}
          {thread.kind === "synthesis" ? (
            <span>synthesis of {thread.refThreadIds.length}</span>
          ) : null}
          {props.busy ? (
            <span className="rex-working">
              <span className="rex-spinner" />
              working…
            </span>
          ) : (
            <span>
              {answered ? "answered" : "not asked"}
              {steps > 0 ? ` · ${steps} step${steps === 1 ? "" : "s"}` : ""}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
