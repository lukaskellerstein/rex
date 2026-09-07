// Spec 46 §5 and §8 — the questions the Settings screen asks of its data.
//
// Three claims this file exists for, and each is a rule that would otherwise be
// kept only by whoever wrote the component:
//
//   * **Silence is never a claim** (§5.5). A provider that says nothing about
//     tools produces a row that says nothing — not "no tools", which would send
//     somebody to fix the wrong thing.
//   * **A ticked model that stops being offered is kept, and marked** (§5.3).
//     Deleting it would silently change what the person configured.
//   * **Nothing here names a provider** (A8). Every answer comes from the
//     descriptor table, so a seventh provider changes no code that renders.
//
// Run: npm run test:settings

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  askedAgo,
  blockedReason,
  builtinSummary,
  mayTickAll,
  missingFields,
  modelRows,
  moneyNotice,
  SECTIONS,
  sizeLabel,
  tickedModels,
  toggled,
  windowLabel,
} from "../src/renderer/overlay/providers.ts";
import type {
  GatewayDiscovery,
  GatewayProviderView,
  ProviderDescriptor,
} from "../src/shared/channels.ts";

const LOCAL: ProviderDescriptor = {
  id: "lmstudio",
  label: "LM Studio",
  prefix: "lm_studio/",
  fields: [
    {
      key: "url",
      label: "Address",
      kind: "url",
      required: true,
      placeholder: "http://127.0.0.1:1234",
      help: null,
      default: null,
    },
  ],
  local: true,
  note: "Models on this machine.",
  defaultUrl: null,
  auth: "none",
  headers: {},
};

const PAID: ProviderDescriptor = {
  id: "openai",
  label: "OpenAI",
  prefix: "openai/",
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "password",
      required: true,
      placeholder: null,
      help: null,
      default: null,
    },
  ],
  local: false,
  note: "Every model here bills your account.",
  defaultUrl: "https://api.openai.com/v1",
  auth: "bearer",
  headers: {},
};

function provider(models: GatewayProviderView["models"]): GatewayProviderView {
  return {
    id: "gp-1",
    provider: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://127.0.0.1:1234",
    hasKey: false,
    listedAt: null,
    models,
  };
}

function discovery(
  models: GatewayDiscovery["models"],
  error: string | null = null,
): GatewayDiscovery {
  return { provider: "lmstudio", models, error };
}

// ── §5.5 — silence is never a claim ─────────────────────────────

test("a model whose provider said nothing about tools is not called broken", () => {
  // The failure this prevents: a warning that sends somebody to fix a model
  // that is perfectly capable, because REX guessed.
  assert.equal(blockedReason("chat", null), null);
  assert.equal(blockedReason("unknown", null), null);
});

test("a model that says it cannot call tools is blocked, and says why", () => {
  const why = blockedReason("chat", false);
  assert.match(why ?? "", /cannot call tools/);
});

test("an embedding model is blocked outright", () => {
  // It produces vectors, not answers. LM Studio's `type` names them, so this is
  // knowledge and not a guess by name.
  assert.match(blockedReason("embedding", null) ?? "", /vectors, not answers/);
});

test("a blocked model can never be ticked, whatever was clicked", () => {
  // The checkbox is disabled in the screen; this is the second half, so a
  // keyboard or a stale render cannot get past it.
  const rows = modelRows(
    provider([]),
    discovery([{ id: "nomic-embed", context: 2048, kind: "embedding", tools: null, note: "" }]),
  );
  assert.equal(toggled(rows, "nomic-embed")[0]?.ticked, false);
});

// ── §5.3 — a model that stops being offered ─────────────────────

test("a ticked model the provider no longer lists is KEPT and marked", () => {
  // Three different problems — unloaded, access lost, renamed — and REX can
  // tell none of them apart. Deleting the row would silently change what the
  // person configured.
  const rows = modelRows(
    provider([
      {
        model: "gemma-old",
        alias: "lmstudio-gemma-old",
        maxInput: 8192,
        maxOutput: 8192,
        tools: true,
      },
    ]),
    discovery([{ id: "gemma-new", context: 131072, kind: "chat", tools: true, note: "" }]),
  );
  const gone = rows.find((row) => row.id === "gemma-old");
  assert.ok(gone, "the ticked model survived the refresh");
  assert.equal(gone.gone, true);
  assert.equal(gone.ticked, true, "it stays ticked until the person unticks it");
});

test("a model that is offered and already ticked comes back ticked", () => {
  const rows = modelRows(
    provider([{ model: "a", alias: "lmstudio-a", maxInput: 1, maxOutput: 1, tools: null }]),
    discovery([
      { id: "a", context: 131072, kind: "chat", tools: true, note: "" },
      { id: "b", context: 131072, kind: "chat", tools: true, note: "" },
    ]),
  );
  assert.equal(rows.find((row) => row.id === "a")?.ticked, true);
  assert.equal(rows.find((row) => row.id === "b")?.ticked, false);
});

test("a provider that could not be reached still shows what was ticked", () => {
  // The engine being off must not make a person's configuration look deleted.
  const rows = modelRows(
    provider([{ model: "a", alias: "lmstudio-a", maxInput: 1, maxOutput: 1, tools: null }]),
    discovery([], "could not reach LM Studio"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.gone, true);
});

// ── §5.4 — money is never discovered ────────────────────────────

test("a local provider may be ticked freely and a paid one may not", () => {
  assert.equal(mayTickAll(LOCAL), true);
  assert.equal(mayTickAll(PAID), false);
  // A provider REX cannot describe is treated as paid, which is the safe way
  // round: the worst case is one extra click.
  assert.equal(mayTickAll(null), false);
});

test("a paid provider's list carries the sentence about money", () => {
  assert.match(moneyNotice(PAID) ?? "", /cost money/);
  assert.equal(moneyNotice(LOCAL), null);
});

// ── A8 — nothing names a provider ───────────────────────────────

test("what a provider needs comes from its own fields", () => {
  assert.deepEqual(
    missingFields(LOCAL, {}).map((field) => field.key),
    ["url"],
  );
  assert.deepEqual(missingFields(LOCAL, { url: "http://127.0.0.1:1234" }), []);
  // Whitespace is not an answer.
  assert.deepEqual(
    missingFields(LOCAL, { url: "   " }).map((field) => field.key),
    ["url"],
  );
});

test("a seventh provider needs no change here", () => {
  // The whole of A8, as a test: an id this file has never seen behaves.
  const seventh: ProviderDescriptor = { ...LOCAL, id: "brand-new", label: "Something New" };
  assert.equal(mayTickAll(seventh), true);
  assert.deepEqual(
    missingFields(seventh, {}).map((field) => field.key),
    ["url"],
  );
});

// ── what the screen says ────────────────────────────────────────

test("a window the provider did not state is drawn as absent, never as zero", () => {
  assert.equal(windowLabel(null), "—");
  assert.equal(windowLabel(131072), "131k");
  assert.equal(windowLabel(2048), "2k");
  assert.equal(windowLabel(512), "512");
});

test("an empty gateway reads as an instruction, not as a fault", () => {
  assert.match(builtinSummary(0, 0), /No providers yet/);
  assert.match(builtinSummary(0, 2), /no models ticked/);
  assert.equal(builtinSummary(6, 2), "6 models from 2 providers");
  assert.equal(builtinSummary(1, 1), "1 model from 1 provider");
});

test("a list that was never asked for says so", () => {
  // §6 — a cached list is dated. One that silently ages is how a person
  // concludes their provider is broken when it merely gained a model.
  assert.equal(askedAgo(null), "Not asked yet");
  const now = Date.parse("2026-09-06T12:00:00Z");
  assert.equal(askedAgo("2026-09-06T11:57:00Z", now), "Asked 3 minutes ago");
  assert.equal(askedAgo("2026-09-06T09:00:00Z", now), "Asked 3 hours ago");
  assert.equal(askedAgo("2026-09-03T12:00:00Z", now), "Asked 3 days ago");
  assert.equal(askedAgo("2026-09-06T11:59:59Z", now), "Asked just now");
});

test("the log's size is drawn in one unit", () => {
  assert.equal(sizeLabel(512), "512 B");
  assert.equal(sizeLabel(4096), "4 KB");
  assert.equal(sizeLabel(5 * 1024 * 1024), "5.0 MB");
});

// ── what gets saved ─────────────────────────────────────────────

test("only ticked models are sent, with what the provider actually said", () => {
  const rows = modelRows(
    provider([]),
    discovery([
      { id: "a", context: 131072, kind: "chat", tools: true, note: "" },
      { id: "b", context: null, kind: "chat", tools: null, note: "" },
    ]),
  );
  assert.deepEqual(tickedModels(rows), []);

  const one = toggled(rows, "b");
  assert.deepEqual(tickedModels(one), [{ model: "b", context: null, tools: null }]);
});

// ── §8 — the sections, as data ──────────────────────────────────
//
// The reviewer asked on 2026-09-06 for a Settings button of its own and for the
// sheet to hold "different sections than just now, the gateways". So the tab
// strip is a table, and what is worth asserting is that adding a section stays
// a one-row change: nothing may list the tabs a second time.

test("every section has a label and a hint, and the ids are unique", () => {
  assert.ok(SECTIONS.length >= 2);
  for (const section of SECTIONS) {
    assert.ok(section.label, `${section.id} has no label`);
    assert.ok(section.blurb, `${section.id} has no blurb under its heading`);
  }
  assert.equal(
    new Set(SECTIONS.map((section) => section.id)).size,
    SECTIONS.length,
    "duplicate section id",
  );
});

test("gateways is first, because it is what a new person needs", () => {
  // The order is the order somebody meets them: where answers come from, then
  // what may be asked for. It is also the tab every entry point opens on.
  assert.equal(SECTIONS[0]?.id, "gateways");
});

test("the tab strip is the only list of sections", async () => {
  // The rule that keeps "adding a section is one row" true. A second hard-coded
  // list is how a new tab appears in the nav and renders nothing, or renders
  // and cannot be reached.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/renderer/overlay/Settings.tsx", "utf8");
  const nav = source.slice(source.indexOf("rex-settings-tabs"));
  for (const section of SECTIONS) {
    // The label must not be typed into the markup: it comes from the table.
    assert.equal(
      nav.includes(`>${section.label}<`),
      false,
      `'${section.label}' is written into the nav as well as into SECTIONS`,
    );
  }
});
