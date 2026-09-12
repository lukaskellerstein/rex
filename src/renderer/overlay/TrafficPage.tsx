// Spec 51 §5.1 — Traffic, depth 1. Every chat REX has run.
//
// Reached from the app and not from a comment, which is what makes it the one
// screen that can answer "what has REX run at all". Nothing before this spec
// could: the chat's own trace and the traffic sheet both start from a comment
// you already have open, so a question about last Tuesday had nowhere to be
// asked.
//
// **It is called Traffic, and the artboard's own title is the one thing here
// not taken from the design.** `Trace.dc.html` says "Trace", and REX already
// has a trace: the sheet that shows one comment's machinery. Two screens called
// the same thing is how a reviewer ends up on the wrong one — which happened,
// and is what the reviewer reported on 2026-09-09. So this whole feature is
// TRAFFIC, at four depths, and the sheet keeps its own name.
//
// A PAGE and not a sheet, for Settings' reason (spec 46 §8): a dialog is for one
// decision and then dismissal, and this is a place you go to look things up.
//
// **Every row carries both halves of the join** and they answer different
// questions. Turns, cost and tokens are REX's own record and exist for every
// chat; exchanges are the built-in gateway's, so a chat answered through
// `Original` shows real turns and no exchanges at all. That is the truth rather
// than a gap — nothing went through REX's gateway, so REX's gateway saw nothing.

import { useMemo, useState } from "react";
import type { AgentSdk } from "../../shared/agent-protocol.ts";
import type { TraceChat } from "../../shared/channels.ts";
import { costText, spentText } from "../../shared/totals.ts";
import { Cross } from "./Icons.tsx";

interface Props {
  /** Null while the two sources are being read and joined. */
  chats: TraceChat[] | null;
  /** Opens depth 2 for one chat. */
  onOpenChat: (threadId: string) => void;
  onClose: () => void;
}

const EVERY = "*";

/** A count, in the unit a person would say it in. `38.2k`, not `38214`. */
function short(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

/** Today's chats say the clock; older ones say the day. */
function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : at.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function TrafficPage(props: Props): React.JSX.Element {
  const chats = props.chats ?? [];
  const [document, setDocument] = useState(EVERY);
  const [agent, setAgent] = useState(EVERY);

  const documents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const chat of chats) {
      seen.set(chat.documentId, chat.documentTitle ?? chat.documentId);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [chats]);

  const agents = useMemo(() => {
    const seen = new Set<AgentSdk>();
    for (const chat of chats) if (chat.sdk) seen.add(chat.sdk);
    return [...seen].sort();
  }, [chats]);

  const shown = chats.filter(
    (chat) =>
      (document === EVERY || chat.documentId === document) &&
      (agent === EVERY || chat.sdk === agent),
  );

  const totals = shown.reduce(
    (sum, chat) => ({
      turns: sum.turns + chat.turns,
      exchanges: sum.exchanges + chat.exchanges,
      failed: sum.failed + chat.failed,
    }),
    { turns: 0, exchanges: 0, failed: 0 },
  );

  return (
    <div className="rex-page rex-traffic" aria-label="Traffic">
      <header className="rex-page-head">
        <h1>Traffic</h1>
        <span className="rex-page-crumb">every chat REX has run</span>
        <span className="rex-spacer" />
        <button
          type="button"
          className="rex-icon-button"
          data-tip="Close — esc"
          aria-label="Close traffic"
          onClick={props.onClose}
        >
          <Cross />
        </button>
      </header>

      <div className="rex-tp-filters">
        <label className="rex-tp-filter">
          <span>Document</span>
          <select value={document} onChange={(event) => setDocument(event.target.value)}>
            <option value={EVERY}>{`all ${documents.length}`}</option>
            {documents.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="rex-tp-filter">
          <span>Agent</span>
          <select value={agent} onChange={(event) => setAgent(event.target.value)}>
            <option value={EVERY}>{`all ${agents.length}`}</option>
            {agents.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </label>
        <span className="rex-spacer" />
        <span className="rex-meta">
          {`${shown.length} chats · ${totals.turns} turns · ${totals.exchanges} exchanges · ${totals.failed} failed`}
        </span>
      </div>

      <div className="rex-tp-head">
        <span className="rex-tp-col-name">CHAT</span>
        <span className="rex-tp-col">TURNS</span>
        <span className="rex-tp-col">EXCHANGES</span>
        <span className="rex-tp-col-wide">TOKENS</span>
        <span className="rex-tp-col">COST</span>
        <span className="rex-tp-col">TIME</span>
        <span className="rex-tp-col">FAILED</span>
      </div>

      <div className="rex-tp-table">
        {props.chats === null ? (
          <p className="rex-meta">Reading…</p>
        ) : shown.length === 0 ? (
          <p className="rex-settings-note">
            {chats.length === 0
              ? "REX has not run anything yet. A chat appears here the first time you ask a comment something."
              : "No chat matches those filters."}
          </p>
        ) : (
          <ul className="rex-tp-chats">
            {shown.map((chat) => (
              <li
                key={chat.threadId}
                className={chat.failed > 0 ? "rex-chat rex-chat-bad" : "rex-chat"}
              >
                <button type="button" onClick={() => props.onOpenChat(chat.threadId)}>
                  <span className="rex-tp-col-name">
                    <span className="rex-chat-name">{chat.name}</span>
                    <span className="rex-chat-meta">
                      <code>{chat.threadId.slice(0, 8)}</code>
                      <span className="rex-chat-doc">{chat.documentTitle ?? "—"}</span>
                      {chat.sdk ? <span className="rex-chat-agent">{chat.sdk}</span> : null}
                    </span>
                  </span>
                  <span className="rex-tp-col">
                    {chat.turns}
                    {/* Rows from before spec 51 belong to no turn REX can name.
                        Counted rather than hidden, so a chat from last week
                        reads as "40 messages, turns unknown" and not as empty. */}
                    {chat.untracked > 0 ? (
                      <span
                        className="rex-chat-untracked"
                        title="messages from before turns were recorded"
                      >
                        {`+${chat.untracked}?`}
                      </span>
                    ) : null}
                  </span>
                  <span className="rex-tp-col">{chat.exchanges}</span>
                  <span className="rex-tp-col-wide">
                    {`${short(chat.inputTokens)} / ${short(chat.outputTokens)}`}
                  </span>
                  <span className="rex-tp-col">
                    {chat.costUsd > 0 ? costText(chat.costUsd) : "free"}
                  </span>
                  <span className="rex-tp-col">{when(chat.updatedAt)}</span>
                  <span className={chat.failed > 0 ? "rex-tp-col rex-turns-bad" : "rex-tp-col"}>
                    {chat.failed}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {props.chats !== null && shown.length > 0 ? (
          <p className="rex-meta rex-tp-foot">
            {spentText(shown.reduce((sum, chat) => sum + chat.durationMs, 0))} of agent time in
            these chats. Exchanges are what REX's own gateway saw — a chat answered through Original
            has none.
          </p>
        ) : null}
      </div>
    </div>
  );
}
