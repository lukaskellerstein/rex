// Spec 43 §2.2 and §5.2 — where a gateway lives, and where a session does.
//
// Its own module rather than a corner of `queries.ts`, for the reason
// `settings.ts` is its own: `queries.ts` is entirely about the review —
// documents, comments, targets, messages. A gateway is configuration about REX,
// and a session is a cache one harness keeps; putting either beside
// `deleteThread` would invite the next one to be a column on something.
//
// **No credential value is ever written here.** `credential_env` is the NAME of
// an environment variable, and §2.6 rule 4 is the whole reason it is a name:
// nothing REX stores can leak a key, because nothing REX stores has one.

import type {
  AgentAuth,
  AgentGateway,
  AgentSdk,
  GatewayKind,
  GatewayRoute,
} from "../../shared/agent-protocol.ts";
import type { Db } from "./database.ts";
import { BUILTIN_GATEWAY_ID, ORIGINAL_GATEWAY_ID } from "./migrate.ts";

const now = (): string => new Date().toISOString();

export { BUILTIN_GATEWAY_ID, ORIGINAL_GATEWAY_ID };

interface GatewayRow {
  id: string;
  name: string;
  kind: GatewayKind;
  /** Spec 46 §4.1 — 1 for every row but a built-in gateway that is switched off. */
  enabled: number;
  created_at: string;
}

interface RouteRow {
  gateway_id: string;
  sdk: AgentSdk;
  base_url: string | null;
  auth: AgentAuth;
  credential_env: string | null;
  models: string;
}

/**
 * §2.2 — `models` is a newline-separated list, not JSON.
 *
 * It is displayed as typed and never queried by element, and a text column
 * keeps `sqlite3 ~/.rex/rex.db "select * from gateway_route"` readable — which
 * is how every gateway problem in §15 was actually diagnosed. Blank lines are
 * dropped on the way in and on the way out, so a trailing newline in a textarea
 * is not a model called "".
 */
export function parseModels(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function joinModels(models: readonly string[]): string {
  return models
    .map((model) => model.trim())
    .filter((model) => model.length > 0)
    .join("\n");
}

function toRoute(row: RouteRow): GatewayRoute {
  return {
    baseUrl: row.base_url,
    auth: row.auth,
    credentialEnv: row.credential_env,
    models: parseModels(row.models),
  };
}

function assemble(rows: GatewayRow[], routes: RouteRow[]): AgentGateway[] {
  const byGateway = new Map<string, Partial<Record<AgentSdk, GatewayRoute>>>();
  for (const row of routes) {
    const found = byGateway.get(row.gateway_id) ?? {};
    found[row.sdk] = toRoute(row);
    byGateway.set(row.gateway_id, found);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    // `AgentGateway.routes` is generated as a full record; a gateway that does
    // not offer an SDK simply has no key, which §4.2 draws as greyed.
    routes: (byGateway.get(row.id) ?? {}) as AgentGateway["routes"],
  }));
}

/**
 * Spec 46 §4.1 — is this gateway's process meant to be running?
 *
 * Kept out of `AgentGateway` deliberately: that type is the library's, it
 * describes a set of routes, and whether a host happens to be running a process
 * for one is not something the library has any business knowing. The switch is
 * REX's, so it is read where REX reads rows.
 */
export function isEnabled(db: Db, gatewayId: string): boolean {
  const row = db
    .prepare<[string], { enabled: number }>("SELECT enabled FROM agent_gateway WHERE id = ?")
    .get(gatewayId);
  return row ? row.enabled === 1 : false;
}

/**
 * Flips the switch. **It writes one column and nothing else.**
 *
 * §4.1: "Turning it off deletes nothing." Off is a statement about a process,
 * not about a configuration — the reviewer's providers, models and keys survive
 * it, because the second time somebody enables this they should not have to
 * fill it in again. Starting and stopping the child is the caller's job; this
 * only records the intent, so that the next launch knows it.
 */
export function setEnabled(db: Db, gatewayId: string, enabled: boolean): void {
  db.prepare("UPDATE agent_gateway SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, gatewayId);
}

/**
 * Spec 46 §4.2.1 — point the built-in gateway's four routes at the live port.
 *
 * **This is the one place where the port walk-up can silently break a run.**
 * `resolveRoute()` in `bridge.ts` returns `route.baseUrl` exactly as stored, so
 * a row written with `:24334` whose child started on `:24335` would resolve to
 * a dead address — and the failure would read as a broken gateway rather than
 * as a moved port.
 *
 * So the rewrite happens the moment the child is listening, **before anything
 * can resolve one**. The database holds the truth, `resolveRoute()` stays
 * exactly as it is, and no caller learns that a port can move.
 *
 * The consequence is correct and worth naming rather than discovering: spec 43
 * §5.2 stores the `base_url` a session was created against, so a moved port
 * invalidates this gateway's sessions and the next send replays instead of
 * resuming. That is the rule working. A different address is a different
 * server, and asking it to continue state it never saw is precisely what §5.2
 * exists to prevent — a replay costs one transcript, a wrong resume costs the
 * answer.
 *
 * Returns the number of routes it moved, which is 0 on every launch that got
 * the port it asked for.
 */
export function pointRoutesAtPort(db: Db, gatewayId: string, port: number): number {
  const host = `http://127.0.0.1:${port}`;
  const routes = db
    .prepare<[string], RouteRow>("SELECT * FROM gateway_route WHERE gateway_id = ?")
    .all(gatewayId);

  const update = db.prepare(
    "UPDATE gateway_route SET base_url = ? WHERE gateway_id = ? AND sdk = ?",
  );
  let moved = 0;
  db.transaction(() => {
    for (const row of routes) {
      // The Claude SDK appends `/v1/messages` itself, so its base is the root
      // and everything else addresses `/v1`. Spec 43 §3's trap, and getting it
      // wrong here produces `/v1/v1/messages` and a 404 explaining nothing.
      const base = row.sdk === "claude-agent" ? host : `${host}/v1`;
      if (row.base_url === base) continue;
      update.run(base, gatewayId, row.sdk);
      moved += 1;
    }
  })();
  return moved;
}

/**
 * Spec 46 §4.5 — the built-in gateway's model list, written to all four routes.
 *
 * **One list per gateway, not one per SDK.** LiteLLM answers `/v1/messages`,
 * `/v1/chat/completions` and `/v1/responses` from the same `model_name`, so a
 * model chosen in REX is one string every SDK can use. Envoy could not do that —
 * it matches on headers, so the protocol had to be chosen by the model name,
 * which is where the `-anthropic` duplication came from.
 *
 * The column stays where it is and the same value goes to every row, so no
 * query and no test changes. That is §4.5's own instruction, and it is why the
 * per-SDK model textarea can go without a schema change.
 */
export function setBuiltinModels(db: Db, models: readonly string[]): void {
  db.prepare("UPDATE gateway_route SET models = ? WHERE gateway_id = ?").run(
    joinModels(models),
    BUILTIN_GATEWAY_ID,
  );
}

/**
 * Every gateway, `Original` first and the rest by when they were made.
 *
 * `Original` first because it is the default and §2.5 requires it to be
 * reachable in one click from any state the settings screen can get into.
 */
export function listGateways(db: Db): AgentGateway[] {
  const rows = db
    .prepare<[string], GatewayRow>(
      "SELECT * FROM agent_gateway ORDER BY (id = ?) DESC, created_at, name",
    )
    .all(ORIGINAL_GATEWAY_ID);
  const routes = db.prepare<[], RouteRow>("SELECT * FROM gateway_route").all();
  return assemble(rows, routes);
}

export function getGateway(db: Db, gatewayId: string): AgentGateway | null {
  const row = db
    .prepare<[string], GatewayRow>("SELECT * FROM agent_gateway WHERE id = ?")
    .get(gatewayId);
  if (!row) return null;
  const routes = db
    .prepare<[string], RouteRow>("SELECT * FROM gateway_route WHERE gateway_id = ?")
    .all(gatewayId);
  return assemble([row], routes)[0] ?? null;
}

export interface GatewayDraft {
  /** Absent for a new gateway. Present to edit the one it names. */
  id?: string;
  name: string;
  kind: GatewayKind;
  routes: Partial<Record<AgentSdk, GatewayRoute>>;
}

/**
 * §2.5 — `Original` cannot be edited or deleted.
 *
 * Enforced here rather than only in the sheet, because a rule that guards what
 * REX does today must not be reachable by a caller that forgot it. `ipc.ts` is
 * one caller and it will not be the last.
 */
function refuseOriginal(gatewayId: string, act: string): void {
  if (gatewayId === ORIGINAL_GATEWAY_ID) {
    throw new Error(`'Original' is what REX does with no gateway at all, so it cannot be ${act}.`);
  }
  // Spec 46 §4.1 — the built-in gateway is a permanent row too, for the same
  // reason `Original` is: REX creates it, REX addresses it, and a person turns
  // it on and off rather than making or unmaking it. Its providers and models
  // are edited on the Models tab, which is a different table entirely.
  if (gatewayId === BUILTIN_GATEWAY_ID) {
    throw new Error(
      `'Built-in' is REX's own gateway, so it cannot be ${act}. Turn it off in Settings instead — nothing you configured is lost.`,
    );
  }
}

/**
 * Writes one gateway and its routes, and returns what was stored.
 *
 * The routes are **replaced**, not merged: the sheet always sends the whole set,
 * and a merge would leave an SDK's route behind after the reviewer removed its
 * URL. One transaction, so a half-written gateway cannot exist.
 */
export function saveGateway(db: Db, draft: GatewayDraft, keyCipher?: Buffer | null): AgentGateway {
  const id = draft.id ?? `gw-${crypto.randomUUID()}`;
  if (draft.id) refuseOriginal(draft.id, "edited");

  const name = draft.name.trim();
  if (!name) throw new Error("A gateway needs a name.");

  // Spec 46 §7 — the key, if one was supplied. **`undefined` and `null` are
  // different**: `undefined` means "the sheet did not touch the key", and a
  // rename must never blank a credential; `null` means "remove it", which the
  // person asked for. Routes are replaced wholesale below, so an untouched key
  // has to be carried across by hand.
  const existing =
    keyCipher === undefined
      ? (db
          .prepare<[string], { token_cipher: Buffer | null }>(
            "SELECT token_cipher FROM gateway_route WHERE gateway_id = ? AND token_cipher IS NOT NULL LIMIT 1",
          )
          .get(id)?.token_cipher ?? null)
      : keyCipher;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_gateway (id, name, kind, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
    ).run(id, name, draft.kind, now());
    db.prepare("DELETE FROM gateway_route WHERE gateway_id = ?").run(id);
    const insert = db.prepare(
      `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, token_cipher, models)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [sdk, route] of Object.entries(draft.routes)) {
      if (!route) continue;
      insert.run(
        id,
        sdk,
        route.baseUrl,
        route.auth,
        // The CHECK constraints in §2.2 are the backstop; this is what keeps an
        // ordinary save from tripping one. `environment` needs a name and
        // nothing else may carry one.
        route.auth === "environment" ? (route.credentialEnv ?? null) : null,
        // The same rule for the ciphertext: only a `stored` route holds one, so
        // a row can never carry two credentials.
        route.auth === "stored" ? existing : null,
        joinModels(route.models ?? []),
      );
    }
  })();

  const saved = getGateway(db, id);
  if (!saved) throw new Error(`The gateway '${name}' was not stored.`);
  return saved;
}

/**
 * Spec 46 §7 — one external gateway's stored key, for `gateway/secrets.ts` alone.
 *
 * Every route of a gateway carries the same ciphertext, because a gateway has
 * one master key and four protocols. Reading any one of them is reading it.
 */
export function gatewayKeyCipher(db: Db, gatewayId: string): Buffer | null {
  return (
    db
      .prepare<[string], { token_cipher: Buffer | null }>(
        "SELECT token_cipher FROM gateway_route WHERE gateway_id = ? AND token_cipher IS NOT NULL LIMIT 1",
      )
      .get(gatewayId)?.token_cipher ?? null
  );
}

/** Whether this gateway has a key at all. **A boolean, never the value.** */
export function hasGatewayKey(db: Db, gatewayId: string): boolean {
  const cipher = gatewayKeyCipher(db, gatewayId);
  return cipher !== null && cipher.length > 0;
}

/**
 * Removes a gateway, its routes and its sessions.
 *
 * **It changes no message.** §5.3's evidence is a copy of four short strings, so
 * every answer this gateway ever produced still names it, its URL, its model and
 * its style — which is the whole reason this spec needs no retirement.
 */
export function deleteGateway(db: Db, gatewayId: string): void {
  refuseOriginal(gatewayId, "deleted");
  db.prepare("DELETE FROM agent_gateway WHERE id = ?").run(gatewayId);
}

// ── §5.2 — one session per (thread, SDK, gateway) ───────────────

export interface StoredSession {
  sessionId: string;
  /** The URL this session was really created against. Case 2b turns on it. */
  baseUrl: string | null;
}

export function getThreadSession(
  db: Db,
  threadId: string,
  sdk: AgentSdk,
  gatewayId: string,
): StoredSession | null {
  const row = db
    .prepare<[string, string, string], { session_id: string; base_url: string | null }>(
      `SELECT session_id, base_url FROM thread_session
        WHERE thread_id = ? AND sdk = ? AND gateway_id = ?`,
    )
    .get(threadId, sdk, gatewayId);
  return row ? { sessionId: row.session_id, baseUrl: row.base_url } : null;
}

/**
 * Records the session this combination now has, replacing any it had.
 *
 * `base_url` is stored beside it because §5.2 case 2b compares them: a gateway
 * whose host was edited must start a fresh session rather than ask a different
 * server to continue state it has never seen.
 *
 * **Only the ASK and reply path calls this** (§5.5). `apply.ts`, `docx/run.ts`
 * and `pptx/run.ts` use a run-scoped id on purpose and discard it.
 */
export function setThreadSession(
  db: Db,
  threadId: string,
  sdk: AgentSdk,
  gatewayId: string,
  session: StoredSession,
): void {
  db.prepare(
    `INSERT INTO thread_session (thread_id, sdk, gateway_id, base_url, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, sdk, gateway_id)
       DO UPDATE SET base_url = excluded.base_url, session_id = excluded.session_id,
                     created_at = excluded.created_at`,
  ).run(threadId, sdk, gatewayId, session.baseUrl, session.sessionId, now());
}

export interface SessionRow extends StoredSession {
  sdk: AgentSdk;
  gatewayId: string;
  gatewayName: string;
  createdAt: string;
}

/**
 * Every combination this thread has used, for §9's debug block.
 *
 * The gateway's name is joined in rather than copied, because this is live
 * configuration and not evidence: a renamed gateway should read as its new name
 * here, and the messages keep the old one. That contrast is deliberate.
 */
export function listThreadSessions(db: Db, threadId: string): SessionRow[] {
  return db
    .prepare<
      [string],
      {
        sdk: AgentSdk;
        gateway_id: string;
        name: string | null;
        base_url: string | null;
        session_id: string;
        created_at: string;
      }
    >(
      `SELECT s.sdk, s.gateway_id, g.name, s.base_url, s.session_id, s.created_at
         FROM thread_session s
         LEFT JOIN agent_gateway g ON g.id = s.gateway_id
        WHERE s.thread_id = ?
        ORDER BY s.created_at`,
    )
    .all(threadId)
    .map((row) => ({
      sdk: row.sdk,
      gatewayId: row.gateway_id,
      // A gateway deleted while its sessions were cascading away leaves no row;
      // the id is what the reader has, and it is better than an empty column.
      gatewayName: row.name ?? row.gateway_id,
      baseUrl: row.base_url,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));
}
