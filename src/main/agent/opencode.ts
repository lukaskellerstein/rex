// Spec 47 §2.1 — where the `opencode` program is, and where its files go.
//
// **The host searches; the library never does.** Spec 42 §3.2 keeps
// `agent-runner/` out of REX's settings, and looking through a machine's install
// locations is exactly the kind of decision a host makes and a library must not.
// So this file finds the program and `service.ts` hands the answer to the child
// in its environment; `adapters/opencode/server.py` only checks that the answer
// is still runnable.
//
// The value is **app-wide and not part of a route** (§2.1): every OpenCode route
// must use the same server version, so a per-gateway override would let two
// gateways disagree about which `opencode` REX is talking to, and the symptom
// would be a shape mismatch in one route's event stream.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

/** §2.1 — the reviewer's override. Empty or absent means auto-detect. */
export const OPENCODE_EXECUTABLE_KEY = "agent.opencode_executable";

/** What the library reads. One name, set by `service.ts` on the child. */
export const EXECUTABLE_VAR = "REX_OPENCODE_EXECUTABLE";

/** The root under which the library puts each route's config and each thread's mirror. */
export const HOME_VAR = "REX_OPENCODE_HOME";

/**
 * `~/.rex/opencode` — beside `rex.db` and outside every repository.
 *
 * The same reason `SPEC.md` §9 put the database there and spec 46 §4.3 put the
 * gateway's files there: a project mirror inside a repository is a project
 * mirror somebody commits.
 */
export function openCodeHome(): string {
  return process.env[HOME_VAR] ?? join(homedir(), ".rex", "opencode");
}

/**
 * The install locations to look in, in order, after an override and before `PATH`.
 *
 * `~/.opencode/bin` is where OpenCode's own installer puts it and is where the
 * one on this machine lives — measured 2026-09-07, version 1.18.27. The rest are
 * the ordinary places a package manager would.
 */
function candidates(): string[] {
  return [
    join(homedir(), ".opencode", "bin"),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ].map((root) => join(root, "opencode"));
}

function runnable(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The program named on `PATH`, or null. `which`, without spawning one. */
function onPath(): string | null {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, "opencode");
    if (runnable(candidate)) return candidate;
  }
  return null;
}

export interface OpenCodeExecutable {
  /** The absolute path, or null when REX could not find one. */
  path: string | null;
  /** Which of §2.1's three steps answered. Shown in the gateway sheet. */
  source: "override" | "bundled" | "installed" | "none";
}

/**
 * §2.1 — the override first, a REX-bundled binary second, install locations and
 * `PATH` last.
 *
 * **An override that does not exist is reported as missing rather than ignored.**
 * A reviewer who typed a path and got auto-detection anyway would be running a
 * different program from the one they named, and would have no way to tell.
 */
export function resolveOpenCode(override: string | null): OpenCodeExecutable {
  const named = (override ?? "").trim();
  if (named) {
    const path = isAbsolute(named) ? named : null;
    return { path: path && runnable(path) ? path : null, source: "override" };
  }

  // §2.1 leaves it open whether the program may be redistributed inside a
  // packaged REX, so nothing is bundled today. The step exists because the
  // answer changes where REX looks and not how, and finding it here later is one
  // path rather than a redesign.
  const bundled = process.env.REX_OPENCODE_BUNDLED;
  if (bundled && runnable(bundled)) return { path: bundled, source: "bundled" };

  for (const candidate of candidates()) {
    if (runnable(candidate)) return { path: candidate, source: "installed" };
  }
  const found = onPath();
  return found ? { path: found, source: "installed" } : { path: null, source: "none" };
}

/**
 * The two variables the agent library reads. Empty when there is no program.
 *
 * `service.ts` merges these into the child's environment. They are neither
 * routing nor a credential — the two things that file's comment says must travel
 * per run — but a program path and a directory, which are app-wide by §2.1 and
 * are the same shape as the Codex adapter's own `REX_CODEX_HOME`.
 */
export function openCodeEnvironment(override: string | null): Record<string, string> {
  const found = resolveOpenCode(override);
  return {
    [HOME_VAR]: openCodeHome(),
    ...(found.path ? { [EXECUTABLE_VAR]: found.path } : {}),
  };
}

/**
 * Put the two variables into **this** process's environment, so the agent
 * library's child inherits them.
 *
 * Called before the child is spawned and again whenever the setting changes —
 * and the second call is why `EXECUTABLE_VAR` is deleted rather than left when
 * there is no program: a reviewer who points the override at a path that does
 * not exist must get "REX could not find it", not the last one that worked.
 *
 * `getOverride` is a parameter rather than a database import so this file stays
 * drivable by `node --test` with no schema behind it.
 */
export function applyOpenCode(getOverride: () => string | null): OpenCodeExecutable {
  const found = resolveOpenCode(getOverride());
  process.env[HOME_VAR] = openCodeHome();
  if (found.path) {
    process.env[EXECUTABLE_VAR] = found.path;
  } else {
    delete process.env[EXECUTABLE_VAR];
  }
  return found;
}

/**
 * `opencode --version`, for the sheet. Never fatal and never slow.
 *
 * Synchronous on purpose: it is an IPC handler answering a screen, it takes
 * milliseconds against a program on local disk, and the timeout is what keeps
 * "never slow" true for a path that turns out to be something else entirely.
 */
export function openCodeVersion(path: string): string | null {
  try {
    const done = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 10_000 });
    const text = `${done.stdout ?? ""}${done.stderr ?? ""}`.trim();
    return text ? (text.split("\n")[0]?.trim() ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * What to do about it, or null when there is nothing to do.
 *
 * Three sentences and not one, because the fixes differ. §2.1 — **REX does not
 * install software during a run**, so where there is no program the answer names
 * the prerequisite rather than offering to fetch it.
 */
export function problemWith(
  found: OpenCodeExecutable,
  override: string,
  version: string | null,
): string | null {
  if (found.path === null && found.source === "override") {
    return `REX cannot run '${override}'. Give the full path to the opencode program, or clear this field to let REX look for it.`;
  }
  if (found.path === null) {
    return "REX could not find the opencode program. Install OpenCode, or type its path here. REX does not install software during a run.";
  }
  if (version === null) {
    // It is there and it would not say what it is, which is a different thing
    // from missing and is almost always the wrong program.
    return `${found.path} did not answer \`--version\`. Check that it is the opencode program.`;
  }
  return null;
}
