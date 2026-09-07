"""Spec 42 §7 and §13 criterion 10 — SDK messages become events, faithfully.

The rule being protected is that a host stores exactly what it stored before the
library existed. These are the block shapes REX's `runner.ts` handled, replayed
through the adapter's pure functions with no CLI, no network and no key.

Two shapes deserve their own attention, because they are the ones where "close
enough" is wrong:

* A `Write` produces a diff with **no** old text (`before is None`); an `Edit`
  whose old string was empty produces one with an **empty** old text
  (`before == ""`). A host draws no removed line for the first and one empty
  removed line for the second.
* `denied` is decided on the FULL result text and reported with the clipped one.
"""

from claude_agent_sdk import TextBlock, ThinkingBlock, ToolResultBlock, ToolUseBlock

from agent_runner.adapters.claude.events import (
    RESULT_CLIP,
    WRITE_CLIP,
    assistant_events,
    flatten_result,
    user_events,
)
from agent_runner.events import (
    AgentEvent,
    Denial,
    Diff,
    Text,
    Thinking,
    ToolCallEvent,
    ToolResultEvent,
    Wrote,
)


def kinds(events: list[AgentEvent]) -> list[str]:
    return [event.type for event in events]


def test_text_and_thinking_become_their_own_events() -> None:
    events = list(assistant_events([TextBlock(text="hello"), ThinkingBlock(thinking="hmm", signature="s")]))
    assert events == [Text(text="hello"), Thinking(text="hmm")]


def test_an_empty_block_produces_nothing() -> None:
    """A blank text block was never a row, and inventing one would be inventing."""
    assert list(assistant_events([TextBlock(text=""), ThinkingBlock(thinking="", signature="")])) == []


def test_a_tool_call_carries_both_names() -> None:
    """The SDK's own name to display, the common one to decide on."""
    (call,) = list(assistant_events([ToolUseBlock(id="t1", name="Bash", input={"command": "ls"})]))
    assert call == ToolCallEvent(id="t1", name="Bash", common="shell", input={"command": "ls"})


def test_an_unknown_tool_reaches_the_host_with_common_none() -> None:
    (call,) = list(assistant_events([ToolUseBlock(id="t2", name="TodoWrite", input={})]))
    assert isinstance(call, ToolCallEvent)
    assert call.name == "TodoWrite"
    assert call.common is None


def test_an_edit_reports_the_call_and_the_change() -> None:
    events = list(
        assistant_events(
            [
                ToolUseBlock(
                    id="t3",
                    name="Edit",
                    input={"file_path": "/a.md", "old_string": "one", "new_string": "two"},
                )
            ]
        )
    )
    assert kinds(events) == ["tool_call", "wrote", "diff"]
    assert events[1] == Wrote(path="/a.md")
    assert events[2] == Diff(path="/a.md", before="one", after="two")


def test_an_edit_with_no_change_at_all_draws_no_diff() -> None:
    events = list(assistant_events([ToolUseBlock(id="t4", name="Edit", input={"file_path": "/a.md"})]))
    assert kinds(events) == ["tool_call", "wrote"]


def test_an_edit_whose_old_text_was_empty_keeps_the_empty_string() -> None:
    """`before=""` is not `before=None`, and the host draws them differently."""
    events = list(
        assistant_events(
            [
                ToolUseBlock(
                    id="t5",
                    name="Edit",
                    input={"file_path": "/a.md", "old_string": "", "new_string": "new"},
                )
            ]
        )
    )
    assert events[-1] == Diff(path="/a.md", before="", after="new")


def test_a_write_is_a_change_with_no_old_text() -> None:
    events = list(
        assistant_events([ToolUseBlock(id="t6", name="Write", input={"file_path": "/b.md", "content": "hi"})])
    )
    assert kinds(events) == ["tool_call", "wrote", "diff"]
    assert events[2] == Diff(path="/b.md", before=None, after="hi")


def test_a_write_with_no_content_draws_no_diff_but_is_still_a_write() -> None:
    events = list(assistant_events([ToolUseBlock(id="t7", name="Write", input={"file_path": "/b.md", "content": ""})]))
    assert kinds(events) == ["tool_call", "wrote"]


def test_a_notebook_edit_is_reported_as_a_write_even_though_it_draws_no_diff() -> None:
    """It puts bytes on disk whether or not it can be shown as a patch."""
    events = list(assistant_events([ToolUseBlock(id="t8", name="NotebookEdit", input={"file_path": "/n.ipynb"})]))
    assert kinds(events) == ["tool_call", "wrote"]


def test_a_huge_new_file_is_clipped() -> None:
    events = list(
        assistant_events(
            [
                ToolUseBlock(
                    id="t9",
                    name="Write",
                    input={"file_path": "/c.md", "content": "x" * (WRITE_CLIP + 500)},
                )
            ]
        )
    )
    change = events[-1]
    assert isinstance(change, Diff)
    assert len(change.after) == WRITE_CLIP


# ── tool results ────────────────────────────────────────────────


def test_a_tool_result_takes_its_name_from_the_call_that_asked_for_it() -> None:
    (result,) = list(
        user_events(
            [ToolResultBlock(tool_use_id="t1", content="output", is_error=False)],
            {"t1": "Bash"},
            [],
        )
    )
    assert result == ToolResultEvent(id="t1", name="Bash", text="output", is_error=False, denied=False)


def test_a_result_for_a_call_nothing_recorded_has_no_name() -> None:
    (result,) = list(user_events([ToolResultBlock(tool_use_id="x", content="o")], {}, []))
    assert isinstance(result, ToolResultEvent)
    assert result.name is None


def test_a_refused_call_is_marked_denied_and_a_failed_one_is_not() -> None:
    reason = "A read session cannot change any file."
    denials = [Denial(tool_name="Bash", reason=reason)]

    (refused,) = list(
        user_events(
            [ToolResultBlock(tool_use_id="t1", content=reason, is_error=True)],
            {"t1": "Bash"},
            denials,
        )
    )
    (merely_failed,) = list(
        user_events(
            [ToolResultBlock(tool_use_id="t2", content="Exit code 1\nnope", is_error=True)],
            {"t2": "Bash"},
            denials,
        )
    )
    assert isinstance(refused, ToolResultEvent) and refused.denied is True
    assert isinstance(merely_failed, ToolResultEvent) and merely_failed.denied is False


def test_denied_is_decided_on_the_full_text_and_reported_with_the_clipped_one() -> None:
    """A refusal whose sentence falls past the clip is still a refusal."""
    reason = "REFUSED-SENTENCE"
    padded = ("x" * RESULT_CLIP) + reason
    (result,) = list(
        user_events(
            [ToolResultBlock(tool_use_id="t1", content=padded, is_error=True)],
            {"t1": "Bash"},
            [Denial(tool_name="Bash", reason=reason)],
        )
    )
    assert isinstance(result, ToolResultEvent)
    assert result.denied is True
    assert len(result.text) == RESULT_CLIP
    assert reason not in result.text


def test_a_result_that_did_not_fail_is_never_denied() -> None:
    (result,) = list(
        user_events(
            [ToolResultBlock(tool_use_id="t1", content="A read session cannot change any file.")],
            {"t1": "Bash"},
            [Denial(tool_name="Bash", reason="A read session cannot change any file.")],
        )
    )
    assert isinstance(result, ToolResultEvent)
    assert result.denied is False


def test_result_content_is_flattened_whatever_shape_it_arrived_in() -> None:
    assert flatten_result("plain") == "plain"
    assert flatten_result([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]) == "a b"
    assert flatten_result(None) == ""
    assert flatten_result(42) == ""


def test_a_block_the_adapter_does_not_know_produces_nothing() -> None:
    """Rule 5 — unknown events are dropped, not guessed."""
    assert list(assistant_events([object()])) == []
    assert list(user_events([object()], {}, [])) == []
