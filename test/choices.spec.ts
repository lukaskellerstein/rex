// Spec 43 milestone 2 — the controls, and the three rules they must keep.
//
// The pure half of the composer's gateway control: what a comment starts on,
// what one that has already been sent starts on, and what a combination that
// has never seen this comment has to say before it is sent to.
//
// `.ts` and not `.tsx` on purpose — this machine's runner hands `.ts` straight
// to `node`, which strips types and cannot parse JSX. The helpers live beside
// the component for exactly that reason (`gatewayChoices.ts`), and this is what
// they are for.
//
// Run: npm run test:choices

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { saveGateway } from "../src/main/db/gateways.ts";
import { migrateGateways } from "../src/main/db/migrate.ts";
import { AGENT_GATEWAY_KEY, agentDefaults, setSetting } from "../src/main/db/settings.ts";
import {
  agentRows,
  gatewayForAgent,
  gatewayRows,
  lastGatewayId,
  lastUsed,
  ORIGINAL_GATEWAY_ID,
  replayNotice,
  routeSummary,
  unusableReason,
} from "../src/renderer/overlay/gatewayChoices.ts";
import type { AgentSdk } from "../src/shared/agent-protocol.ts";
import type { GatewayView } from "../src/shared/channels.ts";
import type { Message } from "../src/shared/types.ts";

const work = mkdtempSync(join(tmpdir(), "rex-choices-"));
after(() => rmSync(work, { recursive: true, force: true }));

let made = 0;

function openDb(): Database.Database {
  made += 1;
  const db = new Database(join(work, `c-${made}.db`));
  db.exec("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  migrateGateways(db);
  return db;
}

function view(id: string, name: string, extra: Partial<GatewayView> = {}): GatewayView {
  return {
    hasKey: false,
    gateway: {
      id,
      name,
      kind: id === ORIGINAL_GATEWAY_ID ? "original" : "litellm",
      routes: {
        "claude-agent": {
          baseUrl: id === ORIGINAL_GATEWAY_ID ? null : "http://localhost:24000",
          auth: id === ORIGINAL_GATEWAY_ID ? "inherit" : "environment",
          credentialEnv: id === ORIGINAL_GATEWAY_ID ? null : "AI_GATEWAY_KEY",
          models: [],
        },
      },
    },
    capabilities: {},
    ...extra,
  };
}

let seq = 0;

function message(fields: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    threadId: "t1",
    seq,
    role: "assistant",
    kind: "text",
    mode: null,
    model: null,
    style: null,
    sdk: null,
    gatewayName: null,
    baseUrl: null,
    content: "said something",
    toolName: null,
    toolInput: null,
    isError: false,
    denied: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    ...fields,
  };
}

// ── §4.0 — what a control starts on ─────────────────────────────

test("a setting naming a gateway that is gone falls back to Original and says so", () => {
  const db = openDb();
  setSetting(db, AGENT_GATEWAY_KEY, "gw-that-went-away");

  const defaults = agentDefaults(db, [ORIGINAL_GATEWAY_ID]);
  assert.equal(defaults.gatewayId, ORIGINAL_GATEWAY_ID);
  // Reported rather than swallowed: the picker's tooltip says it once.
  assert.equal(defaults.missingGateway, "gw-that-went-away");
  // **The stored row is kept.** Spec 25 §6.2's rule, applied to one more field:
  // a gateway can come back, and silently rewriting the reviewer's choice would
  // mean they never learn it stopped being honoured.
  assert.equal(
    db
      .prepare<[string], { value: string }>("SELECT value FROM setting WHERE key = ?")
      .get(AGENT_GATEWAY_KEY)?.value,
    "gw-that-went-away",
  );
});

test("a stored gateway that still exists is what a new comment starts on", () => {
  const db = openDb();
  const gateway = saveGateway(db, {
    name: "LiteLLM",
    kind: "litellm",
    routes: {
      "claude-agent": {
        baseUrl: "http://localhost:24000",
        auth: "environment",
        credentialEnv: "AI_GATEWAY_KEY",
        models: [],
      },
    },
  });
  setSetting(db, AGENT_GATEWAY_KEY, gateway.id);

  const defaults = agentDefaults(db, [ORIGINAL_GATEWAY_ID, gateway.id]);
  assert.equal(defaults.gatewayId, gateway.id);
  assert.equal(defaults.missingGateway, null);
});

test("with nothing stored, everything starts on Claude and Original", () => {
  const defaults = agentDefaults(openDb(), [ORIGINAL_GATEWAY_ID]);
  assert.equal(defaults.sdk, "claude-agent");
  assert.equal(defaults.gatewayId, ORIGINAL_GATEWAY_ID);
  assert.equal(defaults.model, null);
});

// ── §4.0 — a comment already sent starts on what it last used ───

test("a sent comment starts on the combination its newest answer ran through", () => {
  const views = [view(ORIGINAL_GATEWAY_ID, "Original"), view("gw-1", "LiteLLM")];
  const messages = [
    message({ sdk: "claude-agent", gatewayName: "Original", model: "sonnet" }),
    message({ sdk: "claude-agent", gatewayName: "LiteLLM", model: "unsloth-26b" }),
  ];
  assert.equal(lastGatewayId(messages, views), "gw-1");
  assert.deepEqual(lastUsed(messages), {
    sdk: "claude-agent",
    gatewayId: null,
    model: "unsloth-26b",
    style: null,
  });
});

test("a NOTE is skipped, because it stores null in every field", () => {
  const views = [view(ORIGINAL_GATEWAY_ID, "Original"), view("gw-1", "LiteLLM")];
  const messages = [
    message({ sdk: "claude-agent", gatewayName: "LiteLLM", model: "unsloth-26b" }),
    // §5.4 — a note runs nothing, so it ran under nothing. It must not become
    // the answer to "what did this comment last use".
    message({ role: "user", mode: "note" }),
  ];
  assert.equal(lastGatewayId(messages, views), "gw-1");
});

test("a comment with no answers has nothing to fall back to", () => {
  assert.equal(lastUsed([]), null);
  assert.equal(lastGatewayId([], [view(ORIGINAL_GATEWAY_ID, "Original")]), null);
});

test("a renamed gateway is not matched, and the comment starts on the setting", () => {
  // §5.3 — the message keeps the NAME, on purpose: it is evidence and must not
  // move when the row does. So a rename makes this miss, and missing is right —
  // the row the reviewer is looking at is not the one that answered.
  const views = [view("gw-1", "Somewhere else")];
  const messages = [message({ sdk: "claude-agent", gatewayName: "LiteLLM" })];
  assert.equal(lastGatewayId(messages, views), null);
});

// ── §4.2 — impossible combinations are shown, not hidden ────────

test("a gateway with no route for the agent is greyed with the reason", () => {
  const missing: GatewayView = {
    gateway: { id: "gw-1", name: "Work LiteLLM", kind: "litellm", routes: {} },
    hasKey: false,
    capabilities: {},
  };
  const reason = unusableReason(missing, "claude-agent", "Claude Agent SDK");
  assert.match(reason ?? "", /Work LiteLLM has no Claude Agent SDK route/);
  assert.match(reason ?? "", /Manage gateways/);
});

test("a route that cannot answer a question at all is greyed too", () => {
  const cannot = view("gw-1", "LiteLLM");
  cannot.capabilities = {
    "claude-agent": {
      models: [],
      styles: [],
      supportsStyles: false,
      supportsPlugins: false,
      supportsCost: false,
      // §8.1 — `supportsAsk` false greys the whole combination.
      supportsAsk: false,
      supportsAct: false,
      supportsResume: false,
      error: null,
    },
  };
  assert.match(unusableReason(cannot, "claude-agent", "Claude") ?? "", /cannot answer a question/);
});

test("a usable gateway is not greyed", () => {
  assert.equal(unusableReason(view("gw-1", "LiteLLM"), "claude-agent", "Claude"), null);
});

// ── §4.5 — what a row says about itself ─────────────────────────

test("Original describes itself in words rather than as an empty cell", () => {
  assert.match(routeSummary(view(ORIGINAL_GATEWAY_ID, "Original"), "claude-agent"), /own endpoint/);
});

test("a routed gateway names its URL and the variable it needs", () => {
  const summary = routeSummary(view("gw-1", "LiteLLM"), "claude-agent");
  assert.match(summary, /http:\/\/localhost:24000/);
  // The NAME of the variable, and never a value. §2.6 rule 4.
  assert.match(summary, /AI_GATEWAY_KEY/);
});

test("the rows are every gateway, in the order main sent them", () => {
  const rows = gatewayRows(
    [view(ORIGINAL_GATEWAY_ID, "Original"), view("gw-1", "LiteLLM")],
    "claude-agent",
  );
  assert.deepEqual(
    rows.map((row) => row.value),
    [ORIGINAL_GATEWAY_ID, "gw-1"],
  );
  assert.deepEqual(
    rows.map((row) => row.displayName),
    ["Original", "LiteLLM"],
  );
});

// ── §5.2 — the replay notice, said before the send ──────────────

test("a combination that has not seen this comment says so, once", () => {
  const messages = [message({ sdk: "claude-agent", gatewayName: "Original" })];
  const notice = replayNotice(messages, "LiteLLM", "claude-agent");
  assert.match(notice ?? "", /LiteLLM has not seen this comment yet/);
  assert.match(notice ?? "", /conversation so far/);
});

test("a combination that has already answered says nothing", () => {
  const messages = [message({ sdk: "claude-agent", gatewayName: "LiteLLM" })];
  assert.equal(replayNotice(messages, "LiteLLM", "claude-agent"), null);
});

test("a comment with no messages at all says nothing", () => {
  // There is no conversation to replay, so there is no cost to warn about.
  assert.equal(replayNotice([], "LiteLLM", "claude-agent"), null);
});

// ── Spec 44 §3 — the agent row of the cascade ───────────────────

/** A gateway that offers both agents, or only one. */
function twoWay(id: string, name: string, sdks: AgentSdk[]): GatewayView {
  const one = view(id, name);
  return {
    ...one,
    gateway: {
      ...one.gateway,
      routes: Object.fromEntries(
        sdks.map((sdk) => [
          sdk,
          {
            baseUrl: sdk === "codex" ? "http://localhost:24000/v1" : "http://localhost:24000",
            auth: "environment" as const,
            credentialEnv: "AI_GATEWAY_KEY",
            models: [],
          },
        ]),
      ),
    },
  };
}

const DESCRIBED = [
  {
    id: "claude-agent" as AgentSdk,
    label: "Claude Agent SDK",
    supportsStyles: true,
    supportsPlugins: true,
  },
  { id: "codex" as AgentSdk, label: "Codex", supportsStyles: false, supportsPlugins: false },
];

test("the agent rows are the descriptor's, and say how many gateways offer each", () => {
  const views = [
    twoWay("rex-original", "Original", ["claude-agent", "codex"]),
    twoWay("g2", "LiteLLM", ["claude-agent"]),
  ];
  const rows = agentRows(DESCRIBED, views);
  assert.deepEqual(
    rows.map((row) => row.value),
    ["claude-agent", "codex"],
  );
  // The label is the library's, never a string REX's own source spells.
  assert.equal(rows[1]?.displayName, "Codex");
  assert.match(rows[0]?.description ?? "", /2 of 2/);
  assert.match(rows[1]?.description ?? "", /1 of 2/);
});

test("an agent no gateway offers says so rather than looking broken", () => {
  const rows = agentRows(DESCRIBED, [twoWay("g2", "LiteLLM", ["claude-agent"])]);
  assert.match(rows[1]?.description ?? "", /No gateway has a route for it yet/);
});

test("switching the agent moves the gateway when the one in hand cannot run it", () => {
  const views = [
    twoWay("rex-original", "Original", ["claude-agent"]),
    twoWay("g2", "LiteLLM", ["claude-agent", "codex"]),
  ];
  assert.equal(gatewayForAgent(views, "codex", "rex-original"), "g2");
  // Already usable: nothing moves, because a rebuild must not undo a pick.
  assert.equal(gatewayForAgent(views, "codex", "g2"), null);
  assert.equal(gatewayForAgent(views, "claude-agent", "rex-original"), null);
});

test("an agent nothing can run leaves the gateway alone and greys the rows", () => {
  const views = [twoWay("rex-original", "Original", ["claude-agent"])];
  assert.equal(gatewayForAgent(views, "codex", "rex-original"), null);
  assert.match(
    unusableReason(views[0] as GatewayView, "codex", "Codex") ?? "",
    /has no Codex route/,
  );
});

test("a comment that last ran on Codex starts on Codex", () => {
  const messages = [
    message({ sdk: "claude-agent", gatewayName: "Original" }),
    message({ sdk: "codex", gatewayName: "LiteLLM" }),
  ];
  assert.equal(lastUsed(messages)?.sdk, "codex");
});

test("the replay notice fires when the AGENT changes, not only the gateway", () => {
  // Spec 43 §5.2 case 3, reached for the first time by spec 44: one session per
  // (thread, SDK, gateway), so a new agent on the SAME gateway is still a
  // conversation that has to be replayed.
  const messages = [message({ sdk: "claude-agent", gatewayName: "LiteLLM" })];
  assert.equal(replayNotice(messages, "LiteLLM", "claude-agent"), null);
  assert.match(replayNotice(messages, "LiteLLM", "codex") ?? "", /has not seen this comment yet/);
});
