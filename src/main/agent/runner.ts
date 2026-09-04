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
import {
  DEFAULT_MODEL,
  DEFAULT_STYLE,
  type MessageKind,
  type MessageRole,
  type Profile,
} from "../../shared/types.ts";
import type { MessageDraft } from "../db/queries.ts";
import { record as logLine } from "../log.ts";
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
   * Spec 31 §4 — the output style this run writes in. Null is the CLI's own
   * default, which is what every run did before spec 31.
   */
  style: string | null;
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
   * Spec 17 §2.2 — the reviewer's Stop, as the SDK understands it.
   *
   * It becomes `Options.abortController`, which is the SDK's own way to cancel
   * a query and the only one reachable from here: `Query.interrupt()` needs the
   * streaming input mode, and every run REX makes passes a string prompt.
   */
  signal?: AbortSignal;
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
  /**
   * Spec 17 §2.3 — the reviewer stopped this run, and `error` is therefore null.
   *
   * Every caller branches on `error`, so a stop reported as one would be shown
   * as a failure, counted as a failure in the debug report, and — in
   * `startApply` — thrown out of the IPC handler as a red notice. Nothing about
   * a stop is a fault.
   */
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
 * The bundled Claude Code is older than the model needs — and the CLI's own
 * advice about it is wrong for REX.
 *
 * Reported 2026-09-03: picking **Fable 5.1** failed with *"400 Claude Code
 * 2.1.237 does not support this model; version 2.1.251 or newer is required.
 * Run `claude update`…"*. Every word of that is true and the instruction is a
 * dead end here, for the reason `EXECUTABLE_FAILURE` above already records: the
 * SDK **ships and resolves its own binary** and never looks at PATH. This
 * machine's own Claude Code was already 2.1.259 while REX's runs were on
 * 2.1.237 — updating it changes nothing REX does.
 *
 * The fix is REX's `@anthropic-ai/claude-agent-sdk` dependency, whose versions
 * track the CLI's last segment: `0.3.237` carries Claude Code `2.1.237`, and
 * `0.3.259` carries `2.1.259`. The hint says `@latest` rather than doing that
 * arithmetic out loud, so a correspondence REX only observed cannot become a
 * promise it made.
 *
 * **This is also the hole in spec 25 §3.1**, which reasoned that every value
 * the probe returns is safe to send. The probe asks the ACCOUNT what models
 * exist; the bundled binary has a floor of its own, and nothing in the list
 * says so. REX cannot know each model's floor — only the API does, at run time,
 * with this 400 — so naming it clearly when it arrives is the whole remedy.
 */
const MODEL_NEEDS_NEWER_CLI =
  /claude code ([\d.]+) does not support this model; version ([\d.]+) or newer is required/i;

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
  const older = MODEL_NEEDS_NEWER_CLI.exec(text);
  if (older) {
    return `This model needs Claude Code ${older[2]} or newer, and the Agent SDK inside REX is ${older[1]}. Ignore the "run claude update" advice below — it updates the Claude Code on your PATH, which REX never uses. Update REX's own dependency instead: npm install @anthropic-ai/claude-agent-sdk@latest, then npm run build. Or pick a model the bundled version supports.`;
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

/**
 * Whether an errored result is the GATE speaking, rather than the tool.
 *
 * The SDK marks both with `is_error`, and they are not the same event: a `grep`
 * that matches nothing and an `ls` of a missing directory both exit non-zero
 * without anything having been refused. Told apart here and recorded on the row,
 * because this is the only place that can — the hook runs before the tool, so
 * every refusal is already in `denials` when its result arrives, and the SDK
 * hands the reason back verbatim as the result's content. REX wrote that
 * sentence itself moments earlier, so matching on it is identification and not
 * a guess about someone else's error text.
 *
 * Exported so it can be tested: it decides the flag every view reads, and it is
 * the one part of this file with no other way to be exercised.
 */
export function deniedBy(
  denials: readonly Denial[],
  toolName: string | null,
  text: string,
): boolean {
  if (SDK_REFUSAL.test(text.trim())) return true;
  return denials.some(
    (denial) => (toolName === null || denial.toolName === toolName) && text.includes(denial.reason),
  );
}

/**
 * The SDK's own refusal, which is not REX's gate and is still not a failure.
 *
 * `Permission to use Bash with command find … has been denied.` — the whole
 * message, with nothing else in it. Found in thread `7e76ed17` on 2026-09-01,
 * from a build that predates the gate returning an explicit `allow`: the SDK's
 * default permission mode wanted an approval and a headless session had nobody
 * to ask. The call never ran, so calling it FAILED would be the same lie in the
 * other direction.
 *
 * Anchored at both ends deliberately. Matched loosely it would catch a `grep`
 * whose OUTPUT quotes this sentence — a search of REX's own transcripts does
 * exactly that.
 */
const SDK_REFUSAL = /^Permission to use \S+ .*has been denied\.?$/;

/** Tool results arrive as user messages in the SDK's stream. */
function handleUser(
  message: any,
  toolNames: Map<string, string>,
  denials: readonly Denial[],
  emit: (d: MessageDraft) => void,
): void {
  const content = message.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const text = flattenToolResult(block.content);
    const toolName = toolNames.get(block.tool_use_id) ?? null;
    const isError = block.is_error === true;
    emit(
      draft("user", "tool_result", text.slice(0, 4000), {
        toolName,
        isError,
        denied: isError && deniedBy(denials, toolName, text),
      }),
    );
  }
}

/** Spec 17 §2.3 — the one message a stop writes, and the only one. */
const STOPPED = "You stopped this run.";

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const config = PROFILES[input.profile];
  const denials: Denial[] = [];
  const toolNames = new Map<string, string>();

  // Spec 17 §2.2 — the SDK cancels on a controller, and REX is given a signal,
  // so the two are bridged here. Aborting the SDK's controller must never be
  // reachable from anywhere but the reviewer's own Stop.
  const controller = new AbortController();
  const stopped = (): boolean => input.signal?.aborted === true;
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const options: Options = {
    abortController: controller,
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
    // Spec 25 §5.1 — `default` is a value the CLI advertises and REX records,
    // and it MEANS "REX says nothing". Omitting the option is how that is said
    // to the SDK, and it is exactly what every run did before spec 25. The
    // record keeps the reviewer's word; the call does not repeat it.
    ...(input.model && input.model !== DEFAULT_MODEL ? { model: input.model } : {}),
    // Spec 31 §6 — the output style, the same way and for the same reason.
    // `Options.settings` is a whole `Settings` object and `outputStyle` is one
    // of its fields; `default` is omitted rather than sent, because it MEANS
    // "REX says nothing" and saying nothing is how that is said to the SDK.
    ...(input.style && input.style !== DEFAULT_STYLE
      ? { settings: { outputStyle: input.style } }
      : {}),
    // Seed a session with the deterministic id, or continue the one that id
    // already names (§8.1). Passing both is a contradiction, so never do.
    ...(input.resume ? { resume: input.sessionId } : { sessionId: input.sessionId }),
  };

  let sessionId = input.sessionId;
  let costUsd: number | null = null;
  let durationMs: number | null = null;
  let error: string | null = null;
  /** The turn ran to its own end and said so — the SDK's `result: success`. */
  let answered = false;

  const emit = (message: MessageDraft): void => input.onMessage(message);

  /** Spec 17 §2.3 — the run ended because a person ended it. Never an error. */
  const reportStopped = (): AgentRunResult => {
    emit(draft("system", "stopped", STOPPED, { costUsd, durationMs }));
    return { sessionId, costUsd, durationMs, denials, error: null, stopped: true };
  };

  // §2.4 — an "Ask all" leaves runs queued behind the five-agent cap, and those
  // are the ones a reviewer most wants back. Stopped here, nothing is spawned
  // and the run costs nothing.
  if (stopped()) return reportStopped();

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
            // Spec 31 §10.1 — `log.ts`, not `console.log`.
            //
            // It was a console line until now, so it reached whoever ran
            // `npm run dev` and never `~/.rex/rex.log` — which meant spec 25
            // had to prove "the model REX asked for is the model that ran" by
            // reading the CLI's own transcript instead. The transcript records
            // the model per turn and does NOT record the output style, so
            // there was no way at all to check this spec's own claim.
            //
            // These are the CLI's RESOLVED values, not what REX asked for, so
            // a setting the CLI ignored shows up as a disagreement rather than
            // as a silent pass.
            logLine(
              "info",
              "agent",
              `init · model=${event.model} · style=${event.output_style ?? "?"} · tools=${event.tools?.length ?? 0} · plugins=${(event.plugins ?? []).map((p: any) => p.name).join(", ") || "none"}`,
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
          handleUser(event, toolNames, denials, emit);
          break;

        case "result": {
          costUsd = event.total_cost_usd ?? null;
          durationMs = event.duration_ms ?? null;
          if (event.subtype === "success") {
            answered = true;
            emit(
              draft("system", "completed", `Completed in ${durationMs ?? "?"}ms`, {
                costUsd,
                durationMs,
                inputTokens: event.usage?.input_tokens ?? null,
                outputTokens: event.usage?.output_tokens ?? null,
              }),
            );
          } else if (!stopped()) {
            // The word is "ended" and not "stopped" on purpose: since spec 17
            // "stopped" means the reviewer pressed Stop, and this line is the
            // one case that is genuinely a failure.
            error = (event.errors ?? []).join("; ") || `Agent ended: ${event.subtype}`;
            emit(draft("system", "error", error, { isError: true, costUsd, durationMs }));
          }
          // §2.3 — an abort also arrives as an unsuccessful turn. Its cost and
          // duration are kept; nothing else is recorded here, because
          // `reportStopped` below writes the one message a stop gets.
          break;
        }

        default:
          break;
      }
    }
  } catch (thrown) {
    // §2.3 — the abort surfaces as a thrown `AbortError`, and REX asks its own
    // signal rather than matching that class: both are true, and the signal is
    // the one REX owns, so it cannot change under a dependency bump.
    if (stopped()) return reportStopped();
    // The stack is what a maintainer needs and the one thing the reviewer's
    // screen has no room for, so it goes to the console rather than nowhere.
    console.error("[rex] agent run failed", thrown);
    error = classifyError(thrown);
    emit(draft("system", "error", error, { isError: true }));
  }

  // A late abort can end the stream cleanly, with nothing thrown. `answered`
  // is what keeps a stop pressed on the last millisecond of a run that DID
  // answer from printing "you stopped this run" under a finished answer.
  if (!answered && stopped()) return reportStopped();

  return { sessionId, costUsd, durationMs, denials, error, stopped: false };
}
