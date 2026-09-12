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

const { clearTraffic, exchangeBodies, runTraffic, threadTraffic, trafficByThread, trafficSize } =
  await import("../src/main/gateway/traffic.ts");

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

// ── Spec 51 §9.2 — the reader the four depths need ──────────────

test("depth 1 totals every thread, and counts turns rather than requests", () => {
  // The two are different numbers on purpose: a turn makes several exchanges,
  // and each one re-sends the whole conversation. `t-1` is one turn in two.
  const totals = trafficByThread();
  assert.equal(totals.get("t-1")?.exchanges, 2);
  assert.equal(totals.get("t-1")?.runs, 1);
  assert.equal(totals.get("t-1")?.tokensIn, 1062 + 42687);
  assert.equal(totals.get("t-1")?.failed, 0);
  assert.equal(totals.get("t-2")?.failed, 1);
  assert.equal(totals.get("t-nothing"), undefined);
});

test("depth 2 and 3 read a turn by its run id, which is the join key", () => {
  // §9.3's warning: the id here is `x-rex-run`, and `message.run_id` is the same
  // string. A different one on either side joins NOTHING and draws an empty
  // grid rather than an error, which is why this is pinned.
  assert.equal(runTraffic("t-1", "r-1").length, 2);
  assert.equal(runTraffic("t-1", "r-2").length, 0, "another turn's rows are not this turn's");
  assert.equal(runTraffic("t-2", "r-2").length, 1);
});

test("a turn's rows carry the message count and leave the bodies behind", () => {
  // A request body is the whole request since §3, so a list of five hundred
  // rows would be five hundred whole conversations. The COUNT is what the rail
  // draws, and it is computed here rather than by shipping the messages.
  const day = join(dir, "2026-09-08.jsonl");
  writeFileSync(
    day,
    `${JSON.stringify({
      ...LINES[0],
      thread: "t-5",
      run: "r-5",
      request_body: { model: "m", messages: [{ role: "system" }, { role: "user" }] },
    })}\n`,
  );
  const row = runTraffic("t-5", "r-5")[0];
  assert.equal(row?.messages, 2);
  assert.equal(row?.hasBody, true, "the row still says a body exists");
  assert.equal("requestBody" in (row as object), false, "and does not carry it");
  rmSync(day);
});

test("depth 4 fetches one body by the row's own id", () => {
  const row = runTraffic("t-1", "r-1")[0];
  const bodies = exchangeBodies(row?.id ?? "");
  assert.equal(bodies?.problem, null);
  assert.deepEqual(bodies?.request, [{ role: "user", content: "what does this mean?" }]);
});

test("a row id that no longer exists is null, not a wrong body", () => {
  // Retention deletes a day and every row in it. A missing row must read as
  // missing: **a body may be absent, it may never be wrong** (§10 rule 4).
  assert.equal(exchangeBodies("2020-01-01#7"), null);
});

test("an overflowed body is read back from its own file", () => {
  // §3.1 rule 3 — it used to be DELETED and replaced by `{"omitted": …}`, which
  // is the one loss depth 4 cannot draw around.
  const day = join(dir, "2026-09-08.jsonl");
  mkdirSync(join(dir, "overflow", "2026-09-08"), { recursive: true });
  writeFileSync(
    join(dir, "overflow", "2026-09-08", "big.json"),
    JSON.stringify({ model: "m", messages: [{ role: "user", content: "the whole thing" }] }),
  );
  writeFileSync(
    day,
    `${JSON.stringify({
      ...LINES[0],
      thread: "t-3",
      run: "r-3",
      request_body: { overflow: "rex-overflow:overflow/2026-09-08/big.json", chars: 250000 },
      response: { ok: true },
    })}\n`,
  );

  const row = runTraffic("t-3", "r-3")[0];
  const bodies = exchangeBodies(row?.id ?? "");
  assert.ok(bodies, "the row is there to read");
  assert.equal(bodies.problem, null);
  const request = bodies.request as { messages: Array<{ content: string }> };
  assert.equal(request.messages[0]?.content, "the whole thing");
  rmSync(day);
  rmSync(join(dir, "overflow"), { recursive: true, force: true });
});

test("an overflow file that has gone says so, and shows no body", () => {
  const day = join(dir, "2026-09-08.jsonl");
  writeFileSync(
    day,
    `${JSON.stringify({
      ...LINES[0],
      thread: "t-4",
      run: "r-4",
      request_body: { overflow: "rex-overflow:overflow/2026-09-08/gone.json", chars: 250000 },
    })}\n`,
  );
  const row = runTraffic("t-4", "r-4")[0];
  const bodies = exchangeBodies(row?.id ?? "");
  assert.equal(bodies?.request, undefined);
  assert.match(bodies?.problem ?? "", /could not be read/);
  rmSync(day);
});

test("a row written before spec 51 still reads, and its message count is null", () => {
  // The log holds real rows in the OLD shape: `request_body` is a bare messages
  // array. The new reader must not crash on them — it draws them as a row.
  const row = threadTraffic("t-1")[0];
  assert.equal(row?.messages, null, "an array is not an object with `messages`");
  assert.ok(row?.requestBody, "and the body is still there to read");
});

test("clearing removes every day, and everything the rows pointed at", () => {
  // §3 — a body in `overflow/` and an image in `blobs/` are files of their own,
  // so clearing only the `.jsonl` leaves the bulk of the log behind while
  // Settings reports it as gone.
  mkdirSync(join(dir, "blobs", "2026-09-06"), { recursive: true });
  writeFileSync(join(dir, "blobs", "2026-09-06", "abc.b64"), "an image");
  clearTraffic();
  assert.equal(trafficSize().days, 0);
  assert.equal(trafficSize().bytes, 0, "the blobs went too");
  assert.equal(threadTraffic("t-1").length, 0);
});
