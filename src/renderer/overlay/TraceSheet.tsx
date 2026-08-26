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
// The sheet carries a reply box OF ITS OWN as well, at its foot. The card's box
// is beside it and sends the same message, so this is not a second way to do a
// different thing — it is the same thing where the hands already are. A
// reviewer reads the machinery precisely BECAUSE something looks wrong, and the
// next move is always to say so; making them cross the pane to a second column
// to type it is the one step this view can drop. It sends through the same
// `onReply` the card uses, so there is one path to `thread:reply` and the two
// boxes can never drift.
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
// Steel covers two of those, so it cannot be the whole signal. YOU and ANSWER
// were the same box in the same colour with a different word in the corner,
// which is a distinction the eye does not make while scrolling: the question
// and its answer ran together. They are separated the way the design separates
// them — a glyph each, and the answer alone carrying a lit border on every side,
// because the answer is what the sheet is an audit OF.

import { useEffect, useRef, useState } from "react";
import { totalsOf } from "../../shared/totals.ts";
import type { ThreadWithMessages } from "../../shared/types.ts";
import {
  Blocked,
  Bubble,
  Bug,
  Bulb,
  Check,
  FileGlyph,
  Sparkle,
  StopSquare,
  TableGlyph,
  Terminal,
  TriangleDown,
  TriangleRight,
  Warning,
} from "./Icons.tsx";
import { onSendChord, SEND_CHORD_HINT, SendChord } from "./keys.tsx";
import { MODE_LABEL, MODE_PROMISE, type Mode } from "./mode.ts";
import { Prose } from "./prose.tsx";
import { StepBars, stepsOf } from "./StepStrip.tsx";
import { resultSummary, type TraceEntry, type TraceKind, traceOf } from "./trace.ts";

interface Props {
  thread: ThreadWithMessages;
  number: number;
  tokenClass: string;
  /** True while this thread's agent is running. No second turn is taken. */
  busy: boolean;
  /** Spec 12 §7.2 — ASK or ACT, from the same source the card head uses. */
  mode: Mode;
  onClose: () => void;
  /** The same handler the comment card's reply box calls. */
  onReply: (text: string) => void;
}

function seconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}m`;
}

/** 240, then 1.4k. Thousands are what a transcript is counted in. */
function tokens(count: number): string {
  return count < 1000 ? `${count} tok` : `${(count / 1000).toFixed(1)}k tok`;
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
  if (kind === "you") return <Bubble />;
  if (kind === "answer") return <Sparkle />;
  if (kind === "thinking") return <Bulb />;
  if (kind === "denied") return <Blocked />;
  if (kind === "error") return <Warning size={13} />;
  if (kind === "diff") return <TableGlyph />;
  if (kind === "note") return <Warning size={13} />;
  // Spec 17 §3.2 — not the warning triangle the notice gets. A stop is not
  // something REX is warning about; it is something the reviewer did.
  if (kind === "stopped") return <StopSquare size={9} />;
  return /READ|GLOB|GREP|SEARCH|FETCH/.test(name) ? <FileGlyph /> : <Terminal />;
}

/**
 * One block. The result is collapsed until asked for — that is the one time its
 * height earns itself, and it is Vex's rule too.
 *
 * A DENIED block is the exception and opens itself. Nobody should have to
 * unfold the gate firing: it is the whole safety story of the read profile made
 * visible, and it is the reason the profile split exists at all.
 */
function Entry({ entry }: { entry: TraceEntry }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const mono = entry.kind === "tool" || entry.kind === "denied" || entry.kind === "diff";
  // A block with no duration of its own says WHEN instead. The reviewer's
  // question is the case: it took no time, but placing the run in the day is
  // exactly what a transcript read a week later is missing.
  const spent =
    [
      entry.durationMs ? seconds(entry.durationMs) : null,
      entry.tokens ? tokens(entry.tokens) : null,
    ]
      .filter(Boolean)
      .join(" · ") || clock(entry.at);

  return (
    <div className={`rex-trace-entry rex-trace-${entry.kind}`}>
      <span className="rex-trace-icon">
        <KindIcon kind={entry.kind} name={entry.label} />
      </span>

      <div className="rex-trace-body">
        <div className="rex-trace-head">
          <span className="rex-label">{entry.label}</span>
          {/*
            Spec 12 §7.3 — which promise refused this, not just that something
            did. It rides the label rather than the reason line below, because
            the reason is the gate's sentence and this is REX's frame around it.
          */}
          {entry.mode ? (
            <span className="rex-trace-mode">{`· ${MODE_LABEL[entry.mode]} MODE`}</span>
          ) : null}
          <span className="rex-spacer" />
          <span className="rex-trace-spent">{spent}</span>
        </div>

        {entry.reason ? <p className="rex-trace-reason">{entry.reason}</p> : null}

        {entry.body ? (
          mono ? (
            <pre className="rex-trace-arg">{entry.body}</pre>
          ) : entry.kind === "answer" ? (
            // The same answer the card shows, so the two must read the same.
            // Only the answer: the reviewer's question, REX's notices and the
            // thinking block stay verbatim.
            <Prose text={entry.body} />
          ) : (
            <p className="rex-trace-text">{entry.body}</p>
          )
        ) : null}

        {entry.result ? (
          <>
            <button type="button" className="rex-trace-toggle" onClick={() => setOpen(!open)}>
              {open ? <TriangleDown /> : <TriangleRight />}
              {resultSummary(entry.result)}
              <span className="rex-trace-more">{open ? "hide" : "show"}</span>
            </button>
            {open ? <pre className="rex-trace-result">{entry.result}</pre> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** How long the debug button stays on its confirmation before going back. */
const COPIED_MS = 2500;

/**
 * What the last press of `debug` did. `text` is the report itself on success and
 * the failure on failure; either way it becomes the button's `title`, so a
 * reviewer can see what they are about to paste before they paste it — REX's
 * report carries absolute paths and a line of their document, and being able to
 * read it first is the difference between copying and disclosing.
 */
interface CopyOutcome {
  ok: boolean;
  text: string;
}

const DEBUG_HINT = "Copy this run's ids, log paths and refusals to the clipboard";

function debugLabel(copied: CopyOutcome | null): string {
  if (copied === null) return "debug";
  return copied.ok ? "copied" : "copy failed";
}

export function TraceSheet(props: Props): React.JSX.Element {
  const { mode } = props;
  const entries = traceOf(props.thread);
  const steps = stepsOf(props.thread);
  const totals = totalsOf(props.thread.messages);
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const [reply, setReply] = useState("");
  const list = useRef<HTMLDivElement>(null);

  /** The card's rule, and it has to be the card's rule: words, and not busy. */
  const canSend = !props.busy && reply.trim().length > 0;

  /**
   * Sending scrolls the list to its end, and ONLY sending does.
   *
   * A trace is read from wherever the suspicious step is, so a list that
   * followed every change would drag the reviewer off the block they are
   * studying. But a reply typed at the foot lands at the foot, and a send with
   * nothing visible happening reads as a send that did not work.
   */
  const sendReply = (): void => {
    props.onReply(reply.trim());
    setReply("");
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  };

  const chord = onSendChord(canSend, sendReply);

  /**
   * `esc` is the sheet's only exit, and the sheet now holds a box you can type
   * a paragraph into. So inside that box the first `esc` LEAVES THE BOX and
   * nothing else: the draft stays, the sheet stays, and a second `esc` closes
   * as it always did. Stopping the event is what does it — the sheet listens on
   * `document`, and the native event has not left the overlay's root yet.
   */
  const onReplyKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.currentTarget.blur();
      return;
    }
    chord(event);
  };

  // `esc` closes it, and that is its only exit — the point of a sheet.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyDebug = async (): Promise<void> => {
    try {
      setCopied({ ok: true, text: await window.rex.debugCopy(props.thread.id) });
    } catch (error) {
      // A failure here is reported where the press was, not swallowed into a
      // console nobody has open — the whole point of the button is that the
      // reviewer is already trying to tell somebody something went wrong.
      setCopied({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const summary = [
    `${totals.steps} step${totals.steps === 1 ? "" : "s"}`,
    totals.durationMs ? seconds(totals.durationMs) : null,
    totals.costUsd ? `$${totals.costUsd.toFixed(3)}` : null,
  ].filter(Boolean);

  return (
    <section className="rex-trace">
      <header className="rex-trace-bar">
        <span className={`rex-token ${props.tokenClass}`}>{props.number}</span>
        <span className="rex-label">TRACE</span>
        <span className="rex-trace-note">{props.thread.note}</span>

        {totals.denied > 0 ? (
          <span className="rex-pill rex-pill-write" title="Refused by the gate">
            {totals.denied} DENIED
          </span>
        ) : null}

        {/*
          Spec 12 §7.2 — the mode, said once, at the top of the machinery. The
          card head says the same thing (§4.1); this sheet is often opened on
          its own and covers the card while it is up.
        */}
        <span className="rex-trace-mode-line" title={MODE_PROMISE[mode]}>
          MODE <strong>{MODE_LABEL[mode]}</strong> · {MODE_PROMISE[mode]}
        </span>

        {/*
          The card's own step strip, on the head of the thing it opens.

          Same bars, same rule, same order — so the shape a reviewer clicked on
          is the shape they land on, and a denied step keeps its red in both
          places. The numbers beside it are the ones the strip carries too;
          `totalsOf` and `stepsOf` count the same messages, so the two can only
          agree.
        */}
        {steps.length > 0 ? <StepBars steps={steps} /> : null}
        <span className="rex-trace-summary">{summary.join(" · ")}</span>

        <button
          type="button"
          className={`rex-trace-action${copied?.ok ? " rex-trace-action-done" : ""}`}
          onClick={copyDebug}
          title={copied?.text ?? DEBUG_HINT}
        >
          {copied?.ok ? <Check /> : <Bug />}
          {debugLabel(copied)}
        </button>

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

      <div className="rex-trace-list" ref={list}>
        {entries.length === 0 ? (
          <p className="rex-meta">Nothing was recorded for this comment yet.</p>
        ) : (
          entries.map((entry) => <Entry key={entry.id} entry={entry} />)
        )}
      </div>

      {/*
        The foot. A row rather than the card's stack: this pane is wide, and a
        full-width box above a lone left-hand button puts the send a screen away
        from the last word typed.

        Send is the only control here. Resolve and Apply stay on the card and
        nowhere else — they are decisions about the COMMENT, and a sheet that
        exists to audit one run is not where a document gets edited.
      */}
      <div className="rex-trace-reply">
        <textarea
          className="rex-input"
          placeholder="Reply to this thread"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={onReplyKey}
        />
        <div className="rex-trace-send">
          {props.busy ? (
            <span className="rex-working">
              <span className="rex-spinner" />
              working…
            </span>
          ) : null}
          <button
            type="button"
            className="rex-button rex-primary"
            title={`Send this reply — ${SEND_CHORD_HINT}`}
            disabled={!canSend}
            onClick={sendReply}
          >
            Send
            <SendChord />
          </button>
        </div>
      </div>
    </section>
  );
}
