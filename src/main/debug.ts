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

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { totalsOf } from "../shared/totals.ts";
import type { Anchor, Message, Thread, ViewState } from "../shared/types.ts";
import { sessionIdFor } from "./agent/profiles.ts";
import { sessionFilePath, sessionRecord } from "./agent/transcript.ts";
import { type CdpStatus, cdpLines } from "./cdp.ts";
import type { Db } from "./db/database.ts";
import { DB_PATH } from "./db/location.ts";
import { getDocument, getThread, listMessages } from "./db/queries.ts";
import type { LogEntry } from "./log.ts";
import { agentCwd } from "./threads.ts";

const HOME = homedir();

/** `~/…`, per rules/11 — a home directory is noise in something a human reads. */
function tilde(path: string): string {
  return path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function bytes(size: number): string {
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
 */
function transcriptSize(path: string): string {
  try {
    return bytes(statSync(path).size);
  } catch {
    return "missing";
  }
}

/**
 * The installed Agent SDK version.
 *
 * Read from the package's own manifest rather than from REX's `dependencies`,
 * which carries a RANGE — and the range is never what ran. The package does not
 * export `./package.json`, so the entry point is resolved and its directory
 * read instead.
 */
function sdkVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@anthropic-ai/claude-agent-sdk");
    const manifest = require(join(dirname(entry), "package.json"));
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
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

interface DeniedCall {
  toolName: string;
  reason: string;
  command: string;
}

/** The full argument of a denied call — the clipped one is already in the reason. */
function commandOf(call: Message): string {
  const input = (call.toolInput ?? {}) as Record<string, unknown>;
  const command = input.command ?? input.file_path ?? input.pattern ?? input.path;
  return clip(typeof command === "string" ? command : JSON.stringify(input), 400);
}

/**
 * The gate's refusals, with the command that earned each one.
 *
 * §4's `Message` has no `tool_use_id`, so a result does not name the call it
 * answers and the pairing has to be rebuilt: the earliest call of the same tool
 * that nothing has answered yet. Order rather than identity, which is the best
 * the stored rows allow — and the reason itself is the gate's own words either
 * way, so a mispaired command is the worst this can get wrong.
 */
export function denialsOf(messages: readonly Message[]): DeniedCall[] {
  const pending: Message[] = [];
  const denials: DeniedCall[] = [];

  for (const message of messages) {
    if (message.kind === "tool_call") {
      pending.push(message);
      continue;
    }
    if (message.kind !== "tool_result") continue;

    const at = pending.findIndex((call) => call.toolName === message.toolName);
    const [call] = pending.splice(at === -1 ? 0 : at, 1);
    if (!message.isError) continue;

    denials.push({
      toolName: message.toolName ?? call?.toolName ?? "unknown",
      reason: clip(message.content ?? "", 300),
      command: call ? commandOf(call) : "(the call it answered is not in the transcript)",
    });
  }
  return denials;
}

/** `text 5 · tool_call 4 · …` — what the transcript is made of, before reading it. */
function kindCounts(messages: readonly Message[]): string {
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.kind, (counts.get(message.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${kind} ${count}`).join(" · ");
}

function seconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`;
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

  const record = await sessionRecord(cwd, sessionId);
  const path = sessionFilePath(cwd, sessionId);
  return [
    `  session    ${sessionId}`,
    record
      ? `  sdk store  has it · ${record.fileSize ? bytes(record.fileSize) : "no local file"} · last written ${new Date(record.lastModified).toISOString()}`
      : "  sdk store  NO record of this session — a reply replays the thread into a fresh one (§8.5)",
    `  sdk log    ${tilde(path)} · ${transcriptSize(path)}`,
  ];
}

/**
 * `appVersion` is passed in rather than read from `app.getVersion()` here: the
 * `electron` module is the one import that would stop `node --test` loading
 * this file, and the pairing in `denialsOf` is exactly the part worth testing
 * without an app around it.
 */
function versionLine(appVersion: string): string {
  return [
    `rex ${appVersion}`,
    `electron ${process.versions.electron}`,
    `chrome ${process.versions.chrome}`,
    `node ${process.versions.node}`,
    `agent-sdk ${sdkVersion()}`,
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
  const denials = denialsOf(messages);
  // Only `error` rows: a denied `tool_result` also carries `isError`, and it is
  // already reported below under its own heading with the command it refused.
  const errors = messages.filter((message) => message.kind === "error");
  const cwd = agentCwd(db, thread);

  const lines = [
    `REX debug · ${new Date().toISOString()}`,
    "",
    "RUN",
    `  thread     ${thread.id} · ${thread.kind} · ${thread.status} · profile ${thread.profile}`,
    `  model      ${thread.model ?? "(the SDK's default)"}`,
    ...(await sessionLines(cwd, thread)),
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
    `  ${totals.steps} steps · ${seconds(totals.durationMs)} · $${totals.costUsd.toFixed(4)} · ${totals.denied} denied`,
    `  ${messages.length} messages · ${kindCounts(messages) || "none"}`,
  );

  if (denials.length > 0) {
    lines.push("", `DENIED (${denials.length})`);
    for (const [index, denial] of denials.entries()) {
      lines.push(`  ${index + 1} ${denial.toolName} · ${denial.reason}`, `      ${denial.command}`);
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
    `  comments   ${view.threads} · ${view.unanswered} unanswered · ${view.activeThreadId ? `open ${view.activeThreadId}` : "none open"} · ${view.selectionItems} in the panel`,
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
export function appReport(
  facts: AppFacts,
  view: ViewState | null,
  recent: readonly LogEntry[],
): string {
  const lines = [
    `REX debug · ${new Date().toISOString()}`,
    "",
    "ATTACH",
    ...cdpLines(facts.cdp),
    `  log        ${facts.logPath ? tilde(facts.logPath) : "(could not be opened)"} · ${facts.logLines} ${facts.logLines === 1 ? "line" : "lines"} this run`,
    "",
    "APP",
    `  pid        ${facts.pid} · ${facts.packaged ? "packaged" : "dev (electron-vite)"} · up ${seconds(facts.uptimeMs)}`,
    `  database   ${tilde(DB_PATH)}`,
    `  userdata   ${tilde(facts.userDataPath)}`,
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
