"""A real service loop with a fake adapter behind it.

`test_service.py` runs THIS as the child rather than `python -m agent_gateway`,
so that everything the loop does — line framing, fd 1, dispatch, run ids, the
policy round trip, shutdown — is exercised against production code, while the
one part that would need a key, a network and six seconds of CLI start-up is
replaced by a script that answers instantly.

The registry is mutated in place, before the service is imported, because every
module binds the same dict object.
"""

import asyncio
import sys

from agent_gateway.adapters import ADAPTERS
from agent_gateway.adapters.base import AskPolicy, Emit
from agent_gateway.events import Completed, Denial, RunResult, Started, StoppedEvent, Text
from agent_gateway.policy import ToolCall
from agent_gateway.types import (
    AgentSdk,
    ResolvedRoute,
    RouteCapabilities,
    RunRequest,
    SessionState,
)


class FakeAdapter:
    """Answers according to the prompt it is given. No SDK anywhere."""

    sdk: AgentSdk = "claude-agent"
    package = "claude-agent-sdk"
    supports_styles = True
    supports_plugins = True

    def validate(self, route: ResolvedRoute) -> str | None:
        return None if route.sdk == self.sdk else f"not mine: {route.sdk}"

    async def run(
        self,
        request: RunRequest,
        emit: Emit,
        ask_policy: AskPolicy,
        stop: asyncio.Event,
    ) -> RunResult:
        session_id = getattr(request.session, "id", "")
        denials: list[Denial] = []

        if request.prompt == "print-to-stdout":
            # The whole point of §4's fd-1 guard: this must not corrupt the pipe.
            print("THIS-WOULD-CORRUPT-THE-STREAM")

        emit(Started(session_id=session_id, model="fake", style=None, tools=0))

        if request.prompt == "slow":
            await asyncio.sleep(0.05)

        if request.prompt == "forever":
            await stop.wait()
            emit(StoppedEvent())
            return RunResult(session_id=session_id, stopped=True)

        asks = {"ask-once": 1, "ask-twice": 2}.get(request.prompt, 0)
        for index in range(asks):
            call = ToolCall(name="Bash", common="shell", input={"command": f"echo {index}"})
            reason = await ask_policy(call)
            if reason is not None:
                denials.append(Denial(tool_name=call.name, reason=reason))

        emit(Text(text="hello"))
        emit(Completed(cost_usd=None, duration_ms=1))
        return RunResult(session_id=session_id, denials=denials)

    async def capabilities(self, route: ResolvedRoute, cwd: str) -> RouteCapabilities:
        return RouteCapabilities(models=[], styles=[], error=None)

    async def session_state(self, route: ResolvedRoute, cwd: str, session_id: str) -> SessionState:
        return SessionState(exists=session_id == "known")


ADAPTERS["claude-agent"] = FakeAdapter()

if __name__ == "__main__":
    from agent_gateway.service import main

    sys.exit(main())
