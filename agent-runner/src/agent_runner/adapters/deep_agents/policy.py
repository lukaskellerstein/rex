"""Spec 48 §5.2 — REX's policy, installed the way a LangChain agent takes one.

The Claude adapter installs it as a `PreToolUse` hook and OpenCode's as an
answer to a permission event; here it is a **middleware around every tool call**.
The model reads the refusal as the tool's own result, exactly as it does under
Claude's hook, and `events.py` marks the matching `tool_result` denied because
this middleware wrote that sentence itself moments earlier.

Three things §5.2 said had to be verified at the pinned version. All three were,
on 2026-09-07 against `langchain` 1.4.0, and the answers removed the fallback
rather than needing it:

* **`awrap_tool_call` exists.** `AgentMiddleware.awrap_tool_call(self, request,
  handler)` is declared, with `handler` returning an awaitable. `ask_policy` is
  a coroutine — the round trip to main over the pipe — so a synchronous hook
  could not have waited for it, and the future-on-the-loop bridge §5.2 planned
  is not needed.
* **A `ToolMessage` returned without calling `handler` short-circuits.** The
  tool body did not run and the message reached the model as the result. So
  `interrupt_on` plus `InMemorySaver` plus `Command(resume=…)` — §5.2's
  documented fallback and lesson 7's shape — is not needed either.
* **The middleware sees `task`.** Which is what makes §5.3's refusal of it a
  refusal rather than a hope.

The order of the three questions is the order of their cost, and it is
deliberate. `NEVER_OFFERED` and the write boundary are answered here, in
microseconds, with no message on the pipe; only what survives both is worth
waking the host for.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage

from ...events import Denial, DeniedEvent
from ...policy import CommonTool, ToolCall
from ..base import AskPolicy, Emit
from .backend import Boundary
from .tools import NEVER_OFFERED, common_tool, policy_input

#: What a refusal of a tool REX does not offer says. One sentence, with the name.
NOT_OFFERED = "REX does not give a deep agent the '{tool}' tool. Answer the comment yourself rather than delegating it."


class PolicyMiddleware(AgentMiddleware):
    """One tool call, judged before it runs.

    It is stateful on purpose: `denials` is the run's own list and `emit` is the
    run's own stream, so two runs in one interpreter build two middlewares and
    share nothing. Spec 42 §4's rule — nothing global to the process — holds
    inside this adapter the same way it holds in the service.
    """

    def __init__(
        self,
        ask_policy: AskPolicy,
        emit: Emit,
        boundary: Boundary,
        denials: list[Denial],
        disallowed: frozenset[CommonTool] = frozenset(),
    ) -> None:
        super().__init__()
        self._ask_policy = ask_policy
        self._emit = emit
        self._boundary = boundary
        self._denials = denials
        self._disallowed = disallowed
        #: call id → the sentence REX refused it with. `events.py` reads it, so
        #: a refusal and a tool that merely failed are told apart by what REX
        #: knows rather than by guessing at the SDK's wording.
        self.refusals: dict[str, str] = {}

    async def awrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Any],
    ) -> Any:
        call = request.tool_call
        name = str(call.get("name") or "")
        args = call.get("args")
        reason = await self._refusal(name, args)
        if reason is None:
            return await handler(request)

        call_id = str(call.get("id") or "")
        self.refusals[call_id] = reason
        self._denials.append(Denial(tool_name=name, reason=reason))
        self._emit(DeniedEvent(name=name, reason=reason))
        # `status="error"` is what makes the model treat it as a result it must
        # react to rather than as the answer it asked for. Measured: the model
        # tries twice more and then answers in words, which is the behaviour
        # §7.3's note about OpenCode's `deny` says a bare refusal does NOT get.
        return ToolMessage(content=reason, tool_call_id=call_id, name=name, status="error")

    async def _refusal(self, name: str, args: Any) -> str | None:
        """Why this call may not run, cheapest question first."""
        if name in NEVER_OFFERED:
            return NOT_OFFERED.format(tool=name)
        common = common_tool(name)
        if common is not None and common in self._disallowed:
            # Spec 42 §6 — the host named this one in `disallowed`. The backend
            # rules already stop the write ones; this covers the rest and says
            # so in REX's words rather than the SDK's.
            return f"REX did not give this run the '{name}' tool."
        outside = self._boundary(name, args)
        if outside is not None:
            return outside
        return await self._ask_policy(ToolCall(name=name, common=common, input=policy_input(name, args)))


__all__ = ["NOT_OFFERED", "PolicyMiddleware"]
