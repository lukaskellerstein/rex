#!/usr/bin/env node
/**
 * `npm run package` — build the macOS DMG.
 *
 * REX ships for macOS only (spec 50). `electron-builder.yml` pins `arm64`, and
 * `bundle-python.mjs` stages the host's CPython and then *executes* it, so the
 * build machine must be an arm64 Mac. There is no cross-build and never was.
 *
 * Any arguments are passed through, so `node scripts/package.mjs --dir` is the
 * unpacked build. `REX_PACKAGE_DRY_RUN=1` prints the arguments it would pass
 * and exits, which is what the test uses.
 *
 * **Publishing is always off.** package.json's `homepage` points at GitHub, and
 * from that electron-builder infers a GitHub publisher; on a push in CI its
 * default `onTagOrDraft` then looks for a draft release and dies with "GitHub
 * Personal Access Token is not set" — after the installer was built. Measured
 * on the first run of spec 49's workflow, 2026-09-07: every pull-request job
 * passed and every push job failed on that one line. REX's workflow publishes
 * with `gh` itself, so electron-builder never publishes, unless a `--publish`
 * flag says otherwise.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// By path rather than `require.resolve`, so the package's `exports` map can
// never decide this script's fate.
const cli = resolve(root, "node_modules", "electron-builder", "cli.js");
if (!existsSync(cli)) {
  console.error(`[package] electron-builder is not installed: ${cli}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.some((arg) => arg === "-p" || arg === "--publish" || arg.startsWith("--publish="))) {
  args.push("--publish", "never");
}

if (process.env.REX_PACKAGE_DRY_RUN) {
  console.log(args.join(" "));
  process.exit(0);
}

const result = spawnSync(process.execPath, [cli, "--config", "electron-builder.yml", ...args], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
