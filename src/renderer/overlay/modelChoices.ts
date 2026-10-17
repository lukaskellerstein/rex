// Spec 25 §7.1, spec 31 §7.1 and spec 58 §7.1 — the pure questions the model,
// style and effort pickers ask of a list: what do I call this pick, and what
// rows do I draw?
//
// Beside `ModelPick.tsx` rather than in it, because they hold no JSX and this
// machine's test runner hands `.ts` straight to `node` — which strips types and
// cannot parse `.tsx`. The component re-exports both, so every existing import
// is unchanged.

import { DEFAULT_EFFORT, DEFAULT_MODEL, type ModelChoice } from "../../shared/types.ts";

/**
 * A list this component can draw, whatever it was handed.
 *
 * `AgentChoices` promises `models` and `styles` are always arrays, and main
 * keeps that promise on every path — a failed probe returns `[FALLBACK]` and
 * `[DEFAULT_STYLE]` rather than nothing. The promise breaks in exactly one
 * place: a **main process older than the renderer**, replying without a field
 * the renderer has since learned to read.
 *
 * It cost the whole window. `styleRows(undefined)` threw inside the render of
 * `SelectionPanel`, React unmounted the tree, and REX went blank — reported
 * 2026-09-02 as *"the application crashes or empties its UI"* on two unrelated
 * gestures whose only common step was the Selection panel coming forward.
 *
 * `npm run dev` builds main ONCE and never looks at it again — `npm run
 * dev:watch` is the one that rebuilds it. So a dev server left running while
 * the renderer hot-reloads other people's changes drifts into this by itself,
 * and the cure is a restart. This is what happens meanwhile: an empty menu,
 * which is legible and recoverable.
 */
function listOf<T>(list: readonly T[] | null | undefined): T[] {
  return Array.isArray(list) ? [...list] : [];
}

/**
 * Spec 31 §7.1 — output styles, as rows the picker can draw.
 *
 * A style is a bare name and nothing else: `available_output_styles` is a list
 * of strings, so there is no description to show. The tooltip says what the
 * control does rather than what the style does, because REX has no idea what
 * somebody's `.md` file contains and inventing a sentence for it would be REX
 * writing documentation for a file it has never read.
 */
export function styleRows(styles: string[] | null | undefined): ModelChoice[] {
  return listOf(styles).map((name) => ({
    value: name,
    displayName: name,
    description: "The output style this chat is written in.",
  }));
}

/** The name to draw. A null pick shows the model it resolves to, not "Default". */
export function modelLabel(
  models: ModelChoice[] | null | undefined,
  value: string | null,
  fallback: string,
): string {
  const wanted = value ?? fallback;
  const found = listOf(models).find((model) => model.value === wanted);
  if (found) return found.displayName;
  // Spec 25 §6.2 — a stored default the CLI no longer offers. The name is all
  // this can say about it; the tooltip in the menu says the rest.
  return wanted === DEFAULT_MODEL ? "Default" : wanted;
}

/**
 * Spec 58 §7.1 — the menu's "follow the app-wide default" row, saying what that
 * default is: `Default (Sonnet 5.5)`. When the app-wide default is itself the
 * SDK's own choice, the row names what that stands for today:
 * `Default (Fable 5.1, recommended)`.
 */
export function defaultModelLabel(
  models: ModelChoice[] | null | undefined,
  fallback: string,
): string {
  const row = listOf(models).find((model) => model.value === fallback);
  const name = row?.resolvesTo
    ? `${row.resolvesTo}, recommended`
    : modelLabel(models, null, fallback);
  return `Default (${name})`;
}

/** The rows to draw, guarded the same way. */
export function modelRows(models: ModelChoice[] | null | undefined): ModelChoice[] {
  return listOf(models);
}

// ── Spec 58 — the effort ────────────────────────────────────

/**
 * §7.1 — what each level is called, and the one line that says what it does.
 *
 * REX's words, because the CLI gives the levels no description. A level the CLI
 * starts offering later keeps its own word and a plain tooltip (`effortRows`).
 */
const EFFORT_WORDS: Record<string, { name: string; tip: string }> = {
  [DEFAULT_EFFORT]: {
    name: "Default effort",
    tip: "The level this model runs at when REX asks for none.",
  },
  // Spec 60 §6 — Codex's levels at the two ends, beside Claude's five.
  none: { name: "None", tip: "No reasoning at all, where the model allows it." },
  minimal: { name: "Minimal", tip: "Barely any reasoning. Faster than Low." },
  low: { name: "Low", tip: "The least thinking. Fastest and cheapest." },
  medium: { name: "Medium", tip: "Moderate thinking." },
  high: { name: "High", tip: "Deep reasoning." },
  xhigh: { name: "Extra high", tip: "Deeper than High, where the model takes it." },
  max: { name: "Max", tip: "The most the model can do. Slowest and most expensive." },
  ultra: { name: "Ultra", tip: "Beyond Max, where Codex offers it." },
};

/** §3 — the levels the row for `model` offers. Empty when it offers none. */
export function effortLevelsOf(
  models: ModelChoice[] | null | undefined,
  model: string,
): readonly string[] {
  return listOf(models).find((row) => row.value === model)?.effortLevels ?? [];
}

/** §3.1 — the level `model` runs at when REX sends none, or null when not known. */
export function ownEffortOf(
  models: ModelChoice[] | null | undefined,
  model: string,
): string | null {
  return listOf(models).find((row) => row.value === model)?.defaultEffort ?? null;
}

/** §7.1 — what a level is called in the menu: `Medium`, `Extra high`. */
export function effortName(level: string): string {
  return EFFORT_WORDS[level]?.name ?? level;
}

/**
 * §6.2 — the level a send actually carries, for the model it runs on.
 *
 * Null when the model takes no level, so the send says nothing. `default` when
 * the pick is a level this model does not take: `default` is always right, a
 * nearest level would be a guess.
 */
export function effortFor(levels: readonly string[], picked: string): string | null {
  if (levels.length === 0) return null;
  return picked === DEFAULT_EFFORT || levels.includes(picked) ? picked : DEFAULT_EFFORT;
}

/**
 * §7.1 — the menu: `Default effort` first, then the levels in the CLI's order.
 *
 * `own` is the model's own level. The default row names it — `Default effort
 * (Medium)` — because a default the reviewer cannot see is a choice they cannot
 * make (the reviewer's report of 2026-10-17).
 */
export function effortRows(levels: readonly string[], own: string | null = null): ModelChoice[] {
  return [DEFAULT_EFFORT, ...levels].map((level) => ({
    value: level,
    displayName:
      level === DEFAULT_EFFORT && own
        ? `${effortName(level)} (${effortName(own)})`
        : effortName(level),
    description: EFFORT_WORDS[level]?.tip ?? "An effort level the Claude CLI offers.",
  }));
}

/** §7.2 — the level as the answer's foot writes it, or null for none chosen. */
export function effortWord(effort: string | null): string | null {
  if (effort === null || effort === DEFAULT_EFFORT) return null;
  return effortName(effort).toLowerCase();
}
