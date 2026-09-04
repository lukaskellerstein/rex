// Spec 42 §11 — the meaning half of the seam.
//
// `service.ts` moves bytes. This file moves meaning, and it is the ONLY place
// in REX that knows both vocabularies: it turns today's `AgentRunInput` into a
// `RunRequest`, an `AgentEvent` into a `MessageDraft`, and REX's gate into an
// answer the library can hand its SDK.
//
// What is deliberately NOT here: any SDK, any model call, any knowledge of what
// Claude names its tools. After this file exists,
// `grep -rn "claude-agent-sdk" src/ package.json` finds nothing.
//
// `runAgent` keeps today's input shape on purpose. `ipc.ts`, `apply.ts`,
// `docx/run.ts` and `pptx/run.ts` change one import path and nothing else,
// which is what makes "a reviewer can tell no difference" a claim worth making.

import type {
  AgentEvent,
  AgentGateway,
  AgentSdk,
  AgentSession,
  CommonTool,
  GatewayRoute,
  ResolvedRoute,
  RouteCapabilities,
  RunMessage,
  SessionState,
  ToolCall,
  VerifyResult,
} from "../../shared/agent-protocol.ts";
import { CATALOGUE } from "../../shared/agent-protocol.ts";

// §10 — moved to `shared/` because the gateway sheet needs the same two pure
// functions, and the renderer may not import from `main/`. Re-exported so
// `test/protocol.spec.ts` and every existing caller keep one import path.
export { baseUrlProblem, buildRoutes, validateGateway } from "../../shared/gateways.ts";

import {
  DEFAULT_MODEL,
  DEFAULT_STYLE,
  type MessageKind,
  type MessageRole,
  type Profile,
} from "../../shared/types.ts";
import type { MessageDraft } from "../db/queries.ts";
import { record as logLine } from "../log.ts";
import { type Denial, gateDecision, writeGateDecision } from "./gate.ts";
import { PROFILES, pluginsForRepository } from "./profiles.ts";
import { READ_SYSTEM_PROMPT, WRITE_SYSTEM_PROMPT } from "./prompts.ts";
import { agentService } from "./service.ts";

/** The only SDK REX runs today. Spec 43 is what makes this a choice. */
export const REX_SDK: AgentSdk = "claude-agent";

/**
 * §5.4 — the one gateway REX has: every SDK on its own login, no URL anywhere.
 *
 * A constant and not a database row, because there is exactly one and nothing
 * can edit it. Spec 43 turns it into a row that still cannot be edited.
 */
export const ORIGINAL_GATEWAY: AgentGateway = {
  id: "original",
  name: "Original",
  kind: "original",
  routes: Object.fromEntries(
    CATALOGUE.sdks.map((sdk) => [
      sdk.id,
      { baseUrl: null, auth: "inherit", credentialEnv: null, models: [] } satisfies GatewayRoute,
    ]),
  ),
};

export interface AgentRunInput {
  cwd: string;
  profile: Profile;
  prompt: string;
  sessionId: string;
  /** True to continue an existing SDK session, false to seed a new one. */
  resume: boolean;
  /**
   * Spec 43 §11 — where this run's inference is served from.
   *
   * The one input spec 42 said this signature would gain. Absent means
   * `Original`, so a caller that has no gateway of its own keeps working
   * unchanged — and every caller that does have one passes what it resolved
   * from the reviewer's choice, never a gateway id it looked up here.
   */
  route?: ResolvedRoute;
  model: string | null;
  /** Spec 31 §4 — the output style this run writes in. Null is the CLI's default. */
  style: string | null;
  /** Spec 11 §7.2 — a different system prompt, when the caller genuinely needs one. */
  systemPrompt?: string;
  /**
   * Spec 43 §4.5 — the plugin directories, when the caller wants none.
   *
   * Absent means `pluginsForRepository`, which is what every real run wants and
   * always includes `lsp-bash`. **A connectivity check does not**: a language
   * server started to prove a URL answers is minutes of nothing, and measured
   * 2026-09-04 that plus REX's review prompt turned a 9-second probe into one
   * the reviewer gave up on after five minutes.
   */
  plugins?: string[];
  /** Spec 11 §6.4.2 — the document under review, so only a deck pays for the design plugins. */
  documentPath?: string | null;
  onMessage: (draft: MessageDraft) => void;
  /** Spec 17 §2.2 — the reviewer's Stop. */
  signal?: AbortSignal;
  /** Spec 15 §4.3 — every path a write tool named, as it is called. */
  onWrote?: (path: string) => void;
}

export interface AgentRunResult {
  sessionId: string;
  costUsd: number | null;
  durationMs: number | null;
  denials: Denial[];
  error: string | null;
  /** Spec 17 §2.3 — the reviewer stopped this run, and `error` is therefore null. */
  stopped: boolean;
}

function draft(
  role: MessageRole,
  kind: MessageKind,
  content: string | null,
  extra: Partial<MessageDraft> = {},
): MessageDraft {
  return {
    role,
    kind,
    content,
    toolName: null,
    toolInput: null,
    isError: false,
    costUsd: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    ...extra,
  };
}

/**
 * A `diff` event, drawn.
 *
 * The library says what changed; REX says how a change looks. `before === null`
 * is a whole new file and draws no removed lines at all — which is a different
 * thing from `before === ""`, an edit whose old text was empty, and that one
 * draws exactly one empty removed line.
 */
export function drawDiff(path: string, before: string | null, after: string): string {
  const lines = [path];
  if (before !== null) for (const line of before.split("\n")) lines.push(`- ${line}`);
  for (const line of after.split("\n")) lines.push(`+ ${line}`);
  return lines.join("\n");
}

/** Spec 17 §2.3 — the one message a stop writes, and the only one. */
const STOPPED = "You stopped this run.";

/**
 * §8 — REX's gate, in the shape the library asks for it.
 *
 * `gate.ts` is untouched and `test/gate.spec.ts` is untouched: what left the
 * gate is only `buildHooks()`, the SDK-shaped wrapper, because a hook is how
 * *Claude* asks a policy and that is the adapter's business now.
 *
 * The fall-through is the whole point, and REX makes two different decisions on
 * purpose. For Claude an unmapped name is ALLOWED, because that is exactly what
 * `gateDecision()` did before this spec — it reasons in Claude's own names, and
 * `TodoWrite`, `Skill` and `AskUserQuestion` were always allowed. For every
 * later SDK an unmapped name is DENIED, because specs 44 to 46 each bring a
 * closed mapping and an unmapped name there is a hole, not a convention.
 */
export function policyFor(profile: Profile, sdk: AgentSdk): (call: ToolCall) => string | null {
  return (call) => {
    if (sdk !== REX_SDK && call.common === null) {
      return `REX does not know the ${sdk} tool '${call.name}', so it is not allowed.`;
    }
    return profile === "write" ? writeGateDecision(call.name) : gateDecision(call.name, call.input);
  };
}

/**
 * §5.3 — a stored gateway plus this process's environment, for one SDK.
 *
 * The mirror of `resolve_route` in Python, and it exists on this side because
 * main is what holds `process.env`: sending an unresolved variable NAME across
 * the pipe and hoping would put the failure in the wrong process and the
 * credential in the wrong place.
 */
export function resolveRoute(
  gateway: AgentGateway,
  sdk: AgentSdk,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRoute {
  if (!CATALOGUE.sdks.some((entry) => entry.id === sdk)) {
    throw new Error(`No adapter for '${sdk}'.`);
  }
  const route = gateway.routes[sdk];
  if (!route) throw new Error(`The gateway '${gateway.name}' does not offer ${sdk}.`);

  let token: string | null = null;
  if (route.auth === "environment") {
    const name = route.credentialEnv;
    if (!name) {
      throw new Error(
        `The ${sdk} route on '${gateway.name}' needs a credential but names no variable.`,
      );
    }
    const value = env[name];
    if (!value) {
      throw new Error(`The ${sdk} route on '${gateway.name}' needs ${name}, and it is not set.`);
    }
    token = value;
  }

  return {
    sdk,
    gatewayName: gateway.name,
    baseUrl: route.baseUrl,
    auth: route.auth,
    token,
  };
}

// ── §9.4 — the probe is the library's; the cache is REX's ───────
//
// The library holds no state that outlives a run (§3.2), and a cache is state.
// So the probe happens over there and the answer is kept here — keyed by SDK
// and gateway, which is the shape spec 43 §8 needs and this spec prepares.

const probes = new Map<string, Promise<RouteCapabilities>>();

/** §3.4 — what the pickers show when the library could not be asked at all. */
function unreachable(reason: string): RouteCapabilities {
  return {
    models: [
      {
        value: DEFAULT_MODEL,
        displayName: "Default",
        description: "Whatever the Claude CLI is configured to use.",
      },
    ],
    styles: [DEFAULT_STYLE],
    supportsStyles: true,
    supportsPlugins: true,
    supportsCost: true,
    supportsAsk: true,
    supportsAct: true,
    supportsResume: true,
    error: `REX could not ask the Claude CLI what it offers, so only the defaults are available. ${reason}`,
  };
}

async function probe(route: ResolvedRoute, cwd: string): Promise<RouteCapabilities> {
  try {
    const value = await agentService().ask((id) => ({
      type: "capabilities",
      id,
      route,
      cwd,
    }));
    if (value?.kind === "capabilities") return value.capabilities;
    return unreachable("It answered nothing.");
  } catch (error) {
    return unreachable(error instanceof Error ? error.message : String(error));
  }
}

export type CapabilityProbe = RouteCapabilities;

/**
 * Spec 25 §3.3 and spec 43 §8 — one probe per SDK and gateway, never on the
 * reviewer's time.
 *
 * The first caller starts it and every later one gets the same promise. Main
 * starts `Original`'s when the window is created, so it has long resolved
 * before any text has been selected; a gateway the reviewer adds later is
 * probed the first time its control is drawn, which is why each key has its own
 * failure state and a slow custom route cannot block `Original`.
 *
 * The key is the **gateway id**, not the URL. A gateway whose host is edited
 * keeps its id, and §5.2 case 2b is what handles the change of server — but its
 * capabilities have to be asked again, which is what `forgetProbe` is for.
 */
export function listCapabilities(
  cwd: string,
  gateway: AgentGateway = ORIGINAL_GATEWAY,
  sdk: AgentSdk = REX_SDK,
): Promise<CapabilityProbe> {
  const key = `${sdk}:${gateway.id}`;
  let pending = probes.get(key);
  if (!pending) {
    // A route that cannot be resolved is a route that cannot be probed, and the
    // pickers still have to draw. The reason is the sentence they show.
    let route: ResolvedRoute;
    try {
      route = resolveRoute(gateway, sdk);
    } catch (error) {
      return Promise.resolve(unreachable(error instanceof Error ? error.message : String(error)));
    }
    pending = probe(route, cwd);
    probes.set(key, pending);
  }
  return pending;
}

/** Spec 43 §4.5 — a gateway that was edited or removed is asked again, not remembered. */
export function forgetProbe(gatewayId: string): void {
  for (const key of [...probes.keys()]) {
    if (key.endsWith(`:${gatewayId}`)) probes.delete(key);
  }
}

/**
 * §9.3 — what the SDK has for this session, and what is on disk for it.
 *
 * The record and the file stay separate all the way to the debug report,
 * because they can disagree and every way they disagree is a different bug.
 */
export async function sessionState(
  cwd: string,
  sessionId: string,
  route?: ResolvedRoute,
): Promise<SessionState> {
  try {
    const value = await agentService().ask((id) => ({
      type: "session_exists",
      id,
      route: route ?? resolveRoute(ORIGINAL_GATEWAY, REX_SDK),
      cwd,
      sessionId,
    }));
    if (value?.kind === "exists") return value.session;
  } catch {
    // Falls through to "nothing known", below.
  }
  // A library that cannot answer is a library that cannot resume either, and
  // "no" is the answer that makes REX rebuild the conversation from SQLite —
  // which is the case §8.5 exists for.
  return { exists: false, summary: null, lastModified: null, path: null, size: null };
}

/** §8.5 — whether a reply can continue the session, or has to replay it. */
export async function sessionExists(
  cwd: string,
  sessionId: string,
  route?: ResolvedRoute,
): Promise<boolean> {
  return (await sessionState(cwd, sessionId, route)).exists;
}

/**
 * Spec 43 §2.4 — what a server publishes, checked against what this route needs.
 *
 * A passthrough and deliberately nothing more: the whole check is the library's,
 * because knowing that `/v1/messages` is the path a Claude route addresses is
 * SDK knowledge. **It never rewrites a route**, and a server that publishes
 * nothing is reported as publishing nothing rather than as broken.
 */
export async function verifyRoute(route: ResolvedRoute): Promise<VerifyResult> {
  const value = await agentService().ask((id) => ({ type: "verify", id, route }));
  if (value?.kind === "verify") return value.verify;
  throw new Error("The agent library did not answer the verification.");
}

// ── the run ─────────────────────────────────────────────────────

let runCounter = 0;

function sessionOf(input: AgentRunInput): AgentSession {
  // §5.5 — `resume: false` with an id MEANS "seed a new session with this id",
  // which is a different request from "continue it" and needs a different word.
  return input.resume
    ? { mode: "resume", id: input.sessionId }
    : { mode: "seed", id: input.sessionId };
}

function requestFor(input: AgentRunInput, runId: string): RunMessage {
  const config = PROFILES[input.profile];
  return {
    type: "run",
    runId,
    route: input.route ?? resolveRoute(ORIGINAL_GATEWAY, REX_SDK),
    cwd: input.cwd,
    prompt: input.prompt,
    session: sessionOf(input),
    // Spec 25 §5.1 and spec 31 §6 — `default` MEANS "REX says nothing", and
    // saying nothing is how that is said. The record keeps the reviewer's word;
    // the call does not repeat it.
    model: input.model && input.model !== DEFAULT_MODEL ? input.model : null,
    style: input.style && input.style !== DEFAULT_STYLE ? input.style : null,
    systemPrompt:
      input.systemPrompt ?? (input.profile === "read" ? READ_SYSTEM_PROMPT : WRITE_SYSTEM_PROMPT),
    disallowed: config.disallowedTools,
    // `pluginsForRepository` stays in REX and resolves the marketplace refs.
    // What crosses is the list of directories it produced — opaque paths, with
    // no SDK shape on them.
    plugins:
      input.plugins ??
      pluginsForRepository(input.cwd, input.profile, input.documentPath).map(
        (plugin) => plugin.path,
      ),
    maxTurns: config.maxTurns ?? null,
  };
}

/**
 * §7 — one library event, as the row REX stores for it.
 *
 * Every REX-specific decision lives here and nowhere else: which events are a
 * row at all, what the completed line says, how a diff is drawn. The library
 * made none of them.
 *
 * Exported because it is what §13 criterion 10 is about — "every MessageDraft
 * REX stores is what it stored before" is a claim about this function, and it
 * can be checked against a recorded stream with no child process in the way.
 */
export function draftFor(event: AgentEvent, onWrote?: (path: string) => void): MessageDraft | null {
  switch (event.type) {
    case "started":
      // Spec 31 §10.1 — the CLI's RESOLVED values, so a setting it ignored
      // shows up as a disagreement rather than as a silent pass. The library
      // has no logger of REX's, so it says this as an event and REX writes it.
      logLine(
        "info",
        "agent",
        `init · model=${event.model ?? "?"} · style=${event.style ?? "?"} · tools=${event.tools ?? 0} · plugins=${event.plugins.join(", ") || "none"}`,
      );
      return null;

    case "text":
      return draft("assistant", "text", event.text);

    case "thinking":
      return draft("assistant", "thinking", event.text);

    case "tool_call":
      return draft("assistant", "tool_call", null, {
        toolName: event.name,
        toolInput: (event.input ?? null) as MessageDraft["toolInput"],
      });

    case "diff":
      return draft("assistant", "diff", drawDiff(event.path, event.before, event.after));

    case "wrote":
      onWrote?.(event.path);
      return null;

    case "tool_result":
      return draft("user", "tool_result", event.text, {
        toolName: event.name,
        isError: event.isError,
        denied: event.denied,
      });

    case "error":
      return draft("system", "error", event.text, {
        isError: true,
        costUsd: event.costUsd,
        durationMs: event.durationMs,
      });

    case "stopped":
      return draft("system", "stopped", STOPPED, {
        costUsd: event.costUsd,
        durationMs: event.durationMs,
      });

    case "completed":
      return draft("system", "completed", `Completed in ${event.durationMs ?? "?"}ms`, {
        costUsd: event.costUsd,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      });

    // A refusal is already in `RunResult.denials`, which is where every caller
    // reads it from. The event exists so that a host which streams can show one
    // as it happens; REX writes its note after the run, as it always has.
    case "denied":
      return null;
  }
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  runCounter += 1;
  const runId = `${Date.now().toString(36)}-${runCounter}`;
  const service = agentService();

  // Spec 17 §2.2 — the reviewer's Stop becomes a `stop` message. Nothing else
  // in REX may send one.
  const stop = (): void => service.stop(runId);
  input.signal?.addEventListener("abort", stop, { once: true });

  let message: RunMessage;
  try {
    message = requestFor(input, runId);
  } catch (error) {
    // A route that cannot be resolved is a run that never starts, reported the
    // way a failed one is: every caller branches on `error`.
    const text = error instanceof Error ? error.message : String(error);
    input.onMessage(draft("system", "error", text, { isError: true }));
    return {
      sessionId: input.sessionId,
      costUsd: null,
      durationMs: null,
      denials: [],
      error: text,
      stopped: false,
    };
  }

  const decide = policyFor(input.profile, REX_SDK);

  try {
    const result = await service.run(message, {
      onEvent: (event) => {
        const row = draftFor(event, input.onWrote);
        if (row) input.onMessage(row);
      },
      onPolicy: decide,
    });

    return {
      sessionId: result.sessionId || input.sessionId,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      // The wire carries `subagentId: null`; REX's `Denial` leaves the field
      // off. Both mean "the main thread made the call", and the two shapes are
      // reconciled here rather than by widening `gate.ts`, which is untouched.
      denials: result.denials.map((denial) => ({
        toolName: denial.toolName,
        reason: denial.reason,
        ...(denial.subagentId ? { subagentId: denial.subagentId } : {}),
      })),
      error: result.error,
      // §2.4 — a run the reviewer stopped before the library ever reached the
      // SDK still ends as a stop, and a stop is never a failure.
      stopped: result.stopped || (input.signal?.aborted === true && result.error === null),
    };
  } finally {
    input.signal?.removeEventListener("abort", stop);
  }
}

export type { CommonTool };
