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
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { Message } from "../../shared/types.ts";

/**
 * Claude Code names a project directory after its cwd with every character
 * outside [A-Za-z0-9] replaced by a dash.
 */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function sessionFilePath(cwd: string, sessionId: string): string {
  return join(homedir(), ".claude", "projects", projectDirName(cwd), `${sessionId}.jsonl`);
}

/**
 * Whether the SDK can still resume this session.
 *
 * `getSessionInfo` is the SDK's own supported answer to this question — the
 * reference implementation reached into `claude_agent_sdk._internal.sessions`
 * instead, which the TypeScript binding does not expose. The path check stays
 * as a fallback for the case where the session store is not the default one.
 */
export async function sessionExists(cwd: string, sessionId: string): Promise<boolean> {
  try {
    if (await getSessionInfo(sessionId, { dir: cwd })) return true;
  } catch {
    // Fall through to the filesystem.
  }
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
