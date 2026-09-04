"""Spec 42 §10 — the descriptor is data, and every kind fills every route it names.

The warning in `catalogue.py` is the thing worth testing: **every string a host
renders comes from the library's own source.** A label a remote server could set
is a remote server writing the host's interface, so nothing here may be built
from a response.
"""

from typing import cast

from agent_gateway import list_kinds, list_sdks
from agent_gateway.adapters import ADAPTERS
from agent_gateway.catalogue import CATALOGUE
from agent_gateway.describe import build_routes, substitute, validate_gateway
from agent_gateway.types import ALL_SDKS, GatewayKind


def test_only_sdks_with_an_adapter_are_offered() -> None:
    """A choice a host offers must not fail after the reviewer has made it."""
    offered = [sdk.id for sdk in list_sdks()]
    assert offered == [sdk for sdk in ALL_SDKS if sdk in ADAPTERS]
    assert offered == ["claude-agent"], "spec 42 builds exactly one adapter"


def test_the_declared_vocabulary_is_wider_than_what_is_built() -> None:
    """Specs 44 to 46 add an adapter and change no type."""
    assert set(ALL_SDKS) - set(ADAPTERS) == {"codex", "opencode", "deep-agents"}


def test_spec_43_adds_three_kinds_and_no_type() -> None:
    """Spec 42 shipped `original` alone; spec 43 fills the rest of `GatewayKind`."""
    assert [kind.id for kind in list_kinds()] == ["original", "litellm", "envoy", "custom"]


def test_every_kind_describes_every_sdk_it_offers() -> None:
    for kind in list_kinds():
        for sdk, note in kind.routes.items():
            assert sdk in ALL_SDKS
            assert note.protocol, f"{kind.id}/{sdk} has no protocol"
            assert note.note, f"{kind.id}/{sdk} has no note"


def test_every_kind_fills_every_route_from_its_own_fields() -> None:
    """A template may only refer to a field the same kind actually asks for."""
    for kind in list_kinds():
        keys = {field.key for field in kind.fields}
        values = {key: "x" for key in keys}
        routes = build_routes(kind.id, values)
        assert set(routes) == set(kind.routes), f"{kind.id} built a different set of routes"
        for route in routes.values():
            assert route.base_url is None or "{" not in route.base_url
            assert route.credential_env is None or "{" not in route.credential_env


def test_the_original_kind_has_no_url_anywhere_and_asks_nothing() -> None:
    """§5.4 — the SDK's own endpoint, on the SDK's own login."""
    original = CATALOGUE["original"]
    assert original.fields == []
    for route in build_routes("original", {}).values():
        assert route.base_url is None
        assert route.auth == "inherit"
        assert route.credential_env is None


def test_a_kind_nobody_declared_builds_nothing_and_says_so() -> None:
    # `cast` because the whole point is a value `GatewayKind` does not contain:
    # a host reading a stored row can hand over anything, and "there is no such
    # kind" has to be an answer rather than a crash.
    invented = cast(GatewayKind, "invented")
    assert build_routes(invented, {}) == {}
    errors = validate_gateway(invented, {})
    assert [error.key for error in errors] == ["kind"]


def test_a_kind_that_asks_nothing_validates_anything() -> None:
    assert validate_gateway("original", {}) == []


def test_an_unknown_placeholder_becomes_empty_rather_than_staying_a_placeholder() -> None:
    """A half-substituted URL that still looks like a URL reaches a server.

    An empty one fails validation here, with the field's name on it.
    """
    assert substitute("{host}/anthropic", {"host": "http://x"}) == "http://x/anthropic"
    assert substitute("{missing}/anthropic", {}) == "/anthropic"
    assert substitute(None, {}) is None


def test_every_string_a_host_renders_comes_from_this_package() -> None:
    """Read as a reminder, checked as a shape: labels are plain, non-empty text."""
    for sdk in list_sdks():
        assert sdk.label and "\n" not in sdk.label
    for kind in list_kinds():
        assert kind.label and "\n" not in kind.label
        for field in kind.fields:
            assert field.key and field.label
            assert field.kind in ("url", "text", "textarea", "select", "env-var")


# ── Spec 43 §3 — the two routes that cost a live test to find ───


def test_the_claude_route_never_ends_in_v1() -> None:
    """The trap. The SDK appends `/v1/messages`, so a base ending in `/v1`
    produces `/v1/v1/messages` and a 404 that explains nothing."""
    cases: list[tuple[GatewayKind, dict[str, str]]] = [
        ("litellm", {"url": "http://localhost:24000"}),
        ("envoy", {"url": "http://localhost:26000"}),
        ("custom", {"claudeUrl": "http://localhost:9999"}),
    ]
    for kind, values in cases:
        route = build_routes(kind, values)["claude-agent"]
        assert route.base_url is not None
        assert not route.base_url.endswith("/v1"), f"{kind} would produce /v1/v1/messages"


def test_the_two_gateways_put_the_anthropic_route_at_different_depths() -> None:
    """Spec 43 §3 — LiteLLM serves it at the root, Envoy under a prefix.

    This is why a kind fills the route and the reviewer types only a host.
    """
    litellm = build_routes("litellm", {"url": "http://localhost:24000"})
    assert litellm["claude-agent"].base_url == "http://localhost:24000"
    assert litellm["codex"].base_url == "http://localhost:24000/v1"

    envoy = build_routes("envoy", {"url": "http://localhost:26000"})
    assert envoy["claude-agent"].base_url == "http://localhost:26000/anthropic"
    assert envoy["codex"].base_url == "http://localhost:26000/v1"


def test_a_field_default_fills_in_for_an_answer_the_host_did_not_send() -> None:
    """Envoy's prefixes are deployment configuration with the source's defaults.

    A host that pre-fills the form and one that sends only the host must build
    the same route, or the preview and the saved row disagree.
    """
    bare = build_routes("envoy", {"url": "http://localhost:26000"})
    filled = build_routes("envoy", {"url": "http://localhost:26000", "anthropicPrefix": "/anthropic"})
    assert bare == filled

    moved = build_routes("envoy", {"url": "http://localhost:26000", "anthropicPrefix": "/claude"})
    assert moved["claude-agent"].base_url == "http://localhost:26000/claude"


def test_litellm_names_a_variable_and_never_a_value() -> None:
    """§6.1 — an `environment` route stores the NAME. No key is ever in a route."""
    route = build_routes("litellm", {"url": "http://localhost:24000"})["claude-agent"]
    assert route.auth == "environment"
    assert route.credential_env == "AI_GATEWAY_KEY"

    named = build_routes("litellm", {"url": "http://x", "tokenEnv": "MY_KEY"})["claude-agent"]
    assert named.credential_env == "MY_KEY"


def test_no_kind_ships_unverified_any_more() -> None:
    """§2.3 — `unverified` is set until a kind is measured against a live server.

    Spec 43 milestone 3 measured Envoy on 2026-09-04: one real agent turn,
    thinking blocks across two round trips, a tool call landed and a write
    refused. LiteLLM was measured in milestone 0. So neither carries a marker.
    """
    for kind in ("original", "litellm", "envoy", "custom"):
        assert CATALOGUE[kind].unverified is None, kind


def test_the_envoy_claude_route_says_what_its_backend_must_be() -> None:
    """The deployment fact that decides whether an agent turn survives.

    Envoy's route is only half the answer: an OpenAI-schema backend translates
    the body on the way in and drops `thinking` blocks, so turn two fails the
    moment the assistant's own reply is sent back. Measured by getting it wrong
    first, which is exactly the kind of knowledge §2.3 says this table is for.
    """
    note = CATALOGUE["envoy"].routes["claude-agent"].note
    assert "schema: {name: Anthropic}" in note
    assert "thinking" in note


def test_a_custom_gateway_offers_only_the_sdks_it_was_given_a_url_for() -> None:
    """A route whose URL template resolved to nothing is left out, not invented."""
    routes = build_routes("custom", {"claudeUrl": "http://localhost:9999"})
    assert set(routes) == {"claude-agent"}
    assert build_routes("custom", {}) == {}


def test_a_gateway_that_offers_nothing_cannot_be_saved() -> None:
    errors = validate_gateway("custom", {})
    assert [error.key for error in errors] == ["kind"]
    assert "at least one URL" in errors[0].message


def test_a_host_is_required_where_a_kind_needs_one() -> None:
    for kind in ("litellm", "envoy"):
        assert [error.key for error in validate_gateway(kind, {})] == ["url"]


def test_a_bad_url_is_refused_with_the_field_it_belongs_to() -> None:
    """§3.1 — `validate_base_url`'s refusals, reported per field."""
    for value, fragment in (
        ("ftp://localhost:24000", "http:// or https://"),
        ("http://user:pw@localhost:24000", "username or a password"),
        ("http://localhost:24000?k=1", "query or a fragment"),
        ("not a url", "http:// or https://"),
    ):
        errors = validate_gateway("litellm", {"url": value})
        assert [error.key for error in errors] == ["url"], value
        assert fragment in errors[0].message, value


def test_a_trailing_slash_and_surrounding_space_build_the_same_route() -> None:
    tidy = build_routes("litellm", {"url": "http://localhost:24000"})
    messy = build_routes("litellm", {"url": "  http://localhost:24000/  "})
    assert tidy == messy


def test_every_sdk_declares_what_it_appends_so_verify_can_ask_for_it() -> None:
    """§2.4 — REX appends no suffix. This is the one place a suffix is written."""
    from agent_gateway.catalogue import APPENDS

    assert set(APPENDS) == set(ALL_SDKS)
    assert APPENDS["claude-agent"] == "/v1/messages"
    for kind in list_kinds():
        for sdk, note in kind.routes.items():
            # A route with no URL of its own addresses the SDK's endpoint, and
            # there is nothing on this host to ask about.
            assert (note.appends is None) == (note.base_url is None), f"{kind.id}/{sdk}"
