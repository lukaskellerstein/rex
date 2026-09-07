"""Spec 44 §9.1 — Codex's item types, mapped to the common vocabulary.

The trap this file exists for is written down in spec 42 §8: REX's own gate
matches `Write`, `Edit`, `NotebookEdit`, `Bash` and `mcp__*`, and **returns allow
for any name it does not know**. `commandExecution` and `fileChange` are names it
does not know. Without a mapping, every Codex tool call would sail through a gate
that thought it had never seen a tool.

So the mapping is **closed**: an item type that is not in the table is `None`,
never guessed. The host denies `None` for every SDK but Claude (spec 42 §8.1), so
a Codex item type nobody has mapped yet is a visible refusal with a name in it
rather than a silent hole. The fall-through direction is the whole difference
between a gate and a decoration.
"""

from ...policy import CommonTool

#: Codex item types that are tool calls, in the order §9.1's table lists them.
#:
#: `agentMessage`, `reasoning` and `plan` are deliberately absent: they are not
#: tool calls, they never reach the policy, and putting them here would make
#: "not a tool call" and "an unmapped tool" the same answer.
CODEX_TO_COMMON: dict[str, CommonTool] = {
    "commandExecution": "shell",
    "fileChange": "write",
    "mcpToolCall": "mcp",
    "webSearch": "fetch",
}

#: What REX's transcript calls each of them. The SDK's own type is camelCase and
#: a tool name in the transcript is read by a person, so it is spelled the way
#: every other tool name in REX is.
CODEX_TOOL_NAMES: dict[str, str] = {
    "commandExecution": "command_execution",
    "fileChange": "file_change",
    "webSearch": "web_search",
}


def common_tool(item_type: str) -> CommonTool | None:
    """What this Codex item does, or None when it is not a mapped tool call."""
    return CODEX_TO_COMMON.get(item_type)


def mcp_tool_name(server: str, tool: str) -> str:
    """An MCP call, in the one name shape every REX gate already matches.

    `mcp__<server>__<tool>` is Claude's spelling and therefore REX's: the host's
    allowlist is written in it, and a second spelling would mean a second
    allowlist that could disagree with the first.
    """
    return f"mcp__{server}__{tool}"
