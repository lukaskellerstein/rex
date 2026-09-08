"""Spec 48 §5.1 and §8.2 — the write boundary, against real directories.

This is the file that matters most in the adapter. The boundary is not an
operating-system sandbox, so nothing outside these assertions is enforcing it,
and the one escape it closes was found by measurement rather than by reading:
**the SDK's own path matcher is textual, and a symlink inside a writable
directory pointed at the reviewer's repository and the write went through**
(2026-09-07). `refusal()` is what catches it, and `test_a_symlink_out_of_a_
writable_root_is_refused` is what proves it still does.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from agent_runner.adapters.deep_agents.backend import READ_ONLY, Boundary, for_act, for_ask


def test_ask_denies_every_write_at_the_rule_layer(tmp_path: Path) -> None:
    """§5.1 layer 2 — the SDK's own read-only rule, still first and still absolute."""
    _, permissions, _ = for_ask(str(tmp_path))
    assert permissions[0] == READ_ONLY[0]
    assert permissions[0].operations == ["write"]
    assert permissions[0].paths == ["/**"]
    assert permissions[0].mode == "deny"


def test_ask_speaks_real_paths(tmp_path: Path) -> None:
    """Spec 50 §3.3 — no virtual root, because the prompt names absolute paths.

    A virtual backend re-roots an absolute path inside itself, so the working
    copy the ASK prompt names — outside `cwd` — became a path that does not
    exist and the read failed with "not found" (spec 50 §3.1).
    """
    backend, _, _ = for_ask(str(tmp_path))
    assert backend.virtual_mode is False


def test_ask_reads_the_workspace_and_the_named_copies_and_nothing_else(tmp_path: Path) -> None:
    """Spec 50 §3.3 — `readable` is what makes the document reachable at all."""
    copy = tmp_path / "work" / "doc-1"
    copy.mkdir(parents=True)
    workspace = tmp_path / "repo"
    workspace.mkdir()

    _, permissions, _ = for_ask(str(workspace), [str(copy)])
    reads = [rule for rule in permissions if rule.operations == ["read"]]
    assert [rule.mode for rule in reads] == ["allow", "deny"], "allow first, or the deny wins"
    assert reads[0].paths == [
        str(workspace),
        f"{workspace}/**",
        str(copy),
        f"{copy}/**",
    ]
    assert reads[1].paths == ["/**"]


def test_ask_with_nothing_readable_still_scopes_reads_to_the_workspace(tmp_path: Path) -> None:
    """An empty `readable` means "nothing beyond `cwd`" — never "anywhere"."""
    _, permissions, _ = for_ask(str(tmp_path))
    reads = [rule for rule in permissions if rule.operations == ["read"]]
    assert reads[0].paths == [str(tmp_path), f"{tmp_path}/**"]
    assert reads[1].paths == ["/**"]
    assert reads[1].mode == "deny"


def test_ask_refuses_a_writing_tool_by_name(tmp_path: Path) -> None:
    """§8.1 — layer 3, and the one that produces the sentence the model reads.

    It refuses by NAME rather than by path, because under `virtual_mode=True`
    the path is not a host path: `/x.txt` means `<cwd>/x.txt`, and resolving it
    as though it were real would compare two different things.
    """
    _, _, refusal = for_ask(str(tmp_path))
    for tool in ("write_file", "edit_file", "delete"):
        reason = refusal(tool, {"file_path": "/anything.md"})
        assert reason is not None
        assert tool in reason
    assert refusal("read_file", {"file_path": "/anything.md"}) is None
    assert refusal("grep", {"pattern": "x"}) is None


# ── ACT ─────────────────────────────────────────────────────────


def _act(tmp_path: Path) -> tuple[Path, Path, Path, Boundary]:
    """A repository, two working copies and a sibling that is not writable."""
    repo = tmp_path / "repo"
    work = tmp_path / "work"
    copy_a = work / "docA"
    copy_b = work / "docB"
    other = work / "docC"
    for directory in (repo, copy_a, copy_b, other):
        directory.mkdir(parents=True)
    (repo / "original.md").write_text("the reviewer's own file\n")
    (other / "secret.md").write_text("not this run's\n")
    _, _, refusal = for_act(str(repo), [str(copy_a), str(copy_b)])
    return repo, copy_a, other, refusal


def test_act_speaks_real_paths(tmp_path: Path) -> None:
    """§8.2 — REX's write prompt names the copies absolutely, so the backend must too."""
    backend, _, _ = for_act(str(tmp_path / "repo"), [str(tmp_path / "work")])
    assert backend.virtual_mode is False


def test_act_allows_the_working_copies_and_denies_the_rest(tmp_path: Path) -> None:
    repo, copy_a, other, refusal = _act(tmp_path)
    assert refusal("write_file", {"file_path": str(copy_a / "report.md")}) is None
    assert refusal("write_file", {"file_path": str(copy_a / "deep" / "new.md")}) is None
    for outside in (repo / "original.md", other / "secret.md", tmp_path / "loose.md"):
        reason = refusal("write_file", {"file_path": str(outside)})
        assert reason is not None, f"{outside} must not be writable"
        assert "working copies" in reason


def test_act_leaves_reads_alone(tmp_path: Path) -> None:
    """The repository is READ-only, not invisible: the agent edits a copy of it."""
    repo, _, _, refusal = _act(tmp_path)
    assert refusal("read_file", {"file_path": str(repo / "original.md")}) is None
    assert refusal("ls", {"path": str(repo)}) is None


def test_a_symlink_out_of_a_writable_root_is_refused(tmp_path: Path) -> None:
    """**The escape the SDK's own rules do not catch.**

    Measured 2026-09-07: `permissions` matched `<writable>/**` textually and the
    write reached the real file through the link. Nothing in this adapter can
    create a link — there is no shell and no tool that makes one — but a
    boundary that depends on nobody ever putting one there is a promise rather
    than a boundary.

    **This is the macOS and Linux half of §8.2's platform question.** Windows has
    a second shape with the same effect — a **junction**, which `os.symlink` does
    not create and which needs `mklink /J` — and Linux has a third, a **bind
    mount**. Neither is reachable from here, so both are on the VM checklists
    rather than in this file. What this test does prove on every platform it can
    run on is that `Path.resolve()` is what the boundary rests on.
    """
    repo, copy_a, _, refusal = _act(tmp_path)
    try:
        os.symlink(repo, copy_a / "escape")
    except OSError as denied:
        # Windows needs Developer Mode or elevation to make a symlink. A suite
        # that ERRORS there would hide every other assertion in this file, and a
        # boundary test nobody can run is worse than one that says why.
        pytest.skip(f"this platform will not create a symlink here: {denied}")
    reason = refusal("write_file", {"file_path": str(copy_a / "escape" / "original.md")})
    assert reason is not None
    assert "working copies" in reason


def test_the_root_itself_and_its_parent_are_not_writable(tmp_path: Path) -> None:
    """`~/.rex/work` holds every document's copies; only this run's are its own."""
    _, copy_a, _, refusal = _act(tmp_path)
    assert refusal("write_file", {"file_path": str(copy_a.parent / "anything.md")}) is not None


def test_a_write_with_no_path_is_refused_rather_than_allowed(tmp_path: Path) -> None:
    """Fail closed. A call REX cannot locate is a call REX cannot bound."""
    _, _, _, refusal = _act(tmp_path)
    assert refusal("write_file", {}) is not None
    assert refusal("write_file", {"file_path": ""}) is not None


def test_the_traversal_spellings_the_backend_itself_refuses(tmp_path: Path) -> None:
    """Belt and braces: `..` and `~` are refused by the backend AND by this check.

    The backend answers "Path traversal not allowed" for both (measured), so
    this asserts the second layer would have caught them anyway.
    """
    _, copy_a, other, refusal = _act(tmp_path)
    for spelling in (
        f"{copy_a}/../{other.name}/secret.md",
        f"{copy_a}/./../{other.name}/secret.md",
        "~/rex-escape.txt",
        "relative.md",
    ):
        assert refusal("write_file", {"file_path": spelling}) is not None, spelling
