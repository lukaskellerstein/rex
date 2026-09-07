"""Spec 42 §7 and §9 — Claude's own messages, turned into `AgentEvent`s.

Pure functions over the SDK's message objects, so a recorded stream can be
replayed through them without a CLI, a network or a key. That is what makes
"the host stores exactly what it stored before" a thing a test can prove.

Two rules run through all of it:

* **Nothing is invented.** A block shape the adapter does not know produces no
  event, rather than a `text` guessed from it.
* **The host's rendering decisions are not made here.** A `diff` carries the old
  text and the new text; how they are drawn is the host's business.
"""

from collections.abc import Iterator
from typing import Any

from claude_agent_sdk import TextBlock, ThinkingBlock, ToolResultBlock, ToolUseBlock

from ...events import (
    AgentEvent,
    Denial,
    Diff,
    Text,
    Thinking,
    ToolCallEvent,
    ToolResultEvent,
    Wrote,
)
from .errors import denied_by
from .tools import common_tool

#: The three tools that put bytes on disk.
WRITE_TOOLS = frozenset({"Edit", "Write", "NotebookEdit"})

#: How much of a tool result a host is given. Beyond this it is a blob, not a
#: message, and it would be stored and replayed on every read of the thread.
RESULT_CLIP = 4000

#: How much of a new file is shown as a diff, for the same reason.
WRITE_CLIP = 10_000


def _text(value: Any) -> str:
    """A tool input field as a string, with a missing field being an empty one."""
    return "" if value is None else value if isinstance(value, str) else str(value)


def diff_of_edit(tool_input: dict[str, Any]) -> Diff | None:
    """An `Edit` call, as the change it makes.

    None when there is no change to show — neither an old string nor a new one.
    """
    before = _text(tool_input.get("old_string"))
    after = _text(tool_input.get("new_string"))
    if not before and not after:
        return None
    return Diff(path=_text(tool_input.get("file_path")), before=before, after=after)


def diff_of_write(tool_input: dict[str, Any]) -> Diff | None:
    """A `Write` call — a whole new file is a change with no old text at all.

    `before` is None rather than the empty string, and the difference matters: a
    host draws no removed line for None, and one empty removed line for "".
    """
    path = _text(tool_input.get("file_path"))
    content = _text(tool_input.get("content"))
    if not path or not content:
        return None
    return Diff(path=path, before=None, after=content[:WRITE_CLIP])


def assistant_events(content: list[Any]) -> Iterator[AgentEvent]:
    """One assistant message's content blocks, in order."""
    for block in content:
        if isinstance(block, TextBlock):
            if block.text:
                yield Text(text=block.text)

        elif isinstance(block, ThinkingBlock):
            if block.thinking:
                yield Thinking(text=block.thinking)

        elif isinstance(block, ToolUseBlock):
            tool_input = block.input if isinstance(block.input, dict) else {}
            yield ToolCallEvent(
                id=block.id,
                name=block.name,
                common=common_tool(block.name),
                input=block.input,
            )
            # Reported before the diff and for all three write tools, not only
            # the two that draw one: `NotebookEdit` writes a file whether or not
            # it can be shown as a patch.
            if block.name in WRITE_TOOLS:
                path = _text(tool_input.get("file_path"))
                if path:
                    yield Wrote(path=path)
            if block.name == "Edit":
                change = diff_of_edit(tool_input)
                if change:
                    yield change
            elif block.name == "Write":
                change = diff_of_write(tool_input)
                if change:
                    yield change


def flatten_result(content: Any) -> str:
    """A tool result's content, whatever shape the SDK used for it."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(_text(item.get("text")))
            else:
                parts.append(_text(getattr(item, "text", None)))
        return " ".join(parts)
    return ""


def user_events(
    content: Any,
    tool_names: dict[str, str],
    denials: list[Denial],
) -> Iterator[AgentEvent]:
    """Tool results, which arrive as user messages in the SDK's stream.

    `denied` is decided on the FULL text and reported with the clipped text: a
    refusal whose sentence happens to fall past the clip is still a refusal.
    """
    if not isinstance(content, list):
        return
    for block in content:
        if not isinstance(block, ToolResultBlock):
            continue
        text = flatten_result(block.content)
        name = tool_names.get(block.tool_use_id)
        is_error = block.is_error is True
        yield ToolResultEvent(
            id=block.tool_use_id,
            name=name,
            text=text[:RESULT_CLIP],
            is_error=is_error,
            denied=is_error and denied_by(denials, name, text),
        )
