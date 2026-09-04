"""Spec 42 §5 — the vocabulary. Declarations only; nothing here does any work.

The line this whole package is drawn along: these names describe **SDKs and
gateways**. None of them describes a document, a comment, a thread or a row in
anybody's database.
"""

from typing import Annotated, Literal

from pydantic import Field

from .base import Model
from .policy import CommonTool

# ── §5.1 — the four SDKs and the four kinds ─────────────────────
#
# All four SDK names exist from this spec on, so that specs 44 to 46 add an
# adapter and change no type. `list_sdks()` returns only the SDKs that have an
# adapter, which after this spec is one.

AgentSdk = Literal["claude-agent", "codex", "opencode", "deep-agents"]

GatewayKind = Literal["original", "litellm", "envoy", "custom"]

AgentAuth = Literal["inherit", "none", "environment"]

#: Every SDK name, in the order the descriptor lists them.
ALL_SDKS: tuple[AgentSdk, ...] = ("claude-agent", "codex", "opencode", "deep-agents")

#: What a person calls each SDK. The library's own strings — never a server's.
SDK_LABELS: dict[AgentSdk, str] = {
    "claude-agent": "Claude Agent SDK",
    "codex": "Codex",
    "opencode": "OpenCode",
    "deep-agents": "Deep Agents",
}


# ── §5.2 — a gateway is a named set of routes ───────────────────


class GatewayRoute(Model):
    """How one SDK reaches one gateway.

    A gateway holds one route **per SDK**, because the base URL is a function of
    the gateway *and* the SDK: each SDK speaks a different wire protocol, and a
    gateway serves each protocol at a different path. A gateway with no route
    for an SDK does not offer that SDK.
    """

    #: None for the SDK's own official endpoint.
    base_url: str | None = None
    auth: AgentAuth = "inherit"
    #: The variable the HOST resolves into `ResolvedRoute.token` before a run.
    credential_env: str | None = None
    #: Empty means "ask the SDK" (§9.4).
    models: list[str] = Field(default_factory=list)


class AgentGateway(Model):
    """A named set of routes. The library defines the shape and never stores one."""

    id: str
    name: str
    kind: GatewayKind
    routes: dict[AgentSdk, GatewayRoute]


class ResolvedRoute(Model):
    """§5.3 — what a run is actually given. Built by the host, never stored here."""

    sdk: AgentSdk
    gateway_name: str
    base_url: str | None = None
    auth: AgentAuth = "inherit"
    #: The credential VALUE. It crosses the pipe exactly once, going down (§4.4).
    token: str | None = None


# ── §5.4 — the Original gateway ─────────────────────────────────

ORIGINAL_GATEWAY = AgentGateway(
    id="original",
    name="Original",
    kind="original",
    routes={sdk: GatewayRoute(auth="inherit") for sdk in ALL_SDKS},
)
"""The one `original`-kind gateway: no base URL anywhere, every SDK on its own
login. It is what REX does today, and with this spec built it is the only
gateway REX has. Spec 43 makes it a database row that cannot be edited."""


# ── §5.5 — the session is a shape, not a nullable string ────────
#
# A single nullable id cannot tell "seed a new session with THIS id" from
# "continue the session that id names", and has no shape at all for "start one
# and let the SDK name it". Three callers need three different answers, so the
# input carries a discriminated union.


class SeedSession(Model):
    """Start a session, and use this id. The host computed it and will store it."""

    mode: Literal["seed"] = "seed"
    id: str


class ResumeSession(Model):
    """Continue the session this id names."""

    mode: Literal["resume"] = "resume"
    id: str


class NewSession(Model):
    """Start a session and let the SDK name it. The id comes back in `RunResult`."""

    mode: Literal["new"] = "new"


AgentSession = Annotated[SeedSession | ResumeSession | NewSession, Field(discriminator="mode")]


# ── §6 — what one run is asked to do ────────────────────────────


class RunRequest(Model):
    """Everything a run needs, and nothing that names an SDK.

    Three inputs are named for what they MEAN rather than for what one SDK calls
    them, and that is the whole difference between this and an SDK call:

    * `system_prompt` is text. How an adapter installs it is its own business.
    * `disallowed` is a list of common tools. The adapter turns them into its
      SDK's own names.
    * `plugins` are absolute directories, opaque here. The adapter wraps them in
      whatever shape its SDK wants, and refuses them if it has no such shape.
    """

    run_id: str
    route: ResolvedRoute
    cwd: str
    prompt: str
    session: AgentSession
    model: str | None = None
    style: str | None = None
    #: The host's instructions. Appended to whatever the adapter's own preset is.
    system_prompt: str = ""
    #: Tools the model must not see, in the common vocabulary (§8).
    disallowed: list[CommonTool] = Field(default_factory=list)
    #: Absolute plugin directories. Refused where `supports_plugins` is false.
    plugins: list[str] = Field(default_factory=list)
    #: A runaway guard, not a budget. None is the SDK's own default.
    max_turns: int | None = None


# ── §9.4 — what a route can do ──────────────────────────────────


class SessionState(Model):
    """What the SDK knows about one session, and what is on disk for it.

    The record and the file are reported **separately**, and that separation is
    the point: they can disagree, and every way they disagree is a different
    bug. A record with no file means the store moved. A file with no record
    means the SDK will refuse to resume it and the host's own replay is what
    will actually happen. Collapsing the two into one "resumable: yes" is what
    hid both.
    """

    exists: bool
    #: The SDK's own record, when it has one.
    summary: str | None = None
    last_modified: int | None = None
    #: Where the transcript is, or would be. Named even when it is absent.
    path: str | None = None
    size: int | None = None


class ModelChoice(Model):
    """One row of a model picker, named by the adapter that knows the SDK."""

    value: str
    display_name: str
    description: str


class RouteCapabilities(Model):
    """What this SDK, through this gateway, can actually offer.

    `error` is not a failure of the probe's caller: a route that cannot be asked
    still has to render, and a host draws the sentence rather than an empty
    picker.
    """

    models: list[ModelChoice] = Field(default_factory=list)
    styles: list[str] = Field(default_factory=list)
    supports_styles: bool = False
    supports_plugins: bool = False
    supports_cost: bool = False
    supports_ask: bool = False
    supports_act: bool = False
    supports_resume: bool = False
    error: str | None = None
