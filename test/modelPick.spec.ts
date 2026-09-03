// The 2026-09-02 report — "the application crashes or empties its UI" — as a
// unit.
//
// `AgentChoices` promises `models` and `styles` are always arrays, and main
// keeps that promise on every path. It breaks in exactly one place: a main
// process OLDER than the renderer, replying without a field the renderer has
// since learned to read. `npm run dev` rebuilds the renderer on save and left
// main alone, so any session that added a field met this.
//
// The cost was the whole window: `styleRows(undefined)` threw inside the render
// of `SelectionPanel`, React unmounted the tree, and REX went blank. Two
// unrelated gestures were reported — "Select file" from the tree menu, and
// picking the whole document — whose only common step is that the Selection
// panel comes forward and renders.
//
// `npm run dev` builds main once; `npm run dev:watch` is the one that rebuilds
// it. A dev server left running therefore drifts into this on its own, and the
// cure is a restart. These pin what happens meanwhile, because a picker with no
// list must be an empty menu and never a blank application.
//
// Run: npm run test:model-pick

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { modelLabel, styleRows } from "../src/renderer/overlay/modelChoices.ts";
import { DEFAULT_MODEL, type ModelChoice } from "../src/shared/types.ts";

const MODELS: ModelChoice[] = [
  { value: "claude-opus-5", displayName: "Opus 5", description: "The big one." },
  { value: "claude-sonnet-5", displayName: "Sonnet 5", description: "The quick one." },
];

test("styleRows turns names into rows", () => {
  const rows = styleRows(["default", "terse"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].value, "default");
  assert.equal(rows[0].displayName, "default");
  assert.ok(rows[0].description.length > 0);
});

test("styleRows survives a reply with no styles at all", () => {
  // The reported crash, exactly: a main built before `styles` existed.
  assert.deepEqual(styleRows(undefined), []);
  assert.deepEqual(styleRows(null), []);
});

test("styleRows survives a field that is not a list", () => {
  // A shape nobody designed is still not a reason to unmount the application.
  assert.deepEqual(styleRows("default" as unknown as string[]), []);
  assert.deepEqual(styleRows({} as unknown as string[]), []);
});

test("modelLabel names the model a pick resolves to", () => {
  assert.equal(modelLabel(MODELS, "claude-sonnet-5", DEFAULT_MODEL), "Sonnet 5");
  // A null pick shows the model it falls back to, not the word "Default".
  assert.equal(modelLabel(MODELS, null, "claude-opus-5"), "Opus 5");
});

test("modelLabel survives a reply with no models", () => {
  assert.equal(modelLabel(undefined, null, DEFAULT_MODEL), "Default");
  assert.equal(modelLabel(null, "claude-opus-5", DEFAULT_MODEL), "claude-opus-5");
});

test("modelLabel still names a model the CLI no longer offers", () => {
  // Spec 25 §6.2 — a stored default that has gone. The name is all there is.
  assert.equal(modelLabel(MODELS, "claude-gone-4", DEFAULT_MODEL), "claude-gone-4");
  assert.equal(modelLabel([], null, DEFAULT_MODEL), "Default");
});
