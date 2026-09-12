// Spec 08 §6.2 — the run, named rather than described.
//
// A reviewer can always say what they saw. What they cannot say is which of the
// fourteen JSONL files under `~/.claude/projects/<cwd>/` holds this answer,
// which thread row it came from, or which working directory the agent was
// pointed at — and those are the first three things anybody debugging it needs.
// Every one of them is known only to the main process, so the report is built
// here.
//
// It is COPIED, not shown. Its destination is a chat window with whoever is
// fixing REX, and a panel that displays it would only add a step between the
// two. `esc close` is beside it because both are the same kind of thing: what
// you do with a trace once you have read it.
//
// Plain text, one `KEY  value` per line. Not JSON: it is read by a human before
// it is read by anything else, and a wrapped 4 KB JSON blob is neither.

import { homedir } from "node:os";
import { spentText, totalsOf } from "../shared/totals.ts";
import type { Anchor, Message, Thread, ViewState } from "../shared/types.ts";
import { sessionState } from "./agent/bridge.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { agentService } from "./agent/service.ts";
import { type CdpStatus, cdpLines } from "./cdp.ts";
import type { Db } from "./db/database.ts";
import { listGateways, listThreadSessions } from "./db/gateways.ts";
import { DB_PATH } from "./db/location.ts";
import { getDocument, getThread, listMessages } from "./db/queries.ts";
import type { LogEntry } from "./log.ts";
import { agentCwd } from "./threads.ts";

const HOME = homedir();

/** `~/…`, per rules/11 — a home directory is noise in something a human reads. */
export function tilde(path: string): string {
  return path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
}

export function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The size of the SDK's transcript, or why there is none.
 *
 * A missing file is not an error here — it is the answer. The SDK's session
 * store is a cache and gets cleaned (§8.5), so "gone" is the single most useful
 * thing this report can say about a thread that will not resume.
 *
 * Spec 42 §9.3 — the size is measured by the agent library, because the library
 * is what knows where the Claude CLI keeps its transcripts. Main only draws it.
 */
function transcriptSize(size: number | null): string {
  return size === null ? "missing" : bytes(size);
}

/**
 * The Agent SDK versions that are actually running.
 *
 * Spec 42 moved the SDKs into the agent library, so this is no longer a
 * question main can answer by reading `node_modules` — the library reports what
 * its own interpreter imported, in the `ready` message. That is still the right
 * number for the same reason it always was: `dependencies` carries a RANGE, and
 * the range is never what ran.
 *
 * `unknown` before the library has answered, which happens once at start-up.
 */
function sdkVersions(): string {
  const running = agentService().state().sdks;
  const named = Object.entries(running).map(([name, version]) => `${name} ${version}`);
  return named.length > 0 ? named.join(", ") : "unknown";
}

/** What one place is anchored BY — the field that decides how it resolves. */
function describeAnchor(anchor: Anchor): string {
  const parts: string[] = [];
  if (anchor.extent) parts.push(anchor.extent);
  if (anchor.region) parts.push("region");
  if (anchor.element) parts.push(`element ${anchor.element.id ?? anchor.element.css ?? "?"}`);
  if (anchor.quote) parts.push(`"${clip(anchor.quote.exact, 60)}"`);
  return parts.join(" · ") || "position only";
}

/**
 * The chat itself, as a command whoever reads this can run.
 *
 * The report has always NAMED the thread and the database. It never said how to
 * get from one to the other, so every paste of it ended the same way: the reader
 * knows a conversation exists, holds its id, and still has to be told which
 * table to look in. This is spec 13 §4.2's `ATTACH` block for the comment
 * report — the part that turns "this answer is wrong" into an instruction a
 * fresh session can follow without asking anything.
 *
 * `.mode line` and not the default list mode: an agent's turn is prose with
 * newlines in it, and pipe-separated rows of it are unreadable exactly when the
 * content is the thing being read.
 *
 * `PRAGMA query_only = 1` and NOT `sqlite3 -readonly`, which is the obvious
 * thing to reach for and fails: a WAL database can be opened read-only only
 * while its `-shm` file exists, so `-readonly` works while REX is running and
 * dies with `unable to open database file (14)` once it has quit — which is
 * exactly when somebody is reading a pasted report. The pragma refuses every
 * write on a connection that opened normally, so the guarantee survives without
 * the trap. What is being handed over is the reviewer's whole comment database,
 * and the reader is usually another agent.
 */
function readLines(threadId: string): string[] {
  // Every id REX makes is a uuid, so this can only matter for one hand-written
  // by somebody debugging — where a silently broken command is the worst answer.
  const id = threadId.replace(/'/g, "''");
  const open = `sqlite3 ${tilde(DB_PATH)} "PRAGMA query_only = 1" ".mode line"`;
  return [
    "READ",
    `  chat       ${open} "SELECT seq, role, kind, tool_name, content FROM message WHERE thread_id = '${id}' ORDER BY seq"`,
    "  words      same query with AND kind = 'text' before ORDER BY — the two sides' turns, no tool traffic",
    `  comment    ${open} "SELECT * FROM thread WHERE id = '${id}'"`,
    "  steps      the same run as the SDK recorded it is the `sdk log` file below",
  ];
}

/** A call that did not do its job — refused by the gate, or failed on its own. */
interface BadStep {
  toolName: string;
  /** The gate's sentence for a refusal; the tool's own output for a failure. */
  reason: string;
  command: string;
  denied: boolean;
}

/** The full argument of a denied call — the clipped one is already in the reason. */
function commandOf(call: Message): string {
  const input = (call.toolInput ?? {}) as Record<string, unknown>;
  const command = input.command ?? input.file_path ?? input.pattern ?? input.path;
  return clip(typeof command === "string" ? command : JSON.stringify(input), 400);
}

/**
 * A tool's own output, on one line — the shape a report of one line per step
 * needs. The full text is in the database, and READ says how to get it.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Every call that went wrong, with the command that earned it.
 *
 * §4's `Message` has no `tool_use_id`, so a result does not name the call it
 * answers and the pairing has to be rebuilt: the earliest call of the same tool
 * that nothing has answered yet. Order rather than identity, which is the best
 * the stored rows allow — and the reason itself is the row's own words either
 * way, so a mispaired command is the worst this can get wrong.
 *
 * Refusals and failures are BOTH collected here and told apart by `denied`,
 * because the walk that pairs them is the same walk. What must never be the same
 * is what the report calls them: until 2026-09-01 this returned "denials" and
 * every failed shell line was printed as one, so a report of thread `f5e79775`
 * announced two gate refusals in a session where the gate never fired.
 */
export function badStepsOf(messages: readonly Message[]): BadStep[] {
  const pending: Message[] = [];
  const bad: BadStep[] = [];

  for (const message of messages) {
    if (message.kind === "tool_call") {
      pending.push(message);
      continue;
    }
    if (message.kind !== "tool_result") continue;

    const at = pending.findIndex((call) => call.toolName === message.toolName);
    const [call] = pending.splice(at === -1 ? 0 : at, 1);
    if (!message.isError) continue;

    bad.push({
      toolName: message.toolName ?? call?.toolName ?? "unknown",
      reason: clip(oneLine(message.content ?? ""), 300),
      command: call ? commandOf(call) : "(the call it answered is not in the transcript)",
      denied: message.denied,
    });
  }
  return bad;
}

/**
 * Spec 25 §5 and spec 31 §5 — what the most recent send ran under, or null.
 *
 * The last row that has one, not the last row: a run's final `completed` block
 * carries it, but a NOTE saved afterwards does not, and "the reviewer wrote a
 * note last" is not an answer to "what model is this comment using".
 *
 * The two are found independently, because a comment can have run on a model
 * before spec 31 added the style — and reporting the style as missing because
 * the model row was older would be a lie about a column that was simply not
 * there yet.
 */
export function lastChoice(messages: readonly Message[], field: "model" | "style"): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index][field];
    if (value !== null) return value;
  }
  return null;
}

/**
 * Spec 34 §7.1 — the mode of the last send, which is what the report is about.
 *
 * `thread.profile` is a column that never changes, and a report that said
 * `profile read` about a comment whose last run was ACT sent an analysis down
 * the wrong path for a turn (§1.1). The mode is a property of a send, so the
 * honest answer is the last one; null when nothing was ever sent.
 */
export function lastMode(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.mode) return message.mode;
  }
  return null;
}

/** `text 5 · tool_call 4 · …` — what the transcript is made of, before reading it. */
function kindCounts(messages: readonly Message[]): string {
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.kind, (counts.get(message.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${kind} ${count}`).join(" · ");
}

function placeLines(db: Db, thread: Thread): string[] {
  return thread.targets.map((target, index) => {
    const document = getDocument(db, target.documentId);
    const where = document ? tilde(document.ref.value) : `(document ${target.documentId} is gone)`;
    // `null` is "nobody looked", never "orphaned" — spec 05 §5.4, and the
    // distinction is the whole difference between waiting and lost.
    return `  ${index + 1} ${where} · ${target.state ?? "unchecked"} · ${describeAnchor(target.anchor)}`;
  });
}

/**
 * Where the SDK keeps this session, and whether it can still be resumed.
 *
 * The SDK's record and the file on disk are reported SEPARATELY, and that is
 * the point of the pair: they can disagree, and every way they disagree is a
 * different bug. A record with no file means the store moved — `CLAUDE_CONFIG_DIR`
 * is the usual reason. A file with no record means the SDK will refuse to
 * resume it and §8.5's replay is what will actually happen. Collapsing the two
 * into one "resumable: yes" is what hid both.
 */
async function sessionLines(cwd: string, thread: Thread): Promise<string[]> {
  const sessionId = thread.sessionId ?? sessionIdFor(thread.id);
  if (thread.sessionId === null) {
    return [`  session    ${sessionId} · never run; this is the id the first ask would take`];
  }

  const state = await sessionState(cwd, sessionId);
  return [
    `  session    ${sessionId}`,
    state.summary !== null
      ? `  sdk store  has it · ${transcriptSize(state.size)} · last written ${new Date(state.lastModified ?? 0).toISOString()}`
      : "  sdk store  NO record of this session — a reply replays the thread into a fresh one (§8.5)",
    `  sdk log    ${state.path === null ? "unknown" : tilde(state.path)} · ${transcriptSize(state.size)}`,
  ];
}

/**
 * Spec 43 §9 — one block per combination this thread has used.
 *
 * A thread can have several sessions now — one per (thread, SDK, gateway) — and
 * "which session" stopped being a single answer the moment the gateway became a
 * choice. Each line names the agent, the gateway, the URL and the session id, so
 * a reader looking at an answer from a local model can find the transcript that
 * produced it rather than the newest one.
 *
 * **It never prints a credential value, an auth header, or the child's
 * environment** (§9). The URL is what the run addressed, and a URL is not a
 * secret; the variable a route names is printed nowhere here, because the
 * question this block answers is "where did this go", not "how did it get in".
 */
function combinationLines(db: Db, thread: Thread): string[] {
  const rows = listThreadSessions(db, thread.id);
  if (rows.length === 0) return [];
  const lines = ["", `COMBINATIONS (${rows.length})`];
  for (const row of rows) {
    lines.push(
      `  agent    : ${row.sdk}`,
      // The gateway's LIVE name, joined from the row, where the messages keep
      // the name they were produced under. The two disagreeing is a rename, and
      // seeing both is how a reader works that out.
      `  gateway  : ${row.gatewayName}`,
      `  api base : ${row.baseUrl ?? "(the SDK's own endpoint)"}`,
      `  session  : ${row.sessionId}`,
      "",
    );
  }
  // The trailing blank belongs to the block, not to each row.
  lines.pop();
  return lines;
}

/**
 * Spec 42 §12 — the agent library, which is a process now and can be down.
 *
 * Every line here answers a question that only became askable when the SDK
 * moved out of main: which interpreter is running it, whether it came up,
 * whether it has been restarting, and how much work it is holding.
 */
function libraryLines(): string[] {
  const state = agentService().state();
  const age =
    state.startedAt === null
      ? "not started"
      : `up ${Math.round((Date.now() - Date.parse(state.startedAt)) / 1000)}s`;
  return [
    "agent library",
    `  python     ${tilde(state.interpreter)}`,
    `  package    ${tilde(state.root)}`,
    `  process    ${state.pid === null ? "NOT RUNNING" : `pid ${state.pid} · ${age}`} · ${state.restarts} restart(s) this session`,
    `  protocol   ${state.version ?? "?"} · ${state.python === null ? "?" : state.python.split(" ")[0]}`,
    `  runs       ${state.openRuns} open`,
    ...(state.down === null ? [] : [`  DOWN       ${state.down}`]),
  ];
}

/**
 * `appVersion` is passed in rather than read from `app.getVersion()` here: the
 * `electron` module is the one import that would stop `node --test` loading
 * this file, and the pairing in `badStepsOf` is exactly the part worth testing
 * without an app around it.
 */
export function versionLine(appVersion: string): string {
  return [
    `rex ${appVersion}`,
    `electron ${process.versions.electron}`,
    `chrome ${process.versions.chrome}`,
    `node ${process.versions.node}`,
    `agent-sdk ${sdkVersions()}`,
    `${process.platform} ${process.arch}`,
  ].join(" · ");
}

/**
 * The whole report, ready to paste.
 *
 * Sections that would be empty are left out rather than printed as `(0)`: the
 * totals line already says how many denials and errors there were, so an absent
 * section is never ambiguous and every line saved is one the reader keeps.
 */
export async function debugReport(db: Db, threadId: string, appVersion: string): Promise<string> {
  const thread = getThread(db, threadId);
  if (!thread) throw new Error(`No such thread: ${threadId}`);

  const messages = listMessages(db, threadId);
  const totals = totalsOf(messages);
  const bad = badStepsOf(messages);
  const denials = bad.filter((step) => step.denied);
  const failures = bad.filter((step) => !step.denied);
  // Only `error` rows: a refused or failed `tool_result` also carries `isError`,
  // and both are already reported below under their own headings with the
  // command that earned them.
  const errors = messages.filter((message) => message.kind === "error");
  const cwd = agentCwd(db, thread);

  const lines = [
    `REX debug · ${new Date().toISOString()}`,
    "",
    ...readLines(thread.id),
    "",
    "RUN",
    // Spec 34 §7.1 — the last send's mode, not the comment's profile column.
    `  thread     ${thread.id} · ${thread.kind} · ${thread.status} · ${
      lastMode(messages) === null ? `profile ${thread.profile}` : `mode ${lastMode(messages)}`
    }`,
    // Spec 25 §4.3 — from the messages, not from the comment. The model is a
    // property of a send now, so the honest answer is what the LAST send used;
    // a comment whose turns ran on different models has no single one.
    `  model      ${lastChoice(messages, "model") ?? "(the SDK's default)"}`,
    // Spec 31 §5 — recorded and not drawn on the card, so this is the one
    // place it can be read back.
    `  style      ${lastChoice(messages, "style") ?? "(the SDK's default)"}`,
    ...(await sessionLines(cwd, thread)),
    ...combinationLines(db, thread),
    `  cwd        ${tilde(cwd)}`,
    `  database   ${tilde(DB_PATH)}`,
    `  asked      ${thread.createdAt} → ${thread.updatedAt}`,
    "",
    "COMMENT",
    `  ${clip(thread.note, 300) || "(empty)"}`,
  ];

  if (thread.targets.length > 0) {
    lines.push("", `PLACES (${thread.targets.length})`, ...placeLines(db, thread));
  }

  lines.push(
    "",
    "TOTALS",
    // Spec 43 §8.1 — `$0.0000` for a comment nobody priced is the one
    // number in this report that would be read as measured.
    `  ${totals.steps} steps · ${spentText(totals.durationMs)} · ${totals.costUsd > 0 ? `$${totals.costUsd.toFixed(4)}` : "cost not reported"} · ${totals.denied} denied · ${totals.failed} failed`,
    `  ${messages.length} messages · ${kindCounts(messages) || "none"}`,
  );

  // Two headings, never one. They send the reader to different places: DENIED is
  // a question about REX's gate, FAILED is a question about the command.
  if (denials.length > 0) {
    lines.push("", `DENIED — the gate refused these (${denials.length})`);
    for (const [index, denial] of denials.entries()) {
      lines.push(`  ${index + 1} ${denial.toolName} · ${denial.reason}`, `      ${denial.command}`);
    }
  }

  if (failures.length > 0) {
    lines.push("", `FAILED — these ran and did not succeed (${failures.length})`);
    for (const [index, failure] of failures.entries()) {
      lines.push(
        `  ${index + 1} ${failure.toolName} · ${failure.reason}`,
        `      ${failure.command}`,
      );
    }
  }

  if (errors.length > 0) {
    lines.push("", `ERRORS (${errors.length})`);
    for (const error of errors) lines.push(`  ${clip(error.content ?? "", 300)}`);
  }

  lines.push("", "VERSIONS", `  ${versionLine(appVersion)}`);
  return lines.join("\n");
}

// ── The app report (spec 13 §4) ───────────────────────────────
//
// The second report, and the one the first could not be. §6.2's needs a
// `threadId`; the failure it was written for — a document that will not open —
// happens before any thread exists.

/** What only the Electron side knows. Passed in, for the reason `versionLine` is. */
export interface AppFacts {
  appVersion: string;
  pid: number;
  packaged: boolean;
  uptimeMs: number;
  userDataPath: string;
  cdp: CdpStatus;
  logPath: string | null;
  logLines: number;
}

/**
 * Below this a document is on screen and unreadable, which reads to anybody
 * looking at it as "the document did not open".
 *
 * Measured on 2026-08-25: a tiling window manager gave REX an 857px column of
 * a 3440px screen. The explorer kept 272px and the comments panel kept 384px,
 * because both are fixed widths and only the middle flexes — so the document
 * pane got 164px. It had rendered, with the right title and 102 nodes in it.
 * The reviewer reported that documents do not load.
 *
 * 400 is the smallest measure the Markdown stylesheet's body type does not
 * break down at; anything narrower is a strip, not a page.
 */
const READABLE_PANE_PX = 400;

function viewLines(view: ViewState | null): string[] {
  if (!view) return ["  (the renderer did not answer — see RECENT below)"];

  const document = view.document;
  const lines = [
    `  window     ${view.window.width}×${view.window.height}`,
    `  workspace  ${view.workspaceRoot ? tilde(view.workspaceRoot) : "(none open)"}`,
  ];

  if (!document) {
    lines.push("  document   (none open)");
  } else {
    const size = document.documentBytes === null ? "no html" : bytes(document.documentBytes);
    const frame =
      document.frameChildren === null
        ? "frame unreachable"
        : `frame ${document.frameChildren} nodes`;
    const pane =
      document.frameWidth === null
        ? "pane unmeasured"
        : `pane ${document.frameWidth}×${document.frameHeight}`;
    lines.push(
      `  document   ${tilde(document.value)} · ${document.kind}`,
      `             ${document.presentation} · ${size} · surface ${document.surfaceReady ? "ready" : "NOT ready"} · ${frame} · ${pane}`,
      `             id ${document.documentId} · ${document.contentChanged ? "file changed since the anchors" : "unchanged since the anchors"}`,
    );

    // Stated, not left to be inferred from two numbers. Somebody reading this
    // is reading it because they cannot see a document, and every other line
    // here would tell them the document is fine.
    if (document.frameWidth !== null && document.frameWidth < READABLE_PANE_PX) {
      lines.push(
        `  ⚠ the document pane is only ${document.frameWidth}px wide. The document IS loaded —`,
        "    the window is too narrow to show it. Widen the REX window; on a tiling",
        "    window manager, give it a wider tile or float it.",
      );
    }
  }

  lines.push(
    `  centre     ${view.centre} · sidebar ${view.sidebarTab} · zoom ${Math.round(view.zoom * 100)}%${view.traceOpen ? " · trace open" : ""}`,
    `  comments   ${view.threads} · ${view.unanswered} unanswered · ${view.activeThreadId ? `open ${view.activeThreadId}` : "none open"} · ${view.selectionItems} in the panel · ${view.groups} group${view.groups === 1 ? "" : "s"}`,
    `  notice     ${view.notice ? clip(view.notice, 200) : "(none)"}`,
  );
  return lines;
}

function recentLines(recent: readonly LogEntry[]): string[] {
  return recent.map((entry) => {
    const time = entry.at.slice(11, 19);
    return `  ${time}  ${entry.level.padEnd(5)} ${entry.source.padEnd(8)} ${entry.message}`;
  });
}

/**
 * The whole app report, ready to paste into a chat with whoever is fixing REX.
 *
 * ATTACH is first because it is the part that does the work: it turns "REX is
 * broken" into an instruction a fresh Claude Code session can follow without
 * asking anything. Everything below it is evidence.
 */
/**
 * Spec 43 §9 — the gateways this REX has, by name and route.
 *
 * **It says WHETHER each named credential exists, and never its value.** The
 * boolean is the point: a gateway that will not answer is usually a variable
 * the shell that launched REX did not carry, and "AI_GATEWAY_KEY — NOT SET" is
 * the whole diagnosis. Printing the value would put a key in every report the
 * reviewer pastes into an issue.
 */
function gatewayLines(db: Db | null): string[] {
  if (!db) return [];
  const gateways = listGateways(db);
  const lines = ["", `GATEWAYS (${gateways.length})`];
  for (const gateway of gateways) {
    for (const [sdk, route] of Object.entries(gateway.routes)) {
      if (!route) continue;
      const credential =
        route.auth === "environment" && route.credentialEnv
          ? ` · ${route.credentialEnv} ${process.env[route.credentialEnv] ? "set" : "NOT SET"}`
          : route.auth === "none"
            ? " · no authentication"
            : "";
      lines.push(
        `  ${gateway.name} · ${sdk} · ${route.baseUrl ?? "(the SDK's own endpoint)"}${credential}`,
      );
    }
  }
  return lines;
}

export function appReport(
  facts: AppFacts,
  view: ViewState | null,
  recent: readonly LogEntry[],
  /** Spec 43 §9 — omitted where there is no database to read, as in a test. */
  db: Db | null = null,
): string {
  const lines = [
    `REX debug · ${new Date().toISOString()}`,
    "",
    "ATTACH",
    ...cdpLines(facts.cdp),
    `  log        ${facts.logPath ? tilde(facts.logPath) : "(could not be opened)"} · ${facts.logLines} ${facts.logLines === 1 ? "line" : "lines"} this run`,
    "",
    "APP",
    `  pid        ${facts.pid} · ${facts.packaged ? "packaged" : "dev (electron-vite)"} · up ${spentText(facts.uptimeMs)}`,
    `  database   ${tilde(DB_PATH)}`,
    `  userdata   ${tilde(facts.userDataPath)}`,
    "",
    "",
    ...libraryLines(),
    ...gatewayLines(db),
    "",
    "VIEW",
    ...viewLines(view),
  ];

  // An empty section would say "nothing went wrong", which is not the same as
  // "nothing was recorded" — and for a REX that has just misbehaved, the
  // difference is the first thing worth knowing.
  lines.push("", `RECENT (${recent.length})`);
  if (recent.length === 0) {
    lines.push("  nothing was recorded this run — no console error, no failed command");
  } else {
    lines.push(...recentLines(recent));
  }

  lines.push("", "VERSIONS", `  ${versionLine(facts.appVersion)}`);
  return lines.join("\n");
}
