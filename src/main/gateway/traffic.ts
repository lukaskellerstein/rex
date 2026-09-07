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

import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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
  request_body?: unknown;
  response?: unknown;
}

/** One request through the gateway, in the shape the renderer receives. */
export interface TrafficRow {
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
  /** Absent when body capture is switched off (§4.6). */
  requestBody?: unknown;
  response?: unknown;
}

function toRow(line: TrafficLine): TrafficRow {
  const row: TrafficRow = {
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
  };
  // Present only when bodies were captured, so an absent key and a null value
  // stay different things — the sheet says "not recorded" for one of them.
  if ("request_body" in line) row.requestBody = line.request_body;
  if ("response" in line) row.response = line.response;
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
 * Every request this thread made, newest last.
 *
 * Filtered on `x-rex-thread`, which spec 45's `attribution.py` puts on every
 * request an adapter sends. A row with no thread is LiteLLM talking to itself
 * and `rex_trace.py` already declines to write one, so this filter is the
 * second half of a rule rather than the whole of it.
 */
export function threadTraffic(threadId: string): TrafficRow[] {
  const rows: TrafficRow[] = [];
  for (const name of files()) {
    let text: string;
    try {
      text = readFileSync(join(trafficDir(), name), "utf8");
    } catch {
      continue; // a file deleted by retention between the listing and the read
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: TrafficLine;
      try {
        parsed = JSON.parse(line) as TrafficLine;
      } catch {
        // A truncated last line, which happens while the gateway is mid-write.
        // Skipped rather than thrown: one torn line must not hide the rest.
        continue;
      }
      if (parsed.thread === threadId) rows.push(toRow(parsed));
    }
  }
  // Newest last is how a conversation reads, and the file is already in order.
  return rows.slice(-MAX_ROWS);
}

/** What the log holds in total, for the Settings line that offers to clear it. */
export function trafficSize(): TrafficReport {
  let bytes = 0;
  const names = files();
  for (const name of names) {
    try {
      bytes += statSync(join(trafficDir(), name)).size;
    } catch {
      // Gone between the listing and the stat. Not an error worth reporting.
    }
  }
  return { rows: [], bytes, days: names.length };
}

/** Deletes every day of the log. The person asked; nothing else is touched. */
export function clearTraffic(): void {
  for (const name of files()) {
    try {
      rmSync(join(trafficDir(), name), { force: true });
    } catch {
      // A file that will not go is not worth failing the whole clear over.
    }
  }
}
