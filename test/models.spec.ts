// Spec 25, spec 31 and spec 58, milestone 0 — the lists, the setting and the columns.
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
// Spec 42 §9.4 moved the probe itself into the agent library and left the CACHE
// here, because the library holds no state that outlives a run. So this suite
// now starts a Python child, and the "could not be asked" branch it always had
// covers one more way of not being asked: no `uv sync` yet. The naming rules the
// probe's rows go through moved with it — they are `agent-runner/tests/test_models.py`.
//
// Run: npm run test:models

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { listCapabilities } from "../src/main/agent/bridge.ts";
import { agentService } from "../src/main/agent/service.ts";
import {
  migrateAgentDefaults,
  migrateMessageEffort,
  migrateMessageModel,
  migrateMessageStyle,
  migrateThreadStyle,
} from "../src/main/db/migrate.ts";
import {
  AGENT_EFFORT_KEY,
  AGENT_MODEL_KEY,
  agentEffort,
  agentEffortKey,
  agentModel,
  agentModelKey,
  getSetting,
  MODEL_DEFAULT_KEY,
  setSetting,
} from "../src/main/db/settings.ts";
import {
  defaultModelLabel,
  effortFor,
  effortLevelsOf,
  effortRows,
  effortWord,
  ownEffortOf,
} from "../src/renderer/overlay/modelChoices.ts";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_STYLE,
  type ModelChoice,
} from "../src/shared/types.ts";

const work = mkdtempSync(join(tmpdir(), "rex-models-"));
after(() => rmSync(work, { recursive: true, force: true }));
// Spec 42 — the probe runs in the agent library now, which is a child process.
// Without this the test run finishes and then hangs, holding a live child.
after(() => agentService().quit());

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

// ── §6, the default — per agent since spec 60 ───────────────────

const CLAUDE_KEY = agentModelKey("claude-agent");

test("a setting round-trips and overwrites", () => {
  const db = openWithSettings("setting.db");
  assert.equal(getSetting(db, CLAUDE_KEY), null, "absent is null, not empty string");

  setSetting(db, CLAUDE_KEY, "sonnet");
  assert.equal(getSetting(db, CLAUDE_KEY), "sonnet");

  setSetting(db, CLAUDE_KEY, "haiku");
  assert.equal(getSetting(db, CLAUDE_KEY), "haiku", "the second write replaces the first");
  db.close();
});

test("spec 60 §2 — with nothing stored, Claude ships on Sonnet at Medium", () => {
  const db = openWithSettings("unset.db");
  assert.equal(agentModel(db, "claude-agent", OFFERED, false), "sonnet");
  assert.equal(agentEffort(db, "claude-agent"), "medium");
  db.close();
});

test("spec 60 §2 — the other agents ship nothing of REX's own", () => {
  const db = openWithSettings("unset-others.db");
  const codex: ModelChoice[] = [
    { value: DEFAULT_MODEL, displayName: "Default", description: "" },
    { value: "gpt-5.6-terra", displayName: "GPT-5.6-Terra", description: "" },
  ];
  assert.equal(agentModel(db, "codex", codex, false), DEFAULT_MODEL, "the CLI's own default");
  assert.equal(agentEffort(db, "codex"), DEFAULT_EFFORT);
  const typed: ModelChoice[] = [
    { value: "qwen3-coder", displayName: "qwen3-coder", description: "" },
    { value: "gpt-oss-120b", displayName: "gpt-oss-120b", description: "" },
  ];
  assert.equal(agentModel(db, "opencode", typed, true), "qwen3-coder", "a routed list's first");
  db.close();
});

test("spec 60 §4 — one agent's default is not another's", () => {
  const db = openWithSettings("per-agent.db");
  setSetting(db, agentModelKey("codex"), "gpt-5.6-terra");
  setSetting(db, agentEffortKey("codex"), "high");
  assert.equal(agentModel(db, "claude-agent", OFFERED, false), "sonnet", "Claude is untouched");
  assert.equal(agentEffort(db, "claude-agent"), "medium");
  assert.equal(agentEffort(db, "codex"), "high");
  db.close();
});

test("spec 60 §4 — a routed gateway starts on the stored model when its list holds it", () => {
  const db = openWithSettings("routed.db");
  const typed: ModelChoice[] = [
    { value: "qwen3-coder", displayName: "qwen3-coder", description: "" },
    { value: "gpt-oss-120b", displayName: "gpt-oss-120b", description: "" },
  ];
  setSetting(db, agentModelKey("opencode"), "gpt-oss-120b");
  assert.equal(agentModel(db, "opencode", typed, true), "gpt-oss-120b");
  db.close();
});

test("§6.2 — a stored default the CLI no longer offers falls back, and is KEPT", () => {
  const db = openWithSettings("gone.db");
  setSetting(db, CLAUDE_KEY, "claude-fable-5[1m]");

  assert.equal(
    agentModel(db, "claude-agent", OFFERED, false),
    "sonnet",
    "it falls back — to the shipped model — rather than being sent",
  );
  assert.equal(
    getSetting(db, CLAUDE_KEY),
    "claude-fable-5[1m]",
    "and the row survives: the model can come back, and silently rewriting the reviewer's choice would mean they never learn it stopped being honoured",
  );

  // And it IS honoured again the moment the CLI offers it.
  const wider = [
    ...OFFERED,
    { value: "claude-fable-5[1m]", displayName: "Fable", description: "" },
  ];
  assert.equal(agentModel(db, "claude-agent", wider, false), "claude-fable-5[1m]");

  // A list with neither falls back to the CLI's own default.
  const bare = [{ value: DEFAULT_MODEL, displayName: "Default", description: "" }];
  assert.equal(agentModel(db, "claude-agent", bare, false), DEFAULT_MODEL);
  db.close();
});

// ── Spec 60 §3.1 — the migration ────────────────────────────────

test("spec 60 §3.1 — the one app-wide default moves under its agent, once", () => {
  const db = openWithSettings("migrate-defaults.db");
  setSetting(db, MODEL_DEFAULT_KEY, "haiku");
  setSetting(db, AGENT_MODEL_KEY, "sonnet");
  setSetting(db, AGENT_EFFORT_KEY, "low");

  assert.deepEqual(migrateAgentDefaults(db), [CLAUDE_KEY, agentEffortKey("claude-agent")]);
  assert.equal(getSetting(db, CLAUDE_KEY), "sonnet", "spec 43's key wins over spec 25's");
  assert.equal(getSetting(db, agentEffortKey("claude-agent")), "low");
  for (const old of [MODEL_DEFAULT_KEY, AGENT_MODEL_KEY, AGENT_EFFORT_KEY]) {
    assert.equal(getSetting(db, old), null, `${old} is gone, so nothing reads two answers`);
  }
  assert.deepEqual(migrateAgentDefaults(db), [], "the second run changes nothing");
  db.close();
});

test("spec 60 §3.1 — it moves to the stored agent, and never overwrites", () => {
  const db = openWithSettings("migrate-codex.db");
  setSetting(db, "agent.sdk", "codex");
  setSetting(db, AGENT_MODEL_KEY, "gpt-5.6-luna");
  setSetting(db, agentEffortKey("codex"), "high");
  setSetting(db, AGENT_EFFORT_KEY, "low");

  assert.deepEqual(migrateAgentDefaults(db), [agentModelKey("codex")]);
  assert.equal(getSetting(db, agentModelKey("codex")), "gpt-5.6-luna");
  assert.equal(getSetting(db, agentEffortKey("codex")), "high", "a key already there wins");
  assert.equal(getSetting(db, AGENT_EFFORT_KEY), null);
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

// ── Spec 58 — the effort ────────────────────────────────────────

const LEVELS = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_ROWS: ModelChoice[] = [
  { value: "sonnet", displayName: "Sonnet 5.5", description: "", effortLevels: LEVELS },
  {
    value: "claude-opus-4-6",
    displayName: "Opus 4.6",
    description: "",
    effortLevels: ["low", "medium", "high", "max"],
  },
  { value: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", description: "" },
];

test("§3 — the probe's rows carry the levels the CLI offers", async () => {
  const probe = await listCapabilities(work);
  // The "could not be asked" shape has one row and no levels, which is right:
  // a route REX could not ask has none it knows of.
  if (probe.error !== null) return;
  assert.ok(
    probe.models.some((model) => model.effortLevels.length > 0),
    "a CLI that answered offers levels on at least its own default row",
  );
});

test("§3 — a model's levels are its row's, and none for a row with none", () => {
  assert.deepEqual(effortLevelsOf(EFFORT_ROWS, "sonnet"), LEVELS);
  assert.deepEqual(effortLevelsOf(EFFORT_ROWS, "claude-haiku-4-5-20251001"), []);
  assert.deepEqual(effortLevelsOf(EFFORT_ROWS, "not-offered"), []);
});

test("§6.2 — a level the model does not take becomes `default`, never a guess", () => {
  const opus46 = effortLevelsOf(EFFORT_ROWS, "claude-opus-4-6");
  assert.equal(effortFor(LEVELS, "medium"), "medium");
  assert.equal(effortFor(opus46, "xhigh"), DEFAULT_EFFORT, "Opus 4.6 has no xhigh");
  assert.equal(effortFor(opus46, DEFAULT_EFFORT), DEFAULT_EFFORT);
  assert.equal(effortFor([], "medium"), null, "a model with no levels is sent none");
});

test("§7.1 — the menu is `Default effort`, then the levels in the CLI's order", () => {
  const rows = effortRows(["low", "medium", "xhigh", "brand-new"]);
  assert.deepEqual(
    rows.map((row) => row.displayName),
    ["Default effort", "Low", "Medium", "Extra high", "brand-new"],
  );
  assert.equal(rows[0].value, DEFAULT_EFFORT);
  assert.ok(
    rows.every((row) => row.description.length > 0),
    "a level the CLI adds later still gets a tooltip",
  );
});

test("§7.1 — `Default effort` names the model's own level when the SDK said it", () => {
  // The reviewer's report of 2026-10-17: "I don't know what the default effort is."
  const rows: ModelChoice[] = [
    { ...EFFORT_ROWS[0], defaultEffort: "medium" },
    { ...EFFORT_ROWS[1], defaultEffort: null },
  ];
  assert.equal(ownEffortOf(rows, "sonnet"), "medium");
  assert.equal(ownEffortOf(rows, "claude-opus-4-6"), null);
  assert.equal(ownEffortOf(rows, "not-offered"), null);
  assert.equal(effortRows(LEVELS, "medium")[0].displayName, "Default effort (Medium)");
  assert.equal(effortRows(LEVELS, "xhigh")[0].displayName, "Default effort (Extra high)");
  assert.equal(effortRows(LEVELS, null)[0].displayName, "Default effort", "unknown is not guessed");
  assert.equal(
    effortRows(LEVELS, "medium")[2].displayName,
    "Medium",
    "only the default row changes",
  );
});

test("§7.1 — the model menu's default row says which model it is", () => {
  const rows: ModelChoice[] = [
    {
      value: DEFAULT_MODEL,
      displayName: "Recommended (Fable 5.1)",
      description: "",
      resolvesTo: "Fable 5.1",
    },
    { value: "sonnet", displayName: "Sonnet 5.5", description: "", resolvesTo: null },
  ];
  assert.equal(defaultModelLabel(rows, "sonnet"), "Default (Sonnet 5.5)");
  assert.equal(
    defaultModelLabel(rows, DEFAULT_MODEL),
    "Default (Fable 5.1, recommended)",
    "the SDK's own choice is named by what it stands for, not nested in brackets",
  );
  assert.equal(defaultModelLabel(rows, "gone-model"), "Default (gone-model)");
});

test("§7.2 — the foot writes a chosen level, and nothing for `default` or none", () => {
  assert.equal(effortWord("medium"), "medium");
  assert.equal(effortWord("xhigh"), "extra high");
  assert.equal(effortWord(DEFAULT_EFFORT), null);
  assert.equal(effortWord(null), null);
});

test("§5 — migrateMessageEffort adds the column once, and is a no-op after", () => {
  const db = openWithoutModel("old-effort.db");
  db.prepare(
    "INSERT INTO message (id, thread_id, seq, role, kind, mode, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("m1", "t1", 0, "user", "text", "ask", "the comment", "2026-10-17T00:00:00.000Z");

  assert.equal(columns(db).includes("effort"), false);
  assert.equal(migrateMessageEffort(db), true);
  assert.equal(columns(db).includes("effort"), true);
  assert.equal(migrateMessageEffort(db), false, "the second run changes nothing");

  const rows = db.prepare<[], { effort: string | null }>("SELECT * FROM message").all();
  assert.equal(rows.length, 1, "the message survived");
  assert.equal(rows[0].effort, null, "until spec 58 no send named a level");
  db.close();
});

test("§6 — a stored effort comes back unchecked, for the renderer to check per model", () => {
  const db = openWithSettings("effort-default.db");
  setSetting(db, agentEffortKey("claude-agent"), "xhigh");
  assert.equal(agentEffort(db, "claude-agent"), "xhigh", "even a level some models lack");
  db.close();
});
