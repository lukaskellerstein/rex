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
import { DEFAULT_MODEL, type ModelChoice, type PaperView } from "../../shared/types.ts";

type Db = Database.Database;

/** §6.1 — the app-wide default model. Absent means the SDK's own first row. */
export const MODEL_DEFAULT_KEY = "model.default";

/** Spec 27 §4.7 — how the Markdown page is drawn. Absent means narrow and light. */
export const VIEW_MEASURE_KEY = "view.measure";
export const VIEW_PAPER_KEY = "view.paper";

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
