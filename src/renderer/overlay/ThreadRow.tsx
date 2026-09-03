// design/cards — treatment C, the wash.
//
// The card carries its lane as a low-saturation wash of the lane's colour with
// a matching border, and the numbered token repeats that colour at full
// strength. Selection deepens the same wash and brightens the same border: a
// card never changes hue when you select it, only intensity, which is what
// keeps lane and selection legible on one surface.
//
// Spec 33 — three lines. The name; one chip per file, every place counted; the
// run, as the card's own step bars. The row used to quote its first place and
// print the note under the name, and a comment about five places in four files
// said "The whole document" — its first place — five lines tall.

import { commentName } from "../../shared/names.ts";
import { tallyPlaces, threadState } from "../../shared/targets.ts";
import type { AnchorState, Message, ThreadWithMessages } from "../../shared/types.ts";
import { type FileChip, filesOf } from "./files.ts";
import { Check, Pencil, Trash, Undo } from "./Icons.tsx";
import { NameBox } from "./NameBox.tsx";
import { RunNums, StepBars, stepsOf } from "./StepStrip.tsx";
import { tokenClass, washClass } from "./wash.ts";

interface Props {
  thread: ThreadWithMessages;
  number: number;
  /**
   * Spec 33 §2.1 — the state of each place, in target order: the sweep's
   * fresher answer where it has one, the stored state where it does not. Null
   * is "nobody looked" (spec 05 §5.4), which is neither lost nor found.
   *
   * Per place and not the tally, because the chips count the lost ones PER
   * FILE, and a count summed over the comment cannot be split back out.
   */
  states: Array<AnchorState | null>;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  /** Spec 06 §6.4 — the ink follows the pointer down the comment list. */
  onHover?: (over: boolean) => void;
  /** Removes the comment for good. The row confirms before calling it. */
  onDelete?: () => void;
  /**
   * Marks the comment resolved, or puts it back. The flag is the state asked
   * for, so it matches the card's own `onResolve` and the IPC payload.
   *
   * Resolving was a thing you could only do from inside a comment, which meant
   * opening one to end it and going back for the next. Ending a comment is a
   * judgement about the whole thing — the same kind of act as deleting it — so
   * it belongs beside delete, in the list, where the reviewer is when they are
   * clearing a batch.
   */
  onResolve?: (resolved: boolean) => void;
  /** Spec 14 §3.3 — the pen. Absent where the row cannot be renamed. */
  onRename?: () => void;
  /** True while this row's name box is open. */
  renaming?: boolean;
  /** Null puts the note back — §3.1. */
  onName?: (title: string | null) => void;
  onCancelRename?: () => void;
}

/** The kinds that are a turn in the conversation, as the card counts them. */
const IN_CONVERSATION = new Set<Message["kind"]>(["text", "error", "stopped"]);

/**
 * Spec 33 §2.3 — the word in the row's corner, or null for the normal case.
 *
 * The corner says the one thing that is NOT normal. An open comment that was
 * answered says nothing there: the bars already say the run happened, and a
 * list of thirteen answered comments each saying `answered` was a column of one
 * word. `not asked` is gone with it — since spec 30 an open comment has always
 * been sent, so the words were never true of one.
 *
 * Lane first, then what happened to the last run. A resolved comment whose last
 * run was stopped says `resolved`: it is terminal (spec 18 §2), and the stop is
 * on its card.
 *
 * Spec 17 §3.2 — `stopped` is read off the LAST turn, not any of them: a
 * comment stopped once and asked again is answered, and a row that still said
 * `stopped` about it would be reporting the older fact. An error is the same
 * shape one word over: the run ended in one and nothing answered since.
 */
export function cornerWord(
  thread: ThreadWithMessages,
  state: AnchorState | null,
): { text: string; className: string } | null {
  if (thread.status === "draft") return { text: "draft", className: "rex-state-draft" };
  if (thread.status === "note") return { text: "note", className: "rex-state-unsent" };
  if (thread.status === "resolved") return { text: "resolved", className: "rex-state-resolved" };
  if (state === "orphaned") return { text: "anchor lost", className: "rex-state-orphaned" };
  const last = thread.messages.findLast((message) => IN_CONVERSATION.has(message.kind));
  if (last?.kind === "stopped") return { text: "stopped", className: "rex-state-stopped" };
  if (last?.kind === "error") return { text: "error", className: "rex-state-error" };
  return null;
}

/**
 * Spec 33 §2.1 — one file, and what the comment has in it.
 *
 * `whole` and the count are one mark or the other, never both: a place that is
 * the whole file is not "1 place" in any sense the reviewer means, so the word
 * replaces the number, and any places besides it are `+N`. The lost count is a
 * grey `?` — the tree's own glyph for gone (spec 18 §3) — and it is the ONLY
 * state a chip shows. A moved place gets no mark, exactly as it gets none in
 * the tree (spec 18 §2.1): nothing is wrong with it.
 */
function Chip({ chip }: { chip: FileChip }): React.JSX.Element {
  const places = `${chip.places} place${chip.places === 1 ? "" : "s"}`;
  const lost = chip.lost > 0 ? `, ${chip.lost} lost` : "";
  // `rex-thread-*`, the row's own family: `.rex-file` is the diff dialog's
  // file row, and a chip that borrowed the name inherited its box.
  return (
    <span className="rex-thread-file" title={`${places} in ${chip.name}${lost}`}>
      <span className="rex-thread-file-name">{chip.name}</span>
      {chip.whole ? <span className="rex-thread-mark rex-thread-mark-whole">whole</span> : null}
      {chip.whole ? (
        chip.places > 1 ? (
          <span className="rex-thread-mark">+{chip.places - 1}</span>
        ) : null
      ) : (
        <span className="rex-thread-mark">{chip.places}</span>
      )}
      {chip.lost > 0 ? (
        <span className="rex-thread-mark rex-thread-mark-lost">?{chip.lost}</span>
      ) : null}
    </span>
  );
}

export function ThreadRow(props: Props): React.JSX.Element {
  const { thread } = props;
  // Spec 32 §2 — the lane the colour follows. Summed here from the per-place
  // states the chips need, so the row and its chips read one list.
  const state = threadState(tallyPlaces(props.states));
  const chips = filesOf(thread, props.states);
  const steps = stepsOf(thread);
  const corner = cornerWord(thread, state);

  const classes = [
    "rex-thread",
    washClass(thread.status, state),
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
      <div className="rex-thread-wrap rex-thread-naming">
        <div className={`rex-thread ${washClass(thread.status, state)}`}>
          <span className={`rex-token ${tokenClass(thread.status, state)}`}>{props.number}</span>
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
    Spec 33 §2.3 — the corner, drawn once. `working…` outranks every word: it is
    happening now, and the others are about what already happened.
  */
  const word = props.busy ? (
    <span className="rex-run-word rex-working">
      <span className="rex-spinner" />
      working…
    </span>
  ) : corner ? (
    <span className={`rex-run-word ${corner.className}`}>{corner.text}</span>
  ) : null;

  /*
    The row is a `<button>`, and a button cannot contain another one, so the
    two sit side by side in a wrapper instead. Opening a comment and deleting
    it are different acts and this keeps them separately clickable — nesting
    would have made the whole row's hit area ambiguous.
  */
  return (
    <div
      className="rex-thread-wrap"
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      {/*
        The tick, leftmost of the three: the reversible control is the one the
        pointer reaches first, and the destructive one keeps the corner it has
        had since spec 08.

        It is an icon here and a word in the card, and the two differ on purpose.
        The card has room and one comment to talk about, so it says "Resolve".
        The list has fourteen rows and a 22px corner, and a word in each of them
        would be a column of prose down the side of the panel.

        No confirm. Resolving is undone by the same button, one click later,
        which is what separates it from the trash beside it.
      */}
      {/*
        Spec 30 §2.2 — not on a draft and not on a note.

        Resolve means "dealt with", and it is only a move a SENT comment can
        make: the draft's own way out is being finished, and the note's is
        **Turn into a comment** on its card (§3.5). A tick on either would offer
        a lane change the rule does not allow, and `setThreadStatus` would have
        taken it — it writes `resolved` over whatever was there.
      */}
      {props.onResolve && (thread.status === "open" || thread.status === "resolved") ? (
        <button
          type="button"
          className={`rex-thread-resolve ${thread.status === "open" ? "" : "rex-thread-reopen"}`}
          disabled={props.busy}
          aria-label={
            thread.status === "open"
              ? `Resolve comment ${props.number}`
              : `Reopen comment ${props.number}`
          }
          data-tip={thread.status === "open" ? "Resolve" : "Reopen"}
          onClick={() => props.onResolve?.(thread.status === "open")}
        >
          {thread.status === "open" ? <Check size={12} /> : <Undo size={12} />}
        </button>
      ) : null}

      {/*
        Spec 14 §3.3 — the pen sits in the WRAPPER, beside the trash, and not in
        the row. The row is a `<button>`, HTML forbids a button inside a button,
        and a browser that un-nests the markup makes clicking the pen select the
        comment instead of renaming it.
      */}
      {props.onRename ? (
        <button
          type="button"
          className="rex-thread-pen"
          aria-label={`Rename comment ${props.number}`}
          data-tip="Rename"
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
          data-tip="Delete"
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
          className={`rex-token ${tokenClass(thread.status, state)} ${
            props.selected ? "rex-token-active" : ""
          }`}
        >
          {props.number}
        </span>

        <span className="rex-thread-body">
          {/*
            Spec 14 §3.4 — the headline is the NAME. With no title that is the
            note's first line. Nothing else of the note is drawn: the name is
            what it stands for, and the card has the words.
          */}
          <span className="rex-thread-note">{commentName(thread)}</span>

          {/*
            Spec 33 §2.1 — the files, every place counted. A synthesis comment
            has no places of its own and says what it is made of instead.
          */}
          {thread.kind === "synthesis" ? (
            <span className="rex-thread-files">
              <span className="rex-thread-file">
                <span className="rex-thread-file-name">
                  synthesis of {thread.refThreadIds.length} comments
                </span>
              </span>
            </span>
          ) : chips.length > 0 ? (
            <span className="rex-thread-files">
              {chips.map((chip) => (
                <Chip key={chip.name} chip={chip} />
              ))}
            </span>
          ) : null}

          {/*
            Spec 33 §2.2 — the run, as the card's own bars, and the corner word
            at its right end. One wrapping group: when the bars and the numbers
            do not fit one line, the numbers and the word move under the bars as
            a unit, and the numbers never break inside themselves.

            `RunNums` is the numbers, shared with the card head (spec 35 §2.2).
          */}
          {steps.length > 0 ? (
            <span className="rex-thread-run">
              <StepBars steps={steps} />
              <RunNums steps={steps} />
              {word}
            </span>
          ) : word ? (
            // No run to draw — a draft, a note, a comment whose run has not
            // called a tool yet — but a word to say. It keeps the corner.
            <span className="rex-thread-meta">{word}</span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
