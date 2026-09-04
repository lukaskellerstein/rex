// SPEC.md §8.2 and §8.3 — the two profiles, and the marketplace plugins that
// give an agent semantic navigation over the document's repository.
//
// There is exactly one axis: can this agent change files.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { v5 as uuidv5 } from "uuid";
import type { CommonTool } from "../../shared/agent-protocol.ts";
import type { Profile } from "../../shared/types.ts";

/**
 * A plugin directory, as the agent library takes one.
 *
 * Spec 42 §6 — plugins are **paths**, opaque across the pipe: REX resolves the
 * marketplace refs and the adapter wraps each in whatever shape its own SDK
 * wants. The shape is declared here rather than imported, because after spec 42
 * nothing in `src/` imports an agent SDK at all.
 */
export interface PluginDirectory {
  type: "local";
  path: string;
}

/**
 * SPEC.md §8.1 — one thread, one agent, one session. Deterministic, so the
 * session id can always be recomputed from the thread id.
 */
export const REX_NS = "6f9c1f5c-3f1e-53b8-9c2a-0a5d7e4b1c93";

export function sessionIdFor(threadId: string): string {
  return uuidv5(threadId, REX_NS);
}

export interface ProfileConfig {
  /**
   * Removed from the model's context. §8.4 is what actually enforces it.
   *
   * Spec 42 §6 — in the **common** vocabulary, not one SDK's names. `write`
   * becomes `Write` and `NotebookEdit` inside the Claude adapter, and something
   * else inside each of specs 44 to 46, so the profile says what a tool does
   * rather than what one SDK happens to call it.
   */
  disallowedTools: CommonTool[];
  /** A runaway guard, not a budget (§8.2). */
  maxTurns: number | undefined;
  plugins: string[];
}

const LSP_PLUGINS = [
  "lsp-typescript@claude-my-marketplace",
  "lsp-python@claude-my-marketplace",
  "lsp-go@claude-my-marketplace",
  "lsp-bash@claude-my-marketplace",
];

/**
 * Spec 11 §6.4 — the plugins a deck session may load, and no others.
 *
 * §6.4.1 is the rule that chose them: **a skill that supplies judgment or
 * sources helps; a skill that supplies a procedure for a different pipeline
 * hurts.** That is a fact about REX's design rather than a general principle —
 * the write agent's output is a JSON plan (§7.2) and REX performs it, so a
 * skill saying "write a Node script with PptxGenJS" or "run `python3 pack.py`"
 * is telling the agent to do the one thing this whole spec exists to stop. It
 * would not merely be unhelpful; it would fight the plan format, and the agent
 * follows the more specific instruction.
 *
 * `office-plugin` is therefore **excluded despite being about PPTX**. Its
 * `pptx` skill is a deck *generator*. Its knowledge shaped §7 of the spec — read
 * by a human, ported into REX's own TypeScript — and that is the right way for
 * it to reach the agent.
 */
const DECK_PLUGINS = {
  /** Critique of an existing design, which is what "is this slide any good?" is. */
  read: ["design-plugin@claude-my-marketplace"],
  /** Apply sources and specifies pictures, so it needs the media judgment too. */
  write: ["design-plugin@claude-my-marketplace", "media-plugin@claude-my-marketplace"],
} as const;

export const PROFILES: Record<Profile, ProfileConfig> = {
  read: {
    disallowedTools: ["write", "edit"],
    maxTurns: 30,
    plugins: [...LSP_PLUGINS, ...DECK_PLUGINS.read],
  },
  write: {
    disallowedTools: [],
    maxTurns: undefined,
    plugins: [...LSP_PLUGINS, ...DECK_PLUGINS.write],
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

/**
 * Spec 11 §6.4.4, and the thing that section did not go far enough on.
 *
 * An MCP allowlist stops a *tool call*. It does not stop the **server**: the
 * SDK starts every server a loaded plugin declares, at session start, whether
 * or not anything is ever allowed to call it. Measured on 2026-08-25 — a deck
 * Apply with an empty allowlist left `drawio-mcp`, `elevenlabs-mcp`,
 * `media-mcp` and a headless `@playwright/mcp` running. §10 says plainly that
 * none of them may start, and it is right to: one opens a GUI editor, one
 * spawns a second browser, and the remote `mcp.mermaid.ai` would be handed
 * slide content.
 *
 * So the plugin is loaded through a **mirror**: a directory of symlinks to the
 * real one, with a `plugin.json` whose `mcpServers` has been filtered down to
 * what is actually allowed. The skills — which is what §6.4.2 wanted, and five
 * of the seven need no tool at all — arrive intact. The servers do not arrive.
 *
 * The mirror is rewritten every time rather than cached, because the source
 * plugin is a checkout the user edits and a stale copy would ship yesterday's
 * skills.
 */
function mirrorWithoutServers(source: string, keepServers: readonly string[]): string {
  const manifestPath = join(source, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    mcpServers?: Record<string, unknown>;
  };

  const declared = manifest.mcpServers ?? {};
  const kept = Object.fromEntries(
    Object.entries(declared).filter(([name]) => keepServers.includes(name)),
  );
  if (Object.keys(declared).length === Object.keys(kept).length) return source;

  const mirror = join(homedir(), ".rex", "plugins", manifest.name ?? "plugin");
  rmSync(mirror, { recursive: true, force: true });
  mkdirSync(join(mirror, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(mirror, ".claude-plugin", "plugin.json"),
    JSON.stringify({ ...manifest, mcpServers: kept }, null, 2),
  );

  // Everything else is linked rather than copied: the skills are the plugin,
  // they are large, and they are the user's own checkout to keep editing.
  for (const entry of readdirSync(source)) {
    if (entry === ".claude-plugin") continue;
    symlinkSync(join(source, entry), join(mirror, entry));
  }
  return mirror;
}

/** Which of a plugin's declared MCP servers REX is willing to let start. */
const SERVERS_ALLOWED: Record<string, readonly string[]> = {
  // §6.4.3 — `media-mcp` is the one that earns its place, and only with a key.
  // `ElevenLabs`, `drawio`, `media-playwright` and the remote `mermaid`
  // endpoint are never wanted here.
  "media-plugin": [],
};

/** §6.4.3 — the key lets `media-mcp` start; nothing else ever does. */
export function allowGenerationServer(): void {
  SERVERS_ALLOWED["media-plugin"] = ["media-mcp"];
}

/** `plugin-name@marketplace-name` → an SDK plugin config, or nothing. */
export function resolvePluginRefs(refs: string[]): PluginDirectory[] {
  const configs: PluginDirectory[] = [];
  for (const ref of refs) {
    const at = ref.lastIndexOf("@");
    if (at <= 0) {
      console.warn(`[rex] invalid plugin ref (missing @marketplace): ${ref}`);
      continue;
    }
    const name = ref.slice(0, at);
    const path = pluginsFor(ref.slice(at + 1)).get(name);
    if (!path) {
      console.warn(`[rex] could not resolve plugin: ${ref}`);
      continue;
    }
    const allowed = SERVERS_ALLOWED[name];
    configs.push({ type: "local", path: allowed ? mirrorWithoutServers(path, allowed) : path });
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
 *
 * Spec 11 §6.4.2 extends the same marker idea to a deck: **a `.pptx` is a
 * marker like any other**, and the two design plugins load only when the
 * document under review is one. A Markdown review pays nothing for them.
 */
export function pluginsForRepository(
  cwd: string,
  profile: Profile,
  documentPath?: string | null,
): PluginDirectory[] {
  const wanted = new Set<string>(["lsp-bash@claude-my-marketplace"]);
  for (const { plugin, files } of LANGUAGE_MARKERS) {
    if (files.some((file) => existsSync(join(cwd, file)))) wanted.add(plugin);
  }
  if (documentPath && extname(documentPath).toLowerCase() === ".pptx") {
    for (const plugin of DECK_PLUGINS[profile]) wanted.add(plugin);
  }
  const allowed = new Set(PROFILES[profile].plugins);
  return resolvePluginRefs([...wanted].filter((plugin) => allowed.has(plugin)));
}
