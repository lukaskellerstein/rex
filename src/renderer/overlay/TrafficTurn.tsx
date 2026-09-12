// Spec 51 §5.3 — Traffic, depth 3. One turn, as one conversation.
//
// **Its own screen, and not the trace sheet with things added to it.** The
// first build folded this into `TraceSheet`, and the sheet is REX's own record
// of what the agent did on one comment. This is the WIRE.
//
// ── What the exchange rail was, and why it is gone ──────────────
//
// The design put a rail of exchanges down the left, and against real data it
// earned nothing. Measured on the reviewer's own log, 2026-09-09, one turn of
// six exchanges: 27, 29, 31, 33, 36 and 38 messages. **Every exchange re-sends
// the whole conversation**, so they are nested prefixes of each other — picking
// one showed the same list with two more rows on the end, which reads as
// nothing happening at all. That was the reviewer's report, and it was right.
//
// So the turn is drawn as ONE conversation — the last exchange, which contains
// every message the turn ever sent — and the loop is shown where it actually
// is: at the message each exchange STOPPED on, carrying that exchange's own
// duration. Six numbers down one list instead of six lists.
//
// ── What the roles say, and where that is decided ───────────────
//
// Not here. `wire.ts` reads a message out of whichever of spec 46 §4.5's three
// API shapes it arrived in, and this file draws the answer — the same split
// `trace.ts` has, and for a sharper reason: the reading used to live in this
// component, where only a browser could check it, and a Codex turn drew a
// column of `?` for a whole round with every test passing. `test/wire.spec.ts`
// is what checks it now.
//
// **Depth 4 still shows the raw JSON**, so the record is never what changed —
// only the word on the summary line.
//
// ── The system prompt, added 2026-09-11 ─────────────────────────
//
// The first row is the request's SYSTEM PROMPT, and it is not one of the
// request's messages. The reviewer asked why a turn's list started with a
// `user` row when a system prompt must come first, and the answer was that it
// does come first — to the model. On the Anthropic door it travels in a
// `system` field beside the conversation, and on the Responses door in
// `instructions`, so `messages` never held it and this screen never drew it.
//
// It wears a WASH rather than a fifth border colour. The four roles alternate
// down the list and are told apart by their left edge; this appears once, says
// something structurally different about where it came from, and a fifth edge
// colour would have read as a fifth role. Lemon and not gold, because the gold
// in this list is already a tool call.
//
// The grey `system` rows further down are a different thing and keep their own
// look: Claude Code puts its hook output, its `# Environment` block and its
// reminders in the conversation as system MESSAGES, and there are several.

import { useEffect, useMemo } from "react";
import type { GatewayTrafficRow, TraceMessageResult } from "../../shared/channels.ts";
import { costText, spentText } from "../../shared/totals.ts";
import { CopyText } from "./CopyText.tsx";
import { DebugCopy } from "./DebugCopy.tsx";
import { ChevronLeft, Cross, Picture } from "./Icons.tsx";
import { API_LABEL, API_PATH, MODE_LABEL } from "./mode.ts";
import { ToolIcon } from "./ToolRow.tsx";
import type { Turn } from "./trace.ts";
import { type WireMessage, wireEntries } from "./wire.ts";

interface Props {
  /** The chat this turn belongs to — the breadcrumb, and the second id. */
  chatName: string;
  chatId: string;
  turn: Turn;
  /** This turn's exchanges, in the order they were made. */
  exchanges: GatewayTrafficRow[];
  /** The LAST exchange's bodies — the whole conversation. Null while reading. */
  bodies: TraceMessageResult | null;
  /** Opens depth 4 on one message. */
  onOpenMessage: (index: number) => void;
  onBack: () => void;
  onClose: () => void;
}

/** 24-hour with seconds: these are machine times in a mono column. */
function clock(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function TrafficTurn(props: Props): React.JSX.Element {
  const entries = useMemo(() => wireEntries(props.bodies?.request), [props.bodies]);
  /**
   * How many of those rows are MESSAGES, which is not how many rows there are.
   *
   * The system prompt is a row and is not a message: it lives in a field beside
   * `messages` and the count on the wire never included it. Counting rows here
   * would quietly disagree with the exchange's own `messages` number, and that
   * number is what the stops below are keyed by.
   */
  const sent = entries.filter((entry) => entry.at !== null).length;

  /**
   * Which exchange stopped at which message, and how long it took.
   *
   * `messages` on an exchange is how many it SENT, so exchange N ends at index
   * `sent − 1`. That is where the loop is visible: the model answered, a tool
   * ran, and the next request went out one or two messages longer.
   *
   * Keyed by the place in `messages` and never by the place in the list, which
   * the system prompt shifts by one.
   */
  const stops = useMemo(() => {
    const map = new Map<number, GatewayTrafficRow>();
    props.exchanges.forEach((row) => {
      if (typeof row.messages === "number" && row.messages > 0) map.set(row.messages - 1, row);
    });
    return map;
  }, [props.exchanges]);

  const failed = props.exchanges.filter((row) => row.error).length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const turn = props.turn;

  return (
    <div className="rex-page rex-traffic" aria-label="One turn">
      <header className="rex-page-head rex-tt-head">
        <button type="button" className="rex-tt-back" onClick={props.onBack}>
          <ChevronLeft size={12} />
          {props.chatName}
        </button>
        <span className="rex-tt-slash">/</span>
        <h1>{turn.runId === null ? "Before turns were recorded" : `Turn ${turn.number}`}</h1>
        {/*
          §5.5 — REX's own `.rex-sent` pill, exactly as the chat draws a
          recorded mode. Never a second pill that merely looks like it.
        */}
        {turn.mode ? (
          <span className={`rex-sent rex-sent-${turn.mode}`}>{MODE_LABEL[turn.mode]}</span>
        ) : null}
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
        Both ids, always on screen. **A trace you cannot quote is a trace you
        cannot ask anybody else about** — so they are here and copyable rather
        than something a reviewer digs out of the database.
      */}
      <div className="rex-tt-ids">
        {turn.runId ? (
          <span className="rex-tt-id">
            <span className="rex-tt-id-label">turn</span>
            <code>{turn.runId}</code>
            <CopyText text={turn.runId} what="turn id" />
          </span>
        ) : null}
        <span className="rex-tt-id">
          <span className="rex-tt-id-label">chat</span>
          <code>{props.chatId}</code>
          <CopyText text={props.chatId} what="chat id" />
        </span>
        <span className="rex-spacer" />
        <span className="rex-tt-span">{`${clock(turn.startedAt)} → ${clock(turn.endedAt)}`}</span>
        {/*
          Spec 55 §3.1 — this turn, as text: the nine facts, the exchanges with
          the line each one is on in the log, and the steps. It is the screen in
          the shape a question is asked in, which the screen itself is not.
        */}
        <DebugCopy
          copy={() => window.rex.traceCopyTurn(props.chatId, turn.runId)}
          what="turn"
          subject={`${props.chatId}#${turn.runId ?? "unrecorded"}`}
          className="rex-tt-debug"
          doneClassName="rex-tt-debug-done"
          withLabel
        />
      </div>

      <Facts turn={turn} exchanges={props.exchanges} />

      <div className="rex-tt-pane-head">
        <span className="rex-tt-pane-title">{`${sent} message${sent === 1 ? "" : "s"}`}</span>
        {/*
          Said in the head as well as drawn in the list, because the row it
          refers to is the one thing here that is NOT in the count beside it.
          A reader who sees "2 messages" over three rows has to be told why.
        */}
        {sent < entries.length ? (
          <span className="rex-tt-pane-prompt">and 1 system prompt</span>
        ) : null}
        {/*
          The loop, said once. Each exchange re-sends everything, so the turn is
          ONE conversation that a request was made of six times — and the marks
          down the list say where each of those requests stopped.
        */}
        <span className="rex-tt-pane-meta">
          {`sent in ${props.exchanges.length} exchange${props.exchanges.length === 1 ? "" : "s"}`}
          {failed > 0 ? ` · ${failed} never answered` : ""}
        </span>
        {/*
          The door these messages came through, beside the count of them. The
          two shapes differ — a tool result is a USER message on Anthropic and a
          TOOL message on OpenAI — so a reader scanning this list has to know
          which they are reading before the first row, not after it surprises
          them.
        */}
        {apiOf(props.exchanges) !== "—" ? (
          <span className="rex-tt-api" title={pathOf(props.exchanges)}>
            {apiOf(props.exchanges)}
          </span>
        ) : null}
        <span className="rex-spacer" />
        <span className="rex-tt-hint">click a message for its JSON</span>
      </div>

      <div className="rex-tt-list">
        {props.exchanges.length === 0 ? (
          <p className="rex-settings-note">
            No exchange was recorded for this turn. Only REX's own built-in gateway keeps a traffic
            log, so a turn answered through Original or somebody else's LiteLLM has none.
          </p>
        ) : props.bodies === null ? (
          <p className="rex-meta">Reading…</p>
        ) : props.bodies.problem ? (
          // §10 rule 4 — a body may be absent, and then it says why. It may
          // never be wrong, so nothing is drawn in its place.
          <p className="rex-settings-note">{props.bodies.problem}</p>
        ) : entries.length === 0 ? (
          <p className="rex-settings-note">
            Nothing was recorded for this request. Settings → Gateways turns body capture back on,
            and the next run will have one.
          </p>
        ) : (
          entries.map((entry, position) => (
            <Message
              // The rows of one turn are fixed and never reordered, so the
              // position is the identity.
              key={position}
              message={entry.seen}
              // The system prompt has no number: it is not one of the messages
              // the numbers count, and calling it 1 would make message 1 be 2.
              number={entry.at === null ? null : entry.at + 1}
              stop={entry.at === null ? null : (stops.get(entry.at) ?? null)}
              onOpen={() => props.onOpenMessage(position)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Message({
  message,
  number,
  stop,
  onOpen,
}: {
  message: WireMessage;
  /** Its place in the conversation, or null for a row that is not a message. */
  number: number | null;
  /** The exchange that ended here, if one did. */
  stop: GatewayTrafficRow | null;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className={`rex-tt-msg rex-tt-${message.kind}`} onClick={onOpen}>
      <span className="rex-tt-msg-head">
        {/* Empty and not absent, so every row's role starts at one column. */}
        <span className="rex-tt-n">{number ?? ""}</span>
        {message.role ? <span className="rex-tt-role">{message.role}</span> : null}
        {message.tools.map((tool) => (
          <span key={tool} className="rex-tt-tool-name">
            <ToolIcon glyph="command" size={11} />
            {tool}
          </span>
        ))}
        <span className="rex-spacer" />
        {message.image ? (
          <span className="rex-tt-image">
            <Picture />1 image
          </span>
        ) : null}
        {/*
          The turn's clock, where the turn actually spends it. An exchange ends
          at this message, so this is the wait the reviewer sat through — and it
          is the number the rail used to hold, now beside what it belongs to.
        */}
        {stop ? (
          <span className={stop.error ? "rex-tt-took rex-tt-took-bad" : "rex-tt-took"}>
            {stop.error ? "never answered" : stop.ms === null ? "—" : spentText(stop.ms)}
          </span>
        ) : null}
        <span className="rex-tt-size">{message.size}</span>
        <span className="rex-tt-json">JSON</span>
      </span>
      <span className={message.thinking ? "rex-tt-text rex-tt-thinking" : "rex-tt-text"}>
        {message.text}
      </span>
    </button>
  );
}

/**
 * §5.3 — the nine facts, as a grid and not a sentence.
 *
 * Every one is a column you would sort by if this were a table, so each gets a
 * cell of its own. **Five come from `rex.db`'s `message` row and the rest from
 * the traffic log** — that split is the structural fact §4 turns on, and it is
 * why neither source could draw this screen alone.
 *
 * MODE is the one cell that is not a value but a STATE, so it wears the pill
 * the chat wears rather than being mono text like its neighbours.
 */
function Facts({
  turn,
  exchanges,
}: {
  turn: Turn;
  exchanges: GatewayTrafficRow[];
}): React.JSX.Element {
  const wireIn = sumOf(exchanges.map((row) => row.tokensIn));
  const wireOut = sumOf(exchanges.map((row) => row.tokensOut));
  const cells: Array<{ label: string; value: string; under?: string; mode?: Turn["mode"] }> = [
    { label: "AGENT", value: turn.sdk ?? "—" },
    // The gateway and its URL are ONE fact — spec 43 §5.3 records them as
    // "through which gateway, at which URL" — so they share a cell. That also
    // keeps the grid at ten, which is two clean rows of five; an eleventh cell
    // sat alone on a third row and read as something missing.
    {
      label: "GATEWAY",
      value: turn.gatewayName ?? "—",
      under: turn.baseUrl ?? "the SDK's own endpoint",
    },
    { label: "OUTPUT STYLE", value: turn.style ?? "—" },
    { label: "MODEL", value: turn.model ?? "—" },
    // Which of §4.5's three doors, because one model answers on all three and
    // what comes back is not the same shape.
    { label: "API", value: apiOf(exchanges) },
    { label: "MODE", value: turn.mode ? MODE_LABEL[turn.mode] : "—", mode: turn.mode },
    { label: "DURATION", value: turn.durationMs > 0 ? spentText(turn.durationMs) : "—" },
    {
      label: "COST",
      value: turn.costUsd === null ? "—" : turn.costUsd === 0 ? "free" : costText(turn.costUsd),
    },
    { label: "TOKENS IN", value: countOf(turn.inputTokens, wireIn) },
    { label: "TOKENS OUT", value: countOf(turn.outputTokens, wireOut) },
  ];

  return (
    <div className="rex-tt-facts">
      {cells.map((cell) => (
        <div key={cell.label} className="rex-tt-fact">
          <span className="rex-tt-fact-label">{cell.label}</span>
          {cell.mode ? (
            <span className={`rex-sent rex-sent-${cell.mode}`}>{cell.value}</span>
          ) : (
            <span className="rex-tt-fact-value">{cell.value}</span>
          )}
          {cell.under ? <span className="rex-tt-fact-under">{cell.under}</span> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Which API surface this turn used, across its exchanges.
 *
 * Almost always one. It is written as a list when it is not, because a turn
 * that changed door mid-way is exactly the thing a reader would want to know
 * and exactly the thing a single value would hide.
 */
function apiOf(exchanges: readonly GatewayTrafficRow[]): string {
  const seen = [...new Set(exchanges.map((row) => row.api).filter(Boolean))];
  if (seen.length === 0) return "—";
  return seen.map((one) => API_LABEL[one as string] ?? String(one)).join(" · ");
}

/** The endpoint behind the label, for the tooltip. The machine's own answer. */
function pathOf(exchanges: readonly GatewayTrafficRow[]): string | undefined {
  const first = exchanges.map((row) => row.api).find(Boolean);
  return first ? API_PATH[first] : undefined;
}

function sumOf(values: Array<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) if (value !== null) total = (total ?? 0) + value;
  return total;
}

/**
 * REX's own count, and the wire's beside it when they answer different questions.
 *
 * They differ whenever a turn made more than one exchange, because each one
 * re-sends the conversation and the gateway counts every send. Two numbers, so
 * neither has to be wrong.
 */
function countOf(own: number | null, wire: number | null): string {
  if (own === null && wire === null) return "—";
  if (own === null) return `${wire} on the wire`;
  if (wire === null || wire === own) return String(own);
  return `${own} · ${wire} sent`;
}
