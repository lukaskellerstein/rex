// Spec 46 §4.3 and §4.6 — where the built-in gateway keeps its things.
//
// All of it under `~/.rex/gateway/`, beside `rex.db` and outside every
// repository, so nothing here can be committed by accident — the same reason
// SPEC.md §9 put the database there.
//
// Its own module for the reason `db/location.ts` is one: these paths are read
// by main, by a test, and by the debug report, and importing the child manager
// to learn a directory name would drag a process manager into all three.

import { homedir } from "node:os";
import { join } from "node:path";

/** `~/.rex/gateway` — the config, the pid file and the traffic log. */
export function gatewayDir(): string {
  return process.env.REX_GATEWAY_DIR ?? join(homedir(), ".rex", "gateway");
}

/** §4.4 — the config REX writes, regenerated whole on every change. */
export function configPath(): string {
  return join(gatewayDir(), "config.yaml");
}

/**
 * §4.3 — pid and port, so the next start can clean up after a hard kill.
 *
 * It exists because a `SIGKILL` on REX skips every handler REX has, and what is
 * left behind is a proxy holding every provider key in its environment with
 * nobody watching it.
 */
export function childRecordPath(): string {
  return join(gatewayDir(), "child.json");
}

/** §4.6 — one file per day, thirty days. */
export function trafficDir(): string {
  return join(gatewayDir(), "traffic");
}
