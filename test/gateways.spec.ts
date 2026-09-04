// Spec 43 milestone 1 — gateways, sessions and the record.
//
// Four things this suite exists to prove, and each is a claim the reviewer made
// on 2026-09-03 that the code has to keep:
//
//   * **Editing a gateway changes no message.** §5.3 — the evidence is a copy,
//     so re-pointing a gateway at another host cannot rewrite what an old answer
//     says. This is why there is no revisioning and no retirement.
//   * **A row that cannot run cannot be created**, by any route. §2.2's two
//     CHECK constraints are in the table and not only in the validator, because
//     `sqlite3 ~/.rex/rex.db` is a route.
//   * **A session belongs to one (thread, SDK, gateway)**, and a gateway whose
//     URL moved starts a fresh one — §5.2 case 2b, which is the one failure the
//     whole session model exists to prevent.
//   * **With only `Original`, nothing about REX changed.** §13 criterion 17.
//
// Against a real SQLite file, not a mock: what is being asserted is what SQLite
// does with a CHECK, a cascade and `ON CONFLICT`.
//
// Run: npm run test:gateways

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import {
  deleteGateway,
  getGateway,
  getThreadSession,
  joinModels,
  listGateways,
  listThreadSessions,
  ORIGINAL_GATEWAY_ID,
  parseModels,
  saveGateway,
  setThreadSession,
} from "../src/main/db/gateways.ts";
import {
  migrateGateways,
  migrateMessageRoute,
  migrateThreadSessions,
} from "../src/main/db/migrate.ts";
import {
  baseUrlProblem,
  buildRoutes,
  recoverValues,
  validateGateway,
} from "../src/shared/gateways.ts";

const work = mkdtempSync(join(tmpdir(), "rex-gateways-"));
after(() => rmSync(work, { recursive: true, force: true }));

let made = 0;

/**
 * A database shaped like one made before spec 43: a `thread` with a
 * `session_id`, and a `message` with spec 25's and spec 31's columns and none
 * of this spec's.
 */
function openLegacy(): Database.Database {
  made += 1;
  const db = new Database(join(work, `gw-${made}.db`));
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE thread (
      id          TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      note        TEXT NOT NULL,
      session_id  TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE message (
      id        TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      seq       INTEGER NOT NULL,
      role      TEXT NOT NULL,
      kind      TEXT NOT NULL,
      mode      TEXT,
      model     TEXT,
      style     TEXT,
      content   TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE thread_session (
      thread_id   TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      sdk         TEXT NOT NULL,
      gateway_id  TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
      base_url    TEXT,
      session_id  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (thread_id, sdk, gateway_id)
    );
  `);
  return db;
}

/** The migration, in `database.ts`'s own order. */
function migrate(db: Database.Database): void {
  migrateGateways(db);
  migrateThreadSessions(db);
  migrateMessageRoute(db);
}

function seedThread(db: Database.Database, id: string, sessionId: string | null): void {
  db.prepare(
    `INSERT INTO thread (id, document_id, kind, status, note, session_id, created_at, updated_at)
     VALUES (?, 'd1', 'anchored', 'open', 'a note', ?, '2026-09-01', '2026-09-01')`,
  ).run(id, sessionId);
}

function seedMessage(
  db: Database.Database,
  id: string,
  threadId: string,
  mode: string | null,
): void {
  db.prepare(
    `INSERT INTO message (id, thread_id, seq, role, kind, mode, model, style, content, created_at)
     VALUES (?, ?, 0, 'assistant', 'text', ?, 'sonnet', 'default', 'said something', '2026-09-01')`,
  ).run(id, threadId, mode);
}

// ── §12 — the migration ─────────────────────────────────────────

test("the migration creates Original with a route for every SDK", () => {
  const db = openLegacy();
  assert.equal(migrateGateways(db), true);

  const original = getGateway(db, ORIGINAL_GATEWAY_ID);
  assert.ok(original);
  assert.equal(original.kind, "original");
  assert.equal(original.name, "Original");
  // Every SDK, so specs 44 to 46 add an adapter and no migration.
  assert.deepEqual(Object.keys(original.routes).sort(), [
    "claude-agent",
    "codex",
    "deep-agents",
    "opencode",
  ]);
  // §2.5 — no base URL on any of them: each uses its own official endpoint.
  for (const route of Object.values(original.routes)) {
    assert.equal(route?.baseUrl, null);
    assert.equal(route?.auth, "inherit");
  }
});

test("every migration step run twice changes nothing the second time", () => {
  const db = openLegacy();
  seedThread(db, "t1", "1111-1111");
  seedMessage(db, "m1", "t1", "ask");

  migrate(db);
  const gatewaysOnce = listGateways(db);
  const sessionsOnce = listThreadSessions(db, "t1");
  const messagesOnce = db.prepare("SELECT * FROM message ORDER BY id").all();

  // The second run is the one that matters: this executes on every open.
  assert.equal(migrateGateways(db), false);
  assert.equal(migrateThreadSessions(db), 0);
  assert.equal(migrateMessageRoute(db), 0);

  assert.deepEqual(listGateways(db), gatewaysOnce);
  assert.deepEqual(listThreadSessions(db, "t1"), sessionsOnce);
  assert.deepEqual(db.prepare("SELECT * FROM message ORDER BY id").all(), messagesOnce);
});

test("an existing session becomes a row keyed to Claude and Original", () => {
  const db = openLegacy();
  seedThread(db, "t1", "1111-1111");
  seedThread(db, "t2", null);
  migrate(db);

  const moved = getThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID);
  assert.deepEqual(moved, { sessionId: "1111-1111", baseUrl: null });
  // A comment that never ran has no session to move, and gets no row.
  assert.equal(getThreadSession(db, "t2", "claude-agent", ORIGINAL_GATEWAY_ID), null);
});

test("existing messages are stamped, and a NOTE is left alone", () => {
  const db = openLegacy();
  seedThread(db, "t1", null);
  seedMessage(db, "m1", "t1", "ask");
  seedMessage(db, "m2", "t1", "note");
  migrate(db);

  const rows = db
    .prepare<
      [],
      { id: string; sdk: string | null; gateway_name: string | null; base_url: string | null }
    >("SELECT id, sdk, gateway_name, base_url FROM message ORDER BY id")
    .all();
  // Every message in an existing database really WAS produced by the Claude
  // Agent SDK through Original. Writing that down is a fact, not a guess.
  assert.deepEqual(rows[0], {
    id: "m1",
    sdk: "claude-agent",
    gateway_name: "Original",
    base_url: null,
  });
  // §5.4 — a NOTE ran nothing, so it names no agent and no gateway.
  assert.deepEqual(rows[1], { id: "m2", sdk: null, gateway_name: null, base_url: null });
});

// ── §2.2 — the two CHECK constraints ────────────────────────────

test("a route with no authentication and no URL cannot be stored", () => {
  const db = openLegacy();
  migrateGateways(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
           VALUES (?, 'claude-agent', NULL, 'none', NULL, '')`,
        )
        .run("rex-original"),
    /CHECK constraint failed/,
  );
});

test("an environment route with no variable, and any other route with one, are refused", () => {
  const db = openLegacy();
  migrateGateways(db);
  const insert = db.prepare(
    `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
     VALUES ('rex-original', ?, 'http://localhost:24000', ?, ?, '')`,
  );
  assert.throws(() => insert.run("codex", "environment", null), /CHECK constraint failed/);
  assert.throws(() => insert.run("codex", "inherit", "SOME_KEY"), /CHECK constraint failed/);
});

// ── §2.5 — Original cannot be edited or deleted ─────────────────

test("Original refuses to be edited or deleted, by any caller", () => {
  const db = openLegacy();
  migrateGateways(db);
  assert.throws(
    () =>
      saveGateway(db, {
        id: ORIGINAL_GATEWAY_ID,
        name: "Something else",
        kind: "original",
        routes: {},
      }),
    /cannot be edited/,
  );
  assert.throws(() => deleteGateway(db, ORIGINAL_GATEWAY_ID), /cannot be deleted/);
  assert.equal(getGateway(db, ORIGINAL_GATEWAY_ID)?.name, "Original");
});

// ── §2.2 — models are a list, and a list of nothing is empty ────

test("a model list survives a round trip, and blank lines are not models", () => {
  assert.deepEqual(parseModels("unsloth-26b\n  lms-4b  \n\n"), ["unsloth-26b", "lms-4b"]);
  assert.equal(joinModels(["unsloth-26b", "", "  ", "lms-4b"]), "unsloth-26b\nlms-4b");
  assert.deepEqual(parseModels(joinModels([])), []);
});

test("a saved gateway keeps its routes and its models", () => {
  const db = openLegacy();
  migrateGateways(db);
  const saved = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: ["unsloth-26b", "lms-4b"],
      },
    },
  });
  assert.deepEqual(saved.routes["claude-agent"], {
    baseUrl: "http://localhost:24000",
    auth: "environment",
    credentialEnv: "AI_GATEWAY_KEY",
    models: ["unsloth-26b", "lms-4b"],
  });
  // Original is still first, because it must stay one click away (§2.5).
  assert.equal(listGateways(db)[0]?.id, ORIGINAL_GATEWAY_ID);
});

test("saving replaces the routes rather than merging them", () => {
  const db = openLegacy();
  migrateGateways(db);
  const first = saveGateway(db, {
    name: "Custom",
    kind: "custom",
    routes: {
      "claude-agent": { baseUrl: "http://a", auth: "inherit", credentialEnv: null, models: [] },
      codex: { baseUrl: "http://b", auth: "inherit", credentialEnv: null, models: [] },
    },
  });
  const second = saveGateway(db, {
    id: first.id,
    name: "Custom",
    kind: "custom",
    routes: {
      "claude-agent": { baseUrl: "http://a", auth: "inherit", credentialEnv: null, models: [] },
    },
  });
  // A merge would leave `codex` behind after the reviewer removed its URL.
  assert.deepEqual(Object.keys(second.routes), ["claude-agent"]);
});

// ── §5.3 — history is independent of these rows ─────────────────

test("editing, renaming and deleting a gateway changes no message", () => {
  const db = openLegacy();
  migrateGateways(db);
  seedThread(db, "t1", null);
  migrateMessageRoute(db);

  const gateway = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });

  // One answer, with its evidence copied onto the row exactly as `ipc.ts`
  // stamps it.
  db.prepare(
    `INSERT INTO message (id, thread_id, seq, role, kind, mode, model, style, sdk, gateway_name, base_url, content, created_at)
     VALUES ('m1', 't1', 0, 'assistant', 'text', NULL, 'unsloth-26b', 'default',
             'claude-agent', 'LiteLLM', 'http://localhost:24000', 'answered', '2026-09-04')`,
  ).run();

  const evidence = () =>
    db
      .prepare<[], { model: string; sdk: string; gateway_name: string; base_url: string }>(
        "SELECT model, sdk, gateway_name, base_url FROM message WHERE id = 'm1'",
      )
      .get();
  const before = evidence();

  // Re-point it at another host, rename it, then remove it altogether.
  saveGateway(db, {
    id: gateway.id,
    name: "Somewhere else",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:9999",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });
  assert.deepEqual(evidence(), before, "a re-pointed gateway rewrote history");

  deleteGateway(db, gateway.id);
  assert.deepEqual(evidence(), before, "a deleted gateway rewrote history");
  // The answer is still there at all, which is the other half of the claim.
  assert.equal(before?.gateway_name, "LiteLLM");
});

test("deleting a gateway takes its sessions and leaves every other one", () => {
  const db = openLegacy();
  migrateGateways(db);
  seedThread(db, "t1", null);
  const gateway = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });

  setThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID, {
    sessionId: "aaaa",
    baseUrl: null,
  });
  setThreadSession(db, "t1", "claude-agent", gateway.id, {
    sessionId: "bbbb",
    baseUrl: "http://localhost:24000",
  });
  assert.equal(listThreadSessions(db, "t1").length, 2);

  deleteGateway(db, gateway.id);
  const left = listThreadSessions(db, "t1");
  assert.equal(left.length, 1);
  assert.equal(left[0]?.sessionId, "aaaa");
});

// ── §5.2 — one session per combination ──────────────────────────

test("each combination keeps its own session, and one does not disturb another", () => {
  const db = openLegacy();
  migrateGateways(db);
  seedThread(db, "t1", null);
  const gateway = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });

  setThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID, {
    sessionId: "aaaa",
    baseUrl: null,
  });
  setThreadSession(db, "t1", "claude-agent", gateway.id, {
    sessionId: "bbbb",
    baseUrl: "http://localhost:24000",
  });
  // Continuing one must not move the other.
  setThreadSession(db, "t1", "claude-agent", gateway.id, {
    sessionId: "cccc",
    baseUrl: "http://localhost:24000",
  });

  assert.equal(getThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID)?.sessionId, "aaaa");
  assert.equal(getThreadSession(db, "t1", "claude-agent", gateway.id)?.sessionId, "cccc");
});

test("a second combination never reuses the first one's session id", () => {
  // §5.2 case 3, and the reason it is not simply `sessionIdFor(threadId)`.
  //
  // The deterministic id belongs to a comment's FIRST session, so the debug
  // report can predict it before anything runs. Handing the SAME id to a second
  // combination asks the CLI to seed an id it already has, and it refuses the
  // whole run — measured 2026-09-04, driving a comment through LiteLLM and then
  // continuing it on `Original`: "Command failed with exit code 1", 173 ms,
  // nothing sent and no answer.
  const db = openLegacy();
  migrateGateways(db);
  seedThread(db, "t1", null);
  const gateway = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });

  // The first send, on any combination, takes the deterministic id.
  setThreadSession(db, "t1", "claude-agent", gateway.id, {
    sessionId: "deterministic-id",
    baseUrl: "http://localhost:24000",
  });

  // The second combination has no row of its own, which is what sends
  // `planSession` down case 3 — and case 3 asks the SDK whether it already
  // holds the deterministic id rather than trusting these rows, because the
  // SDK's transcript files outlive them: deleting a gateway cascades its
  // sessions away and leaves the file behind, and seeding that id again is the
  // same "already in use" refusal by another route.
  assert.equal(getThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID), null);
  assert.equal(listThreadSessions(db, "t1").length, 1);

  // Deleting the gateway takes the row and cannot take the SDK's file, which is
  // exactly the state that made REX seed a used id on 2026-09-04.
  deleteGateway(db, gateway.id);
  assert.equal(listThreadSessions(db, "t1").length, 0);
});

test("the URL a session was created against is on the row — §5.2 case 2b", () => {
  const db = openLegacy();
  migrateGateways(db);
  seedThread(db, "t1", null);
  const gateway = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });
  setThreadSession(db, "t1", "claude-agent", gateway.id, {
    sessionId: "bbbb",
    baseUrl: "http://localhost:24000",
  });

  // The reviewer edits the host. The stored session now names a server that
  // has never seen this conversation, and comparing the two URLs is the ONLY
  // way to know — which is why the URL is on the session row and not merely on
  // the gateway.
  const moved = saveGateway(db, {
    id: gateway.id,
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:26000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });
  const stored = getThreadSession(db, "t1", "claude-agent", gateway.id);
  assert.equal(stored?.baseUrl, "http://localhost:24000");
  assert.notEqual(stored?.baseUrl, moved.routes["claude-agent"]?.baseUrl);
});

// ── §3.1 — every URL refusal ────────────────────────────────────

test("a gateway URL must be an absolute http or https address and nothing more", () => {
  assert.equal(baseUrlProblem("http://localhost:24000"), null);
  assert.equal(baseUrlProblem("https://gw.example.com/anthropic"), null);
  // A trailing slash is trimmed rather than refused: it is the same address.
  assert.equal(baseUrlProblem("http://localhost:24000/"), null);

  assert.match(baseUrlProblem("") ?? "", /cannot be empty/);
  assert.match(baseUrlProblem("localhost:24000") ?? "", /http:\/\/ or https:\/\//);
  assert.match(baseUrlProblem("ftp://localhost") ?? "", /http:\/\/ or https:\/\//);
  assert.match(baseUrlProblem("http://user:pw@localhost") ?? "", /username or a password/);
  assert.match(baseUrlProblem("http://localhost?key=1") ?? "", /query or a fragment/);
  assert.match(baseUrlProblem("http://localhost#top") ?? "", /query or a fragment/);
});

test("no kind ever appends a path REX was not told to append", () => {
  // §3 — the SDK appends `/v1/messages` itself, so a Claude base ending in
  // `/v1` produces `/v1/v1/messages` and a 404 that explains nothing.
  const litellm = buildRoutes("litellm", { url: "http://localhost:24000" });
  assert.equal(litellm["claude-agent"]?.baseUrl, "http://localhost:24000");
  const envoy = buildRoutes("envoy", { url: "http://localhost:26000" });
  assert.equal(envoy["claude-agent"]?.baseUrl, "http://localhost:26000/anthropic");
});

test("a gateway that would offer nothing is refused before it can be saved", () => {
  assert.deepEqual(
    validateGateway("custom", {}).map((error) => error.key),
    ["kind"],
  );
  assert.deepEqual(
    validateGateway("litellm", {}).map((error) => error.key),
    ["url"],
  );
  assert.deepEqual(validateGateway("litellm", { url: "http://localhost:24000" }), []);
});

// ── §4.5 — a saved gateway can be edited ────────────────────────

test("the answers that built a gateway are recovered from its routes", () => {
  // A saved row stores routes, not the host that produced them. Without this a
  // reviewer reopening a gateway had nothing to edit — reported 2026-09-04.
  for (const [kind, values] of [
    ["litellm", { url: "http://localhost:24000" }],
    ["envoy", { url: "http://localhost:26334" }],
    ["custom", { claudeUrl: "http://localhost:9999" }],
  ] as const) {
    const routes = buildRoutes(kind, values);
    const back = recoverValues(kind, routes);
    assert.ok(back, `${kind} was not recovered`);
    // Not "the same object" — the same ROUTES, which is what matters.
    assert.deepEqual(buildRoutes(kind, back), routes, kind);
    assert.equal(back.url ?? back.claudeUrl, Object.values(values)[0]);
  }
});

test("a non-default prefix comes back too", () => {
  const values = { url: "http://localhost:26334", anthropicPrefix: "/claude" };
  const routes = buildRoutes("envoy", values);
  const back = recoverValues("envoy", routes);
  assert.ok(back);
  assert.equal(back.url, "http://localhost:26334");
  assert.equal(back.anthropicPrefix, "/claude");
});

test("a hand-edited route claims no answers at all", () => {
  // §4.5 — "the catalogue is a starting point, not a lock". A route somebody
  // retyped is no longer something a host and a prefix describe, so nothing is
  // claimed and the caller keeps showing what was stored. Guessing here would
  // silently rewrite the reviewer's own edit on the next Save.
  const routes = buildRoutes("envoy", { url: "http://localhost:26334" });
  const meddled = {
    ...routes,
    codex: { ...routes.codex, baseUrl: "http://somewhere-else:9000/v1" },
  } as typeof routes;
  assert.equal(recoverValues("envoy", meddled), null);
});

test("a kind nobody declared recovers nothing", () => {
  assert.equal(recoverValues("invented", {}), null);
});

// ── §13 criterion 17 — with only Original, nothing changed ──────

test("with only Original configured, every route is the SDK's own endpoint", () => {
  const db = openLegacy();
  seedThread(db, "t1", "1111-1111");
  seedMessage(db, "m1", "t1", "ask");
  migrate(db);

  assert.deepEqual(
    listGateways(db).map((gateway) => gateway.id),
    [ORIGINAL_GATEWAY_ID],
  );
  const route = getGateway(db, ORIGINAL_GATEWAY_ID)?.routes["claude-agent"];
  // No URL, no credential, nothing REX supplies: today's behaviour exactly.
  assert.equal(route?.baseUrl, null);
  assert.equal(route?.auth, "inherit");
  assert.equal(route?.credentialEnv, null);
  // And the one session the database had is still resumable, under the one
  // combination it can belong to.
  assert.equal(
    getThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID)?.sessionId,
    "1111-1111",
  );
});
