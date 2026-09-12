// Spec 51 §5.2 — Traffic, depth 2. One chat, and its turns.
//
// Where the comment card's `traffic` button lands. **Its glyph, its row and its
// IPC stay** — only the destination changes, exactly as spec 46 §4.6 said when
// the same button stopped opening Grafana. A control that vanishes looks like a
// bug; a control that goes somewhere better does not.
//
// The old sheet listed REQUESTS. This lists TURNS, which is the unit a person
// actually asks about: one Ask or one Apply, with the four "who answered" facts
// on it and its exchanges counted underneath. Neither list could be built from
// one source — the facts are `message` rows and the exchanges are the gateway's
// log — which is the join §4 turns on.
//
// A PAGE and not a dialog, because `design/traffic/Main.dc.html` is one: it has
// a breadcrumb back to depth 1 and an `Open turn` forward to depth 3, and a
// stack of modals is not a path.
//
// Expanding a turn shows a BRIEF step list and never JSON. At this level a
// message is 40 KB and the question is only "what did it do".

import { useMemo, useState } from "react";
import type { GatewayTrafficRow } from "../../shared/channels.ts";
import { commentName } from "../../shared/names.ts";
import { costText, spentText } from "../../shared/totals.ts";
import type { ThreadWithMessages } from "../../shared/types.ts";
import { CopyText } from "./CopyText.tsx";
import { DebugCopy } from "./DebugCopy.tsx";
import { ChevronLeft, Cross, TriangleDown, TriangleRight, Warning } from "./Icons.tsx";
import { API_LABEL, MODE_LABEL } from "./mode.ts";
import { stepsOfTurn, type Turn, turnsOf } from "./trace.ts";

interface Props {
  thread: ThreadWithMessages;
  /** §5.2 — the exchanges, or null while the log is being read. */
  rows: GatewayTrafficRow[] | null;
  /** False for a chat whose gateway keeps no log, with the reason beside it. */
  available: boolean;
  reason: string | null;
  /** Opens depth 3 for one turn. */
  onOpenTurn: (runId: string | null) => void;
  /** Back to depth 1, when this screen was reached from it. */
  onBack: (() => void) | null;
  onClose: () => void;
}

/** 24-hour with seconds: machine times, in a mono column. */
function clock(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function tokenText(inTokens: number | null, outTokens: number | null): string {
  if (inTokens === null && outTokens === null) return "no tokens recorded";
  return `${inTokens ?? "—"} in · ${outTokens ?? "—"} out`;
}

export function TrafficChat(props: Props): React.JSX.Element {
  const turns = useMemo(() => turnsOf(props.thread), [props.thread]);
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  /** This chat's exchanges, grouped by the turn that made them. */
  const byRun = useMemo(() => {
    const map = new Map<string, GatewayTrafficRow[]>();
    for (const row of props.rows ?? []) {
      if (!row.run) continue;
      const list = map.get(row.run) ?? [];
      list.push(row);
      map.set(row.run, list);
    }
    return map;
  }, [props.rows]);

  const exchangesOf = (turn: Turn): GatewayTrafficRow[] =>
    turn.runId ? (byRun.get(turn.runId) ?? []) : [];

  // Turn 1, then turn 2. **In the order they happened**, which is the order a
  // conversation is read in and the order the numbers on them already imply —
  // reported 2026-09-09, against a list that counted down.
  const ordered = turns;
  const shown = failedOnly
    ? ordered.filter(
        (turn) => turn.failed > 0 || exchangesOf(turn).some((exchange) => exchange.error),
      )
    : ordered;

  const exchanges = props.rows?.length ?? 0;
  const failed = (props.rows ?? []).filter((row) => row.error).length;

  return (
    <div className="rex-page rex-traffic" aria-label="This chat's turns">
      <header className="rex-page-head rex-tt-head">
        {props.onBack ? (
          <>
            <button type="button" className="rex-tt-back" onClick={props.onBack}>
              <ChevronLeft size={12} />
              Traffic
            </button>
            <span className="rex-tt-slash">/</span>
          </>
        ) : null}
        <h1>{commentName(props.thread)}</h1>
        <span className="rex-spacer" />
        <button
          type="button"
          className="rex-icon-button"
          data-tip="Close — esc"
          aria-label="Close"
          onClick={props.onClose}
        >
          <Cross />
        </button>
      </header>

      {/*
        The chat id, on screen and copyable, because "which chat is this" is the
        first thing anybody asks of a trace. It says CHAT and never "session":
        REX already has a `session_id` and it means the SDK's own cache, one row
        per chat AND agent AND gateway (§2).
      */}
      <div className="rex-tt-ids">
        <span className="rex-tt-id">
          <span className="rex-tt-id-label">chat</span>
          <code>{props.thread.id}</code>
          <CopyText text={props.thread.id} what="chat id" />
        </span>
        <span className="rex-spacer" />
        <span className="rex-tt-span">
          {`${turns.filter((turn) => turn.runId).length} turns · ${exchanges} exchanges · ${failed} failed`}
        </span>
        {/*
          Spec 55 §2 — the id beside it is already copyable, so this button
          earns its place by copying what the screen cannot show: the two read
          commands, the log's own file names, and every turn's facts as text.
        */}
        <DebugCopy
          copy={() => window.rex.traceCopyChat(props.thread.id)}
          what="chat"
          subject={props.thread.id}
          className="rex-tt-debug"
          doneClassName="rex-tt-debug-done"
          withLabel
        />
      </div>

      <div className="rex-tc-bar">
        <button
          type="button"
          className={failedOnly ? "rex-button rex-button-on" : "rex-button"}
          aria-pressed={failedOnly}
          onClick={() => setFailedOnly((was) => !was)}
        >
          <Warning size={11} />
          Failed only
        </button>
        {props.rows === null ? (
          <span className="rex-meta">Reading the gateway's log…</span>
        ) : !props.available ? (
          // The exchanges are missing and the reason is not "nothing happened".
          // Said once, here, rather than as a dash on every row.
          <span className="rex-meta">{props.reason}</span>
        ) : null}
      </div>

      <div className="rex-tc-list">
        {shown.length === 0 ? (
          <p className="rex-settings-note">
            {failedOnly
              ? "Nothing failed in this chat."
              : "Nothing has run on this comment yet. A turn appears here as soon as one does."}
          </p>
        ) : (
          <ul className="rex-turns">
            {shown.map((turn) => (
              <TurnRow
                key={turn.runId ?? "untracked"}
                turn={turn}
                exchanges={exchangesOf(turn)}
                open={open === (turn.runId ?? "untracked")}
                onToggle={() =>
                  setOpen((was) =>
                    was === (turn.runId ?? "untracked") ? null : (turn.runId ?? "untracked"),
                  )
                }
                onOpen={() => props.onOpenTurn(turn.runId)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TurnRow({
  turn,
  exchanges,
  open,
  onToggle,
  onOpen,
}: {
  turn: Turn;
  exchanges: GatewayTrafficRow[];
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  // Two different failures, counted apart. A step that was refused or errored is
  // REX's record; an exchange that never came back is the gateway's. Summing
  // them makes one number that means neither — and they are often the same
  // event seen twice, which is exactly what a sum cannot say.
  const wireFailed = exchanges.filter((row) => row.error).length;
  const steps = open ? stepsOfTurn(turn) : [];

  return (
    <li
      className={turn.failed + wireFailed > 0 ? "rex-turns-row rex-turns-failed" : "rex-turns-row"}
    >
      <div className="rex-turns-head">
        <button type="button" className="rex-turns-fold" aria-expanded={open} onClick={onToggle}>
          {open ? <TriangleDown /> : <TriangleRight />}
        </button>
        <span className="rex-turns-name">
          {turn.runId === null ? "Before turns were recorded" : `Turn ${turn.number}`}
        </span>
        {/*
          §5.5 — REX's own `.rex-sent` pill, never a second one that happens to
          look like it. ASK is #4d84e8 and ACT is `--lost`; the rail below cannot
          carry the mode as well, because ACT's colour IS the failure red.
        */}
        {turn.mode ? (
          <span className={`rex-sent rex-sent-${turn.mode}`}>{MODE_LABEL[turn.mode]}</span>
        ) : null}
        {turn.runId ? <code className="rex-turns-id">{turn.runId}</code> : null}
        <span className="rex-spacer" />
        <span className="rex-turns-when">{`${clock(turn.startedAt)} → ${clock(turn.endedAt)}`}</span>
        <button type="button" className="rex-button rex-button-go" onClick={onOpen}>
          Open turn
        </button>
      </div>

      {/* WHO answered: the four you compare when two turns disagree. */}
      <div className="rex-turns-who">
        <Fact label="agent" value={turn.sdk} />
        <Fact label="gateway" value={turn.gatewayName} />
        <Fact label="model" value={turn.model} />
        <Fact label="style" value={turn.style} />
        {/*
          Spec 51 — and which of spec 46 §4.5's three doors it went through.
          One `model_name` answers all three, so the model beside it cannot say;
          and what comes back is shaped differently enough that two turns on one
          model are not comparable until you know this.
        */}
        <Fact label="api" value={apiOf(exchanges)} />
        <span className="rex-spacer" />
        <span className="rex-turns-num">{tokenText(turn.inputTokens, turn.outputTokens)}</span>
        <span className="rex-turns-num">{costText(turn.costUsd)}</span>
      </div>

      <div className="rex-turns-counts">
        <span>{`${exchanges.length} exchange${exchanges.length === 1 ? "" : "s"}`}</span>
        <span>{`${turn.entries.length} block${turn.entries.length === 1 ? "" : "s"}`}</span>
        {turn.toolCalls > 0 ? (
          <span>{`${turn.toolCalls} tool call${turn.toolCalls === 1 ? "" : "s"}`}</span>
        ) : null}
        {turn.durationMs > 0 ? <span>{spentText(turn.durationMs)}</span> : null}
        {turn.failed > 0 ? (
          <span className="rex-turns-bad">{`${turn.failed} step${turn.failed === 1 ? "" : "s"} failed`}</span>
        ) : null}
        {wireFailed > 0 ? (
          <span className="rex-turns-bad">{`${wireFailed} never answered`}</span>
        ) : null}
      </div>

      {open ? (
        <ol className="rex-turns-steps">
          {steps.map((step, position) => (
            <li
              // The steps of one turn are fixed and never reordered, so the
              // position is the identity.
              key={position}
              className={step.failed ? "rex-turns-step rex-turns-step-bad" : "rex-turns-step"}
            >
              <span className="rex-turns-step-n">{position + 1}</span>
              <span className="rex-turns-step-role">{step.role}</span>
              <span className="rex-turns-step-text">{step.text}</span>
              <span className="rex-turns-step-size">{step.size}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/**
 * Which API surface a turn's exchanges used.
 *
 * Null when nothing recorded one — a row written before spec 51, or a request
 * REX could not place. Never guessed: a guess would put two genuinely different
 * message shapes under one name, which is the whole thing this column exists to
 * prevent.
 */
function apiOf(exchanges: readonly GatewayTrafficRow[]): string | null {
  const seen = [...new Set(exchanges.map((row) => row.api).filter(Boolean))];
  if (seen.length === 0) return null;
  return seen.map((one) => API_LABEL[one as string] ?? String(one)).join(" · ");
}

function Fact({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return (
    <span className="rex-turns-fact">
      <span className="rex-turns-fact-label">{label}</span>
      {/* Null is "nobody recorded it" and is drawn as that, never as a default. */}
      <span className="rex-turns-fact-value">{value ?? "—"}</span>
    </span>
  );
}
