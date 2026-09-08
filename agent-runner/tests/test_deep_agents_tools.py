"""Spec 48 §5.3 — the tool mapping, which is the hole the gate cannot see.

Pure, so it is tested pure. Spec 42 §8's trap is that REX's gate allows any name
it does not know, and every `deepagents` tool is a name it does not know — so a
row missing from this table is a tool that runs unjudged, and that failure is
invisible in a working run.
"""

from agent_runner.adapters.deep_agents.tools import (
    DEEP_AGENTS_TO_COMMON,
    NEVER_OFFERED,
    WRITING_TOOLS,
    common_tool,
    path_of,
    policy_input,
    written_text,
)
from agent_runner.policy import CommonTool

#: What a default `create_deep_agent` binds at `deepagents` 0.7.13, measured on
#: 2026-09-07 by recording `bind_tools`. `execute` is deliberately absent: it
#: exists only on a sandbox backend and §5 uses none.
MEASURED_TOOLS = ("ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "task")


def test_every_tool_the_sdk_actually_binds_is_mapped() -> None:
    """The one assertion that catches a `deepagents` upgrade adding a tool.

    An unmapped name is denied by the host rather than allowed, so this failing
    is a refusal a reviewer would see — but a refusal for a tool REX ought to
    understand is still REX being wrong, and it is cheaper to learn here.
    """
    for tool in MEASURED_TOOLS:
        assert common_tool(tool) is not None, f"'{tool}' is bound by the SDK and maps to nothing"


def test_the_mapping_is_closed() -> None:
    """A name the table does not carry is None, never guessed (§5.3)."""
    assert common_tool("write_todos") is None
    assert common_tool("Write") is None
    assert common_tool("") is None


def test_a_delete_is_a_write() -> None:
    """The SDK's own rule vocabulary agrees: `"write"` covers all three."""
    assert common_tool("delete") == "write"
    assert WRITING_TOOLS == frozenset({"write_file", "edit_file", "delete"})


def test_the_common_names_are_all_in_the_vocabulary() -> None:
    allowed = set(CommonTool.__args__)  # type: ignore[attr-defined]
    assert set(DEEP_AGENTS_TO_COMMON.values()) <= allowed


def test_task_is_never_offered() -> None:
    """§14 — subagents are out of scope, and the host's gate has no rule for them."""
    assert NEVER_OFFERED == frozenset({"task"})
    assert common_tool("task") == "task", "it is still MAPPED, so the refusal names it"


def test_the_path_comes_from_the_key_each_tool_uses() -> None:
    """Measured argument names: file tools say `file_path`, `ls`/`grep` say `path`."""
    assert path_of("read_file", {"file_path": "/a.md"}) == "/a.md"
    assert path_of("write_file", {"file_path": "/a.md", "content": "x"}) == "/a.md"
    assert path_of("ls", {"path": "/dir"}) == "/dir"
    assert path_of("grep", {"pattern": "x", "path": "/dir"}) == "/dir"
    assert path_of("glob", {"pattern": "**/*.md"}) is None
    assert path_of("read_file", "not a mapping") is None
    assert path_of("read_file", {"file_path": ""}) is None


def test_the_gate_reads_file_path_whatever_the_tool_calls_it() -> None:
    """`gate.ts` is written in Claude's vocabulary, so `path` is renamed once."""
    assert policy_input("ls", {"path": "/dir"}) == {"file_path": "/dir"}
    assert policy_input("grep", {"pattern": "x", "path": "/d"}) == {"pattern": "x", "file_path": "/d"}
    # Everything else is already spelled the way the gate reads it.
    assert policy_input("write_file", {"file_path": "/a", "content": "b"}) == {
        "file_path": "/a",
        "content": "b",
    }
    assert policy_input("glob", {"pattern": "*"}) == {"pattern": "*"}
    assert policy_input("read_file", None) is None


def test_only_a_write_file_carries_a_whole_document() -> None:
    """An `edit_file` carries a fragment, and `Diff.after` is a whole file."""
    assert written_text("write_file", {"content": "hello"}) == "hello"
    assert written_text("edit_file", {"old_string": "a", "new_string": "b"}) is None
    assert written_text("write_file", {"file_path": "/a"}) is None
