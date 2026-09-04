"""Spec 42 §8 — the common tool vocabulary, and the call a host judges.

**The library never decides. It asks.** The host's gate stays where it is, in
the host's own language, and this module only carries the question across.
"""

from typing import Any, Literal

from .base import Model

CommonTool = Literal[
    "read",
    "list",
    "search",
    "fetch",
    "write",
    "edit",
    "shell",
    "mcp",
    "task",
]
"""What a tool DOES, told apart from what one SDK calls it.

Nine values, because nine is what the four SDKs' tool sets have in common. An
SDK tool that maps to none of them arrives as `None`, and a host decides what
that means — REX makes two different decisions on purpose (§8.1).
"""


class ToolCall(Model):
    """One tool call, on its way to the host's policy."""

    #: As the SDK gave it — `Bash`, `bash`, `command_execution`.
    name: str
    #: Mapped, or None when the library cannot. **Never guessed.**
    common: CommonTool | None = None
    input: Any = None
    #: Set when a subagent, rather than the main thread, made the call.
    subagent_id: str | None = None
