// Spec 55 §3 — one chat's turns, or one turn, as text somebody can paste.
//
// Traffic answers *what did REX send, and what came back*, on a screen. The
// reviewer's next move is to ask somebody about it, and at that moment the
// screen is the wrong shape: the facts are in ten cells, the ids are in two
// more, and the log the reader needs is a file the screen never names.
//
// So this is the third report, and it is not either of the first two. The app's
// (spec 13 §4) is about this REX; the comment's (spec 01 §6.2) is about one
// thread and its session file. This one is about a TURN — REX's own rows joined
// to what the gateway saw — which is the one thing neither of the others can
// name, because the join key did not exist until spec 51.
//
// Built in main because it reads `rex.db` and the traffic log, and because main
// owns the clipboard. A renderer copy needs the window focused, which fails in
// exactly the case the button exists for.
//
// Plain text, one `KEY  value` per line, the same shape the other two reports
// have. It is read by a human before it is read by anything else.

import { commentName } from "../shared/names.ts";
import { spentText } from "../shared/totals.ts";
import { type TurnFacts, turnFactsOf } from "../shared/turns.ts";
import type { Message, Thread } from "../shared/types.ts";
import type { Db } from "./db/database.ts";
import { DB_PATH } from "./db/location.ts";
import { getDocument, getThread, listMessages } from "./db/queries.ts";
import { badStepsOf, bytes, clip, tilde, versionLine } from "./debug.ts";
import { trafficAvailability } from "./gateway/availability.ts";
import { trafficDir } from "./gateway/paths.ts";
import { runTraffic, type TrafficRow, threadTraffic } from "./gateway/traffic.ts";

/**
 * How many steps of one turn the report prints.
 *
 * An ACT run can be two hundred calls, and a report nobody can paste into a
 * chat window is a report that does not do its job. The rest are counted rather
 * than dropped silently — `READ` is right above, and it reads all of them.
 */
const MAX_STEPS = 100;

/** How much of one step's text survives. The whole of it is in the database. */
const STEP_CHARS = 140;

/**
 * The chat, as a command whoever reads this can run.
 *
 * Spec 01 §6.2 settled the shape and the reasons: `.mode line` because an
 * agent's turn is prose with newlines in it, and `PRAGMA query_only = 1` rather
 * than `sqlite3 -readonly`, which dies with `unable to open database file (14)`
 * once REX has quit — exactly when somebody is reading a pasted report.
 *
 * `run_id` is in the column list here and is not in §6.2's, which is the whole
 * difference between the two reports: this one is about a turn, and the turn is
 * that column.
 */
function readLines(thread: Thread, runId: string | null, rows: readonly TrafficRow[]): string[] {
  const id = thread.id.replace(/'/g, "''");
  const open = `sqlite3 ${tilde(DB_PATH)} "PRAGMA query_only = 1" ".mode line"`;
  const where =
    runId === null
      ? `WHERE thread_id = '${id}'`
      : `WHERE thread_id = '${id}' AND run_id = '${runId.replace(/'/g, "''")}'`;

  const lines = [
    "READ",
    `  rows       ${open} "SELECT seq, run_id, role, kind, tool_name, content FROM message ${where} ORDER BY seq"`,
    "  words      the same query with AND kind = 'text' before ORDER BY — the two sides' turns, no tool traffic",
  ];

  // The log is `<day>.jsonl`, and a row's id says which day it is in. Naming
  // the files rather than the directory is what makes this line runnable: the
  // directory holds thirty days, and a reader who greps all of them gets every
  // other chat too.
  const days = [...new Set(rows.map((row) => row.id.split("#")[0]))];
  const filter = runId === null ? `.thread=="${id}"` : `.run=="${runId}"`;
  if (days.length > 0) {
    const files = days.map((day) => `${tilde(trafficDir())}/${day}.jsonl`).join(" ");
    lines.push(
      `  exchanges  jq -c 'select(${filter})' ${files}`,
      "  bodies     each line carries its own request and response, unless it names an overflow file beside it",
    );
  }
  return lines;
}

/** `59305 in · 1321 out`, and the honest answer when nobody counted. */
function tokenText(inTokens: number | null, outTokens: number | null): string {
  if (inTokens === null && outTokens === null) return "no tokens recorded";
  return `${inTokens ?? "—"} in · ${outTokens ?? "—"} out`;
}

/**
 * Spec 43 §8.1 — a cost nobody reported is said as that, never as `$0.0000`.
 *
 * A routed Claude run reports none on purpose and a Codex run reports none at
 * all, so this is the ordinary case rather than the odd one.
 */
function costLine(usd: number | null): string {
  return usd === null ? "cost not reported" : `$${usd.toFixed(4)}`;
}

/** Which of spec 46 §4.5's three surfaces a turn's exchanges went to. */
function apiOf(rows: readonly TrafficRow[]): string {
  // The stored word — `anthropic`, not `Anthropic`. The screen names the
  // surface for a person (`API_LABEL`); this reader is about to grep a `.jsonl`
  // for the exact string, and the two jobs want different words.
  const seen = [...new Set(rows.map((row) => row.api).filter(Boolean))];
  return seen.length === 0 ? "not recorded" : seen.join(" · ");
}

/** The turn's own facts, one per line, as depth 3 draws them in cells. */
function turnLines(turn: TurnFacts, rows: readonly TrafficRow[]): string[] {
  return [
    `  agent      ${turn.sdk ?? "—"}`,
    `  gateway    ${turn.gatewayName ?? "—"} · ${turn.baseUrl ?? "(the SDK's own endpoint)"}`,
    `  model      ${turn.model ?? "(the SDK's default)"}`,
    `  style      ${turn.style ?? "(the SDK's default)"}`,
    `  api        ${apiOf(rows)}`,
    `  when       ${turn.startedAt || "—"} → ${turn.endedAt || "—"} · ${spentText(turn.durationMs)}`,
    `  tokens     ${tokenText(turn.inputTokens, turn.outputTokens)} · ${costLine(turn.costUsd)}`,
    `  counts     ${count(rows.length, "exchange")} · ${count(turn.messages, "row")} · ${count(turn.toolCalls, "tool call")} · ${turn.failed} failed`,
  ];
}

/** `1 exchange`, `2 exchanges` — and `0 exchanges`, which is a fact too. */
function count(many: number, what: string): string {
  return `${many} ${what}${many === 1 ? "" : "s"}`;
}

/** One turn as a chat report lists it: the name line, then who and how much. */
function turnBlock(turn: TurnFacts, rows: readonly TrafficRow[]): string[] {
  const name = turn.runId === null ? "before turns were recorded" : `${turn.number} ${turn.runId}`;
  const mode = turn.mode ? ` · ${turn.mode.toUpperCase()}` : "";
  return [
    `  ${name}${mode} · ${turn.startedAt || "—"} → ${turn.endedAt || "—"} · ${spentText(turn.durationMs)}`,
    `      ${turn.sdk ?? "—"} · ${turn.gatewayName ?? "—"} · ${turn.model ?? "—"} · style ${turn.style ?? "—"} · api ${apiOf(rows)}`,
    `      ${count(rows.length, "exchange")} · ${count(turn.messages, "row")} · ${count(turn.toolCalls, "tool call")} · ${turn.failed} failed · ${tokenText(turn.inputTokens, turn.outputTokens)} · ${costLine(turn.costUsd)}`,
  ];
}

/**
 * One exchange, as the gateway wrote it.
 *
 * The id is `<day>#<line>` and is first, because it is what depth 4 opens and
 * what `jq` can be pointed at. **A failure is a row like any other** — that is
 * what the traffic log has over Grafana — so one that never answered says so
 * here rather than being left out.
 */
function exchangeLines(rows: readonly TrafficRow[]): string[] {
  return rows.map((row, index) => {
    const state = row.error ? `NEVER ANSWERED · ${clip(row.error, 160)}` : "ok";
    const sent = row.messages === null ? "messages not counted" : count(row.messages, "message");
    const took = row.ms === null ? "—" : spentText(row.ms);
    return `  ${index + 1} ${row.id} · ${row.at} · ${took} · ${sent} · ${tokenText(row.tokensIn, row.tokensOut)} · ${state}`;
  });
}

/**
 * One `message` row, as one line.
 *
 * The whole text is in the database and `READ` says how to get it, so this is
 * the first line and a size. Spec 51 §5.2's rule for the brief step list, in a
 * report: at this level a message is 40 KB and the question is only "what did
 * it do".
 */
function stepLine(message: Message): string {
  const what = message.toolName ? `${message.kind} ${message.toolName}` : message.kind;
  const state = message.denied ? " DENIED" : message.isError ? " FAILED" : "";
  const body = message.content ?? (message.toolInput ? JSON.stringify(message.toolInput) : "");
  const size = message.content ? ` · ${bytes(message.content.length)}` : "";
  return `  ${message.seq} ${message.role} ${what}${state} · ${clip(body, STEP_CHARS) || "(empty)"}${size}`;
}

/**
 * The refusals and the failures, under two headings and never one.
 *
 * They send a reader to different places: DENIED is a question about REX's
 * gate, FAILED is a question about the command. Spec 01 §6.2 learned this the
 * hard way — every failed shell line was printed as a gate refusal until
 * 2026-09-01.
 */
function badLines(messages: readonly Message[]): string[] {
  const bad = badStepsOf(messages);
  const lines: string[] = [];
  for (const [heading, steps] of [
    ["DENIED — the gate refused these", bad.filter((step) => step.denied)],
    ["FAILED — these ran and did not succeed", bad.filter((step) => !step.denied)],
  ] as const) {
    if (steps.length === 0) continue;
    lines.push("", `${heading} (${steps.length})`);
    for (const [index, step] of steps.entries()) {
      lines.push(`  ${index + 1} ${step.toolName} · ${step.reason}`, `      ${step.command}`);
    }
  }

  const errors = messages.filter((message) => message.kind === "error");
  if (errors.length > 0) {
    lines.push("", `ERRORS (${errors.length})`);
    for (const error of errors) lines.push(`  ${clip(error.content ?? "", 300)}`);
  }
  return lines;
}

/** The head every one of these reports opens with. */
function head(kind: "CHAT" | "TURN"): string[] {
  return [`REX traffic · ${new Date().toISOString()} · ${kind}`, ""];
}

/** Which chat this is, and what it is about. */
function chatLines(db: Db, thread: Thread): string[] {
  // `thread.documentId` is `targets[0]`'s document — where the comment started.
  // A comment about several documents names the first here and the rest are in
  // the comment report, which is the one that lists places.
  const document = getDocument(db, thread.documentId);
  return [
    `  chat       ${thread.id} · "${clip(commentName(thread), 120)}"`,
    `  document   ${document ? tilde(document.ref.value) : "(the document is gone)"}`,
    `  comment    ${clip(thread.note, 240) || "(empty)"}`,
    `  state      ${thread.kind} · ${thread.status} · profile ${thread.profile}`,
    `  asked      ${thread.createdAt} → ${thread.updatedAt}`,
    `  database   ${tilde(DB_PATH)}`,
  ];
}

/**
 * Why there are no exchanges, when there are none.
 *
 * Said once, as a sentence, rather than as a dash on every row — and never as
 * an empty section, which would read as "nothing went over the wire" when what
 * happened is that nobody was watching.
 */
function silentLine(messages: readonly Message[]): string {
  const { reason } = trafficAvailability(messages);
  return `  none. ${reason ?? "REX's own gateway recorded nothing for this."}`;
}

/**
 * Spec 55 §3.2 — one chat, its turns, and what the gateway saw of them.
 *
 * The chat report and depth 2 draw the same numbers because both come from
 * `turnFactsOf`. A report that disagrees with the screen it was copied from is
 * worse than no report: by then nobody can check it.
 */
export function chatTrafficReport(db: Db, threadId: string, appVersion: string): string {
  const thread = getThread(db, threadId);
  if (!thread) throw new Error(`No such chat: ${threadId}`);

  const messages = listMessages(db, threadId);
  const rows = threadTraffic(threadId, false);
  const turns = turnFactsOf(messages);
  const byRun = new Map<string, TrafficRow[]>();
  for (const row of rows) {
    if (!row.run) continue;
    byRun.set(row.run, [...(byRun.get(row.run) ?? []), row]);
  }

  const failed = rows.filter((row) => row.error).length;
  const lines = [
    ...head("CHAT"),
    ...readLines(thread, null, rows),
    "",
    "CHAT",
    ...chatLines(db, thread),
    `  totals     ${count(turns.filter((turn) => turn.runId).length, "turn")} · ${count(rows.length, "exchange")} · ${count(messages.length, "row")} · ${failed} never answered`,
    "",
    `TURNS (${turns.length})`,
  ];

  for (const turn of turns) {
    lines.push(...turnBlock(turn, turn.runId ? (byRun.get(turn.runId) ?? []) : []));
  }
  if (turns.length === 0) lines.push("  none. Nothing has run on this comment yet.");

  if (rows.length === 0) lines.push("", "EXCHANGES (0)", silentLine(messages));
  lines.push(...badLines(messages), "", "VERSIONS", `  ${versionLine(appVersion)}`);
  return lines.join("\n");
}

/**
 * Spec 55 §3.1 — one turn, from both sides of the join.
 *
 * `runId` is null for the rows written before spec 51 recorded one. That turn
 * is reported like any other and says so, rather than being refused: a chat
 * from last week has real machinery in it, and the reviewer looking at it is
 * the one most likely to need help.
 */
export function turnTrafficReport(
  db: Db,
  threadId: string,
  runId: string | null,
  appVersion: string,
): string {
  const thread = getThread(db, threadId);
  if (!thread) throw new Error(`No such chat: ${threadId}`);

  const messages = listMessages(db, threadId).filter((message) => message.runId === runId);
  const turn = turnFactsOf(listMessages(db, threadId)).find((one) => one.runId === runId);
  if (!turn) throw new Error(`No such turn in this chat: ${runId ?? "(unrecorded)"}`);

  const rows = runId === null ? [] : runTraffic(threadId, runId);
  const shown = messages.slice(0, MAX_STEPS);

  const lines = [
    ...head("TURN"),
    ...readLines(thread, runId, rows),
    "",
    "TURN",
    `  turn       ${runId ?? "never recorded — these rows were written before REX kept a turn id"}${turn.mode ? ` · ${turn.mode.toUpperCase()}` : ""}`,
    ...chatLines(db, thread),
    ...turnLines(turn, rows),
    "",
    `EXCHANGES (${rows.length})`,
    ...(rows.length === 0 ? [silentLine(listMessages(db, threadId))] : exchangeLines(rows)),
    "",
    `STEPS (${messages.length})`,
    ...shown.map(stepLine),
  ];

  if (messages.length > shown.length) {
    lines.push(`  … ${messages.length - shown.length} more rows. READ above has all of them.`);
  }

  lines.push(...badLines(messages), "", "VERSIONS", `  ${versionLine(appVersion)}`);
  return lines.join("\n");
}
