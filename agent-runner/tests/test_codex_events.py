"""Spec 44 §8 and §9.1 — Codex items become `AgentEvent`s, and tool calls become
questions.

Built from the **SDK's own generated models**, never from hand-made stand-ins.
The mapping's whole job is to be right about another package's shapes, and a
fixture invented here would keep passing after that package renamed a field —
which is the one failure this file exists to catch.
"""

from typing import Any

import pytest
from openai_codex.generated.v2_all import (
    AddPatchChangeKind,
    AgentMessageThreadItem,
    CommandExecutionThreadItem,
    FileChangeThreadItem,
    FileUpdateChange,
    McpToolCallStatus,
    McpToolCallThreadItem,
    PatchApplyStatus,
    PatchChangeKind,
    PlanThreadItem,
    ReasoningThreadItem,
    UpdatePatchChangeKind,
    WebSearchThreadItem,
)

from agent_runner.adapters.codex.events import (
    NOT_TOOL_CALLS,
    item_events,
    policy_call_of,
    shell_command,
)
from agent_runner.adapters.codex.tools import CODEX_TO_COMMON, common_tool, mcp_tool_name


def seen(item: object) -> list[Any]:
    """The events one item produces, positionally.

    `Any` on purpose, and only here. `AgentEvent` is a discriminated union, so a
    checker is right that `.text` is not a field of all of it — but a test that
    asserts "the second event is a `tool_result` whose text is X" already knows
    which member it is looking at, and narrowing it in writing twenty times
    would bury the one line each test exists for.
    """
    return list(item_events(item))


def _command(**overrides: object) -> CommandExecutionThreadItem:
    fields: dict[str, object] = {
        "id": "c1",
        "type": "commandExecution",
        "command": "echo hello",
        "command_actions": [],
        "cwd": "/work",
        "status": "completed",
        "exit_code": 0,
        "aggregated_output": "hello\n",
    }
    fields.update(overrides)
    return CommandExecutionThreadItem.model_validate(fields)


def _patch(
    diff: str,
    kind: AddPatchChangeKind | UpdatePatchChangeKind,
    path: str = "/work/doc.md",
    status: str = "completed",
) -> FileChangeThreadItem:
    return FileChangeThreadItem(
        id="f1",
        type="fileChange",
        status=PatchApplyStatus(status),
        changes=[FileUpdateChange(diff=diff, kind=PatchChangeKind(root=kind), path=path)],
    )


UPDATE = UpdatePatchChangeKind(type="update")
ADD = AddPatchChangeKind(type="add")


# ── §8 — the events ─────────────────────────────────────────────


def test_an_agent_message_is_text() -> None:
    produced = seen(AgentMessageThreadItem(id="a1", type="agentMessage", text="Two."))
    assert [(event.type, event.text) for event in produced] == [("text", "Two.")]


def test_an_empty_agent_message_produces_nothing() -> None:
    """Rule 5 — nothing is invented, and an empty row is worse than no row."""
    assert seen(AgentMessageThreadItem(id="a1", type="agentMessage", text="")) == []


def test_reasoning_is_thinking_from_whichever_list_has_it() -> None:
    """A local model measured through Envoy fills `content` and leaves `summary` empty."""
    from_summary = seen(ReasoningThreadItem(id="r1", type="reasoning", summary=["Weighing it."]))
    from_content = seen(ReasoningThreadItem(id="r2", type="reasoning", content=["Weighing it."]))
    assert [event.type for event in from_summary] == ["thinking"]
    assert from_summary[0].text == from_content[0].text == "Weighing it."


def test_a_plan_is_dropped() -> None:
    """Spec 42 §7 rule 5 — the plan is already in the message beside it."""
    assert seen(PlanThreadItem(id="p1", type="plan", text="1. do it")) == []


def test_a_command_is_a_call_and_its_output() -> None:
    call, result = seen(_command())
    assert (call.type, call.name, call.common) == ("tool_call", "command_execution", "shell")
    # §9.1 — `command` and nothing else, because that is the field REX's own
    # gate reads for a shell call.
    assert call.input == {"command": "echo hello"}
    assert (result.type, result.text, result.is_error) == ("tool_result", "hello\n", False)


@pytest.mark.parametrize("exit_code", [1, 127, None])
def test_a_command_that_did_not_exit_zero_is_an_error(exit_code: int | None) -> None:
    """None included: a sandbox refusal reports no exit code, and it is not a success."""
    _, result = seen(_command(exit_code=exit_code))
    assert result.is_error is True


def test_a_patch_is_one_call_one_wrote_and_one_diff_per_path() -> None:
    call, wrote, diff = seen(_patch("@@ -1 +1 @@\n-old line\n+new line\n", UPDATE))
    assert (call.type, call.name, call.common) == ("tool_call", "file_change", "write")
    assert call.input == {"file_path": "/work/doc.md"}
    assert (wrote.type, wrote.path) == ("wrote", "/work/doc.md")
    assert (diff.type, diff.before, diff.after) == ("diff", "old line", "new line")


def test_a_patch_naming_two_paths_produces_two_calls() -> None:
    """§9.1 — the policy judges a write by the file it names."""
    item = FileChangeThreadItem(
        id="f1",
        type="fileChange",
        status=PatchApplyStatus("completed"),
        changes=[
            FileUpdateChange(diff="@@\n+one\n", kind=PatchChangeKind(root=ADD), path="/work/a.md"),
            FileUpdateChange(diff="@@\n+two\n", kind=PatchChangeKind(root=ADD), path="/work/b.md"),
        ],
    )
    produced = seen(item)
    assert [event.type for event in produced] == ["tool_call", "wrote", "diff"] * 2
    assert [event.id for event in produced if event.type == "tool_call"] == ["f1:0", "f1:1"]


def test_a_new_file_has_no_old_text_at_all() -> None:
    """`before = None` draws no removed line; `before = ""` draws one empty one."""
    _, _, diff = seen(_patch("@@ -0,0 +1 @@\n+brand new\n", ADD))
    assert diff.before is None
    assert diff.after == "brand new"


def test_a_patch_header_is_not_read_as_content() -> None:
    """`---` and `+++` start with the same characters as the lines that matter."""
    patch = "diff --git a/doc.md b/doc.md\n--- a/doc.md\n+++ b/doc.md\n@@ -1,2 +1,2 @@\n kept\n-gone\n+here\n"
    _, _, diff = seen(_patch(patch, UPDATE))
    assert diff.before == "gone"
    assert diff.after == "here"


def test_a_refused_patch_still_reports_the_path_and_says_it_failed() -> None:
    """The path is what a before-and-after scan needs to look at either way."""
    produced = seen(_patch("@@\n+x\n", UPDATE, status="declined"))
    assert [event.type for event in produced] == ["tool_call", "wrote", "diff", "tool_result"]
    assert produced[-1].is_error is True


def test_an_mcp_call_carries_the_name_every_rex_gate_matches() -> None:
    item = McpToolCallThreadItem(
        id="m1",
        type="mcpToolCall",
        server="media-mcp",
        tool="generate_image",
        arguments={"prompt": "a duck"},
        status=McpToolCallStatus.completed,
    )
    call, _ = seen(item)
    assert call.name == "mcp__media-mcp__generate_image"
    assert call.common == "mcp"
    assert call.input == {"prompt": "a duck"}


def test_a_web_search_is_a_fetch() -> None:
    call, result = seen(WebSearchThreadItem(id="w1", type="webSearch", query="ducks"))
    assert (call.name, call.common, call.input) == ("web_search", "fetch", {"query": "ducks"})
    assert result.type == "tool_result"


# ── §9.1 — the policy question ──────────────────────────────────


def test_narration_never_reaches_the_policy() -> None:
    assert policy_call_of(AgentMessageThreadItem(id="a", type="agentMessage", text="hi")) is None
    assert policy_call_of(ReasoningThreadItem(id="r", type="reasoning")) is None
    assert policy_call_of(PlanThreadItem(id="p", type="plan", text="1.")) is None


def test_a_shell_call_reaches_the_policy_with_the_command_the_gate_reads() -> None:
    call = policy_call_of(_command(command="rm -rf /"))
    assert call is not None, "a shell command must always reach the policy"
    name, tool_input = call
    assert name == "command_execution"
    assert tool_input == {"command": "rm -rf /"}
    assert common_tool("commandExecution") == "shell"


def test_an_item_type_nobody_mapped_is_asked_under_its_own_name_with_no_common() -> None:
    """§9.1 — the fall-through direction is the whole difference from a decoration.

    A duck-typed stand-in on purpose: the point is an item type this code has
    never seen, which by definition cannot be built from a model it knows.
    """

    class Invented:
        type = "quantumToolCall"

    call = policy_call_of(Invented())
    assert call is not None, "an item nobody mapped must still be asked about"
    assert call[0] == "quantumToolCall"
    assert common_tool("quantumToolCall") is None, "an unmapped type must never be guessed"


def test_the_two_tables_agree_about_what_is_a_tool_call() -> None:
    """Every mapped type must be asked, and no narration type may be."""
    assert not (set(CODEX_TO_COMMON) & NOT_TOOL_CALLS)
    for item_type in CODEX_TO_COMMON:
        assert common_tool(item_type) is not None


def test_an_mcp_name_is_built_the_one_way_rex_spells_it() -> None:
    assert mcp_tool_name("srv", "tool") == "mcp__srv__tool"


# ── §9.1 — the shell wrapper, measured and unwrapped ────────────


@pytest.mark.parametrize(
    ("wrapped", "expected"),
    [
        ("/bin/zsh -lc 'cat /work/doc.md'", "cat /work/doc.md"),
        ("/bin/bash -c 'ls -la'", "ls -la"),
        ("/opt/homebrew/bin/bash -ic 'git status'", "git status"),
        ("""/bin/zsh -lc "sed -i '' 's/a/b/' /work/doc.md\"""", "sed -i '' 's/a/b/' /work/doc.md"),
        # A redirect survives, so the gate still sees the thing it refuses.
        ("/bin/zsh -lc 'echo x >> /work/doc.md'", "echo x >> /work/doc.md"),
    ],
)
def test_the_shell_codex_wraps_every_command_in_is_unwrapped(wrapped: str, expected: str) -> None:
    """The defect this closes: `cat` was refused because `/bin/zsh` was the binary."""
    assert shell_command(wrapped) == expected


@pytest.mark.parametrize(
    "left_alone",
    [
        "cat /work/doc.md",
        "/bin/zsh -lc",
        "/bin/zsh -lc 'ls' extra-arg",
        "/usr/bin/python3 -c 'print(1)'",
        "/bin/zsh -x 'ls'",
        "/bin/zsh -lc 'unbalanced",
    ],
)
def test_anything_that_is_not_that_exact_shape_is_left_whole(left_alone: str) -> None:
    """Conservative in every direction: what the gate cannot parse, it refuses."""
    assert shell_command(left_alone) == left_alone


def test_the_policy_and_the_transcript_are_asked_the_same_string() -> None:
    """A trace that differs from what the gate judged is worse than either alone."""
    item = _command(command="/bin/zsh -lc 'cat /work/doc.md'")
    call, _ = seen(item)
    asked = policy_call_of(item)
    assert asked is not None
    assert call.input == asked[1] == {"command": "cat /work/doc.md"}
