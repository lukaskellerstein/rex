"""Spec 42 §8.1 — Claude's tool names, mapped to the common vocabulary.

The library owns the **mapping**, because a mapping is SDK knowledge. It does
not own the decision — the host's policy does, and it is asked over the pipe.

**An unknown name maps to `None` and is never guessed.** What a host does with
`None` is the host's decision, and REX makes two different ones on purpose: for
Claude it keeps today's behaviour (the SDK's own `disallowed_tools` plus the
write denials are the whole read guarantee), and for every later SDK it denies.
The fall-through direction is the whole difference between a gate and a
decoration.
"""

from ...policy import CommonTool

#: Claude's own tool names, in the order §8.1's table lists them.
CLAUDE_TO_COMMON: dict[str, CommonTool] = {
    "Read": "read",
    "LS": "list",
    "Glob": "list",
    "Grep": "search",
    "WebFetch": "fetch",
    "WebSearch": "fetch",
    "Write": "write",
    "NotebookEdit": "write",
    "Edit": "edit",
    "Bash": "shell",
    "Task": "task",
    "Agent": "task",
}

#: The same table backwards. `mcp` is absent on purpose: an MCP tool's name is
#: whatever a server calls it, so there is no finite list to disallow.
COMMON_TO_CLAUDE: dict[CommonTool, tuple[str, ...]] = {
    "read": ("Read",),
    "list": ("LS", "Glob"),
    "search": ("Grep",),
    "fetch": ("WebFetch", "WebSearch"),
    "write": ("Write", "NotebookEdit"),
    "edit": ("Edit",),
    "shell": ("Bash",),
    "task": ("Task", "Agent"),
}


def common_tool(name: str) -> CommonTool | None:
    """What this Claude tool does, or None when the library does not know."""
    if name.startswith("mcp__"):
        return "mcp"
    return CLAUDE_TO_COMMON.get(name)


def claude_tools_for(common: list[CommonTool]) -> list[str]:
    """The Claude names to disallow for these common tools, in order, no repeats.

    `["write", "edit"]` produces `["Write", "NotebookEdit", "Edit"]`, which is
    the list REX's read profile carried before the library existed. Nothing the
    model sees changes.
    """
    names: list[str] = []
    for entry in common:
        for name in COMMON_TO_CLAUDE.get(entry, ()):
            if name not in names:
                names.append(name)
    return names
