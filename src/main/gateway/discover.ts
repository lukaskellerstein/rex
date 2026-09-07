// Spec 46 §5.3 — asking one provider what it serves.
//
// A subprocess and not an HTTP call from main, for the same reason the config
// writer is one: the six providers differ in shape — LM Studio answers one GET
// with everything, Ollama needs two calls, Anthropic wants a different header —
// and that knowledge lives in `local-gateway/probes/`. Having it in TypeScript
// too would be having it twice, and the second copy is always the stale one.
//
// **The key never becomes an argument.** It goes in the child's environment,
// because an argument is visible in `ps` to every process on this machine.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { interpreterFor } from "../python.ts";
import { gatewayPackageRoot } from "./local.ts";

const run = promisify(execFile);

/** One model a provider said it serves. Mirrors `local_gateway.types.DiscoveredModel`. */
export interface DiscoveredModel {
  id: string;
  /** Null when the provider did not say. **Never guessed** (§17). */
  context: number | null;
  kind: "chat" | "embedding" | "unknown";
  /** Null when the provider did not say (§5.5). Null is not "no". */
  tools: boolean | null;
  note: string;
}

export interface DiscoveryResult {
  provider: string;
  models: DiscoveredModel[];
  /** Null when the provider answered. A sentence to show when it did not. */
  error: string | null;
}

/** How long one provider is given. A local engine paging a model in is slow. */
const TIMEOUT_MS = 30_000;

/**
 * What one provider serves, now.
 *
 * **A failure is a result, not a throw.** The Settings screen draws this, and
 * "could not reach LM Studio at …" is a sentence a person can act on, while an
 * exception in a handler is a dialog that says nothing.
 */
export async function discoverProvider(
  provider: string,
  url: string | null,
  key: string | null,
): Promise<DiscoveryResult> {
  const root = gatewayPackageRoot();
  const python = interpreterFor(root);
  if (!existsSync(python)) {
    return {
      provider,
      models: [],
      error: `The gateway has no Python interpreter at ${python}. Run \`uv sync\` in ${root}.`,
    };
  }

  const args = ["-m", "local_gateway", "discover", "--provider", provider];
  if (url) args.push("--url", url);

  try {
    const { stdout } = await run(python, args, {
      cwd: root,
      timeout: TIMEOUT_MS,
      // The key, in the environment and never in `args`.
      env: key ? { ...process.env, REX_PROVIDER_KEY: key } : process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout) as DiscoveryResult;
  } catch (error) {
    return {
      provider,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
