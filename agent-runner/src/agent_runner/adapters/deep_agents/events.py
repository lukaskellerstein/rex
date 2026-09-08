"""Spec 48 §6 — one LangGraph `updates` payload, as the events REX stores.

`updates` yields each node's output — **whole messages**, which is what a
transcript stores. `messages` yields token chunks, which drive a live view and
are never stored, and REX's protocol has no separate live channel: a `Text`
event IS the stored thing. So this module reads `updates` and nothing else, and
`adapter.py` streams only that mode. §6's sentence "only `updates` makes durable
events" is the whole design, and consuming both would store every answer twice.

Two measurements from 2026-09-07 shape what is here:

* **`reasoning_content` does not survive `ChatOpenAI`.** The gateway sends it —
  46 of 48 SSE chunks carried `delta.reasoning_content` — and
  `langchain-openai` 1.6.0 drops it, streaming and not: `additional_kwargs` came
  back empty both ways. §12.4 item 3's answer is "dropped", so §6's `thinking`
  row produces nothing today. The row is still read, because it costs one
  dictionary lookup and a provider that keeps the field should not need a code
  change to be believed.
* **`usage_metadata` needs asking for.** `model.py` passes `stream_usage=True`;
  without it every message reports None and `completed` would carry no tokens.

The one rule that is not a mapping: **`wrote` and `diff` are emitted on the
RESULT, never on the call.** A write that the policy refused still produced a
`tool_call`, and reporting a `wrote` for it would put a file REX did not change
into the list of files REX changed.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

from ...events import AgentEvent, Diff, Text, Thinking, ToolCallEvent, ToolResultEvent, Wrote
from .tools import WRITING_TOOLS, common_tool, path_of, policy_input, written_text


class Translator:
    """One run's worth of graph output, turned into events in order.

    Stateful for three reasons, each of which is a thing a `ToolMessage` does not
    carry: which tool a result belongs to, what that call's arguments were, and
    whether REX itself refused it.
    """

    def __init__(self, refusals: dict[str, str], writes_allowed: bool) -> None:
        #: call id → (tool name, arguments), learned from the call that made it.
        self._calls: dict[str, tuple[str, Any]] = {}
        #: call id → REX's own refusal sentence, written by `PolicyMiddleware`.
        self._refusals = refusals
        #: Whether a completed write may produce `wrote` and `diff` (§6 — "in ACT").
        self._writes_allowed = writes_allowed
        #: Messages already reported. A node that passes a message through would
        #: otherwise put it in the transcript twice.
        #:
        #: **The message itself is the value, not just its id**, and that is a
        #: correctness requirement rather than tidiness: `id()` is unique only
        #: among LIVE objects, so a bare `set[int]` lets a collected message's
        #: address be reused by a later one — which reads as "already seen" and
        #: drops a real event. Caught by `test_deep_agents_events` on 2026-09-07,
        #: where a dropped `AIMessage` and the next `ToolMessage` landed at the
        #: same address. Holding the reference makes the id stable for the run.
        self._seen: dict[int, BaseMessage] = {}
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None

    def updates(self, payload: Any) -> list[AgentEvent]:
        """Every event one `updates` payload is worth."""
        produced: list[AgentEvent] = []
        if not isinstance(payload, dict):
            return produced
        for output in payload.values():
            if not isinstance(output, dict):
                continue
            for message in output.get("messages") or []:
                produced.extend(self.message(message))
        return produced

    def message(self, message: Any) -> list[AgentEvent]:
        """One message. A `HumanMessage` is REX's own prompt and is dropped."""
        if not isinstance(message, BaseMessage):
            return []
        key = id(message)
        if key in self._seen:
            return []
        self._seen[key] = message
        if isinstance(message, AIMessage):
            return self._assistant(message)
        if isinstance(message, ToolMessage):
            return self._result(message)
        return []

    # ── the two message kinds that make events ──────────────────

    def _assistant(self, message: AIMessage) -> list[AgentEvent]:
        produced: list[AgentEvent] = []
        self._count(message.usage_metadata)

        reasoning = message.additional_kwargs.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning.strip():
            produced.append(Thinking(text=reasoning))

        text = message.text if isinstance(message.text, str) else ""
        if text.strip():
            produced.append(Text(text=text))

        for call in message.tool_calls or []:
            name = str(call.get("name") or "")
            args = call.get("args")
            call_id = str(call.get("id") or "")
            self._calls[call_id] = (name, args)
            produced.append(
                ToolCallEvent(
                    id=call_id,
                    name=name,
                    common=common_tool(name),
                    input=policy_input(name, args),
                )
            )
        return produced

    def _result(self, message: ToolMessage) -> list[AgentEvent]:
        call_id = str(message.tool_call_id or "")
        name, args = self._calls.get(call_id, (message.name or "", None))
        failed = message.status == "error"
        produced: list[AgentEvent] = [
            ToolResultEvent(
                id=call_id,
                name=name or None,
                text=_text_of(message.content),
                is_error=failed,
                # Rule 4 — REX wrote this sentence itself, moments earlier, so
                # a refusal and a tool that merely failed are told apart by what
                # REX knows rather than by reading the SDK's wording.
                denied=call_id in self._refusals,
            )
        ]
        if failed or not self._writes_allowed or name not in WRITING_TOOLS:
            return produced
        path = path_of(name, args)
        if path is None:
            return produced
        produced.append(Wrote(path=path))
        change = _diff_of(name, args)
        if change is not None:
            produced.append(Diff(path=path, before=change[0], after=change[1]))
        return produced

    def _count(self, usage: Any) -> None:
        """Sum what each step reported. None stays None: §7 rule 2's shape for
        tokens — a run whose gateway said nothing reports nothing, never zero."""
        if not isinstance(usage, dict):
            return
        given = usage.get("input_tokens")
        produced = usage.get("output_tokens")
        if isinstance(given, int):
            self.input_tokens = (self.input_tokens or 0) + given
        if isinstance(produced, int):
            self.output_tokens = (self.output_tokens or 0) + produced


def _diff_of(tool: str, args: Any) -> tuple[str | None, str] | None:
    """§6 — the change itself, as `(before, after)`.

    A `write_file` carries the whole new text and no old one, which is
    `Diff.before = None`: a new file, drawn with no removed lines. An
    `edit_file` carries the **replaced fragment** rather than a whole file, so
    the pair is that fragment before and after — which `drawDiff` renders
    exactly, and which is more use to a reviewer than nothing.
    """
    whole = written_text(tool, args)
    if whole is not None:
        return None, whole
    if tool != "edit_file" or not isinstance(args, dict):
        return None
    before = args.get("old_string")
    after = args.get("new_string")
    if isinstance(before, str) and isinstance(after, str):
        return before, after
    return None


def _text_of(content: Any) -> str:
    """A tool result's text, whatever shape the message put it in."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [part.get("text", "") if isinstance(part, dict) else str(part) for part in content]
        return "".join(part for part in parts if isinstance(part, str))
    return str(content)


__all__ = ["Translator"]
