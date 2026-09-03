// Spec 20 — the agent window: the rules REX answers PW_AGENT with.
//
// The title tag is a cross-repo contract, not a cosmetic: this machine's yabai
// rule (mac-setup, `claude-pw-agent`) matches `\[agent\]$` and places the
// window on the `playwright` desktop AT CREATION, and the Playwright hooks
// read `pw-agent` off `/json/version` to tell an agent's instance from the
// reviewer's. A dropped tag does not error anywhere — the window just quietly
// opens on the reviewer's desktop, which is the exact failure the whole design
// exists to prevent. That is why the rules live in pure functions and why this
// suite states them under plain `node --test`.
//
// Run: npm run test:agent-mode

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AGENT_TAG,
  AGENT_USER_AGENT_MARKER,
  isAgentMode,
  userAgent,
  windowTitle,
} from "../src/main/agentMode.ts";

test("PW_AGENT unset means the reviewer's REX — nothing changes", () => {
  assert.equal(isAgentMode({}), false);
  assert.equal(windowTitle("REX", false), "REX");
  assert.equal(userAgent("Mozilla/5.0 rex/0.1.0", false), "Mozilla/5.0 rex/0.1.0");
});

test("PW_AGENT set to anything but a spelling of off turns agent mode on", () => {
  for (const value of ["1", "true", "yes", "on", "definitely"]) {
    assert.equal(isAgentMode({ PW_AGENT: value }), true, value);
  }
});

test("every spelling of off keeps agent mode off — same set REX_CDP_PORT takes", () => {
  for (const value of ["off", "none", "NO", "false", "0", "", "  OFF  "]) {
    assert.equal(isAgentMode({ PW_AGENT: value }), false, JSON.stringify(value));
  }
});

test("the title ends in the tag, whatever the renderer set it to", () => {
  assert.equal(windowTitle("REX", true), "REX [agent]");
  assert.equal(windowTitle("components.md — REX", true), "components.md — REX [agent]");
});

test("the tag is appended once, however many title updates arrive", () => {
  const once = windowTitle("REX", true);
  assert.equal(windowTitle(once, true), once);
});

test("the tagged title matches the yabai rule's regex — the cross-repo contract", () => {
  // mac-setup's claude-pw-agent rule is `title='\[agent\]$'`. If AGENT_TAG
  // ever changes, this is the test that says the rule must change with it.
  assert.match(windowTitle("REX", true), /\[agent\]$/);
  assert.equal(AGENT_TAG, "[agent]");
});

test("the user agent carries the marker once, and only in agent mode", () => {
  const base = "Mozilla/5.0 rex/0.1.0 Chrome/150";
  const marked = userAgent(base, true);
  assert.ok(marked.includes(AGENT_USER_AGENT_MARKER));
  assert.equal(userAgent(marked, true), marked);
  assert.equal(userAgent(base, false), base);
  // pw.py lowercases what /json/version reports; the marker must already be
  // lowercase or the two sides never match.
  assert.equal(AGENT_USER_AGENT_MARKER, AGENT_USER_AGENT_MARKER.toLowerCase());
});
