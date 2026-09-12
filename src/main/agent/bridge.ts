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
  /**
   * Spec 45 §6 — the comment thread this run belongs to, for the gateway.
   *
   * Optional on purpose. `sessionId` is NOT a substitute: it is
   * `sessionIdFor(...)` of whatever the caller had, and an Apply passes a run
   * key rather than a thread id, so reading a thread back out of it would be
   * wrong for exactly the runs that cost the most.
   */
  threadId?: string;
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
  /**
   * Spec 44 §9.3 — every directory this run may change, as absolute paths.
   *
   * REX's own boundary, said to the library rather than only to the agent. A
   * read run names none. An ACT run names its working copies, and a DOCX or
   * PPTX run names the cache directory its plan is written into.
   *
   * **What an adapter does with it is the adapter's own business**, and the two
   * REX has differ on purpose: Claude has no sandbox, so its boundary stays the
   * write prompt plus `putBack`'s repair, exactly as before this spec; Codex
   * has one, so the same list becomes a sandbox that stops the write instead of
   * REX undoing it. The field says the intent; neither behaviour is encoded in
   * the caller.
   */
  writable?: string[];
  /**
   * Spec 50 §3.2 — directories this run may READ, beyond `cwd`.
   *
   * `writable`'s twin, and the ASK half of the same idea: REX's read prompt
   * names each spec 22 working copy by absolute path, and those copies live
   * under `~/.rex/work/`, outside the repository. An adapter that scopes reads
   * to `cwd` alone cannot open the document the prompt just named — which is
   * exactly what a Deep Agents ASK did, answering "not found" about a file that
   * was there.
   */
  readable?: string[];
  /**
   * Spec 51 §4 — this turn's id, when the caller has already minted one.
   *
   * The caller mints it because a turn STARTS before this function is called:
   * `ipc.ts` writes the reviewer's own message first, and that row is part of
   * the turn. So `nextRunId()` is exported and the caller stamps the same
   * string on the send, on everything the run produces, and passes it here —
   * where it becomes the `x-rex-run` header.
   *
   * Absent means "nobody is joining this run to anything", and one is minted
   * here as before, so a caller that does not care is unchanged.
   */
  runId?: string;
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
 * Spec 44 §9.1 — the Claude name each common tool is judged under.
 *
 * **`gate.ts` reasons in Claude's own names**, and that is not an accident to be
 * tidied away: those names are what spec 12 §6's whole shell analysis is written
 * against, and rewriting it in the common vocabulary would mean re-deriving
 * every rule about `sed -i`, `git`, redirects and `gh` in a second dialect.
 *
 * So the translation happens here instead, at the one place a second SDK arrives.
 * `shell` is the row that matters: a Codex `command_execution` handed to the gate
 * under its own name matches nothing, `gateDecision` returns allow, and a read
 * session runs arbitrary shell — the exact hole §9.1 says a mapping exists to
 * close. Measured before this line existed.
 *
 * `read`, `list`, `search` and `task` are deliberately absent. Each is allowed in
 * both profiles, so there is nothing for a name to unlock, and inventing one
 * would claim the gate had an opinion it does not have.
 */
const GATE_NAMES: Partial<Record<CommonTool, string>> = {
  write: "Write",
  edit: "Edit",
  shell: "Bash",
  fetch: "WebFetch",
};

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
 * later SDK an unmapped name is DENIED, because specs 44, 47 and 48 each bring a
 * closed mapping and an unmapped name there is a hole, not a convention.
 */
export function policyFor(profile: Profile, sdk: AgentSdk): (call: ToolCall) => string | null {
  return (call) => {
    if (sdk !== REX_SDK && call.common === null) {
      return `REX does not know the ${sdk} tool '${call.name}', so it is not allowed.`;
    }
    // An MCP call keeps its own name: `mcp__<server>__<tool>` is already what
    // the gate's allowlist is written in, and every adapter produces it.
    const name =
      sdk === REX_SDK || call.common === null || call.common === "mcp"
        ? call.name
        : (GATE_NAMES[call.common] ?? call.name);
    return profile === "write" ? writeGateDecision(name) : gateDecision(name, call.input);
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
  stored: string | null = null,
): ResolvedRoute {
  if (!CATALOGUE.sdks.some((entry) => entry.id === sdk)) {
    throw new Error(`No adapter for '${sdk}'.`);
  }
  const route = gateway.routes[sdk];
  if (!route) throw new Error(`The gateway '${gateway.name}' does not offer ${sdk}.`);

  let token: string | null = null;
  if (route.auth === "stored") {
    // Spec 46 §7 — the host holds the key, encrypted by the operating system's
    // own keystore, and hands the plaintext in here. It is a parameter and not
    // something this function looks up, so that `bridge.ts` stays a pure
    // mapping and `test/bridge.spec.ts` can drive it with no keychain.
    if (!stored) {
      throw new Error(
        `The ${sdk} route on '${gateway.name}' needs a key, and none is stored. Add one in Settings.`,
      );
    }
    token = stored;
  } else if (route.auth === "environment") {
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

/**
 * §3.4 — what the pickers show when the library could not be asked at all.
 *
 * Named for the SDK the question was about, because the two say different things
 * about what a fallback even means: Claude's `default` row is a real value the
 * CLI advertises, and every capability below is what Claude has. A Codex route
 * that could not be asked has no styles and no plugins whatever the reason, so
 * claiming them here would put controls on screen that the run then refuses.
 */
function unreachable(reason: string, sdk: AgentSdk = REX_SDK): RouteCapabilities {
  const label = CATALOGUE.sdks.find((entry) => entry.id === sdk)?.label ?? sdk;
  const claude = sdk === REX_SDK;
  return {
    models: [
      {
        value: DEFAULT_MODEL,
        displayName: "Default",
        description: `Whatever ${label} is configured to use.`,
      },
    ],
    styles: claude ? [DEFAULT_STYLE] : [],
    supportsStyles: claude,
    supportsPlugins: claude,
    supportsCost: claude,
    supportsAsk: true,
    // A route REX could not ask about must not offer to CHANGE a document. ASK
    // stays on because a question that fails costs a sentence; a write that
    // fails half-way costs a repair.
    supportsAct: claude,
    supportsResume: true,
    error: `REX could not ask ${label} what it offers, so only the defaults are available. ${reason}`,
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
    return unreachable("It answered nothing.", route.sdk);
  } catch (error) {
    return unreachable(error instanceof Error ? error.message : String(error), route.sdk);
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
  /** Spec 46 §7 — the decrypted key for a `stored` route. Main's to supply. */
  stored: string | null = null,
): Promise<CapabilityProbe> {
  const key = `${sdk}:${gateway.id}`;
  let pending = probes.get(key);
  if (!pending) {
    // A route that cannot be resolved is a route that cannot be probed, and the
    // pickers still have to draw. The reason is the sentence they show.
    let route: ResolvedRoute;
    try {
      route = resolveRoute(gateway, sdk, process.env, stored);
    } catch (error) {
      return Promise.resolve(
        unreachable(error instanceof Error ? error.message : String(error), sdk),
      );
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

/**
 * Spec 51 §4 — one turn's id, minted in the one place that mints them.
 *
 * Exported because a turn starts before `runAgent` is called: `ipc.ts` records
 * the reviewer's own message first, and that row belongs to the turn. So the
 * caller asks for the id, stamps every row it writes with it, and hands the
 * same string back through `AgentRunInput.runId`.
 *
 * > It has to be THIS function and not a UUID minted beside it. The string
 * > reaches the gateway as `x-rex-run` and comes back as the traffic row's
 * > `run`, and depth 3 is the join between the two. A different string on
 * > either side joins nothing and draws an empty grid rather than an error.
 */
export function nextRunId(): string {
  runCounter += 1;
  return `${Date.now().toString(36)}-${runCounter}`;
}

function sessionOf(input: AgentRunInput): AgentSession {
  // §5.5 — `resume: false` with an id MEANS "seed a new session with this id",
  // which is a different request from "continue it" and needs a different word.
  return input.resume
    ? { mode: "resume", id: input.sessionId }
    : { mode: "seed", id: input.sessionId };
}

/** Spec 44 §7 — whether this agent has plugins at all, from the descriptor. */
function pluginsSupported(sdk: AgentSdk): boolean {
  return CATALOGUE.sdks.find((entry) => entry.id === sdk)?.supportsPlugins ?? false;
}

/**
 * The plugin directories for this run, as opaque paths.
 *
 * `pluginsForRepository` stays in REX and resolves the marketplace refs. What
 * crosses the pipe is the list of directories it produced, with no SDK shape on
 * it — the adapter wraps them in whatever its own SDK wants.
 */
function resolvePlugins(input: AgentRunInput): string[] {
  return pluginsForRepository(input.cwd, input.profile, input.documentPath).map(
    (plugin) => plugin.path,
  );
}

function requestFor(input: AgentRunInput, runId: string): RunMessage {
  const config = PROFILES[input.profile];
  const route = input.route ?? resolveRoute(ORIGINAL_GATEWAY, REX_SDK);
  return {
    type: "run",
    runId,
    route,
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
    // Spec 44 §7 — **`bridge.ts` passes no plugin paths** to an agent that has
    // none. REX builds this list itself rather than asking the reviewer for it,
    // so an SDK without plugins is not a reviewer's mistake to be refused — it
    // is a list REX must not build. `run()` refuses a non-empty list an adapter
    // cannot honour rather than dropping it silently, which is right, and
    // measured 2026-09-04: without this line every Codex ASK failed with "the
    // codex adapter cannot load plugins, and 1 were given" before the child
    // started, because `lsp-bash` is resolved for every run.
    //
    // It also saves the work. `pluginsForRepository` shells out to resolve the
    // marketplace, and doing that for an agent that will not be given the
    // answer is a subprocess spent on nothing.
    plugins: input.plugins ?? (pluginsSupported(route.sdk) ? resolvePlugins(input) : []),
    writable: input.writable ?? [],
    readable: input.readable ?? [],
    maxTurns: config.maxTurns ?? null,
    // Spec 45 §6 — who is spending this, for the gateway's dashboards. Ids
    // only: a header lands in a span and a span is stored for months, so no
    // document text and no file path is ever put in one.
    //
    // An absent thread is normal rather than an error. An Apply run and a probe
    // have no comment thread, and the collector labels those `none` — visible
    // in the totals instead of missing from them.
    threadId: input.threadId ?? "",
    profile: input.profile,
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
  const runId = input.runId ?? nextRunId();
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

  // Spec 44 §9.1 — the run's OWN agent, not the constant. `message.route` is
  // what `requestFor` resolved, so the policy and the child can never disagree
  // about which SDK's names are about to arrive.
  const decide = policyFor(input.profile, message.route.sdk);

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
