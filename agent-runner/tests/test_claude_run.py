"""A turn the SDK calls a success can still be the API refusing it.

Measured 2026-10-17. An ASK made 22 model calls, then the account ran out of
credit. The CLI reported that as a synthetic assistant message reading "Credit
balance is too low", marked `billing_error`, and ended the turn with
`result: success`. REX stored the sentence as the answer and drew `completed`
under it, so the card read like a normal reply.

The run loop is driven here by a fake client replaying that stream, so there is
no CLI, no network and no key.
"""

import asyncio
from typing import Any

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from agent_runner import ResolvedRoute
from agent_runner.adapters.claude import adapter as claude
from agent_runner.events import AgentEvent, ErrorEvent, Text
from agent_runner.policy import ToolCall
from agent_runner.types import NewSession, RunRequest

REQUEST = RunRequest(
    run_id="a-run",
    route=ResolvedRoute(sdk="claude-agent", gateway_name="Original", auth="inherit"),
    cwd="/tmp/a-document-repository",
    prompt="Redraw this diagram.",
    session=NewSession(),
)

RESULT = ResultMessage(
    subtype="success",
    duration_ms=73_587,
    duration_api_ms=70_000,
    is_error=False,
    num_turns=23,
    session_id="a-session",
    total_cost_usd=1.1881,
)


def stream_of(*messages: Any) -> type:
    """A `ClaudeSDKClient` stand-in that replays `messages` and nothing else."""

    class Replay:
        def __init__(self, options: Any) -> None:
            _ = options

        async def connect(self, prompt: str | None = None) -> None:
            _ = prompt

        async def receive_response(self) -> Any:
            for message in messages:
                yield message

        async def interrupt(self) -> None:
            pass

        async def disconnect(self) -> None:
            pass

    return Replay


async def _allow_everything(call: ToolCall) -> str | None:
    _ = call
    return None


async def run(monkeypatch: pytest.MonkeyPatch, *messages: Any) -> tuple[list[AgentEvent], Any]:
    monkeypatch.setattr(claude, "ClaudeSDKClient", stream_of(*messages))
    events: list[AgentEvent] = []
    result = await claude.ClaudeAdapter().run(REQUEST, events.append, _allow_everything, asyncio.Event())
    return events, result


async def test_a_refusal_the_sdk_called_a_success_ends_the_run_as_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refused = AssistantMessage(
        content=[TextBlock(text="Credit balance is too low")],
        model="<synthetic>",
        error="billing_error",
    )
    events, result = await run(monkeypatch, refused, RESULT)

    assert not [event for event in events if isinstance(event, Text)], "the refusal is not an answer"
    errors = [event.text for event in events if isinstance(event, ErrorEvent)]
    assert len(errors) == 1
    assert "Credit balance is too low" in errors[0]
    assert result.error == errors[0]
    # What the 22 calls before it spent is still reported.
    assert result.cost_usd == pytest.approx(1.1881)


async def test_the_same_words_without_the_mark_are_an_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    said = AssistantMessage(content=[TextBlock(text="Credit balance is too low")], model="claude-opus-5")
    events, result = await run(monkeypatch, said, RESULT)

    assert Text(text="Credit balance is too low") in events
    assert not [event for event in events if isinstance(event, ErrorEvent)]
    assert result.error is None
