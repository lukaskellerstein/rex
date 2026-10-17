"""Spec 52 — the reviewed repository does not get to set REX's boundary.

`setting_sources=["project"]` (spec 42 §9.1) brings in the repository's own
`.claude/`, which is right for its `CLAUDE.md`, its skills and its agents. The
same switch also brings in its `sandbox` block and its permission rules, and
those decide whether a tool call runs at all. `gate.ts` decides that, so both
are answered here instead.

Measured 2026-09-10, against a repository whose settings say
`sandbox.enabled: true`:

* every `gh` call returned `deny network-outbound api.github.com:443`;
* the model's own `dangerouslyDisableSandbox` retry came back as the single
  line `Run outside of the sandbox`;
* with `permissions.ask` naming a command REX allows, the call came back as
  `Claude requested permissions to use Bash, but you haven't granted it yet.`

None of the three is a denial and none is a tool that went wrong. Each is a
question with nobody to answer it.

Spec 62 — the repository's hooks are its boundary too. Measured 2026-10-17: a
workspace `PreToolUse` hook that answered `deny` stopped an ACT edit REX's gate
had allowed. `disableAllHooks` in `--settings` turns those off, and REX's gate,
an SDK callback, still runs.
"""

import asyncio
import json
from typing import Any

import pytest
from claude_agent_sdk import PermissionResult, ToolPermissionContext

from agent_runner import ResolvedRoute
from agent_runner.adapters.claude import models
from agent_runner.adapters.claude.adapter import ClaudeAdapter
from agent_runner.events import Denial
from agent_runner.policy import ToolCall
from agent_runner.types import NewSession, RunRequest

ADAPTER = ClaudeAdapter()

REQUEST = RunRequest(
    run_id="a-run",
    route=ResolvedRoute(sdk="claude-agent", gateway_name="Original", auth="inherit"),
    cwd="/tmp/a-document-repository",
    prompt="Is this section right?",
    session=NewSession(),
)


def options(request: RunRequest = REQUEST) -> Any:
    return ADAPTER._options(request, lambda event: None, _allow_everything, [])  # noqa: SLF001


async def _allow_everything(call: ToolCall) -> str | None:
    _ = call
    return None


def test_rex_pins_the_sandbox_off_whatever_the_repository_says() -> None:
    """`--settings` outranks project settings, so this is the one that lands."""
    assert options().sandbox == {"enabled": False}


def test_the_style_and_the_sandbox_both_survive() -> None:
    """Two separate options, merged into one `--settings` by the SDK.

    The style used to be the only reason REX passed `settings` at all, so a
    sandbox that quietly replaced it would take the reviewer's chosen style
    with it.
    """
    chosen = REQUEST.model_copy(update={"style": "Explanatory"})
    assert options(chosen).settings is not None
    assert options(chosen).sandbox == {"enabled": False}


def test_a_permission_prompt_is_answerable() -> None:
    """Without this the CLI's prompt has no reader, and the call just fails."""
    assert options().can_use_tool is not None


def test_the_prompt_answers_with_the_policy_and_records_a_refusal() -> None:
    denials: list[Denial] = []
    emitted: list[Any] = []

    async def refuse(call: ToolCall) -> str | None:
        return None if call.name == "Read" else "a read session cannot run that"

    prompt = ADAPTER._options(  # noqa: SLF001
        REQUEST, emitted.append, refuse, denials
    ).can_use_tool
    assert prompt is not None

    async def answer(name: str, tool_input: dict[str, Any]) -> PermissionResult:
        return await prompt(name, tool_input, ToolPermissionContext(tool_use_id="a-call"))

    assert asyncio.run(answer("Read", {"file_path": "/tmp/a.md"})).behavior == "allow"

    refused = asyncio.run(answer("Bash", {"command": "rm -rf /"}))
    assert refused.behavior == "deny"
    assert [denial.tool_name for denial in denials] == ["Bash"]
    assert [event.type for event in emitted] == ["denied"]


def test_a_subagent_prompt_says_which_subagent_it_was() -> None:
    """§8's rule about attribution, on the path that did not have it."""
    denials: list[Denial] = []

    async def refuse(call: ToolCall) -> str | None:
        _ = call
        return "not in a read session"

    prompt = ADAPTER._options(REQUEST, lambda event: None, refuse, denials).can_use_tool  # noqa: SLF001
    assert prompt is not None

    async def answer() -> PermissionResult:
        return await prompt(
            "Bash",
            {"command": "touch x"},
            ToolPermissionContext(tool_use_id="a-call", agent_id="explorer"),
        )

    assert asyncio.run(answer()).behavior == "deny"
    assert [denial.subagent_id for denial in denials] == ["explorer"]


@pytest.mark.parametrize("profile_tools", [[], ["write", "edit"]])
def test_the_pin_does_not_depend_on_the_profile(profile_tools: list[Any]) -> None:
    """ASK and ACT both lose the network otherwise, and ACT loses shell writes."""
    request = REQUEST.model_copy(update={"disallowed": profile_tools})
    assert options(request).sandbox == {"enabled": False}


def settings_of(request: RunRequest = REQUEST) -> dict[str, Any]:
    return json.loads(options(request).settings)


@pytest.mark.parametrize("profile_tools", [[], ["write", "edit"]])
def test_the_repositorys_hooks_are_off_in_both_profiles(profile_tools: list[Any]) -> None:
    """Spec 62 — an ASK ran the repository's `SessionStart` scripts too."""
    request = REQUEST.model_copy(update={"disallowed": profile_tools})
    assert settings_of(request) == {"disableAllHooks": True}


def test_a_chosen_style_rides_beside_the_hooks_switch() -> None:
    chosen = REQUEST.model_copy(update={"style": "Explanatory"})
    assert settings_of(chosen) == {"disableAllHooks": True, "outputStyle": "Explanatory"}


def test_the_default_style_is_said_by_saying_nothing() -> None:
    chosen = REQUEST.model_copy(update={"style": "default"})
    assert "outputStyle" not in settings_of(chosen)


def test_the_gate_is_still_registered_beside_the_switch() -> None:
    """The switch turns settings hooks off; the gate is an SDK callback."""
    assert options().hooks is not None
    assert "PreToolUse" in options().hooks


def test_the_probe_loads_what_a_run_loads(monkeypatch: pytest.MonkeyPatch) -> None:
    """Its handshake starts a session, and a session runs `SessionStart`."""
    seen: list[Any] = []

    class Refusing:
        def __init__(self, options: Any) -> None:
            seen.append(options)

        async def connect(self) -> None:
            raise RuntimeError("not started in a test")

        async def disconnect(self) -> None:
            return None

    monkeypatch.setattr(models, "ClaudeSDKClient", Refusing)
    asyncio.run(models.probe("/tmp/a-document-repository", {}))
    assert json.loads(seen[0].settings) == {"disableAllHooks": True}
