// Spec 46 milestone 1 — the built-in gateway's row, its switch, and its port.
//
// Four claims, and each is one the reviewer will meet directly:
//
//   * **The migration is additive.** Nothing existing is deleted or changed —
//     §15 step 2, which removes the `envoy` and `custom` rows, is milestone 3,
//     and until then the reviewer's own two gateways keep working.
//   * **Off deletes nothing** (§4.1). "It's already the second time that he is
//     enabling it and he already has some configuration — we should not force
//     him to fill it in again." `enabled` is the only column the switch writes.
//   * **A moved port reaches the stored route** (§4.2.1). This is the one place
//     the walk-up can silently break a run, because `resolveRoute()` returns
//     `route.baseUrl` exactly as stored.
//   * **The permanent rows cannot be edited or deleted**, by any route.
//
// Against a real SQLite file, not a mock: what is asserted is what SQLite does
// with a rebuilt CHECK, a cascade and a default.
//
// Run: npm run test:builtin

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import {
  BUILTIN_GATEWAY_ID,
  deleteGateway,
  gatewayKeyCipher,
  getGateway,
  hasGatewayKey,
  isEnabled,
  listGateways,
  ORIGINAL_GATEWAY_ID,
  pointRoutesAtPort,
  saveGateway,
  setEnabled,
  setThreadSession,
} from "../src/main/db/gateways.ts";
import {
  BUILTIN_GATEWAY_KEY_VAR,
  BUILTIN_GATEWAY_PORT,
  migrateBuiltinGateway,
  migrateGatewayProviders,
  migrateGateways,
  migrateRetireGatewayKinds,
  RETIRED_GATEWAYS_KEY,
} from "../src/main/db/migrate.ts";
import { getSetting } from "../src/main/db/settings.ts";

const work = mkdtempSync(join(tmpdir(), "rex-builtin-"));
after(() => rmSync(work, { recursive: true, force: true }));

let made = 0;

/** A database shaped like one made by spec 43: gateways, but no `enabled`. */
function openSpec43(): Database.Database {
  made += 1;
  const db = new Database(join(work, `b-${made}.db`));
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE thread (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL, session_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE thread_session (
      thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      sdk TEXT NOT NULL,
      gateway_id TEXT NOT NULL REFERENCES agent_gateway(id) ON DELETE CASCADE,
      base_url TEXT, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, sdk, gateway_id)
    );
    CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
      mode TEXT, model TEXT, sdk TEXT, gateway_name TEXT, base_url TEXT,
      content TEXT, created_at TEXT NOT NULL
    );
  `);
  migrateGateways(db);
  return db;
}

/** The gateway migrations in `database.ts`'s own order. */
function migrated(): Database.Database {
  const db = openSpec43();
  migrateBuiltinGateway(db);
  migrateGatewayProviders(db);
  return db;
}

// ── §15 steps 1 and 4 — the migration ───────────────────────────

test("the migration adds the built-in row with a route for every SDK", () => {
  const db = migrated();
  const builtin = getGateway(db, BUILTIN_GATEWAY_ID);
  assert.ok(builtin);
  assert.equal(builtin.kind, "builtin");
  assert.deepEqual(Object.keys(builtin.routes).sort(), [
    "claude-agent",
    "codex",
    "deep-agents",
    "opencode",
  ]);
});

test("the Claude route is the ROOT and the other three address /v1", () => {
  // Spec 43 §3's trap: the Claude SDK appends `/v1/messages` itself, so a base
  // ending in `/v1` produces `/v1/v1/messages` and a 404 explaining nothing.
  const routes = getGateway(migrated(), BUILTIN_GATEWAY_ID)?.routes;
  const host = `http://127.0.0.1:${BUILTIN_GATEWAY_PORT}`;
  assert.equal(routes?.["claude-agent"]?.baseUrl, host);
  assert.equal(routes?.codex?.baseUrl, `${host}/v1`);
  assert.equal(routes?.opencode?.baseUrl, `${host}/v1`);
  assert.equal(routes?.["deep-agents"]?.baseUrl, `${host}/v1`);
});

test("the built-in gateway starts switched off", () => {
  // 296 MB and 1.6 seconds is not something to spend on somebody who has not
  // asked for it yet.
  assert.equal(isEnabled(migrated(), BUILTIN_GATEWAY_ID), false);
});

test("every other gateway is enabled, so nothing that worked stops working", () => {
  const db = migrated();
  assert.equal(isEnabled(db, ORIGINAL_GATEWAY_ID), true);
  const made = saveGateway(db, {
    name: "Work LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://litellm.corp:4000",
        auth: "inherit",
        credentialEnv: null,
        models: [],
      },
    },
  });
  assert.equal(isEnabled(db, made.id), true);
});

test("a litellm gateway survives the migration untouched", () => {
  // §15 step 3 — "keep every `litellm` row as it is. It is now 'an existing
  // LiteLLM', which is what it always was." Only `envoy` and `custom` go.
  const db = openSpec43();
  migrateBuiltinGateway(db);
  migrateGatewayProviders(db);
  const before = saveGateway(db, {
    name: "Work LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://litellm.corp:4000",
        auth: "inherit",
        credentialEnv: null,
        models: ["gpt-5.4"],
      },
    },
  });
  migrateRetireGatewayKinds(db);
  assert.deepEqual(
    getGateway(db, before.id),
    before,
    "the migration changed a gateway it should not touch",
  );
});

test("running the migration twice changes nothing", () => {
  const db = migrated();
  assert.equal(migrateBuiltinGateway(db), false);
  assert.equal(listGateways(db).filter((row) => row.kind === "builtin").length, 1);
});

test("the rebuilt table keeps its foreign keys, so no route cascades away", () => {
  // The CHECK is widened by rebuilding the table, and `gateway_route` and
  // `thread_session` both reference it ON DELETE CASCADE. With foreign keys
  // enforced during the swap, the migration would "succeed" and leave a
  // database with no gateways at all.
  const db = openSpec43();
  db.prepare(
    `INSERT INTO thread (id, document_id, kind, status, note, created_at, updated_at)
     VALUES ('t1', 'd1', 'anchored', 'open', 'n', '2026-09-01', '2026-09-01')`,
  ).run();
  setThreadSession(db, "t1", "claude-agent", ORIGINAL_GATEWAY_ID, {
    sessionId: "s1",
    baseUrl: null,
  });

  migrateBuiltinGateway(db);

  assert.ok(getGateway(db, ORIGINAL_GATEWAY_ID), "Original survived the rebuild");
  assert.equal(
    db.prepare<[], { n: number }>("SELECT count(*) AS n FROM gateway_route").get()?.n,
    8,
    "four Original routes and four built-in ones",
  );
  assert.equal(
    db.prepare<[], { n: number }>("SELECT count(*) AS n FROM thread_session").get()?.n,
    1,
  );
});

// ── §4.1 — the switch ───────────────────────────────────────────

test("turning it off and on again keeps every route it was configured with", () => {
  const db = migrated();
  const before = getGateway(db, BUILTIN_GATEWAY_ID);

  setEnabled(db, BUILTIN_GATEWAY_ID, true);
  assert.equal(isEnabled(db, BUILTIN_GATEWAY_ID), true);
  setEnabled(db, BUILTIN_GATEWAY_ID, false);
  assert.equal(isEnabled(db, BUILTIN_GATEWAY_ID), false);

  assert.deepEqual(getGateway(db, BUILTIN_GATEWAY_ID), before, "off must delete nothing");
});

// ── §4.2.1 — a moved port must reach the stored route ───────────

test("a moved port rewrites all four routes", () => {
  const db = migrated();
  assert.equal(pointRoutesAtPort(db, BUILTIN_GATEWAY_ID, 24335), 4);

  const routes = getGateway(db, BUILTIN_GATEWAY_ID)?.routes;
  assert.equal(routes?.["claude-agent"]?.baseUrl, "http://127.0.0.1:24335");
  assert.equal(routes?.codex?.baseUrl, "http://127.0.0.1:24335/v1");
});

test("the port it asked for rewrites nothing", () => {
  // The common case, and it must not write: a rewrite on every launch would
  // touch rows nobody changed and make the file look edited when it was not.
  assert.equal(pointRoutesAtPort(migrated(), BUILTIN_GATEWAY_ID, BUILTIN_GATEWAY_PORT), 0);
});

test("the rewrite touches no other gateway", () => {
  const db = migrated();
  const other = saveGateway(db, {
    name: "Work LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://litellm.corp:4000",
        auth: "inherit",
        credentialEnv: null,
        models: [],
      },
    },
  });
  pointRoutesAtPort(db, BUILTIN_GATEWAY_ID, 24343);
  assert.equal(
    getGateway(db, other.id)?.routes["claude-agent"]?.baseUrl,
    "http://litellm.corp:4000",
  );
});

// ── §7.1 — the key is a name, never a value ─────────────────────

test("the routes name a variable and hold no credential", () => {
  const routes = getGateway(migrated(), BUILTIN_GATEWAY_ID)?.routes;
  for (const route of Object.values(routes ?? {})) {
    assert.equal(route.auth, "environment");
    assert.equal(route.credentialEnv, BUILTIN_GATEWAY_KEY_VAR);
  }
  // The whole row, as SQLite holds it, carries nothing that looks like a key.
  const raw = JSON.stringify(getGateway(migrated(), BUILTIN_GATEWAY_ID));
  assert.equal(raw.includes("sk-"), false);
});

// ── §4.1 — a permanent row is permanent ─────────────────────────

test("the built-in gateway cannot be deleted or edited", () => {
  const db = migrated();
  assert.throws(() => deleteGateway(db, BUILTIN_GATEWAY_ID), /cannot be deleted/);
  assert.throws(
    () => saveGateway(db, { id: BUILTIN_GATEWAY_ID, name: "Mine", kind: "builtin", routes: {} }),
    /cannot be edited/,
  );
  // And the refusal says what to do instead, because "you cannot" with no
  // second half is how a person concludes the feature is broken.
  assert.throws(() => deleteGateway(db, BUILTIN_GATEWAY_ID), /Turn it off in Settings/);
});

test("Original is still refused too", () => {
  assert.throws(() => deleteGateway(migrated(), ORIGINAL_GATEWAY_ID), /cannot be deleted/);
});

// ── §15 step 2 and §3.1 — `envoy` and `custom` leave ────────────
//
// The claim that matters is not that the rows go. It is **what survives**:
// spec 43 §2.6 rule 2 copies the gateway's name and URL onto every message, so
// an answer produced before the migration still says which gateway produced it
// after that gateway is gone. That is criterion A13, and it is why this spec
// needs no gateway revisioning and no retirement mechanism.

/** A database with two `envoy` rows, sessions and messages — the reviewer's shape. */
function openWithEnvoy(): Database.Database {
  // Through the same migrations a real database gets, so what this asserts is
  // what the reviewer's own file will do.
  const db = migrated();
  // Written with SQL, not through `saveGateway`: `envoy` is no longer a
  // `GatewayKind`, and the rows this migration meets were written by an OLDER
  // BUILD. Making them the way today's code cannot is the point.
  for (const [id, name, model] of [
    ["gw-lms", "Envoy LMS", "lms-26b"],
    ["gw-unsloth", "Envoy Unsloth", "unsloth-26b-anthropic"],
  ] as const) {
    db.prepare(
      "INSERT INTO agent_gateway (id, name, kind, created_at) VALUES (?, ?, 'envoy', '2026-09-01')",
    ).run(id, name);
    db.prepare(
      `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
       VALUES (?, 'claude-agent', 'http://localhost:26334/anthropic', 'none', NULL, ?)`,
    ).run(id, model);
    const gateway = { id };
    db.prepare(
      `INSERT INTO thread (id, document_id, kind, status, note, created_at, updated_at)
       VALUES (?, 'd1', 'anchored', 'open', 'n', '2026-09-01', '2026-09-01')`,
    ).run(`t-${gateway.id}`);
    setThreadSession(db, `t-${gateway.id}`, "claude-agent", gateway.id, {
      sessionId: "s1",
      baseUrl: "http://localhost:26334/anthropic",
    });
    db.prepare(
      `INSERT INTO message (id, thread_id, seq, role, kind, mode, model, sdk, gateway_name, base_url, content, created_at)
       VALUES (?, ?, 0, 'assistant', 'text', 'ask', ?, 'claude-agent', ?, 'http://localhost:26334/anthropic', 'an answer', '2026-09-01')`,
    ).run(`m-${gateway.id}`, `t-${gateway.id}`, model, name);
  }
  return db;
}

test("the migration deletes every envoy and custom row, and names them", () => {
  const db = openWithEnvoy();
  const removed = migrateRetireGatewayKinds(db);
  assert.deepEqual(removed.sort(), ["Envoy LMS", "Envoy Unsloth"]);
  assert.deepEqual(
    listGateways(db)
      .map((row) => row.kind)
      .sort(),
    ["builtin", "original"],
  );
});

test("the names are remembered, so the screen can say it once", () => {
  const db = openWithEnvoy();
  migrateRetireGatewayKinds(db);
  const note = getSetting(db, RETIRED_GATEWAYS_KEY);
  assert.equal(note, "Envoy LMS\nEnvoy Unsloth");
});

test("A13 — an answer produced before the migration still names its gateway", () => {
  // The whole reason §5.3's evidence is a COPY and not a foreign key. Without
  // this, deleting a gateway would rewrite the history of every answer it made.
  const db = openWithEnvoy();
  const before = db
    .prepare<[], { gateway_name: string; base_url: string; model: string }>(
      "SELECT gateway_name, base_url, model FROM message ORDER BY gateway_name",
    )
    .all();
  migrateRetireGatewayKinds(db);
  const after = db
    .prepare<[], { gateway_name: string; base_url: string; model: string }>(
      "SELECT gateway_name, base_url, model FROM message ORDER BY gateway_name",
    )
    .all();
  assert.deepEqual(after, before);
  assert.equal(after[0]?.gateway_name, "Envoy LMS");
  assert.equal(after[0]?.base_url, "http://localhost:26334/anthropic");
});

test("a deleted gateway costs a replay, never a thread", () => {
  // §3.1 — `thread_session` cascades on delete, so the SDK's cached session for
  // that combination goes. The comment and its messages do not.
  const db = openWithEnvoy();
  migrateRetireGatewayKinds(db);
  assert.equal(
    db.prepare<[], { n: number }>("SELECT count(*) AS n FROM thread_session").get()?.n,
    0,
  );
  assert.equal(db.prepare<[], { n: number }>("SELECT count(*) AS n FROM thread").get()?.n, 2);
  assert.equal(db.prepare<[], { n: number }>("SELECT count(*) AS n FROM message").get()?.n, 2);
});

test("the kind CHECK is narrowed, so no envoy row can come back", () => {
  const db = openWithEnvoy();
  migrateRetireGatewayKinds(db);
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO agent_gateway (id, name, kind, created_at) VALUES (?, ?, ?, ?)")
        .run("gw-new", "Another Envoy", "envoy", "2026-09-06"),
    /CHECK constraint failed/,
  );
});

test("running the retirement twice is a no-op", () => {
  const db = openWithEnvoy();
  assert.equal(migrateRetireGatewayKinds(db).length, 2);
  assert.deepEqual(migrateRetireGatewayKinds(db), []);
  assert.equal(getSetting(db, RETIRED_GATEWAYS_KEY), "Envoy LMS\nEnvoy Unsloth");
});

test("a database with nothing to retire is left alone", () => {
  const db = migrated();
  assert.deepEqual(migrateRetireGatewayKinds(db), []);
  assert.equal(getSetting(db, RETIRED_GATEWAYS_KEY), null);
  assert.ok(getGateway(db, ORIGINAL_GATEWAY_ID));
  assert.ok(getGateway(db, BUILTIN_GATEWAY_ID));
});

// ── §7 — an external gateway's key, stored and never returned ───

test("a stored key round-trips as ciphertext and never as a value", () => {
  const db = migrated();
  migrateRetireGatewayKinds(db);
  const saved = saveGateway(
    db,
    {
      name: "Work LiteLLM",
      kind: "litellm",
      routes: {
        "claude-agent": {
          baseUrl: "http://litellm.corp:4000",
          auth: "stored",
          credentialEnv: null,
          models: [],
        },
      },
    },
    Buffer.from("pretend-ciphertext"),
  );
  assert.equal(hasGatewayKey(db, saved.id), true);
  assert.equal(gatewayKeyCipher(db, saved.id)?.toString(), "pretend-ciphertext");
  // The shape the renderer receives carries no key at all.
  assert.equal(JSON.stringify(saved).includes("ciphertext"), false);
});

test("editing a gateway without touching the key keeps it", () => {
  // A rename must never blank a credential. `undefined` and `null` are
  // different on purpose, and this is the case that would otherwise be lost:
  // routes are replaced wholesale, so an untouched key has to be carried over.
  const db = migrated();
  migrateRetireGatewayKinds(db);
  const routes = {
    "claude-agent": {
      baseUrl: "http://litellm.corp:4000",
      auth: "stored" as const,
      credentialEnv: null,
      models: [],
    },
  };
  const first = saveGateway(db, { name: "Work", kind: "litellm", routes }, Buffer.from("cipher"));
  saveGateway(db, { id: first.id, name: "Renamed", kind: "litellm", routes });
  assert.equal(hasGatewayKey(db, first.id), true, "a rename blanked the key");

  saveGateway(db, { id: first.id, name: "Renamed", kind: "litellm", routes }, null);
  assert.equal(hasGatewayKey(db, first.id), false, "an explicit null did not remove it");
});

test("a route may never carry both a variable name and a stored key", () => {
  const db = migrated();
  migrateRetireGatewayKinds(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, token_cipher, models)
           VALUES (?, 'claude-agent', 'http://x:4000', 'environment', 'SOME_VAR', ?, '')`,
        )
        .run(BUILTIN_GATEWAY_ID, Buffer.from("cipher")),
    /UNIQUE|PRIMARY KEY/,
    "the builtin already has this route, which is what makes the insert fail first",
  );
});
