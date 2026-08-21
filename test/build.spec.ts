// Spec 07 §4.1 and §4.7 — incremental builds, and resuming an interrupted one.
//
// Run: npm run test:build
//
// The gateway is a stub, and that is the point: these are the properties that
// decide whether the *second* build of a folder costs seconds or costs hours,
// and every one of them is plain bookkeeping. Testing them against a real model
// would take an hour per assertion and prove nothing extra — §12 milestone 1's
// "a second run over an unchanged folder does zero model calls" is exactly a
// claim about the stub's call counter.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { getLoadablePath } from "sqlite-vec";
import { runBuild } from "../src/main/facts/build.ts";
import { EMBEDDING_DIMENSIONS, type Gateway } from "../src/main/facts/gateway.ts";
import { createRun, createVectorTables, getRun } from "../src/main/facts/store.ts";
import type { ExtractedClaim } from "../src/shared/types.ts";

const SCHEMA = new URL("../src/main/db/schema.sql", import.meta.url);
const ALIASES = { extract: "stub", judge: "stub", embed: "stub" };

let work: string;
let db: Database.Database;

/**
 * A gateway that returns one claim per chunk, quoting the passage's first
 * sentence so the verbatim check of §4.3 passes.
 *
 * `chats` is the number that matters: "zero model calls" is the whole claim of
 * the incremental path.
 */
class StubGateway {
  chats = 0;
  embeds = 0;

  async preflight(required: readonly string[]): Promise<{
    healthy: boolean;
    models: string[];
    missing: string[];
  }> {
    return { healthy: true, models: [...required], missing: [] };
  }

  async chat<T>(request: { user: string; parse: (value: unknown) => T }): Promise<{
    value: T;
    stats: {
      durationMs: number;
      model: string | null;
      completionTokens: number | null;
      attempts: number;
    };
  }> {
    this.chats++;
    const passage = request.user.split("PASSAGE:\n")[1] ?? request.user;
    // From *one* block, not across the blank line the chunker joins blocks
    // with. A quote spanning two blocks is not in the document's own text — the
    // blocks are one space apart there — so `locateQuote` rightly refuses it and
    // §4.3 drops the claim. Getting that wrong here made four of these tests
    // fail with no evidence rows, which is the guard doing its job.
    const block = passage.split("\n\n").at(-1) ?? passage;
    const sentence = `${block.split(". ")[0]}.`;
    const claims: ExtractedClaim[] = [
      {
        subject: "stub subject",
        value: `value ${this.chats}`,
        quote: sentence,
        modality: "decided",
        statedAt: null,
      },
    ];
    return {
      value: request.parse({ claims }),
      stats: { durationMs: 1, model: "stub", completionTokens: 1, attempts: 1 },
    };
  }

  async embed(inputs: string[]): Promise<number[][]> {
    this.embeds++;
    // Every vector identical, so canonicalization merges everything into one
    // subject. That keeps the fixtures small; what is under test here is the
    // bookkeeping, not the thresholds (those are `facts.spec.ts`).
    return inputs.map(() =>
      Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
    );
  }
}

function write(name: string, body: string): string {
  const path = join(work, name);
  writeFileSync(path, body);
  return path;
}

const NOTHING = (): void => {};
const NEVER = (): boolean => false;

async function build(
  gateway: StubGateway,
  documents: string[],
  cancelled: () => boolean = NEVER,
): Promise<{ runId: string }> {
  const runId = createRun(db, {
    root: work,
    aliasExtract: ALIASES.extract,
    aliasJudge: ALIASES.judge,
  });
  await runBuild({
    db,
    gateway: gateway as unknown as Gateway,
    runId,
    root: work,
    documents,
    aliases: ALIASES,
    onProgress: NOTHING,
    cancelled,
  });
  return { runId };
}

const evidenceCount = (): number =>
  db.prepare<[], { n: number }>("SELECT count(*) AS n FROM fact_evidence").get()?.n ?? 0;

const evidenceFor = (path: string): number =>
  db
    .prepare<[string], { n: number }>(
      "SELECT count(*) AS n FROM fact_evidence WHERE document_path = ?",
    )
    .get(path)?.n ?? 0;

before(() => {
  work = mkdtempSync(join(tmpdir(), "rex-build-"));
  db = new Database(join(work, "rex.db"));
  db.pragma("foreign_keys = ON");
  db.loadExtension(getLoadablePath());
  db.exec(readFileSync(SCHEMA, "utf8"));
  createVectorTables(db);
});

beforeEach(() => {
  // Each test starts from an empty graph. The bookkeeping tables go too, which
  // no production path does — §6.1 forbids it — but a test that inherited the
  // previous one's `fact_document` rows would not be testing the first build.
  db.exec(`
    DELETE FROM fact_evidence; DELETE FROM fact_edge; DELETE FROM fact_claim;
    DELETE FROM fact_co_occurrence; DELETE FROM fact_subject;
    DELETE FROM fact_document; DELETE FROM fact_run;
    DELETE FROM fact_subject_vec; DELETE FROM fact_claim_vec;
  `);
});

after(() => {
  db.close();
  rmSync(work, { recursive: true, force: true });
});

test("a first build extracts every document, and a second does zero model calls", async () => {
  const a = write("a.md", "# A\n\nAlpha is decided. It stays decided.\n");
  const b = write("b.md", "# B\n\nBeta is decided. It stays decided.\n");

  const gateway = new StubGateway();
  await build(gateway, [a, b]);
  const first = gateway.chats;
  assert.ok(first >= 2, `expected at least one call per document, got ${first}`);
  assert.equal(evidenceCount(), first, "every extracted claim should have left evidence");

  // §12 milestone 1 — "a second run over an unchanged folder does zero model
  // calls". This is the line between a tool you can leave pointed at a folder
  // and one you cannot.
  await build(gateway, [a, b]);
  assert.equal(gateway.chats, first, "an unchanged folder cost model calls");
  assert.equal(evidenceCount(), first, "a no-op build changed the evidence");
});

test("changing one document re-extracts only that document", async () => {
  const a = write("a.md", "# A\n\nAlpha is decided. It stays decided.\n");
  const b = write("b.md", "# B\n\nBeta is decided. It stays decided.\n");

  const gateway = new StubGateway();
  await build(gateway, [a, b]);
  const afterFirst = gateway.chats;
  const bEvidence = evidenceFor(b);

  writeFileSync(a, "# A\n\nAlpha changed its mind. It is different now.\n");
  await build(gateway, [a, b]);

  assert.ok(gateway.chats > afterFirst, "the changed document was not re-read");
  assert.equal(gateway.chats - afterFirst, 1, "more than the changed document was re-read");
  assert.equal(evidenceFor(b), bEvidence, "the untouched document's evidence moved");
  // The old evidence must be gone, or the document states every claim twice.
  assert.equal(evidenceFor(a), 1, `a.md has ${evidenceFor(a)} evidence rows, expected 1`);
});

test("a document that is gone takes its evidence with it", async () => {
  const a = write("a.md", "# A\n\nAlpha is decided. It stays decided.\n");
  const b = write("b.md", "# B\n\nBeta is decided. It stays decided.\n");

  const gateway = new StubGateway();
  await build(gateway, [a, b]);
  assert.ok(evidenceFor(b) > 0);

  // Not passed to the build any more — which is what stage 0 sees when a file
  // has been deleted from the workspace.
  await build(gateway, [a]);
  assert.equal(evidenceFor(b), 0, "a deleted document kept its evidence");
  assert.equal(
    db
      .prepare<[string], { n: number }>("SELECT count(*) AS n FROM fact_document WHERE path = ?")
      .get(b)?.n ?? 0,
    0,
    "a deleted document kept its fact_document row",
  );
});

test("a cancelled build resumes where it stopped, and does not redo it", async () => {
  // Four blocks separated by an h2 each, so the chunker yields several chunks
  // and there is something to stop in the middle of.
  const long = write(
    "long.md",
    ["# Long"]
      .concat(
        Array.from(
          { length: 6 },
          (_, i) => `\n## Section ${i}\n\nSection ${i} is decided. It stays decided for now.\n`,
        ),
      )
      .join(""),
  );

  const gateway = new StubGateway();
  // Stop after the second chunk, the way §4.7's cancel does: the running stage
  // finishes its current call and stops.
  let seen = 0;
  await build(gateway, [long], () => ++seen > 2);
  const partial = gateway.chats;
  assert.ok(partial >= 1, "nothing was extracted before the cancel");

  const stored = db
    .prepare<[string], { chunks_done: number; chunk_count: number }>(
      "SELECT chunks_done, chunk_count FROM fact_document WHERE path = ?",
    )
    .get(long);
  assert.ok(stored, "an interrupted document left no row to resume from");
  assert.ok(
    stored.chunks_done < stored.chunk_count,
    `chunks_done ${stored.chunks_done} should be below chunk_count ${stored.chunk_count}`,
  );
  const doneBefore = stored.chunks_done;

  // Resume. The document's text has not changed, so a build that only looked at
  // the hash would skip it entirely and lose the rest — which is the bug this
  // test exists for.
  await build(gateway, [long]);
  const finished = db
    .prepare<[string], { chunks_done: number; chunk_count: number }>(
      "SELECT chunks_done, chunk_count FROM fact_document WHERE path = ?",
    )
    .get(long);
  assert.equal(
    finished?.chunks_done,
    finished?.chunk_count,
    "the resumed build did not finish the document",
  );
  assert.equal(
    gateway.chats - partial,
    (finished?.chunk_count ?? 0) - doneBefore,
    "the resumed build re-read chunks that were already stored",
  );

  // And a third build now costs nothing at all.
  const settled = gateway.chats;
  await build(gateway, [long]);
  assert.equal(gateway.chats, settled, "a finished document was read again");
});

test("a document the pipeline cannot read is reported, not silently skipped", async () => {
  const a = write("a.md", "# A\n\nAlpha is decided. It stays decided.\n");
  const pdf = write("scan.pdf", "%PDF-1.4\n");

  const gateway = new StubGateway();
  const runId = createRun(db, { root: work, aliasExtract: "stub", aliasJudge: "stub" });
  const report = await runBuild({
    db,
    gateway: gateway as unknown as Gateway,
    runId,
    root: work,
    documents: [a, pdf],
    aliases: ALIASES,
    onProgress: NOTHING,
    cancelled: NEVER,
  });

  // §7.4 — "if a build limits its own coverage, it says so in the report".
  assert.equal(report.skippedDocuments.length, 1);
  assert.equal(report.skippedDocuments[0].path, pdf);
  assert.match(report.skippedDocuments[0].reason, /renderer/);
  assert.equal(getRun(db, runId)?.state, "done");
});
