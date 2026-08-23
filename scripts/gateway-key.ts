// Mint the capped gateway key REX's fact graph builds through, and cache it.
//
// WHY THIS EXISTS. `src/main/facts/` calls the local LiteLLM gateway, which
// needs a bearer key, and there was no way to give it one except exporting
// `AI_GATEWAY_KEY` by hand in whatever shell REX happened to be started from.
// Miss that and the Facts tab refuses to build — for a reason that is about the
// shell rather than about REX.
//
// WHERE THE KEY GOES, and why not in this repo. `rules/12-security.md` is
// explicit: "Never keep a plaintext credential file, gitignored or not", and
// prescribes the alternative in the same breath — mint short-lived tokens on
// demand into a gitignored, mode-600 file. This goes one better and keeps it
// *outside every repository*, at `~/.rex/gateway-key`, for the same reason
// SPEC.md §9 puts the database at `~/.rex/rex.db`: a file that is not in a
// working tree cannot be committed by accident, from here or from anywhere.
//
// WHAT IT MINTS. Never the master key. `ai-gateway/NOTES.md` is emphatic that
// the master key "mints other keys and has no spending ceiling of its own", so
// it is used once, in this process, to mint a capped and expiring key — and is
// never written down. The scope is the aliases `supervisor.ts` actually
// defaults to, both of which are terminal (local-only, no cloud fallback), so
// this key cannot spend money at a provider even if something asks it to.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GATEWAY = process.env.AI_GATEWAY_URL ?? "http://localhost:24000";
const KEY_FILE = join(homedir(), ".rex", "gateway-key");

/**
 * The aliases `supervisor.ts` builds with — `local-31b` for extract and judge,
 * `embed` for embedding — plus `local`, the one an override is most likely to
 * reach for. `cheap` and `standard` are deliberately absent: they bill a cloud
 * provider, and a key that cannot reach them cannot run up a bill.
 */
const MODELS = ["local", "local-31b", "embed"];
const MAX_BUDGET = 2.0;
const DURATION = "30d";

const GATEWAY_REPO =
  process.env.AI_GATEWAY_REPO ?? join(homedir(), "Projects/Github/lukaskellerstein/ai-gateway");

/** `KEY=value`, with surrounding quotes taken off, from a dotenv-shaped file. */
function readEnvValue(file: string, name: string): string | null {
  try {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((entry) => entry.trimStart().startsWith(`${name}=`));
    if (!line) return null;
    const value = line.slice(line.indexOf("=") + 1).trim();
    return value.replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}

/**
 * The master key, from the gateway's own checkout and nowhere else.
 *
 * Three places, in the order the gateway itself resolves them: the environment,
 * a `.env` beside `compose.yml`, and finally the default written INTO
 * `compose.yml` as `${LITELLM_MASTER_KEY:-…}`.
 *
 * That last one is parsed rather than copied here on purpose. A credential
 * literal in this repository is what `rules/12-security.md` forbids outright —
 * "Never a literal" — and copying it would also silently rot the day the
 * gateway changes its default. Reading it means REX has no key of its own to
 * leak, only a path to where the truth lives.
 *
 * Whatever it finds is used once, in this process, for one localhost request,
 * and is never written down: `ai-gateway/NOTES.md` is emphatic that the master
 * key "has no spending ceiling of its own", which is exactly why what gets
 * cached is the capped key it mints instead.
 */
function masterKey(): string | null {
  if (process.env.LITELLM_MASTER_KEY) return process.env.LITELLM_MASTER_KEY;

  const fromDotEnv = readEnvValue(join(GATEWAY_REPO, ".env"), "LITELLM_MASTER_KEY");
  if (fromDotEnv) return fromDotEnv;

  // `      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:-sk-…}` in compose.yml.
  try {
    const compose = readFileSync(join(GATEWAY_REPO, "compose.yml"), "utf8");
    const fallback = compose.match(/LITELLM_MASTER_KEY:\s*\$\{LITELLM_MASTER_KEY:-([^}]+)\}/);
    if (fallback?.[1]) return fallback[1].trim();
  } catch {
    // Handled by the caller: without the checkout there is nothing to read.
  }
  return null;
}

/** `curl` rather than `fetch`, so this runs the same under node and under tsx. */
function post(path: string, key: string, body: unknown): string {
  return execFileSync(
    "curl",
    [
      "-sS",
      "--max-time",
      "15",
      "-X",
      "POST",
      `${GATEWAY}${path}`,
      "-H",
      `Authorization: Bearer ${key}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    { encoding: "utf8" },
  );
}

function get(path: string, key: string): string {
  return execFileSync(
    "curl",
    ["-sS", "--max-time", "10", `${GATEWAY}${path}`, "-H", `Authorization: Bearer ${key}`],
    { encoding: "utf8" },
  );
}

/**
 * Whether the cached key still works — a key expires, and a budget is spent.
 *
 * `/key/info` nests everything under `info`, and reading `key_name` from the
 * top level instead quietly answered "invalid" for a perfectly good key. That
 * is not a harmless mistake: this runs on every `npm run dev`, so it minted a
 * fresh key each time and left a trail of them on the gateway.
 */
function stillValid(key: string): boolean {
  try {
    const body = JSON.parse(get("/key/info", key)) as {
      error?: unknown;
      info?: { key_name?: string; expires?: string; max_budget?: number; spend?: number };
    };
    const info = body.info;
    if (body.error || !info?.key_name) return false;
    if (info.expires && Date.parse(info.expires) <= Date.now()) return false;
    return !(info.max_budget !== undefined && (info.spend ?? 0) >= info.max_budget);
  } catch {
    return false;
  }
}

function cached(): string | null {
  try {
    const key = readFileSync(KEY_FILE, "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function main(): void {
  // The gateway has to be up to mint anything. Said plainly, because "start the
  // gateway" is a different job from "get a key".
  try {
    get("/health/liveliness", "");
  } catch {
    console.error(
      `[rex] the AI gateway is not answering at ${GATEWAY}. Start it (ai-gateway/compose.yml) and run this again.`,
    );
    process.exit(1);
  }

  const existing = cached();
  if (existing && stillValid(existing)) {
    console.log(`[rex] gateway key in ${KEY_FILE} is still valid — nothing to do.`);
    return;
  }

  const master = masterKey();
  if (!master) {
    console.error(
      `[rex] no LiteLLM master key. Export LITELLM_MASTER_KEY, or point AI_GATEWAY_REPO at the ai-gateway checkout (looked in ${GATEWAY_REPO}).`,
    );
    process.exit(1);
  }

  const response = post("/key/generate", master, {
    models: MODELS,
    max_budget: MAX_BUDGET,
    duration: DURATION,
    metadata: { minted_by: "rex/scripts/gateway-key.ts" },
  });

  let key: string;
  try {
    const parsed = JSON.parse(response) as { key?: string; error?: { message?: string } };
    if (!parsed.key) throw new Error(parsed.error?.message ?? response.slice(0, 200));
    key = parsed.key;
  } catch (cause) {
    console.error(`[rex] the gateway refused to mint a key: ${String(cause)}`);
    process.exit(1);
  }

  mkdirSync(join(homedir(), ".rex"), { recursive: true });
  // Written before the mode is tightened, so there is a moment where it is
  // 0644 — `writeFileSync`'s own mode argument closes that, and chmod after is
  // belt and braces for a file that already existed with looser bits.
  writeFileSync(KEY_FILE, `${key}\n`, { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);

  // The VALUE is never printed — rules/12-security.md. That it was written is.
  console.log(
    `[rex] minted a gateway key (${MODELS.join(", ")}, $${MAX_BUDGET.toFixed(2)} cap, ${DURATION}) → ${KEY_FILE}`,
  );
}

main();
