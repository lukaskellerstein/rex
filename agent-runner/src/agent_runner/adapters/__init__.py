"""The adapters, and the one map that says which SDKs are real.

Adding an SDK is one directory beside this file and one entry in `ADAPTERS`.
Specs 44, 47 and 48 each added exactly that and changed no type: `AgentSdk`
already carried all four names, so the vocabulary did not move when an adapter
landed. With spec 48 built, all four are here and the list is closed until a
fifth SDK is chosen.
"""

from ..types import AgentSdk
from .base import AgentAdapter, AskPolicy, Emit
from .claude.adapter import ClaudeAdapter
from .codex.adapter import CodexAdapter
from .deep_agents.adapter import DeepAgentsAdapter
from .opencode.adapter import OpenCodeAdapter

ADAPTERS: dict[AgentSdk, AgentAdapter] = {
    "claude-agent": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "opencode": OpenCodeAdapter(),
    "deep-agents": DeepAgentsAdapter(),
}
"""Every SDK that can actually run. A name absent here is a name that is
declared and not built, and asking for it is refused by name rather than
failing somewhere inside an SDK."""


def adapter_for(sdk: AgentSdk) -> AgentAdapter | None:
    return ADAPTERS.get(sdk)


__all__ = ["ADAPTERS", "AgentAdapter", "AskPolicy", "Emit", "adapter_for"]
