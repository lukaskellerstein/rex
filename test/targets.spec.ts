// Spec 05 §10 milestone 15 — the migration, and the one rule that reads a
// thread's targets.
//
// Both fail silently if they are wrong. A migration that drops a target loses a
// place somebody chose by hand, and reports nothing; a worst-state rule that
// counts `null` as orphaned turns "that document has not been open" into "the
// text is gone", which sends a reviewer looking for damage that never happened.
//
// A real SQLite database, not a mock: the migration is SQL, and a test of SQL
// against a fake is a test of the fake.
//
// Run: npm run test:targets

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { migrateThreadTargets } from "../src/main/db/migrate.ts";
import { createThread, getThread } from "../src/main/db/queries.ts";
import { applyPlan, withDetail } from "../src/main/threads.ts";
import { worstState } from "../src/shared/targets.ts";
import type { Anchor } from "../src/shared/types.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "src/main/db/schema.sql"), "utf8");

interface TargetRow {
  thread_id: string;
  position: number;
  document_id: string;
  anchor_json: string;
  anchor_state: string | null;
}

function anchorQuoting(exact: string): Anchor {
  return {
    quote: { exact, prefix: "", suffix: "" },
    position: null,
    element: null,
    region: null,
    source: null,
  };
}

/** A database as an earlier build left it: anchors in the old thread columns. */
function legacyDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);

  db.prepare(
    "INSERT INTO document (id, kind, value, title, content_hash, last_seen_at) VALUES (?, 'file', ?, NULL, NULL, ?)",
  ).run("d1", "/tmp/rex-targets-spec/sample.md", "2026-08-21T00:00:00.000Z");

  const thread = db.prepare(
    `INSERT INTO thread (id, document_id, kind, status, anchor_json, extra_anchors_json,
                         anchor_state, note, session_id, profile, model,
                         created_at, updated_at, resolved_at)
     VALUES (?, 'd1', ?, 'open', ?, ?, ?, ?, NULL, 'read', NULL, ?, ?, NULL)`,
  );

  thread.run(
    "t1",
    "anchored",
    JSON.stringify(anchorQuoting("The retry budget is 3.")),
    JSON.stringify([anchorQuoting("Retries are capped at five."), anchorQuoting("Never retry.")]),
    "moved",
    "Do these disagree?",
    "2026-08-21T00:00:00.000Z",
    "2026-08-21T00:00:00.000Z",
  );

  // A one-target comment, which is what every row written before spec 04 was.
  thread.run(
    "t2",
    "anchored",
    JSON.stringify(anchorQuoting("The default is 1024.")),
    null,
    "ok",
    "Still right?",
    "2026-08-21T00:01:00.000Z",
    "2026-08-21T00:01:00.000Z",
  );

  // A synthesis comment has no anchor at all and must gain no targets.
  thread.run(
    "t3",
    "synthesis",
    null,
    null,
    null,
    "Do 1 and 2 agree?",
    "2026-08-21T00:02:00.000Z",
    "2026-08-21T00:02:00.000Z",
  );

  return db;
}

function targetsOf(db: Database.Database, threadId: string): TargetRow[] {
  return db
    .prepare<[string], TargetRow>(
      "SELECT * FROM thread_target WHERE thread_id = ? ORDER BY position",
    )
    .all(threadId);
}

test("the migration turns anchor_json and extra_anchors_json into ordered rows", () => {
  const db = legacyDatabase();
  try {
    migrateThreadTargets(db);

    const targets = targetsOf(db, "t1");
    assert.equal(targets.length, 3);
    assert.deepEqual(
      targets.map((row) => row.position),
      [0, 1, 2],
    );
    // The primary anchor leads, and the extras keep the order they were in.
    assert.deepEqual(
      targets.map((row) => (JSON.parse(row.anchor_json) as Anchor).quote?.exact),
      ["The retry budget is 3.", "Retries are capped at five.", "Never retry."],
    );
    // Every target carries the thread's own document and its single state.
    assert.ok(targets.every((row) => row.document_id === "d1"));
    assert.ok(targets.every((row) => row.anchor_state === "moved"));

    assert.equal(targetsOf(db, "t2").length, 1);
    assert.equal(targetsOf(db, "t3").length, 0);
  } finally {
    db.close();
  }
});

test("running the migration twice changes nothing", () => {
  const db = legacyDatabase();
  try {
    assert.equal(migrateThreadTargets(db), 2);
    const first = db.prepare("SELECT * FROM thread_target ORDER BY thread_id, position").all();

    // The second run must find nothing to move: it is called on every open, and
    // a migration that re-ran would duplicate every target once per launch.
    assert.equal(migrateThreadTargets(db), 0);
    const second = db.prepare("SELECT * FROM thread_target ORDER BY thread_id, position").all();

    assert.deepEqual(second, first);
  } finally {
    db.close();
  }
});

test("a target added after the migration is left alone by it", () => {
  const db = legacyDatabase();
  try {
    migrateThreadTargets(db);
    // A comment made in the new world: targets, and no legacy columns filled in.
    db.prepare(
      `INSERT INTO thread (id, document_id, kind, status, note, session_id, profile, model,
                           created_at, updated_at, resolved_at)
       VALUES ('t4', 'd1', 'anchored', 'open', 'New one', NULL, 'read', NULL, ?, ?, NULL)`,
    ).run("2026-08-21T00:03:00.000Z", "2026-08-21T00:03:00.000Z");
    db.prepare(
      `INSERT INTO thread_target (thread_id, position, document_id, anchor_json, anchor_state)
       VALUES ('t4', 0, 'd1', ?, 'ok')`,
    ).run(JSON.stringify(anchorQuoting("A new passage.")));

    assert.equal(migrateThreadTargets(db), 0);
    assert.equal(targetsOf(db, "t4").length, 1);
  } finally {
    db.close();
  }
});

test("a document Apply cannot edit is skipped, not a refusal for the whole comment", () => {
  // Spec 05 §5.6 — a comment about a Markdown file and a PDF is a comment whose
  // Markdown half can still be applied. Refusing outright would make one
  // unreachable target disable the button for every reachable one.
  const db = new Database(":memory:");
  try {
    db.exec(SCHEMA);
    const document = db.prepare(
      "INSERT INTO document (id, kind, value, title, content_hash, last_seen_at) VALUES (?, ?, ?, NULL, NULL, ?)",
    );
    document.run("md", "file", "/tmp/rex-targets-spec/notes.md", "2026-08-21T00:00:00.000Z");
    document.run("pdf", "file", "/tmp/rex-targets-spec/report.pdf", "2026-08-21T00:00:00.000Z");
    document.run("url", "url", "https://example.com/page", "2026-08-21T00:00:00.000Z");

    const anchor = anchorQuoting("Something worth changing.");
    const thread = createThread(db, {
      kind: "anchored",
      targets: [
        { documentId: "md", anchor },
        { documentId: "pdf", anchor },
        { documentId: "url", anchor },
      ],
      note: "Make these agree.",
      profile: "read",
    });

    const plan = applyPlan(db, thread);
    assert.deepEqual(plan.editable, ["/tmp/rex-targets-spec/notes.md"]);
    assert.deepEqual(
      plan.skipped.map((entry) => entry.file),
      ["/tmp/rex-targets-spec/report.pdf", "https://example.com/page"],
    );
    assert.match(plan.skipped[0].reason, /Apply cannot edit a PDF/);

    // And the card is told it can act, so the button is offered rather than
    // disabled by the two it must leave alone.
    const detailed = withDetail(db, getThread(db, thread.id) ?? thread);
    assert.equal(detailed.applyEnabled, true);
    assert.equal(detailed.applyDisabledReason, null);
    assert.deepEqual(detailed.documentNames, ["notes.md", "report.pdf", "example.com"]);
  } finally {
    db.close();
  }
});

test("a comment with nothing editable says so, once", () => {
  const db = new Database(":memory:");
  try {
    db.exec(SCHEMA);
    db.prepare(
      "INSERT INTO document (id, kind, value, title, content_hash, last_seen_at) VALUES ('pdf', 'file', ?, NULL, NULL, ?)",
    ).run("/tmp/rex-targets-spec/report.pdf", "2026-08-21T00:00:00.000Z");

    const thread = createThread(db, {
      kind: "anchored",
      targets: [{ documentId: "pdf", anchor: anchorQuoting("A page.") }],
      note: "Change this.",
      profile: "read",
    });

    const detailed = withDetail(db, getThread(db, thread.id) ?? thread);
    assert.equal(detailed.applyEnabled, false);
    assert.match(detailed.applyDisabledReason ?? "", /Apply cannot edit a PDF/);
  } finally {
    db.close();
  }
});

test("the worst-state rule ignores null", () => {
  // §5.4 — a thread is as good as its worst target, and a target nobody has
  // looked at is not competing.
  assert.equal(worstState(["ok", null, "moved"]), "moved");
  assert.equal(worstState([null, "ok"]), "ok");
  assert.equal(worstState(["moved", "orphaned", "ok"]), "orphaned");
});

test("null never counts as orphaned", () => {
  // The whole point of the null state: "nobody looked" is not "the text is
  // gone", and a thread with nothing checked has no state at all rather than
  // the worst one.
  assert.equal(worstState([null, null]), null);
  assert.equal(worstState([]), null);
  assert.notEqual(worstState([null]), "orphaned");
});
