"""Spec 58 §3.1 — the effort reaches the SDK as a level, and `default` as nothing.

`default` is what the reviewer picked when they want the model's own level, so
it is recorded — and never sent, because sending the word would be REX
asserting a level it does not mean. The model has had this rule since spec 25.
"""

from typing import Any

from agent_runner import ResolvedRoute
from agent_runner.adapters.claude.adapter import ClaudeAdapter
from agent_runner.policy import ToolCall
from agent_runner.types import NewSession, RunRequest


async def _allow_everything(call: ToolCall) -> str | None:
    _ = call
    return None


def options(effort: str | None) -> Any:
    request = RunRequest(
        run_id="a-run",
        route=ResolvedRoute(sdk="claude-agent", gateway_name="Original", auth="inherit"),
        cwd="/tmp/a-document-repository",
        prompt="Is this section right?",
        session=NewSession(),
        effort=effort,
    )
    return ClaudeAdapter()._options(request, lambda event: None, _allow_everything, [])  # noqa: SLF001


def test_a_level_is_passed_as_it_came() -> None:
    assert options("medium").effort == "medium"
    assert options("max").effort == "max"


def test_default_and_nothing_both_say_nothing() -> None:
    assert options("default").effort is None
    assert options(None).effort is None
