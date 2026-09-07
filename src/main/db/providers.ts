// Spec 46 §5 and §11 — the providers behind the built-in gateway.
//
// Its own module beside `gateways.ts` for the reason that one is beside
// `queries.ts`: a gateway is a set of routes, and a provider is where models
// come from. They are related, not the same, and one file that did both would
// invite the next column to land on whichever table was nearer.
//
// **No credential value is read or written here.** `key_cipher` goes in and out
// as an opaque `Buffer`; `gateway/secrets.ts` is the only thing that can turn
// one into a string, and it needs `electron`. That split is what keeps this
// file drivable by `node --test`.

import type { Db } from "./database.ts";

const now = (): string => new Date().toISOString();

/** One provider row, as the renderer may see it. **Never carries a key.** */
export interface ProviderRow {
  id: string;
  /** A `ProviderDescriptor` id — `lmstudio`, `openai`, … (§5.2). */
  provider: string;
  label: string;
  baseUrl: string | null;
  /** §8 rule 4 — the screen shows `set` or `not set`, and never the value. */
  hasKey: boolean;
  /** When its models were last asked for. §6 — a dated list says so. */
  listedAt: string | null;
  createdAt: string;
}

/** One model a person ticked. What REX writes into `config.yaml` (§4.4). */
export interface ModelRow {
  providerId: string;
  /** The provider's own id, verbatim. */
  model: string;
  /** The LiteLLM `model_name` REX generated. A person never types one. */
  alias: string;
  maxInput: number | null;
  maxOutput: number | null;
  /** 1 / 0 / null — and **null is "the provider did not say"** (§5.5). */
  tools: boolean | null;
}

interface RawProvider {
  id: string;
  provider: string;
  label: string;
  base_url: string | null;
  key_cipher: Buffer | null;
  listed_at: string | null;
  created_at: string;
}

interface RawModel {
  provider_id: string;
  model: string;
  alias: string;
  max_input: number | null;
  max_output: number | null;
  tools: number | null;
}

/**
 * §11 — the alias REX generates, `<provider>-<slug(model id)>`.
 *
 * The rule is `gateway_discovery.py`'s own and is copied rather than
 * reinvented: letters, digits, dot, dash and underscore only, so the slash in
 * `google/gemma-4-e4b` and the colon in `gemma4:26b` both have to go — an alias
 * is typed into a URL and a JSON body, and neither character survives that
 * cleanly. Lower-cased so one model cannot produce two aliases differing only
 * in case.
 *
 * **The person never types one**, which is why this is a function and not a
 * field: two people would spell the same model differently and the config would
 * carry both.
 */
export function aliasFor(provider: string, model: string): string {
  const slug = model
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${provider}-${slug}`;
}

function toProvider(row: RawProvider): ProviderRow {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    // The BOOLEAN, never the buffer. Nothing above this line can leak a key,
    // because nothing above this line has one (§12's warning).
    hasKey: row.key_cipher !== null && row.key_cipher.length > 0,
    listedAt: row.listed_at,
    createdAt: row.created_at,
  };
}

function toModel(row: RawModel): ModelRow {
  return {
    providerId: row.provider_id,
    model: row.model,
    alias: row.alias,
    maxInput: row.max_input,
    maxOutput: row.max_output,
    // `=== null` and not a truthiness test: 0 means "it cannot call tools" and
    // null means "the provider did not say", and collapsing them would turn
    // silence into a claim (§5.5).
    tools: row.tools === null ? null : row.tools === 1,
  };
}

export function listProviders(db: Db): ProviderRow[] {
  return db
    .prepare<[], RawProvider>("SELECT * FROM gateway_provider ORDER BY created_at, label")
    .all()
    .map(toProvider);
}

export function getProvider(db: Db, id: string): ProviderRow | null {
  const row = db
    .prepare<[string], RawProvider>("SELECT * FROM gateway_provider WHERE id = ?")
    .get(id);
  return row ? toProvider(row) : null;
}

/** The ciphertext, for `gateway/secrets.ts` alone. Nothing else may call this. */
export function keyCipherOf(db: Db, id: string): Buffer | null {
  const row = db
    .prepare<[string], { key_cipher: Buffer | null }>(
      "SELECT key_cipher FROM gateway_provider WHERE id = ?",
    )
    .get(id);
  return row?.key_cipher ?? null;
}

export interface ProviderDraft {
  /** Absent for a new provider. Present to edit the one it names. */
  id?: string;
  provider: string;
  label: string;
  baseUrl: string | null;
}

/**
 * Writes one provider. **It never touches `key_cipher`.**
 *
 * The key has its own path (`setProviderKey`) because it has its own rules: it
 * arrives once, is never read back, and an edit that merely renamed a provider
 * must not be able to blank it. Two functions make that structural instead of
 * remembered.
 */
export function saveProvider(db: Db, draft: ProviderDraft): ProviderRow {
  const id = draft.id ?? `gp-${crypto.randomUUID()}`;
  const label = draft.label.trim();
  if (!label) throw new Error("A provider needs a name.");

  db.prepare(
    `INSERT INTO gateway_provider (id, provider, label, base_url, created_at)
     VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider,
         label    = excluded.label,
         base_url = excluded.base_url`,
  ).run(id, draft.provider, label, draft.baseUrl, now());

  const saved = getProvider(db, id);
  if (!saved) throw new Error(`The provider '${label}' was not stored.`);
  return saved;
}

/** Stores or clears one provider's key. `null` clears it. */
export function setProviderKey(db: Db, id: string, cipher: Buffer | null): void {
  db.prepare("UPDATE gateway_provider SET key_cipher = ? WHERE id = ?").run(cipher, id);
}

/** Removes a provider and, by cascade, every model ticked under it. */
export function removeProvider(db: Db, id: string): void {
  db.prepare("DELETE FROM gateway_provider WHERE id = ?").run(id);
}

export function markListed(db: Db, id: string): void {
  db.prepare("UPDATE gateway_provider SET listed_at = ? WHERE id = ?").run(now(), id);
}

// ── the ticked models ───────────────────────────────────────────

export function listModels(db: Db, providerId?: string): ModelRow[] {
  const rows = providerId
    ? db
        .prepare<[string], RawModel>(
          "SELECT * FROM gateway_model WHERE provider_id = ? ORDER BY alias",
        )
        .all(providerId)
    : db.prepare<[], RawModel>("SELECT * FROM gateway_model ORDER BY alias").all();
  return rows.map(toModel);
}

export interface ModelDraft {
  model: string;
  maxInput: number | null;
  maxOutput: number | null;
  tools: boolean | null;
}

/**
 * Replaces the whole ticked set for one provider.
 *
 * Replaced and not merged, for the reason `saveGateway` replaces routes: the
 * screen always sends every tick it is showing, and a merge would leave a model
 * configured after the person un-ticked it — which is the one thing a checkbox
 * must never do.
 *
 * One transaction, so a half-written set cannot exist and be written into a
 * `config.yaml` that then serves models nobody chose.
 */
export function setModels(
  db: Db,
  providerId: string,
  provider: string,
  models: ModelDraft[],
): void {
  const insert = db.prepare(
    `INSERT INTO gateway_model (provider_id, model, alias, max_input, max_output, tools)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare("DELETE FROM gateway_model WHERE provider_id = ?").run(providerId);
    for (const model of models) {
      insert.run(
        providerId,
        model.model,
        aliasFor(provider, model.model),
        model.maxInput,
        model.maxOutput,
        model.tools === null ? null : model.tools ? 1 : 0,
      );
    }
  })();
}

/** Every ticked model, with the provider it belongs to. What `config.yaml` is built from. */
export interface ConfiguredModel extends ModelRow {
  provider: string;
  providerLabel: string;
  baseUrl: string | null;
}

export function listConfigured(db: Db): ConfiguredModel[] {
  return db
    .prepare<[], RawModel & { provider: string; label: string; base_url: string | null }>(
      `SELECT m.*, p.provider, p.label, p.base_url
         FROM gateway_model m
         JOIN gateway_provider p ON p.id = m.provider_id
        ORDER BY p.created_at, m.alias`,
    )
    .all()
    .map((row) => ({
      ...toModel(row),
      provider: row.provider,
      providerLabel: row.label,
      baseUrl: row.base_url,
    }));
}
