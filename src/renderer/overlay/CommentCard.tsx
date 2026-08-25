// design/screens/Main — one comment, its answer, and what to do next.
//
// The answer outranks the machinery. Tool steps collapse to a single row and
// keep their own monospace register when opened, so they can never be mistaken
// for the agent's reply; a denied write stays visible in red, because the gate
// firing is worth seeing.

import { useState } from "react";
import { commentName } from "../../shared/names.ts";
import { totalsOf } from "../../shared/totals.ts";
import type { AnchorState, Message, ThreadWithMessages } from "../../shared/types.ts";
import { Bubble, ChevronLeft, ChevronRight, Pencil, Sparkle, Trash } from "./Icons.tsx";
import { onSendChord, SEND_CHORD_HINT, SendChord } from "./keys.tsx";
import { isModeChord, ModeSwitch, other } from "./ModeSwitch.tsx";
import type { Mode } from "./mode.ts";
import { NameBox } from "./NameBox.tsx";
import { placeWords } from "./place.ts";
import { Prose } from "./prose.tsx";
import { StepStrip, stepsOf } from "./StepStrip.tsx";
import { washClass } from "./ThreadRow.tsx";
import { tokenClass } from "./wash.ts";

/** What the sweep found out about one place, or nothing where it could not look. */
export interface PlaceFacts {
  /** What it IS, when its text is not prose — `Code block`, `Table · 3 × 4`. */
  label: string | null;
  /** The line it is on now, from `data-src-line`. */
  line: number | null;
}

interface Props {
  thread: ThreadWithMessages;
  number: number;
  anchorState: AnchorState | null;
  /**
   * The state of each target, in target order — spec 05 §5.4.
   *
   * Null means the sweep could not check it, because its document is not the
   * one on screen. That is emphatically not orphaned, and the card says so in
   * the words the design uses for absence.
   */
  targetStates: Array<AnchorState | null>;
  /** What each target turned out to be and where it now sits, in target order. */
  targetPlaces: PlaceFacts[];
  busy: boolean;
  /**
   * Spec 12 §3.2 — the mode this thread's next send will run in, and the mode
   * the band above the card is showing.
   *
   * A prop rather than `thread.profile`, because the thread's stored profile is
   * `read` for its whole life: an ACT run uses a `write` agent WITHOUT rewriting
   * the row, so a card that read the row would say ASK through the one run that
   * can change a file. §3.3 says where it does live.
   */
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** Spec 08 §6 — true while this comment's trace is covering the pane. */
  tracing: boolean;
  /** Spec 08 §7 — the open document, so a row knows if it has a mark to light. */
  openDocumentId: string | null;
  /** Which place is being pointed at, if any. */
  hoveredPlace: number | null;
  onHoverPlace: (position: number | null) => void;
  onGoToPlace: (position: number) => void;
  onShowTrace: () => void;
  onBack: () => void;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  /** Removes the comment for good. The card confirms before calling it. */
  onDelete: () => void;
  /** Spec 14 §3 — the name. Null puts the note back. */
  onRename: (title: string | null) => void;
}

/** The conversation: what the agent said, and what the reviewer said back. */
function conversation(thread: ThreadWithMessages): Message[] {
  return thread.messages.filter(
    (message) =>
      (message.kind === "text" && message.content) || (message.kind === "error" && message.content),
  );
}

/**
 * Spec 08 §5.3 — a turn, not a message.
 *
 * The SDK emits an answer as several `text` messages, so labelling every one of
 * them `ANSWER` printed the word three times down one reply. A turn is a
 * maximal run of consecutive messages from the same side, which is what a
 * reader means by the word, and it is what the meta strip counts.
 */
/**
 * Three voices, not two.
 *
 * A `system` text message is REX's own notice — the gate refusing a write is
 * one — and it is neither the reviewer's question nor the agent's answer.
 * Folded into the answer it reads as the agent saying it, which is exactly
 * backwards: the notice exists to say the agent was STOPPED.
 */
type Voice = "you" | "agent" | "note";

interface Turn {
  id: string;
  voice: Voice;
  failed: boolean;
  parts: string[];
  durationMs: number;
  costUsd: number;
  /** When the turn began. What a question, which costs nothing, shows instead. */
  at: string;
}

function voiceOf(message: Message): Voice {
  if (message.role === "user") return "you";
  if (message.role === "system") return "note";
  return "agent";
}

function turnsOf(thread: ThreadWithMessages): Turn[] {
  const turns: Turn[] = [];
  for (const message of conversation(thread)) {
    const voice = voiceOf(message);
    const failed = message.kind === "error";
    const open = turns.at(-1);

    if (open && open.voice === voice && open.failed === failed) {
      open.parts.push(message.content ?? "");
      open.durationMs += message.durationMs ?? 0;
      open.costUsd += message.costUsd ?? 0;
      continue;
    }
    turns.push({
      id: message.id,
      voice,
      failed,
      parts: [message.content ?? ""],
      durationMs: message.durationMs ?? 0,
      costUsd: message.costUsd ?? 0,
      at: message.createdAt,
    });
  }
  return turns;
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
function PlaceState({ state }: { state: AnchorState | null }): React.JSX.Element | null {
  if (state === "orphaned") return <span className="rex-state-orphaned">anchor lost</span>;
  if (state === "moved") return <span className="rex-state-moved">text moved</span>;
  // `ok` says nothing: every place that is fine saying "found" is a column of
  // the same word, and the head line already reports the thread's state.
  if (state === "ok") return null;
  return <span className="rex-meta">not checked here</span>;
}

/** "anchored", or "anchored in 3 places" when the comment has several targets. */
function anchoredIn(targets: number): string {
  return targets <= 1 ? "anchored" : `anchored in ${targets} places`;
}

/** Seconds at one decimal below a minute, then whole minutes. */
function seconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}m`;
}

/** 24-hour: the line is tabular mono and `03:34 PM` overflows its column. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Spec 08 §5.2 — what the thread cost, under the answer it bought.
 *
 * NOTHING HERE IS NEW DATA. `Message` has carried `costUsd` and `durationMs`
 * since spec 01; the card simply never drew any of it, so a reviewer could not
 * tell a twelve-second answer from a four-minute one without reading the
 * transcript.
 *
 * It sits in the answer's own footer rather than in a strip above it, because
 * book-keeping read BEFORE the answer is book-keeping in the way of the answer.
 */
function costLine(thread: ThreadWithMessages, turns: number): string {
  // The same helper the trace sheet's head uses, so the two can never disagree.
  const { durationMs: ms, costUsd: cost } = totalsOf(thread.messages);
  return [
    `${turns} turn${turns === 1 ? "" : "s"}`,
    ms > 0 ? seconds(ms) : null,
    cost > 0 ? `$${cost.toFixed(3)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Spec 08 §5.3 — a turn is a block, not another paragraph in a run.
 *
 * `YOU ASKED` rather than `YOU`, because the two labels on this card are read
 * as a pair and `YOU`/`ANSWER` names one by its speaker and the other by its
 * function — so neither says which came first. The verb does.
 *
 * The answer is the one block here that is a raised, bordered card: it outranks
 * the machinery, and on a column this narrow a difference in text colour alone
 * did not survive being scrolled past.
 *
 * Spec 12 §7.1 — it no longer carries a profile pill. That pill was drawn on a
 * FINISHED answer, so it appeared exactly when it was least needed and was
 * absent during the run, which is when a refusal happens. The mode lives on the
 * switch beside Send, which is pinned, always on screen, and the place the mode
 * is chosen. One card, one mode, one place.
 */
const VOICE_LABEL: Record<Voice, string> = { you: "YOU ASKED", agent: "ANSWER", note: "NOTE" };

function TurnBlock({
  turn,
  footer,
}: {
  turn: Turn;
  /** The thread's cost, on the last answer only. */
  footer: string | null;
}): React.JSX.Element {
  const answer = turn.voice === "agent" && !turn.failed;
  const tone = turn.failed ? "error" : turn.voice;

  return (
    <div className={`rex-turn rex-turn-${tone}`}>
      <div className="rex-turn-head">
        {answer ? <Sparkle /> : turn.voice === "you" ? <Bubble size={12} /> : null}
        <span className="rex-label">{turn.failed ? "ERROR" : VOICE_LABEL[turn.voice]}</span>
        <span className="rex-spacer" />
        <span className="rex-turn-spent">{clock(turn.at)}</span>
      </div>

      {answer ? (
        // Joined before rendering, not rendered part by part. The SDK splits
        // one answer across several `text` messages at arbitrary points, and a
        // fenced code block opened in one part and closed in the next only
        // parses if the parser sees both.
        <Prose text={turn.parts.join("\n\n")} />
      ) : (
        turn.parts.map((part, position) => (
          // The reviewer's own words, REX's notices and errors stay verbatim.
          // What the reviewer typed is what was sent to the agent, and showing
          // it back with the markers reinterpreted would misreport that.
          //
          // Position is the identity: the parts of one turn arrive in order and
          // are never reordered, added to or removed.
          <p key={`${turn.id}-${position}`} className="rex-turn-text">
            {part}
          </p>
        ))
      )}

      {footer ? <div className="rex-turn-foot">{footer}</div> : null}
    </div>
  );
}

/**
 * Spec 05 §3.2 and §5.4 — one place, saying where it is and what is there.
 *
 * The line above the quote is the change this row exists for. "re-found after
 * the file changed" is true and useless on its own: it tells a reviewer that
 * something moved and gives them nowhere to look. `components.md · L41 was L37`
 * is the same fact with an address on it.
 */
function PlaceRow({
  thread,
  position,
  facts,
  state,
  here,
  lit,
  onHover,
  onGo,
}: {
  thread: ThreadWithMessages;
  position: number;
  facts: PlaceFacts;
  state: AnchorState | null;
  here: boolean;
  lit: boolean;
  onHover: (position: number | null) => void;
  onGo: () => void;
}): React.JSX.Element {
  const target = thread.targets[position];
  const anchor = target?.anchor;
  const { label, quote } = anchor ? placeWords(anchor, facts.label) : { label: null, quote: null };

  // Where it was when the comment was written, and where it is now. They differ
  // only when the file changed underneath — which is precisely when saying so
  // is worth the width.
  const was = anchor?.source?.line ?? null;
  const now = facts.line;
  const moved = now !== null && was !== null && now !== was;
  const line = now ?? was;

  const name = thread.targetNames[position] ?? "";

  return (
    <li
      className={lit ? "rex-place rex-place-lit" : "rex-place"}
      onMouseEnter={() => onHover(here ? position : null)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="rex-place-head">
        {thread.targets.length > 1 ? (
          <span className="rex-place-index rex-place-index-active">{position + 1}</span>
        ) : null}
        <span className="rex-place-doc">
          {name}
          {line !== null ? <span className="rex-place-line"> · L{line}</span> : null}
          {moved ? <span className="rex-place-was"> was L{was}</span> : null}
        </span>
        <PlaceState state={state} />
        <button
          type="button"
          className="rex-link"
          title={here ? "Scroll to this place" : `Open ${name || "it"} and scroll there`}
          onClick={onGo}
        >
          go to
          <ChevronRight />
        </button>
      </div>

      {/*
        The one rule this card breaks a spec-01 habit for: a place is quoted
        only when it holds prose. `place.ts` decides, and the alternative was a
        flattened code block set in italic serif claiming to be a sentence.
      */}
      {quote ? (
        <blockquote className="rex-quote rex-quote-small">{quote}</blockquote>
      ) : label ? (
        <span className="rex-place-kind">{label}</span>
      ) : null}
    </li>
  );
}

export function CommentCard(props: Props): React.JSX.Element {
  const [reply, setReply] = useState("");
  /** Spec 14 §3.3 — the name box, open over the card's own title. */
  const [renaming, setRenaming] = useState(false);
  /** A reply needs words, and a thread already working takes no second turn. */
  const canSend = !props.busy && reply.trim().length > 0;
  const sendReply = (): void => {
    props.onReply(reply.trim());
    setReply("");
  };
  const { thread } = props;
  const steps = stepsOf(thread);
  const turns = turnsOf(thread);
  const spansDocuments = thread.documentNames.length > 1;
  // The cost rides the LAST answer, so a long thread reports itself once, at
  // the bottom, beside the reply box the reviewer is about to use.
  const lastAnswer = turns.findLast((turn) => turn.voice === "agent" && !turn.failed);

  /**
   * The note is what the reviewer wrote, and `threadAsk` sends it verbatim as
   * the conversation's first message — so an asked comment printed it twice,
   * once in the anchor block and again under `YOU ASKED` three lines below.
   *
   * The conversation is where it belongs, because that is where the reply to it
   * is. The anchor block keeps it only while there is no conversation yet:
   * a comment that has not been asked would otherwise show its places, its
   * state, and no hint of what it actually says.
   *
   * Matched against the opening turn rather than assumed from `turns.length`,
   * so a thread whose first message is anything else still shows its note.
   */
  const opening = turns[0];
  const noteInConversation =
    opening?.voice === "you" && opening.parts[0]?.trim() === thread.note.trim();

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

        {/*
          Deliberately here and not beside Send / Resolve / Apply. Those three
          are the things a reviewer reaches for constantly, and the one control
          in this card that cannot be undone should not share a row with them.
        */}
        <button
          type="button"
          className="rex-icon-button rex-icon-danger"
          aria-label="Delete this comment"
          title="Delete this comment and its whole conversation"
          onClick={() => {
            // The count is in the question because it is the part that stings:
            // "delete this comment" sounds like one line, and a thread that
            // cost four minutes and a dollar is what actually goes.
            const messages = thread.messages.length;
            const detail =
              messages > 0 ? ` and its ${messages} message${messages === 1 ? "" : "s"}` : "";
            if (window.confirm(`Delete this comment${detail}? This cannot be undone.`)) {
              props.onDelete();
            }
          }}
        >
          <Trash />
        </button>

        {thread.status === "resolved" ? (
          <span className="rex-pill rex-pill-ok">RESOLVED</span>
        ) : props.anchorState === "orphaned" ? (
          <span className="rex-pill rex-pill-lost">ANCHOR LOST</span>
        ) : props.anchorState === "moved" ? (
          <span className="rex-pill rex-pill-moved">TEXT MOVED</span>
        ) : null}
      </header>

      {/*
        Pinned, above the conversation: the places the comment is about, and the
        strip that opens the trace.

        Both answer a question a reviewer asks WHILE reading an answer — "which
        passage is this about" and "what did it actually run" — and both used to
        sit at the two ends of one scrolling column, so a long answer pushed one
        off the top and the other off the bottom. Only the conversation scrolls
        now.

        The list of places is the part that can grow, so it is the part that is
        capped and scrolls inside itself. The strip is one row and stays outside
        that cap — a control that can be scrolled out of the pinned area is not
        pinned.
      */}
      <div className="rex-card-head">
        <div
          className={`rex-card-anchor rex-card-places ${washClass(thread.status, props.anchorState, thread.isNote)}`}
        >
          {/*
            Spec 14 §3.4 — the name, and the same pen the row carries. Renaming
            from the open card is the same act as renaming from the list, so it
            is the same control and the same box.
          */}
          <div className="rex-card-title">
            {renaming ? (
              <NameBox
                value={commentName(thread)}
                label={`Name for comment ${props.number}`}
                allowEmpty
                onSave={(title) => {
                  props.onRename(title);
                  setRenaming(false);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <>
                <h2 className="rex-card-name">{commentName(thread)}</h2>
                <button
                  type="button"
                  className="rex-row-pen"
                  aria-label={`Rename comment ${props.number}`}
                  title="Rename this comment"
                  onClick={() => setRenaming(true)}
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
          </div>

          <div className="rex-card-anchor-head">
            <span
              className={`rex-token ${tokenClass(thread.status, props.anchorState, thread.isNote)}`}
            >
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

          {/*
            Spec 05 §3.2, §5.3 and §5.4 — every place, in one list: which
            document, which line, how it resolved, and what is actually there.

            One row per place even when there is only one. The single-place card
            used to say the document on one line and quote it on another with no
            connection drawn between them, and a comment about three places
            showed one quote and claimed a single state for all of them.
          */}
          <ol className="rex-places">
            {thread.targets.map((target, position) => (
              <PlaceRow
                key={`${target.documentId}-${position}`}
                thread={thread}
                position={position}
                facts={props.targetPlaces[position] ?? { label: null, line: null }}
                state={props.targetStates[position] ?? null}
                // Spec 08 §7.3 — a place in a document that is not open has
                // nothing to light. Clicking it opens that document instead.
                here={target.documentId === props.openDocumentId}
                lit={props.hoveredPlace === position}
                onHover={props.onHoverPlace}
                onGo={() => props.onGoToPlace(position)}
              />
            ))}
          </ol>

          {noteInConversation ? null : <p className="rex-card-note">{thread.note}</p>}
        </div>

        {/*
          The strip, at the head of the conversation and only there. A run of 32
          steps buries a closing strip under the answer it produced, and "what
          did the agent touch" is asked most often while that answer is still
          being read. A second copy below the transcript said the same thing
          twice and sat between the answer and the reply box.
        */}
        {steps.length > 0 ? (
          <StepStrip steps={steps} tracing={props.tracing} onShowTrace={props.onShowTrace} />
        ) : null}
      </div>

      <div className="rex-card">
        {turns.map((turn) => (
          <TurnBlock
            key={turn.id}
            turn={turn}
            footer={turn.id === lastAnswer?.id ? costLine(thread, turns.length) : null}
          />
        ))}

        {props.busy ? (
          <span className="rex-working">
            <span className="rex-spinner" />
            working…
          </span>
        ) : null}
      </div>

      <div className="rex-reply">
        <textarea
          className="rex-input"
          placeholder={props.mode === "act" ? "What should change?" : "Reply to this thread"}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
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
          */}
          <ModeSwitch
            mode={props.mode}
            actDisabled={thread.applyEnabled ? null : (thread.applyDisabledReason ?? "")}
            onPick={props.onMode}
          />
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
                ? `Make this change in ${thread.documentNames.join(", ")} — you will see a diff before anything is kept — ${SEND_CHORD_HINT}`
                : props.mode === "note"
                  ? `Write this down in the comment — no agent runs, and nothing is spent — ${SEND_CHORD_HINT}`
                  : `Send this reply — ${SEND_CHORD_HINT}`
            }
            disabled={!canSend}
            onClick={sendReply}
          >
            {props.mode === "act" ? <Pencil /> : null}
            {props.mode === "act" ? "Change" : props.mode === "note" ? "Save" : "Send"}
            <SendChord />
          </button>
          <span className="rex-spacer" />
          <button
            type="button"
            className="rex-button"
            disabled={props.busy}
            onClick={() => props.onResolve(thread.status === "open")}
          >
            {thread.status === "open" ? "Resolve" : "Reopen"}
          </button>
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
