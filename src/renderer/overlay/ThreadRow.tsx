// design/cards — treatment C, the wash.
//
// The card carries its own anchor state as a low-saturation wash of the state
// colour with a matching border, and the numbered token repeats that colour at
// full strength. Selection deepens the same wash and brightens the same border:
// a card never changes hue when you select it, only intensity, which is what
// keeps state and selection legible on one surface.
//
// The state is named in words in the meta line too, so nothing rests on colour.

import { commentName, noteAddsToName } from "../../shared/names.ts";
import type { AnchorState, ThreadWithMessages } from "../../shared/types.ts";
import { tokenClass, washClass } from "./wash.ts";

// Re-exported: the card and the diff dialog import it from here.
export { washClass };

import { Pencil, TableGlyph, Trash } from "./Icons.tsx";
import { NameBox } from "./NameBox.tsx";
import { placeWords } from "./place.ts";

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
  /** Removes the comment for good. The row confirms before calling it. */
  onDelete?: () => void;
  /** Spec 14 §3.3 — the pen. Absent where the row cannot be renamed. */
  onRename?: () => void;
  /** True while this row's name box is open. */
  renaming?: boolean;
  /** Null puts the note back — §3.1. */
  onName?: (title: string | null) => void;
  onCancelRename?: () => void;
  /** Spec 14 §7.2 — one step in per level of nesting. */
  depth?: number;
}

/** How far the agent got, in the two numbers the design shows. */
export function progressOf(thread: ThreadWithMessages): {
  answered: boolean;
  steps: number;
  stopped: boolean;
} {
  return {
    answered: thread.messages.some((m) => m.role === "assistant" && m.kind === "text"),
    steps: thread.messages.filter((m) => m.kind === "tool_call").length,
    /**
     * Spec 17 §3.2 — the LAST message is a stop, so the run that ended this
     * comment was ended by the reviewer.
     *
     * The last one and not "any of them": a comment stopped once and asked
     * again is answered, and a row that still said `stopped` about it would be
     * reporting the older fact.
     */
    stopped: thread.messages.at(-1)?.kind === "stopped",
  };
}

/** The state, in words. Colour is the second signal, never the only one. */
export function StateWord({
  status,
  state,
  isNote = false,
}: {
  status: string;
  state: AnchorState | null;
  isNote?: boolean;
}): React.JSX.Element | null {
  if (status === "resolved") return <span className="rex-state-resolved">resolved</span>;
  if (state === "orphaned") return <span className="rex-state-orphaned">anchor lost</span>;
  if (state === "moved") return <span className="rex-state-moved">text moved</span>;
  // Last, like the wash and the token. Colour is never the only signal, so the
  // word is what actually separates a note from a comment nobody has asked yet.
  if (isNote) return <span className="rex-state-unsent">note</span>;
  return null;
}

export function ThreadRow(props: Props): React.JSX.Element {
  const { thread } = props;
  // `place.ts` decides between the two, and both failure modes it prevents show
  // up here first: a section anchor stores its *heading's* text, so quoting it
  // would claim the comment is about a title, and a code block's text flattens
  // into one line of italic serif that is neither readable nor a sentence.
  const first = thread.targets[0]?.anchor;
  const { label, quote } = first
    ? placeWords(first, props.label)
    : { label: props.label, quote: null };
  const { answered, steps, stopped } = progressOf(thread);
  const word = <StateWord status={thread.status} state={props.state} isNote={thread.isNote} />;

  const classes = [
    "rex-thread",
    washClass(thread.status, props.state, thread.isNote),
    props.selected ? "rex-thread-on" : "",
  ]
    .filter(Boolean)
    .join(" ");

  /*
    Renaming replaces the row rather than sitting inside it. An `<input>` inside
    a `<button>` is invalid for the same reason a button inside a button is, and
    a browser that un-nests it leaves a box that cannot be typed into. The token
    stays so the row does not jump while the name is being edited.
  */
  if (props.renaming && props.onName && props.onCancelRename) {
    return (
      <div
        className="rex-thread-wrap rex-thread-naming"
        style={props.depth ? { paddingLeft: `${props.depth * 14}px` } : undefined}
      >
        <div className={`rex-thread ${washClass(thread.status, props.state, thread.isNote)}`}>
          <span className={`rex-token ${tokenClass(thread.status, props.state, thread.isNote)}`}>
            {props.number}
          </span>
          <NameBox
            value={commentName(thread)}
            label={`Name for comment ${props.number}`}
            // §3.1 — empty is the reset: it writes NULL and the note comes back.
            allowEmpty
            onSave={props.onName}
            onCancel={props.onCancelRename}
          />
        </div>
      </div>
    );
  }

  /*
    The row is a `<button>`, and a button cannot contain another one, so the
    two sit side by side in a wrapper instead. Opening a comment and deleting
    it are different acts and this keeps them separately clickable — nesting
    would have made the whole row's hit area ambiguous.
  */
  return (
    <div
      className="rex-thread-wrap"
      style={props.depth ? { paddingLeft: `${props.depth * 14}px` } : undefined}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      {/*
        Spec 14 §3.3 — the pen sits in the WRAPPER, beside the trash, and not in
        the row. The row is a `<button>`, HTML forbids a button inside a button,
        and a browser that un-nests the markup makes clicking the pen select the
        comment instead of renaming it.

        Pen left, trash right: the safe control is the one the pointer reaches
        first, and the destructive one keeps the corner it has had since spec 08.
      */}
      {props.onRename ? (
        <button
          type="button"
          className="rex-thread-pen"
          aria-label={`Rename comment ${props.number}`}
          title="Rename this comment"
          onClick={props.onRename}
        >
          <Pencil size={12} />
        </button>
      ) : null}

      {props.onDelete ? (
        <button
          type="button"
          className="rex-thread-delete"
          aria-label={`Delete comment ${props.number}`}
          title="Delete this comment and its whole conversation"
          onClick={() => {
            const messages = thread.messages.length;
            const detail =
              messages > 0 ? ` and its ${messages} message${messages === 1 ? "" : "s"}` : "";
            if (window.confirm(`Delete this comment${detail}? This cannot be undone.`)) {
              props.onDelete?.();
            }
          }}
        >
          <Trash size={12} />
        </button>
      ) : null}

      <button type="button" className={classes} onClick={props.onSelect}>
        <span
          className={`rex-token ${tokenClass(thread.status, props.state, thread.isNote)} ${
            props.selected ? "rex-token-active" : ""
          }`}
        >
          {props.number}
        </span>

        <span className="rex-thread-body">
          {/*
            Spec 14 §3.4 — the headline is the NAME. With no title that is the
            note's first line, which is exactly what this row showed before.
          */}
          <span className="rex-thread-note">{commentName(thread)}</span>

          {/*
            The note under the name only when it says something the name does
            not. With no title the two are the same string, and printing it
            twice turns a four-line row into a five-line one saying no more.
          */}
          {noteAddsToName(thread) ? <span className="rex-thread-prompt">{thread.note}</span> : null}

          {quote ? (
            <span className="rex-quote rex-quote-small">{quote}</span>
          ) : label ? (
            // A figure or a table has no quote. The line says what the anchor is
            // rather than sitting blank or carrying a description REX invented.
            <span className="rex-kind">
              <TableGlyph />
              <span className="rex-kind-text">
                <span className="rex-kind-title">{label}</span>
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
            ) : thread.isNote ? // "note" is already in this line, one word to the left. Adding
            // "not asked" says the same thing twice, and the second half
            // reads like a reproach for a choice the reviewer made.
            null : (
              <span>
                {/*
                  Spec 17 §3.2 — a comment whose last run the reviewer stopped
                  was asked, so "not asked" about it is simply false. It is the
                  same wrong reading the STOPPED block in the card exists to
                  prevent, one column to the left.

                  It carries the card's red for the same reason the card's block
                  does: a list of fourteen comments is scanned, not read, and
                  the one that did not finish is the one worth finding.
                */}
                {stopped ? (
                  <span className="rex-state-stopped">stopped</span>
                ) : answered ? (
                  "answered"
                ) : (
                  "not asked"
                )}
                {steps > 0 ? ` · ${steps} step${steps === 1 ? "" : "s"}` : ""}
              </span>
            )}
          </span>
        </span>
      </button>
    </div>
  );
}
