// Spec 08 §6 — how the agent got there, at a width its content can live in.
//
// THE SPLIT THIS FILE EXISTS FOR. The sidebar keeps the CONVERSATION, because
// an answer is about a passage and you read one against the other. The
// MACHINERY — bash lines, paths, patterns, a refusal — is wide, technical, and
// has nothing to do with the document being on screen. So it gets the document
// pane, and only the document pane: the comment card stays beside it, so you
// always see which comment you are auditing, and the reply box is still
// reachable without closing.
//
// The sheet carries the card's composer at its foot (spec 38 §4). A reviewer
// reads the machinery precisely BECAUSE something looks wrong, and the next
// move is always to say so; making them cross the pane to a second column to
// type it is the one step this view can drop. It is the same component the
// card draws, reading the same state, so the two cannot drift.
//
// It is a sheet rather than a third centre mode. `Document | Graph` is
// a WORKSPACE switch and a trace belongs to one comment, so as a peer it would
// be a button that comes and goes, and leaving it there would need a decision
// about what it shows with no comment open. Apply's review bar settled the same
// question the same way. A sheet has one exit.
//
// The head ends in `debug` and `close`, and the first is here because this is
// where a reviewer decides something is wrong. They can always say what they
// saw; what they cannot say is which of the session files under
// `~/.claude/projects/` holds the answer they are looking at. `debug.ts` in main
// knows, so the button asks it and puts the answer on the clipboard.
//
// Colour here distinguishes KIND and invents no meanings: steel is you and the
// answer, neutral is machinery, faint is thinking, red is the write-capable
// agent being refused — the same two things red is spent on everywhere else.
//
// Spec 38 §3 — a block is a head and rows. The head names the speaker or the
// tool and ends in the clock; the rows under a call — INPUT, CHANGE, OUTPUT —
// are each shut to one line of preview and a count, and open to the whole
// thing. `trace.ts` decides what every row shows; this file only draws it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentSdk } from "../../shared/agent-protocol.ts";
import { commentName } from "../../shared/names.ts";
import { type RunStats, runStatsOf, spentText, totalsOf } from "../../shared/totals.ts";
import type {
  AgentChoices,
  AnchorState,
  ModelChoice,
  ThreadWithMessages,
} from "../../shared/types.ts";
import { AnswerFoot } from "./AnswerFoot.tsx";
import { lastSendAt, spokenTurnsOf } from "./CommentCard.tsx";
import { Composer, type GatewayChoice } from "./Composer.tsx";
import { CopyText } from "./CopyText.tsx";
import { DebugCopy } from "./DebugCopy.tsx";
import { Elapsed } from "./Elapsed.tsx";
import {
  Blocked,
  Bubble,
  Bulb,
  MESSAGE_ICON,
  MESSAGE_ICON_SOLID,
  Sparkle,
  StopSquare,
  TableGlyph,
  TriangleDown,
  TriangleRight,
  Warning,
} from "./Icons.tsx";
import { modelLabel } from "./ModelPick.tsx";
import { MODE_LABEL, type Mode } from "./mode.ts";
import { PlaceRow } from "./PlaceRow.tsx";
import { type PlaceFacts, placesByMessage } from "./placeLine.ts";
import { Prose } from "./prose.tsx";
import { RunNums, StepBars, stepsOf } from "./StepStrip.tsx";
import type { SelectionItem } from "./selection.ts";
import { ToolIcon } from "./ToolRow.tsx";
import {
  changeCounts,
  foldSize,
  glyphOf,
  HAS_ROWS,
  previewOf,
  type TraceEntry,
  type TraceKind,
  textOf,
  traceOf,
} from "./trace.ts";

interface Props {
  thread: ThreadWithMessages;
  number: number;
  tokenClass: string;
  /** True while this thread's agent is running. No second turn is taken. */
  busy: boolean;
  /** Spec 12 §3.2 — the mode the next send will run in. The card's, shared. */
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** Spec 25 §7.1 and spec 31 §2.1 — the model and the style, the card's. */
  models: AgentChoices;
  model: string | null;
  onModel: (model: string | null) => void;
  /**
   * Spec 43 §4 and spec 44 §3 — the agent and the gateway, passed straight
   * through to the composer, which is where the cascade lives.
   */
  agents: ModelChoice[];
  sdk: AgentSdk;
  onSdk: (sdk: AgentSdk) => void;
  gateways: GatewayChoice;
  gateway: string;
  onGateway: (gatewayId: string) => void;
  onManageGateways: () => void;
  supportsStyles: boolean;
  style: string;
  onStyle: (style: string) => void;
  /** Spec 24 §3.2 — the places waiting to go with the next send. */
  pending: SelectionItem[];
  hoveredItemId: string | null;
  onHoverItem: (id: string | null) => void;
  onRemovePending: (id: string) => void;
  onReorderPending: (from: number, to: number) => void;
  onGoToPending: (item: SelectionItem) => void;
  onPendingToNewComment: () => void;
  /**
   * Spec 38 §3.2 — what each place turned out to be, and its state, in target
   * order: the same two lists the card head draws its cells from.
   */
  targetPlaces: PlaceFacts[];
  targetStates: Array<AnchorState | null>;
  /** Spec 08 §7 — the open document, so a row knows if it has a mark to light. */
  openDocumentId: string | null;
  hoveredPlace: number | null;
  onHoverPlace: (position: number | null) => void;
  onGoToPlace: (position: number) => void;
  onClose: () => void;
  /** The same handler the comment card's reply box calls. */
  onReply: (text: string) => void;
}

/** 24-hour: the strip is tabular mono and `03:34 PM` overflows its column. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The glyph in the block's gutter.
 *
 * A tool is drawn by what it DOES rather than by its name — a command and a
 * file read are different acts, and `Bash`/`Read`/`Grep` is a vocabulary the
 * reviewer never chose to learn.
 */
function KindIcon({ kind, name }: { kind: TraceKind; name: string }): React.JSX.Element {
  if (kind === "you") return <Bubble size={MESSAGE_ICON} />;
  // Spec 08 §5.3 — an aside is the agent speaking, so it keeps the agent's
  // glyph. What separates it from the answer is the colour and the missing lit
  // border, which is the same pair that separates them on the card.
  if (kind === "answer" || kind === "aside") return <Sparkle size={MESSAGE_ICON_SOLID} />;
  if (kind === "thinking") return <Bulb size={MESSAGE_ICON} />;
  if (kind === "denied") return <Blocked size={MESSAGE_ICON} />;
  // Not the gate's `Blocked` hand: nothing stopped this call. It ran, and it
  // came back with something wrong — the same triangle REX's own errors wear.
  if (kind === "failed" || kind === "error") return <Warning size={MESSAGE_ICON} />;
  if (kind === "diff") return <TableGlyph size={MESSAGE_ICON} />;
  if (kind === "note") return <Warning size={MESSAGE_ICON} />;
  // Spec 17 §3.2 — not the warning triangle the notice gets. A stop is not
  // something REX is warning about; it is something the reviewer did. Smaller
  // again than the other solid — a filled square is the heaviest mark here.
  if (kind === "stopped") return <StopSquare size={10} />;
  // Spec 36 §3.1 — the same glyph the chat's tool row draws, so a change is a
  // pencil in both places and a read the same file.
  return <ToolIcon glyph={glyphOf(name, false, false)} size={MESSAGE_ICON} />;
}

/**
 * Spec 38 §3.3 — one row of a block: `INPUT`, `CHANGE` or `OUTPUT`.
 *
 * Shut, the row is one line: the triangle, the word, a preview of what is
 * inside, and how much of it there is — so the reviewer decides whether to pay
 * the height before it is spent. Open, the preview goes and the content sits
 * under the row. The whole line is the button.
 */
function Row({
  label,
  preview,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  preview: React.ReactNode;
  count: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rex-trace-row">
      <button
        type="button"
        className="rex-trace-row-head"
        aria-expanded={open}
        title={open ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`}
        onClick={onToggle}
      >
        {open ? <TriangleDown /> : <TriangleRight />}
        <span className="rex-trace-row-label">{label}</span>
        {open ? null : <span className="rex-trace-row-preview">{preview}</span>}
        <span className="rex-trace-count">{count}</span>
      </button>
      {open ? <div className="rex-trace-row-body">{children}</div> : null}
    </section>
  );
}

/**
 * Spec 41 §2 — what the copy button calls this block in its own tooltip.
 *
 * The label is on the screen already, so the word here is the one a sentence
 * needs: "Copy this refusal", not "Copy this DENIED".
 */
const KIND_THING: Record<TraceKind, string> = {
  you: "question",
  answer: "answer",
  aside: "remark",
  thinking: "thought",
  note: "notice",
  stopped: "stop",
  error: "error",
  tool: "step",
  denied: "refusal",
  failed: "step",
  diff: "change",
};

/**
 * Spec 38 §3.4 — a change, line by line, in the diff's two colours. The lines
 * are `diffStep`'s and never move, so their position is their identity.
 */
function Change({ change }: { change: string }): React.JSX.Element {
  return (
    <pre className="rex-trace-change">
      {change.split("\n").map((line, position) => (
        <span
          // The lines of one diff are fixed and never reordered, so the
          // position is the identity.
          key={position}
          className={
            line.startsWith("- ")
              ? "rex-trace-del"
              : line.startsWith("+ ")
                ? "rex-trace-add"
                : undefined
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/**
 * One block. Its rows are shut until asked for — that is the one time their
 * height earns itself, and it is Vex's rule too.
 *
 * A trace is read to find the ONE call that went wrong, and a run of thirteen
 * steps that prints every argument and every diff in full is the state that
 * makes that impossible: measured on 2026-09-01, a single `Write` of a 90-line
 * file filled the sheet twice over and the calls around it could not be seen at
 * all. So every row shows ONE line — the path, the command, the first line of
 * the output — and folds the rest behind a count.
 *
 * A DENIED block is the exception and opens its INPUT. Nobody should have to
 * unfold the gate firing: it is the whole safety story of the read profile made
 * visible, and it is the reason the profile split exists at all.
 *
 * A FAILED block opens the other half — its OUTPUT — for the mirror of that
 * reason. A refusal explains itself in REX's words above the rows; a failure's
 * only explanation is what the tool printed, and it is the one line the
 * reviewer opened the trace to read.
 */
function Entry({
  entry,
  places,
  stats,
  props,
}: {
  entry: TraceEntry;
  /** Spec 38 §3.2 — the places this message brought, as positions. */
  places: number[];
  /** What the run that ended in this block spent, or null if it ended in another. */
  stats: RunStats | null;
  props: Props;
}): React.JSX.Element {
  const [showInput, setShowInput] = useState(entry.kind === "denied");
  const [showChange, setShowChange] = useState(false);
  const [showOutput, setShowOutput] = useState(entry.kind === "failed");
  const call = HAS_ROWS.has(entry.kind);
  const counts = entry.change ? changeCounts(entry.change) : null;

  return (
    <div className={`rex-trace-entry rex-trace-${entry.kind}`}>
      <span className="rex-trace-icon">
        <KindIcon kind={entry.kind} name={entry.label} />
      </span>

      <div className="rex-trace-body">
        <div className="rex-trace-head">
          <span className="rex-label">{entry.label}</span>
          {/*
            Spec 38 §3.2 — the mode the reviewer sent this in, as the card's
            pill: the same three words in the same three colours the switch
            beside Send uses. No pill when nobody recorded it.
          */}
          {entry.kind === "you" && entry.sent ? (
            <span className={`rex-sent rex-sent-${entry.sent}`}>{MODE_LABEL[entry.sent]}</span>
          ) : null}
          {/*
            `READ · FAILED` — the tool, then what became of it. The state is a
            chip and never the label, because the label is the only place the
            tool is named: the row below a failed Read is a path, and a path
            does not say who was asked to read it.
          */}
          {entry.status ? (
            <span className="rex-trace-status">{`· ${entry.status.toUpperCase()}`}</span>
          ) : null}
          {/*
            Spec 12 §7.3 — which promise refused this, not just that something
            did. It rides the label rather than the reason line below, because
            the reason is the gate's sentence and this is REX's frame around it.
          */}
          {entry.mode ? (
            <span className="rex-trace-mode">{`· ${MODE_LABEL[entry.mode]} MODE`}</span>
          ) : null}
          {/*
            Spec 38 §3.3 — the agent's own one-line account of the call, when
            the tool gave one. Down a run of thirty blocks it is what the eye
            scans; the command it describes is one row below.
          */}
          {entry.what ? <span className="rex-trace-what">{entry.what}</span> : null}
          <span className="rex-spacer" />
          {/* Spec 38 §3.1 — always the clock, one aligned column down the trace. */}
          <span className="rex-trace-spent">{clock(entry.at)}</span>
          {/*
            Spec 41 §2.1 — outside the clock, so that column stays where §3.1
            put it. What goes on the clipboard is `textOf`'s decision, which is
            why a folded INPUT and OUTPUT are copied and a shut row is not a
            row the reviewer has to open first.
          */}
          <CopyText text={textOf(entry)} what={KIND_THING[entry.kind]} />
        </div>

        {entry.reason ? <p className="rex-trace-reason">{entry.reason}</p> : null}

        {call ? null : entry.kind === "answer" || entry.kind === "aside" ? (
          // The same answer the card shows, so the two must read the same.
          // Only what the agent wrote: the reviewer's question, REX's notices
          // and the thinking block stay verbatim.
          <Prose text={entry.body} />
        ) : (
          <p className="rex-trace-text">{entry.body}</p>
        )}

        {/*
          Spec 38 §3.2 — the places this message brought, one line each in the
          card head's cells, so the sheet and the head cannot describe one
          place differently. `PLACES n` above them, the words the head uses.
        */}
        {entry.kind === "you" && places.length > 0 ? (
          <div className="rex-trace-places">
            <div className="rex-trace-places-head">
              <span className="rex-label">PLACES</span>
              <span className="rex-places-count">{places.length}</span>
            </div>
            <ol className="rex-places">
              {places.map((position) => (
                <PlaceRow
                  key={position}
                  thread={props.thread}
                  position={position}
                  facts={props.targetPlaces[position] ?? { label: null, line: null, lineEnd: null }}
                  state={props.targetStates[position] ?? null}
                  here={props.thread.targets[position]?.documentId === props.openDocumentId}
                  lit={props.hoveredPlace === position}
                  onHover={props.onHoverPlace}
                  onGo={() => props.onGoToPlace(position)}
                />
              ))}
            </ol>
          </div>
        ) : null}

        {call ? (
          <div className="rex-trace-rows">
            {entry.fields.length > 0 ? (
              <Row
                label="INPUT"
                preview={previewOf(entry.body)}
                count={`${entry.fields.length} field${entry.fields.length === 1 ? "" : "s"}`}
                open={showInput}
                onToggle={() => setShowInput(!showInput)}
              >
                <dl className="rex-trace-fields">
                  {entry.fields.map(([key, value]) => (
                    <div key={key} className="rex-trace-field">
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </Row>
            ) : null}
            {entry.change && counts ? (
              <Row
                label="CHANGE"
                preview={
                  <>
                    <span className="rex-trace-del">−{counts.removed}</span>{" "}
                    <span className="rex-trace-add">+{counts.added}</span>
                  </>
                }
                count={foldSize(entry.change)}
                open={showChange}
                onToggle={() => setShowChange(!showChange)}
              >
                <Change change={entry.change} />
              </Row>
            ) : null}
            {entry.result ? (
              <Row
                label="OUTPUT"
                preview={previewOf(entry.result)}
                count={foldSize(entry.result)}
                open={showOutput}
                onToggle={() => setShowOutput(!showOutput)}
              >
                <pre className="rex-trace-result">{entry.result}</pre>
              </Row>
            ) : null}
          </div>
        ) : null}

        {/*
          Spec 38 §3.5 — the answer's own foot: the card's line, from the card's
          own component (spec 25 §7.3, spec 31 §5, spec 43 §5.3).

          It was a copy of that line and it had already lost the gateway, which
          is the reviewer's report of 2026-09-04. The numbers here are this
          RUN's; the head's are the whole comment's, as spec 36 §2 put them, and
          the two are different questions rather than a disagreement.
        */}
        {entry.kind === "answer" ? (
          <AnswerFoot
            evidence={{
              agent: entry.sdk ? modelLabel(props.agents, entry.sdk, entry.sdk) : null,
              gatewayName: entry.gatewayName,
              baseUrl: entry.baseUrl,
              model: entry.model,
              style: entry.style,
            }}
            stats={stats}
            models={props.models.models}
          />
        ) : null}
      </div>
    </div>
  );
}

export function TraceSheet(props: Props): React.JSX.Element {
  const entries = traceOf(props.thread);
  const steps = stepsOf(props.thread);
  const totals = totalsOf(props.thread.messages);
  // Each run's own numbers, keyed by the block that ends it — the same map the
  // card builds, so a run reports one time, one price and one step count
  // wherever it is read.
  const runStats = runStatsOf(props.thread.messages);
  const turns = spokenTurnsOf(props.thread);
  const list = useRef<HTMLDivElement>(null);

  /**
   * Spec 38 §3.2 — which places each `YOU` block brought. The rule is spec 37
   * §3's, shared with the card: the places with no message are the first
   * `YOU`'s.
   */
  const places = placesByMessage(props.thread.targets);
  const firstYou = entries.find((entry) => entry.kind === "you");
  const placesOf = (entry: TraceEntry): number[] =>
    entry.kind === "you"
      ? [
          ...(entry === firstYou ? places.startedWith : []),
          ...(places.byMessage.get(entry.id) ?? []),
        ]
      : [];

  /**
   * True while the foot of the list is on screen. The comment card's rule, for
   * the same reason and with the same 24px of slack.
   *
   * An earlier build scrolled the list to its end on a SEND and on nothing
   * else, reasoning that a trace is read from wherever the suspicious step is
   * and a list that followed every change would drag the reviewer off the block
   * they are studying. That reasoning survives — this flag is what carries it.
   * A reviewer who scrolled up to a step is by definition not at the foot, so
   * nothing moves under them. What it stops being is a reason to OPEN at step
   * one: the newest step is the one the sheet was opened to see.
   */
  const atFoot = useRef(true);

  const sendReply = (text: string): void => {
    props.onReply(text);
    // A reply typed at the foot lands at the foot, and a send with nothing
    // visible happening reads as a send that did not work. It also re-arms the
    // follow: sending is the reviewer saying they are done reading back.
    atFoot.current = true;
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  };

  // The sheet opens on the LAST step, not the first. It is opened to see what
  // the agent just did, and a 32-step run put that thirty blocks below the
  // fold. A different comment's trace is a different run and starts at its foot
  // too.
  useLayoutEffect(() => {
    atFoot.current = true;
  }, [props.thread.id]);

  // After every render of the sheet, because there is no one dependency for
  // "the trace got longer". Opening a row cannot trigger this: that state
  // lives inside `Entry`, so only the child re-renders.
  useLayoutEffect(() => {
    const box = list.current;
    if (box && atFoot.current) box.scrollTop = box.scrollHeight;
  });

  // `esc` closes it, and that is its only exit — the point of a sheet.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  // Spec 36 §2 — the whole chat's numbers, the card's run line's third group,
  // from the same helpers, so the head and the card cannot disagree.
  const summary = [
    `${turns} turn${turns === 1 ? "" : "s"}`,
    totals.durationMs > 0 ? spentText(totals.durationMs) : null,
    totals.costUsd > 0 ? `$${totals.costUsd.toFixed(3)}` : null,
  ].filter(Boolean);

  return (
    <section className="rex-trace">
      {/*
        Spec 38 §2 — the token, the word, the comment's NAME, and the card's run
        line: the bars, the count with its marks, the numbers. The note, the
        mode line and the pills are gone — the pill on every `YOU` says the
        mode per message, and the marks beside the bars say the failures once.
      */}
      <header className="rex-trace-bar">
        <span className={`rex-token ${props.tokenClass}`}>{props.number}</span>
        <span className="rex-label">TRACE</span>
        <span className="rex-trace-name">{commentName(props.thread)}</span>

        {steps.length > 0 ? <StepBars steps={steps} /> : null}
        {steps.length > 0 ? <RunNums steps={steps} /> : null}
        {steps.length > 0 ? (
          <span className="rex-trace-summary">{`· ${summary.join(" · ")}`}</span>
        ) : null}

        <DebugCopy
          threadId={props.thread.id}
          className="rex-trace-action"
          doneClassName="rex-trace-action-done"
          withLabel
        />

        <button
          type="button"
          className="rex-trace-action"
          onClick={props.onClose}
          title="Close the trace and go back to the document"
        >
          close
          <kbd className="rex-key rex-key-chrome">esc</kbd>
        </button>
      </header>

      <div
        className="rex-trace-list"
        ref={list}
        onScroll={(event) => {
          const box = event.currentTarget;
          atFoot.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <p className="rex-meta">Nothing was recorded for this comment yet.</p>
        ) : (
          entries.map((entry) => (
            <Entry
              key={entry.id}
              entry={entry}
              places={placesOf(entry)}
              stats={runStats.get(entry.id) ?? null}
              props={props}
            />
          ))
        )}
        {props.busy ? (
          <div className="rex-running">
            <span className="rex-working">
              <span className="rex-spinner" />
              working…
              {/*
                Spec 43 §7.3 — the same clock the card shows, counting from the
                same send. The sheet is where a reviewer watches a long run step
                by step, and it was the one view that showed no clock at all.
              */}
              <Elapsed since={lastSendAt(props.thread.messages)} />
            </span>
          </div>
        ) : null}
      </div>

      {/*
        Spec 38 §4 — the card's foot, at the foot of the sheet: the pending
        strip, the box, then the mode switch, the model, the style and Send on
        the row under it. Send is the only thing that happens here. Resolve
        stays on the card — a decision about the COMMENT, and a sheet that
        exists to audit one run is not where one gets closed.
      */}
      <Composer
        thread={props.thread}
        busy={props.busy}
        mode={props.mode}
        onMode={props.onMode}
        models={props.models}
        model={props.model}
        onModel={props.onModel}
        agents={props.agents}
        sdk={props.sdk}
        onSdk={props.onSdk}
        gateways={props.gateways}
        gateway={props.gateway}
        onGateway={props.onGateway}
        onManageGateways={props.onManageGateways}
        supportsStyles={props.supportsStyles}
        style={props.style}
        onStyle={props.onStyle}
        pending={props.pending}
        hoveredItemId={props.hoveredItemId}
        onHoverItem={props.onHoverItem}
        onRemovePending={props.onRemovePending}
        onReorderPending={props.onReorderPending}
        onGoToPending={props.onGoToPending}
        onPendingToNewComment={props.onPendingToNewComment}
        above={list}
        escapeLeavesBox
        onReply={sendReply}
      />
    </section>
  );
}
