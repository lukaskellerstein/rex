"""Spec 48 §6 — recorded LangGraph output, as the events REX stores.

The payloads below are the shape `astream(stream_mode="updates")` really
produces: `{node_name: {"messages": [...]}}`, with whole messages rather than
token chunks. Built from `langchain_core` message objects rather than from
dictionaries, because that is what the graph yields and a dictionary would test
a translation nobody performs.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agent_runner.adapters.deep_agents.events import Translator


def _call(name: str, args: dict[str, Any], call_id: str = "c1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


def _update(*messages: Any, node: str = "model") -> dict[str, Any]:
    return {node: {"messages": list(messages)}}


def _events(translator: Translator, payload: dict[str, Any]) -> list[Any]:
    """What one payload produced, unnarrowed.

    `AgentEvent` is a discriminated union, so `events[0].text` is a type error
    on every member that has no `text`. Asserting the `type` field IS the
    narrowing these tests do, and doing it twice — once for the checker and once
    for the assertion — would say the same thing in two languages.
    """
    return list(translator.updates(payload))


def test_an_assistant_message_becomes_text() -> None:
    translator = Translator({}, writes_allowed=False)
    events = _events(translator, _update(AIMessage(content="Revenue fell because two accounts churned.")))
    assert [event.type for event in events] == ["text"]
    assert events[0].text.startswith("Revenue fell")


def test_an_empty_answer_stores_nothing() -> None:
    """A tool-call turn has empty content, and an empty `text` is not a message."""
    translator = Translator({}, writes_allowed=False)
    assert translator.updates(_update(AIMessage(content="   "))) == []


def test_the_reviewers_own_prompt_is_never_stored() -> None:
    """REX already has the question. Storing the graph's copy would write it in
    as the answer — the one mapping bug that looks like a working run."""
    translator = Translator({}, writes_allowed=False)
    assert _events(translator, _update(HumanMessage(content="Why did revenue fall?"))) == []


def test_a_tool_call_carries_both_names() -> None:
    translator = Translator({}, writes_allowed=False)
    events = _events(translator, _update(_call("read_file", {"file_path": "/report.md"})))
    assert [event.type for event in events] == ["tool_call"]
    assert events[0].name == "read_file"
    assert events[0].common == "read"
    assert events[0].input == {"file_path": "/report.md"}


def test_an_unmapped_tool_arrives_with_no_common_name() -> None:
    """§5.3 — never guessed. The host denies `None` for every SDK but Claude."""
    translator = Translator({}, writes_allowed=False)
    events = _events(translator, _update(_call("write_todos", {"todos": []})))
    assert events[0].common is None


def test_a_result_is_named_from_the_call_that_made_it() -> None:
    translator = Translator({}, writes_allowed=False)
    translator.updates(_update(_call("read_file", {"file_path": "/report.md"})))
    events = _events(translator, _update(ToolMessage(content="1  # Report", tool_call_id="c1"), node="tools"))
    assert [event.type for event in events] == ["tool_result"]
    assert events[0].name == "read_file"
    assert events[0].is_error is False
    assert events[0].denied is False


def test_rexs_own_refusal_is_marked_denied() -> None:
    """Rule 4 — REX wrote the sentence itself, so it does not read the SDK's."""
    translator = Translator({"c1": "REX refused this call."}, writes_allowed=False)
    translator.updates(_update(_call("write_file", {"file_path": "/x.md", "content": "no"})))
    events = _events(
        translator,
        _update(
            ToolMessage(content="REX refused this call.", tool_call_id="c1", status="error"),
            node="tools",
        ),
    )
    assert events[0].is_error is True
    assert events[0].denied is True


def test_the_sdks_own_permission_denial_is_an_error_and_not_a_denial() -> None:
    """A rule the SDK enforced is a tool that failed, not REX refusing.

    Measured wording, 2026-09-07: `Error: permission denied for write on /x.md`,
    with `status="error"`. REX did not write it, so `denied` stays false and the
    transcript does not claim the gate spoke when it did not.
    """
    translator = Translator({}, writes_allowed=False)
    translator.updates(_update(_call("write_file", {"file_path": "/x.md", "content": "no"})))
    events = _events(
        translator,
        _update(
            ToolMessage(content="Error: permission denied for write on /x.md", tool_call_id="c1", status="error"),
            node="tools",
        ),
    )
    assert events[0].is_error is True
    assert events[0].denied is False


def test_a_completed_write_reports_the_path_and_the_new_text() -> None:
    translator = Translator({}, writes_allowed=True)
    translator.updates(_update(_call("write_file", {"file_path": "/copy.md", "content": "hello\n"})))
    events = _events(translator, _update(ToolMessage(content="Updated file /copy.md", tool_call_id="c1"), node="tools"))
    assert [event.type for event in events] == ["tool_result", "wrote", "diff"]
    assert events[1].path == "/copy.md"
    assert events[2].before is None
    assert events[2].after == "hello\n"


def test_an_edit_reports_the_fragment_it_replaced() -> None:
    translator = Translator({}, writes_allowed=True)
    translator.updates(_update(_call("edit_file", {"file_path": "/copy.md", "old_string": "old", "new_string": "new"})))
    events = _events(translator, _update(ToolMessage(content="Updated /copy.md", tool_call_id="c1"), node="tools"))
    assert [event.type for event in events] == ["tool_result", "wrote", "diff"]
    assert events[2].before == "old"
    assert events[2].after == "new"


def test_a_refused_write_reports_no_wrote_at_all() -> None:
    """The rule that keeps "what did this run change" honest."""
    translator = Translator({"c1": "REX refused this call."}, writes_allowed=True)
    translator.updates(_update(_call("write_file", {"file_path": "/copy.md", "content": "x"})))
    events = _events(
        translator,
        _update(ToolMessage(content="REX refused this call.", tool_call_id="c1", status="error"), node="tools"),
    )
    assert [event.type for event in events] == ["tool_result"]


def test_an_ask_never_reports_a_wrote_even_if_a_write_somehow_succeeded() -> None:
    """§6 — `wrote` and `diff` are "in ACT". A read run has nothing to report."""
    translator = Translator({}, writes_allowed=False)
    translator.updates(_update(_call("write_file", {"file_path": "/x.md", "content": "x"})))
    events = _events(translator, _update(ToolMessage(content="Updated /x.md", tool_call_id="c1"), node="tools"))
    assert [event.type for event in events] == ["tool_result"]


def test_thinking_is_read_when_a_provider_supplies_it() -> None:
    """§12.4 item 3 — `ChatOpenAI` 1.6.0 drops `reasoning_content` (measured),
    so this row produces nothing today. It is still read, because a provider
    that keeps the field should not need a code change to be believed."""
    translator = Translator({}, writes_allowed=False)
    message = AIMessage(content="Answer.", additional_kwargs={"reasoning_content": "First I read the file."})
    events = _events(translator, _update(message))
    assert [event.type for event in events] == ["thinking", "text"]
    assert events[0].text == "First I read the file."


def test_tokens_are_summed_over_every_step() -> None:
    translator = Translator({}, writes_allowed=False)
    for given, produced in ((10, 5), (20, 7)):
        translator.updates(
            _update(
                AIMessage(
                    content="step",
                    usage_metadata={"input_tokens": given, "output_tokens": produced, "total_tokens": given + produced},
                )
            )
        )
    assert translator.input_tokens == 30
    assert translator.output_tokens == 12


def test_tokens_stay_none_when_the_gateway_reported_none() -> None:
    """Spec 42 §7 rule 2 — None means "not reported" and never zero."""
    translator = Translator({}, writes_allowed=False)
    translator.updates(_update(AIMessage(content="step")))
    assert translator.input_tokens is None
    assert translator.output_tokens is None


def test_a_message_passed_through_twice_is_reported_once() -> None:
    """Nodes hand messages on, and a transcript that repeats an answer is wrong."""
    translator = Translator({}, writes_allowed=False)
    message = AIMessage(content="Once.")
    assert len(translator.updates(_update(message))) == 1
    assert translator.updates(_update(message, node="another")) == []
