// SPEC.md §8.5 — the replay path.
//
// The SDK keeps its own transcript under `~/.claude/projects/`, which is a cache
// and gets cleaned. REX threads live for weeks. The reference implementation
// logs a warning and starts a blank session when the file is gone, silently
// losing the conversation; REX must not, because SQLite already holds every turn
// (§8.1) and can rebuild the context.
//
// Spec 42 §9.3 split this file in two, along the line of who owns what. **Where
// the Claude CLI keeps its transcripts is SDK knowledge**, so `configDir`,
// `projectDirName`, `sessionFilePath`, `sessionRecord` and `sessionExists` moved
// into `agent-gateway/…/adapters/claude/sessions.py` and are asked for over the
// pipe (`bridge.ts`'s `sessionState`). What is left here is the half that is
// about REX's own `Message` rows, and knows nothing about any SDK.

import type { Message } from "../../shared/types.ts";

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
      // Spec 34 §6.2 — the reviewer's approve, discard or undo, in the place it
      // happened. Without it a transcript says "I changed X" about a document
      // that no longer holds X, and the agent reads that as its own mistake.
      case "event":
        if (message.content) lines.push(message.content);
        break;
      default:
        // thinking, tool_result and completed are noise in a replay — the
        // conversation is what has to survive, not the machinery.
        break;
    }
  }
  return lines.join("\n\n");
}

/**
 * Spec 34 §6.2 — the reviewer's acts since the agent last spoke, oldest first.
 *
 * "Last spoke" is the last `assistant` row of any kind: a run that ended in a
 * tool call and was stopped still counts as the agent having been in the room
 * until then. The reviewer's own text sent since then is not an event and is
 * not collected — it is the reply being sent.
 */
export function eventsSinceLastAnswer(messages: readonly Message[]): string[] {
  const events: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") break;
    if (message.kind === "event" && message.content) events.unshift(message.content);
  }
  return events;
}

/**
 * §8.5 step 3c — the prompt that seeds a fresh session with lost history.
 *
 * Spec 34 §7 — `header` is the document's name and where to read it, the
 * lines the opening ASK prompt began with. A replayed session is a fresh one,
 * and the transcript it gets holds the reviewer's notes rather than the
 * prompts, so this is the only place it can learn the location.
 */
export function replayPrompt(
  transcript: string,
  message: string,
  header: readonly string[] = [],
): string {
  const top = header.length > 0 ? `${header.join("\n")}\n\n` : "";
  return `${top}This conversation continues an earlier discussion. Here is the transcript so far:\n\n${transcript}\n\nThe user now asks: ${message}`;
}
