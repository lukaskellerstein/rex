"""Spec 42 §7 — `AgentEvent`, the general message, and `RunResult`.

The single most important decision in the package. Five properties matter, and
each is a rule every adapter must keep:

1. **No SDK type appears in it.** A caller cannot tell Claude from Codex by the
   shape of an event — only by the `sdk` it asked for.
2. **`cost_usd = None` means "not reported", never zero.** A host draws None as
   unknown; it never draws `$0.00` for a run whose SDK said nothing.
3. **`tool_call` carries both names** — the SDK's own and the common one — so a
   host can display the real name and decide on the mapped one.
4. **`tool_result.denied` is set here, because only here can it be set:** the
   policy ran before the tool, so every refusal is already known when its result
   arrives, and the SDK hands the reason back verbatim.
5. **Unknown SDK events are dropped, not guessed.** An adapter never invents a
   `text`.
"""

from typing import Annotated, Any, Literal

from pydantic import Field

from .base import Model
from .policy import CommonTool


class Denial(Model):
    """One call the host's policy refused, and why."""

    tool_name: str
    reason: str
    subagent_id: str | None = None


class Started(Model):
    """The SDK is up, and these are the values it RESOLVED.

    Not what the host asked for — what the SDK will actually use, so a
    disagreement shows up as a disagreement rather than as a silent pass.
    """

    type: Literal["started"] = "started"
    session_id: str
    model: str | None = None
    style: str | None = None
    #: How many tools the SDK loaded, and which plugins. A host writes one line
    #: about the start of a run and needs all four numbers to write it — the
    #: library has no logger of the host's, so it says them as an event.
    tools: int | None = None
    plugins: list[str] = Field(default_factory=list)


class Text(Model):
    type: Literal["text"] = "text"
    text: str


class Thinking(Model):
    type: Literal["thinking"] = "thinking"
    text: str


class ToolCallEvent(Model):
    type: Literal["tool_call"] = "tool_call"
    id: str
    #: The SDK's own name, for display.
    name: str
    #: The mapped name, for deciding. None when the library could not map it.
    common: CommonTool | None = None
    input: Any = None


class ToolResultEvent(Model):
    type: Literal["tool_result"] = "tool_result"
    id: str
    name: str | None = None
    text: str
    is_error: bool = False
    #: Rule 4 — the gate spoke, rather than the tool having failed.
    denied: bool = False


class Diff(Model):
    """A change to one file, as the change itself rather than as a tool call.

    `before = None` is a whole new file: there is no old text, and a host draws
    only additions. `before = ""` is an edit whose old text was empty, which is
    a different thing and draws one empty removed line.
    """

    type: Literal["diff"] = "diff"
    path: str
    before: str | None = None
    after: str


class Wrote(Model):
    """A write tool named this path. The primary source for "what did this touch"."""

    type: Literal["wrote"] = "wrote"
    path: str


class DeniedEvent(Model):
    type: Literal["denied"] = "denied"
    name: str
    reason: str
    subagent_id: str | None = None


class ErrorEvent(Model):
    """The run failed, and this is what it said.

    A failed turn still costs money and still took time, so both are carried:
    a host that draws a cost on the row would otherwise show nothing for the one
    kind of run whose cost is most worth seeing.
    """

    type: Literal["error"] = "error"
    text: str
    cost_usd: float | None = None
    duration_ms: int | None = None


class StoppedEvent(Model):
    """A person ended this run. Never a fault, and never an error.

    It carries what the run had spent when it was ended, for the same reason
    `ErrorEvent` does.
    """

    type: Literal["stopped"] = "stopped"
    cost_usd: float | None = None
    duration_ms: int | None = None


class Completed(Model):
    type: Literal["completed"] = "completed"
    cost_usd: float | None = None
    duration_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


AgentEvent = Annotated[
    Started
    | Text
    | Thinking
    | ToolCallEvent
    | ToolResultEvent
    | Diff
    | Wrote
    | DeniedEvent
    | ErrorEvent
    | StoppedEvent
    | Completed,
    Field(discriminator="type"),
]


class RunResult(Model):
    """The run is over. Nothing more will arrive for this `run_id`."""

    session_id: str
    #: None means the SDK reported no cost. It never means zero.
    cost_usd: float | None = None
    duration_ms: int | None = None
    denials: list[Denial] = Field(default_factory=list)
    error: str | None = None
    #: A person stopped it, so `error` is None. A stop is not a failure.
    stopped: bool = False
