"""Spec 42 §4.2 and §4.3 — every message round-trips, and the contract is stable.

Two different guarantees:

* **Round trip.** A message serialised and parsed back is the same message, and
  it goes over the wire in camelCase. That is what makes `runId` on one side and
  `run_id` on the other a fact rather than a hope.
* **No drift.** The three committed artefacts are what the models produce today.
  `test/protocol.spec.ts` asserts the same thing from the TypeScript side; this
  one fails first, and in the language the models are written in.
"""

import json
from pathlib import Path

from pydantic import TypeAdapter

from agent_gateway import ORIGINAL_GATEWAY, resolve_route
from agent_gateway.base import Model
from agent_gateway.codegen import catalogue_json, json_schema, typescript
from agent_gateway.events import (
    Completed,
    Denial,
    Diff,
    ErrorEvent,
    RunResult,
    Started,
    StoppedEvent,
    Text,
    ToolCallEvent,
    ToolResultEvent,
    Wrote,
)
from agent_gateway.policy import ToolCall
from agent_gateway.protocol import (
    PROTOCOL_VERSION,
    CapabilitiesMessage,
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
    ServiceMessage,
    SessionExistsMessage,
    ShutdownMessage,
    StopMessage,
)
from agent_gateway.types import NewSession, ResumeSession, SeedSession, SessionState

ROOT = Path(__file__).resolve().parent.parent

_HOST = TypeAdapter(HostMessage)
_SERVICE = TypeAdapter(ServiceMessage)

ROUTE = resolve_route(ORIGINAL_GATEWAY, "claude-agent", {})


def host_messages() -> list[Model]:
    return [
        DescribeMessage(id="a"),
        CapabilitiesMessage(id="b", route=ROUTE, cwd="/tmp"),
        SessionExistsMessage(id="c", route=ROUTE, cwd="/tmp", session_id="s"),
        RunMessage(
            run_id="r1",
            route=ROUTE,
            cwd="/tmp",
            prompt="hello",
            session=SeedSession(id="s"),
            model=None,
            style=None,
            system_prompt="be brief",
            disallowed=["write", "edit"],
            plugins=["/opt/plugin"],
            max_turns=30,
        ),
        StopMessage(run_id="r1"),
        PolicyReplyMessage(id="p1", reason=None),
        PolicyReplyMessage(id="p2", reason="no"),
        ShutdownMessage(),
    ]


def service_messages() -> list[Model]:
    return [
        ReadyMessage(version="1", python="3.12", library="0.1.0", sdks={"claude-agent-sdk": "0.2"}),
        ReplyMessage(id="a", ok=True, value=DescribeValue(describe=DescribeResult(sdks=[], kinds=[]))),
        ReplyMessage(id="c", ok=True, value=ExistsValue(session=SessionState(exists=True))),
        ReplyMessage(id="d", ok=False, error="nope"),
        EventMessage(run_id="r1", event=Started(session_id="s", model="m", style="y", tools=3)),
        EventMessage(run_id="r1", event=Text(text="hi")),
        EventMessage(run_id="r1", event=ToolCallEvent(id="t1", name="Bash", common="shell", input={"command": "ls"})),
        EventMessage(run_id="r1", event=ToolResultEvent(id="t1", name="Bash", text="out", is_error=False)),
        EventMessage(run_id="r1", event=Diff(path="/a.md", before="old", after="new")),
        EventMessage(run_id="r1", event=Wrote(path="/a.md")),
        EventMessage(run_id="r1", event=ErrorEvent(text="boom", cost_usd=0.5, duration_ms=12)),
        EventMessage(run_id="r1", event=StoppedEvent()),
        EventMessage(run_id="r1", event=Completed(cost_usd=None, duration_ms=9)),
        ResultMessage(run_id="r1", result=RunResult(session_id="s", denials=[Denial(tool_name="Bash", reason="no")])),
        PolicyMessage(id="p1", run_id="r1", call=ToolCall(name="Bash", common="shell", input={})),
        LogMessage(level="warn", text="careful"),
    ]


def test_every_host_message_round_trips() -> None:
    for message in host_messages():
        line = message.model_dump_json(by_alias=True)
        assert _HOST.validate_json(line) == message, line


def test_every_service_message_round_trips() -> None:
    for message in service_messages():
        line = message.model_dump_json(by_alias=True)
        assert _SERVICE.validate_json(line) == message, line


def test_the_wire_is_camel_case() -> None:
    """`run_id` in Python is `runId` on the pipe, with no hand-written mapping."""
    line = json.loads(StopMessage(run_id="r1").model_dump_json(by_alias=True))
    assert line == {"type": "stop", "runId": "r1"}

    started = json.loads(EventMessage(run_id="r", event=Started(session_id="s")).model_dump_json(by_alias=True))
    assert started["event"]["sessionId"] == "s"
    assert "session_id" not in started["event"]


def test_a_message_never_contains_a_raw_newline() -> None:
    """One JSON object per line only works if a message is one line."""
    for message in [*host_messages(), *service_messages()]:
        assert "\n" not in message.model_dump_json(by_alias=True)


def test_the_three_session_shapes_are_told_apart() -> None:
    """§5.5 — a nullable id cannot say which of three things the caller meant."""
    for session in (SeedSession(id="s"), ResumeSession(id="s"), NewSession()):
        message = RunMessage(run_id="r", route=ROUTE, cwd="/tmp", prompt="p", session=session)
        parsed = _HOST.validate_json(message.model_dump_json(by_alias=True))
        assert parsed.session == session
        assert type(parsed.session) is type(session)


def test_an_unknown_message_type_is_refused_rather_than_guessed() -> None:
    from pydantic import ValidationError

    try:
        _HOST.validate_json('{"type": "explode", "id": "x"}')
    except ValidationError:
        return
    raise AssertionError("an unknown type must not parse")


# ── §4.3 — the committed artefacts ──────────────────────────────


def test_the_generated_typescript_is_what_is_committed() -> None:
    committed = (ROOT.parent / "src" / "shared" / "agent-protocol.ts").read_text()
    assert committed == typescript(), (
        "src/shared/agent-protocol.ts is stale. Regenerate it:\n"
        "  uv run python -m agent_gateway.protocol --typescript > ../src/shared/agent-protocol.ts"
    )


def test_the_committed_schema_is_what_is_generated() -> None:
    assert (ROOT / "schema.json").read_text() == json_schema()


def test_the_committed_catalogue_is_what_is_generated() -> None:
    assert (ROOT / "catalogue.json").read_text() == catalogue_json()


def test_the_protocol_version_is_carried_where_a_host_can_read_it() -> None:
    ready = ReadyMessage(version=PROTOCOL_VERSION, python="3.12", library="0.1.0", sdks={})
    assert json.loads(ready.model_dump_json(by_alias=True))["version"] == PROTOCOL_VERSION
