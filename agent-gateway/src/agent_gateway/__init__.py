"""agent-gateway — agent SDKs and AI gateways behind one interface.

Two ways in, and they are the same code:

* **As a library.** ``run(request, emit, ask_policy, stop)``. No service, no
  pipe, no subprocess of ours. This is what a Python consumer uses.
* **As a service.** ``python -m agent_gateway``, one JSON object per line on
  stdin and stdout. This is for a host in another language.

What this package knows: SDKs and gateways. What it does not know, and cannot
learn: documents, comments, threads, databases, windows, and the application
that spawned it.
"""

from .catalogue import (
    APPENDS,
    CATALOGUE,
    ConfigField,
    FieldError,
    KindDescriptor,
    Option,
    RouteNote,
    SdkDescriptor,
)
from .describe import build_routes, list_kinds, list_sdks, validate_gateway
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
from .resolve import RouteError, resolve_route, validate_base_url
from .run import run
from .types import (
    ALL_SDKS,
    ORIGINAL_GATEWAY,
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
)
from .verify import VerifyResult, verify_route, verify_route_blocking

__all__ = [
    "ALL_SDKS",
    "APPENDS",
    "CATALOGUE",
    "ORIGINAL_GATEWAY",
    "AgentAuth",
    "AgentEvent",
    "AgentGateway",
    "AgentSdk",
    "AgentSession",
    "CommonTool",
    "Completed",
    "ConfigField",
    "Denial",
    "DeniedEvent",
    "Diff",
    "ErrorEvent",
    "FieldError",
    "GatewayKind",
    "GatewayRoute",
    "KindDescriptor",
    "ModelChoice",
    "NewSession",
    "Option",
    "ResolvedRoute",
    "ResumeSession",
    "RouteCapabilities",
    "RouteError",
    "RouteNote",
    "RunRequest",
    "RunResult",
    "SdkDescriptor",
    "SeedSession",
    "Started",
    "StoppedEvent",
    "Text",
    "Thinking",
    "ToolCall",
    "ToolCallEvent",
    "ToolResultEvent",
    "VerifyResult",
    "Wrote",
    "build_routes",
    "list_kinds",
    "list_sdks",
    "resolve_route",
    "run",
    "validate_base_url",
    "validate_gateway",
    "verify_route",
    "verify_route_blocking",
]
