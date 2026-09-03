// Spec 25 §7.1 and spec 31 §7.1 — the two pure questions the model and style
// pickers ask of a list: what do I call this pick, and what rows do I draw?
//
// Beside `ModelPick.tsx` rather than in it, because they hold no JSX and this
// machine's test runner hands `.ts` straight to `node` — which strips types and
// cannot parse `.tsx`. The component re-exports both, so every existing import
// is unchanged.

import { DEFAULT_MODEL, type ModelChoice } from "../../shared/types.ts";

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

/** The rows to draw, guarded the same way. */
export function modelRows(models: ModelChoice[] | null | undefined): ModelChoice[] {
  return listOf(models);
}
