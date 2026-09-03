// Spec 38 §4 — the card's foot, as one component two surfaces draw.
//
// The comment card and the trace sheet both end in a place to type the next
// message, and until this file they ended differently: the card had the
// pending strip, the grip, the box, the mode switch, the model, the style and
// the button; the sheet had a box with Send beside it and no choice at all.
// Spec 08 §6 had already learned that the two boxes must send through ONE
// handler so they cannot drift — this finishes the thought. One foot, drawn
// twice, reading and writing the same state: a mode picked in the sheet is the
// mode the card shows.
//
// The draft, the box's dragged height and the box's ref live here, because
// they are the foot's own. What the foot sends with — the mode, the model, the
// style, the pending places — lives in `App.tsx`, as it did, so the two copies
// on screen at once agree.

import { type RefObject, useRef, useState } from "react";
import type { AgentChoices, ThreadWithMessages } from "../../shared/types.ts";
import { DEFAULT_STYLE } from "../../shared/types.ts";
import { ChevronRight, Pencil, Trash } from "./Icons.tsx";
import { onSendChord, SEND_CHORD_HINT, SendChord } from "./keys.tsx";
import { ModelPick, styleRows } from "./ModelPick.tsx";
import { isModeChord, ModeSwitch, other } from "./ModeSwitch.tsx";
import type { Mode } from "./mode.ts";
import { ReplyGrip } from "./ReplyGrip.tsx";
import type { SelectionItem } from "./selection.ts";

interface Props {
  thread: ThreadWithMessages;
  /** True while this thread's agent is running. No second turn is taken. */
  busy: boolean;
  /** Spec 12 §3.2 — the mode the next send will run in. */
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** Spec 25 §7.1 — the models on offer, and this comment's own pick. */
  models: AgentChoices;
  model: string | null;
  onModel: (model: string | null) => void;
  /** Spec 31 §2.1 — the output style this chat is having. Never null. */
  style: string;
  onStyle: (style: string) => void;
  /** Spec 24 §3.2 — places picked for this comment and not yet sent. */
  pending: SelectionItem[];
  hoveredItemId: string | null;
  onHoverItem: (id: string | null) => void;
  onRemovePending: (id: string) => void;
  onReorderPending: (from: number, to: number) => void;
  onGoToPending: (item: SelectionItem) => void;
  onPendingToNewComment: () => void;
  /** The scrolling area above the box — what the grip lets the box grow into. */
  above: RefObject<HTMLElement | null>;
  /**
   * Spec 38 §4 — the sheet's one rule of its own. `esc` is the sheet's only
   * exit, and inside a box you can type a paragraph into the first `esc` has
   * to LEAVE THE BOX and nothing else: the draft stays, the sheet stays, and a
   * second `esc` closes it. Stopping the event is what does it — the sheet
   * listens on `document`. The card has no such exit, so it leaves this off.
   */
  escapeLeavesBox?: boolean;
  onReply: (text: string) => void;
}

/** Spec 24 §3.2 — the strip's label follows the mode, as the button does. */
const PENDING_LABEL: Record<Mode, string> = {
  ask: "WITH THIS REPLY",
  act: "WITH THIS CHANGE",
  note: "WITH THIS NOTE",
};

/**
 * Spec 24 §3.2 — the places picked for this comment and not yet sent, above the
 * reply box.
 *
 * The rows are the selection panel's rows, because a pending place is the same
 * kind of thing as a place in a comment being composed: numbered on from the
 * comment's own places, so the reviewer sees where each one will land.
 */
function PendingStrip({
  items,
  from,
  mode,
  hoveredId,
  onHover,
  onRemove,
  onReorder,
  onGo,
  onNewComment,
}: {
  items: SelectionItem[];
  /** How many places the comment already has. */
  from: number;
  mode: Mode;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onGo: (item: SelectionItem) => void;
  onNewComment: () => void;
}): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null);

  return (
    <div className="rex-pending">
      <div className="rex-pending-head">
        <span className="rex-label">{PENDING_LABEL[mode]}</span>
        <span className="rex-spacer" />
        {/*
          The one escape hatch. A reviewer who selected with a card open and
          meant to start a new comment after all moves the places to the panel
          in one click, where they number from 1.
        */}
        <button
          type="button"
          className="rex-link"
          title="Start a new comment with these places instead of adding them here"
          onClick={onNewComment}
        >
          new comment
          <ChevronRight />
        </button>
      </div>
      <ol className="rex-pending-list">
        {items.map((item, position) => (
          <li
            key={item.id}
            className={
              hoveredId === item.id ? "rex-pending-item rex-pending-lit" : "rex-pending-item"
            }
            // The order is the order the agent is given them in, as in the panel.
            draggable
            onDragStart={() => setDragging(position)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null) onReorder(dragging, position);
              setDragging(null);
            }}
            onMouseEnter={() => onHover(item.id)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="rex-selection-row">
              <button
                type="button"
                className="rex-selection-main"
                title={`Go to this place in ${item.documentName}`}
                onClick={() => onGo(item)}
              >
                <span className="rex-place-index">{from + position + 1}</span>
                <span className="rex-selection-body">
                  <span className="rex-selection-label">{item.label}</span>
                  {/* Always, not only when it differs — spec 05 §3.2. */}
                  <span className="rex-selection-doc">{item.documentName}</span>
                </span>
              </button>
              <button
                type="button"
                className="rex-selection-remove"
                aria-label={`Remove ${item.label}`}
                data-tip="Remove"
                onClick={() => onRemove(item.id)}
              >
                <Trash size={12} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Composer(props: Props): React.JSX.Element {
  const { thread } = props;
  const [reply, setReply] = useState("");
  /**
   * The height of the reply box, once the reviewer has dragged its top edge.
   * Null until then, and the stylesheet decides.
   *
   * It outlives the comment on purpose. This component is not remounted when
   * another comment is opened, so a box dragged tall for a long answer stays
   * tall — the reviewer set the size of a place to type, not a property of one
   * thread.
   */
  const [replyHeight, setReplyHeight] = useState<number | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  /** A reply needs words, and a thread already working takes no second turn. */
  const canSend = !props.busy && reply.trim().length > 0;
  const sendReply = (): void => {
    props.onReply(reply.trim());
    setReply("");
  };
  /**
   * Spec 30 §3.5 — a note's foot is not a comment's foot.
   *
   * A note is text on a place. Nothing about it is a choice between agents, it
   * has no model because nothing runs. So the machinery for sending things is
   * not drawn, and what is left is a plain box and **Save**.
   */
  const noteLane = thread.status === "note";
  const spansDocuments = thread.documentNames.length > 1;
  /** Spec 24 §3.2 — what the send tooltip adds when places go with it. */
  const withPlaces =
    props.pending.length === 0
      ? ""
      : ` with ${props.pending.length} new place${props.pending.length === 1 ? "" : "s"}`;

  return (
    <>
      <ReplyGrip
        box={replyRef}
        above={props.above}
        label="the reply box"
        onChange={setReplyHeight}
      />

      <div className="rex-reply">
        {/*
          Spec 24 §3.2 — the places waiting to go with the next send. Absent
          until the first one lands, and present while the agent works: places
          can be gathered during a run, and `Send` waits as it always has.
        */}
        {props.pending.length > 0 ? (
          <PendingStrip
            items={props.pending}
            from={thread.targets.length}
            mode={props.mode}
            hoveredId={props.hoveredItemId}
            onHover={props.onHoverItem}
            onRemove={props.onRemovePending}
            onReorder={props.onReorderPending}
            onGo={props.onGoToPending}
            onNewComment={props.onPendingToNewComment}
          />
        ) : null}
        <textarea
          className="rex-input"
          ref={replyRef}
          style={replyHeight === null ? undefined : { height: replyHeight }}
          placeholder={props.mode === "act" ? "What should change?" : "Reply to this thread"}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (props.escapeLeavesBox && event.key === "Escape") {
              event.stopPropagation();
              event.currentTarget.blur();
              return;
            }
            // Spec 12 §3.1 — toggle the mode without leaving the box. This is
            // the gesture the whole spec is for: a conversation that started as
            // a question ends in "yes, do that", and that sentence is typed
            // here.
            if (isModeChord(event)) {
              event.preventDefault();
              props.onMode(other(props.mode));
              return;
            }
            onSendChord(canSend, sendReply)(event);
          }}
        />
        <div className="rex-row">
          {/*
            Spec 12 §3.4 — `applyDisabledReason` used to grey out `Apply…`. It
            greys out the ACT segment now, carrying the same sentence, because
            that is where the choice is made.

            Spec 30 §3.5 — neither this nor the pickers is drawn on a note. The
            mode switch offers a choice between agents, and a note has chosen
            none of them; the model picker was already disabled there with "a
            note runs nothing, so it uses no model" (spec 25 §2.3), and a
            permanently disabled control is worse than no control.
          */}
          {noteLane ? null : (
            <ModeSwitch
              mode={props.mode}
              actDisabled={thread.applyEnabled ? null : (thread.applyDisabledReason ?? "")}
              onPick={props.onMode}
            />
          )}
          {/*
            Spec 25 §7.1 — the model, beside the button it sends with. The two
            are one group at the right edge, so when the row wraps they move
            together instead of the button dropping to the left on its own.
          */}
          <span className="rex-row-end">
            {noteLane ? null : (
              <ModelPick
                models={props.models.models}
                value={props.model}
                fallback={props.models.chosen}
                allowDefault
                disabled={
                  props.mode === "note" ? "A note runs nothing, so it uses no model." : null
                }
                error={props.models.error}
                onPick={props.onModel}
              />
            )}
            {/*
              Spec 31 §7.1 — the output style, beside the model, where the
              reviewer asked for it.

              §7.3 — no `Default — …` row. That row exists on the model because
              a model pick can FOLLOW an app-wide default; a style has none to
              follow (§2.2), so `default` is an ordinary choice like the others
              and `allowDefault` is off.
            */}
            {noteLane ? null : (
              <ModelPick
                models={styleRows(props.models.styles)}
                value={props.style}
                fallback={DEFAULT_STYLE}
                allowDefault={false}
                disabled={props.mode === "note" ? "A note runs nothing, so it has no style." : null}
                error={props.models.error}
                onPick={(value) => {
                  if (value !== null) props.onStyle(value);
                }}
              />
            )}
            <button
              type="button"
              className={[
                "rex-button",
                // NOTE is not the send, so it does not wear the send's colour.
                props.mode === "note" ? "rex-button-note" : "rex-primary",
                props.mode === "act" ? "rex-button-write" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={
                props.mode === "act"
                  ? `Make this change in ${thread.documentNames.join(", ")}${withPlaces} — you will see a diff before anything is kept — ${SEND_CHORD_HINT}`
                  : props.mode === "note"
                    ? `Write this down in the comment${withPlaces} — no agent runs, and nothing is spent — ${SEND_CHORD_HINT}`
                    : `Send this reply${withPlaces} — ${SEND_CHORD_HINT}`
              }
              disabled={!canSend}
              onClick={sendReply}
            >
              {props.mode === "act" ? <Pencil /> : null}
              {props.mode === "act" ? "Change" : props.mode === "note" ? "Save" : "Send"}
              <SendChord />
            </button>
          </span>
        </div>

        {/*
          Spec 05 §5.6 — said before the button is pressed, not after. A comment
          about three documents leads to a change in three documents, and the
          reviewer should know that while deciding, not while reading a diff.

          Spec 12 §5 — shown while ACT is selected, which is now when the
          decision is being made. Under ASK it is not yet a decision about
          anything.
        */}
        {props.mode === "act" && spansDocuments && thread.applyEnabled ? (
          <span className="rex-meta">
            This edits {thread.documentNames.join(", ")}. You see every change, in each document,
            before anything is kept.
          </span>
        ) : null}
      </div>
    </>
  );
}
