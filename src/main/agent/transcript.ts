// SPEC.md §8.5 — session persistence and the replay path.
//
// The SDK keeps its own transcript under ~/.claude/projects/, which is a cache
// and gets cleaned. REX threads live for weeks. The reference implementation
// logs a warning and starts a blank session when the file is gone, silently
// losing the conversation; REX must not, because SQLite already holds every
// turn (§8.1) and can rebuild the context.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSessionInfo, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { Message } from "../../shared/types.ts";

/**
 * Claude Code's own configuration directory.
 *
 * `CLAUDE_CONFIG_DIR` overrides `~/.claude`, and it is not exotic — this
 * machine sets one. A hardcoded `~/.claude` therefore named a file that does
 * not exist while the SDK wrote the session somewhere else entirely, which is
 * invisible until something asks the filesystem rather than the SDK: the
 * fallback in `sessionExists`, and every path the debug report prints.
 * Measured on 2026-08-23.
 */
export function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/**
 * Claude Code names a project directory after its cwd with every character
 * outside [A-Za-z0-9] replaced by a dash.
 */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function sessionFilePath(cwd: string, sessionId: string): string {
  return join(configDir(), "projects", projectDirName(cwd), `${sessionId}.jsonl`);
}

/**
 * What the SDK knows about a session, or null when it has no record of one.
 *
 * `getSessionInfo` is the SDK's own supported answer — the reference
 * implementation reached into `claude_agent_sdk._internal.sessions` instead,
 * which the TypeScript binding does not expose.
 */
export async function sessionRecord(
  cwd: string,
  sessionId: string,
): Promise<SDKSessionInfo | null> {
  try {
    return (await getSessionInfo(sessionId, { dir: cwd })) ?? null;
  } catch {
    // The SDK could not answer at all — the filesystem is the fallback.
    return null;
  }
}

/**
 * Whether the SDK can still resume this session.
 *
 * The path check stays as a fallback for the case where the session store is
 * not the default one.
 */
export async function sessionExists(cwd: string, sessionId: string): Promise<boolean> {
  if (await sessionRecord(cwd, sessionId)) return true;
  return existsSync(sessionFilePath(cwd, sessionId));
}

const ROLE_LABEL: Record<string, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

/**
 * §8.5 step 3b — renders the thread's stored messages as a transcript block,
 * so a fresh session can be seeded with the conversation the SDK forgot.
 */
export function renderTranscript(messages: Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const label = ROLE_LABEL[message.role] ?? message.role;
    switch (message.kind) {
      case "text":
        if (message.content) lines.push(`${label}: ${message.content}`);
        break;
      case "tool_call":
        lines.push(`${label} used ${message.toolName ?? "a tool"}.`);
        break;
      case "diff":
        lines.push(`${label} proposed a change:\n${message.content ?? ""}`);
        break;
      case "error":
        lines.push(`Error: ${message.content ?? ""}`);
        break;
      // Spec 17 §3.2 — a replayed conversation that omits the stop is a
      // conversation with an unexplained gap in it: the agent would read a turn
      // that trails off mid-tool-call and try to account for it.
      case "stopped":
        lines.push("The user stopped the run here.");
        break;
      default:
        // thinking, tool_result and completed are noise in a replay — the
        // conversation is what has to survive, not the machinery.
        break;
    }
  }
  return lines.join("\n\n");
}

/** §8.5 step 3c — the prompt that seeds a fresh session with lost history. */
export function replayPrompt(transcript: string, message: string): string {
  return `This conversation continues an earlier discussion. Here is the transcript so far:\n\n${transcript}\n\nThe user now asks: ${message}`;
}
