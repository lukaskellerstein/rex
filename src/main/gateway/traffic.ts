// Spec 46 §4.6 — this thread's requests and responses, read from the gateway's
// own log instead of from Grafana.
//
// Spec 45 gave a comment card a button. That button stays, its glyph stays, its
// row stays and its IPC stays — **only its destination changes**, from a
// Grafana URL to a REX sheet reading this file. That is a smaller change than
// deleting it, and a control that vanishes looks like a bug.
//
// > **This is what spec 45's three headers are for.** They were attribution for
// > a Grafana that is going away; they are now the join key that turns a pile of
// > requests into *this comment's traffic*.
//
// **Only the built-in gateway has one** (§4.6). REX writes its config, so REX
// can install a callback. An existing LiteLLM belongs to somebody else and REX
// will not ask it to load code.
//
// Spec 51 §9.2 — this file is also the READER for all four depths, and it is
// the one the spec says is easiest to miss. `threadTraffic` answered one
// question: give me one thread's rows, bodies and all. The depths ask three
// more:
//
//   - depth 1 wants totals across **every** thread
//   - depths 2 and 3 want a thread's rows grouped by RUN, and cheaply — a
//     request body is now the whole request, so shipping five hundred of them
//     to draw a list of turns is megabytes for a screen that shows counts
//   - depth 4 wants **one** body, whole, with its overflow file resolved
//
// So bodies leave the list and are fetched one at a time.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { trafficDir } from "./paths.ts";

/**
 * One line of the file, exactly as `rex_trace.py` writes it.
 *
 * **snake_case, and deliberately.** §4.6 documents these names and a person
 * greps this file with them; it is a record on disk, not a message on REX's
 * wire, so it does not follow the camelCase rule spec 42 §4.3 sets for the
 * pipe. `toRow` is where the two conventions meet, and having exactly one such
 * place is the point — the first version read `tokensIn` straight off the line
 * and every count in the sheet drew as "—".
 */
interface TrafficLine {
  at: string;
  thread: string | null;
  run: string | null;
  profile: string | null;
  model: string | null;
  ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  error: string | null;
  /** Spec 51 — how many messages the request sent, recorded by `rex_trace.py`. */
  messages?: number | null;
  /** Which of §4.5's three surfaces answered. Recorded by `rex_trace.py`. */
  api?: string | null;
  request_body?: unknown;
  response?: unknown;
}

/**
 * Which API surface a request used.
 *
 * Spec 46 §4.5 — LiteLLM answers `/v1/messages`, `/v1/chat/completions` and
 * `/v1/responses` from one `model_name`, so the model name cannot say which an
 * SDK picked. **The messages differ**: Anthropic puts a tool call in a
 * `tool_use` block and its result in a USER message; OpenAI puts the call in
 * `tool_calls` and its result in a TOOL message. Two shapes, one screen, so the
 * screen has to say which it is drawing.
 */
export type TrafficApi = "anthropic" | "openai-chat" | "openai-responses";

const APIS: readonly TrafficApi[] = ["anthropic", "openai-chat", "openai-responses"];

/** Null for a row written before the surface was recorded, or one REX could not place. */
function apiOf(value: unknown): TrafficApi | null {
  return APIS.find((one) => one === value) ?? null;
}

/** One request through the gateway, in the shape the renderer receives. */
export interface TrafficRow {
  /**
   * Spec 51 — where this row is, so depth 4 can ask for its body later.
   *
   * `<day>#<line>`, which is stable because the log is append-only: a row keeps
   * its number for as long as its day exists, and when the day is pruned the row
   * is gone too and the lookup correctly finds nothing. An index into a filtered
   * list would have shifted under exactly that pruning and shown the wrong body.
   */
  id: string;
  at: string;
  thread: string | null;
  run: string | null;
  profile: string | null;
  /** The ENGINE's own id, not the alias — which is what says what answered. */
  model: string | null;
  ms: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
  /** Null on success. A sentence on failure — recorded, unlike in Grafana. */
  error: string | null;
  /**
   * Spec 51 — how many messages this exchange SENT.
   *
   * The one number a turn is read for: each exchange re-sends the whole
   * conversation, so the count grows down a turn and the growth is the shape of
   * the loop. Counted here rather than in the renderer, because counting it
   * there would mean shipping the messages to count them.
   */
  messages: number | null;
  /**
   * Which of §4.5's three surfaces this request went to.
   *
   * Null on a row written before it was recorded, and on one REX could not
   * place — never guessed, because a guess would put two genuinely different
   * message shapes under one name.
   */
  api: TrafficApi | null;
  /** Whether a body was recorded at all, so an absent one and an off switch stay apart. */
  hasBody: boolean;
  /** Absent when body capture is switched off (§4.6). */
  requestBody?: unknown;
  response?: unknown;
}

/**
 * Spec 51 §3.1 — the two prefixes `rex_trace.py` writes when a value left the line.
 *
 * A body over `MAX_BODY_CHARS` goes to its own file and the row points at it; a
 * base64 image goes to a blob and the string that held it becomes a reference.
 * Both are plain strings on purpose: a reader that does not know about them
 * shows a short string instead of crashing, which is what the OLD rows in the
 * log get to do here.
 */
const OVERFLOW_PREFIX = "rex-overflow:";
export const BLOB_PREFIX = "rex-blob:";

/**
 * How many messages this exchange sent.
 *
 * The row's own `messages` first, because that is the only source that survives
 * an overflow — and every real exchange overflows. Measured against a live
 * Claude Code turn on 2026-09-09: six exchanges, 1.1 to 1.2 MB each, so all six
 * bodies were `{"overflow": …}` and every count read as unknown.
 *
 * The body is the fallback, for rows written before the count was recorded.
 */
function messagesIn(line: TrafficLine): number | null {
  if (typeof line.messages === "number") return line.messages;
  const body = line.request_body;
  if (body === null || typeof body !== "object") return null;
  const messages = (body as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages.length : null;
}

function toRow(line: TrafficLine, id: string, withBodies: boolean): TrafficRow {
  const hasBody = "request_body" in line || "response" in line;
  const row: TrafficRow = {
    id,
    at: line.at,
    thread: line.thread ?? null,
    run: line.run ?? null,
    profile: line.profile ?? null,
    model: line.model ?? null,
    ms: line.ms ?? null,
    tokensIn: line.tokens_in ?? null,
    tokensOut: line.tokens_out ?? null,
    cost: line.cost ?? null,
    error: line.error ?? null,
    messages: messagesIn(line),
    api: apiOf(line.api),
    hasBody,
  };
  // Present only when bodies were captured, so an absent key and a null value
  // stay different things — the sheet says "not recorded" for one of them.
  //
  // Spec 51 — and only when the caller asked. `request_body` is the whole
  // request now, so a list of five hundred rows carries five hundred whole
  // conversations if this is not gated.
  if (withBodies) {
    if ("request_body" in line) row.requestBody = line.request_body;
    if ("response" in line) row.response = line.response;
  }
  return row;
}

export interface TrafficReport {
  rows: TrafficRow[];
  /** Total bytes the log holds, for the number Settings shows (§8 rule 5). */
  bytes: number;
  /** How many days of files there are. */
  days: number;
}

/** How many rows one comment's sheet will draw. A long thread is still finite. */
const MAX_ROWS = 500;

function files(): string[] {
  try {
    return readdirSync(trafficDir())
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
  } catch {
    return []; // no directory yet, which is the state before the first request
  }
}

/**
 * Every row in the log, with its day and line number, newest last.
 *
 * One walk, used by all four depths. A torn last line is skipped rather than
 * thrown — the gateway appends while REX reads, so a half-written line is a
 * normal state and one of them must not hide the rest of the file.
 */
function* lines(): Generator<{ line: TrafficLine; id: string }> {
  for (const name of files()) {
    let text: string;
    try {
      text = readFileSync(join(trafficDir(), name), "utf8");
    } catch {
      continue; // a file deleted by retention between the listing and the read
    }
    const day = name.slice(0, -".jsonl".length);
    let number = 0;
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      const id = `${day}#${number}`;
      number += 1;
      try {
        yield { line: JSON.parse(raw) as TrafficLine, id };
      } catch {
        // A truncated last line, which happens while the gateway is mid-write.
      }
    }
  }
}

/**
 * Every request this thread made, newest last.
 *
 * Filtered on `x-rex-thread`, which spec 45's `attribution.py` puts on every
 * request an adapter sends. A row with no thread is LiteLLM talking to itself
 * and `rex_trace.py` already declines to write one, so this filter is the
 * second half of a rule rather than the whole of it.
 *
 * Spec 51 — `withBodies` is what the depths turned into a choice. The original
 * traffic sheet shows bodies inline and still asks for them; depths 2 and 3
 * draw counts and do not.
 */
export function threadTraffic(threadId: string, withBodies = true): TrafficRow[] {
  const rows: TrafficRow[] = [];
  for (const { line, id } of lines()) {
    if (line.thread === threadId) rows.push(toRow(line, id, withBodies));
  }
  // Newest last is how a conversation reads, and the file is already in order.
  return rows.slice(-MAX_ROWS);
}

/**
 * Spec 51 §5.1 — what the log holds for each thread, for depth 1.
 *
 * Totals only. Depth 1's other columns — the comment's name, its document, the
 * agent — are `rex.db`'s, and `queries.ts` supplies them; this side knows
 * nothing about threads beyond the id on the header. **Neither side can draw
 * the screen alone**, which is the structural fact this whole feature turns on.
 *
 * Unbounded on purpose, unlike `threadTraffic`: these are counters, so a year of
 * log costs a number per thread rather than a row per request.
 */
export interface TrafficTotals {
  /** One request over the wire. A turn makes several. */
  exchanges: number;
  /** How many distinct `x-rex-run` values — turns, as the gateway saw them. */
  runs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  failed: number;
  /** The newest row's timestamp, which is when this chat last did anything. */
  lastAt: string | null;
}

function emptyTotals(): TrafficTotals {
  return { exchanges: 0, runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, failed: 0, lastAt: null };
}

export function trafficByThread(): Map<string, TrafficTotals> {
  const totals = new Map<string, TrafficTotals>();
  const runs = new Map<string, Set<string>>();

  for (const { line } of lines()) {
    const thread = line.thread;
    if (!thread) continue;
    const entry = totals.get(thread) ?? emptyTotals();
    entry.exchanges += 1;
    entry.tokensIn += line.tokens_in ?? 0;
    entry.tokensOut += line.tokens_out ?? 0;
    entry.costUsd += line.cost ?? 0;
    if (line.error) entry.failed += 1;
    // The file is in order, so the last one seen is the newest.
    if (line.at) entry.lastAt = line.at;
    totals.set(thread, entry);

    if (line.run) {
      const seen = runs.get(thread) ?? new Set<string>();
      seen.add(line.run);
      runs.set(thread, seen);
    }
  }

  for (const [thread, entry] of totals) entry.runs = runs.get(thread)?.size ?? 0;
  return totals;
}

/**
 * Spec 51 §5.3 — one turn's exchanges, in the order they were made.
 *
 * The join key is `run`, which is the `x-rex-run` header `attribution.py` sends
 * and `message.run_id` stores. **If the two carry different strings this returns
 * an empty list**, which is why `bridge.ts` exports the minter rather than every
 * caller inventing an id of its own.
 *
 * Bodies are left out. Depth 3 draws a rail of exchanges and a list of message
 * headings; depth 4 asks for the one body it is about to show.
 */
export function runTraffic(threadId: string, runId: string): TrafficRow[] {
  const rows: TrafficRow[] = [];
  for (const { line, id } of lines()) {
    if (line.thread === threadId && line.run === runId) rows.push(toRow(line, id, false));
  }
  return rows;
}

/** Spec 51 §5.4 — one exchange's bodies, whole, with its overflow file read back. */
export interface TrafficBodies {
  request: unknown;
  response: unknown;
  /** Set when a body could not be recovered, in words the screen can print. */
  problem: string | null;
}

/**
 * Read back whatever `_shrink` decided to do with a body.
 *
 * Three cases, and only the third is a loss: the body is on the line; the body
 * is in an overflow file this reads; or `rex_trace.py` could not write one at
 * all and left `{"omitted": …}`, which is the only state where a body is
 * genuinely gone. **A body may be absent; it may never be wrong** (§10 rule 4),
 * so a file that cannot be read says so instead of returning half of one.
 */
function resolveBody(value: unknown): { value: unknown; problem: string | null } {
  if (value === null || typeof value !== "object") return { value, problem: null };

  const omitted = (value as { omitted?: unknown }).omitted;
  if (typeof omitted === "string") {
    return { value: undefined, problem: `The gateway could not store this body: ${omitted}` };
  }

  const overflow = (value as { overflow?: unknown }).overflow;
  if (typeof overflow !== "string" || !overflow.startsWith(OVERFLOW_PREFIX)) {
    return { value, problem: null };
  }
  const relative = overflow.slice(OVERFLOW_PREFIX.length);
  const path = join(trafficDir(), relative);
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) as unknown, problem: null };
  } catch {
    return {
      value: undefined,
      problem: `This body was stored in ${relative}, and that file could not be read.`,
    };
  }
}

export function exchangeBodies(rowId: string): TrafficBodies | null {
  for (const { line, id } of lines()) {
    if (id !== rowId) continue;
    if (!("request_body" in line) && !("response" in line)) {
      return { request: undefined, response: undefined, problem: null };
    }
    const request = resolveBody(line.request_body);
    const response = resolveBody(line.response);
    return {
      request: request.value,
      response: response.value,
      problem: request.problem ?? response.problem,
    };
  }
  return null;
}

/**
 * Spec 51 §3.1 rule 4 — whether the blob a reference names is still on disk.
 *
 * Retention deletes a day's blobs with that day's log, so a reference can
 * outlive its file only inside one row that is itself about to go. Depth 4 draws
 * a payload as what it is either way; this only decides whether it also says
 * "and it is still there".
 */
export function blobExists(reference: string): boolean {
  if (!reference.startsWith(BLOB_PREFIX)) return false;
  return existsSync(join(trafficDir(), reference.slice(BLOB_PREFIX.length)));
}

/**
 * Every file under one of the side directories, however deep.
 *
 * `readdirSync(..., { recursive: true })` lists directories as well as files, so
 * the caller stats each entry and lets a directory's failure be ignored.
 */
function sideFiles(side: string): string[] {
  try {
    return readdirSync(join(trafficDir(), side), { recursive: true, encoding: "utf8" }).map(
      (name) => join(trafficDir(), side, name),
    );
  } catch {
    return [];
  }
}

/**
 * What the log holds in total, for the Settings line that offers to clear it.
 *
 * Spec 51 §3 — the blobs and the overflowed bodies count. They are where the
 * bulk of a log with images in it now lives, so a number that counted only the
 * `.jsonl` files would tell somebody their log was 2 MB while the directory
 * held 400.
 */
export function trafficSize(): TrafficReport {
  let bytes = 0;
  const names = files();
  const paths = [
    ...names.map((name) => join(trafficDir(), name)),
    ...sideFiles("blobs"),
    ...sideFiles("overflow"),
  ];
  for (const path of paths) {
    try {
      const stat = statSync(path);
      if (stat.isFile()) bytes += stat.size;
    } catch {
      // Gone between the listing and the stat, or a directory. Neither is an
      // error worth reporting.
    }
  }
  return { rows: [], bytes, days: names.length };
}

/**
 * Deletes every day of the log. The person asked; nothing else is touched.
 *
 * Spec 51 §3 — **and everything the rows pointed at**, for the reason retention
 * has to: a body in `overflow/` and an image in `blobs/` are files of their own,
 * so clearing only the `.jsonl` files leaves the bulk of the log behind while
 * Settings reports it as gone.
 */
export function clearTraffic(): void {
  for (const name of files()) {
    try {
      rmSync(join(trafficDir(), name), { force: true });
    } catch {
      // A file that will not go is not worth failing the whole clear over.
    }
  }
  for (const side of ["blobs", "overflow"]) {
    try {
      rmSync(join(trafficDir(), side), { force: true, recursive: true });
    } catch {
      // Same rule.
    }
  }
}
