"""Spec 42 §6 — `run`, the one door.

Pick an adapter, hand it the request and two callbacks, stream what comes back.
**It adds nothing of its own** beyond the three refusals below, each of which
exists so that a request that cannot work is refused by name rather than failing
somewhere inside an SDK.
"""

import asyncio

from .adapters import ADAPTERS, AskPolicy, Emit
from .events import ErrorEvent, RunResult
from .types import RunRequest


async def run(
    request: RunRequest,
    emit: Emit,
    ask_policy: AskPolicy,
    stop: asyncio.Event,
) -> RunResult:
    """One turn, on whichever SDK the route names.

    `emit` reports each thing that happens. `ask_policy` is asked before every
    tool call and answers None to allow or a sentence to refuse — **the host owns
    every decision**; this package only asks.
    """
    session_id = getattr(request.session, "id", "")
    adapter = ADAPTERS.get(request.route.sdk)

    if adapter is None:
        return _refuse(emit, session_id, f"No adapter for '{request.route.sdk}'.")

    refusal = adapter.validate(request.route)
    if refusal is not None:
        return _refuse(emit, session_id, refusal)

    if request.plugins and not adapter.supports_plugins:
        # Refused, never silently dropped. A plugin quietly not loaded is a run
        # that behaves differently for a reason nothing on screen explains.
        return _refuse(
            emit,
            session_id,
            f"The {request.route.sdk} adapter cannot load plugins, and {len(request.plugins)} were given.",
        )

    if request.style and not adapter.supports_styles:
        return _refuse(
            emit,
            session_id,
            f"The {request.route.sdk} adapter has no output styles, and '{request.style}' was asked for.",
        )

    return await adapter.run(request, emit, ask_policy, stop)


def _refuse(emit: Emit, session_id: str, reason: str) -> RunResult:
    """A run that never started, reported the way a run that failed is reported.

    The host branches on `error`, so a refusal has to arrive as one — and the
    event goes out too, so a streaming host shows it at once rather than at the
    end.
    """
    emit(ErrorEvent(text=reason))
    return RunResult(session_id=session_id, error=reason)
