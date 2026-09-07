"""Spec 42 §8.1 and §13 criteria 6 and 9 — the tool mapping, both ways.

The rule this file exists for is one sentence: **an unknown tool name maps to
`None` and is never guessed.** Everything else here follows from it.

`None` is not a verdict. It says the library does not know what the tool does,
and what a host makes of that is the host's decision — REX allows it for Claude
because that is exactly what its gate did before this spec, and denies it for
every later SDK because those bring a closed mapping. The fall-through direction
is the whole difference between a gate and a decoration, and the library must
not pick one on the host's behalf.
"""

import pytest

from agent_runner.adapters.claude.tools import (
    CLAUDE_TO_COMMON,
    COMMON_TO_CLAUDE,
    claude_tools_for,
    common_tool,
)
from agent_runner.adapters.codex.tools import CODEX_TO_COMMON
from agent_runner.adapters.codex.tools import common_tool as codex_common
from agent_runner.policy import CommonTool, ToolCall


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Read", "read"),
        ("LS", "list"),
        ("Glob", "list"),
        ("Grep", "search"),
        ("WebFetch", "fetch"),
        ("WebSearch", "fetch"),
        ("Write", "write"),
        ("NotebookEdit", "write"),
        ("Edit", "edit"),
        ("Bash", "shell"),
        ("Task", "task"),
        ("Agent", "task"),
    ],
)
def test_every_name_in_the_table_maps(name: str, expected: CommonTool) -> None:
    assert common_tool(name) == expected


def test_any_mcp_tool_maps_by_its_prefix() -> None:
    """A server's tool names are the server's, so only the prefix can be known."""
    assert common_tool("mcp__media-mcp__generate_image") == "mcp"
    assert common_tool("mcp__anything__at__all") == "mcp"


@pytest.mark.parametrize(
    "name",
    ["TodoWrite", "Skill", "AskUserQuestion", "SlashCommand", "KillShell", "SomethingNewIn2027"],
)
def test_an_unmapped_name_stays_none_and_is_never_guessed(name: str) -> None:
    assert common_tool(name) is None
    # And it survives the trip to a host with both names on it, so the host can
    # show the real one and decide on the mapped one.
    call = ToolCall(name=name, common=common_tool(name), input={})
    assert call.name == name
    assert call.common is None


def test_a_near_miss_is_not_a_hit() -> None:
    """`mcp_` is not `mcp__`, and `read` is not `Read`."""
    assert common_tool("mcp_media__go") is None
    assert common_tool("read") is None
    assert common_tool("bash") is None


# ── the table backwards (§6, §13 criterion 9) ───────────────────


def test_the_read_profile_produces_exactly_todays_list() -> None:
    """Criterion 9, verbatim: nothing the model sees changes."""
    assert claude_tools_for(["write", "edit"]) == ["Write", "NotebookEdit", "Edit"]


def test_the_write_profile_disallows_nothing() -> None:
    assert claude_tools_for([]) == []


def test_names_are_not_repeated() -> None:
    assert claude_tools_for(["write", "write", "edit", "edit"]) == [
        "Write",
        "NotebookEdit",
        "Edit",
    ]


def test_mcp_has_no_reverse_because_it_cannot() -> None:
    """A server's tool names are not a finite list, so there is nothing to name."""
    assert "mcp" not in COMMON_TO_CLAUDE
    assert claude_tools_for(["mcp"]) == []


def test_the_two_directions_agree() -> None:
    """Every reverse entry maps forward to the common tool it came from."""
    for common, names in COMMON_TO_CLAUDE.items():
        for name in names:
            assert CLAUDE_TO_COMMON[name] == common


# ── Spec 44 §9.1 — the same rule, for the second SDK ────────────


def test_every_sdk_lands_in_the_one_vocabulary_the_host_decides_on() -> None:
    """Two SDKs, two tables, one set of words a policy is written in.

    The point is not that the tables agree — they describe different products —
    but that neither invents a value outside `CommonTool`. A host's gate is
    written once, in these nine words, and an adapter that returned a tenth
    would be a decision the host has no branch for.
    """
    allowed = set(CommonTool.__args__)
    assert set(CLAUDE_TO_COMMON.values()) <= allowed
    assert set(CODEX_TO_COMMON.values()) <= allowed


def test_the_two_sdks_agree_about_what_a_shell_and_a_write_are() -> None:
    """The gate reasons about acts, so the same act must arrive under one word."""
    assert codex_common("commandExecution") == CLAUDE_TO_COMMON["Bash"] == "shell"
    assert codex_common("fileChange") == CLAUDE_TO_COMMON["Write"] == "write"


def test_neither_sdk_guesses_a_name_it_does_not_know() -> None:
    assert common_tool("SomeToolNobodyMapped") is None
    assert codex_common("someItemNobodyMapped") is None
