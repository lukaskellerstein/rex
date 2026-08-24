// Spec 11 §6.4 — which plugins a session loads, and when.
//
// The rule being protected is §6.4.1: **a skill that supplies judgment or
// sources helps; a skill that supplies a procedure for a different pipeline
// hurts.** The write agent's output is a JSON plan and REX performs it, so a
// skill telling it to "write a Node script with PptxGenJS" would fight the plan
// format — and the agent follows the more specific instruction. That is why
// `office-plugin` is excluded despite being the one plugin about PPTX, and it
// is the kind of decision that gets quietly undone unless something asserts it.
//
// Run: npm run test:profiles

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pluginsForRepository } from "../src/main/agent/profiles.ts";

const MARKETPLACE = join(homedir(), "Projects/Github/lukaskellerstein/claude-my-marketplace");
const skipUnlessMarketplace = {
  skip: existsSync(MARKETPLACE) ? (false as const) : `not on this machine: ${MARKETPLACE}`,
};

/** The plugin directory names a resolution came back with. */
function names(configs: Array<{ path?: string }>): string[] {
  return configs.map((config) => (config.path ?? "").split("/").pop() ?? "").sort();
}

test("§6.4.2 — a deck loads the two design plugins", skipUnlessMarketplace, () => {
  const loaded = names(pluginsForRepository(MARKETPLACE, "write", "/somewhere/deck.pptx"));
  assert.ok(loaded.includes("media-plugin"), `expected media-plugin, got ${loaded.join(", ")}`);
  assert.ok(loaded.includes("design-plugin"), `expected design-plugin, got ${loaded.join(", ")}`);
});

test("§6.4.2 — a Markdown document pays nothing for them", skipUnlessMarketplace, () => {
  const loaded = names(pluginsForRepository(MARKETPLACE, "write", "/somewhere/notes.md"));
  assert.ok(!loaded.includes("media-plugin"), `media-plugin must not load: ${loaded.join(", ")}`);
  assert.ok(!loaded.includes("design-plugin"), `design-plugin must not load: ${loaded.join(", ")}`);
});

test("§6.4.2 — the read profile critiques but never makes a picture", skipUnlessMarketplace, () => {
  const loaded = names(pluginsForRepository(MARKETPLACE, "read", "/somewhere/deck.pptx"));
  assert.ok(loaded.includes("design-plugin"), "Ask critiques a deck");
  assert.ok(
    !loaded.includes("media-plugin"),
    "a read agent never sources or generates a picture, so it does not carry the plugin that would",
  );
});

test("§6.4.1 — office-plugin is never loaded, for any profile", skipUnlessMarketplace, () => {
  for (const profile of ["read", "write"] as const) {
    const loaded = names(pluginsForRepository(MARKETPLACE, profile, "/somewhere/deck.pptx"));
    assert.ok(
      !loaded.includes("office-plugin"),
      `office-plugin is a deck GENERATOR — PptxGenJS, unpack.py, pack.py — and would tell the agent to do the one thing spec 11 exists to stop (${profile})`,
    );
  }
});

test(
  "a document with no path behaves exactly as it did before spec 11",
  skipUnlessMarketplace,
  () => {
    const loaded = names(pluginsForRepository(MARKETPLACE, "write", null));
    assert.ok(!loaded.includes("media-plugin"));
    assert.ok(!loaded.includes("design-plugin"));
  },
);

/**
 * Spec 11 §10 — "no MCP server starts that was not allowed."
 *
 * The allowlist in `gate.ts` stops a tool CALL. It does not stop a SERVER: the
 * SDK starts every server a loaded plugin declares, at session start, whether
 * or not anything is ever allowed to call it. Measured on 2026-08-25 — a deck
 * Apply with an empty allowlist left `drawio-mcp`, `elevenlabs-mcp`,
 * `media-mcp` and a headless `@playwright/mcp` running, and the process list
 * is exactly where §10 says to look.
 *
 * So `media-plugin` is loaded through a mirror with its `mcpServers` filtered.
 * These tests read the manifest the SDK will actually be given.
 */
test("§10 — media-plugin is loaded with its MCP servers stripped", skipUnlessMarketplace, () => {
  const configs = pluginsForRepository(MARKETPLACE, "write", "/somewhere/deck.pptx");
  const media = configs.find((config) => (config.path ?? "").endsWith("media-plugin"));
  assert.ok(media, "media-plugin is loaded");

  const manifest = JSON.parse(
    readFileSync(join(media.path as string, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { mcpServers?: Record<string, unknown> };

  assert.deepEqual(
    Object.keys(manifest.mcpServers ?? {}),
    [],
    "with no key set, not one of the five servers may start",
  );
});

test(
  "§6.4.2 — the mirror still carries the skills, which is the point",
  skipUnlessMarketplace,
  () => {
    const configs = pluginsForRepository(MARKETPLACE, "write", "/somewhere/deck.pptx");
    const media = configs.find((config) => (config.path ?? "").endsWith("media-plugin"));
    assert.ok(media);

    const skills = readdirSync(join(media.path as string, "skills"));
    // Five of the seven §6.4.2 names need no tool at all, which is why stripping
    // the servers costs nothing REX wanted.
    for (const skill of [
      "visual-planning",
      "image-sourcing",
      "graph-generation",
      "icon-library",
      "svg-mastery",
    ]) {
      assert.ok(skills.includes(skill), `${skill} must survive the mirror`);
    }
  },
);
