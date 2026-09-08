"""Spec 42 §4 — the loop. One JSON object per line, in and out.

A pipe, not a port. The host spawns this process, writes to its stdin and reads
its stdout, and nothing else on the machine can reach it. That is the whole
transport: no broker, no HTTP server, no health-poll chain, no reconnect, and no
port to clash on.

**File descriptor 1 is the protocol, and nothing else may write to it.** At
startup the real stdout is duplicated for this module's own writer and fd 1 is
rebound to fd 2, so a stray ``print()`` in an SDK, a deprecation notice, or a
child process that inherits our descriptors lands in the host's log and never in
the stream. It is the same trick every stdio MCP server plays, and without it a
single library `print` corrupts every message after it.

Concurrency is here and nowhere else: one event loop, one task per run. Every
run-scoped message carries its `run_id`, so nothing in this module is global to
the process and two runs cannot exchange events, policy answers or results.
"""

import asyncio
import contextlib
import io
import os
import sys
import traceback
from importlib.metadata import PackageNotFoundError, version
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from .adapters import ADAPTERS
from .adapters.opencode.server import REGISTRY as OPENCODE_SERVERS
from .describe import list_kinds, list_sdks
from .events import AgentEvent, RunResult
from .policy import ToolCall
from .protocol import (
    PROTOCOL_VERSION,
    CapabilitiesMessage,
    CapabilitiesValue,
    DescribeMessage,
    DescribeResult,
    DescribeValue,
    EventMessage,
    ExistsValue,
    HostMessage,
    LogMessage,
    PolicyMessage,
    PolicyReplyMessage,
    ReadyMessage,
    ReplyMessage,
    ResultMessage,
    RunMessage,
    SessionExistsMessage,
    ShutdownMessage,
    StopMessage,
    VerifyMessage,
    VerifyValue,
)
from .run import run
from .types import SessionState
from .verify import verify_route

#: A policy the host does not answer is a bug in the host, and a bug in the host
#: must never become a write. Thirty seconds, then a refusal that says so.
#:
#: The environment override exists for one reason: a test that proves the
#: refusal happens should not take thirty seconds to do it. It can only make the
#: gate stricter or slower, never absent.
POLICY_TIMEOUT_SECONDS = float(os.environ.get("AGENT_RUNNER_POLICY_TIMEOUT", "30"))

#: A `run` message carries a whole prompt, and a REX apply prompt can be large.
#: The default 64 KB line limit would truncate one and fail on the next.
LINE_LIMIT = 64 * 1024 * 1024

#: How long a `shutdown` waits for the runs it just asked to stop.
SHUTDOWN_GRACE_SECONDS = 5.0

_HOST_MESSAGE: TypeAdapter[Any] = TypeAdapter(HostMessage)


def claim_protocol_stream() -> io.TextIOWrapper:
    """Take fd 1 for the protocol, and point everything else at stderr.

    Returns the writer nothing but this module holds. After this call
    ``print()``, an SDK's own logging, and any child process that inherits fd 1
    all write to stderr — which is where the host reads its log lines from.
    """
    protocol_fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return io.TextIOWrapper(
        io.FileIO(protocol_fd, "w", closefd=True),
        encoding="utf-8",
        line_buffering=True,
        write_through=True,
    )


class Service:
    """One process's worth of state, and none of it shared between runs."""

    def __init__(self, writer: io.TextIOWrapper) -> None:
        self._writer = writer
        self._outbox: asyncio.Queue[str | None] = asyncio.Queue()
        #: run_id → the event that ends that run.
        self._runs: dict[str, asyncio.Event] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        #: request id → the host's pending answer about one tool call.
        self._policies: dict[str, asyncio.Future[str | None]] = {}
        self._stopping = asyncio.Event()

    # ── the loop ────────────────────────────────────────────────

    async def serve(self, reader: asyncio.StreamReader) -> int:
        pump = asyncio.create_task(self._pump())
        self._send(
            ReadyMessage(
                version=PROTOCOL_VERSION,
                python=sys.version,
                library=_version_of("agent-runner"),
                sdks={adapter.package: _version_of(adapter.package) for adapter in ADAPTERS.values()},
            )
        )

        try:
            while not self._stopping.is_set():
                line = await reader.readline()
                if not line:
                    # The host closed the pipe. There is nobody left to answer.
                    break
                text = line.strip()
                if text:
                    self._accept(text)
        finally:
            await self._finish()
            await self._outbox.put(None)
            await pump

        return 0

    def _accept(self, text: bytes) -> None:
        try:
            message = _HOST_MESSAGE.validate_json(text)
        except ValidationError as invalid:
            # The line itself is NEVER logged: a `run` carries a credential, and
            # a Pydantic error carries the input that failed. Only the shape of
            # the failure crosses.
            problems = ", ".join(
                f"{'.'.join(str(part) for part in error['loc'])}: {error['type']}" for error in invalid.errors()[:5]
            )
            self._log("error", f"Unreadable message ({invalid.error_count()} problems): {problems}")
            return
        self._dispatch(message)

    def _dispatch(self, message: Any) -> None:
        if isinstance(message, RunMessage):
            self._spawn(self._do_run(message))
        elif isinstance(message, StopMessage):
            stop = self._runs.get(message.run_id)
            if stop is not None:
                stop.set()
        elif isinstance(message, PolicyReplyMessage):
            pending = self._policies.pop(message.id, None)
            if pending is not None and not pending.done():
                pending.set_result(message.reason)
        elif isinstance(message, DescribeMessage):
            self._spawn(self._do_describe(message))
        elif isinstance(message, CapabilitiesMessage):
            self._spawn(self._do_capabilities(message))
        elif isinstance(message, SessionExistsMessage):
            self._spawn(self._do_session_exists(message))
        elif isinstance(message, VerifyMessage):
            self._spawn(self._do_verify(message))
        elif isinstance(message, ShutdownMessage):
            self._stopping.set()

    # ── the four things a message can ask for ───────────────────

    async def _do_describe(self, message: DescribeMessage) -> None:
        try:
            value = DescribeValue(describe=DescribeResult(sdks=list_sdks(), kinds=list_kinds()))
        except Exception as thrown:
            self._fail(message.id, thrown)
            return
        self._send(ReplyMessage(id=message.id, ok=True, value=value))

    async def _do_capabilities(self, message: CapabilitiesMessage) -> None:
        adapter = ADAPTERS.get(message.route.sdk)
        if adapter is None:
            self._send(ReplyMessage(id=message.id, ok=False, error=f"No adapter for '{message.route.sdk}'."))
            return
        try:
            found = await adapter.capabilities(message.route, message.cwd)
        except Exception as thrown:
            self._fail(message.id, thrown)
            return
        self._send(ReplyMessage(id=message.id, ok=True, value=CapabilitiesValue(capabilities=found)))

    async def _do_session_exists(self, message: SessionExistsMessage) -> None:
        adapter = ADAPTERS.get(message.route.sdk)
        if adapter is None:
            # An SDK with no adapter has no sessions, which is a plain answer
            # rather than a failure: the host will start a fresh one.
            self._send(ReplyMessage(id=message.id, ok=True, value=ExistsValue(session=SessionState(exists=False))))
            return
        try:
            found = await adapter.session_state(message.route, message.cwd, message.session_id)
        except Exception as thrown:
            self._fail(message.id, thrown)
            return
        self._send(ReplyMessage(id=message.id, ok=True, value=ExistsValue(session=found)))

    async def _do_verify(self, message: VerifyMessage) -> None:
        try:
            found = await verify_route(message.route)
        except Exception as thrown:
            self._fail(message.id, thrown)
            return
        self._send(ReplyMessage(id=message.id, ok=True, value=VerifyValue(verify=found)))

    async def _do_run(self, message: RunMessage) -> None:
        stop = asyncio.Event()
        self._runs[message.run_id] = stop

        def emit(event: AgentEvent) -> None:
            self._send(EventMessage(run_id=message.run_id, event=event))

        async def ask_policy(call: ToolCall) -> str | None:
            return await self._ask_policy(message.run_id, call)

        try:
            result = await run(message, emit, ask_policy, stop)
        except Exception as thrown:
            traceback.print_exc()
            result = RunResult(
                session_id=getattr(message.session, "id", ""),
                error=f"The agent library failed: {thrown}",
            )
        finally:
            self._runs.pop(message.run_id, None)

        self._send(ResultMessage(run_id=message.run_id, result=result))

    # ── the policy round trip ───────────────────────────────────

    async def _ask_policy(self, run_id: str, call: ToolCall) -> str | None:
        request_id = uuid4().hex
        pending: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        self._policies[request_id] = pending
        self._send(PolicyMessage(id=request_id, run_id=run_id, call=call))
        try:
            return await asyncio.wait_for(pending, POLICY_TIMEOUT_SECONDS)
        except TimeoutError:
            return (
                f"REX did not answer within {int(POLICY_TIMEOUT_SECONDS)} seconds, "
                f"so {call.name} was refused. This is a fault in REX, not in the request — "
                "an unanswered safety check must never become a write."
            )
        finally:
            self._policies.pop(request_id, None)

    # ── writing ─────────────────────────────────────────────────

    def _send(self, message: Any) -> None:
        """Queue one message. Never writes from here, so ordering is the queue's."""
        self._outbox.put_nowait(message.model_dump_json(by_alias=True))

    def _log(self, level: str, text: str) -> None:
        self._send(LogMessage(level=level, text=text))  # type: ignore[arg-type]

    def _fail(self, request_id: str, thrown: BaseException) -> None:
        traceback.print_exc()
        self._send(ReplyMessage(id=request_id, ok=False, error=str(thrown)))

    async def _pump(self) -> None:
        """One task owns the writer, so two messages can never interleave."""
        loop = asyncio.get_running_loop()
        while True:
            line = await self._outbox.get()
            if line is None:
                return
            await loop.run_in_executor(None, self._write, line)

    def _write(self, line: str) -> None:
        self._writer.write(line + "\n")

    # ── ending ──────────────────────────────────────────────────

    def _spawn(self, work: Any) -> None:
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _finish(self) -> None:
        """Ask every open run to end, then wait a short while for it."""
        for stop in list(self._runs.values()):
            stop.set()
        for pending in list(self._policies.values()):
            if not pending.done():
                pending.set_result("The agent library is shutting down.")
        if self._tasks:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    asyncio.gather(*self._tasks, return_exceptions=True),
                    SHUTDOWN_GRACE_SECONDS,
                )
        # Spec 47 §5.1 and criterion 4 — the OpenCode servers are the one thing
        # the library owns that outlives a run, so they are the one thing that
        # has to be closed by name. After the runs, so a server is not killed
        # out from under a turn that is still finishing.
        await OPENCODE_SERVERS.close()


async def _stdin_reader() -> asyncio.StreamReader:
    reader = asyncio.StreamReader(limit=LINE_LIMIT)
    loop = asyncio.get_running_loop()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    return reader


async def serve() -> int:
    writer = claim_protocol_stream()
    service = Service(writer)
    return await service.serve(await _stdin_reader())


def main() -> int:
    return asyncio.run(serve())


def _version_of(distribution: str) -> str:
    """A package's installed version, or a word that is obviously not one.

    Never raises: a version line is diagnostics, and diagnostics that can fail
    are diagnostics nobody gets when they most need them.
    """
    try:
        return version(distribution)
    except PackageNotFoundError:
        return "unknown"
