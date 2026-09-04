"""Spec 42 §6.1 — the one interface every SDK is put behind.

Adding an SDK is one directory under `adapters/` and one entry in the registry.
Specs 44 to 46 each say so, and each is meant to change nothing else.
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Protocol

from ..events import AgentEvent, RunResult
from ..policy import ToolCall
from ..types import AgentSdk, ResolvedRoute, RouteCapabilities, RunRequest, SessionState

Emit = Callable[[AgentEvent], None]
"""Report one thing that happened. Called from the run's own task, in order."""

AskPolicy = Callable[[ToolCall], Awaitable[str | None]]
"""Ask the host whether this call may run. None allows; a string is the refusal.

**The library never decides.** It waits for the answer, and an adapter turns
whatever comes back into its SDK's own veto.
"""


class AgentAdapter(Protocol):
    """One SDK, behind the same four questions as every other."""

    sdk: AgentSdk
    #: The distribution whose version identifies this SDK, for a host's own
    #: version line. A version-gate error names it, so it must be the real one.
    package: str
    #: Whether `RunRequest.style` means anything here.
    supports_styles: bool
    #: Whether `RunRequest.plugins` can be honoured. A non-empty list sent to an
    #: adapter that cannot is REFUSED, never silently dropped.
    supports_plugins: bool

    def validate(self, route: ResolvedRoute) -> str | None:
        """Why this route cannot be used, or None when it can."""
        ...

    async def run(
        self,
        request: RunRequest,
        emit: Emit,
        ask_policy: AskPolicy,
        stop: asyncio.Event,
    ) -> RunResult:
        """Run one turn. `stop` is set when the host asks for the run to end."""
        ...

    async def capabilities(self, route: ResolvedRoute, cwd: str) -> RouteCapabilities:
        """What this route offers. The library probes; the host caches."""
        ...

    async def session_state(self, route: ResolvedRoute, cwd: str, session_id: str) -> SessionState:
        """Whether this SDK can still resume that session, and what it has for it.

        More than a boolean, because a host debugging a lost conversation needs
        to know WHICH of the two sources is missing — see `SessionState`.
        """
        ...
