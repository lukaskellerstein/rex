// Spec 25 and spec 31, milestone 0 — the lists, the setting and the columns.
//
// Three things that can be checked without a window, and the one of them that
// nobody would think to check is the third: a default the CLI no longer offers.
// It is what a reviewer meets after an upgrade or after an account runs out of
// credits for a model, and the wrong answer — silently rewriting their stored
// choice — is invisible until they wonder why every answer is Opus again.
//
// The probe DOES start the real Claude CLI. It sends no user message, so it
// spends nothing (§3.2); it is asserted in both of its two specified shapes,
// because "the CLI is not installed here" is a case the picker has to survive
// and a test that fails on it would be testing the machine.
//
// Spec 31 §3.1 — ONE probe answers both lists now, so one suite covers both.
//
// Run: npm run test:models

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { listCapabilities, nameModels } from "../src/main/agent/capabilities.ts";
import {
  migrateMessageModel,
  migrateMessageStyle,
  migrateThreadStyle,
} from "../src/main/db/migrate.ts";
import {
  defaultModel,
  getSetting,
  MODEL_DEFAULT_KEY,
  setSetting,
} from "../src/main/db/settings.ts";
import { DEFAULT_MODEL, DEFAULT_STYLE, type ModelChoice } from "../src/shared/types.ts";

const work = mkdtempSync(join(tmpdir(), "rex-models-"));
after(() => rmSync(work, { recursive: true, force: true }));

function openWithSettings(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.exec("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

/** A `message` table as it stood before spec 25 — no `model`, no `style`. */
function openWithoutModel(name: string): Database.Database {
  const db = new Database(join(work, name));
  db.exec(`CREATE TABLE message (
             id         TEXT PRIMARY KEY,
             thread_id  TEXT NOT NULL,
             seq        INTEGER NOT NULL,
             role       TEXT NOT NULL,
             kind       TEXT NOT NULL,
             mode       TEXT,
             content    TEXT,
             created_at TEXT NOT NULL
           )`);
  return db;
}

const columns = (db: Database.Database): string[] =>
  db
    .prepare<[], { name: string }>("PRAGMA table_info(message)")
    .all()
    .map((row) => row.name);

const OFFERED: ModelChoice[] = [
  { value: DEFAULT_MODEL, displayName: "Default", description: "" },
  { value: "sonnet", displayName: "Sonnet", description: "" },
];

// ── §3, the list ────────────────────────────────────────────────

test("the probe answers, in one of its two specified shapes", async () => {
  const probe = await listCapabilities(work);

  assert.ok(probe.models.length > 0, "a probe always leaves at least the default row");
  for (const model of probe.models) {
    assert.equal(typeof model.value, "string");
    assert.ok(model.value.length > 0, "a model with no value could not be sent");
    assert.equal(typeof model.displayName, "string");
    assert.equal(typeof model.description, "string");
  }

  // Spec 31 §3 — the styles come back from the same call, and `default` is
  // always among them: it is the CLI's own, and §3.3's fallback is only it.
  assert.ok(probe.styles.length > 0, "a probe always leaves at least the default style");
  for (const style of probe.styles) assert.equal(typeof style, "string");
  assert.ok(
    probe.styles.includes(DEFAULT_STYLE),
    "`default` is a style the CLI always has, and what every comment starts on",
  );

  if (probe.error === null) {
    // §3.1 — the CLI answered. Its own default row is always in the list, which
    // is what makes `DEFAULT_MODEL` a value REX can store and resolve.
    assert.ok(
      probe.models.some((model) => model.value === DEFAULT_MODEL),
      "the CLI always offers a default row",
    );
  } else {
    // §3.4 — it did not, and then there is exactly ONE row of each and no
    // invented names.
    assert.equal(probe.models.length, 1);
    assert.equal(probe.models[0].value, DEFAULT_MODEL);
    assert.deepEqual(probe.styles, [DEFAULT_STYLE]);
  }
});

test("the probe is cached — one CLI process per app run (§3.3)", async () => {
  const first = await listCapabilities(work);
  const second = await listCapabilities(work);
  assert.equal(first, second, "the same object, so the same promise, so one process");
});

// ── §6, the default ─────────────────────────────────────────────

test("a setting round-trips and overwrites", () => {
  const db = openWithSettings("setting.db");
  assert.equal(getSetting(db, MODEL_DEFAULT_KEY), null, "absent is null, not empty string");

  setSetting(db, MODEL_DEFAULT_KEY, "sonnet");
  assert.equal(getSetting(db, MODEL_DEFAULT_KEY), "sonnet");

  setSetting(db, MODEL_DEFAULT_KEY, "haiku");
  assert.equal(getSetting(db, MODEL_DEFAULT_KEY), "haiku", "the second write replaces the first");
  db.close();
});

test("no stored default means the SDK's own default", () => {
  const db = openWithSettings("unset.db");
  assert.equal(defaultModel(db, OFFERED), DEFAULT_MODEL);
  db.close();
});

test("a stored default the CLI offers is used", () => {
  const db = openWithSettings("stored.db");
  setSetting(db, MODEL_DEFAULT_KEY, "sonnet");
  assert.equal(defaultModel(db, OFFERED), "sonnet");
  db.close();
});

test("§6.2 — a stored default the CLI no longer offers falls back, and is KEPT", () => {
  const db = openWithSettings("gone.db");
  setSetting(db, MODEL_DEFAULT_KEY, "claude-fable-5[1m]");

  assert.equal(defaultModel(db, OFFERED), DEFAULT_MODEL, "it falls back rather than being sent");
  assert.equal(
    getSetting(db, MODEL_DEFAULT_KEY),
    "claude-fable-5[1m]",
    "and the row survives: the model can come back, and silently rewriting the reviewer's choice would mean they never learn it stopped being honoured",
  );

  // And it IS honoured again the moment the CLI offers it.
  const wider = [
    ...OFFERED,
    { value: "claude-fable-5[1m]", displayName: "Fable", description: "" },
  ];
  assert.equal(defaultModel(db, wider), "claude-fable-5[1m]");
  db.close();
});

// ── §5.2, the column ────────────────────────────────────────────

test("migrateMessageModel adds the column once, and is a no-op after", () => {
  const db = openWithoutModel("old.db");
  db.prepare(
    "INSERT INTO message (id, thread_id, seq, role, kind, mode, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("m1", "t1", 0, "user", "text", "ask", "the comment", "2026-08-31T00:00:00.000Z");

  assert.equal(columns(db).includes("model"), false);
  assert.equal(migrateMessageModel(db), true);
  assert.equal(columns(db).includes("model"), true);

  assert.equal(migrateMessageModel(db), false, "the second run changes nothing");
  assert.equal(migrateMessageModel(db), false);

  const rows = db.prepare<[], { id: string; model: string | null }>("SELECT * FROM message").all();
  assert.equal(rows.length, 1, "the message survived");
  assert.equal(
    rows[0].model,
    null,
    "§5 — NULL is 'nobody recorded it', and must never be drawn as the default",
  );
  db.close();
});

// ── Spec 31 §5 and §2.1, the two style columns ──────────────────

test("migrateMessageStyle adds the column once, and is a no-op after", () => {
  const db = openWithoutModel("old-style.db");
  db.prepare(
    "INSERT INTO message (id, thread_id, seq, role, kind, mode, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("m1", "t1", 0, "user", "text", "ask", "the comment", "2026-09-02T00:00:00.000Z");

  assert.equal(columns(db).includes("style"), false);
  assert.equal(migrateMessageStyle(db), true);
  assert.equal(columns(db).includes("style"), true);
  assert.equal(migrateMessageStyle(db), false, "the second run changes nothing");

  const rows = db.prepare<[], { style: string | null }>("SELECT * FROM message").all();
  assert.equal(rows.length, 1, "the message survived");
  assert.equal(rows[0].style, null, "until spec 31 no send named a style");
  db.close();
});

test("§2.1 — migrateThreadStyle adds the column the chat is remembered in", () => {
  const db = new Database(join(work, "old-thread.db"));
  db.exec(`CREATE TABLE thread (
             id          TEXT PRIMARY KEY,
             document_id TEXT NOT NULL,
             kind        TEXT NOT NULL,
             status      TEXT NOT NULL DEFAULT 'open',
             note        TEXT NOT NULL,
             created_at  TEXT NOT NULL,
             updated_at  TEXT NOT NULL
           )`);
  db.prepare(
    "INSERT INTO thread (id, document_id, kind, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    "t1",
    "d1",
    "anchored",
    "a comment",
    "2026-09-02T00:00:00.000Z",
    "2026-09-02T00:00:00.000Z",
  );

  const threadColumns = (): string[] =>
    db
      .prepare<[], { name: string }>("PRAGMA table_info(thread)")
      .all()
      .map((row) => row.name);

  assert.equal(threadColumns().includes("style"), false);
  assert.equal(migrateThreadStyle(db), true);
  assert.equal(threadColumns().includes("style"), true);
  assert.equal(migrateThreadStyle(db), false, "the second run changes nothing");

  const rows = db.prepare<[], { style: string | null }>("SELECT * FROM thread").all();
  assert.equal(rows.length, 1, "the comment survived");
  assert.equal(
    rows[0].style,
    null,
    "NULL is the CLI's own default — what every comment made before spec 31 was answered under",
  );
  db.close();
});

// ── Spec 25 §6.4 — naming a model row ───────────────────────────
//
// The rows below are the CLI's real answer on 2026-09-03, copied from the
// probe. Two of them are called `Fable` and BOTH describe themselves as
// "Fable 5"; only the id differs. That is the case this whole section exists
// for, and a fixture invented by hand would not have contained it.

const REAL_ROWS = [
  {
    value: "default",
    resolvedModel: "claude-opus-5[1m]",
    displayName: "Default (recommended)",
    description: "Opus 5 with 1M context",
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5 with 1M context",
  },
  {
    value: "claude-fable-5[1m]",
    resolvedModel: "claude-fable-5",
    displayName: "Fable",
    description: "Fable 5 · Most capable",
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5 · Most capable",
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5",
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5",
  },
];

const nameOf = (value: string): string =>
  nameModels(REAL_ROWS).find((row) => row.value === value)?.displayName ?? "(missing)";

test("§6.4 — the two Fable rows are told apart, by version", () => {
  assert.equal(nameOf("claude-fable-5[1m]"), "Fable 5 (1M)");
  assert.equal(nameOf("claude-fable-5-1[1m]"), "Fable 5.1 (1M)");
});

test("§6.4 — the version comes from the id, and the context from either id", () => {
  // `sonnet` carries no version; `claude-sonnet-5` does.
  assert.equal(nameOf("sonnet"), "Sonnet 5");
  // `[1m]` is on `value` here and not on `resolvedModel`, and vice versa above.
  assert.equal(nameOf("opus[1m]"), "Opus 5 (1M)");
});

test("§6.4 — a dated snapshot is a snapshot, not a version", () => {
  assert.equal(nameOf("haiku"), "Haiku 4.5", "the 8-digit date is not part of the name");
});

test("§6.4 — `default` keeps the CLI's own name", () => {
  // What it resolves to today is not what it MEANS, so naming it by today's
  // answer would be wrong the day the CLI's default moves.
  assert.equal(nameOf("default"), "Default (recommended)");
});

test("§6.4 — an id REX cannot parse keeps the CLI's name", () => {
  const rows = [
    { value: "something-new", displayName: "Something", description: "d" },
    { value: "claude-x", resolvedModel: "claude-x", displayName: "X", description: "d" },
  ];
  assert.deepEqual(
    nameModels(rows).map((row) => row.displayName),
    ["Something", "X"],
    "nothing is invented for a naming scheme REX has not seen",
  );
});

test("§6.4 — two rows that would still read the same are named apart by id", () => {
  // An alias and the explicit id it points at. Both parse to the same name, so
  // the parser alone cannot separate them — which is the case this guarantee
  // exists for, and one the CLI is a single release away from listing: it
  // already offers `opus[1m]`, and `claude-opus-5[1m]` beside it would collide.
  const rows = [
    { value: "thing[1m]", resolvedModel: "claude-thing-9", displayName: "Thing", description: "d" },
    {
      value: "claude-thing-9[1m]",
      resolvedModel: "claude-thing-9",
      displayName: "Thing",
      description: "d",
    },
  ];
  const names = nameModels(rows).map((row) => row.displayName);
  assert.deepEqual(names, ["Thing 9 (1M) · thing[1m]", "Thing 9 (1M) · claude-thing-9[1m]"]);
  // The guarantee that does not depend on the parser being right about the
  // future: `value` is the CLI's own key, so it is unique by construction.
  assert.equal(new Set(names).size, 2, "no two rows in the menu may read the same");
});

test("§6.4 — the wire id is always in the description", () => {
  const row = nameModels(REAL_ROWS).find((one) => one.value === "claude-fable-5-1[1m]");
  assert.match(
    row?.description ?? "",
    /claude-fable-5-1$/,
    "the CLI's own sentence said 'Fable 5' for both Fable rows, so the tooltip needs something that cannot be stale",
  );
});
