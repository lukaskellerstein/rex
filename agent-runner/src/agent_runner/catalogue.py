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
    #: `password` arrived with spec 46 §7: a control that takes a secret is a
    #: different control from one that takes a URL, and §8 rule 4 is that the
    #: screen never shows a key back — not even masked-with-a-reveal. `env-var`
    #: remains for the rows spec 43 wrote.
    kind: Literal["url", "text", "textarea", "select", "env-var", "password"]
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
    #: Whether `RunRequest.plugins` means anything to this SDK.
    #:
    #: Beside `supports_styles` and for the same reason, and spec 44 §7 is what
    #: made it necessary: a host builds a plugin list per run rather than asking
    #: a reviewer for one, so it has to know BEFORE the run whether to build one
    #: at all. `run()` refuses a non-empty list an adapter cannot honour — never
    #: silently drops it — which turns "the host guessed" into a failed run
    #: rather than an agent quietly missing its tools. Measured 2026-09-04:
    #: REX resolved `lsp-bash` for a Codex ASK and the run was refused before
    #: the child started.
    supports_plugins: bool = False


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
    # `/responses` and NOT `/v1/responses`. Measured 2026-09-04: a Codex route
    # with `base_url = http://host/v1` knocks on `http://host/v1/responses`, so
    # the SDK appends only the last segment — the CLI's error named the URL it
    # had used. Every kind's template below already ends the base in `/v1`, so
    # the doubled spelling made Verify report `/v1/v1/responses` and call a
    # working route broken. Spec 43 §3's trap, in the direction nobody expected:
    # a wrong `appends` accuses a correct route.
    "codex": "/responses",
    "opencode": "/session",
    "deep-agents": "/v1/chat/completions",
}


#: Spec 46 §4.2 — the first port REX's own gateway asks for.
#:
#: `24xxx` is the LiteLLM family on this machine and `334` is REX's own
#: signature — 9334 the debugger, 5334 Vite. It reads as "LiteLLM, REX's own".
#: It is only a starting point: a busy port sends REX up a number, and §4.2.1
#: rewrites the stored routes with whatever the child really got.
BUILTIN_PORT = 24334

#: The variable REX sets in its own process while the built-in child is running.
#:
#: §7.1 — the built-in gateway's master key lives **nowhere**: random per launch,
#: environment only, never on a disk. So the route names a variable exactly as
#: an external gateway's does, and the value has no file to leak from.
BUILTIN_KEY_VAR = "REX_GATEWAY_KEY"


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
    # Spec 46 §3 — REX's own LiteLLM, on a loopback port REX chose.
    #
    # **The same product as `litellm` below, so the route templates are the
    # same** (§3 note). What differs is who runs the process and who owns the
    # configuration, and neither of those is a route.
    #
    # The reviewer answers nothing here. `url` is filled in by REX with the port
    # its child actually got — which is not always the port it wanted, so §4.2.1
    # rewrites these four rows the moment the child is listening. `credential`
    # names a variable REX sets in its own process for as long as the child runs
    # (§7.1: the master key is random per launch and lives in an environment and
    # nowhere else).
    "builtin": KindDescriptor(
        id="builtin",
        label="Built-in",
        fields=[
            ConfigField(
                key="url",
                label="Address",
                kind="url",
                default=f"http://127.0.0.1:{BUILTIN_PORT}",
                help="REX chooses this. It moves if the port is taken.",
            ),
        ],
        routes={
            "claude-agent": RouteNote(
                protocol="anthropic",
                note="Anthropic Messages, at the root. One alias serves every agent (spec 46 §4.5).",
                base_url="{url}",
                auth="environment",
                credential_env=BUILTIN_KEY_VAR,
                appends=APPENDS["claude-agent"],
            ),
            "codex": RouteNote(
                protocol="openai-responses",
                note="OpenAI Responses, from the same alias.",
                base_url="{url}/v1",
                auth="environment",
                credential_env=BUILTIN_KEY_VAR,
                appends=APPENDS["codex"],
            ),
            "opencode": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat, as a model provider. Spec 47.",
                base_url="{url}/v1",
                auth="environment",
                credential_env=BUILTIN_KEY_VAR,
                appends=APPENDS["opencode"],
            ),
            "deep-agents": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat. Spec 48.",
                base_url="{url}/v1",
                auth="environment",
                credential_env=BUILTIN_KEY_VAR,
                appends=APPENDS["deep-agents"],
            ),
        },
    ),
    # Spec 43 §15.1 — measured 2026-09-03 and re-measured 2026-09-04. The
    # Anthropic Messages route is at the ROOT, with no `/v1`, and every call
    # needs a bearer token. The recipe is the gateway author's own
    # (`ai-gateway/litellm/README.md`), not an assumption.
    #
    # Spec 46 §6 reduced it to exactly this: **a URL and a key.** REX configures
    # no models for one — its models are already configured, inside it — and
    # `GET /v1/models` is where the list comes from. The key is now STORED
    # (encrypted, §7) rather than named, which is the reversal §7.1 records.
    "litellm": KindDescriptor(
        id="litellm",
        label="LiteLLM",
        fields=[
            _host_field("http://localhost:4000"),
            ConfigField(
                key="key",
                label="Master key",
                kind="password",
                required=True,
                help=(
                    "Encrypted by your operating system and never shown again. "
                    "A LiteLLM answers 401 to everything without it — including its own "
                    "model list, so REX cannot even ask what it serves."
                ),
            ),
        ],
        routes={
            "claude-agent": RouteNote(
                protocol="anthropic",
                note="Anthropic Messages, at the root. LiteLLM translates to whatever the alias names.",
                base_url="{url}",
                auth="stored",
                appends=APPENDS["claude-agent"],
            ),
            "codex": RouteNote(
                protocol="openai-responses",
                note="OpenAI Responses. Spec 44.",
                base_url="{url}/v1",
                auth="stored",
                appends=APPENDS["codex"],
            ),
            "opencode": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat, as a model provider. Spec 47.",
                base_url="{url}/v1",
                auth="stored",
                appends=APPENDS["opencode"],
            ),
            "deep-agents": RouteNote(
                protocol="openai-chat",
                note="OpenAI chat. Spec 48.",
                base_url="{url}/v1",
                auth="stored",
                appends=APPENDS["deep-agents"],
            ),
        },
    ),
}
