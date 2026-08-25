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
  /**
   * Spec 11 §7.2 — the system prompt, when the caller needs a different one.
   *
   * Apply on a deck is the only caller that does, and it needs one because the
   * job is genuinely different: the agent writes a plan and edits nothing, so
   * a prompt telling it to "make the smallest change to the file" would be
   * telling it to do the one thing that spec exists to stop.
   */
  systemPrompt?: string;
  /**
   * Spec 11 §6.4.2 — the document under review, so a `.pptx` can load the two
   * design plugins and nothing else pays for them.
   */
  documentPath?: string | null;
  onMessage: (draft: MessageDraft) => void;
  /**
   * Spec 15 §4.3 — every path a write tool named, as it is called.
   *
   * The primary source for "what did this run touch", and better than git in
   * every way that matters: it is exact, and it works on an untracked file, a
   * new file, and a file outside any repository. `Bash` can still write behind
   * its back, which is why §4.3 has a second source.
   */
  onWrote?: (path: string) => void;
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

/**
 * The phrases the SDK itself produces when it cannot start or run its binary.
 *
 * Matched as phrases rather than as the words "not found", and that distinction
 * is the whole point of this constant. The SDK ships and resolves its own
 * `claude`; it does not look for one on `PATH`. Verified on 2026-08-25 — a query
 * spawns normally under `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, which is what a
 * Mac app started from the Dock gets.
 */
const EXECUTABLE_FAILURE =
  /claude code (?:executable|native binary) not found|claude code executable at .* failed to launch|spawn \S*claude\S* enoent/i;

/**
 * A hint to put ABOVE the error, or null when REX has nothing useful to add.
 *
 * Every pattern here matches a phrase only that one failure produces. The
 * previous version matched substrings — `auth` inside "author", and `not found`
 * inside any of the dozen sentences that contain it — and a wrong hint is worse
 * than none, because it is read as a diagnosis.
 */
function hintFor(text: string): string | null {
  const lowered = text.toLowerCase();

  if (
    /\b(401|403)\b/.test(text) ||
    lowered.includes("api_key") ||
    lowered.includes("unauthorized") ||
    lowered.includes("authentication")
  ) {
    return "Authentication failed. Set ANTHROPIC_API_KEY, or run 'claude login' to authenticate.";
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return "The agent timed out. The question may be too broad — try narrowing the comment.";
  }
  if (EXECUTABLE_FAILURE.test(text)) {
    return "The Claude Code executable could not be started. Reinstall Claude Code, or set options.pathToClaudeCodeExecutable.";
  }
  return null;
}

/**
 * Port of `_classify_error` — an actionable message ABOVE the stack, not
 * instead of it.
 *
 * Measured on 2026-08-25, thread `e2c37e06`: a run failed and the debug report
 * said *"check that the claude executable is installed and on PATH"*. The SDK
 * does not use `PATH` for that (see `EXECUTABLE_FAILURE`), so the sentence was
 * not merely unhelpful — it was false, it sent the reader after a bug that does
 * not exist, and the SDK's own words, which said what had really happened, had
 * already been thrown away by the `return` that replaced them.
 *
 * So the original text always survives. REX may add a sentence in front of it;
 * REX never speaks in its place.
 */
export function classifyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const hint = hintFor(text);
  return hint ? `${hint}\n\n${text}` : `Agent error: ${text}`;
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

/** The three tools that put bytes on disk. Spec 15 §4.3. */
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/** Assistant content blocks → message rows. */
function handleAssistant(
  message: any,
  emit: (d: MessageDraft) => void,
  wrote: (path: string) => void,
): void {
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
        // Spec 15 §4.3 — reported before the diff step and for all three tools,
        // not only the two that draw one: `NotebookEdit` writes a file whether
        // or not REX can show it as a patch.
        if (WRITE_TOOLS.has(block.name)) {
          const path = String(input.file_path ?? "");
          if (path) wrote(path);
        }
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
      append:
        input.systemPrompt ?? (input.profile === "read" ? READ_SYSTEM_PROMPT : WRITE_SYSTEM_PROMPT),
    },
    settingSources: ["project"],
    disallowedTools: config.disallowedTools,
    plugins: pluginsForRepository(input.cwd, input.profile, input.documentPath),
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
          handleAssistant(event, emit, (path) => input.onWrote?.(path));
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
    // The stack is what a maintainer needs and the one thing the reviewer's
    // screen has no room for, so it goes to the console rather than nowhere.
    console.error("[rex] agent run failed", thrown);
    error = classifyError(thrown);
    emit(draft("system", "error", error, { isError: true }));
  }

  return { sessionId, costUsd, durationMs, denials, error };
}
