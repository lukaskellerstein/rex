// Spec 46 §4.1 — "enabled means running", and what it costs to mean it.
//
// The switch is not lazy. REX starts the child when the app starts with the
// switch on, and when the switch is turned on. **A switch that says "on" while
// nothing runs is a switch that lies**, and the Settings screen shows the live
// port, which needs a live process.
//
// This module is the seam between the process (`local.ts`, which knows nothing
// about SQLite) and the database (`db/gateways.ts`, which knows nothing about
// processes). Neither should learn about the other, so the three things that
// have to happen in order happen here:
//
//   1. write `config.yaml` from the ticked models
//   2. start the child, taking whatever port it can get
//   3. rewrite the stored routes with that port, before anything resolves one

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { agentService } from "../agent/service.ts";
import type { Db } from "../db/database.ts";
import {
  BUILTIN_GATEWAY_ID,
  isEnabled,
  pointRoutesAtPort,
  setBuiltinModels,
} from "../db/gateways.ts";
import { BUILTIN_GATEWAY_KEY_VAR } from "../db/migrate.ts";
import { listConfigured, listProviders } from "../db/providers.ts";
import { getSetting } from "../db/settings.ts";
import { record as logLine } from "../log.ts";
import { interpreterFor } from "../python.ts";
import { type GatewayEnvironment, gatewayPackageRoot, localGateway } from "./local.ts";
import { configPath } from "./paths.ts";

/** §4.6 and §8 rule 5 — capture request and response bodies. On by default. */
export const CAPTURE_BODIES_KEY = "gateway.captureBodies";

/**
 * §4.4 rule 3 — what is reserved out of a model's window for the reply.
 *
 * Mirrors `local_gateway.types.OUTPUT_RESERVE`, and the two must agree because
 * this side subtracts it when a model is ticked and that side subtracts it when
 * the config is written. It is 8192 because every hand-written config in
 * `ai-gateway/litellm/config/` reserves exactly that: 131072 − 8192 = 122880.
 */
export const OUTPUT_RESERVE = 8192;

export function captureBodies(db: Db): boolean {
  return getSetting(db, CAPTURE_BODIES_KEY) !== "0";
}

const run = promisify(execFile);

/**
 * Ask `local-gateway` to render `config.yaml` (§4.4).
 *
 * A subprocess rather than a TypeScript renderer, because the provider table,
 * the token formula and the four rules of §4.4 all live in Python and having
 * them in two languages is having them disagree. `write-config` reads JSON on
 * stdin and writes the file; **no secret crosses this call**, only the NAME of
 * each provider's variable.
 */
export async function writeConfig(models: ConfigModel[], captureBodies: boolean): Promise<void> {
  const root = gatewayPackageRoot();
  const python = interpreterFor(root);
  if (!existsSync(python)) {
    throw new Error(
      `The gateway has no Python interpreter at ${python}. Run \`uv sync\` in ${root}.`,
    );
  }
  const child = run(python, ["-m", "local_gateway", "write-config", "--out", configPath()], {
    cwd: root,
  });
  child.child.stdin?.end(JSON.stringify({ models, traffic: captureBodies }));
  await child;
}

/** One ticked model, as `write-config` wants it. Mirrors `local_gateway.config.ModelEntry`. */
export interface ConfigModel {
  alias: string;
  provider: string;
  model: string;
  url: string | null;
  keyEnv: string;
  context: number | null;
}

/**
 * §4.4 rule 1 — the variable name one provider's key travels in.
 *
 * Keyed on the **provider row's id**, not on its type, because a person may add
 * two LM Studios on different ports and `REX_PROVIDER_LMSTUDIO` would then name
 * one key for two servers. The row id is unique by construction, so this is
 * too. Non-alphanumerics become `_` because that is all an environment variable
 * name may hold.
 */
export function keyEnvFor(providerId: string): string {
  return `REX_PROVIDER_${providerId.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

/**
 * Build the child's environment: `config.yaml`'s variables, with their values.
 *
 * **This is the only place a provider key becomes a string**, and it happens
 * immediately before spawn (§7.2). Decrypting earlier would mean holding
 * plaintext keys in main for the app's lifetime, for no benefit — the child is
 * the only thing that needs them.
 *
 * A provider whose key cannot be decrypted (a `rex.db` copied from another
 * machine) is simply left out, so the gateway starts and that provider's models
 * fail with its own error. Refusing to start the whole gateway over one
 * unreadable key would be a worse trade.
 */
export function providerEnvironment(
  db: Db,
  decrypt: (id: string) => string | null,
): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const provider of listProviders(db)) {
    const name = keyEnvFor(provider.id);
    const value = provider.hasKey ? decrypt(provider.id) : null;
    // Every model names its key in `config.yaml` and LiteLLM resolves it at
    // load. A provider that needs no key (LM Studio, Ollama) still gets one, so
    // the variable always exists: an UNSET `os.environ/…` makes LiteLLM fall
    // back to whatever `OPENAI_API_KEY` happens to be inherited, which is §4.4
    // rule 1's whole warning. A placeholder is what stops that.
    keys[name] = value ?? "sk-rex-none";
  }
  return keys;
}

/**
 * Start the built-in gateway and make the stored routes true.
 *
 * §4.2.1 is the whole reason this is one function and not two calls a caller
 * makes in whatever order they remember: the routes MUST be rewritten between
 * the child listening and anything resolving a route, and an ordering that
 * lives in a comment is an ordering that will be got wrong.
 */
export async function startBuiltin(db: Db, environment: GatewayEnvironment): Promise<number> {
  const port = await localGateway().start(environment);

  // §7.1 — the master key is random per launch and lives in an environment and
  // nowhere else. Set here rather than in `local.ts` because it is REX's own
  // process being changed, and `local.ts` is the part that must stay drivable
  // by `node --test` with no side effects on the runner.
  const key = localGateway().token();
  if (key) process.env[BUILTIN_GATEWAY_KEY_VAR] = key;

  const moved = pointRoutesAtPort(db, BUILTIN_GATEWAY_ID, port);
  if (moved > 0) {
    logLine(
      "warn",
      "local-gateway",
      `port moved to ${port}; ${moved} route${moved === 1 ? "" : "s"} rewritten. ` +
        "Sessions on this gateway will replay rather than resume, which is correct: " +
        "a different address is a different server.",
    );
  }
  return port;
}

/** Stop the child and take the key back out of this process's environment. */
export async function stopBuiltin(): Promise<void> {
  await localGateway().stop();
  delete process.env[BUILTIN_GATEWAY_KEY_VAR];
}

/**
 * Everything the child needs, assembled from the database.
 *
 * `decrypt` is passed in rather than imported so this file never needs
 * `electron` — `secrets.ts` does, and keeping the two apart is what lets a test
 * drive the whole lifecycle with a fake.
 */
export function gatewayEnvironment(
  db: Db,
  decrypt: (providerId: string) => string | null,
): GatewayEnvironment {
  return {
    providerKeys: providerEnvironment(db, decrypt),
    captureBodies: captureBodies(db),
  };
}

/**
 * Regenerate `config.yaml` from the ticked models, and make the composer agree.
 *
 * Two writes, and the second is the one that is easy to forget: the models a
 * person ticked have to reach `gateway_route.models` as well as `config.yaml`,
 * or the gateway serves aliases the model picker never offers. §4.5 is why one
 * list is enough for all four SDKs.
 */
export async function rebuildConfig(db: Db): Promise<number> {
  const configured = listConfigured(db);
  const models: ConfigModel[] = configured.map((row) => ({
    alias: row.alias,
    provider: row.provider,
    model: row.model,
    url: row.baseUrl,
    keyEnv: keyEnvFor(row.providerId),
    // **`max_input` is the window the PROVIDER stated**, stored raw. §4.4 rule 3
    // is applied exactly once, by `write-config`, and this is the reason the
    // column holds the raw number: a value reduced on the way in and restored
    // on the way out round-trips through a formula with a floor in it, and the
    // floor is not reversible. Measured 2026-09-06 by getting it wrong: a
    // 131072 window came back as 131072 instead of 122880, because subtracting
    // 8192 and adding it again is not the same as doing neither.
    context: row.maxInput,
  }));
  await writeConfig(models, captureBodies(db));
  setBuiltinModels(
    db,
    configured.map((row) => row.alias),
  );
  return models.length;
}

/**
 * §4.3 — a change to providers or models rewrites the config and restarts.
 *
 * **The restart waits for in-flight runs.** A local model turn takes 5 to 15
 * minutes (spec 43 §7), and killing the gateway underneath one would lose it —
 * so this waits, and `onWaiting` is how the screen says that it is waiting
 * rather than appearing to have hung.
 *
 * LiteLLM has no hot reload without a database, and adding a database to get
 * one is not worth 155 MB and a migration step (§17). So the 1.6 seconds is the
 * price, and it is paid where a person just pressed Save and expects a pause.
 */
export async function restartBuiltin(
  db: Db,
  decrypt: (providerId: string) => string | null,
  onWaiting?: (openRuns: number) => void,
): Promise<number | null> {
  await rebuildConfig(db);
  if (!isEnabled(db, BUILTIN_GATEWAY_ID)) return null;

  await waitForRuns(onWaiting);
  await localGateway().stop();
  return startBuiltin(db, gatewayEnvironment(db, decrypt));
}

/** How long a restart will wait for an answer before going ahead anyway. */
const RUN_WAIT_MS = 15 * 60_000;

async function waitForRuns(onWaiting?: (openRuns: number) => void): Promise<void> {
  const deadline = Date.now() + RUN_WAIT_MS;
  let told = false;
  while (Date.now() < deadline) {
    const open = agentService().state().openRuns;
    if (open === 0) return;
    if (!told) {
      onWaiting?.(open);
      told = true;
      logLine("info", "local-gateway", `restart is waiting for ${open} run(s) to finish`);
    }
    await new Promise((settle) => setTimeout(settle, 1_000));
  }
  logLine("warn", "local-gateway", "a run did not finish within 15 minutes; restarting anyway");
}

/**
 * §4.1 — start it at boot if the switch says on, and say nothing if it says off.
 *
 * Never awaited by the caller: the window must not wait on a proxy that takes
 * 1.6 seconds, for the same reason it does not wait on the CDP probe. A failure
 * is recorded and the switch stays on — the Settings screen is where a person
 * finds out, and it reads `state().down` for the sentence.
 */
export function startBuiltinIfEnabled(
  db: Db,
  decrypt: (providerId: string) => string | null,
): void {
  if (!isEnabled(db, BUILTIN_GATEWAY_ID)) return;
  void (async () => {
    // The config is rebuilt first, because a `config.yaml` left over from a
    // previous launch can name a provider the person has since removed — and
    // LiteLLM would then serve a model whose key is gone.
    await rebuildConfig(db);
    await startBuiltin(db, gatewayEnvironment(db, decrypt));
  })().catch((error: unknown) => {
    logLine("error", "local-gateway", error instanceof Error ? error.message : String(error));
  });
}
