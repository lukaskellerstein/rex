#!/usr/bin/env node
/**
 * `npm run package` — run electron-builder with the one setting the Windows
 * arm64 installer cannot work without.
 *
 * electron-builder packs the app into `app-<arch>.7z` and lets 7-Zip choose
 * its own filters. Since 7-Zip 23.01 that means the `ARM64` branch filter for
 * arm64 executables:
 *
 *     Method = Delta ARM64 LZMA2:20 LZMA:20 BCJ2
 *
 * NSIS unpacks that archive with the bundled `nsis7z` plugin, which is built on
 * the 7-Zip **19.00** SDK — four years before the filter existed. It cannot
 * decode the files the filter was applied to, so it skips them and reports
 * success. Measured 2026-09-07 on the first Windows arm64 build REX ever made:
 * the installer delivered 16,043 of 19,148 files — every data file, and not
 * one PE binary. Exactly nine were missing, `REX.exe` and the eight DLLs
 * beside it, and the Desktop shortcut pointed at an executable that had never
 * been written. Size is irrelevant: a 606 MB payload failed identically.
 *
 * electron-builder reads `ELECTRON_BUILDER_7Z_FILTER` and passes it to 7-Zip
 * as `-mf=`. An explicit filter stops the auto-selection. `BCJ2` is what x64
 * builds have used for years and what `nsis7z` has always decoded, and a
 * branch filter is lossless on any input — on arm64 code it merely compresses
 * a little worse. With it set, the same installer delivered all 16,087 files
 * in 100 seconds, and the installed app spawned both Python children and
 * served on 24334.
 *
 * It is an environment variable and not a config key, which is why it lives
 * here and not in `electron-builder.yml`: `VAR=x cmd` does not work in
 * cmd.exe, and a build that only works from one shell is a build that fails on
 * the machine it matters on. Harmless on macOS and Linux, where the filter was
 * BCJ2 already.
 *
 * Two things that look like fixes and are not, both measured the same day:
 * `compression: store` is silently overridden — the NSIS target forces
 * `normal` for differential updates — and `nsis.useZip` fails outright,
 * "Error opening ZIP file", because NSIS's zip plugin cannot open a payload
 * this size.
 *
 * Any arguments are passed through, so `node scripts/package.mjs --dir` is the
 * unpacked build.
 *
 * **The architecture defaults to the host's.** `bundle-python.mjs` stages the
 * host's CPython and then executes it, so a build for the other architecture
 * would carry the wrong interpreter and neither Python child would start —
 * and `electron-builder.yml` lists BOTH Windows architectures, because CI
 * builds each on its own runner. Without this default, `npm run package` on
 * the arm64 VM would also produce an x64 installer with arm64 Python inside.
 * An explicit `--x64` or `--arm64` on the command line still wins, and CI
 * always passes one. `REX_PACKAGE_DRY_RUN=1` prints the arguments it would
 * pass and exits, which is what the test uses.
 *
 * **Publishing is always off.** package.json's `homepage` points at GitHub
 * (the .deb needs one), and from that electron-builder infers a GitHub
 * publisher; on a push in CI its default `onTagOrDraft` then looks for a
 * draft release and dies with "GitHub Personal Access Token is not set" —
 * after the installer was built. Measured on the first run of spec 49's
 * workflow, 2026-09-07: every pull-request job passed and every push job
 * failed on that one line. REX's workflow publishes with `gh` itself, so
 * electron-builder never publishes, unless a `--publish` flag says otherwise.
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

const ARCH_FLAGS = new Set(["--x64", "--arm64", "--ia32", "--armv7l", "--universal"]);
const args = process.argv.slice(2);
if (!args.some((arg) => ARCH_FLAGS.has(arg))) {
  args.push(process.arch === "arm64" ? "--arm64" : "--x64");
}
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
  env: {
    ...process.env,
    // Respect an explicit override, for the day someone needs to bisect this.
    ELECTRON_BUILDER_7Z_FILTER: process.env.ELECTRON_BUILDER_7Z_FILTER ?? "BCJ2",
  },
});

process.exit(result.status ?? 1);
