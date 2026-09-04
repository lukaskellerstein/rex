"""Spec 42 §4.2 — every message on the pipe. **This file is the contract.**

One child, one pipe each way, one JSON object per line. Requests carry an `id`
that the reply echoes; run-scoped messages carry a `run_id`, and that id is the
only thing keeping two interleaved runs apart — on both sides.

**On the wire every field is camelCase** (`base.Model`), so `run_id` here is
`runId` in JSON and in the generated TypeScript. `src/shared/agent-protocol.ts`
in the host is generated from these models and never edited by hand; a test
regenerates it and fails when the two have drifted.

Run it directly to produce the three committed artefacts::

    python -m agent_gateway.protocol --schema     > schema.json
    python -m agent_gateway.protocol --typescript > ../src/shared/agent-protocol.ts
    python -m agent_gateway.protocol --catalogue  > catalogue.json
"""

import sys
from typing import Annotated, Any, Literal

from pydantic import Field

from .base import Model
from .catalogue import (
    ConfigField,
    FieldError,
    KindDescriptor,
    Option,
    RouteNote,
    SdkDescriptor,
)
from .events import (
    AgentEvent,
    Completed,
    Denial,
    DeniedEvent,
    Diff,
    ErrorEvent,
    RunResult,
    Started,
    StoppedEvent,
    Text,
    Thinking,
    ToolCallEvent,
    ToolResultEvent,
    Wrote,
)
from .policy import CommonTool, ToolCall
from .types import (
    AgentAuth,
    AgentGateway,
    AgentSdk,
    AgentSession,
    GatewayKind,
    GatewayRoute,
    ModelChoice,
    NewSession,
    ResolvedRoute,
    ResumeSession,
    RouteCapabilities,
    RunRequest,
    SeedSession,
    SessionState,
)
from .verify import VerifyResult

#: Bumped when a message changes shape. Sent in `ready`, so a host can say
#: "the library is older than this app expects" instead of failing on a field.
PROTOCOL_VERSION = "1"


# ── What a `reply` carries ──────────────────────────────────────
#
# One `reply` message answers all three questions, and its value is a
# discriminated union rather than a bare `Any`. The discriminator costs one
# nesting level and buys a host that never casts: `value.kind` narrows it, and
# a question added later cannot silently arrive as the wrong shape.


class DescribeResult(Model):
    sdks: list[SdkDescriptor]
    kinds: list[KindDescriptor]


class DescribeValue(Model):
    kind: Literal["describe"] = "describe"
    describe: DescribeResult


class CapabilitiesValue(Model):
    kind: Literal["capabilities"] = "capabilities"
    capabilities: RouteCapabilities


class ExistsValue(Model):
    kind: Literal["exists"] = "exists"
    session: SessionState


class VerifyValue(Model):
    kind: Literal["verify"] = "verify"
    verify: VerifyResult


ReplyValue = Annotated[
    DescribeValue | CapabilitiesValue | ExistsValue | VerifyValue,
    Field(discriminator="kind"),
]


# ── Host → service ──────────────────────────────────────────────


class DescribeMessage(Model):
    """What SDKs are real, and what gateway kinds can be configured (§10)."""

    type: Literal["describe"] = "describe"
    id: str


class CapabilitiesMessage(Model):
    """What this route offers. The library probes; the host caches (§9.4)."""

    type: Literal["capabilities"] = "capabilities"
    id: str
    route: ResolvedRoute
    cwd: str


class SessionExistsMessage(Model):
    """Whether the SDK can still resume this session (§9.3)."""

    type: Literal["session_exists"] = "session_exists"
    id: str
    route: ResolvedRoute
    cwd: str
    session_id: str


class VerifyMessage(Model):
    """Spec 43 §2.4 — what this server publishes, checked against this route.

    **It writes nothing and returns no URL.** Discovery verifies a judgement
    already made in `catalogue.py`; it never makes one.
    """

    type: Literal["verify"] = "verify"
    id: str
    route: ResolvedRoute


class RunMessage(RunRequest):
    """Start a run. **It has no reply**: its acknowledgement is its first event,
    and its completion is its `result`."""

    type: Literal["run"] = "run"


class StopMessage(Model):
    """End this run. It finishes with a `stopped` event and a `result`."""

    type: Literal["stop"] = "stop"
    run_id: str


class PolicyReplyMessage(Model):
    """The host's answer about one tool call. None allows; a string refuses."""

    type: Literal["policy_reply"] = "policy_reply"
    id: str
    reason: str | None = None


class ShutdownMessage(Model):
    """Finish the open runs and exit 0."""

    type: Literal["shutdown"] = "shutdown"


HostMessage = Annotated[
    DescribeMessage
    | CapabilitiesMessage
    | SessionExistsMessage
    | VerifyMessage
    | RunMessage
    | StopMessage
    | PolicyReplyMessage
    | ShutdownMessage,
    Field(discriminator="type"),
]


# ── Service → host ──────────────────────────────────────────────


class ReadyMessage(Model):
    """The loop is up. Sent once, first, and it is the only health check there is."""

    type: Literal["ready"] = "ready"
    #: The protocol version, so a host can say "older than this app expects".
    version: str
    python: str
    #: The agent-gateway distribution's own version.
    library: str
    #: Each built adapter's SDK distribution and its version. A host's version
    #: line names these, and a version-gate error tells the reader to update one.
    sdks: dict[str, str]


class ReplyMessage(Model):
    """Answers `describe`, `capabilities` and `session_exists`, by echoed id."""

    type: Literal["reply"] = "reply"
    id: str
    ok: bool
    value: ReplyValue | None = None
    error: str | None = None


class EventMessage(Model):
    """One thing happened in a run (§7)."""

    type: Literal["event"] = "event"
    run_id: str
    event: AgentEvent


class ResultMessage(Model):
    """The run is over. Nothing more will arrive for this `run_id`."""

    type: Literal["result"] = "result"
    run_id: str
    result: RunResult


class PolicyMessage(Model):
    """Judge this tool call before it runs (§8).

    **No answer within thirty seconds is a deny.** A policy the host does not
    answer is a bug in the host, and a bug in the host must never become a write.
    """

    type: Literal["policy"] = "policy"
    id: str
    run_id: str
    call: ToolCall


class LogMessage(Model):
    """A line for the host's log. **Never a credential** (§4.4)."""

    type: Literal["log"] = "log"
    level: Literal["info", "warn", "error"]
    text: str


ServiceMessage = Annotated[
    ReadyMessage | ReplyMessage | EventMessage | ResultMessage | PolicyMessage | LogMessage,
    Field(discriminator="type"),
]


# ── What the generator exports ──────────────────────────────────
#
# Named unions and literal aliases first, so the generated TypeScript refers to
# `AgentSdk` rather than repeating four string literals in nine places.

EXPORTED_ALIASES: list[tuple[str, Any]] = [
    ("AgentSdk", AgentSdk),
    ("GatewayKind", GatewayKind),
    ("AgentAuth", AgentAuth),
    ("CommonTool", CommonTool),
    ("AgentSession", AgentSession),
    ("AgentEvent", AgentEvent),
    ("ReplyValue", ReplyValue),
    ("HostMessage", HostMessage),
    ("ServiceMessage", ServiceMessage),
]

EXPORTED_MODELS: list[type[Model]] = [
    # §5 — the vocabulary
    GatewayRoute,
    AgentGateway,
    ResolvedRoute,
    SeedSession,
    ResumeSession,
    NewSession,
    ModelChoice,
    RouteCapabilities,
    RunRequest,
    SessionState,
    # §7 — events
    Denial,
    Started,
    Text,
    Thinking,
    ToolCallEvent,
    ToolResultEvent,
    Diff,
    Wrote,
    DeniedEvent,
    ErrorEvent,
    StoppedEvent,
    Completed,
    RunResult,
    # §8 — the policy
    ToolCall,
    # §10 — the descriptor
    Option,
    ConfigField,
    RouteNote,
    KindDescriptor,
    SdkDescriptor,
    FieldError,
    DescribeResult,
    DescribeValue,
    CapabilitiesValue,
    ExistsValue,
    # Spec 43 §2.4 — verification
    VerifyResult,
    VerifyValue,
    # §4.2 — the messages
    DescribeMessage,
    CapabilitiesMessage,
    SessionExistsMessage,
    VerifyMessage,
    RunMessage,
    StopMessage,
    PolicyReplyMessage,
    ShutdownMessage,
    ReadyMessage,
    ReplyMessage,
    EventMessage,
    ResultMessage,
    PolicyMessage,
    LogMessage,
]


def main(argv: list[str] | None = None) -> int:
    """Write one of the three committed artefacts to stdout."""
    from .codegen import catalogue_json, json_schema, typescript

    args = sys.argv[1:] if argv is None else argv
    if "--schema" in args:
        sys.stdout.write(json_schema())
    elif "--typescript" in args:
        sys.stdout.write(typescript())
    elif "--catalogue" in args:
        sys.stdout.write(catalogue_json())
    else:
        sys.stderr.write("usage: python -m agent_gateway.protocol --schema|--typescript|--catalogue\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
