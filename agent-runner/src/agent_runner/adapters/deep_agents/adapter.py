"""Spec 48 — Deep Agents, behind `AgentAdapter`.

The fourth SDK, and the one that tests whether spec 42's seam is about **agents**
rather than about child processes. Claude and Codex each spawn a CLI; OpenCode
owns a server; a deep agent is a **LangGraph graph running in the service's own
interpreter**. There is no child, no CLI and no sandbox, so spec 42 §3.4's
process boundary is the only boundary between this agent and REX — the graph,
the model client and the file tools all live one pipe away from the window.

What it has instead of a sandbox is a **backend** and **permission rules**
(`backend.py`), and what it has instead of a permission prompt is a **middleware**
(`policy.py`). §2's last column is where every decision in this directory comes
from.

Every symbol here was checked against `deepagents` **0.7.13**, `langchain`
**1.4.0** and `langchain-openai` **1.6.0** on 2026-09-07, and the run is spec 48
§10. Five of those measurements contradicted the spec; each is cited where it
bites, and the two that matter most are that **the SDK's path matcher is textual
and a symlink escapes it** (`backend.py`) and that **`usage_metadata` is None
unless `stream_usage` asks for it** (`model.py`).
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import traceback
from typing import Any

from deepagents import create_deep_agent
from langgraph.checkpoint.memory import InMemorySaver

from ...attribution import attribution_headers
from ...events import (
    Completed,
    Denial,
    ErrorEvent,
    RunResult,
    Started,
    StoppedEvent,
)
from ...types import (
    AgentSdk,
    ResolvedRoute,
    ResumeSession,
    RouteCapabilities,
    RunRequest,
    SeedSession,
    SessionState,
)
from ..base import AskPolicy, Emit
from . import backend as boundaries
from . import model as models
from .events import Translator
from .policy import PolicyMiddleware

#: §6 — `max_turns` as LangGraph counts steps, measured rather than derived.
#:
#: Spec 48 §6 said `2 * max_turns + 1`. It is **`2 * max_turns + 3`**: a graph
#: with one model step and one tool step completes at `recursion_limit=5`, two
#: at 7, three at 9 (2026-09-07). The three are the `before_agent` node, the
#: final model step that answers, and the end. A limit one too small is a
#: `GraphRecursionError` in the middle of a turn that was going to succeed.
TURN_STEPS = 2
TURN_OVERHEAD = 3


class DeepAgentsAdapter:
    """One turn of a deep agent, streamed as `AgentEvent`s."""

    sdk: AgentSdk = "deep-agents"
    package = "deepagents"
    #: §9 — styles are a Claude feature. A style sent here is refused by `run.py`,
    #: never ignored.
    supports_styles = False
    #: §9 — and REX's plugin directories describe Claude plugins, which is not a
    #: thing LangChain has.
    supports_plugins = False

    def validate(self, route: ResolvedRoute) -> str | None:
        if route.sdk != self.sdk:
            return f"The Deep Agents adapter cannot run a '{route.sdk}' route."
        if route.base_url and route.auth == "inherit":
            # §4.3 — a generated OpenAI-compatible client has no login
            # convention to inherit, exactly as spec 47 §4 refuses it for
            # OpenCode. On `Original` the same word means the provider's own
            # variable, which the host resolves into `token` before a run.
            return (
                f"The Deep Agents route on '{route.gateway_name}' has a URL and asks for the "
                "SDK's own login. LangChain has no login, so pick Environment variable or "
                "No authentication."
            )
        if route.auth in ("environment", "stored"):
            if not route.token:
                return f"The Deep Agents route on '{route.gateway_name}' needs a credential, and none was resolved."
            if not route.base_url:
                return (
                    f"The Deep Agents route on '{route.gateway_name}' carries a credential but "
                    "no URL. REX sends a per-run credential only to a gateway it was given "
                    "the address of."
                )
        return None

    # ── the run ─────────────────────────────────────────────────

    async def run(
        self,
        request: RunRequest,
        emit: Emit,
        ask_policy: AskPolicy,
        stop: asyncio.Event,
    ) -> RunResult:
        denials: list[Denial] = []
        session_id = _session_id(request)

        # A host's queue can leave a run waiting behind the five-agent cap, and
        # those are the ones a reviewer most wants back. Stopped here, no model
        # is built and the run costs nothing.
        if stop.is_set():
            emit(StoppedEvent())
            return RunResult(session_id=session_id, stopped=True)

        writing = "write" not in request.disallowed
        if writing and not request.writable:
            # §8.2 — fail closed. A writing run with nowhere it may write is
            # refused rather than downgraded, the same rule spec 44 §9.3 gives
            # Codex and for the same reason.
            return _refuse(
                emit,
                session_id,
                "A Deep Agents run that may write was given no writable directory, so it was "
                "not started. This is REX's bug, not the gateway's — report it.",
            )

        try:
            chat = models.build(
                request.route,
                request.model,
                # Spec 45 §6 — the thread, the run and the profile, as headers
                # on every request this client makes. `run_id` is sent here
                # where OpenCode could not send it: REX owns the client, so a
                # header costs nothing and does not key a cached server.
                attribution_headers(request.thread_id, request.run_id, request.profile),
            )
        except models.ModelError as refusal:
            return _refuse(emit, session_id, str(refusal))
        except Exception as thrown:  # noqa: BLE001 — every failure becomes a sentence
            traceback.print_exc()
            return _refuse(emit, session_id, _explain(thrown, request.route))

        if writing:
            backend, permissions, boundary = boundaries.for_act(request.cwd, request.writable)
        else:
            backend, permissions, boundary = boundaries.for_ask(request.cwd, request.readable)

        policy = PolicyMiddleware(
            ask_policy=ask_policy,
            emit=emit,
            boundary=boundary,
            denials=denials,
            disallowed=frozenset(request.disallowed),
        )
        agent = create_deep_agent(
            model=chat,
            # Spec 42 §6 — the host's text, as the whole instruction. `deepagents`
            # appends its own tool guidance to whatever it is given.
            system_prompt=request.system_prompt or None,
            backend=backend,
            permissions=permissions,
            middleware=[policy],
            tools=[],
            # §7 — one run's memory, discarded with the run. It is here rather
            # than absent because `create_deep_agent` needs a checkpointer for
            # its own state to survive between graph steps; it is NOT a store,
            # and `supports_resume` is false because of that.
            checkpointer=InMemorySaver(),
        )

        emit(
            Started(
                session_id=session_id,
                model=request.model,
                style=None,
                # A deep agent's tool list is built inside `create_deep_agent`
                # from middleware REX did not write, so a number here would be a
                # constant that silently stops being true. None means "not
                # reported", which is what REX actually knows.
                tools=None,
                plugins=[],
            )
        )
        return await self._stream(
            agent=agent,
            request=request,
            session_id=session_id,
            emit=emit,
            stop=stop,
            denials=denials,
            refusals=policy.refusals,
            writes_allowed=writing,
        )

    async def _stream(
        self,
        *,
        agent: Any,
        request: RunRequest,
        session_id: str,
        emit: Emit,
        stop: asyncio.Event,
        denials: list[Denial],
        refusals: dict[str, str],
        writes_allowed: bool,
    ) -> RunResult:
        """§6 — consume `updates` in a task, so a stop can cancel it.

        LangGraph's Python stream takes no signal, so cancellation is the task's.
        Measured 2026-09-07: `Task.cancel()` on a graph waiting inside a tool
        raises `CancelledError` **at once** — it does not wait for the tool, and
        no thread pool keeps running it afterwards (§12.4 item 4).
        """
        translator = Translator(refusals, writes_allowed)
        started_at = time.monotonic()
        config: dict[str, Any] = {"configurable": {"thread_id": session_id or request.run_id}}
        if request.max_turns is not None:
            config["recursion_limit"] = request.max_turns * TURN_STEPS + TURN_OVERHEAD

        async def consume() -> None:
            async for payload in agent.astream(
                {"messages": [{"role": "user", "content": request.prompt}]},
                config=config,
                # §6 — `updates` only. `messages` yields token chunks that a live
                # view would use and a transcript must not store, and REX's
                # protocol has no channel for the first that is not the second.
                stream_mode="updates",
            ):
                for event in translator.updates(payload):
                    emit(event)

        reader = asyncio.create_task(consume())
        watcher = asyncio.create_task(stop.wait())
        error: str | None = None
        try:
            done, _ = await asyncio.wait({reader, watcher}, return_when=asyncio.FIRST_COMPLETED)
            if reader in done:
                reader.result()
        except asyncio.CancelledError:
            raise
        except Exception as thrown:  # noqa: BLE001 — every failure becomes a sentence
            traceback.print_exc()
            error = _explain(thrown, request.route)
        finally:
            for task in (reader, watcher):
                if not task.done():
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task

        if stop.is_set():
            # A stop is never a failure and never an error. It gets one event.
            emit(StoppedEvent(duration_ms=_elapsed(started_at)))
            return RunResult(
                session_id=session_id,
                duration_ms=_elapsed(started_at),
                denials=denials,
                stopped=True,
            )

        if error is not None:
            emit(ErrorEvent(text=error, duration_ms=_elapsed(started_at)))
        else:
            emit(
                Completed(
                    # §6 — LangChain reports tokens and never a price, and spec
                    # 42 §7 forbids inventing zero. A host draws None as unknown.
                    cost_usd=None,
                    duration_ms=_elapsed(started_at),
                    input_tokens=translator.input_tokens,
                    output_tokens=translator.output_tokens,
                )
            )
        return RunResult(
            session_id=session_id,
            cost_usd=None,
            duration_ms=_elapsed(started_at),
            denials=denials,
            error=error,
            stopped=False,
        )

    # ── the two questions that are not a run ────────────────────

    async def capabilities(self, route: ResolvedRoute, cwd: str) -> RouteCapabilities:
        """§9 — what a Deep Agents route offers, without spending anything.

        **Nothing is probed.** §4.4: a `builtin` route's models are the ones
        ticked in Settings and a `litellm` route's come from that server's own
        list, both of which the host already holds; `Original`'s are typed. There
        is no third source for this adapter to ask.
        """
        _ = cwd
        problem = self.validate(route)
        return RouteCapabilities(
            models=[],
            styles=[],
            supports_styles=False,
            supports_plugins=False,
            # §6 — LangChain reports tokens and never a price.
            supports_cost=False,
            supports_ask=problem is None,
            # §8.2 — the write boundary is the backend's rules plus REX's own
            # path check, and neither needs an operating-system sandbox. So
            # unlike OpenCode this is true on every platform REX runs on.
            supports_act=problem is None,
            # §7 — an `InMemorySaver` lives for one run. Every send is a fresh
            # graph seeded with the replay, and saying so is what makes the
            # composer's notice honest.
            supports_resume=False,
            error=problem,
        )

    async def session_state(self, route: ResolvedRoute, cwd: str, session_id: str) -> SessionState:
        """§7 — there are no sessions, and this says so rather than guessing.

        A false answer is not a failure: it sends the host down its own replay
        path (spec 42 §8.5) with the route unchanged, which is exactly what a
        run with an in-memory checkpointer needs on every turn.
        """
        _ = (route, cwd, session_id)
        return SessionState(exists=False, summary=None, last_modified=None, path=None, size=None)


# ── small pure helpers ──────────────────────────────────────────


def _session_id(request: RunRequest) -> str:
    """§7 — the id REX gave, kept so a trace and a REX thread line up.

    Nothing reads it back. `supports_resume` is false, so a `resume` request is
    the host's replay path and this id is only a label on it.
    """
    session = request.session
    return session.id if isinstance(session, (SeedSession, ResumeSession)) else ""


def _elapsed(started_at: float) -> int:
    return int((time.monotonic() - started_at) * 1000)


#: Words that mean "the gateway could not be reached".
#:
#: **`connection error` is the one that matters, and it was measured.** The
#: OpenAI client wraps every transport failure as `APIConnectionError`, whose
#: whole message is the two words "Connection error." — no host, no errno, and
#: not an `OSError`. Criterion 15 asks for a sentence naming the switch, and
#: without this row a reviewer whose built-in gateway is off gets those two
#: words and nothing to act on.
_UNREACHABLE = (
    "connection error",
    "connection refused",
    "connect call failed",
    "cannot connect",
    "all connection attempts failed",
)


def _unreachable(thrown: BaseException) -> bool:
    """Whether this failure is "nothing answered", however it was wrapped.

    The chain is walked as well as the message read: the client's own wording is
    deliberately vague, and the `OSError` that caused it is usually still on
    `__cause__` with the real reason in it.
    """
    seen: BaseException | None = thrown
    depth = 0
    while seen is not None and depth < 5:
        if isinstance(seen, OSError):
            return True
        if any(word in str(seen).lower() for word in _UNREACHABLE):
            return True
        seen = seen.__cause__ or seen.__context__
        depth += 1
    return False


def _explain(thrown: BaseException, route: ResolvedRoute) -> str:
    """One failure, as a sentence naming what a reviewer can change.

    LiteLLM will not supply one for a wrong key — spec 47 §10.6 A3 measured it
    answering `400 No connected db.`, because with no `DATABASE_URL` it cannot
    look a non-master key up — so REX has to.
    """
    text = str(thrown) or type(thrown).__name__
    lowered = text.lower()
    if route.base_url and ("no connected db" in lowered or "401" in lowered or "invalid api key" in lowered):
        return (
            f"The gateway at {route.base_url} refused REX's credential. If this is REX's own "
            "built-in gateway, switch it on in Settings; if it is another LiteLLM, check its "
            f"master key. ({text})"
        )
    if route.base_url and _unreachable(thrown):
        return (
            f"Nothing answered at {route.base_url}. If this is REX's own built-in gateway, it is "
            "switched off — turn it on in Settings. Otherwise check that the gateway is "
            f"running. ({text})"
        )
    return text


def _refuse(emit: Emit, session_id: str, reason: str) -> RunResult:
    """A run that could not start, reported the way a failed one is.

    The host branches on `error`, so a refusal has to arrive as one — and the
    event goes out too, so a streaming host shows it at once.
    """
    emit(ErrorEvent(text=reason))
    return RunResult(session_id=session_id, error=reason)


__all__ = ["TURN_OVERHEAD", "TURN_STEPS", "DeepAgentsAdapter"]
