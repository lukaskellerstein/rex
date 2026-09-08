// GENERATED FILE — DO NOT EDIT.
//
// Spec 42 §4.3. Written by `agent-runner`'s Pydantic models:
//
//     uv run python -m agent_runner.protocol --typescript > src/shared/agent-protocol.ts
//
// `test/protocol.spec.ts` regenerates this and fails when it differs, so a
// model changed on the Python side cannot be missed on this one.
//
// Every field is camelCase because the models set a camelCase alias generator
// and serialise by alias. `run_id` in Python is `runId` here and on the wire.
//
// Every field is required. The service always sends all of them, and a host
// should always send all of them — a missing field is accepted by Pydantic's
// defaults, but the contract does not promise it.

/** Bumped when a message changes shape. Carried by the `ready` message. */
export const PROTOCOL_VERSION = "1";

export type AgentSdk = "claude-agent" | "codex" | "opencode" | "deep-agents";

export type GatewayKind = "original" | "builtin" | "litellm";

export type AgentAuth = "inherit" | "none" | "environment" | "stored";

export type CommonTool =
  | "read"
  | "list"
  | "search"
  | "fetch"
  | "write"
  | "edit"
  | "shell"
  | "mcp"
  | "task";

export type AgentSession = SeedSession | ResumeSession | NewSession;

export type AgentEvent =
  | Started
  | Text
  | Thinking
  | ToolCallEvent
  | ToolResultEvent
  | Diff
  | Wrote
  | DeniedEvent
  | ErrorEvent
  | StoppedEvent
  | Completed;

export type ReplyValue = DescribeValue | CapabilitiesValue | ExistsValue | VerifyValue;

export type HostMessage =
  | DescribeMessage
  | CapabilitiesMessage
  | SessionExistsMessage
  | VerifyMessage
  | RunMessage
  | StopMessage
  | PolicyReplyMessage
  | ShutdownMessage;

export type ServiceMessage =
  | ReadyMessage
  | ReplyMessage
  | EventMessage
  | ResultMessage
  | PolicyMessage
  | LogMessage;

/** How one SDK reaches one gateway. */
export interface GatewayRoute {
  baseUrl: string | null;
  auth: AgentAuth;
  credentialEnv: string | null;
  models: string[];
}

/** A named set of routes. The library defines the shape and never stores one. */
export interface AgentGateway {
  id: string;
  name: string;
  kind: GatewayKind;
  routes: Partial<Record<AgentSdk, GatewayRoute>>;
}

/** §5.3 — what a run is actually given. Built by the host, never stored here. */
export interface ResolvedRoute {
  sdk: AgentSdk;
  gatewayName: string;
  baseUrl: string | null;
  auth: AgentAuth;
  token: string | null;
}

/** Start a session, and use this id. The host computed it and will store it. */
export interface SeedSession {
  mode: "seed";
  id: string;
}

/** Continue the session this id names. */
export interface ResumeSession {
  mode: "resume";
  id: string;
}

/** Start a session and let the SDK name it. The id comes back in `RunResult`. */
export interface NewSession {
  mode: "new";
}

/** One row of a model picker, named by the adapter that knows the SDK. */
export interface ModelChoice {
  value: string;
  displayName: string;
  description: string;
}

/** What this SDK, through this gateway, can actually offer. */
export interface RouteCapabilities {
  models: ModelChoice[];
  styles: string[];
  supportsStyles: boolean;
  supportsPlugins: boolean;
  supportsCost: boolean;
  supportsAsk: boolean;
  supportsAct: boolean;
  supportsResume: boolean;
  error: string | null;
}

/** Everything a run needs, and nothing that names an SDK. */
export interface RunRequest {
  runId: string;
  route: ResolvedRoute;
  cwd: string;
  prompt: string;
  session: AgentSession;
  model: string | null;
  style: string | null;
  systemPrompt: string;
  disallowed: CommonTool[];
  plugins: string[];
  writable: string[];
  readable: string[];
  maxTurns: number | null;
  threadId: string;
  profile: string;
}

/** What the SDK knows about one session, and what is on disk for it. */
export interface SessionState {
  exists: boolean;
  summary: string | null;
  lastModified: number | null;
  path: string | null;
  size: number | null;
}

/** One call the host's policy refused, and why. */
export interface Denial {
  toolName: string;
  reason: string;
  subagentId: string | null;
}

/** The SDK is up, and these are the values it RESOLVED. */
export interface Started {
  type: "started";
  sessionId: string;
  model: string | null;
  style: string | null;
  tools: number | null;
  plugins: string[];
}

export interface Text {
  type: "text";
  text: string;
}

export interface Thinking {
  type: "thinking";
  text: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  id: string;
  name: string;
  common: CommonTool | null;
  input: unknown;
}

export interface ToolResultEvent {
  type: "tool_result";
  id: string;
  name: string | null;
  text: string;
  isError: boolean;
  denied: boolean;
}

/** A change to one file, as the change itself rather than as a tool call. */
export interface Diff {
  type: "diff";
  path: string;
  before: string | null;
  after: string;
}

/** A write tool named this path. The primary source for "what did this touch". */
export interface Wrote {
  type: "wrote";
  path: string;
}

export interface DeniedEvent {
  type: "denied";
  name: string;
  reason: string;
  subagentId: string | null;
}

/** The run failed, and this is what it said. */
export interface ErrorEvent {
  type: "error";
  text: string;
  costUsd: number | null;
  durationMs: number | null;
}

/** A person ended this run. Never a fault, and never an error. */
export interface StoppedEvent {
  type: "stopped";
  costUsd: number | null;
  durationMs: number | null;
}

export interface Completed {
  type: "completed";
  costUsd: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** The run is over. Nothing more will arrive for this `run_id`. */
export interface RunResult {
  sessionId: string;
  costUsd: number | null;
  durationMs: number | null;
  denials: Denial[];
  error: string | null;
  stopped: boolean;
}

/** One tool call, on its way to the host's policy. */
export interface ToolCall {
  name: string;
  common: CommonTool | null;
  input: unknown;
  subagentId: string | null;
}

/** One choice in a `select` field. */
export interface Option {
  value: string;
  label: string;
}

/** One control the host draws, and one value it sends back. */
export interface ConfigField {
  key: string;
  label: string;
  kind: "url" | "text" | "textarea" | "select" | "env-var" | "password";
  required: boolean;
  placeholder: string | null;
  help: string | null;
  options: Option[] | null;
  default: string | null;
}

/** What one kind offers one SDK — described, and as a template. */
export interface RouteNote {
  protocol: string;
  note: string;
  baseUrl: string | null;
  auth: AgentAuth;
  credentialEnv: string | null;
  appends: string | null;
}

/** One gateway kind: what to ask the reviewer, and what each SDK gets. */
export interface KindDescriptor {
  id: GatewayKind;
  label: string;
  fields: ConfigField[];
  routes: Partial<Record<AgentSdk, RouteNote>>;
  unverified: string | null;
}

/** One SDK a host may offer. Only SDKs with an adapter are listed. */
export interface SdkDescriptor {
  id: AgentSdk;
  label: string;
  supportsStyles: boolean;
  supportsPlugins: boolean;
}

/** One answer the reviewer must fix before the gateway can be saved. */
export interface FieldError {
  key: string;
  message: string;
}

export interface DescribeResult {
  sdks: SdkDescriptor[];
  kinds: KindDescriptor[];
}

export interface DescribeValue {
  kind: "describe";
  describe: DescribeResult;
}

export interface CapabilitiesValue {
  kind: "capabilities";
  capabilities: RouteCapabilities;
}

export interface ExistsValue {
  kind: "exists";
  session: SessionState;
}

/** What one server said about itself, and whether it named this route's path. */
export interface VerifyResult {
  ok: boolean;
  baseUrl: string;
  expected: string | null;
  document: string | null;
  published: string[];
  status: number | null;
  note: string;
}

export interface VerifyValue {
  kind: "verify";
  verify: VerifyResult;
}

/** What SDKs are real, and what gateway kinds can be configured (§10). */
export interface DescribeMessage {
  type: "describe";
  id: string;
}

/** What this route offers. The library probes; the host caches (§9.4). */
export interface CapabilitiesMessage {
  type: "capabilities";
  id: string;
  route: ResolvedRoute;
  cwd: string;
}

/** Whether the SDK can still resume this session (§9.3). */
export interface SessionExistsMessage {
  type: "session_exists";
  id: string;
  route: ResolvedRoute;
  cwd: string;
  sessionId: string;
}

/** Spec 43 §2.4 — what this server publishes, checked against this route. */
export interface VerifyMessage {
  type: "verify";
  id: string;
  route: ResolvedRoute;
}

/**
 * Start a run. **It has no reply**: its acknowledgement is its first event,
 * and its completion is its `result`.
 */
export interface RunMessage {
  runId: string;
  route: ResolvedRoute;
  cwd: string;
  prompt: string;
  session: AgentSession;
  model: string | null;
  style: string | null;
  systemPrompt: string;
  disallowed: CommonTool[];
  plugins: string[];
  writable: string[];
  readable: string[];
  maxTurns: number | null;
  threadId: string;
  profile: string;
  type: "run";
}

/** End this run. It finishes with a `stopped` event and a `result`. */
export interface StopMessage {
  type: "stop";
  runId: string;
}

/** The host's answer about one tool call. None allows; a string refuses. */
export interface PolicyReplyMessage {
  type: "policy_reply";
  id: string;
  reason: string | null;
}

/** Finish the open runs and exit 0. */
export interface ShutdownMessage {
  type: "shutdown";
}

/** The loop is up. Sent once, first, and it is the only health check there is. */
export interface ReadyMessage {
  type: "ready";
  version: string;
  python: string;
  library: string;
  sdks: Record<string, string>;
}

/** Answers `describe`, `capabilities` and `session_exists`, by echoed id. */
export interface ReplyMessage {
  type: "reply";
  id: string;
  ok: boolean;
  value: ReplyValue | null;
  error: string | null;
}

/** One thing happened in a run (§7). */
export interface EventMessage {
  type: "event";
  runId: string;
  event: AgentEvent;
}

/** The run is over. Nothing more will arrive for this `run_id`. */
export interface ResultMessage {
  type: "result";
  runId: string;
  result: RunResult;
}

/** Judge this tool call before it runs (§8). */
export interface PolicyMessage {
  type: "policy";
  id: string;
  runId: string;
  call: ToolCall;
}

/** A line for the host's log. **Never a credential** (§4.4). */
export interface LogMessage {
  type: "log";
  level: "info" | "warn" | "error";
  text: string;
}

/** §10 — what `describe` answers, frozen at generation time. */
export const CATALOGUE: DescribeResult = {
  "kinds": [
    {
      "fields": [],
      "id": "original",
      "label": "Original",
      "routes": {
        "claude-agent": {
          "appends": null,
          "auth": "inherit",
          "baseUrl": null,
          "credentialEnv": null,
          "note": "The Claude CLI's own endpoint, on your own login.",
          "protocol": "anthropic"
        },
        "codex": {
          "appends": null,
          "auth": "inherit",
          "baseUrl": null,
          "credentialEnv": null,
          "note": "Codex's own endpoint, on your own login.",
          "protocol": "openai-responses"
        },
        "deep-agents": {
          "appends": null,
          "auth": "inherit",
          "baseUrl": null,
          "credentialEnv": null,
          "note": "Whatever the model provider's own environment names.",
          "protocol": "openai-chat"
        },
        "opencode": {
          "appends": null,
          "auth": "inherit",
          "baseUrl": null,
          "credentialEnv": null,
          "note": "A local OpenCode server, on its own configuration.",
          "protocol": "opencode"
        }
      },
      "unverified": null
    },
    {
      "fields": [
        {
          "default": "http://127.0.0.1:24334",
          "help": "REX chooses this. It moves if the port is taken.",
          "key": "url",
          "kind": "url",
          "label": "Address",
          "options": null,
          "placeholder": null,
          "required": false
        }
      ],
      "id": "builtin",
      "label": "Built-in",
      "routes": {
        "claude-agent": {
          "appends": "/v1/messages",
          "auth": "environment",
          "baseUrl": "{url}",
          "credentialEnv": "REX_GATEWAY_KEY",
          "note": "Anthropic Messages, at the root. One alias serves every agent (spec 46 \u00a74.5).",
          "protocol": "anthropic"
        },
        "codex": {
          "appends": "/responses",
          "auth": "environment",
          "baseUrl": "{url}/v1",
          "credentialEnv": "REX_GATEWAY_KEY",
          "note": "OpenAI Responses, from the same alias.",
          "protocol": "openai-responses"
        },
        "deep-agents": {
          "appends": "/v1/chat/completions",
          "auth": "environment",
          "baseUrl": "{url}/v1",
          "credentialEnv": "REX_GATEWAY_KEY",
          "note": "OpenAI chat. Spec 48.",
          "protocol": "openai-chat"
        },
        "opencode": {
          "appends": "/session",
          "auth": "environment",
          "baseUrl": "{url}/v1",
          "credentialEnv": "REX_GATEWAY_KEY",
          "note": "OpenAI chat, as a model provider. Spec 47.",
          "protocol": "openai-chat"
        }
      },
      "unverified": null
    },
    {
      "fields": [
        {
          "default": null,
          "help": "Just the address. Do not add a path \u2014 each SDK's own is filled in below.",
          "key": "url",
          "kind": "url",
          "label": "Host",
          "options": null,
          "placeholder": "http://localhost:4000",
          "required": true
        },
        {
          "default": null,
          "help": "Encrypted by your operating system and never shown again. A LiteLLM answers 401 to everything without it \u2014 including its own model list, so REX cannot even ask what it serves.",
          "key": "key",
          "kind": "password",
          "label": "Master key",
          "options": null,
          "placeholder": null,
          "required": true
        }
      ],
      "id": "litellm",
      "label": "LiteLLM",
      "routes": {
        "claude-agent": {
          "appends": "/v1/messages",
          "auth": "stored",
          "baseUrl": "{url}",
          "credentialEnv": null,
          "note": "Anthropic Messages, at the root. LiteLLM translates to whatever the alias names.",
          "protocol": "anthropic"
        },
        "codex": {
          "appends": "/responses",
          "auth": "stored",
          "baseUrl": "{url}/v1",
          "credentialEnv": null,
          "note": "OpenAI Responses. Spec 44.",
          "protocol": "openai-responses"
        },
        "deep-agents": {
          "appends": "/v1/chat/completions",
          "auth": "stored",
          "baseUrl": "{url}/v1",
          "credentialEnv": null,
          "note": "OpenAI chat. Spec 48.",
          "protocol": "openai-chat"
        },
        "opencode": {
          "appends": "/session",
          "auth": "stored",
          "baseUrl": "{url}/v1",
          "credentialEnv": null,
          "note": "OpenAI chat, as a model provider. Spec 47.",
          "protocol": "openai-chat"
        }
      },
      "unverified": null
    }
  ],
  "sdks": [
    {
      "id": "claude-agent",
      "label": "Claude Agent SDK",
      "supportsPlugins": true,
      "supportsStyles": true
    },
    {
      "id": "codex",
      "label": "Codex",
      "supportsPlugins": false,
      "supportsStyles": false
    },
    {
      "id": "opencode",
      "label": "OpenCode",
      "supportsPlugins": false,
      "supportsStyles": false
    },
    {
      "id": "deep-agents",
      "label": "Deep Agents",
      "supportsPlugins": false,
      "supportsStyles": false
    }
  ]
};
