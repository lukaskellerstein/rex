"""Spec 42 §4 — the loop, driven through a real pipe.

The child is started as a subprocess of the test, exactly as a host starts it,
and spoken to in the protocol's own words. Nothing is mocked: a bug in the line
framing, in fd 1, or in the dispatch shows up here and nowhere else.

The one thing deliberately NOT exercised is a real SDK run. `run` is redirected
at a fake adapter through an environment variable the service itself knows
nothing about (`conftest`-free, see `_FAKE`), so the loop can be tested without
a key, a network or six seconds of CLI start-up.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

#: A tiny module that replaces the adapter registry, then runs the real service.
#: Everything below the swap — framing, dispatch, run ids, the policy round trip,
#: shutdown — is the production code.
_FAKE = ROOT / "tests" / "fake_service.py"

POLICY_TIMEOUT_OVERRIDE = "0.4"


class Child:
    """One service process, and the lines it has said."""

    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self.process = process

    async def send(self, message: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        await self.process.stdin.drain()

    async def read(self) -> dict[str, Any]:
        assert self.process.stdout is not None
        line = await asyncio.wait_for(self.process.stdout.readline(), 20)
        assert line, "the service closed its pipe"
        return json.loads(line)

    async def read_until(self, kind: str) -> dict[str, Any]:
        while True:
            message = await self.read()
            if message["type"] == kind:
                return message


async def start() -> Child:
    environment = {
        **os.environ,
        "PYTHONPATH": str(SRC),
        "PYTHONUNBUFFERED": "1",
        "AGENT_RUNNER_POLICY_TIMEOUT": POLICY_TIMEOUT_OVERRIDE,
    }
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(_FAKE),
        cwd=str(ROOT),
        env=environment,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    return Child(process)


@pytest.fixture
async def child():
    started = await start()
    try:
        yield started
    finally:
        if started.process.returncode is None:
            started.process.kill()
        await started.process.wait()


async def test_ready_is_the_first_line_and_the_only_health_check(child: Child) -> None:
    ready = await child.read()
    assert ready["type"] == "ready"
    assert ready["version"]
    assert ready["python"].startswith(f"{sys.version_info.major}.{sys.version_info.minor}")
    assert isinstance(ready["sdks"], dict)


async def test_describe_answers_the_id_it_was_asked_with(child: Child) -> None:
    await child.read_until("ready")
    await child.send({"type": "describe", "id": "q1"})
    reply = await child.read_until("reply")
    assert reply["id"] == "q1"
    assert reply["ok"] is True
    assert reply["value"]["kind"] == "describe"
    assert [sdk["id"] for sdk in reply["value"]["describe"]["sdks"]] == [
        "claude-agent",
        "codex",
        "opencode",
        "deep-agents",
    ]


async def test_a_run_streams_its_events_and_ends_in_one_result(child: Child) -> None:
    await child.read_until("ready")
    await child.send(_run("r1", "say-hello"))

    kinds = []
    while True:
        message = await child.read()
        if message["type"] == "event":
            assert message["runId"] == "r1"
            kinds.append(message["event"]["type"])
        elif message["type"] == "result":
            assert message["runId"] == "r1"
            assert message["result"]["sessionId"] == "s1"
            break
    assert kinds == ["started", "text", "completed"]


async def test_two_runs_on_one_pipe_cannot_exchange_anything(child: Child) -> None:
    """§13 criterion 13 — `run_id` is the only thing keeping them apart."""
    await child.read_until("ready")
    await child.send(_run("a", "slow"))
    await child.send(_run("b", "say-hello"))

    seen: dict[str, list[str]] = {"a": [], "b": []}
    results: set[str] = set()
    while len(results) < 2:
        message = await child.read()
        if message["type"] == "event":
            seen[message["runId"]].append(message["event"]["type"])
        elif message["type"] == "result":
            results.add(message["runId"])

    assert seen["b"] == ["started", "text", "completed"]
    assert seen["a"] == ["started", "text", "completed"]


async def test_a_stop_ends_that_run_and_no_other(child: Child) -> None:
    await child.read_until("ready")
    await child.send(_run("a", "forever"))
    await child.send(_run("b", "forever"))
    # Both runs have started before either is stopped.
    started = 0
    while started < 2:
        message = await child.read()
        if message["type"] == "event" and message["event"]["type"] == "started":
            started += 1

    await child.send({"type": "stop", "runId": "a"})
    result = await child.read_until("result")
    assert result["runId"] == "a"
    assert result["result"]["stopped"] is True
    assert result["result"]["error"] is None


async def test_the_policy_round_trip_allows_and_refuses(child: Child) -> None:
    await child.read_until("ready")
    await child.send(_run("r1", "ask-twice"))

    answers = ["", "no you may not"]
    given = 0
    denied = None
    while True:
        message = await child.read()
        if message["type"] == "policy":
            assert message["runId"] == "r1"
            assert message["call"]["name"] == "Bash"
            reason = answers[given] or None
            given += 1
            await child.send({"type": "policy_reply", "id": message["id"], "reason": reason})
        elif message["type"] == "result":
            denied = message["result"]["denials"]
            break
    assert given == 2
    assert denied == [{"toolName": "Bash", "reason": "no you may not", "subagentId": None}]


async def test_a_policy_nobody_answers_is_denied_and_says_so(child: Child) -> None:
    """§13 criterion 8 — a bug in the host must never become a write."""
    await child.read_until("ready")
    await child.send(_run("r1", "ask-once"))

    policy = await child.read_until("policy")
    assert policy["call"]["name"] == "Bash"
    # Deliberately answer nothing.
    result = await child.read_until("result")
    (denial,) = result["result"]["denials"]
    assert "did not answer" in denial["reason"]
    assert "refused" in denial["reason"]


async def test_an_unreadable_line_is_logged_without_its_contents(child: Child) -> None:
    """§4.4 — a bad line can carry a token, so only the shape of the failure crosses."""
    await child.read_until("ready")
    assert child.process.stdin is not None
    child.process.stdin.write(b'{"type": "run", "token": "sk-SUPER-SECRET"}\n')
    await child.process.stdin.drain()

    log = await child.read_until("log")
    assert log["level"] == "error"
    assert "Unreadable message" in log["text"]
    assert "SUPER-SECRET" not in log["text"]

    # And the loop is still alive.
    await child.send({"type": "describe", "id": "after"})
    assert (await child.read_until("reply"))["id"] == "after"


async def test_a_stray_print_never_reaches_the_protocol_stream(child: Child) -> None:
    """§4 — fd 1 is the protocol. A library's `print()` must land in stderr."""
    await child.read_until("ready")
    await child.send(_run("r1", "print-to-stdout"))
    result = await child.read_until("result")
    assert result["runId"] == "r1"

    assert child.process.stderr is not None
    await child.send({"type": "shutdown"})
    await asyncio.wait_for(child.process.wait(), 10)
    noise = (await child.process.stderr.read()).decode()
    assert "THIS-WOULD-CORRUPT-THE-STREAM" in noise


async def test_shutdown_ends_the_open_runs_and_exits_zero(child: Child) -> None:
    await child.read_until("ready")
    await child.send(_run("r1", "forever"))
    await child.read_until("event")

    await child.send({"type": "shutdown"})
    code = await asyncio.wait_for(child.process.wait(), 15)
    assert code == 0


async def test_closing_the_pipe_ends_the_child(child: Child) -> None:
    """There is nobody left to answer, so there is nothing left to do."""
    await child.read_until("ready")
    assert child.process.stdin is not None
    child.process.stdin.close()
    code = await asyncio.wait_for(child.process.wait(), 15)
    assert code == 0


def _run(run_id: str, prompt: str) -> dict[str, Any]:
    return {
        "type": "run",
        "runId": run_id,
        "route": {
            "sdk": "claude-agent",
            "gatewayName": "Original",
            "baseUrl": None,
            "auth": "inherit",
            "token": None,
        },
        "cwd": ".",
        "prompt": prompt,
        "session": {"mode": "seed", "id": "s1"},
        "model": None,
        "style": None,
        "systemPrompt": "",
        "disallowed": [],
        "plugins": [],
        "maxTurns": None,
    }
