// SPEC.md §8.2 and §8.3 — the two profiles, and the marketplace plugins that
// give an agent semantic navigation over the document's repository.
//
// There is exactly one axis: can this agent change files.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { v5 as uuidv5 } from "uuid";
import type { Profile } from "../../shared/types.ts";

/**
 * SPEC.md §8.1 — one thread, one agent, one session. Deterministic, so the
 * session id can always be recomputed from the thread id.
 */
export const REX_NS = "6f9c1f5c-3f1e-53b8-9c2a-0a5d7e4b1c93";

export function sessionIdFor(threadId: string): string {
  return uuidv5(threadId, REX_NS);
}

export interface ProfileConfig {
  /** Removed from the model's context. §8.4 is what actually enforces it. */
  disallowedTools: string[];
  /** A runaway guard, not a budget (§8.2). */
  maxTurns: number | undefined;
  plugins: string[];
}

export const PROFILES: Record<Profile, ProfileConfig> = {
  read: {
    disallowedTools: ["Write", "Edit", "NotebookEdit"],
    maxTurns: 30,
    plugins: [
      "lsp-typescript@claude-my-marketplace",
      "lsp-python@claude-my-marketplace",
      "lsp-go@claude-my-marketplace",
      "lsp-bash@claude-my-marketplace",
    ],
  },
  write: {
    disallowedTools: [],
    maxTurns: undefined,
    plugins: [
      "lsp-typescript@claude-my-marketplace",
      "lsp-python@claude-my-marketplace",
      "lsp-go@claude-my-marketplace",
      "lsp-bash@claude-my-marketplace",
    ],
  },
};

// ── Marketplace resolution (port of marketplace.resolve_plugin_refs) ──

interface MarketplaceSource {
  /** A checkout already on this machine is used as-is rather than re-cloned. */
  local: string;
  url: string;
  branch: string;
}

const MARKETPLACES: Record<string, MarketplaceSource> = {
  "claude-my-marketplace": {
    local: join(homedir(), "Projects/Github/lukaskellerstein/claude-my-marketplace"),
    url: "https://github.com/lukaskellerstein/claude-my-marketplace",
    branch: "main",
  },
};

const CLONE_ROOT = join(homedir(), ".rex", "marketplaces");

/** marketplace name → plugin name → absolute path. */
const resolved = new Map<string, Map<string, string>>();

function marketplacePath(name: string): string | null {
  const source = MARKETPLACES[name];
  if (!source) return null;
  if (existsSync(source.local)) return source.local;

  const clone = join(CLONE_ROOT, name);
  if (existsSync(join(clone, ".git"))) return clone;

  try {
    execFileSync(
      "git",
      ["clone", "--branch", source.branch, "--single-branch", source.url, clone],
      { stdio: "ignore" },
    );
    return clone;
  } catch {
    console.warn(`[rex] marketplace '${name}' is not available locally and could not be cloned`);
    return null;
  }
}

/**
 * Two layouts, as in the reference implementation: a `marketplace.json`
 * manifest, or a flat tree of directories each carrying `plugin.json`.
 */
function discoverPlugins(root: string): Map<string, string> {
  const plugins = new Map<string, string>();
  const manifestPath = join(root, ".claude-plugin", "marketplace.json");

  const record = (dir: string, fallbackName: string): void => {
    const pluginJson = join(dir, ".claude-plugin", "plugin.json");
    if (!existsSync(pluginJson)) return;
    const meta = JSON.parse(readFileSync(pluginJson, "utf8")) as { name?: string };
    plugins.set(meta.name ?? fallbackName, dir);
  };

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      plugins?: Array<{ name?: string; source?: string }>;
    };
    for (const entry of manifest.plugins ?? []) {
      if (!entry.source) continue;
      record(resolve(root, entry.source), entry.name ?? entry.source);
    }
    return plugins;
  }

  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    record(join(root, name), name);
  }
  return plugins;
}

function pluginsFor(marketplace: string): Map<string, string> {
  const cached = resolved.get(marketplace);
  if (cached) return cached;

  const root = marketplacePath(marketplace);
  const discovered = root ? discoverPlugins(root) : new Map<string, string>();
  resolved.set(marketplace, discovered);
  return discovered;
}

/** `plugin-name@marketplace-name` → an SDK plugin config, or nothing. */
export function resolvePluginRefs(refs: string[]): SdkPluginConfig[] {
  const configs: SdkPluginConfig[] = [];
  for (const ref of refs) {
    const at = ref.lastIndexOf("@");
    if (at <= 0) {
      console.warn(`[rex] invalid plugin ref (missing @marketplace): ${ref}`);
      continue;
    }
    const path = pluginsFor(ref.slice(at + 1)).get(ref.slice(0, at));
    if (path) configs.push({ type: "local", path });
    else console.warn(`[rex] could not resolve plugin: ${ref}`);
  }
  return configs;
}

// ── Which LSP plugins a repository actually needs (§8.3) ────────

const LANGUAGE_MARKERS: Array<{ plugin: string; files: string[] }> = [
  { plugin: "lsp-typescript@claude-my-marketplace", files: ["tsconfig.json", "package.json"] },
  {
    plugin: "lsp-python@claude-my-marketplace",
    files: ["pyproject.toml", "requirements.txt", "setup.py", "pyrightconfig.json"],
  },
  { plugin: "lsp-go@claude-my-marketplace", files: ["go.mod"] },
];

/**
 * Loading four language servers into every session costs roughly a gigabyte
 * of RAM each, so only the ones the repository has a marker for are loaded.
 * `lsp-bash` is cheap and shell scripts appear everywhere, so it is always on.
 */
export function pluginsForRepository(cwd: string, profile: Profile): SdkPluginConfig[] {
  const wanted = new Set<string>(["lsp-bash@claude-my-marketplace"]);
  for (const { plugin, files } of LANGUAGE_MARKERS) {
    if (files.some((file) => existsSync(join(cwd, file)))) wanted.add(plugin);
  }
  const allowed = new Set(PROFILES[profile].plugins);
  return resolvePluginRefs([...wanted].filter((plugin) => allowed.has(plugin)));
}
