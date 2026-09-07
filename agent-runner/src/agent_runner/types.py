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
# All four SDK names exist from this spec on, so that specs 44, 47 and 48 add an
# adapter and change no type. `list_sdks()` returns only the SDKs that have an
# adapter, which after this spec is one.

AgentSdk = Literal["claude-agent", "codex", "opencode", "deep-agents"]

#: Spec 46 §3 — three kinds, and only three.
#:
#: `builtin` and `litellm` are **the same product**, so they share every route
#: template; the only difference is who starts the process and who owns the
#: configuration, which is why it is two kinds and not two products.
#:
#: `envoy` and `custom` were removed on 2026-09-06, in milestone 3. Spec 46 §1.1
#: is the measurement that decided it — Envoy cannot run on Windows, needs the
#: network on first run, and fails every Claude-SDK call against a hosted OpenAI
#: backend because `thinking` is passed through verbatim. **REX supports exactly
#: one gateway product**, because two products mean two sets of conventions and
#: the open problem in spec 45's folder is eleven pages about what that costs.
GatewayKind = Literal["original", "builtin", "litellm"]

#: How a route presents a credential.
#:
#: ``stored`` arrived with spec 46 §7 and is the one that changed a rule rather
#: than adding a case: the HOST holds the value, encrypted by the operating
#: system's own keystore, and decrypts it into ``ResolvedRoute.token`` just
#: before a run. It **reverses spec 43 §6.1**, which stored the NAME of an
#: environment variable and deliberately added no keychain — a person installing
#: REX has no `direnv` and no `~/.secrets`, and telling them to export a shell
#: variable is not a product.
#:
#: ``environment`` stays, for the built-in gateway (whose master key is random
#: per launch and lives in an environment and nowhere else) and for any row
#: written before spec 46. **The library never reads either one**: it is handed a
#: `ResolvedRoute` with the value already in it.
AgentAuth = Literal["inherit", "none", "environment", "stored"]

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
    #: Directories this run may CHANGE. Absolute paths; empty changes nothing.
    #:
    #: Spec 44 §9.3 added it, and it is named for what it MEANS rather than for
    #: the mechanism any one SDK has. An adapter with a sandbox makes it the
    #: sandbox and the boundary holds before the tool runs; an adapter without
    #: one says it in the prompt and leaves the host to repair what escapes.
    #: Neither reading is the library's to choose, which is why the field says
    #: the intent and not the implementation.
    #:
    #: **`cwd` is not implied.** A run whose working directory is the reviewer's
    #: own repository may still be allowed to change nothing in it, and that is
    #: exactly REX's ACT: the agent reads the repository and writes only the
    #: working copies. An adapter whose SDK makes `cwd` writable must therefore
    #: move the child's working directory, not widen the list.
    writable: list[str] = Field(default_factory=list)
    #: A runaway guard, not a budget. None is the SDK's own default.
    max_turns: int | None = None
    #: Spec 45 §6 — which REX comment thread is spending this, for the gateway.
    #:
    #: It becomes an `x-rex-thread` header and then a span attribute, so that a
    #: dashboard can group a month of inference by the conversation that caused
    #: it. **Empty is normal and is not an error**: a run with no thread — an
    #: Apply, a probe — is labelled `none` rather than dropped.
    #:
    #: `run_id` above is sent the same way and needs no field of its own. The
    #: profile is sent too, because a `write` run costing five times a `read`
    #: one is the single most useful thing this grouping shows.
    thread_id: str = ""
    #: `read` or `write`, for the same reason. Empty where the host said nothing.
    profile: str = ""


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
