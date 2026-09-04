"""Spec 42 §10 — the kinds and their route templates, as data.

> **The library describes the configuration. The host renders it.**

The library cannot ship React, so it ships a description a host turns into its
own controls. `build_routes()` and `validate_gateway()` are template
substitution over this table, which is why the table is also exported as
`catalogue.json`: the host can carry the same forty lines and preview a route
without a round trip.

.. warning::
   **Every string here comes from this file.** Never from a gateway, a model, or
   a config file the host did not write. A label a remote server can set is a
   remote server writing the host's interface.
"""

from typing import Literal

from pydantic import Field

from .base import Model
from .types import AgentAuth, AgentSdk, GatewayKind


class Option(Model):
    """One choice in a `select` field."""

    value: str
    label: str


class ConfigField(Model):
    """One control the host draws, and one value it sends back."""

    key: str
    label: str
    kind: Literal["url", "text", "textarea", "select", "env-var"]
    required: bool = False
    placeholder: str | None = None
    help: str | None = None
    options: list[Option] | None = None
    #: What this field means when the host sends nothing for it.
    #:
    #: A **value**, not a hint — `placeholder` is the hint. `build_routes` reads
    #: it before substituting, so a kind whose route needs a path the reviewer
    #: rarely changes (Envoy's `/anthropic`) builds correctly from a bare host,
    #: and a host that pre-fills the form gets the same answer either way. The
    #: alternative was a default inside the template language, which cannot be
    #: written in `{key}` and would have to be invented.
    default: str | None = None


class RouteNote(Model):
    """What one kind offers one SDK — described, and as a template.

    `protocol` and `note` are for the host to show. The three template fields
    are how `build_routes()` turns the reviewer's answers into a `GatewayRoute`:
    a `{key}` in `base_url` or `credential_env` is replaced by the value of the
    field with that key, or by that field's `default` when the host sent none.

    **A template that resolves to nothing offers no route.** `base_url=None`
    means "this SDK uses its own endpoint" — the `original` kind — and is a
    route. `base_url="{claudeUrl}"` with no `claudeUrl` answered means the
    reviewer did not configure this SDK, and `build_routes()` leaves it out
    rather than inventing a gateway that addresses nothing.
    """

    protocol: str
    note: str
    base_url: str | None = None
    auth: AgentAuth = "inherit"
    credential_env: str | None = None
    #: The path the SDK appends to `base_url` by itself, for `verify` (§2.4).
    #:
    #: Never appended by anything here. It exists so a check can ask whether the
    #: server publishes the path this route will actually address — REX guesses
    #: no suffix, and this is the one place a suffix is even written down.
    appends: str | None = None


class KindDescriptor(Model):
    """One gateway kind: what to ask the reviewer, and what each SDK gets."""

    id: GatewayKind
    label: str
    fields: list[ConfigField] = Field(default_factory=list)
    routes: dict[AgentSdk, RouteNote] = Field(default_factory=dict)
    #: Set until this kind has been measured against a live server.
    unverified: str | None = None


class SdkDescriptor(Model):
    """One SDK a host may offer. Only SDKs with an adapter are listed."""

    id: AgentSdk
    label: str
    supports_styles: bool = False


class FieldError(Model):
    """One answer the reviewer must fix before the gateway can be saved."""

    key: str
    message: str


#: What each SDK appends to its own base URL, so `verify` can ask for it.
#:
#: SDK knowledge, which is why it is here and not in a host. The Claude row is
#: the trap spec 43 §3 cost a live test to find: the SDK appends `/v1/messages`
#: itself, so a base ending in `/v1` produces `/v1/v1/messages`.
APPENDS: dict[AgentSdk, str] = {
    "claude-agent": "/v1/messages",
    "codex": "/v1/responses",
    "opencode": "/session",
    "deep-agents": "/v1/chat/completions",
}


def _host_field(placeholder: str) -> ConfigField:
    """The one answer every gateway kind needs: where it listens.

    One field, and never a path per SDK — that is the whole point of a kind. The
    help says what the reviewer must NOT do, because appending `/v1` by hand is
    the mistake that produces a 404 explaining nothing (spec 43 §3).
    """
    return ConfigField(
        key="url",
        label="Host",
        kind="url",
        required=True,
        placeholder=placeholder,
        help="Just the address. Do not add a path — each SDK's own is filled in below.",
    )


#: Every kind the library knows how to build routes for.
#:
#: **This table is code, not data.** Each row is hard-won knowledge about
#: another product's URL layout, learned by measurement, so that nobody has to
#: learn it twice. Adding a row is a pull request against this file, and it needs
#: the evidence spec 43 §15 carries.
CATALOGUE: dict[GatewayKind, KindDescriptor] = {
    "original": KindDescriptor(
        id="original",
        label="Original",
        fields=[],
        routes={
            "claude-agent": RouteNote(
                protocol="anthropic",
                note="The Claude CLI's own endpoint, on your own login.",
            ),
            "codex": RouteNote(
                protocol="openai-responses",
                note="Codex's own endpoint, on your own login.",
            ),
            "opencode": RouteNote(
                protocol="opencode",
                note="A local OpenCode server, on its own configuration.",
            ),
            "deep-agents": RouteNote(
                protocol="openai-chat",
                note="Whatever the model provider's own environment names.",
            ),
        },
    ),
    # Spec 43 §15.1 — measured 2026-09-03 and re-measured 2026-09-04. The
    # Anthropic Messages route is at the ROOT, with no `/v1`, and every call
    # needs a bearer token. The recipe is the gateway author's own
    # (`ai-gateway/litellm/README.md`), not an assumption.
    "litellm": KindDescriptor(
        id="litellm",
        label="LiteLLM",
        fields=[
            _host_field("http://localhost:24000"),
            ConfigField(
                key="tokenEnv",
                label="Credential variable",
                kind="env-var",
                default="AI_GATEWAY_KEY",
                placeholder="AI_GATEWAY_KEY",
                help="The environment variable holding the gateway key. Its value is never stored.",
            ),
        ],
        routes={
            "claude-agent": RouteNote(
                protocol="anthropic",
                note="Anthropic Messages, at the root. LiteLLM translates to whatever the alias names.",
                base_url="{url}",
                auth="environment",
                credential_env="{tokenEnv}",
                appends=APPENDS["claude-agent"],
            ),
            "codex": RouteNote(
                protocol="openai-responses",
                note="OpenAI Responses. Spec 44.",
                base_url="{url}/v1",
                auth="environment",
                credential_env="{tokenEnv}",
                appends=APPENDS["codex"],
            ),
            "opencode": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat, as a model provider. Spec 45.",
                base_url="{url}/v1",
                auth="environment",
                credential_env="{tokenEnv}",
                appends=APPENDS["opencode"],
            ),
            "deep-agents": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat. Spec 46.",
                base_url="{url}/v1",
                auth="environment",
                credential_env="{tokenEnv}",
                appends=APPENDS["deep-agents"],
            ),
        },
    ),
    # Spec 43 §15.2 — read from the gateway's own source at commit `4b2e83d3`
    # and from the reviewer's deployment, and **not measured**. The two prefixes
    # are deployment configuration rather than constants, which is why they are
    # fields with the source's defaults rather than baked into the templates.
    "envoy": KindDescriptor(
        id="envoy",
        label="Envoy AI Gateway",
        fields=[
            # REX ships one, in `infra/envoy`, and that is the address it
            # listens on. A placeholder that names a port the reviewer already
            # has beats a generic one they have to look up.
            _host_field("http://localhost:26334"),
            ConfigField(
                key="anthropicPrefix",
                label="Anthropic prefix",
                kind="text",
                default="/anthropic",
                placeholder="/anthropic",
                help="Envoy's own default. Change it only if the deployment passes --endpointPrefixes.",
            ),
            ConfigField(
                key="openaiPrefix",
                label="OpenAI prefix",
                kind="text",
                default="",
                placeholder="(none)",
                help="Envoy's own default is no prefix at all.",
            ),
        ],
        routes={
            "claude-agent": RouteNote(
                protocol="anthropic",
                # The one thing an Envoy deployment must get right for an agent,
                # measured on 2026-09-04 by getting it wrong first. The route is
                # the easy half; the backend's SCHEMA is the half that decides
                # whether a conversation can continue past its first turn.
                note=(
                    "Anthropic Messages, under the Anthropic prefix. **Use an alias ending "
                    "'-anthropic'** — one routed to a backend declared 'schema: {name: "
                    "Anthropic}', so the body reaches the engine untranslated. A plain alias is "
                    "converted to OpenAI on the way in, and the engine then refuses the thinking "
                    "blocks that conversion carries; a one-shot usually survives it and an agent "
                    "conversation fails at random. Measured 2026-09-04 direct on Unsloth, LM "
                    "Studio and Ollama, with no gateway in the path."
                ),
                base_url="{url}{anthropicPrefix}",
                auth="none",
                appends=APPENDS["claude-agent"],
            ),
            "codex": RouteNote(
                protocol="openai-responses",
                note="OpenAI Responses, served natively. Spec 44.",
                base_url="{url}{openaiPrefix}/v1",
                auth="none",
                appends=APPENDS["codex"],
            ),
            "opencode": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat, as a model provider. Spec 45.",
                base_url="{url}{openaiPrefix}/v1",
                auth="none",
                appends=APPENDS["opencode"],
            ),
            "deep-agents": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat. Spec 46.",
                base_url="{url}{openaiPrefix}/v1",
                auth="none",
                appends=APPENDS["deep-agents"],
            ),
        },
        # Spec 43 milestone 3 — measured 2026-09-04, and it carries a real agent
        # turn: Read landed, a Write was refused by the gate, thinking blocks
        # survived two round trips, 63 s. So no `unverified` marker.
        #
        # It took one deployment change to get there, and the note on the Claude
        # route below is where it is written down.
    ),
    # The escape hatch, so a gateway nobody here has heard of needs no code
    # change to be usable. One URL per SDK, because that is exactly what a kind
    # normally works out and this kind cannot.
    "custom": KindDescriptor(
        id="custom",
        label="Custom",
        fields=[
            ConfigField(
                key="claudeUrl",
                label="Claude Agent URL",
                kind="url",
                help="An Anthropic Messages endpoint. The SDK appends /v1/messages itself.",
            ),
            ConfigField(
                key="codexUrl",
                label="Codex URL",
                kind="url",
                help="An OpenAI Responses endpoint. Spec 44.",
            ),
            ConfigField(
                key="opencodeUrl",
                label="OpenCode URL",
                kind="url",
                help="An OpenAI-compatible endpoint for OpenCode's provider. Spec 45.",
            ),
            ConfigField(
                key="deepAgentsUrl",
                label="Deep Agents URL",
                kind="url",
                help="An OpenAI chat endpoint. Spec 46.",
            ),
        ],
        routes={
            "claude-agent": RouteNote(
                protocol="anthropic",
                note="Typed by hand.",
                base_url="{claudeUrl}",
                appends=APPENDS["claude-agent"],
            ),
            "codex": RouteNote(
                protocol="openai-responses",
                note="Typed by hand. Spec 44.",
                base_url="{codexUrl}",
                appends=APPENDS["codex"],
            ),
            "opencode": RouteNote(
                protocol="openai-chat",
                note="Typed by hand. Spec 45.",
                base_url="{opencodeUrl}",
                appends=APPENDS["opencode"],
            ),
            "deep-agents": RouteNote(
                protocol="openai-chat",
                note="Typed by hand. Spec 46.",
                base_url="{deepAgentsUrl}",
                appends=APPENDS["deep-agents"],
            ),
        },
    ),
}
