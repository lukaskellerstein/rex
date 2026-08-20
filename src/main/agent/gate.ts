// SPEC.md §8.4 — the deny gate.
//
// `disallowedTools` is configuration, not a wall: Bash can write files through
// `python -c`, `tee`, `sh -c`, or a plain `>` redirect. "read cannot write" is
// a guarantee REX makes to the user about their own documents, so it is
// enforced at runtime, on every tool call, including calls made by subagents —
// the hook fires for those too and `agent_id` says which one made it.

import type {
  HookCallbackMatcher,
  HookJSONOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { Profile } from "../../shared/types.ts";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

const BASH_ALLOW: RegExp[] = [
  /^git (log|diff|show|status|blame|ls-files)\b/,
  /^ls\b/,
  /^rg\b/,
  /^nvim-tools\b/,
  /^cat\b/,
  /^wc\b/,
];

/**
 * §8.4's allowlist anchors on the *start* of the command, which on its own is
 * not enough: `git status --porcelain > DECISION.txt` matches the git pattern
 * and writes a file, and so do `ls > f`, `cat a > b` and `rg x | tee out`. The
 * shell's own composition operators are what turn a read-only binary into a
 * write, so a command carrying any of them is never on the allowlist however
 * it begins.
 *
 * Measured: without this, a read-profile agent asked to run
 * `git status --porcelain > /tmp/out.txt` is approved by the gate.
 */
const SHELL_COMPOSITION = /[>|;&`]|\$\(|<\(/;

/**
 * MCP tools are deny-by-default with an allowlist, so an MCP server added
 * later must be allowed explicitly rather than silently gaining access.
 */
const MCP_ALLOW = new Set<string>();

export interface Denial {
  toolName: string;
  reason: string;
  /** Set when a subagent, rather than the main thread, made the call. */
  subagentId?: string;
}

const ALLOW: HookJSONOutput = {
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
};

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** The decision itself, separated from the SDK so it can be reasoned about. */
export function gateDecision(toolName: string, toolInput: unknown): string | null {
  if (WRITE_TOOLS.has(toolName)) {
    return `${toolName} cannot be used in a read session. Answer the comment; Apply is what changes files.`;
  }

  if (toolName === "Bash") {
    const command = String((toolInput as { command?: unknown })?.command ?? "").trim();
    if (SHELL_COMPOSITION.test(command)) {
      return `Bash in a read session may not redirect, pipe or chain — '${command.slice(0, 60)}' could write a file whatever it starts with.`;
    }
    if (!BASH_ALLOW.some((pattern) => pattern.test(command))) {
      return `Bash is limited to read-only inspection in a read session; '${command.slice(0, 60)}' is not on the allowlist.`;
    }
    return null;
  }

  if (toolName.startsWith("mcp__") && !MCP_ALLOW.has(toolName)) {
    return `MCP tools are deny-by-default in a read session; ${toolName} is not on the allowlist.`;
  }

  return null;
}

/**
 * Both profiles install a PreToolUse hook; only what it decides differs.
 *
 * The `write` profile keeps the reference implementation's `_ALLOW` unchanged,
 * and it is not decoration: without it the SDK's default permission mode
 * prompts for approval on every Edit, and a headless session has nobody to
 * prompt — measured, the write agent's edit came back "Claude requested
 * permissions to write to …" and Apply produced an empty diff. What protects
 * the user in this profile is §8.7 step 5: the diff is shown and nothing is
 * kept until they accept.
 */
export function buildHooks(
  profile: Profile,
  onDenial: (denial: Denial) => void,
): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> {
  if (profile === "write") {
    return { PreToolUse: [{ matcher: ".*", hooks: [async (): Promise<HookJSONOutput> => ALLOW] }] };
  }

  return {
    PreToolUse: [
      {
        matcher: ".*",
        hooks: [
          async (input): Promise<HookJSONOutput> => {
            const event = input as PreToolUseHookInput;
            const reason = gateDecision(event.tool_name, event.tool_input);
            if (!reason) return ALLOW;
            onDenial({
              toolName: event.tool_name,
              reason,
              ...(event.agent_id ? { subagentId: event.agent_id } : {}),
            });
            return deny(reason);
          },
        ],
      },
    ],
  };
}
