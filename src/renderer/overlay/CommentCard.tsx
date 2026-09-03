// design/screens/Main — one comment, its answer, and what to do next.
//
// The answer outranks the machinery. Tool steps collapse to a single row and
// keep their own monospace register when opened, so they can never be mistaken
// for the agent's reply; a denied write stays visible in red, because the gate
// firing is worth seeing.

import { useLayoutEffect, useRef, useState } from "react";
import { commentName } from "../../shared/names.ts";
import { type PlaceTally, threadState } from "../../shared/targets.ts";
import { totalsOf } from "../../shared/totals.ts";
import type {
  AgentChoices,
  AnchorState,
  Message,
  ModelChoice,
  SendMode,
  ThreadWithMessages,
} from "../../shared/types.ts";
import { agentText } from "./aside.ts";
import { Composer } from "./Composer.tsx";
import { CopyText } from "./CopyText.tsx";
import { DebugCopy } from "./DebugCopy.tsx";
import { Bubble, ChevronLeft, ChevronRight, Pencil, Sparkle, StopSquare, Trash } from "./Icons.tsx";
import { modelLabel } from "./ModelPick.tsx";
import { MODE_LABEL, type Mode } from "./mode.ts";
import { NameBox } from "./NameBox.tsx";
import { PlaceRow } from "./PlaceRow.tsx";
import { type PlaceFacts, placesByMessage } from "./placeLine.ts";
import { Prose } from "./prose.tsx";
import { RunNums, StepBars, stepsOf } from "./StepStrip.tsx";
import type { SelectionItem } from "./selection.ts";
import { cornerWord } from "./ThreadRow.tsx";
import { ToolRow } from "./ToolRow.tsx";
import { toolRowsOf } from "./toolRows.ts";
import { tokenClass, washClass } from "./wash.ts";

interface Props {
  thread: ThreadWithMessages;
  number: number;
  /** Spec 32 §5 — how this comment's places came out, counted. */
  tally: PlaceTally;
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
  /** Spec 17 §3.3 — Stop has been pressed and the run has not ended yet. */
  stopping: boolean;
  /** Ends every run this comment has. Spec 17 §2.1. */
  onStop: () => void;
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
  /**
   * Spec 25 §7.1 — the models on offer, and this comment's own pick.
   *
   * `model: null` is "follow the default in the top bar", and it is what every
   * comment does until the reviewer changes it here. Renderer state, like the
   * mode: it is what the NEXT send will do.
   */
  models: AgentChoices;
  model: string | null;
  onModel: (model: string | null) => void;
  /**
   * Spec 31 §2.1 — the output style this chat is having, and it is a plain
   * string, never null: a chat is always having one, and `default` is its name.
   */
  style: string;
  onStyle: (style: string) => void;
  /** Spec 08 §6 — true while this comment's trace is covering the pane. */
  tracing: boolean;
  /** Spec 08 §7 — the open document, so a row knows if it has a mark to light. */
  openDocumentId: string | null;
  /** Which place is being pointed at, if any. */
  hoveredPlace: number | null;
  onHoverPlace: (position: number | null) => void;
  onGoToPlace: (position: number) => void;
  /**
   * Spec 24 §3.2 — places picked for this comment and not yet sent, in strip
   * order. They go with the next send, whatever its mode. Empty for a synthesis
   * comment, which takes none.
   */
  pending: SelectionItem[];
  /** The pending place being pointed at, here or on its outline in the document. */
  hoveredItemId: string | null;
  onHoverItem: (id: string | null) => void;
  onRemovePending: (id: string) => void;
  onReorderPending: (from: number, to: number) => void;
  /** A strip row, clicked: scroll to it, opening its document if it must. */
  onGoToPending: (item: SelectionItem) => void;
  /** `new comment ›` — the places move to the selection panel instead. */
  onPendingToNewComment: () => void;
  onShowTrace: () => void;
  /** Spec 30 §3.5 — **Turn into a comment**: this note becomes a draft. */
  onPromote: () => void;
  onBack: () => void;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  /** Removes the comment for good. The card confirms before calling it. */
  onDelete: () => void;
  /** Spec 14 §3 — the name. Null puts the note back. */
  onRename: (title: string | null) => void;
}

/**
 * The conversation: what the agent said, and what the reviewer said back.
 *
 * Spec 17 §3.2 — and the stop, which is neither. A thread whose last turn
 * trails off in the middle of a tool call is unreadable a week later without
 * it: the one question the reader has is whether it broke or whether they
 * stopped it, and only this row answers.
 */
// Spec 34 §6.1 — and the reviewer's approve, discard or undo, which is a fact
// about the document the conversation is about. A system row, so it wears the
// NOTE mark like every other thing REX reports.
const IN_CONVERSATION = new Set<Message["kind"]>(["text", "error", "stopped", "event"]);

function conversation(thread: ThreadWithMessages): Message[] {
  return thread.messages.filter((message) => IN_CONVERSATION.has(message.kind) && message.content);
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
 * Five voices, not two.
 *
 * A `system` text message is REX's own notice — the gate refusing a write is
 * one — and it is neither the reviewer's question nor the agent's answer.
 * Folded into the answer it reads as the agent saying it, which is exactly
 * backwards: the notice exists to say the agent was stopped.
 *
 * Spec 17 §3.2 — `stopped` is the fourth, and it is separate from `note` for
 * the same reason `note` is separate from `agent`. A notice is REX reporting
 * something; a stop is the reviewer's own act, and it gets its own mark.
 *
 * `aside` is the fifth, and it is the agent's own voice in the one case where
 * what it says is not the answer: it spoke, worked, and spoke again. `aside.ts`
 * carries the rule and what it cost to find.
 */
type Voice = "you" | "agent" | "aside" | "note" | "stopped";

interface Turn {
  id: string;
  voice: Voice;
  failed: boolean;
  parts: string[];
  durationMs: number;
  costUsd: number;
  /** When the turn began. What a question, which costs nothing, shows instead. */
  at: string;
  /**
   * Spec 12 §3.3 — the mode this turn was sent in, for a turn the reviewer
   * sent. Null on an answer, on a notice, and on a message written before the
   * mode was recorded.
   */
  mode: SendMode | null;
  /**
   * Spec 25 §7.3 — the model that wrote this turn, or null for a turn no model
   * was involved in: a NOTE, a notice from REX, and every message written
   * before the column existed.
   */
  model: string | null;
  /** Spec 31 §5 — and the output style it was written in. Null, the same way. */
  style: string | null;
  /**
   * Spec 24 §3.4 — the messages this turn is made of, so the places that
   * arrived with any of them can be drawn under it. A `YOU` turn is usually one
   * message; two sends with no answer between them are one turn and two ids.
   */
  messageIds: string[];
}

function voiceOf(message: Message, asides: Set<string>): Voice {
  if (message.kind === "stopped") return "stopped";
  if (message.role === "user") return "you";
  if (message.role === "system") return "note";
  return asides.has(message.id) ? "aside" : "agent";
}

/**
 * Spec 08 §5.3 — `2 turns` means two voices spoke. An aside is the same voice
 * speaking twice in one run, so counting it would report a thread as longer
 * than the reader can see it is. The card's run line and the trace head (spec
 * 38 §2) both say this number, from here, so they cannot disagree.
 */
export function spokenTurnsOf(thread: ThreadWithMessages): number {
  return turnsOf(thread).filter((turn) => turn.voice !== "aside").length;
}

function turnsOf(thread: ThreadWithMessages): Turn[] {
  // Computed over the RAW messages, because both questions it answers are about
  // the tool rows `conversation` throws away.
  const { asides, breaks } = agentText(thread.messages);
  const turns: Turn[] = [];
  for (const message of conversation(thread)) {
    const voice = voiceOf(message, asides);
    const failed = message.kind === "error";
    const open = turns.at(-1);

    // Spec 12 §3.3 — a change of MODE ends a turn, exactly as a change of voice
    // does. Two sends with no answer between them are one run of user messages,
    // and merging them would label the pair by the first one's mode: a note
    // followed by a change read as one long note. Measured on 2026-08-26.
    //
    // Tool work ends one too, and for the same reason one voice down: two
    // asides with a Read between them are two things said at two times, and
    // this filter has already made them neighbours.
    if (
      open &&
      open.voice === voice &&
      open.failed === failed &&
      open.mode === message.mode &&
      !breaks.has(message.id)
    ) {
      open.parts.push(message.content ?? "");
      open.durationMs += message.durationMs ?? 0;
      open.costUsd += message.costUsd ?? 0;
      open.messageIds.push(message.id);
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
      // Every message in a turn now shares this, because the test above breaks
      // the turn when it changes.
      mode: message.mode,
      // Spec 25 §7.3 — the model does NOT break a turn. It cannot change inside
      // one: every message a run produces is stamped with the run's own model,
      // so the first message's is the turn's.
      model: message.model,
      // Spec 31 §5 — like the model, it cannot change inside a turn: every
      // message a run produces is stamped with the run's own style.
      style: message.style,
      messageIds: [message.id],
    });
  }
  return turns;
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
 * Spec 08 §5.3 — a turn is a block, not another paragraph in a run.
 *
 * `YOU` names the speaker; the pill beside it names the mode. An earlier build
 * carried the verb instead — `YOU ASKED` — because `YOU`/`ANSWER` names one
 * side by its speaker and the other by its function, and neither said which
 * came first. The pill settles that better than a verb could: it says which of
 * the three the reviewer pressed, in that mode's own colour.
 *
 * The answer is the one block here that is a raised, bordered card: it outranks
 * the machinery, and on a column this narrow a difference in text colour alone
 * did not survive being scrolled past.
 *
 * Spec 12 §7.1 — the pill this is NOT is the old profile pill, which was drawn
 * on a FINISHED answer: it appeared exactly when it was least needed and was
 * absent during the run, which is when a refusal happens. This one is on the
 * reviewer's own message and records what they chose before anything ran.
 */
const VOICE_LABEL: Record<Voice, string> = {
  you: "YOU",
  agent: "ANSWER",
  aside: "ASIDE",
  note: "NOTE",
  stopped: "STOPPED",
};

/**
 * Spec 41 §2 — what the copy button calls this block, in its own tooltip.
 *
 * The label above it is already on the screen, so the word here is the one a
 * sentence needs — "Copy this question", not "Copy this YOU".
 */
const VOICE_THING: Record<Voice, string> = {
  you: "question",
  agent: "answer",
  aside: "remark",
  note: "notice",
  stopped: "stop",
};

/**
 * Spec 12 §3.3 — the reviewer's own turn is `YOU`, and a pill says which mode
 * they were in.
 *
 * A phrase was tried first — `YOU ASKED TO ACT`, `YOU NOTED` — and a pill is
 * better for the reason the mode switch is a switch: the reviewer PICKED one of
 * three named things, and the label that reads back to them should be the same
 * three names in the same three colours. `ASK` beside `YOU` is the word they
 * pressed; "asked to act" is a sentence about it.
 *
 * A message with no recorded mode gets no pill at all — see
 * `migrateMessageMode`. `YOU` on its own is the honest look for "nobody wrote
 * it down", and inventing a third state for it would say more than is known.
 */

/** Spec 24 §3.4 — one place a turn brought with it, as its chip. */
interface PlaceChip {
  /** Its index in `thread.targets` — what `onGoToPlace` takes. */
  position: number;
  /** The file name. */
  name: string;
}

function TurnBlock({
  turn,
  places,
  models,
  onGoToPlace,
}: {
  turn: Turn;
  /** Spec 24 §3.4 — the places this turn added to the comment. Usually none. */
  places: PlaceChip[];
  /** Spec 25 §7.3 — to turn the stored value into the name it was picked by. */
  models: ModelChoice[];
  onGoToPlace: (position: number) => void;
}): React.JSX.Element {
  const answer = turn.voice === "agent" && !turn.failed;
  // An aside is the agent's own words too, so it is Markdown and is rendered as
  // Markdown. What it is not is the answer, so it gets none of the answer's
  // chrome: no card, no sparkle, no model, no cost.
  const markdown = answer || turn.voice === "aside";
  const tone = turn.failed ? "error" : turn.voice;
  // §3.3 — the reviewer's own turn wears its mode's colour, the same three the
  // switch beside Send uses. Anything else keeps the tone it had.
  const sent = turn.voice === "you" && !turn.failed ? turn.mode : null;
  // Joined once, drawn once and copied once. The SDK splits one answer across
  // several `text` messages at arbitrary points, and a fenced code block opened
  // in one part and closed in the next only parses if the parser sees both —
  // which is spec 41 §3.3's reason for the card copying a whole TURN.
  const text = turn.parts.join("\n\n");

  return (
    <div className={`rex-turn rex-turn-${tone}`}>
      <div className="rex-turn-head">
        {answer ? (
          <Sparkle />
        ) : turn.voice === "you" ? (
          <Bubble size={12} />
        ) : turn.voice === "stopped" ? (
          <StopSquare size={8} />
        ) : null}
        <span className="rex-label">{turn.failed ? "ERROR" : VOICE_LABEL[turn.voice]}</span>
        {sent ? <span className={`rex-sent rex-sent-${sent}`}>{MODE_LABEL[sent]}</span> : null}
        <span className="rex-spacer" />
        <span className="rex-turn-spent">{clock(turn.at)}</span>
        {/*
          Spec 41 §2.1 — outside the clock, which keeps the column it has. The
          cell is always here and the glyph is not: it comes up when the pointer
          is over the block, so a column of turns is not a column of glyphs.
        */}
        <CopyText text={text} what={turn.failed ? "error" : VOICE_THING[turn.voice]} />
      </div>

      {markdown ? (
        <Prose text={text} />
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

      {/*
        Spec 24 §3.4 — which places came with THIS message. The head lists every
        place the comment has; this row is what makes the conversation readable
        later, because it says which message brought each one. Violet, like the
        head's rows: by now they are the comment's places.
      */}
      {places.length > 0 ? (
        <div className="rex-turn-places">
          {places.map((chip) => (
            <button
              key={chip.position}
              type="button"
              className="rex-turn-place"
              title={`Go to place ${chip.position + 1} in ${chip.name}`}
              onClick={() => onGoToPlace(chip.position)}
            >
              <span className="rex-place-index rex-place-index-active">{chip.position + 1}</span>
              {chip.name}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        Spec 25 §7.3 — which model wrote this, in the answer's own foot.

        It was beside `ANSWER` in the head first, and the reviewer asked for it
        here (2026-09-01): the foot is already where the facts ABOUT a turn live
        — how many turns, how long, what it cost — and the model is one of them.
        The head names the speaker; the foot says what the speaking cost.

        First in the line, and one step brighter than the numbers beside it.
        Order and brightness are the whole treatment: no pill and no colour. A
        pill in REX means the mode the reviewer picked (spec 12 §7.1) and a
        colour means one of spec 18's seven facts, so borrowing either here
        would spend a word from a vocabulary that is already saying something
        else.

        **Every** answer carries the line. The model is per-turn, and a thread
        whose turns ran on different models is exactly the thread that needs to
        say so. The thread's own numbers — turns, time, cost — rode the LAST
        answer's foot until spec 36 §2 moved them to the head's run line: they
        are about the whole chat, and they hung on whichever answer was last.

        Spec 31 §5 — and the output style beside it, in the same register, on
        the reviewer's ask (2026-09-02). 1.0 recorded the style and drew it
        nowhere, reasoning that a fifth item earns less than it costs. That was
        wrong about which items are which: the model and the style are both
        answers to "what produced this", and the numbers are what it cost. The
        pair reads as one fact in two words, and then the price.

        `default` is drawn like any other name. It is a real answer to "which
        style was used", and hiding it would make a line that appears and
        disappears depending on a value the reviewer cannot see.
      */}
      {answer && (turn.model || turn.style) ? (
        <div className="rex-turn-foot">
          {turn.model ? (
            <span className="rex-foot-model" title="The model that wrote this answer">
              {modelLabel(models, turn.model, turn.model)}
            </span>
          ) : null}
          {turn.model && turn.style ? " · " : null}
          {turn.style ? (
            <span className="rex-foot-style" title="The output style this answer was written in">
              {turn.style}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CommentCard(props: Props): React.JSX.Element {
  /** Spec 14 §3.3 — the name box, open over the card's own title. */
  const [renaming, setRenaming] = useState(false);
  /**
   * Spec 35 §2.4 — the place list, folded or not. Null is "the default rule":
   * open for one or two places, folded above that. The choice lasts while the
   * card is on this comment and resets on the next one.
   */
  const [placesOpen, setPlacesOpen] = useState<boolean | null>(null);
  const { thread, tally } = props;
  // Spec 32 §2 — the colour follows the comment's LANE and the words follow its
  // places, so a part-lost comment washes amber under a grey `1 of 4 lost`.
  const anchorState = threadState(tally);
  /**
   * Spec 30 §3.5 — a note's card is not a comment's card.
   *
   * A note is text on a place. Nothing about it is a choice between agents, it
   * has no model because nothing runs, and it has nothing to trace. So the
   * machinery for sending things is not drawn, and what is left is the places,
   * the words, delete, and the one button that changes its mind.
   */
  const noteLane = thread.status === "note";
  const steps = stepsOf(thread);
  const turns = turnsOf(thread);

  /**
   * Spec 24 §3.4 — which places each user message brought, by message id.
   *
   * Spec 37 §3 — `messageId` is null on every place the comment started with,
   * and those are the FIRST `YOU` turn's: the message `threadAsk` sends
   * verbatim as the conversation's opening was about them. They hung on no
   * turn until now, so the first message showed none of its places and the
   * second showed its two. `placesByMessage` is the rule, shared with the
   * trace sheet (spec 38 §3.2) so the two cannot disagree.
   */
  const places = placesByMessage(thread.targets);
  const chipOf = (position: number): PlaceChip => ({
    position,
    name: thread.targetNames[position] ?? "",
  });
  const firstYou = turns.find((turn) => turn.voice === "you");
  const placesOf = (turn: Turn): PlaceChip[] =>
    [
      ...(turn === firstYou ? places.startedWith : []),
      ...turn.messageIds.flatMap((id) => places.byMessage.get(id) ?? []),
    ].map(chipOf);

  // Spec 08 §5.3 — `2 turns` means two voices spoke. An aside is the same voice
  // speaking twice in one run, so counting it would report a thread as longer
  // than the reader can see it is.
  const spokenTurns = turns.filter((turn) => turn.voice !== "aside").length;
  // Spec 36 §2 — the whole chat's numbers, from the same helper the trace
  // sheet's head uses, so the two can never disagree.
  const totals = totalsOf(thread.messages);
  // Spec 36 §3.2 — the tool calls between the turns, keyed by the turn each
  // row comes before, and the ones after the last turn.
  const toolRows = toolRowsOf(thread.messages, new Set(turns.map((turn) => turn.id)));

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

  /**
   * The conversation opens at its END, not at its beginning.
   *
   * A comment is opened to read the newest answer — that is the whole reason
   * the reviewer clicked it — and the column showed the question that started
   * the thread instead, with the answer several screens below the fold. The
   * head above this scroller already carries the places and the note, so
   * nothing is lost by starting at the foot: the part that would have been on
   * screen is pinned anyway.
   */
  const cardRef = useRef<HTMLDivElement>(null);

  /**
   * True while the foot of the conversation is on screen.
   *
   * It decides whether a message that arrives DURING a run follows. Scrolling
   * up is the reviewer reading something earlier, and yanking them back to the
   * bottom every time a `text` message lands makes that impossible — so the
   * moment they leave the foot, REX stops moving the column and waits.
   */
  const atFoot = useRef(true);

  // A different comment is a different conversation: it starts at its foot,
  // whatever the last one was doing when it was closed — and its place list
  // starts at the default rule (§2.4).
  useLayoutEffect(() => {
    atFoot.current = true;
    setPlacesOpen(null);
  }, [thread.id]);

  // Runs after EVERY render, because there is no one dependency for "the
  // conversation got taller": a turn arrives, a turn grows a part, the running
  // row appears and disappears. `useLayoutEffect` and not `useEffect`, so the
  // jump happens before the browser paints — with `useEffect` the top of the
  // thread is drawn first and the column visibly snaps.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card && atFoot.current) card.scrollTop = card.scrollHeight;
  });

  /**
   * Spec 35 §2.1 — the lane word at the right of the title row: the same rule
   * the list row's corner reads, so the card and the row cannot disagree about
   * one comment. `working…` is not among them — the conversation says that,
   * with the button that stops it.
   */
  const word = cornerWord(thread, anchorState);
  const showPlaces = placesOpen ?? thread.targets.length <= 2;

  return (
    <>
      <header className="rex-side-head">
        <button type="button" className="rex-link" onClick={props.onBack}>
          <ChevronLeft />
          all comments
        </button>
        <span className="rex-spacer" />

        {/*
          Resolve belongs to the WHOLE comment, so it sits with the controls
          that do — the name, the delete — and not at the foot of the card.

          The foot is the composer: a box to type in, the mode the next send
          runs under, and the send itself. They are one gesture read top to
          bottom, and a button underneath them that ends the conversation
          instead of continuing it reads as the last step of writing a reply.
          Measured against the reviewer's own reaction on 2026-08-26: "it feels
          unnatural to have the Resolve button below it."

          It is a plain button rather than an icon, because unlike delete it
          has two states and the word is what tells them apart.
        */}
        {/*
          Spec 30 §3.5 — a note leaves its lane by being UPGRADED, not resolved.

          Resolve means "dealt with", and a note was never a question waiting on
          anybody, so there is nothing for it to be dealt with about. What a note
          actually needs is the other direction: the remark turned out to be
          worth asking about, and this is the button that says so. It keeps every
          place and every word, which is the whole point — the alternative is
          retyping it as a new comment.
        */}
        {noteLane ? (
          <button
            type="button"
            className="rex-head-button"
            disabled={props.busy}
            title="Turn this note into a comment you can ask about — it keeps its places and its words"
            onClick={props.onPromote}
          >
            Turn into a comment
          </button>
        ) : (
          <button
            type="button"
            className="rex-head-button"
            disabled={props.busy}
            title={
              thread.status === "open"
                ? "Mark this comment resolved — it stays in the list, under the resolved filter"
                : "Reopen this comment"
            }
            onClick={() => props.onResolve(thread.status === "open")}
          >
            {thread.status === "open" ? "Resolve" : "Reopen"}
          </button>
        )}

        {/*
          Spec 08 §6.2 — this comment's debug report, where the reviewer is when
          they decide something is wrong.

          The same button as the trace sheet's, and the same report. It is here
          as well because the sheet is a click away and the card is not: a
          reviewer reading a bad answer is looking at THIS row, and what they
          need next is the run's ids in the clipboard so they can paste them and
          ask why. Icon only — this row is icons, and the word `debug` is what
          the sheet's wider head has space for.
        */}
        <DebugCopy threadId={thread.id} className="rex-icon-button rex-debug" />

        {/*
          Deliberately here and not beside Send / Apply. Those are the things a
          reviewer reaches for constantly, and the one control in this card that
          cannot be undone should not share a row with them.
        */}
        <button
          type="button"
          className="rex-icon-button rex-icon-danger"
          aria-label="Delete this comment"
          data-tip="Delete"
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
      </header>

      {/*
        Pinned, above the conversation — spec 35 §2: the list row, opened.

        The title, the run and the places answer the questions a reviewer asks
        WHILE reading an answer — which comment, what did it run, which passages
        — so none of them scrolls with the answer. Only the place list can grow,
        so only it is capped and scrolls inside itself; the title and the run
        never do. The head sits on the well's ground with a shadow onto the
        conversation (§2.6), so the two stop reading as one column.
      */}
      <div className="rex-card-head">
        <div className={`rex-card-anchor ${washClass(thread.status, anchorState)}`}>
          {/*
            Spec 14 §3.4 — the name, and the same pen the row carries. Renaming
            from the open card is the same act as renaming from the list, so it
            is the same control and the same box. The token sits before the
            name, as it does on the row.
          */}
          <div className="rex-card-title">
            <span className={`rex-token ${tokenClass(thread.status, anchorState)}`}>
              {props.number}
            </span>
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
                  data-tip="Rename"
                  onClick={() => setRenaming(true)}
                >
                  <Pencil size={12} />
                </button>
                {word ? (
                  <span className={`rex-card-word ${word.className}`}>{word.text}</span>
                ) : null}
              </>
            )}
          </div>

          {/*
            Spec 35 §2.2 — the run, as the list row draws it, and `show trace ›`
            at its right end. It opens the trace (spec 08 §6), which takes the
            document pane. The bordered strip that used to sit under the head
            is gone: this line is the strip.
          */}
          {steps.length > 0 ? (
            <div className="rex-card-run">
              <StepBars steps={steps} />
              <RunNums steps={steps} />
              {/*
                Spec 36 §2 — the whole chat's numbers, on the line that
                measures its machinery. They were the last answer's foot.
              */}
              <span className="rex-card-totals">
                {[
                  `${spokenTurns} turn${spokenTurns === 1 ? "" : "s"}`,
                  totals.durationMs > 0 ? seconds(totals.durationMs) : null,
                  totals.costUsd > 0 ? `$${totals.costUsd.toFixed(3)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <button
                type="button"
                className="rex-link rex-card-trace"
                disabled={props.tracing}
                onClick={props.onShowTrace}
              >
                {props.tracing ? "showing" : "show trace"}
                {props.tracing ? null : <ChevronRight />}
              </button>
            </div>
          ) : null}

          {/*
            Spec 35 §2.3 and §2.4 — every place, one line each, behind a fold.
            A synthesis comment has no places of its own and says what it is
            made of instead.
          */}
          {thread.kind === "synthesis" ? (
            <span className="rex-meta">synthesis of {thread.refThreadIds.length} comments</span>
          ) : thread.targets.length > 0 ? (
            <div className="rex-card-places">
              <button
                type="button"
                className="rex-places-toggle"
                aria-expanded={showPlaces}
                title={showPlaces ? "Fold the places" : "Show the places"}
                onClick={() => setPlacesOpen(!showPlaces)}
              >
                <span className={showPlaces ? "rex-twisty rex-twisty-open" : "rex-twisty"} />
                places
                <span className="rex-places-count">{thread.targets.length}</span>
              </button>
              {showPlaces ? (
                <ol className="rex-places">
                  {thread.targets.map((target, position) => (
                    <PlaceRow
                      key={`${target.documentId}-${position}`}
                      thread={thread}
                      position={position}
                      facts={
                        props.targetPlaces[position] ?? { label: null, line: null, lineEnd: null }
                      }
                      state={props.targetStates[position] ?? null}
                      // Spec 08 §7.3 — a place in a document that is not open
                      // has nothing to light. Clicking it opens that document.
                      here={target.documentId === props.openDocumentId}
                      lit={props.hoveredPlace === position}
                      onHover={props.onHoverPlace}
                      onGo={() => props.onGoToPlace(position)}
                    />
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          {noteInConversation ? null : <p className="rex-card-note">{thread.note}</p>}
        </div>
      </div>

      <div
        className="rex-card"
        ref={cardRef}
        onScroll={(event) => {
          const card = event.currentTarget;
          // 24px of slack. A wheel gesture rarely lands on an exact bottom, and
          // sub-pixel row heights make an exact test read `false` forever — the
          // column would then never follow a run again after one scroll.
          atFoot.current = card.scrollHeight - card.scrollTop - card.clientHeight < 24;
        }}
      >
        {turns.map((turn) => {
          // Spec 36 §3 — the calls that ran before this turn, as one row of
          // glyphs. `aside.ts` guarantees no call sits inside a turn.
          const before = toolRows.before.get(turn.id);
          return (
            <div key={turn.id} className="rex-turn-and-tools">
              {before ? (
                <ToolRow tools={before} live={false} onShowTrace={props.onShowTrace} />
              ) : null}
              <TurnBlock
                turn={turn}
                places={placesOf(turn)}
                models={props.models.models}
                onGoToPlace={props.onGoToPlace}
              />
            </div>
          );
        })}

        {/*
          Spec 36 §3.2 — the calls since the last turn. While the run is going
          this is the row that grows, and its last glyph pulses.
        */}
        {toolRows.trailing.length > 0 ? (
          <ToolRow tools={toolRows.trailing} live={props.busy} onShowTrace={props.onShowTrace} />
        ) : null}

        {/*
          Spec 17 §3.1 — the only place in REX that says a run is happening, so
          the only place a control to end one belongs.

          The word changes to `stopping…` because the SDK's abort is not
          instant: it closes the agent's stdin and gives it about two seconds,
          so a tool call already in flight finishes. Leaving `working…` up
          would be a lie, and swapping straight to a finished state would be a
          bigger one.
        */}
        {props.busy ? (
          <div className="rex-running">
            <span className="rex-working">
              <span className="rex-spinner" />
              {props.stopping ? "stopping…" : "working…"}
            </span>
            <span className="rex-spacer" />
            <button
              type="button"
              className="rex-button rex-button-stop"
              // Not red. Red in REX means irreversible — the delete — and a
              // stop destroys nothing: the conversation, the session and the
              // working copy all survive it.
              title="Stop this run. Nothing is deleted, and you can reply again afterwards."
              disabled={props.stopping}
              onClick={props.onStop}
            >
              <StopSquare />
              Stop
            </button>
          </div>
        ) : null}
      </div>

      {/*
        Spec 38 §4 — the foot: the pending strip, the grip, the box, the mode
        switch, the model, the style and the button. One component, drawn here
        and at the foot of the trace sheet, reading the same state — so a mode
        picked there is the mode shown here.
      */}
      <Composer
        thread={thread}
        busy={props.busy}
        mode={props.mode}
        onMode={props.onMode}
        models={props.models}
        model={props.model}
        onModel={props.onModel}
        style={props.style}
        onStyle={props.onStyle}
        pending={props.pending}
        hoveredItemId={props.hoveredItemId}
        onHoverItem={props.onHoverItem}
        onRemovePending={props.onRemovePending}
        onReorderPending={props.onReorderPending}
        onGoToPending={props.onGoToPending}
        onPendingToNewComment={props.onPendingToNewComment}
        above={cardRef}
        onReply={props.onReply}
      />
    </>
  );
}
