// Spec 55 §3 — the report the Traffic head copies, for a chat and for a turn.
//
// What is worth pinning is not the prose. It is the three things a reader acts
// on: the two commands in `READ`, the row ids that say which line of which day
// file an exchange is on, and the fact that a turn whose run id is null — the
// rows from before spec 51 — still reports rather than being refused.
//
// And one thing that must never appear. The traffic log's own line carries
// whatever `rex_trace.py` wrote; this report names the fields it names and
// copies nothing else, so a key sitting in a line cannot ride out on a
// clipboard. §3.3.
//
// Run: npm run test:traffic-report

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import type { Anchor } from "../src/shared/types.ts";

const work = mkdtempSync(join(tmpdir(), "rex-traffic-report-"));
const trafficDir = join(work, "traffic");

// Both are read through modules that resolve them lazily, but the database's
// is a module constant — so it is set before the first import either way.
process.env.REX_GATEWAY_DIR = work;
process.env.REX_DB_PATH = join(work, "rex.db");
after(() => rmSync(work, { recursive: true, force: true }));

const { appendMessage, createThread, upsertDocument } = await import("../src/main/db/queries.ts");
const { chatTrafficReport, turnTrafficReport } = await import("../src/main/trafficReport.ts");
const { turnFactsOf } = await import("../src/shared/turns.ts");
const { listMessages } = await import("../src/main/db/queries.ts");

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

/** One place, in the shape §4's `Anchor` actually has. */
const ANCHOR: Anchor = {
  quote: { exact: "the WMS", prefix: "", suffix: "" },
  position: null,
  element: null,
  region: null,
  source: null,
};

const DAY = "2026-09-11";
const MODEL = "lmstudio-google-gemma-4-26b-a4b-qat";
const URL = "http://127.0.0.1:24334";

/** What a run stamps on every row it writes — spec 43 §5.3, spec 51 §4. */
const RUN = {
  runId: "mtx9xwi5-1",
  sdk: "claude-agent",
  gatewayName: "Built-in",
  baseUrl: URL,
  model: MODEL,
  style: "default",
} as const;

/**
 * A chat with one turn, in a real database, with the gateway's own log beside
 * it. Both halves of spec 51 §4's join, because neither can draw this alone.
 */
function seed(options: { gateway: boolean; denied: boolean }): {
  db: Database.Database;
  threadId: string;
} {
  const db = new Database(join(work, `${Math.random().toString(36).slice(2)}.db`));
  db.exec(SCHEMA);

  const { record: document } = upsertDocument(
    db,
    { kind: "file", value: "/w/sample-document.md" },
    "Sample",
    null,
  );
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: document.id, anchor: ANCHOR }],
    note: "Is this true?",
    profile: "read",
  });

  // A run with no gateway is a run on `Original`: no base url, and so no log.
  const stamp = options.gateway ? RUN : { runId: RUN.runId, sdk: RUN.sdk };
  appendMessage(db, thread.id, {
    role: "user",
    kind: "text",
    content: "Is this true?",
    mode: "ask",
    ...stamp,
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });

  if (options.denied) {
    appendMessage(db, thread.id, {
      role: "assistant",
      kind: "tool_call",
      content: null,
      toolName: "Write",
      toolInput: { file_path: "/w/sample-document.md", content: "new" },
      ...stamp,
      isError: false,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
    });
    appendMessage(db, thread.id, {
      role: "user",
      kind: "tool_result",
      content: "The read profile cannot write. Switch to ACT.",
      toolName: "Write",
      toolInput: null,
      ...stamp,
      denied: true,
      isError: true,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
    });
  }

  appendMessage(db, thread.id, {
    role: "assistant",
    kind: "text",
    content: "No. The adapter was retired in June.",
    ...stamp,
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });
  appendMessage(db, thread.id, {
    role: "assistant",
    kind: "completed",
    content: null,
    ...stamp,
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: 52_700,
    inputTokens: 59_305,
    outputTokens: 1_321,
  });

  if (options.gateway) {
    mkdirSync(trafficDir, { recursive: true });
    const lines = [
      {
        at: `${DAY}T20:13:02Z`,
        thread: thread.id,
        run: RUN.runId,
        profile: "read",
        model: MODEL,
        ms: 1_204,
        tokens_in: 59_305,
        tokens_out: 21,
        cost: null,
        error: null,
        messages: 2,
        api: "anthropic",
        // Never written by `rex_trace.py`, which strips it by name. Here to
        // prove the report copies the fields it names and nothing else.
        api_key: "sk-must-not-travel",
      },
      {
        at: `${DAY}T20:13:54Z`,
        thread: thread.id,
        run: RUN.runId,
        profile: "read",
        model: MODEL,
        ms: null,
        tokens_in: null,
        tokens_out: null,
        cost: null,
        error: "502: the model did not answer",
        messages: 4,
        api: "anthropic",
      },
    ];
    writeFileSync(
      join(trafficDir, `${DAY}.jsonl`),
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );
  }

  return { db, threadId: thread.id };
}

test("the chat report leads with the two commands that read it", () => {
  const { db, threadId } = seed({ gateway: true, denied: false });
  try {
    const report = chatTrafficReport(db, threadId, "0.1.0");

    // READ first, for spec 13 §4.2's reason: the block that turns a paste into
    // an instruction goes above the evidence it is about.
    assert.ok(report.indexOf("\nREAD\n") < report.indexOf("\nCHAT\n"));
    assert.match(report, new RegExp(`FROM message WHERE thread_id = '${threadId}' ORDER BY seq`));
    assert.match(report, /sqlite3 .*rex\.db "PRAGMA query_only = 1"/);

    // The day file, named. A reader pointed at the directory greps thirty days
    // of somebody else's chats.
    assert.match(report, new RegExp(`jq -c 'select\\(\\.thread=="${threadId}"\\)'`));
    assert.match(report, new RegExp(`${DAY}\\.jsonl`));
  } finally {
    db.close();
  }
});

test("the chat report lists every turn with what answered it", () => {
  const { db, threadId } = seed({ gateway: true, denied: false });
  try {
    const report = chatTrafficReport(db, threadId, "0.1.0");

    assert.match(report, /TURNS \(1\)/);
    assert.match(report, new RegExp(`1 ${RUN.runId} · ASK`));
    assert.match(report, /claude-agent · Built-in · lmstudio-google-gemma/);
    assert.match(report, /2 exchanges · 3 rows/);
    assert.match(report, /59305 in · 1321 out/);
    // Spec 43 §8.1 — a cost nobody reported is said as that, never as $0.0000.
    assert.match(report, /cost not reported/);
    assert.match(report, /\nVERSIONS\n/);
  } finally {
    db.close();
  }
});

test("the numbers in the report are the screen's own numbers", () => {
  // Spec 55 §2 — both sides read `turnFactsOf`. A report that disagrees with
  // the screen it was copied from cannot be checked by anybody.
  const { db, threadId } = seed({ gateway: true, denied: true });
  try {
    const facts = turnFactsOf(listMessages(db, threadId))[0];
    const report = turnTrafficReport(db, threadId, RUN.runId, "0.1.0");

    assert.equal(facts?.messages, 5);
    assert.equal(facts?.toolCalls, 1);
    assert.equal(facts?.failed, 1);
    // The same three numbers, in the line the reviewer pastes. Counted once and
    // printed twice is the point; counted twice is the bug.
    assert.match(report, /5 rows · 1 tool call · 1 failed/);
  } finally {
    db.close();
  }
});

test("the turn report names its exchanges by the line they are on", () => {
  const { db, threadId } = seed({ gateway: true, denied: false });
  try {
    const report = turnTrafficReport(db, threadId, RUN.runId, "0.1.0");

    assert.match(report, /· TURN\n/);
    // The label column is padded, so these are compared as text: a regular
    // expression over runs of spaces is a thing nobody can read afterwards.
    assert.ok(report.includes(`  turn       ${RUN.runId} · ASK`));
    assert.ok(report.includes("  api        anthropic"));
    assert.ok(report.includes(`  gateway    Built-in · ${URL}`));

    // `<day>#<line>`, which is what depth 4 opens and what `jq` can be pointed
    // at. The second exchange never came back, and a failure is a row like any
    // other — that is what the traffic log has over Grafana.
    assert.match(report, /EXCHANGES \(2\)/);
    assert.ok(report.includes(`1 ${DAY}#0 `));
    assert.match(report, new RegExp(`2 ${DAY}#1 .*NEVER ANSWERED · 502: the model did not answer`));

    // One line per row, with the first line of what it said and how big it was.
    assert.match(report, /STEPS \(3\)/);
    assert.match(report, /user text · Is this true\?/);
  } finally {
    db.close();
  }
});

test("a refusal is reported under its own heading, with the call that earned it", () => {
  const { db, threadId } = seed({ gateway: true, denied: true });
  try {
    const report = turnTrafficReport(db, threadId, RUN.runId, "0.1.0");

    // Two headings and never one: DENIED is a question about REX's gate and
    // FAILED is a question about the command.
    assert.match(report, /DENIED — the gate refused these \(1\)/);
    assert.match(report, /Write · The read profile cannot write\./);
    assert.match(report, /\/w\/sample-document\.md/);
    assert.doesNotMatch(report, /FAILED — these ran/);
  } finally {
    db.close();
  }
});

test("nothing from the log's line reaches the report except the fields it names", () => {
  // §3.3 — no credential value, no auth header, no environment. The report
  // reads the row's own fields and copies none of the rest.
  const { db, threadId } = seed({ gateway: true, denied: false });
  try {
    assert.doesNotMatch(turnTrafficReport(db, threadId, RUN.runId, "0.1.0"), /sk-must-not-travel/);
    assert.doesNotMatch(chatTrafficReport(db, threadId, "0.1.0"), /sk-must-not-travel/);
  } finally {
    db.close();
  }
});

test("a chat with no exchanges says why, rather than drawing a gap", () => {
  // A chat answered through `Original` went straight to the vendor: REX's own
  // gateway saw nothing, and "nothing" is the truth rather than a loss.
  const { db, threadId } = seed({ gateway: false, denied: false });
  try {
    const report = chatTrafficReport(db, threadId, "0.1.0");
    assert.match(report, /EXCHANGES \(0\)/);
    assert.match(report, /ran on Original/);
  } finally {
    db.close();
  }
});

test("a turn from before run ids were recorded still reports", () => {
  // Those rows are a real turn a reviewer can open, so the report opens too and
  // says what it is. Refusing it would leave the oldest chats — the ones most
  // likely to need help — with a button that does nothing.
  const db = new Database(join(work, "old.db"));
  db.exec(SCHEMA);
  const { record: document } = upsertDocument(db, { kind: "file", value: "/w/old.md" }, null, null);
  const thread = createThread(db, {
    kind: "anchored",
    targets: [{ documentId: document.id, anchor: ANCHOR }],
    note: "an older chat",
    profile: "read",
  });
  appendMessage(db, thread.id, {
    role: "user",
    kind: "text",
    content: "older",
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });

  try {
    const report = turnTrafficReport(db, thread.id, null, "0.1.0");
    assert.match(report, /never recorded/);
    assert.match(report, /STEPS \(1\)/);
  } finally {
    db.close();
  }
});
