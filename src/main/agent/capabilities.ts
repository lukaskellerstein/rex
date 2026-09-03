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
      models: models.map((model) => ({
        value: model.value,
        displayName: model.displayName,
        description: model.description,
      })),
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
