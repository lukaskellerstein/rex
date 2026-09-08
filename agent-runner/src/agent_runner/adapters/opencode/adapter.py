"""Spec 47 — OpenCode, behind `AgentAdapter`.

The third SDK, and the one with a different shape. Claude and Codex each spawn a
CLI that talks to the model API; OpenCode has one more hop — this adapter talks
HTTP and SSE to an **OpenCode server**, and that server talks to the model API.
`server.py` owns the first hop and `route.base_url` always means the second (§2).

Three things follow from that shape and nothing else in this package does them:

* **The event bus is server-wide**, so every event is discarded unless
  `sessionID` matches this run's (§5.4). A run now leases its own server
  (`server.py`), so this filter is belt and braces rather than the only thing
  keeping two comments apart — but it stays, because the failure it prevents is
  one comment's answer landing in another's transcript, and that is not a failure
  to leave resting on one mechanism.
* **Safety is four layers, and the fourth arrived by measurement** (§7.2). The
  session's permission ruleset, REX's own policy, a project directory that is not
  the reviewed tree — and, where the platform has one, a seatbelt that makes
  everything outside `RunRequest.writable` unwritable. §7.2 said OpenCode has
  prompts where Codex has a sandbox; §10.9 measured that a sandbox can be put
  AROUND the server rather than found inside it, so ASK has the layer too.
* **ACT exists, on macOS only, and it is the seatbelt that makes it safe.**
  §7.4.1 option B: a write turn runs in the workspace exactly as a Claude ACT
  does, and the sandbox allows precisely `RunRequest.writable` — the spec 22
  working copies — so the reviewed repository is unwritable by the operating
  system rather than by a promise. On a platform with no boundary `supports_act`
  is false AND `_act_refusal` stops the run, because a capability flag and a
  run-time check that could disagree are two ways to be wrong.

Every symbol and every shape here was measured against `opencode` **1.18.27** on
2026-09-07 and the run is spec 47 §10.6. Five of those measurements contradicted
the spec; each is cited where it bites.
"""

from __future__ import annotations

import asyncio
import contextlib
import subprocess
import time
import traceback
from pathlib import Path
from typing import Any

from ...attribution import attribution_headers
from ...events import (
    Completed,
    Denial,
    DeniedEvent,
    Diff,
    ErrorEvent,
    RunResult,
    Started,
    StoppedEvent,
    Text,
    Thinking,
    ToolCallEvent,
    ToolResultEvent,
    Wrote,
)
from ...policy import ToolCall
from ...types import (
    AgentSdk,
    ResolvedRoute,
    ResumeSession,
    RouteCapabilities,
    RunRequest,
    SessionState,
)
from ..base import AskPolicy, Emit
from .client import OpenCodeClient, OpenCodeError, Part, PermissionRequest
from .mirror import reconcile
from .server import REGISTRY, home, resolve_executable, sandbox_available
from .tools import common_tool, policy_input, read_ruleset, write_ruleset

#: The tools whose completion means a file on disk changed.
WRITING_TOOLS = frozenset({"write", "edit", "apply_patch"})

#: How long a stop waits for OpenCode to finish aborting before giving up.
#:
#: `POST /abort` is acknowledged at once but the session goes idle a moment
#: later, and the one `stopped` event should be the last thing a reviewer sees
#: rather than a race with a late text part.
ABORT_GRACE = 10.0


class OpenCodeAdapter:
    """One turn of an OpenCode session, streamed as `AgentEvent`s."""

    sdk: AgentSdk = "opencode"
    #: There is no OpenCode SDK package (§3, §10.3), so the distribution that
    #: identifies this adapter is the one dependency it adds. The version that
    #: actually matters is the `opencode` executable's, and `capabilities()`
    #: reports that one — where a reviewer can act on it.
    package = "httpx"
    #: §7.5 — an output style sent here is refused, never ignored (spec 43 §4.4).
    supports_styles = False
    #: §7.5 — OpenCode plugins are not Claude plugins, and a directory REX
    #: resolved for Claude describes none of them.
    supports_plugins = False

    def validate(self, route: ResolvedRoute) -> str | None:
        if route.sdk != self.sdk:
            return f"The OpenCode adapter cannot run a '{route.sdk}' route."
        if route.base_url and route.auth == "inherit":
            # §4 — a newly generated private provider has no vendor credential
            # convention to inherit, so there is nothing for `inherit` to mean.
            return (
                f"The OpenCode route on '{route.gateway_name}' has a URL and asks for the "
                "SDK's own login. A private provider REX generates has no account to "
                "inherit from, so pick Environment variable or No authentication."
            )
        if route.auth in ("environment", "stored"):
            if not route.token:
                return f"The OpenCode route on '{route.gateway_name}' needs a credential, and none was resolved."
            if not route.base_url:
                return (
                    f"The OpenCode route on '{route.gateway_name}' carries a credential but no URL. "
                    "REX sends a per-run credential only to a gateway it was given the address of."
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
        session_id = request.session.id if isinstance(request.session, ResumeSession) else ""

        # A host's queue can leave a run waiting behind the five-agent cap, and
        # those are the ones a reviewer most wants back. Stopped here, no server
        # is started and the run costs nothing.
        if stop.is_set():
            emit(StoppedEvent())
            return RunResult(session_id=session_id, stopped=True, denials=denials)

        executable, missing = resolve_executable()
        if missing is not None:
            return _refuse(emit, session_id, missing)

        if request.route.base_url and not request.model:
            # A gateway ROUTES on the model name, so "say nothing" is never a
            # thing to say to one. `Original` is the opposite, which is why this
            # is not simply "a model is required".
            return _refuse(
                emit,
                session_id,
                f"'{request.route.gateway_name}' is a gateway, and a gateway routes on the model "
                "name — so this run needs one and was given none. Open Manage gateways, edit "
                "this gateway, and tick the models it answers to.",
            )

        model = request.model or ""
        if not request.route.base_url and "/" not in model:
            # §4 — with no URL the adapter synthesizes no provider, so OpenCode's
            # own configuration has to resolve the name and it only can in
            # `provider/model` form.
            return _refuse(
                emit,
                session_id,
                "An OpenCode route with no gateway uses OpenCode's own providers, so the model "
                f"has to be written as provider/model. '{model or 'nothing'}' is not.",
            )

        writing = "write" not in request.disallowed
        if writing:
            refusal = self._act_refusal(request)
            if refusal is not None:
                return _refuse(emit, session_id, refusal)

        started_at = time.monotonic()
        try:
            # §7.4.1 option B — **where the agent runs depends on what it may do.**
            #
            # A read run gets the disposable mirror of §5.2: it has nowhere it
            # may write, so a copy is the natural project directory and it is the
            # layer that works on every platform.
            #
            # A write run runs in the workspace itself, exactly as a Claude ACT
            # does, and the SEATBELT is what makes the repository unwritable.
            # The mirror cannot be used here: the write prompt names the working
            # copies by absolute path (spec 22), and those paths do not exist
            # inside a mirror. Measured 2026-09-07, §10.10.
            key = request.thread_id or session_id or request.run_id
            if writing:
                directory = Path(request.cwd)
                writable = [Path(path) for path in request.writable]
                note = "no mirror; the boundary is the sandbox"
            else:
                mirror, refreshed = reconcile(request.cwd, key)
                directory = mirror
                writable = [mirror]
                note = refreshed.summary()
            # Spec 45 §6 — which REX thread is spending this. It goes into the
            # provider config, because REX's client talks to the OpenCode server
            # rather than to the gateway and `options.headers` is the only path a
            # header has to LiteLLM (criterion 16, measured §10.6).
            #
            # `run_id` is deliberately NOT sent. It would make every reply on a
            # thread a different server for one field, and the thread and the
            # profile are what a month of spend is grouped by.
            headers = attribution_headers(request.thread_id, "", request.profile)
            server = await REGISTRY.acquire(request.route, model, executable, headers, writable)
        except Exception as thrown:  # noqa: BLE001 — every failure becomes a sentence
            traceback.print_exc()
            return _refuse(emit, session_id, _explain(thrown, request.route))

        refreshed_note = note
        client = server.client(str(directory))
        try:
            session_id = await self._session(client, request, session_id)
            emit(
                Started(
                    session_id=session_id,
                    model=model,
                    style=None,
                    tools=None,
                    plugins=[],
                )
            )
            return await self._turn(
                client=client,
                request=request,
                session_id=session_id,
                emit=emit,
                ask_policy=ask_policy,
                stop=stop,
                denials=denials,
                started_at=started_at,
                mirror_note=refreshed_note,
            )
        except OpenCodeError as failed:
            return _refuse(emit, session_id, _explain(failed, request.route), denials)
        except Exception as thrown:  # noqa: BLE001
            if stop.is_set():
                emit(StoppedEvent(duration_ms=_elapsed(started_at)))
                return RunResult(
                    session_id=session_id,
                    duration_ms=_elapsed(started_at),
                    denials=denials,
                    stopped=True,
                )
            traceback.print_exc()
            return _refuse(emit, session_id, _explain(thrown, request.route), denials)
        finally:
            await client.aclose()
            # The lease, not a close: a second run on the same key would
            # otherwise have its server killed mid-turn by the first to finish.
            await REGISTRY.release(server)

    def _act_refusal(self, request: RunRequest) -> str | None:
        """§7.4 — why this ACT must not start. None when it may.

        **It fails closed, twice.** A writing run with no operating-system
        boundary, or with nowhere it may write, is refused rather than
        downgraded — the same rule spec 44 §9.3 gives Codex, and for the same
        reason: the one thing worse than an agent that cannot change a document
        is one that changes the wrong document.
        """
        if not sandbox_available():
            return (
                "OpenCode cannot make changes on this machine: REX's write boundary is a "
                "seatbelt around the OpenCode server, `/usr/bin/sandbox-exec` is not there, "
                "and OpenCode has permission prompts rather than a sandbox of its own. "
                "Claude and Deep Agents ACT are unaffected."
            )
        if not request.writable:
            return (
                "An OpenCode run that may write was given no writable directory, so it was not "
                "started. This is REX's bug, not the gateway's — report it."
            )
        return None

    async def _session(self, client: OpenCodeClient, request: RunRequest, stored: str) -> str:
        """§5.3 — the three session modes, as three HTTP calls.

        A `seed` session's supplied id is **discarded**: OpenCode names its own
        sessions and there is no parameter for one, so sending a REX id would put
        it in a field the server ignores silently. The real id comes back in
        `RunResult` and the host stores that.
        """
        ruleset = read_ruleset() if "write" in request.disallowed else write_ruleset()
        if isinstance(request.session, ResumeSession) and stored:
            # Validating and prompting the same session. A 404 here is what
            # sends REX down its own replay path with the route unchanged.
            await client.get_session(stored)
            return stored
        created = await client.create_session(title="REX", permission=ruleset)
        return str(created["id"])

    async def _turn(
        self,
        *,
        client: OpenCodeClient,
        request: RunRequest,
        session_id: str,
        emit: Emit,
        ask_policy: AskPolicy,
        stop: asyncio.Event,
        denials: list[Denial],
        started_at: float,
        mirror_note: str,
    ) -> RunResult:
        """§5.4 — subscribe, prompt, read to this session's `session.idle`.

        **The subscription opens before the prompt**, and the order is the whole
        reason a fast local model does not lose its own first tokens: a turn that
        answers in 1.7 s can be half over by the time a stream opened afterwards
        is connected.
        """
        seen_tools: dict[str, str] = {}
        emitted: set[str] = set()
        # §6 — which message each part belongs to, and whose it is.
        #
        # **The reviewer's own prompt comes back as a `text` part.** OpenCode
        # echoes the user message onto the bus exactly as it does the answer, and
        # a part carries `messageID` but no role — so without this map the first
        # thing every OpenCode turn wrote to the transcript was the reviewer's
        # own question, stored as the agent's reply. Measured 2026-09-07, and it
        # is the one mapping bug that looks like a working run.
        roles: dict[str, str] = {}
        error: str | None = None
        cost: float | None = None
        input_tokens: int | None = None
        output_tokens: int | None = None
        answered = False
        subscribed = asyncio.Event()
        stopping = False

        async def read() -> None:
            nonlocal error, answered, stopping
            async for event in client.events():
                subscribed.set()
                kind = str(event.get("type") or "")
                properties = event.get("properties") or {}
                if not _mine(kind, properties, session_id):
                    continue

                if kind == "message.updated":
                    info = properties.get("info") or {}
                    if isinstance(info.get("id"), str):
                        roles[info["id"]] = str(info.get("role") or "")
                elif kind == "message.part.updated":
                    for produced in self._part_events(properties.get("part") or {}, seen_tools, emitted, roles):
                        emit(produced)
                elif kind in ("permission.asked", "permission.v2.asked"):
                    await self._answer_permission(client, properties, seen_tools, ask_policy, emit, denials)
                elif kind == "session.error":
                    error = error or _session_error(properties, request.route)
                elif kind == "session.idle":
                    answered = True
                    return

        async def watch_stop() -> None:
            nonlocal stopping
            await stop.wait()
            stopping = True
            with contextlib.suppress(Exception):
                await client.abort(session_id)

        reader = asyncio.create_task(read())
        watcher = asyncio.create_task(watch_stop())
        try:
            await asyncio.wait_for(subscribed.wait(), timeout=30)
            await client.prompt_async(session_id, request.prompt, system=request.system_prompt or None)
            await reader
        except TimeoutError:
            error = error or "The OpenCode server accepted the run but never sent an event."
        finally:
            watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watcher
            if not reader.done():
                reader.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await reader

        if stopping or stop.is_set():
            # §5.4 — a stop is never a failure and never an error. It gets one
            # event, and the abort has already been sent.
            emit(StoppedEvent(cost_usd=None, duration_ms=_elapsed(started_at)))
            return RunResult(
                session_id=session_id,
                duration_ms=_elapsed(started_at),
                denials=denials,
                error=None,
                stopped=True,
            )

        # §5.4 — reconcile against history, so an SSE disconnect cannot leave a
        # successful answer half-written. Anything already emitted is skipped by
        # part id, which is what makes running this every time safe.
        if answered:
            with contextlib.suppress(Exception):
                cost, input_tokens, output_tokens = await self._reconcile(
                    client, session_id, seen_tools, emitted, roles, emit
                )

        if error is not None:
            emit(ErrorEvent(text=error, duration_ms=_elapsed(started_at)))
        else:
            emit(
                Completed(
                    # §6 — a private provider has no pricing table, so OpenCode
                    # reports 0 rather than nothing. None MEANS "not reported"
                    # and draws as unknown; $0.00 would claim a paid run was free.
                    cost_usd=cost,
                    duration_ms=_elapsed(started_at),
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            )
        _ = mirror_note
        return RunResult(
            session_id=session_id,
            cost_usd=cost,
            duration_ms=_elapsed(started_at),
            denials=denials,
            error=error,
            stopped=False,
        )

    # ── §6 — OpenCode parts become `AgentEvent`s ────────────────

    def _part_events(
        self,
        raw: dict[str, Any],
        seen_tools: dict[str, str],
        emitted: set[str],
        roles: dict[str, str],
    ) -> list[Any]:
        """One `message.part.updated`, as the events REX stores for it.

        **Terminal states only.** A tool part is reported three times — pending,
        running, completed — and emitting on each would put the same call in the
        transcript three times. `pending` and `running` are ephemeral by §6's
        table; what a reviewer reads is the finished call and its result.

        **The user's half of the conversation is dropped.** `roles` says which
        message a part belongs to; REX already has the reviewer's own prompt and
        storing OpenCode's echo of it would write the question in as the answer.
        A part whose message has not been seen is kept: it is an assistant part
        whose `message.updated` was missed, and losing an answer is worse than
        keeping an echo.
        """
        part = Part.model_validate(raw)
        if roles.get(part.message_id) == "user":
            return []
        if part.type == "tool" and part.call_id:
            seen_tools[part.call_id] = part.tool or ""
        state = part.state
        key = part.id or f"{part.type}:{part.call_id or ''}"

        if part.type in ("text", "reasoning"):
            # An empty reasoning part is normal and is not a part to drop — §10.5
            # measured one carrying `''`. An empty TEXT part is nothing to store.
            if part.type == "text" and not (part.text or "").strip():
                return []
            if key in emitted:
                return []
            emitted.add(key)
            return [Text(text=part.text or "")] if part.type == "text" else [Thinking(text=part.text or "")]

        if part.type != "tool" or state is None or state.status not in ("completed", "error"):
            return []
        if key in emitted:
            return []
        emitted.add(key)

        name = part.tool or "?"
        call_id = part.call_id or key
        produced: list[Any] = [
            ToolCallEvent(
                id=call_id,
                name=name,
                common=common_tool(name),
                input=policy_input(state.input),
            )
        ]
        failed = state.status == "error"
        produced.append(
            ToolResultEvent(
                id=call_id,
                name=name,
                text=(state.error or state.output or "") if failed else (state.output or ""),
                is_error=failed,
                # §7.1 — a rejection comes back as an error whose text is REX's
                # own sentence, so the two are told apart by the sentence rather
                # than by a flag OpenCode does not send.
                denied=failed and _looks_denied(state.error or state.output or ""),
            )
        )
        if not failed and name in WRITING_TOOLS:
            path = _path_of(state)
            if path:
                produced.append(Wrote(path=path))
                after = _written_text(name, state)
                if after is not None:
                    produced.append(Diff(path=path, before=None, after=after))
        return produced

    async def _answer_permission(
        self,
        client: OpenCodeClient,
        properties: dict[str, Any],
        seen_tools: dict[str, str],
        ask_policy: AskPolicy,
        emit: Emit,
        denials: list[Denial],
    ) -> None:
        """§7.1 — the ruleset raises the question and REX's policy answers it.

        **Never `always`.** The server is shared across a route's sessions, so
        `always` would change the rules for another comment — criterion 11. The
        two answers are `once` and `reject`, and nothing here can produce a third.
        """
        asked = PermissionRequest.model_validate(properties)
        call_id = (asked.tool or {}).get("callID", "")
        # The tool part arrives before the permission — measured — so this is a
        # lookup and not a guess. The permission name is the fallback, and for
        # every tool but `write` the two are the same string anyway (§10.6 E).
        name = seen_tools.get(call_id) or asked.permission
        reason = await ask_policy(ToolCall(name=name, common=common_tool(name), input=policy_input(asked.metadata)))
        if reason is None:
            await client.reply_permission(asked.id, "once")
            return
        denials.append(Denial(tool_name=name, reason=reason))
        emit(DeniedEvent(name=name, reason=reason))
        await client.reply_permission(asked.id, "reject", reason)

    async def _reconcile(
        self,
        client: OpenCodeClient,
        session_id: str,
        seen_tools: dict[str, str],
        emitted: set[str],
        roles: dict[str, str],
        emit: Emit,
    ) -> tuple[float | None, int | None, int | None]:
        """§5.4 — the finished answer, from history rather than from the stream.

        The stream is the fast path and this is the true one. Anything the stream
        already delivered is skipped by part id; what is left is what a dropped
        connection would otherwise have swallowed.
        """
        history = await client.messages(session_id, limit=20)
        cost: float | None = None
        input_tokens: int | None = None
        output_tokens: int | None = None
        for entry in history:
            # History says the role outright, which is also how `roles` learns
            # about a message whose `message.updated` the stream never delivered.
            roles[entry.info.id] = entry.info.role
            if entry.info.role != "assistant":
                continue
            for part in entry.parts:
                for produced in self._part_events(part.model_dump(by_alias=True), seen_tools, emitted, roles):
                    emit(produced)
            # §6 — 0 is what a private provider reports when it has no pricing
            # table, and drawing $0.00 for it would be a claim REX cannot make.
            cost = entry.info.cost or None
            tokens = entry.info.tokens or {}
            if isinstance(tokens.get("input"), int):
                input_tokens = tokens["input"]
            if isinstance(tokens.get("output"), int):
                output_tokens = tokens["output"]
        return cost, input_tokens, output_tokens

    # ── the two questions that are not a run ────────────────────

    async def capabilities(self, route: ResolvedRoute, cwd: str) -> RouteCapabilities:
        """§7.5 — what an OpenCode route offers, without spending anything.

        **No server is started.** Starting one costs half a second and a 144 MB
        process to learn what a reviewer already typed: spec 43 §4.3 makes a
        route's models the ones configured on it, so there is nothing to ask.
        What IS asked is the executable's own version, because a missing or a
        wrong `opencode` is the one failure a reviewer can act on and it costs a
        `--version` that answers in milliseconds.
        """
        _ = cwd
        refusal = self.validate(route)
        executable, missing = resolve_executable()
        version = _executable_version(executable) if missing is None else None
        problem = refusal or missing
        return RouteCapabilities(
            models=[],
            styles=[],
            supports_styles=False,
            supports_plugins=False,
            # §7.5 — reported when the provider reports it, which for a private
            # provider over a local gateway means "not at all".
            supports_cost=True,
            supports_ask=problem is None,
            # §7.4 — true only with an operating-system boundary REX has
            # measured. It was a platform gate until spec 50 made macOS the only
            # platform; what is left is the machine's own answer, and
            # `_act_refusal` asks the same question again at run time so the two
            # cannot drift.
            supports_act=problem is None and sandbox_available(),
            supports_resume=True,
            error=problem
            or (
                None
                if sandbox_available()
                else (
                    "OpenCode cannot make changes on this machine: `/usr/bin/sandbox-exec` "
                    "is not there, and REX's write boundary is a seatbelt around the "
                    f"OpenCode server. (opencode {version or 'found'})"
                )
            ),
        )

    async def session_state(self, route: ResolvedRoute, cwd: str, session_id: str) -> SessionState:
        """§5.3 — whether this server still has the session.

        Asked by asking, because `GET /session/{id}` IS the question and a 404 is
        its answer. A false answer is not a failure: it sends the host down its
        own replay path (spec 42 §8.5) with the route unchanged, which is what a
        REX thread that outlived a server's data directory needs.

        **A server is started to answer it**, unlike `capabilities`, because
        there is no other place the answer lives. It is asked with **no model**:
        the session store is `XDG_DATA_HOME`, which `server.route_key` keys by
        route alone, so a probe finds the sessions every model on that gateway
        made — and a probe server needs no default model to answer a lookup.
        """
        _ = cwd
        executable, missing = resolve_executable()
        if missing is not None or self.validate(route) is not None:
            return _unknown_session()
        try:
            probe = Path(_probe_directory())
            server = await REGISTRY.acquire(route, "", executable, None, [probe])
            client = server.client(str(probe))
            try:
                await client.get_session(session_id)
                found = True
            finally:
                await client.aclose()
                await REGISTRY.release(server)
        except Exception:  # noqa: BLE001 — a session that cannot be asked about is one to replay
            found = False
        return SessionState(exists=found, summary=None, last_modified=None, path=None, size=None)


# ── small pure helpers ──────────────────────────────────────────


def _probe_directory() -> str:
    """A directory for a question that is not a run. Its own, and never a mirror."""
    path = home() / "probe"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _unknown_session() -> SessionState:
    return SessionState(exists=False, summary=None, last_modified=None, path=None, size=None)


def _elapsed(started_at: float) -> int:
    return int((time.monotonic() - started_at) * 1000)


def _mine(kind: str, properties: dict[str, Any], session_id: str) -> bool:
    """§5.4 — is this event this run's?

    OpenCode's bus is **server-wide**, and two comments on one route share a
    server. An event whose owner cannot be determined is kept: `server.connected`
    and `catalog.updated` belong to nobody, and dropping them would be dropping
    the stream's own liveness.
    """
    if kind == "session.idle":
        owner = properties.get("sessionID")
        return owner in (None, session_id)
    for candidate in (
        properties.get("sessionID"),
        (properties.get("part") or {}).get("sessionID"),
        (properties.get("info") or {}).get("sessionID"),
    ):
        if isinstance(candidate, str):
            return candidate == session_id
    return True


def _looks_denied(text: str) -> bool:
    """Whether a tool error is REX's refusal rather than the tool having failed.

    OpenCode sends both back the same way — `state.status == "error"` with a
    sentence — so the sentence is what tells them apart. The wording is the
    server's own and was measured: *"The user rejected permission to use this
    specific tool call…"* (§10.6 D).
    """
    return "rejected permission" in text.lower()


def _path_of(state: Any) -> str | None:
    """The file a write tool named, from wherever this tool puts it."""
    metadata = getattr(state, "metadata", None) or {}
    for key in ("filepath", "filePath", "file_path"):
        value = metadata.get(key)
        if isinstance(value, str) and value:
            return value
    given = getattr(state, "input", None)
    if isinstance(given, dict):
        for key in ("filePath", "filepath", "file_path"):
            value = given.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _written_text(name: str, state: Any) -> str | None:
    """The text a `write` put on disk, when the call carries it.

    Only `write`, and only from its own input. An `edit` carries a diff rather
    than a whole file, and `Diff.after` is defined as the file's new text — so
    filling it from a patch would put a fragment where a document belongs.
    """
    if name != "write":
        return None
    given = getattr(state, "input", None)
    if isinstance(given, dict) and isinstance(given.get("content"), str):
        return given["content"]
    return None


def _session_error(properties: dict[str, Any], route: ResolvedRoute) -> str:
    """A `session.error`, as the sentence REX shows. The original text, kept.

    **Criterion 18 lands here and not in `_explain`**, which is the thing that
    was got wrong first. When the gateway is off, nothing fails at REX's HTTP
    layer: the OpenCode server starts perfectly and is perfectly reachable, and
    it is *OpenCode* that cannot reach the model. So the failure arrives on the
    event bus as prose — measured 2026-09-07: "Cannot connect to API: Unable to
    connect. Is the computer able to access the url?" — and REX's own sentence
    has to be added to it here.
    """
    error = properties.get("error")
    text = "The OpenCode session reported an error with no message."
    if isinstance(error, dict):
        data = error.get("data")
        if isinstance(data, dict) and isinstance(data.get("message"), str):
            text = data["message"]
        elif isinstance(error.get("name"), str):
            text = str(error["name"])
    elif isinstance(error, str):
        text = error
    return _with_gateway_advice(text, route)


#: Words that mean "the model API could not be reached", from either side.
#:
#: OpenCode's own wording and `httpx`'s are both here because both arrive: one
#: on the event bus and one as an exception, for the same cause.
_UNREACHABLE = ("cannot connect", "unable to connect", "connection refused", "econnrefused")


def _with_gateway_advice(text: str, route: ResolvedRoute) -> str:
    """Add what a reviewer can DO, when the text says the gateway is unreachable.

    The original text is kept and the advice appended, never substituted: the
    server's own words are what a maintainer needs, and REX's sentence is what
    the reviewer needs. Criterion 18 asks for the second and §6 asks for the
    first, so it says both.
    """
    lowered = text.lower()
    if not any(phrase in lowered for phrase in _UNREACHABLE):
        return text
    return (
        f"{text} Nothing answered at {route.base_url}. If this is REX's own built-in "
        "gateway, it is switched off — turn it on in Settings. Otherwise check that the "
        "gateway is running."
    )


def _explain(thrown: BaseException, route: ResolvedRoute) -> str:
    """One failure, as a sentence naming what a reviewer can change.

    LiteLLM will not supply a sentence for a wrong key (§10.0 — it answers
    "No connected db." because it has no database to look a non-master key up
    in), so REX has to.
    """
    if isinstance(thrown, OpenCodeError):
        if thrown.status in (401, 403):
            return (
                f"The gateway at {route.base_url} refused REX's credential. If this is REX's "
                "own built-in gateway, switch it on in Settings; if it is another LiteLLM, "
                "check its master key."
            )
        return str(thrown)
    text = str(thrown) or type(thrown).__name__
    if isinstance(thrown, OSError) or "connect" in text.lower():
        return (
            f"Nothing answered at {route.base_url}. If this is REX's own built-in gateway, "
            "it is switched off — turn it on in Settings. Otherwise check that the gateway "
            f"is running. ({text})"
        )
    return text


def _executable_version(executable: str) -> str | None:
    """`opencode --version`, for the sheet. Never fatal, and never slow."""
    try:
        done = subprocess.run(  # noqa: S603 — the path came from the host, not from a model
            [executable, "--version"], capture_output=True, text=True, timeout=10, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return (done.stdout or done.stderr).strip().splitlines()[0] if done.stdout or done.stderr else None


def _refuse(emit: Emit, session_id: str, reason: str, denials: list[Denial] | None = None) -> RunResult:
    """A run that could not start, reported the way a failed one is.

    The host branches on `error`, so a refusal has to arrive as one — and the
    event goes out too, so a streaming host shows it at once.
    """
    emit(ErrorEvent(text=reason))
    return RunResult(session_id=session_id, error=reason, denials=denials or [])


__all__ = ["OpenCodeAdapter"]
