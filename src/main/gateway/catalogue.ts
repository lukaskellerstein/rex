// Spec 46 §5.2 — the six provider descriptors, as data the host renders from.
//
// > **The library describes the configuration. The host renders it.**
//
// The same arrangement spec 42 §10 made for gateway kinds, for the same reason:
// REX cannot ship Python into its renderer, so `local-gateway` emits a table and
// REX draws controls from it. `local-gateway/tests/test_catalogue.py` compares
// the committed file with what `providers.py` produces, so the two cannot drift
// without a test failing.
//
// .. warning::
//    **Every string here comes from REX's own source.** Never from a provider,
//    a model, or a config file REX did not write. A label a remote server can
//    set is a remote server writing the host's interface (§14 rule 6).
//
// Read from disk once and cached, rather than imported: `local-gateway/` is
// shipped under `extraResources` in a packaged app (§13) and is not part of the
// bundle that `import` would resolve against.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderDescriptor } from "../../shared/channels.ts";
import { record as logLine } from "../log.ts";
import { gatewayPackageRoot } from "./local.ts";

let cached: ProviderDescriptor[] | null = null;

/**
 * The six, or an empty list with the reason logged.
 *
 * An empty list is survivable and says something true — REX cannot offer a
 * provider it cannot describe — whereas throwing here would take the whole
 * Settings screen down over a missing file.
 */
export function providerCatalogue(): ProviderDescriptor[] {
  if (cached) return cached;
  const path = join(gatewayPackageRoot(), "catalogue.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { providers: ProviderDescriptor[] };
    cached = parsed.providers;
    return cached;
  } catch (error) {
    logLine(
      "error",
      "local-gateway",
      `could not read the provider catalogue at ${path}: ${String(error)}`,
    );
    return [];
  }
}

/** One descriptor by id, or null. The screen greys a provider it cannot describe. */
export function descriptorFor(provider: string): ProviderDescriptor | null {
  return providerCatalogue().find((row) => row.id === provider) ?? null;
}
