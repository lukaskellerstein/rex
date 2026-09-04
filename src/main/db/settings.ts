// Spec 25 §6.1 — one fact about REX itself, keyed by name.
//
// Its own module rather than a corner of `queries.ts`, which is entirely about
// the review — documents, comments, targets, messages. A preference is a
// different kind of thing and putting it beside `deleteThread` would invite the
// next one to be a column on something.
//
// Deliberately not a settings system. Two functions and one named key; nothing
// reads a key that a spec does not name.

import type Database from "better-sqlite3";
import type { AgentSdk } from "../../shared/agent-protocol.ts";
import { DEFAULT_MODEL, type ModelChoice, type PaperView } from "../../shared/types.ts";
import { ORIGINAL_GATEWAY_ID } from "./migrate.ts";

type Db = Database.Database;

/** §6.1 — the app-wide default model. Absent means the SDK's own first row. */
export const MODEL_DEFAULT_KEY = "model.default";

/** Spec 27 §4.7 — how the Markdown page is drawn. Absent means narrow and light. */
export const VIEW_MEASURE_KEY = "view.measure";
export const VIEW_PAPER_KEY = "view.paper";

/**
 * Spec 43 §4.0 — what a **new** comment's three controls start on.
 *
 * `agent.model` is deliberately a second key beside `model.default` and not a
 * rename of it. `model.default` is spec 25's, it is what `Original` starts on,
 * and §12 keeps its raw stored value on purpose; this one exists so that a
 * gateway with its own model list has a remembered choice too. A comment that
 * has already been sent reads neither: it starts on what it last used (§4.0).
 *
 * `agent.sdk` is written by spec 44 and read here from the day the column
 * exists, so that adding the agent control adds a control and no plumbing.
 */
export const AGENT_SDK_KEY = "agent.sdk";
export const AGENT_GATEWAY_KEY = "agent.gateway";
export const AGENT_MODEL_KEY = "agent.model";

export function getSetting(db: Db, key: string): string | null {
  const row = db
    .prepare<[string], { value: string }>("SELECT value FROM setting WHERE key = ?")
    .get(key);
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/**
 * §6.2 — the default, checked against what the CLI actually offers.
 *
 * A stored default can name a model that is not there any more: the CLI
 * updated, or the account ran out of credits for it. REX falls back to
 * `default` and **keeps the stored row**, because the model may come back and
 * silently rewriting the reviewer's choice would mean they never learn it
 * stopped being honoured.
 */
export function defaultModel(db: Db, models: ModelChoice[]): string {
  const stored = getSetting(db, MODEL_DEFAULT_KEY);
  if (stored === null) return DEFAULT_MODEL;
  return models.some((model) => model.value === stored) ? stored : DEFAULT_MODEL;
}

/**
 * Spec 43 §4.0 — the three settings a new comment starts on, resolved.
 *
 * The rule for a gateway that no longer exists is spec 25 §6.2's, applied to one
 * more field: fall back to `Original`, **keep the stored row**, and let the
 * picker say so once. A gateway can come back — an edit undone, a machine the
 * database was copied from — and silently rewriting the reviewer's choice would
 * mean they never learn it stopped being honoured.
 *
 * The model is NOT checked against a list here. Which models exist depends on
 * the gateway that was just resolved, so `listCapabilities` is what knows, and
 * §4.1's cascade is what falls back — to the route's first model, never to an
 * empty control.
 */
export function agentDefaults(db: Db, gatewayIds: readonly string[]): AgentDefaults {
  const storedGateway = getSetting(db, AGENT_GATEWAY_KEY);
  const known = storedGateway !== null && gatewayIds.includes(storedGateway);
  return {
    sdk: (getSetting(db, AGENT_SDK_KEY) as AgentSdk | null) ?? "claude-agent",
    gatewayId: known ? storedGateway : ORIGINAL_GATEWAY_ID,
    missingGateway: storedGateway !== null && !known ? storedGateway : null,
    model: getSetting(db, AGENT_MODEL_KEY),
  };
}

export interface AgentDefaults {
  sdk: AgentSdk;
  gatewayId: string;
  /**
   * The stored gateway id that is not there any more, or null.
   *
   * Reported rather than swallowed: the picker's tooltip says it once, and the
   * row stays in `setting` so the choice comes back if the gateway does.
   */
  missingGateway: string | null;
  model: string | null;
}

/**
 * Spec 27 §4.7 — the two switches, as the reviewer last left them.
 *
 * Words rather than `"1"` and `"0"`, so `sqlite3 ~/.rex/rex.db "select * from
 * setting"` reads as a sentence. Anything the two keys do not recognise is the
 * default: a preference is not worth a startup failure, and unlike the model
 * (§6.2) there is nothing here that could come back later.
 */
export function paperView(db: Db): PaperView {
  return {
    wide: getSetting(db, VIEW_MEASURE_KEY) === "wide",
    dark: getSetting(db, VIEW_PAPER_KEY) === "dark",
  };
}

export function setPaperView(db: Db, view: PaperView): void {
  setSetting(db, VIEW_MEASURE_KEY, view.wide ? "wide" : "narrow");
  setSetting(db, VIEW_PAPER_KEY, view.dark ? "dark" : "light");
}
