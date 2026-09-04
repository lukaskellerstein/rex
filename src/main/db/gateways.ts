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
import { ORIGINAL_GATEWAY_ID } from "./migrate.ts";

const now = (): string => new Date().toISOString();

export { ORIGINAL_GATEWAY_ID };

interface GatewayRow {
  id: string;
  name: string;
  kind: GatewayKind;
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
}

/**
 * Writes one gateway and its routes, and returns what was stored.
 *
 * The routes are **replaced**, not merged: the sheet always sends the whole set,
 * and a merge would leave an SDK's route behind after the reviewer removed its
 * URL. One transaction, so a half-written gateway cannot exist.
 */
export function saveGateway(db: Db, draft: GatewayDraft): AgentGateway {
  const id = draft.id ?? `gw-${crypto.randomUUID()}`;
  if (draft.id) refuseOriginal(draft.id, "edited");

  const name = draft.name.trim();
  if (!name) throw new Error("A gateway needs a name.");

  db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_gateway (id, name, kind, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
    ).run(id, name, draft.kind, now());
    db.prepare("DELETE FROM gateway_route WHERE gateway_id = ?").run(id);
    const insert = db.prepare(
      `INSERT INTO gateway_route (gateway_id, sdk, base_url, auth, credential_env, models)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const [sdk, route] of Object.entries(draft.routes)) {
      if (!route) continue;
      insert.run(
        id,
        sdk,
        route.baseUrl,
        route.auth,
        // The two CHECK constraints in §2.2 are the backstop; this is what keeps
        // an ordinary save from tripping one. `environment` needs a name and
        // nothing else may carry one.
        route.auth === "environment" ? (route.credentialEnv ?? null) : null,
        joinModels(route.models ?? []),
      );
    }
  })();

  const saved = getGateway(db, id);
  if (!saved) throw new Error(`The gateway '${name}' was not stored.`);
  return saved;
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
