// Spec 46 §4.6 — reading the gateway's traffic log.
//
// The claim worth pinning is the one that failed silently: **the file is
// snake_case and the wire is camelCase.** The first version of `threadTraffic`
// cast a parsed line straight to the wire shape, so every token count in the
// sheet drew as "—" while the file held the numbers. Nothing threw, nothing
// logged, and the only symptom was a dash.
//
// Run: npm run test:traffic

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const work = mkdtempSync(join(tmpdir(), "rex-traffic-"));
const dir = join(work, "traffic");

// `paths.ts` reads this, so it must be set before the module is imported.
process.env.REX_GATEWAY_DIR = work;
after(() => rmSync(work, { recursive: true, force: true }));

const { clearTraffic, threadTraffic, trafficSize } = await import("../src/main/gateway/traffic.ts");

/** Exactly what `rex_trace.py` writes — snake_case, one JSON object per line. */
const LINES = [
  {
    at: "2026-09-06T19:08:19Z",
    thread: "t-1",
    run: "r-1",
    profile: "read",
    model: "google/gemma-4-e4b",
    ms: 698,
    tokens_in: 1062,
    tokens_out: 13,
    cost: 0.0,
    error: null,
    request_body: [{ role: "user", content: "what does this mean?" }],
    response: { choices: [{ message: { content: "it means the deadline moved." } }] },
  },
  {
    at: "2026-09-06T19:08:32Z",
    thread: "t-1",
    run: "r-1",
    profile: "read",
    model: "google/gemma-4-e4b",
    ms: 11807,
    tokens_in: 42687,
    tokens_out: 306,
    cost: 0.0,
    error: null,
  },
  {
    at: "2026-09-06T19:03:11Z",
    thread: "t-2",
    run: "r-2",
    profile: "write",
    model: "claude-opus-5",
    ms: 1,
    tokens_in: null,
    tokens_out: null,
    cost: 0.0,
    error: "400: Invalid model name",
  },
];

before(() => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "2026-09-06.jsonl"),
    `${LINES.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
});

// ── the mapping that failed silently ────────────────────────────

test("the token counts survive the snake_case to camelCase crossing", () => {
  const rows = threadTraffic("t-1");
  assert.equal(rows[0]?.tokensIn, 1062);
  assert.equal(rows[0]?.tokensOut, 13);
  assert.equal(rows[1]?.tokensIn, 42687);
});

test("the bodies survive it too", () => {
  const row = threadTraffic("t-1")[0];
  assert.ok(row?.requestBody, "the request body reached the sheet");
  assert.ok(row?.response, "the response reached the sheet");
});

test("a row written with bodies off has no body KEY, not a null one", () => {
  // The sheet says "not recorded" for an absent key. A null would read as an
  // empty request, which is a different and wrong claim.
  const row = threadTraffic("t-1")[1];
  assert.equal("requestBody" in (row as object), false);
  assert.equal("response" in (row as object), false);
});

// ── §4.6 — one comment's traffic, and only that comment's ───────

test("only this thread's requests come back", () => {
  assert.equal(threadTraffic("t-1").length, 2);
  assert.equal(threadTraffic("t-2").length, 1);
  assert.equal(threadTraffic("t-nothing").length, 0);
});

test("a failure is a row, with the reason on it", () => {
  // More than the Grafana stack gave: a request that never reached a model
  // still leaves a row saying why.
  const row = threadTraffic("t-2")[0];
  assert.equal(row?.error, "400: Invalid model name");
  assert.equal(row?.model, "claude-opus-5");
});

test("the engine's own model id is what a row carries, not the alias", () => {
  assert.equal(threadTraffic("t-1")[0]?.model, "google/gemma-4-e4b");
});

// ── robustness ──────────────────────────────────────────────────

test("a torn last line does not hide the rest of the file", () => {
  // It happens for real: the gateway appends while REX reads.
  writeFileSync(
    join(dir, "2026-09-07.jsonl"),
    `${JSON.stringify({ ...LINES[0], at: "2026-09-07T00:00:00Z" })}\n{"thread":"t-1","ms":`,
  );
  assert.equal(threadTraffic("t-1").length, 3, "two whole lines plus the new one");
  rmSync(join(dir, "2026-09-07.jsonl"));
});

test("no directory yet is not an error", () => {
  // The state before the very first request. It must read as empty, not throw.
  const empty = mkdtempSync(join(tmpdir(), "rex-empty-"));
  const was = process.env.REX_GATEWAY_DIR;
  process.env.REX_GATEWAY_DIR = empty;
  assert.deepEqual(threadTraffic("t-1"), []);
  assert.equal(trafficSize().days, 0);
  process.env.REX_GATEWAY_DIR = was;
  rmSync(empty, { recursive: true, force: true });
});

// ── §8 rule 5 — the number the Settings line shows ──────────────

test("the size is the whole log, counted in days and bytes", () => {
  const size = trafficSize();
  assert.equal(size.days, 1);
  assert.ok(size.bytes > 0);
});

test("clearing removes every day", () => {
  clearTraffic();
  assert.equal(trafficSize().days, 0);
  assert.equal(threadTraffic("t-1").length, 0);
});
