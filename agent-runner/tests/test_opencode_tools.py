"""Spec 47 §7.1 — the mapping, and the two vocabularies it keeps apart.

Pure functions, no server. What is asserted here is the thing that fails
silently: REX's gate returns **allow** for a name it does not know (spec 42 §8),
so a mapping with a hole in it is a read session running shell commands.
"""

from agent_runner.adapters.opencode.tools import (
    OPENCODE_TO_COMMON,
    OPENCODE_TOOL_IDS,
    READ_ONLY_PERMISSIONS,
    common_tool,
    permission_for,
    policy_input,
    read_ruleset,
    write_ruleset,
)


def test_every_tool_the_server_ships_is_accounted_for() -> None:
    """Each of the fourteen either maps or is deliberately `None`.

    The list is `GET /experimental/tool/ids` at 1.18.27 (§10.6 E). A name that
    is neither mapped nor knowingly unmapped is one nobody has looked at.
    """
    unmapped = [name for name in OPENCODE_TOOL_IDS if common_tool(name) is None]
    assert sorted(unmapped) == ["invalid", "question", "skill", "todowrite"]


def test_the_mapping_is_closed_and_an_unknown_name_is_none() -> None:
    """§7.1 — never guessed, in either direction.

    `None` is what makes REX's policy refuse an OpenCode tool by name, so a tool
    a future `opencode` ships is a visible refusal rather than a silent allow.
    """
    assert common_tool("bash") == "shell"
    assert common_tool("write") == "write"
    assert common_tool("edit") == "edit"
    assert common_tool("apply_patch") == "edit"
    assert common_tool("read") == "read"
    assert common_tool("glob") == "list"
    assert common_tool("grep") == "search"
    assert common_tool("webfetch") == "fetch"
    assert common_tool("task") == "task"
    assert common_tool("a_tool_opencode_has_not_shipped_yet") is None
    assert common_tool("") is None
    # Claude's spelling must not resolve here. The gate reasons in Claude's
    # names and the adapter in OpenCode's; one table answering both would hide
    # the day the two stopped agreeing.
    assert common_tool("Bash") is None
    assert common_tool("Write") is None


def test_the_spec_named_two_tools_that_do_not_exist() -> None:
    """§10.6 E — `list` and `patch` were in §7.1's table and in no server."""
    assert "list" not in OPENCODE_TOOL_IDS
    assert "patch" not in OPENCODE_TOOL_IDS
    assert "apply_patch" in OPENCODE_TOOL_IDS
    assert "list" not in OPENCODE_TO_COMMON
    assert "patch" not in OPENCODE_TO_COMMON


def test_write_asks_under_edit_and_everything_else_under_its_own_name() -> None:
    """The one row that makes a ruleset correct or useless (§10.6 E).

    A ruleset denying `write` and not `edit` stops nothing, because a `write`
    tool call never asks under the name `write`.
    """
    assert permission_for("write") == "edit"
    for name in ("bash", "read", "glob", "grep", "edit", "webfetch", "task", "todowrite"):
        assert permission_for(name) == name
    # An unmapped tool asks under its own name, which is what lets the `*` rule
    # catch it and the policy refuse it by name.
    assert permission_for("something_new") == "something_new"


def test_the_read_ruleset_allows_reading_and_asks_about_everything_else() -> None:
    """§7.3 — an open `ask`, not a closed deny-list.

    A deny-list cannot name a tool that does not exist yet; `*` cannot miss one.
    Order matters, because OpenCode applies the rules in order.
    """
    rules = read_ruleset()
    allowed = [rule["permission"] for rule in rules if rule["action"] == "allow"]
    assert allowed == list(READ_ONLY_PERMISSIONS)
    assert rules[-1] == {"permission": "*", "pattern": "*", "action": "ask"}
    assert not [rule for rule in rules if rule["action"] == "deny"], (
        "§10.6 D — `deny` tells the model nothing and it retries; `ask` carries REX's sentence"
    )
    # The three that would let a read session write, and none of them is allowed.
    for permission in ("edit", "bash", "external_directory"):
        assert permission not in allowed


def test_the_write_ruleset_allows_leaving_the_project_directory() -> None:
    """§7.4.1 option B, and the one rule that looks wrong until you measure it.

    An ACT runs in the workspace while the spec 22 working copies live under
    `~/.rex/work` — outside it — so **every edit an ACT is supposed to make is an
    "external directory" write** by OpenCode's reckoning. With this permission
    asking or denied, the write is refused before the tool call reaches a file
    and it looks exactly like the model failing to call the tool (§10.10).

    What stops the agent going anywhere else is layer 4, the seatbelt, which
    allows precisely `RunRequest.writable`. That is why ACT is refused outright
    on a platform with no seatbelt.
    """
    rules = write_ruleset()
    allowed = {rule["permission"] for rule in rules if rule["action"] == "allow"}
    assert "external_directory" in allowed
    # Everything else still asks, and the catch-all is still last.
    assert rules[-1] == {"permission": "*", "pattern": "*", "action": "ask"}
    assert "edit" not in allowed and "bash" not in allowed


def test_only_the_write_ruleset_may_leave_the_project_directory() -> None:
    """A read run has no business outside its mirror, and does not get out."""
    allowed = {rule["permission"] for rule in read_ruleset() if rule["action"] == "allow"}
    assert "external_directory" not in allowed


def test_neither_ruleset_ever_allows_a_wildcard() -> None:
    """The default OpenCode agent carries `{"*": "allow"}` and writes files (§10.6 D).

    That is the shape this ruleset exists to replace, so it is worth asserting
    that neither of REX's can ever be it.
    """
    for rules in (read_ruleset(), write_ruleset()):
        assert not [rule for rule in rules if rule["permission"] == "*" and rule["action"] == "allow"]


def test_the_gate_reads_file_path_and_opencode_writes_filePath() -> None:
    """`gate.ts` is written in Claude's vocabulary, so the key is renamed here."""
    assert policy_input({"filePath": "a.md", "content": "x"}) == {
        "file_path": "a.md",
        "content": "x",
    }
    # `command` is already what the gate reads, and is passed through untouched —
    # spec 12 §6's whole shell analysis is written against that key.
    assert policy_input({"command": "rm -rf /"}) == {"command": "rm -rf /"}
    # A pending part carries `{}`, and an unknown tool may carry anything.
    assert policy_input({}) == {}
    assert policy_input(None) is None
    assert policy_input("not a mapping") == "not a mapping"
