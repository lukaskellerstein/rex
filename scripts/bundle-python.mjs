#!/usr/bin/env node
/**
 * Spec 46 §13 — stage a self-contained Python runtime for packaging.
 *
 * Produces `python-dist/`: a relocatable CPython (python-build-standalone, via
 * `uv`) with **both** Python packages installed. `electron-builder` ships it
 * under `Resources/python/`, which is where `interpreterFor()` already looks
 * (`src/main/python.ts`), so a packaged REX runs its agents and its gateway
 * with no system Python at all.
 *
 * Ported from Vex's `electron-app/scripts/bundle-python.mjs`, as §13 says. Four
 * things are different, and each is a fact about REX rather than a preference:
 *
 *   1. **Two packages, not one.** `agent-runner/` and `local-gateway/` are
 *      siblings that never import each other, and both are installed here.
 *   2. **Windows.** Vex's copy hardcodes `bin/` and a `python3.11` symlink;
 *      Windows has `Scripts/python.exe` and no symlinks. §18.1 item 4 names
 *      this as the likeliest thing to break the first time REX runs there.
 *   3. **Python 3.12**, which is what `.python-version` pins in both packages.
 *   4. **`polars` is deleted after install.** Measured 2026-09-06: it is 193 MB
 *      of the runtime and is imported only by three LiteLLM spend-report
 *      integrations REX never calls (`cloudzero`, `focus`, `vantage`). With it
 *      gone the proxy still starts in ~3 s, serves `/v1/models`, and answers a
 *      real `/v1/messages` turn. 507 MB → 310 MB.
 *
 * Run: `npm run bundle:python`
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, globSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Both packages pin this in `.python-version`. Keep the three in step. */
const PYTHON_VERSION = "3.12";

/**
 * §13 — removed after install, with the measurement attached.
 *
 * Deleted here rather than excluded from the dependency list, because
 * `litellm[proxy]` requires it: `uv` would put it straight back on the next
 * sync. The development venv keeps it, which costs nothing; only the shipped
 * runtime is trimmed.
 */
const DROP = ["polars", "_polars_runtime_32", "polars_runtime_32"];

const windows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const outDir = join(root, "python-dist");

function run(command, args, options = {}) {
  const out = execFileSync(command, args, { stdio: "pipe", encoding: "utf8", ...options });
  return typeof out === "string" ? out.trim() : "";
}

function log(message) {
  console.log(`[bundle-python] ${message}`);
}

function megabytes(path) {
  try {
    return Number(run("du", ["-sm", path]).split(/\s+/)[0]);
  } catch {
    return 0; // no `du` on Windows; the number is a nicety, not a step
  }
}

// ── the interpreter ─────────────────────────────────────────────

log(`ensuring CPython ${PYTHON_VERSION} via uv`);
run("uv", ["python", "install", PYTHON_VERSION], { stdio: "inherit" });

// uv may report an alias directory whose entries symlink into the concrete
// patch-version one. Resolve the real executable, or the copy below is a tree
// of symlinks pointing back into uv's cache — which is not relocatable and
// breaks on a machine that has no uv.
const reported = run("uv", ["python", "find", PYTHON_VERSION]);
if (!existsSync(reported)) {
  throw new Error(`uv reported a Python path that does not exist: ${reported}`);
}
const found = realpathSync(reported);
// Standalone layout: `<root>/bin/python3.12`, or `<root>/python.exe` on
// Windows. The relocatable root is two levels up on POSIX and one on Windows.
const standaloneRoot = windows ? dirname(found) : dirname(dirname(found));
log(`standalone CPython at ${standaloneRoot}`);

log(`staging into ${outDir}`);
rmSync(outDir, { recursive: true, force: true });
cpSync(standaloneRoot, outDir, { recursive: true, dereference: false });

// PEP 668: the original is flagged "externally managed by uv", and pip refuses
// to install into a tree carrying that marker.
for (const marker of globSync(join(outDir, "lib", "python*", "EXTERNALLY-MANAGED"))) {
  rmSync(marker, { force: true });
}
for (const marker of globSync(join(outDir, "Lib", "EXTERNALLY-MANAGED"))) {
  rmSync(marker, { force: true });
}

// uv copies `python` and `python3` as ABSOLUTE symlinks back into its cache;
// only `python3.12` is a real binary. Re-point them at the local one so the
// bundled interpreter resolves its own prefix to `python-dist`. Windows has no
// symlinks here and needs none — `python.exe` is the real file.
if (!windows) {
  for (const alias of ["python", "python3"]) {
    const link = join(outDir, "bin", alias);
    rmSync(link, { force: true });
    symlinkSync(`python${PYTHON_VERSION}`, link);
  }
}

// The same layout `interpreterFor()` looks for (`src/main/python.ts`). If these
// two ever disagree, a packaged REX cannot start either child — so the check is
// here, where it fails during a build rather than on somebody's machine.
const bundled = windows ? join(outDir, "python.exe") : join(outDir, "bin", "python3");
if (!existsSync(bundled)) {
  throw new Error(`the bundled interpreter is not at ${bundled}`);
}
log(`bundled interpreter: ${run(bundled, ["--version"])}`);

// ── both packages ───────────────────────────────────────────────

for (const name of ["agent-runner", "local-gateway"]) {
  log(`installing ${name}`);
  run("uv", ["pip", "install", "--python", bundled, join(root, name)], { stdio: "inherit" });
}

// ── §13's trim, with its measurement ────────────────────────────

const before = megabytes(outDir);
let dropped = 0;
for (const name of DROP) {
  for (const path of [
    ...globSync(join(outDir, "lib", "python*", "site-packages", name)),
    ...globSync(join(outDir, "lib", "python*", "site-packages", `${name}-*.dist-info`)),
    ...globSync(join(outDir, "Lib", "site-packages", name)),
    ...globSync(join(outDir, "Lib", "site-packages", `${name}-*.dist-info`)),
  ]) {
    rmSync(path, { recursive: true, force: true });
    dropped += 1;
  }
}
const after = megabytes(outDir);
log(`dropped ${dropped} polars path(s): ${before} MB → ${after} MB`);

// Proof rather than hope. If a future LiteLLM imports polars at start-up, this
// is where that is discovered — in a build, by the person who can act on it.
log("checking the proxy still imports without polars");
run(bundled, ["-c", "import litellm.proxy.proxy_server"], { stdio: "inherit" });
run(bundled, ["-c", "import agent_runner, local_gateway"], { stdio: "inherit" });

log(`done. ${outDir} is ready for electron-builder (${after} MB).`);
