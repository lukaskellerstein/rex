// Spec 46 §13 — finding a Python package and its interpreter, for both of them.
//
// REX ships two Python packages: `agent-runner/` (spec 42, the pipe) and
// `local-gateway/` (spec 46, the proxy). They are found the same way and run by
// the same rules, so the rules live here once rather than being copied and then
// diverging — which is exactly what would have happened, because the second
// copy is always written by someone reading the first.
//
// **Two layouts, and the packaged one wins where it exists.** In development
// each package has its own `.venv` beside its `pyproject.toml`; in a packaged
// app there is no repository at all, and `electron-builder` has staged one
// runtime at `Resources/python` with BOTH packages installed into its
// site-packages (`scripts/bundle-python.mjs`). Getting that precedence wrong is
// not a style point — it was measured on 2026-09-06, when a packaged REX
// launched from inside the repo and quietly spawned the development venv. On a
// real install there is no such venv, so neither child would have started at
// all, and the first person to find out would have been somebody who installed
// REX rather than built it.
//
// No `electron` import, deliberately, for the reason `service.ts` has none:
// `node --test` drives both of them directly. `process.resourcesPath` is set by
// Electron on the process object rather than exported by the module, so reading
// it costs no import and is `undefined` everywhere else.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Where `electron-builder` stages the runtime (`electron-builder.yml`). */
const BUNDLED_DIR = "python";

/** `Resources/` in a packaged app, and null in development or a test. */
function resourcesPath(): string | null {
  const path = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return path && existsSync(join(path, BUNDLED_DIR)) ? path : null;
}

/** The interpreter inside the staged runtime, or null when there is none. */
export function bundledInterpreter(): string | null {
  const resources = resourcesPath();
  if (!resources) return null;
  const candidate = join(resources, BUNDLED_DIR, bundledLeafFor());
  return existsSync(candidate) ? candidate : null;
}

/**
 * Where a **venv** keeps its interpreter: `Scripts\python.exe` on Windows,
 * `bin/python` everywhere else.
 *
 * This is the development layout, the one beside a `pyproject.toml`.
 */
function venvLeafFor(): string {
  return process.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python");
}

/**
 * Where the **staged runtime** keeps its interpreter — which is NOT the same
 * place, and that difference is the bug spec 46 §18.1 item 4 predicted.
 *
 * A python-build-standalone distribution puts `python.exe` at its ROOT on
 * Windows; `Scripts\` holds pip and its friends and no interpreter at all. On
 * POSIX both layouts agree on `bin/`, which is exactly why macOS could never
 * catch this and why the two were written as one function.
 *
 * **Measured 2026-09-07**, on the first Windows arm64 package ever built:
 * `resources\python\Scripts\python.exe` did not exist, `resources\python\python.exe`
 * did. A packaged Windows REX would have started and then failed to spawn
 * either Python child — the agent library and the gateway both.
 *
 * `scripts/bundle-python.mjs` has always known this: its own existence check
 * uses `python.exe` at the root on Windows. The two files disagreed, which is
 * the failure its comment warns about in so many words.
 */
function bundledLeafFor(): string {
  return process.platform === "win32" ? "python.exe" : join("bin", "python");
}

/**
 * Where to run a package from.
 *
 * In a packaged app that is `Resources/`: the package is installed into the
 * bundled runtime's site-packages, so `python -m local_gateway` finds it and
 * there is no source tree to point at. In development it is the directory
 * holding the package's `pyproject.toml`, found by **looking for it** rather
 * than by counting `..` — main is bundled to `out/main/index.js` at runtime and
 * lives at `src/main/*.ts` in a test, and those are different depths.
 */
export function packageRoot(name: string, from: string, override?: string): string {
  if (override) return resolve(override);

  const resources = resourcesPath();
  if (resources) return resources;

  let here = from;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(here, name);
    if (existsSync(join(candidate, "pyproject.toml"))) return candidate;
    const up = dirname(here);
    if (up === here) break;
    here = up;
  }
  // Nothing found. Return the path the message will name, so the sentence the
  // reviewer reads points at a real place rather than at nothing.
  return join(process.cwd(), name);
}

/**
 * Spec 42 §4.1 step 1 — the interpreter, and never `python` from `PATH`.
 *
 * A Mac app started from the Dock gets a stunted `PATH` — which is the whole
 * reason Vex carries a `system-path.ts` — so the one on `PATH` is either absent
 * or the wrong one.
 *
 * **The bundled runtime is asked for first.** A packaged REX that found a
 * development venv would be running code the installer never shipped, and one
 * launched anywhere else would find nothing; both are worse than simply using
 * what was staged. `REX_PYTHON` still overrides everything, which is how a
 * bisect points REX at some other interpreter on purpose.
 */
export function interpreterFor(root: string): string {
  const override = process.env.REX_PYTHON;
  if (override) return override;

  const bundled = bundledInterpreter();
  if (bundled) return bundled;

  const venv = join(root, ".venv", venvLeafFor());
  if (existsSync(venv)) return venv;

  // Nothing found. The venv path is what the "run `uv sync`" message names, and
  // it points at a real place a person can act on.
  return venv;
}
