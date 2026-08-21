// Spec 07 §6 — the fact graph's storage, and the invariants that make it safe
// to throw away.
//
// Run: npm run test:facts
//
// No Electron and no `utilityProcess`: `store.ts` takes a `Db`, so a plain
// `better-sqlite3` handle over a temp file exercises every query. Extraction and
// judging are not here — they need a model and live in `claims.spec.ts`, which
// is the §12 milestone 0 gate.
//
// The embeddings ARE real, from the gateway's `embed` alias. That is a
// deliberate exception to "tests should not need a network": §4.4 is the stage
// that decides whether the feature works, its two thresholds are stated as
// cosine similarities against one specific model, and hand-written vectors
// would prove the arithmetic while proving nothing about where real phrases
// actually land. That distinction is not academic — measuring it is what showed
// §4.4's 0.90 default rejecting four of seven subject pairs that plainly mean
// the same thing (`canonical.ts`). `embed` answers in tens of milliseconds
// (§5.3), so the honesty costs almost nothing.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { getLoadablePath } from "sqlite-vec";
import { SUBJECT_THRESHOLD } from "../src/main/facts/canonical.ts";
import { EMBEDDING_DIMENSIONS, Gateway } from "../src/main/facts/gateway.ts";
import {
  addEdge,
  candidateSubjects,
  claimsOfSubject,
  createVectorTables,
  dropGraph,
  findingKey,
  forgetDocument,
  insertClaim,
  insertEvidence,
  insertSubject,
  listFindings,
  nearestClaim,
  nearestSubject,
  recordDocument,
  setVerdict,
} from "../src/main/facts/store.ts";
import type { Anchor } from "../src/shared/types.ts";

const ROOT = "/workspace";
const SCHEMA = new URL("../src/main/db/schema.sql", import.meta.url);

let work: string;
let db: Database.Database;
let gateway: Gateway;

const anchor = (quote: string): Anchor => ({
  quote: { exact: quote, prefix: "", suffix: "" },
  position: { start: 0, end: quote.length },
  element: null,
  region: null,
  source: null,
});

before(() => {
  work = mkdtempSync(join(tmpdir(), "rex-facts-"));
  db = new Database(join(work, "rex.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.loadExtension(getLoadablePath());
  db.exec(readFileSync(SCHEMA, "utf8"));
  createVectorTables(db);
  gateway = new Gateway();
});

after(() => {
  db.close();
  rmSync(work, { recursive: true, force: true });
});

// ── §12 milestone 2 — the vector tables ─────────────────────

test("sqlite-vec loads and the vec0 tables accept 768-dimension vectors", async () => {
  const [vector] = await gateway.embed(["implementation language"]);
  assert.equal(vector.length, EMBEDDING_DIMENSIONS);

  const id = insertSubject(db, ROOT, "implementation language", vector);
  const found = nearestSubject(db, ROOT, vector);
  assert.equal(found?.id, id);
  // Cosine distance against itself is 0, so similarity is 1. If this comes back
  // near 0 the column is using L2 and every §4.4 threshold is meaningless.
  assert.ok((found?.similarity ?? 0) > 0.999, `self-similarity was ${found?.similarity}`);
});

test("a subject search is scoped to its workspace", async () => {
  const [vector] = await gateway.embed(["deployment target"]);
  insertSubject(db, "/other-workspace", "deployment target", vector);

  const here = nearestSubject(db, ROOT, vector);
  // §13 rules out cross-workspace fact graphs. Without the partition key the
  // other workspace's identical subject would be the nearest hit and two corpora
  // would silently merge.
  assert.notEqual(here?.id, undefined);
  assert.ok(
    (here?.similarity ?? 1) < 0.999,
    "a subject from another workspace was returned as an exact match",
  );
});

// ── §12 milestone 3 — canonicalization ──────────────────────

test("differently-worded subjects merge, and unrelated ones do not", async () => {
  // §12 milestone 3's first acceptance check. It is written as a *separation*
  // test rather than a "does X merge" test, because a threshold low enough to
  // merge anything passes the second kind trivially — and a subject threshold
  // that is too low is the failure that manufactures contradictions between
  // claims that were never about the same thing.
  const [canonical, ...others] = await gateway.embed([
    "implementation language",
    "programming language",
    "language the project is written in",
    // Must NOT merge with any of the above.
    "comment storage",
    "test strategy",
  ]);

  const id = insertSubject(db, ROOT, "implementation language", canonical);
  const variants = others.slice(0, 2);
  const unrelated = others.slice(2);

  for (const [index, variant] of variants.entries()) {
    const found = nearestSubject(db, ROOT, variant);
    assert.equal(found?.id, id, `variant ${index} matched a different subject`);
    assert.ok(
      (found?.similarity ?? 0) >= SUBJECT_THRESHOLD,
      `variant ${index} scored ${found?.similarity?.toFixed(3)}, below the tuned ${SUBJECT_THRESHOLD}`,
    );
  }

  for (const [index, other] of unrelated.entries()) {
    const found = nearestSubject(db, ROOT, other);
    assert.ok(
      (found?.similarity ?? 1) < SUBJECT_THRESHOLD,
      `unrelated subject ${index} scored ${found?.similarity?.toFixed(3)} and would have been merged into "implementation language"`,
    );
  }
});

test("a claim stated in three documents is one claim with three evidence nodes", async () => {
  const [subjectVector, valueVector] = await gateway.embed(["comment storage", "SQLite"]);
  const subjectId = insertSubject(db, ROOT, "comment storage", subjectVector);
  const claimId = insertClaim(db, {
    subjectId,
    value: "SQLite",
    modality: "decided",
    statedAt: null,
    embedding: valueVector,
  });

  for (const path of ["/workspace/a.md", "/workspace/b.md", "/workspace/c.md"]) {
    insertEvidence(db, {
      claimId,
      documentPath: path,
      chunkIndex: 0,
      quote: `Comments are stored in SQLite, per ${path}.`,
      anchor: anchor(`Comments are stored in SQLite, per ${path}.`),
    });
  }

  const claims = claimsOfSubject(db, subjectId);
  assert.equal(claims.length, 1, "three evidence rows became more than one claim");
  // §3.1 — "the same fact in five documents is one claim with five evidence
  // nodes". This is that picture, at three.
  const count = db
    .prepare<[string], { n: number }>("SELECT count(*) AS n FROM fact_evidence WHERE claim_id = ?")
    .get(claimId);
  assert.equal(count?.n, 3);

  // The value vector is close to itself inside the subject, which is what §4.4
  // step 3 relies on to attach the second and third document to this claim.
  const near = nearestClaim(db, subjectId, valueVector);
  assert.equal(near?.id, claimId);
});

// ── §12 milestone 1 — deletion ──────────────────────────────

test("deleting a document removes its evidence, and any claim whose last evidence went with it", async () => {
  const [subjectVector, valueVector] = await gateway.embed(["build tool", "electron-vite"]);
  const subjectId = insertSubject(db, ROOT, "build tool", subjectVector);
  const claimId = insertClaim(db, {
    subjectId,
    value: "electron-vite",
    modality: "decided",
    statedAt: null,
    embedding: valueVector,
  });
  insertEvidence(db, {
    claimId,
    documentPath: "/workspace/only.md",
    chunkIndex: 0,
    quote: "The build tool is electron-vite.",
    anchor: anchor("The build tool is electron-vite."),
  });
  recordDocument(db, ROOT, {
    path: "/workspace/only.md",
    contentHash: "abc",
    chunkCount: 1,
  });

  forgetDocument(db, ROOT, "/workspace/only.md");

  assert.equal(
    db
      .prepare<[string], { n: number }>("SELECT count(*) AS n FROM fact_claim WHERE id = ?")
      .get(claimId)?.n,
    0,
    "a claim outlived its last evidence — §11 rule 4 forbids showing one",
  );
  // Its vector must go too: left behind it stays a merge candidate for a subject
  // that no longer exists, and a later claim would silently join a deleted
  // document's subject.
  assert.equal(
    db
      .prepare<[string], { n: number }>(
        "SELECT count(*) AS n FROM fact_claim_vec WHERE claim_id = ?",
      )
      .get(claimId)?.n,
    0,
    "an orphaned vector row survived the delete",
  );
});

// ── §12 milestone 5 — a verdict survives a rebuild ──────────

test("a dismissed finding stays dismissed across a full graph rebuild", async () => {
  const [subjectVector, tsVector, pyVector] = await gateway.embed([
    "implementation language",
    "TypeScript",
    "Python",
  ]);

  const build = (): { key: string } => {
    const subjectId = insertSubject(db, ROOT, "implementation language", subjectVector);
    const a = insertClaim(db, {
      subjectId,
      value: "TypeScript",
      modality: "decided",
      statedAt: null,
      embedding: tsVector,
    });
    const b = insertClaim(db, {
      subjectId,
      value: "Python",
      modality: "decided",
      statedAt: null,
      embedding: pyVector,
    });
    insertEvidence(db, {
      claimId: a,
      documentPath: "/workspace/readme.md",
      chunkIndex: 0,
      quote: "REX is written in TypeScript.",
      anchor: anchor("REX is written in TypeScript."),
    });
    insertEvidence(db, {
      claimId: b,
      documentPath: "/workspace/old-plan.md",
      chunkIndex: 0,
      quote: "REX is written in Python.",
      anchor: anchor("REX is written in Python."),
    });
    addEdge(db, a, b, "contradicts");

    // `includeDismissed` deliberately: this helper's job is to report the key
    // the rebuild produced, and after the dismissal the plain list is *supposed*
    // to be empty. Reading it without this flag makes the second build look like
    // a failure at exactly the moment the feature under test is working.
    const [finding] = listFindings(db, ROOT, { includeDismissed: true });
    assert.ok(finding, "the contradiction did not reach the findings list");
    return { key: finding.key };
  };

  const first = build();
  assert.equal(listFindings(db, ROOT).length, 1);

  setVerdict(db, first.key, "dismissed", null);
  assert.equal(listFindings(db, ROOT).length, 0, "a dismissed finding was still listed");
  assert.equal(
    listFindings(db, ROOT, { includeDismissed: true }).length,
    1,
    "showDismissed did not bring it back",
  );

  // §6.1 — the graph is a cache and may be dropped at any time. The verdict is
  // bookkeeping and must not go with it.
  dropGraph(db, ROOT);
  assert.equal(listFindings(db, ROOT, { includeDismissed: true }).length, 0);

  const second = build();
  assert.equal(
    second.key,
    first.key,
    "the finding key moved across a rebuild — claim ids leaked into it (§6.4)",
  );
  assert.equal(
    listFindings(db, ROOT).length,
    0,
    "§11 rule 3 — a dismissed finding came back after a rebuild",
  );

  dropGraph(db, ROOT);
});

// ── §4.5 — the candidate query ──────────────────────────────

test("a rejected option is not a candidate, and a lone claim is not a pair", async () => {
  const [subjectVector, tsVector, pyVector, rustVector] = await gateway.embed([
    "implementation language",
    "TypeScript",
    "Python",
    "Rust",
  ]);
  const subjectId = insertSubject(db, ROOT, "implementation language", subjectVector);

  const withEvidence = (
    value: string,
    modality: "decided" | "rejected",
    embedding: number[],
    path: string,
  ): string => {
    const id = insertClaim(db, { subjectId, value, modality, statedAt: null, embedding });
    insertEvidence(db, {
      claimId: id,
      documentPath: path,
      chunkIndex: 0,
      quote: `The language is ${value}.`,
      anchor: anchor(`The language is ${value}.`),
    });
    return id;
  };

  withEvidence("TypeScript", "decided", tsVector, "/workspace/a.md");
  // §3.2 rule 3 — "we considered Python and rejected it" must not contradict
  // "we use TypeScript". This single confusion produces more false red lines
  // than any other cause.
  withEvidence("Python", "rejected", pyVector, "/workspace/b.md");

  assert.equal(
    candidateSubjects(db, ROOT).includes(subjectId),
    false,
    "one decided claim plus one rejected option was offered as a contradiction candidate",
  );

  withEvidence("Rust", "decided", rustVector, "/workspace/c.md");
  assert.ok(
    candidateSubjects(db, ROOT).includes(subjectId),
    "two decided claims about one subject were not offered as candidates",
  );
  assert.equal(
    claimsOfSubject(db, subjectId).length,
    2,
    "the rejected option leaked into the judgeable claims",
  );

  dropGraph(db, ROOT);
});

// ── §6.4 — the finding key ──────────────────────────────────

test("the finding key ignores quote whitespace, case and side order", () => {
  const a = { quote: "REX is written in TypeScript.", documentPath: "/w/a.md" };
  const b = { quote: "REX is written in Python.", documentPath: "/w/b.md" };

  assert.equal(findingKey(a, b), findingKey(b, a), "the key depended on which side came first");
  assert.equal(
    findingKey(a, b),
    findingKey({ quote: "REX  is written   in TYPESCRIPT.", documentPath: "/w/a.md" }, b),
    "re-rendering a document with different spacing would resurrect a dismissal",
  );
  assert.notEqual(
    findingKey(a, b),
    findingKey({ ...a, documentPath: "/w/other.md" }, b),
    "two different documents produced the same key",
  );
});
