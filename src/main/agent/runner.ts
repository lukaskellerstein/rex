// SPEC.md §11 — the Vex adapter, ported.
//
// What changed on the way across, and why:
//   * `nats_service.publish` → an `onMessage` callback the caller turns into a
//     `message` row and a `webContents.send` (invariant I3).
//   * `AgentFileLogger` → the `message` table. The database is the record of
//     the conversation (§8.1); there is no second log.
//   * `_make_hooks` returning `_ALLOW` → `gate.ts`, which denies (§8.4).
//   * `ClaudeSDKClient` → `query()`. The TypeScript binding has no client
//     class; a turn is one `query()` call, and continuity comes from `resume`.
//   * `_emit_bash_step` and `_mark_previous_steps_past` → dropped. Both exist
//     for Vex's step list: the first duplicates the `tool_call` row that
//     already carries the command, and the second sets a `status` field §4's
//     Message does not have.
//   * `_inject_playwright_auth` → dropped, as §11 instructs.

import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MessageKind, MessageRole, Profile } from "../../shared/types.ts";
import type { MessageDraft } from "../db/queries.ts";
import { buildHooks, type Denial } from "./gate.ts";
import { PROFILES, pluginsForRepository } from "./profiles.ts";
import { READ_SYSTEM_PROMPT, WRITE_SYSTEM_PROMPT } from "./prompts.ts";

export interface AgentRunInput {
  cwd: string;
  profile: Profile;
  prompt: string;
  sessionId: string;
  /** True to continue an existing SDK session, false to seed a new one. */
  resume: boolean;
  model: string | null;
  onMessage: (draft: MessageDraft) => void;
}

export interface AgentRunResult {
  sessionId: string;
  costUsd: number | null;
  durationMs: number | null;
  denials: Denial[];
  error: string | null;
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

/** Port of `_emit_diff_step` — an Edit call, shown as the change it makes. */
export function diffStep(toolInput: Record<string, unknown>): MessageDraft | null {
  const filePath = String(toolInput.file_path ?? "");
  const oldString = String(toolInput.old_string ?? "");
  const newString = String(toolInput.new_string ?? "");
  if (!oldString && !newString) return null;

  const lines = [filePath];
  for (const line of oldString.split("\n")) lines.push(`- ${line}`);
  for (const line of newString.split("\n")) lines.push(`+ ${line}`);
  return draft("assistant", "diff", lines.join("\n"));
}

/** Port of `_emit_write_step` — a whole new file is a diff of pure additions. */
export function writeStep(toolInput: Record<string, unknown>): MessageDraft | null {
  const filePath = String(toolInput.file_path ?? "");
  const content = String(toolInput.content ?? "");
  if (!filePath || !content) return null;

  const lines = [filePath];
  for (const line of content.slice(0, 10_000).split("\n")) lines.push(`+ ${line}`);
  return draft("assistant", "diff", lines.join("\n"));
}

/** Port of `_classify_error` — an actionable message instead of a stack. */
export function classifyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lowered = text.toLowerCase();
  if (lowered.includes("auth") || lowered.includes("api_key") || lowered.includes("401")) {
    return "Authentication failed. Set ANTHROPIC_API_KEY, or run 'claude login' to authenticate.";
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return "The agent timed out. The question may be too broad — try narrowing the comment.";
  }
  if (lowered.includes("not found") || lowered.includes("enoent")) {
    return "The Claude Agent SDK could not start. Check that the claude executable is installed and on PATH.";
  }
  return `Agent error: ${text}`;
}

function flattenToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "string" ? item : ((item as any)?.text ?? "")))
      .join(" ");
  }
  return "";
}

/** Assistant content blocks → message rows. */
function handleAssistant(message: any, emit: (d: MessageDraft) => void): void {
  for (const block of message.message?.content ?? []) {
    switch (block.type) {
      case "text":
        if (block.text) emit(draft("assistant", "text", block.text));
        break;
      case "thinking":
        if (block.thinking) emit(draft("assistant", "thinking", block.thinking));
        break;
      case "tool_use": {
        emit(
          draft("assistant", "tool_call", null, {
            toolName: block.name,
            toolInput: block.input ?? null,
          }),
        );
        const input = (block.input ?? {}) as Record<string, unknown>;
        if (block.name === "Edit") {
          const step = diffStep(input);
          if (step) emit(step);
        } else if (block.name === "Write") {
          const step = writeStep(input);
          if (step) emit(step);
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Tool results arrive as user messages in the SDK's stream. */
function handleUser(
  message: any,
  toolNames: Map<string, string>,
  emit: (d: MessageDraft) => void,
): void {
  const content = message.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type !== "tool_result") continue;
    emit(
      draft("user", "tool_result", flattenToolResult(block.content).slice(0, 4000), {
        toolName: toolNames.get(block.tool_use_id) ?? null,
        isError: block.is_error === true,
      }),
    );
  }
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const config = PROFILES[input.profile];
  const denials: Denial[] = [];
  const toolNames = new Map<string, string>();

  const options: Options = {
    cwd: input.cwd,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: input.profile === "read" ? READ_SYSTEM_PROMPT : WRITE_SYSTEM_PROMPT,
    },
    settingSources: ["project"],
    disallowedTools: config.disallowedTools,
    plugins: pluginsForRepository(input.cwd, input.profile),
    hooks: buildHooks(input.profile, (denial) => denials.push(denial)),
    ...(config.maxTurns === undefined ? {} : { maxTurns: config.maxTurns }),
    ...(input.model ? { model: input.model } : {}),
    // Seed a session with the deterministic id, or continue the one that id
    // already names (§8.1). Passing both is a contradiction, so never do.
    ...(input.resume ? { resume: input.sessionId } : { sessionId: input.sessionId }),
  };

  let sessionId = input.sessionId;
  let costUsd: number | null = null;
  let durationMs: number | null = null;
  let error: string | null = null;

  const emit = (message: MessageDraft): void => input.onMessage(message);

  try {
    for await (const message of query({
      prompt: input.prompt,
      options,
    }) as AsyncIterable<SDKMessage>) {
      const event = message as any;
      if (event.session_id) sessionId = event.session_id;

      switch (event.type) {
        case "system":
          if (event.subtype === "init") {
            console.log(
              `[rex] agent init · model=${event.model} · tools=${event.tools?.length ?? 0} · plugins=${(event.plugins ?? []).map((p: any) => p.name).join(", ") || "none"}`,
            );
          }
          break;

        case "assistant":
          for (const block of event.message?.content ?? []) {
            if (block.type === "tool_use" && block.id) toolNames.set(block.id, block.name);
          }
          handleAssistant(event, emit);
          break;

        case "user":
          handleUser(event, toolNames, emit);
          break;

        case "result": {
          costUsd = event.total_cost_usd ?? null;
          durationMs = event.duration_ms ?? null;
          if (event.subtype === "success") {
            emit(
              draft("system", "completed", `Completed in ${durationMs ?? "?"}ms`, {
                costUsd,
                durationMs,
                inputTokens: event.usage?.input_tokens ?? null,
                outputTokens: event.usage?.output_tokens ?? null,
              }),
            );
          } else {
            error = (event.errors ?? []).join("; ") || `Agent stopped: ${event.subtype}`;
            emit(draft("system", "error", error, { isError: true, costUsd, durationMs }));
          }
          break;
        }

        default:
          break;
      }
    }
  } catch (thrown) {
    error = classifyError(thrown);
    emit(draft("system", "error", error, { isError: true }));
  }

  return { sessionId, costUsd, durationMs, denials, error };
}
