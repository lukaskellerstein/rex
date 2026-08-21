// Spec 07 §12 milestones 4 and 6 — the pipeline against a corpus whose answers
// are known in advance.
//
// Run: npm run test:findings
//
// This is the one test that exercises **judging** and **topics**, the two stages
// that cannot be reached without a real corpus: both need two claims about one
// subject, which no unit fixture produces. It runs the same `runBuild` the
// `utilityProcess` calls, against the real gateway, so it is slow — tens of
// minutes on `local-31b` — and belongs beside `claims.spec.ts` as something you
// run deliberately, never in a watch loop.
//
// The corpus is two short documents that disagree twice and agree once, plus one
// trap. §12's two sharpest checks are the last two assertions:
//
//   · a planted contradiction must be FOUND
//   · a planted *rejected option* must NOT be reported
//
// The second is the one that matters. "The team evaluated MongoDB and rejected
// it" against "data is stored in PostgreSQL" is not a disagreement, and §3.2
// rule 3 names that confusion as the largest single source of false red lines.
// A tool that paints it red teaches its reader to ignore red.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { getLoadablePath } from "sqlite-vec";
import { type BuildReport, runBuild } from "../src/main/facts/build.ts";
import { Gateway } from "../src/main/facts/gateway.ts";
import { createRun, createVectorTables, listFindings, readGraph } from "../src/main/facts/store.ts";
import type { Finding } from "../src/shared/types.ts";

const README = `# Widget Service

The Widget Service is written in TypeScript. It runs as a single process.

Widget data is stored in PostgreSQL. The team evaluated MongoDB for this and
rejected it, because the reporting queries need joins.

The service listens on port 8080.
`;

const NOTES = `# Widget Service — design notes

The Widget Service is written in Go. This was chosen for the concurrency model.

Widget data is stored in PostgreSQL, which the reporting layer queries directly.

The service listens on port 9090.
`;

const ALIASES = {
  extract: process.env.REX_FACTS_ALIAS ?? "local-31b",
  judge: process.env.REX_FACTS_ALIAS ?? "local-31b",
  embed: "embed",
};

let work: string;
let db: Database.Database;
let report: BuildReport;
let findings: Finding[];

before(async () => {
  work = mkdtempSync(join(tmpdir(), "rex-findings-"));
  writeFileSync(join(work, "readme.md"), README);
  writeFileSync(join(work, "design-notes.md"), NOTES);

  db = new Database(join(work, "rex.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.loadExtension(getLoadablePath());
  db.exec(readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8"));
  createVectorTables(db);

  const runId = createRun(db, {
    root: work,
    aliasExtract: ALIASES.extract,
    aliasJudge: ALIASES.judge,
  });

  const started = Date.now();
  report = await runBuild({
    db,
    gateway: new Gateway(),
    runId,
    root: work,
    documents: [join(work, "readme.md"), join(work, "design-notes.md")],
    aliases: ALIASES,
    onProgress: (stage, done, total, message) =>
      console.log(`  [${stage}] ${message} ${done}/${total}`),
    cancelled: () => false,
  });
  console.log(
    `\nbuild finished in ${((Date.now() - started) / 1000).toFixed(0)}s on ${ALIASES.extract}`,
  );

  findings = listFindings(db, work);

  console.log("\n── claims ──");
  for (const row of db
    .prepare<
      [],
      { subject: string; value: string; modality: string; valid_to: string | null; ev: number }
    >(
      `SELECT s.label AS subject, c.value, c.modality, c.valid_to,
              (SELECT count(*) FROM fact_evidence e WHERE e.claim_id = c.id) AS ev
         FROM fact_claim c JOIN fact_subject s ON s.id = c.subject_id
        ORDER BY s.label`,
    )
    .all()) {
    console.log(
      `  ${row.subject} = ${row.value} [${row.modality}]${row.valid_to ? " (superseded)" : ""} · ${row.ev} evidence`,
    );
  }

  console.log("\n── findings ──");
  for (const finding of findings) {
    console.log(
      `  [${finding.kind}] ${finding.subject}${finding.topicName ? ` (${finding.topicName})` : ""}`,
    );
    console.log(`     A ${finding.a.value}  ← ${finding.a.documentPath.split("/").pop()}`);
    console.log(`     B ${finding.b.value}  ← ${finding.b.documentPath.split("/").pop()}`);
  }
  if (findings.length === 0) console.log("  (none)");
});

after(() => {
  db.close();
  rmSync(work, { recursive: true, force: true });
});

test("the build completes and admits what it skipped", () => {
  assert.equal(report.cancelled, false);
  assert.equal(report.skippedDocuments.length, 0, "nothing should have been unreadable");
  // §7.4 — these are reported whatever they are; the assertion is that the
  // extraction was clean enough for the rest of the test to mean something.
  console.log(
    `\n  dropped quotes ${report.droppedQuotes} · failed chunks ${report.failedChunks} · failed pairs ${report.failedPairs}`,
  );
  assert.equal(report.failedChunks, 0, "a passage failed to extract");
});

test("the same fact stated by both documents is one claim with two evidence rows", () => {
  // Both documents say the data is in PostgreSQL. §3.1's whole picture: one
  // claim, two evidence nodes — not two claims that then look like a
  // disagreement.
  const shared = db
    .prepare<[], { value: string; ev: number }>(
      `SELECT c.value, count(DISTINCT e.document_path) AS ev
         FROM fact_claim c JOIN fact_evidence e ON e.claim_id = c.id
        GROUP BY c.id HAVING ev > 1`,
    )
    .all();
  console.log(`  claims stated by more than one document: ${JSON.stringify(shared)}`);
  assert.ok(
    shared.some((row) => /postgres/i.test(row.value)),
    "PostgreSQL is stated by both documents but did not become one claim with two evidence rows",
  );
});

test("a planted contradiction is found", () => {
  const languages = findings.filter((finding) =>
    /typescript|\bgo\b/i.test(`${finding.a.value} ${finding.b.value}`),
  );
  assert.ok(
    languages.length > 0,
    `TypeScript vs Go was not reported. Findings: ${findings.map((f) => f.subject).join(", ") || "none"}`,
  );
});

test("a planted rejected option is NOT reported", () => {
  // §12 milestone 4's sharpest check, and §3.2 rule 3's failure mode. MongoDB
  // was considered and turned down; reporting it as a disagreement with
  // PostgreSQL is a false red line, and false red lines are how a reviewer
  // learns to ignore red.
  const mongo = findings.filter((finding) =>
    /mongo/i.test(`${finding.subject} ${finding.a.value} ${finding.b.value}`),
  );
  assert.equal(
    mongo.length,
    0,
    `a rejected option was reported as a contradiction: ${JSON.stringify(mongo, null, 2)}`,
  );
});

test("every finding carries both quotes and an anchor into each document", () => {
  // §11 rule 4 — a claim the user cannot check is worse than no claim.
  for (const finding of findings) {
    for (const side of [finding.a, finding.b]) {
      assert.ok(side.quote.length > 0, `${finding.subject}: a side had no quote`);
      assert.ok(side.anchor.quote?.exact, `${finding.subject}: a side had no anchor quote`);
      assert.ok(side.documentPath.length > 0, `${finding.subject}: a side had no document`);
    }
    assert.notEqual(finding.a.claimId, finding.b.claimId, "a claim was paired with itself");
  }
});

test("an evidence quote is character-for-character in its document's text", () => {
  // The property the anchors rest on: layer 1 of spec 01 §6.5 is an exact string
  // match, so a quote that is not a substring of the normalised document text
  // could only ever orphan. `text.spec.ts` proves that text matches the live DOM;
  // this proves the stored quotes are in it.
  const rows = db
    .prepare<[], { quote: string; document_path: string }>(
      "SELECT quote, document_path FROM fact_evidence",
    )
    .all();
  assert.ok(rows.length > 0, "no evidence to check");

  for (const row of rows) {
    const source = readFileSync(row.document_path, "utf8");
    const normalised = source.replace(/\s+/g, " ").trim();
    assert.ok(
      normalised.includes(row.quote.replace(/\s+/g, " ").trim()),
      `a stored quote is not in ${row.document_path.split("/").pop()}: ${JSON.stringify(row.quote)}`,
    );
  }
});

test("the graph lens has nodes, edges and topics to draw", () => {
  const graph = readGraph(db, work);
  console.log(
    `  lens: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.topics.length} topics — ${graph.topics.map((t) => t.name).join(", ")}`,
  );
  assert.ok(graph.nodes.length > 0, "the lens had nothing to draw");
  // Every claim is tethered to its subject by an `about` edge (§8.2).
  assert.ok(
    graph.edges.some((edge) => edge.kind === "about"),
    "no claim was connected to its subject",
  );
  // §4.6 — every subject ends up in a community, even one of its own.
  const untopiced = graph.nodes.filter((n) => n.kind === "subject" && n.topicId === null);
  assert.equal(untopiced.length, 0, `${untopiced.length} subjects were left without a topic`);
});
