// Spec 05 §10 milestone 15 and spec 32 — the migration, and the one rule that
// reads a thread's targets.
//
// Both fail silently if they are wrong. A migration that drops a target loses a
// place somebody chose by hand, and reports nothing; a roll-up rule that counts
// `null` as orphaned turns "that document has not been open" into "the text is
// gone", and one that counts a single dead place as a dead comment files three
// live places in the `gone` lane. Both send a reviewer looking for damage that
// never happened, and neither says a word.
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
import { commentCountsByDocument, createThread, getThread } from "../src/main/db/queries.ts";
import { applyPlan, withDetail } from "../src/main/threads.ts";
import { placesWord, tallyPlaces, threadState } from "../src/shared/targets.ts";
import type { Anchor, AnchorState } from "../src/shared/types.ts";

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

    const anchor = anchorQuoting("Something worth changing.");
    const thread = createThread(db, {
      kind: "anchored",
      targets: [
        { documentId: "md", anchor },
        { documentId: "pdf", anchor },
      ],
      note: "Make these agree.",
      profile: "read",
    });

    const plan = applyPlan(db, thread);
    assert.deepEqual(plan.editable, ["/tmp/rex-targets-spec/notes.md"]);
    assert.deepEqual(
      plan.skipped.map((entry) => entry.file),
      ["/tmp/rex-targets-spec/report.pdf"],
    );
    assert.match(plan.skipped[0].reason, /Apply cannot edit a PDF/);

    // And the card is told it can act, so the button is offered rather than
    // disabled by the one it must leave alone.
    const detailed = withDetail(db, getThread(db, thread.id) ?? thread);
    assert.equal(detailed.applyEnabled, true);
    assert.equal(detailed.applyDisabledReason, null);
    assert.deepEqual(detailed.documentNames, ["notes.md", "report.pdf"]);
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

/** The rule under test, from a list of place states. */
const stateOf = (states: Array<AnchorState | null>): AnchorState | null =>
  threadState(tallyPlaces(states));

test("one lost place does not lose the comment", () => {
  // Spec 32 §1.1, the comment this spec was written for: four places, one
  // renamed heading. It read `anchor lost` and left the `open` filter while
  // three of its four places were painted on the paper.
  assert.equal(stateOf(["ok", "orphaned", "ok", "ok"]), "moved");
  // And the loudest half is what the word reports.
  assert.deepEqual(placesWord(tallyPlaces(["ok", "orphaned", "ok", "ok"])), {
    text: "1 of 4 lost",
    tone: "lost",
  });
});

test("a comment is gone only when every place is", () => {
  // §2 — `orphaned` needs unanimity. It is the lane that says "you cannot reach
  // this comment by pointing at the paper", and one live place disproves it.
  assert.equal(stateOf(["orphaned"]), "orphaned");
  assert.equal(stateOf(["orphaned", "orphaned"]), "orphaned");
  assert.equal(stateOf(["orphaned", "moved"]), "moved");
  assert.equal(stateOf(["orphaned", "ok"]), "moved");
});

test("moved takes the leftover, and a clean comment stays ok", () => {
  // §2.1 — not gone and not clean is one amber wash, whichever way it got there.
  assert.equal(stateOf(["ok", "moved"]), "moved");
  assert.equal(stateOf(["moved", "moved"]), "moved");
  assert.equal(stateOf(["ok", "ok"]), "ok");
});

test("null competes in neither direction", () => {
  // §2 and spec 05 §5.4 — "nobody looked" cannot lose a comment and cannot save
  // one. A comment whose only answer is `orphaned` is gone, whatever else it
  // has that nobody has read.
  assert.equal(stateOf(["ok", null, "moved"]), "moved");
  assert.equal(stateOf([null, "ok"]), "ok");
  assert.equal(stateOf(["orphaned", null, null]), "orphaned");
});

test("nothing checked is no state at all, never orphaned", () => {
  // The whole point of the null state: "nobody looked" is not "the text is
  // gone", and REX cannot report a document it never opened as fine either.
  assert.equal(stateOf([null, null]), null);
  assert.equal(stateOf([]), null);
  assert.equal(placesWord(tallyPlaces([null, null])), null);
});

test("the word counts the places anyone looked at, and no others", () => {
  // §2.2 — the denominator is `checked`. A fifth place in a file nobody has
  // opened is not evidence, so putting it in the fraction would make the word a
  // claim about a file nobody read.
  assert.deepEqual(placesWord(tallyPlaces(["orphaned", "ok", null, null])), {
    text: "1 of 2 lost",
    tone: "lost",
  });
  assert.deepEqual(placesWord(tallyPlaces(["moved", "ok", "ok", "ok"])), {
    text: "1 of 4 moved",
    tone: "moved",
  });
  // Unanimous, so there is nothing to count: the plain words stay.
  assert.deepEqual(placesWord(tallyPlaces(["orphaned", "orphaned"])), {
    text: "anchor lost",
    tone: "lost",
  });
  assert.deepEqual(placesWord(tallyPlaces(["moved"])), { text: "text moved", tone: "moved" });
  // Nothing is wrong with it, so it says nothing.
  assert.equal(placesWord(tallyPlaces(["ok", "ok"])), null);
});

test("a loss outshouts a move in the same comment", () => {
  // §2.2 — one word for one comment, and the loss is the half worth reading.
  assert.deepEqual(placesWord(tallyPlaces(["ok", "moved", "orphaned", "ok"])), {
    text: "1 of 4 lost",
    tone: "lost",
  });
});

/** Spec 18 §4.2 — one document, one comment of every shape the counts see. */
function countingDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  const at = "2026-08-26T00:00:00.000Z";

  const document = db.prepare(
    "INSERT INTO document (id, kind, value, title, content_hash, last_seen_at) VALUES (?, 'file', ?, NULL, NULL, ?)",
  );
  document.run("d1", DOCUMENT, at);
  document.run("d2", OTHER_DOCUMENT, at);

  const thread = db.prepare(
    `INSERT INTO thread (id, document_id, kind, status, note, session_id, profile, model,
                         created_at, updated_at, resolved_at)
     VALUES (?, 'd1', ?, ?, ?, NULL, 'read', NULL, ?, ?, NULL)`,
  );
  const target = db.prepare(
    `INSERT INTO thread_target (thread_id, position, document_id, anchor_json, anchor_state)
     VALUES (?, ?, ?, ?, ?)`,
  );

  /** One comment, and one place per state given — all in `d1` unless said. */
  const comment = (
    id: string,
    status: string,
    places: Array<{ state: string | null; documentId?: string }>,
  ): void => {
    thread.run(id, "anchored", status, `Comment ${id}`, at, at);
    places.forEach((place, position) => {
      const json = JSON.stringify(anchorQuoting(`Passage ${id}.${position}`));
      target.run(id, position, place.documentId ?? "d1", json, place.state);
    });
  };

  comment("t1", "open", [{ state: "ok" }]);
  comment("t2", "open", [{ state: "moved" }]);
  comment("t3", "open", [{ state: "orphaned" }]);
  // The one the two surfaces used to disagree about.
  comment("t4", "resolved", [{ state: "orphaned" }]);
  comment("t5", "resolved", [{ state: "ok" }]);
  // A synthesis has no target, so it has no state rather than an orphaned one.
  thread.run("t6", "synthesis", "open", "About t1 and t2", at, at);
  // Spec 32 §4 — two places in ONE file, one of them dead. Open, not gone.
  comment("t7", "open", [{ state: "orphaned" }, { state: "ok" }]);
  // Spec 32 §4 — the dead place is here and the live one is elsewhere. The
  // comment is one thing and gets one verdict, counted against both files.
  comment("t8", "open", [{ state: "orphaned" }, { state: "ok", documentId: "d2" }]);

  return db;
}

const DOCUMENT = "/tmp/rex-targets-spec/overview.md";
const OTHER_DOCUMENT = "/tmp/rex-targets-spec/components.md";

test("the three comment counts are disjoint", () => {
  // Spec 18 §4.2 — open + gone + resolved is every comment on the file, counted
  // once. Anything else and the tree's numbers cannot be added up by eye.
  const db = countingDatabase();
  try {
    const counts = commentCountsByDocument(db).get(DOCUMENT);
    assert.ok(counts, "the document has comments and must appear in the map");
    // t1, t2, t6, t7 and t8 open; t4 and t5 resolved; t3 the only real orphan.
    assert.deepEqual(counts, { open: 5, resolved: 2, orphaned: 1 });
    assert.equal(counts.open + counts.resolved + counts.orphaned, 8);
  } finally {
    db.close();
  }
});

test("a file's count is open when one of a comment's two places survives", () => {
  // Spec 32 §4 — MIN, not MAX. t7 has a dead place and a live one in this file,
  // and under the old rule the tree drew a grey `?` for it while the sidebar
  // listed it as open.
  const db = countingDatabase();
  try {
    const counts = commentCountsByDocument(db).get(DOCUMENT);
    assert.equal(counts?.orphaned, 1, "t3 is the only comment with nothing left");
  } finally {
    db.close();
  }
});

test("one comment gets one verdict, in every file it names", () => {
  // Spec 32 §4 — the verdict is over the whole comment, not over one document's
  // share of it. t8's dead place is in `DOCUMENT` and its live one is in
  // `OTHER_DOCUMENT`; grouped per document it was gone here and open there, so
  // the tree contradicted itself about one comment.
  const db = countingDatabase();
  try {
    const counts = commentCountsByDocument(db);
    assert.deepEqual(counts.get(OTHER_DOCUMENT), { open: 1, resolved: 0, orphaned: 0 });
    assert.equal(counts.get(DOCUMENT)?.orphaned, 1, "t8 is not gone here either");
  } finally {
    db.close();
  }
});

test("a resolved comment whose text is gone is counted once, as resolved", () => {
  // Spec 18 §2 — `resolved` is terminal. Counted as orphaned as well, t4 was
  // added to both totals here and pulled out of the resolved lane by the
  // sidebar, so the same comment was in two places at once.
  const db = countingDatabase();
  try {
    const counts = commentCountsByDocument(db).get(DOCUMENT);
    assert.equal(counts?.orphaned, 1, "only the open orphan counts");
    assert.equal(counts?.resolved, 2, "and the resolved one stays resolved");
  } finally {
    db.close();
  }
});

test("a comment whose text moved is open, not a lane of its own", () => {
  // Spec 18 §2.1 — nothing is wrong with it: it was re-found, it is one click
  // away, and the card says where it went.
  const db = countingDatabase();
  try {
    // t1 (ok), t2 (moved), t6 (no target), t7 and t8 (part-lost) are the five.
    assert.equal(commentCountsByDocument(db).get(DOCUMENT)?.open, 5);
  } finally {
    db.close();
  }
});
