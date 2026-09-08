"""Spec 47 §6 — recorded OpenCode events become `AgentEvent`s.

**Every fixture below is verbatim from `opencode` 1.18.27**, captured on
2026-09-07 by the milestone 0 spike (§10.6). Nothing here is a shape the spec
described and nobody checked; the ids and the wording are the server's own.
"""

from typing import Any

from agent_runner.adapters.opencode.adapter import OpenCodeAdapter

SESSION = "ses_f828e872fffeB4NaJnOF83In7r"
USER_MESSAGE = "msg_07d7178db001tZvjXbbAbJ0Co1"
ASSISTANT_MESSAGE = "msg_07d7179ce001018ZTnNm8ecqJI"

#: The reviewer's own prompt, echoed back onto the bus as a `text` part.
ECHOED_PROMPT = {
    "type": "text",
    "text": "Read the file README.md in this directory using the read tool, then tell me the secret number.",
    "messageID": USER_MESSAGE,
    "sessionID": SESSION,
    "id": "prt_07d7178de001yDGFnZlLKDq7lh",
}

ANSWER = {
    "id": "prt_07d718467001KBJ2uVRh24mWeO",
    "messageID": ASSISTANT_MESSAGE,
    "sessionID": SESSION,
    "type": "text",
    "text": "The secret number is 41.",
    "time": {"start": 1788810986599, "end": 1788810986600},
}

READ_PENDING = {
    "id": "prt_07d7182bd001Bw8UR2M02VIZqk",
    "messageID": ASSISTANT_MESSAGE,
    "sessionID": SESSION,
    "type": "tool",
    "tool": "read",
    "callID": "424737927",
    "state": {"status": "pending", "input": {}, "raw": ""},
}

READ_RUNNING = {
    **READ_PENDING,
    "state": {"status": "running", "input": {"filePath": "README.md"}, "time": {"start": 1}},
}

READ_COMPLETED = {
    **READ_PENDING,
    "state": {
        "status": "completed",
        "input": {"filePath": "README.md"},
        "output": "<path>/tmp/mirror/README.md</path>\n<content>\n1: # Mirror\n</content>",
        "metadata": {"preview": "# Mirror", "truncated": False},
    },
}

WRITE_COMPLETED = {
    "id": "prt_07d718819001fv6RrlsLBt9qgZ",
    "messageID": ASSISTANT_MESSAGE,
    "sessionID": SESSION,
    "type": "tool",
    "tool": "write",
    "callID": "112896227",
    "state": {
        "status": "completed",
        "input": {"content": "BOOM", "filePath": "hacked.txt"},
        "output": "Wrote file successfully.",
        "metadata": {"filepath": "/tmp/mirror/hacked.txt", "exists": False},
        "title": "/tmp/mirror/hacked.txt",
    },
}

REJECTED_WRITE = {
    "id": "prt_rejected",
    "messageID": ASSISTANT_MESSAGE,
    "sessionID": SESSION,
    "type": "tool",
    "tool": "write",
    "callID": "999",
    "state": {
        "status": "error",
        "input": {"content": "BOOM", "filePath": "asked.txt"},
        "error": (
            "The user rejected permission to use this specific tool call with the "
            "following feedback: REX's read profile does not write."
        ),
    },
}

BASH_COMPLETED = {
    "id": "prt_07d718e55001jKz3L4ZcwvrEum",
    "messageID": ASSISTANT_MESSAGE,
    "sessionID": SESSION,
    "type": "tool",
    "tool": "bash",
    "callID": "631263017",
    "state": {
        "status": "completed",
        "input": {"command": "echo hello"},
        "output": "hello\n",
        "metadata": {"output": "hello\n", "exit": 0},
    },
}

#: §10.5 — an empty reasoning part is normal and is a real part.
EMPTY_REASONING = {
    "id": "prt_reason_empty",
    "messageID": ASSISTANT_MESSAGE,
    "sessionID": SESSION,
    "type": "reasoning",
    "text": "",
}

#: §10.5 — part types §3 does not model. Dropped, and that is correct.
STEP_START = {"id": "prt_step", "messageID": ASSISTANT_MESSAGE, "type": "step-start"}

ROLES = {USER_MESSAGE: "user", ASSISTANT_MESSAGE: "assistant"}


def events_of(*parts: dict[str, Any], roles: dict[str, str] | None = None) -> list[Any]:
    adapter = OpenCodeAdapter()
    seen: dict[str, str] = {}
    emitted: set[str] = set()
    known = dict(ROLES if roles is None else roles)
    produced: list[Any] = []
    for part in parts:
        produced.extend(adapter._part_events(part, seen, emitted, known))
    return produced


def test_the_reviewers_own_prompt_is_never_stored_as_the_answer() -> None:
    """The bug this map exists for, measured 2026-09-07.

    OpenCode echoes the user message onto the bus as a `text` part exactly as it
    does the assistant's. Without the role map the first thing every OpenCode
    turn wrote to the transcript was the reviewer's own question, attributed to
    the agent — a run that looks entirely successful.
    """
    assert events_of(ECHOED_PROMPT) == []
    answer = events_of(ANSWER)
    assert [event.type for event in answer] == ["text"]
    assert answer[0].text == "The secret number is 41."


def test_a_part_whose_message_is_unknown_is_kept() -> None:
    """Losing an answer is worse than keeping an echo, so the default is keep."""
    assert [event.type for event in events_of(ANSWER, roles={})] == ["text"]


def test_a_tool_call_is_reported_once_and_only_when_it_is_finished() -> None:
    """§6 — `pending` and `running` are ephemeral; a terminal state is one row.

    A part arrives three times. Emitting on each would put one call in the
    transcript three times, which reads as an agent doing the same thing over.
    """
    assert events_of(READ_PENDING) == []
    assert events_of(READ_RUNNING) == []
    produced = events_of(READ_PENDING, READ_RUNNING, READ_COMPLETED)
    assert [event.type for event in produced] == ["tool_call", "tool_result"]
    call, result = produced
    assert call.name == "read"
    assert call.common == "read"
    # §7.1 — renamed to what REX's gate reads.
    assert call.input == {"file_path": "README.md"}
    assert result.is_error is False
    assert result.denied is False
    assert "# Mirror" in result.text


def test_the_same_part_twice_is_stored_once() -> None:
    """Reconciliation replays history over a stream that already delivered it."""
    adapter = OpenCodeAdapter()
    seen: dict[str, str] = {}
    emitted: set[str] = set()
    first = adapter._part_events(READ_COMPLETED, seen, emitted, dict(ROLES))
    second = adapter._part_events(READ_COMPLETED, seen, emitted, dict(ROLES))
    assert len(first) == 2
    assert second == []


def test_a_write_reports_the_path_and_the_text_it_put_there() -> None:
    """§6 — `wrote` is the primary source for "what did this touch"."""
    produced = events_of(WRITE_COMPLETED)
    assert [event.type for event in produced] == ["tool_call", "tool_result", "wrote", "diff"]
    assert produced[2].path == "/tmp/mirror/hacked.txt"
    # `before = None` is a whole new file and draws no removed lines.
    assert produced[3].before is None
    assert produced[3].after == "BOOM"


def test_a_refusal_is_told_apart_from_a_tool_that_failed() -> None:
    """§7.1 — OpenCode sends both as `status: "error"`, so the sentence decides.

    `denied` is what stops REX drawing the reviewer's own safety rule as a bug
    in the agent.
    """
    produced = events_of(REJECTED_WRITE)
    assert [event.type for event in produced] == ["tool_call", "tool_result"]
    result = produced[1]
    assert result.is_error is True
    assert result.denied is True
    assert "REX's read profile does not write." in result.text
    # A write that was refused wrote nothing, so there is no `wrote` and no diff.
    assert not [event for event in produced if event.type in ("wrote", "diff")]


def test_a_shell_call_keeps_the_command_the_gate_reads() -> None:
    produced = events_of(BASH_COMPLETED)
    assert produced[0].common == "shell"
    assert produced[0].input == {"command": "echo hello"}
    assert produced[1].text == "hello\n"


def test_an_empty_reasoning_part_is_a_part_and_an_empty_text_part_is_not() -> None:
    """§10.5 — dropping a reasoning part on empty text would be wrong.

    It is a real part with nothing in it yet, and the reasoning block is where a
    local model's long silence becomes visible instead of looking like a stall.
    An empty TEXT part is nothing to store, which is a different thing.
    """
    assert [event.type for event in events_of(EMPTY_REASONING)] == ["thinking"]
    assert events_of({**ANSWER, "text": "   "}) == []


def test_a_part_type_nobody_models_is_dropped_and_never_guessed() -> None:
    """Spec 42 §7 rule 5. `step-start` and `step-finish` exist only to be ignored."""
    assert events_of(STEP_START) == []
    assert events_of({"id": "x", "messageID": ASSISTANT_MESSAGE, "type": "file"}) == []
