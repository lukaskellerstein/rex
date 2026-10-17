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
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  type ModelChoice,
  type PaperView,
} from "../../shared/types.ts";
import { ORIGINAL_GATEWAY_ID } from "./migrate.ts";

type Db = Database.Database;

/**
 * Spec 60 §3.1 — the three keys that held one default for every agent.
 *
 * Read by `migrateAgentDefaults` alone, which moves them under the agent they
 * were set for and deletes them. Nothing else may read them: a key that
 * survives beside its replacement is a second answer to one question.
 */
export const MODEL_DEFAULT_KEY = "model.default";
export const AGENT_MODEL_KEY = "agent.model";
export const AGENT_EFFORT_KEY = "agent.effort";

/** Spec 27 §4.7 — how the Markdown page is drawn. Absent means narrow and light. */
export const VIEW_MEASURE_KEY = "view.measure";
export const VIEW_PAPER_KEY = "view.paper";

/**
 * Spec 43 §4.0 — the agent and the gateway a **new** comment starts on.
 *
 * `agent.sdk` is written by spec 44 and read here from the day the column
 * exists, so that adding the agent control adds a control and no plumbing.
 */
export const AGENT_SDK_KEY = "agent.sdk";
export const AGENT_GATEWAY_KEY = "agent.gateway";

/**
 * Spec 60 §3 — each agent's own default model and effort.
 *
 * Per agent because a model id is one vendor's: a Claude alias stored as the
 * one app-wide default meant nothing to Codex, which then quietly ran its own.
 */
export function agentModelKey(sdk: AgentSdk): string {
  return `agent.${sdk}.model`;
}

export function agentEffortKey(sdk: AgentSdk): string {
  return `agent.${sdk}.effort`;
}

/**
 * Spec 60 §2 — what an agent starts on when the reviewer has set nothing.
 *
 * Claude alone, by the reviewer's choice of 2026-10-17. Absent for the others:
 * REX has no opinion to ship about another vendor's models, so they start on
 * their own CLI's default or their route's first model.
 */
export const SHIPPED_DEFAULTS: Partial<Record<AgentSdk, { model: string; effort: string }>> = {
  "claude-agent": { model: "sonnet", effort: "medium" },
};

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

export function deleteSetting(db: Db, key: string): void {
  db.prepare("DELETE FROM setting WHERE key = ?").run(key);
}

/**
 * Spec 60 §4 — the model a new comment on `sdk` starts on, from this list.
 *
 * Stored, then shipped, then the fallback — each only if the list offers it.
 * A stored default can name a model that is not there any more: the CLI
 * updated, or the account ran out of credits for it. REX falls back and
 * **keeps the stored row** (spec 25 §6.2), because the model may come back and
 * silently rewriting the reviewer's choice would mean they never learn it
 * stopped being honoured.
 *
 * The fallback is `default` on `Original`, where it means the CLI's own choice,
 * and the first model on a `routed` gateway, which routes on the name and has
 * no choice of its own to fall back to (spec 43 §4.1).
 */
export function agentModel(db: Db, sdk: AgentSdk, models: ModelChoice[], routed: boolean): string {
  const offered = (value: string | null | undefined): value is string =>
    typeof value === "string" && models.some((model) => model.value === value);
  const stored = getSetting(db, agentModelKey(sdk));
  if (offered(stored)) return stored;
  const shipped = SHIPPED_DEFAULTS[sdk]?.model;
  if (offered(shipped)) return shipped;
  return routed ? (models[0]?.value ?? DEFAULT_MODEL) : DEFAULT_MODEL;
}

/**
 * Spec 60 §4 — the effort a new comment on `sdk` starts on.
 *
 * NOT checked against the model's levels here: which levels exist depends on
 * the model, and spec 58 §6.2's cascade in the renderer is where that is known.
 */
export function agentEffort(db: Db, sdk: AgentSdk): string {
  return getSetting(db, agentEffortKey(sdk)) ?? SHIPPED_DEFAULTS[sdk]?.effort ?? DEFAULT_EFFORT;
}

/**
 * Spec 43 §4.0 — the agent and the gateway a new comment starts on, resolved.
 * The model and the effort are per agent and resolve against a list (§4).
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
