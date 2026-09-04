// Spec 25 §3 and spec 31 §3 — REX holds no list of model or style names. It asks.
//
// The lists are this ACCOUNT's and this CLI VERSION's: a model the account has
// no credits for, a model released next month, and a style somebody wrote into
// `~/.claude/output-styles/` all come out right with no change here. A
// hardcoded `claude-opus-5` would be a claim REX cannot check, and a wrong one
// fails inside a run the reviewer has already paid to start.
//
// Spec 31 §3.1 — ONE call answers both. `initializationResult()` carries
// `models` and `available_output_styles` together, so this replaces spec 25's
// `supportedModels()` rather than joining it: one CLI process at startup
// instead of two, and two lists that can never disagree about which session
// they came from. That is why the file is no longer called `models.ts`.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_MODEL, DEFAULT_STYLE, type ModelChoice } from "../../shared/types.ts";

/** §3.4 — what the pickers show when the CLI could not be asked. */
export interface CapabilityProbe {
  models: ModelChoice[];
  /** Spec 31 §3 — output style names, as the CLI lists them. */
  styles: string[];
  error: string | null;
}

/**
 * §3.4 — the one row a failed probe leaves, and no more.
 *
 * **Not a static list of ids.** A stale id is worse than no choice, because it
 * is sent and rejected inside a paid run rather than in the picker. And a probe
 * that cannot answer means the CLI cannot start, so no run would have worked
 * either — the picker is not the thing that is broken.
 */
const FALLBACK: ModelChoice = {
  value: DEFAULT_MODEL,
  displayName: "Default",
  description: "Whatever the Claude CLI is configured to use.",
};

const TIMEOUT_MS = 10_000;

/**
 * Spec 25 §3.2 — a prompt stream that never yields.
 *
 * `initializationResult()` is a method on the `Query` object and `query()`
 * needs a prompt, so the prompt is a generator that starts the CLI, completes
 * the handshake, and sends the model nothing. **No user message is ever sent,
 * so no tokens are spent.**
 */
async function* silent(): AsyncGenerator<never> {
  await new Promise(() => {});
}

/** Spec 31 §3.3 — what a probe that answered nothing useful leaves behind. */
function failed(reason: string): CapabilityProbe {
  return {
    models: [FALLBACK],
    styles: [DEFAULT_STYLE],
    error: `REX could not ask the Claude CLI what it offers, so only the defaults are available. ${reason}`,
  };
}

// ── Spec 25 §6.4 — naming a model row ───────────────────────────
//
// The CLI's own `displayName` is not always enough to tell two rows apart, and
// on 2026-09-03 it stopped being enough here: the list held **two rows both
// called `Fable`**, whose descriptions ALSO both read "Fable 5". The only field
// that differed was the id — `claude-fable-5` against `claude-fable-5-1`.
//
// That is not a bug in the CLI: `displayName` is a family name and it is the
// right thing for a menu that shows one row per family. It is REX's problem the
// moment two rows of the same family are offered at once, and REX has the field
// that settles it, so REX builds the name.
//
// The rule is narrow on purpose. The id is parsed, and **only** what it really
// carries is shown; nothing is inferred and nothing is invented. An id that
// does not parse keeps the CLI's own name, which is the honest fallback for a
// naming scheme REX has not seen before.

/** `[1m]` in either id → `1M`. Absent from `resolvedModel` on some rows, so both are read. */
function contextOf(value: string, resolved: string | undefined): string | null {
  const found = /\[(\d+m)\]/i.exec(value) ?? /\[(\d+m)\]/i.exec(resolved ?? "");
  return found ? found[1].toUpperCase() : null;
}

/**
 * `claude-fable-5-1` → `Fable 5.1`, `claude-haiku-4-5-20251001` → `Haiku 4.5`.
 *
 * Null when the id is not a model id at all — `default` is the one that
 * matters, and it must keep the CLI's name: what it resolves to today is not
 * what it means, and a row labelled by today's answer would be wrong tomorrow.
 *
 * The date suffix is dropped by taking only one- and two-digit segments. It is
 * a snapshot, not a version, and `Haiku 4.5.20251001` names nothing a person
 * would recognise.
 */
function familyVersion(id: string): string | null {
  const bare = id.replace(/\[[^\]]*\]/g, "").replace(/^claude-/, "");
  const [family, ...rest] = bare.split("-");
  if (!family || !/^[a-z]+$/i.test(family)) return null;

  const digits: string[] = [];
  for (const part of rest) {
    if (!/^\d{1,2}$/.test(part)) break;
    digits.push(part);
  }
  if (digits.length === 0) return null;

  return `${family[0].toUpperCase()}${family.slice(1)} ${digits.join(".")}`;
}

/**
 * One row's name — spec 25 §6.4, and the reviewer's ask on 2026-09-03: *"the
 * naming in the dropdown should clearly show me this... include the version
 * perhaps and the context length if the name of the model provides this"*.
 */
function nameFor(row: { value: string; resolvedModel?: string; displayName: string }): string {
  const named = familyVersion(row.value) ?? resolvedName(row);
  if (named === null) return row.displayName;

  const context = contextOf(row.value, row.resolvedModel);
  return context ? `${named} (${context})` : named;
}

/**
 * The resolution's name — but only when the row is an **alias** for it.
 *
 * `sonnet` carries no version and `claude-sonnet-5` does, so an alias has to
 * borrow its resolution's name to gain one. `default` resolves too, and must
 * NOT borrow: it means "whatever the CLI is set to", so naming it `Opus 5 (1M)`
 * would be right today, wrong the day the default moves, and — measured by this
 * spec's own test on 2026-09-03 — a second row reading exactly the same as the
 * real Opus row.
 *
 * The two are told apart by whether the value names the resolution's family.
 * `sonnet` is the family word of `claude-sonnet-5`; `default` is not the family
 * word of `claude-opus-5`, which is what makes it a choice rather than a name.
 */
function resolvedName(row: { value: string; resolvedModel?: string }): string | null {
  const named = familyVersion(row.resolvedModel ?? "");
  if (named === null) return null;
  const family = named.split(" ")[0].toLowerCase();
  return row.value.replace(/\[[^\]]*\]/g, "").toLowerCase() === family ? named : null;
}

/**
 * The rows, named — and **named apart**.
 *
 * The second pass is the guarantee, and it is what makes this safe against a
 * list REX has never seen: if two rows still read the same after §6.4's rule,
 * both get their id appended. A parser cannot promise to tell every future pair
 * apart; a uniqueness check can, because `value` is the key the CLI keys on and
 * is unique by construction.
 */
export function nameModels(
  rows: readonly {
    value: string;
    resolvedModel?: string;
    displayName: string;
    description: string;
  }[],
): ModelChoice[] {
  const named = rows.map((row) => ({ row, name: nameFor(row) }));
  const seen = new Map<string, number>();
  for (const { name } of named) seen.set(name, (seen.get(name) ?? 0) + 1);

  return named.map(({ row, name }) => ({
    value: row.value,
    displayName: (seen.get(name) ?? 0) > 1 ? `${name} · ${row.value}` : name,
    // The wire id, always. The CLI's own sentence said "Fable 5" for both Fable
    // rows on 2026-09-03, so the tooltip needs something that cannot be stale.
    description: `${row.description} · ${row.resolvedModel ?? row.value}`,
  }));
}

async function probe(cwd: string): Promise<CapabilityProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const running = query({
      // The SDK types the streaming form as `AsyncIterable<SDKUserMessage>`. A
      // generator that yields nothing satisfies it at runtime and cannot at the
      // type level, because `never` is not `SDKUserMessage` — which is the
      // point: it never produces one.
      prompt: silent() as never,
      options: { abortController: controller, cwd },
    });
    const init = await running.initializationResult();
    controller.abort();

    const models = init.models ?? [];
    // §3 — the style list may legitimately be short; the model list may not.
    // A CLI that offers no model at all is a CLI nothing would run on.
    if (models.length === 0) return failed("It offered no models.");

    const styles = init.available_output_styles ?? [];
    return {
      models: nameModels(models),
      // The CLI's own `default` first, and then whatever else it knows. Its
      // list already contains `default`, so this only guards the shape.
      styles: styles.includes(DEFAULT_STYLE) ? styles : [DEFAULT_STYLE, ...styles],
      error: null,
    };
  } catch (error) {
    controller.abort();
    return failed(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spec 25 §3.3 — one CLI process per app run, and never on the reviewer's time.
 *
 * A module-level promise: the first caller starts the probe and every later one
 * gets the same answer. Main starts it when the window is created, so it has
 * long resolved before any text has been selected.
 *
 * `cwd` does not change the model list, which is the account's. It CAN change
 * the style list — spec 31 §3.2 — because a project may carry its own styles in
 * `.claude/output-styles/`. REX probes once and so offers only the built-in and
 * user-level styles, which is the limit that makes the simple design safe:
 * every value it returns is valid in every working directory, so a style picked
 * on one comment can never fail on another in a different repository.
 */
let pending: Promise<CapabilityProbe> | null = null;

export function listCapabilities(cwd: string): Promise<CapabilityProbe> {
  pending ??= probe(cwd);
  return pending;
}
