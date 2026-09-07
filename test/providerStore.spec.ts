// Spec 46 §7 and §11 — the provider store, and the key that never comes back.
//
// The claim this file exists for is criterion A4: **no plaintext key anywhere.**
// The store holds a `BLOB` it cannot decrypt (that needs `electron`), and every
// shape it hands out carries a boolean instead of a value. So a key cannot
// reach the renderer even by mistake, because nothing on the way there has one.
//
// Also §11's alias rule, which is the one piece of naming a person never does
// and therefore the one that has to be right without anybody checking it.
//
// Run: npm run test:providers

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { migrateGatewayProviders } from "../src/main/db/migrate.ts";
import {
  aliasFor,
  keyCipherOf,
  listConfigured,
  listModels,
  listProviders,
  markListed,
  removeProvider,
  saveProvider,
  setModels,
  setProviderKey,
} from "../src/main/db/providers.ts";

const work = mkdtempSync(join(tmpdir(), "rex-providers-"));
after(() => rmSync(work, { recursive: true, force: true }));

let made = 0;

function open(): Database.Database {
  made += 1;
  const db = new Database(join(work, `p-${made}.db`));
  db.pragma("foreign_keys = ON");
  // The two tables `migrateGatewayProviders` adds `token_cipher` to.
  db.exec(`
    CREATE TABLE gateway_route (
      gateway_id TEXT NOT NULL, sdk TEXT NOT NULL, base_url TEXT,
      auth TEXT NOT NULL, credential_env TEXT, models TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (gateway_id, sdk)
    );
  `);
  migrateGatewayProviders(db);
  return db;
}

function added(db: Database.Database, provider = "lmstudio"): string {
  return saveProvider(db, {
    provider,
    label: provider === "lmstudio" ? "LM Studio" : "OpenAI",
    baseUrl: provider === "lmstudio" ? "http://127.0.0.1:1234" : null,
  }).id;
}

// ── §11 — the alias is REX's, never the person's ────────────────

test("a slash and a colon both leave the alias", () => {
  // An alias is typed into a URL and a JSON body, and neither character
  // survives that cleanly. The rule is `gateway_discovery.py`'s own.
  assert.equal(aliasFor("lmstudio", "google/gemma-4-e4b"), "lmstudio-google-gemma-4-e4b");
  assert.equal(aliasFor("ollama", "gemma4:26b"), "ollama-gemma4-26b");
});

test("case cannot produce two aliases for one model", () => {
  assert.equal(aliasFor("openai", "GPT-5.4"), aliasFor("openai", "gpt-5.4"));
});

test("the model's own dots and dashes survive, because they are legal", () => {
  assert.equal(aliasFor("openai", "gpt-5.4-mini"), "openai-gpt-5.4-mini");
});

test("an alias never starts or ends with a dash", () => {
  assert.equal(aliasFor("unsloth", "/leading/and/trailing/"), "unsloth-leading-and-trailing");
});

// ── §7 and A4 — a key goes in and never comes out ───────────────

test("a provider view carries a boolean, never a key", () => {
  const db = open();
  const id = added(db);
  assert.equal(listProviders(db)[0]?.hasKey, false);

  setProviderKey(db, id, Buffer.from("pretend-ciphertext"));
  const view = listProviders(db)[0];
  assert.equal(view?.hasKey, true);
  // The whole object, serialised, holds nothing that could be a key.
  assert.equal(JSON.stringify(view).includes("ciphertext"), false);
  assert.equal("keyCipher" in (view as object), false);
});

test("the ciphertext is reachable by exactly one function", () => {
  // `keyCipherOf` exists for `gateway/secrets.ts` alone. Everything else in
  // this module answers with a boolean, which is what makes A4 structural.
  const db = open();
  const id = added(db);
  setProviderKey(db, id, Buffer.from("cipher-bytes"));
  assert.equal(keyCipherOf(db, id)?.toString(), "cipher-bytes");
  assert.equal(keyCipherOf(db, "gp-nothing"), null);
});

test("clearing a key leaves the provider and everything else it holds", () => {
  const db = open();
  const id = added(db);
  setProviderKey(db, id, Buffer.from("cipher"));
  setModels(db, id, "lmstudio", [{ model: "a", maxInput: 1, maxOutput: 1, tools: true }]);

  setProviderKey(db, id, null);
  assert.equal(listProviders(db)[0]?.hasKey, false);
  assert.equal(listModels(db, id).length, 1, "the models are not the key");
});

test("editing a provider cannot blank its key", () => {
  // `saveProvider` never touches `key_cipher`, so a rename is a rename. The
  // two are separate functions precisely so this cannot be forgotten.
  const db = open();
  const id = added(db);
  setProviderKey(db, id, Buffer.from("cipher"));
  saveProvider(db, { id, provider: "lmstudio", label: "The other one", baseUrl: "http://x:1" });
  assert.equal(listProviders(db)[0]?.hasKey, true);
  assert.equal(listProviders(db)[0]?.label, "The other one");
});

// ── §5.5 — null is not "no" ─────────────────────────────────────

test("a provider that said nothing about tools stores null, not false", () => {
  const db = open();
  const id = added(db);
  setModels(db, id, "lmstudio", [
    { model: "said-yes", maxInput: null, maxOutput: null, tools: true },
    { model: "said-no", maxInput: null, maxOutput: null, tools: false },
    { model: "said-nothing", maxInput: null, maxOutput: null, tools: null },
  ]);
  const byModel = new Map(listModels(db, id).map((row) => [row.model, row.tools]));
  assert.equal(byModel.get("said-yes"), true);
  assert.equal(byModel.get("said-no"), false);
  assert.equal(byModel.get("said-nothing"), null, "silence must not become a claim");
});

// ── the ticked set is replaced, never merged ────────────────────

test("saving a smaller set removes what was un-ticked", () => {
  // The one thing a checkbox must never do is leave a model configured after
  // the person un-ticked it.
  const db = open();
  const id = added(db);
  setModels(db, id, "lmstudio", [
    { model: "a", maxInput: null, maxOutput: null, tools: null },
    { model: "b", maxInput: null, maxOutput: null, tools: null },
  ]);
  setModels(db, id, "lmstudio", [{ model: "a", maxInput: null, maxOutput: null, tools: null }]);
  assert.deepEqual(
    listModels(db, id).map((row) => row.model),
    ["a"],
  );
});

test("removing a provider takes its models with it", () => {
  const db = open();
  const id = added(db);
  setModels(db, id, "lmstudio", [{ model: "a", maxInput: null, maxOutput: null, tools: null }]);
  removeProvider(db, id);
  assert.equal(listProviders(db).length, 0);
  assert.equal(listModels(db).length, 0, "the cascade ran");
});

// ── what config.yaml is built from ──────────────────────────────

test("the configured list joins each model to the provider that serves it", () => {
  const db = open();
  const local = added(db, "lmstudio");
  const paid = added(db, "openai");
  setModels(db, local, "lmstudio", [
    { model: "google/gemma-4-e4b", maxInput: 122880, maxOutput: 8192, tools: true },
  ]);
  setModels(db, paid, "openai", [
    { model: "gpt-5.4", maxInput: null, maxOutput: null, tools: null },
  ]);

  const configured = listConfigured(db);
  assert.equal(configured.length, 2);
  const gemma = configured.find((row) => row.model === "google/gemma-4-e4b");
  assert.equal(gemma?.provider, "lmstudio");
  assert.equal(gemma?.baseUrl, "http://127.0.0.1:1234");
  assert.equal(gemma?.alias, "lmstudio-google-gemma-4-e4b");
  // A fixed-endpoint provider stores no URL, and `api_base` comes from the
  // descriptor instead.
  assert.equal(configured.find((row) => row.model === "gpt-5.4")?.baseUrl, null);
});

// ── §6 — a cached list is dated ─────────────────────────────────

test("a provider records when it was last asked", () => {
  const db = open();
  const id = added(db);
  assert.equal(listProviders(db)[0]?.listedAt, null);
  markListed(db, id);
  assert.ok(listProviders(db)[0]?.listedAt, "the screen can say how old the list is");
});

test("the migration is idempotent", () => {
  const db = open();
  assert.equal(migrateGatewayProviders(db), false);
  assert.doesNotThrow(() => migrateGatewayProviders(db));
});
