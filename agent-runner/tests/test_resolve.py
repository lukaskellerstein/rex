"""Spec 42 §5.3 — a route is resolved, or refused **by name**.

There is no silent fallback anywhere in this file, and that is the whole design:
a run that starts on the wrong endpoint, or with no credential, fails somewhere
inside an SDK where the message is about HTTP. Refusing here puts the sentence
where the reviewer can act on it.

`bridge.ts` carries the same rules in TypeScript, because it is the host that
holds the process environment. Both take the environment as an argument rather
than reading the process's, so a test can hand them a fake.
"""

import pytest

from agent_runner import ORIGINAL_GATEWAY, resolve_route, validate_base_url
from agent_runner.resolve import RouteError
from agent_runner.types import AgentGateway, GatewayRoute


def gateway_with(route: GatewayRoute) -> AgentGateway:
    return AgentGateway(id="g", name="Gateway", kind="litellm", routes={"claude-agent": route})


def test_the_original_gateway_resolves_to_no_url_and_no_token() -> None:
    resolved = resolve_route(ORIGINAL_GATEWAY, "claude-agent", {})
    assert resolved.sdk == "claude-agent"
    assert resolved.gateway_name == "Original"
    assert resolved.base_url is None
    assert resolved.auth == "inherit"
    assert resolved.token is None


def test_an_sdk_with_no_adapter_is_refused_by_name() -> None:
    with pytest.raises(RouteError, match="No adapter for 'opencode'"):
        resolve_route(ORIGINAL_GATEWAY, "opencode", {})


def test_the_sdk_spec_44_built_now_resolves() -> None:
    """The same call that was refused before the adapter existed."""
    route = resolve_route(ORIGINAL_GATEWAY, "codex", {})
    assert route.sdk == "codex"
    assert route.base_url is None
    assert route.token is None


def test_a_gateway_that_does_not_offer_the_sdk_is_refused_by_name() -> None:
    empty = AgentGateway(id="g", name="Gateway", kind="litellm", routes={})
    with pytest.raises(RouteError, match="does not offer claude-agent"):
        resolve_route(empty, "claude-agent", {})


def test_a_credential_is_read_from_the_environment_it_was_handed() -> None:
    gateway = gateway_with(GatewayRoute(base_url="http://localhost:24000", auth="environment", credential_env="KEY"))
    resolved = resolve_route(gateway, "claude-agent", {"KEY": "secret"})
    assert resolved.token == "secret"
    assert resolved.base_url == "http://localhost:24000"


def test_a_route_that_needs_a_credential_and_names_no_variable_is_refused() -> None:
    gateway = gateway_with(GatewayRoute(auth="environment", credential_env=None))
    with pytest.raises(RouteError, match="names no variable"):
        resolve_route(gateway, "claude-agent", {})


@pytest.mark.parametrize("environment", [{}, {"KEY": ""}])
def test_an_unset_or_empty_variable_is_refused_by_name(environment: dict[str, str]) -> None:
    gateway = gateway_with(GatewayRoute(auth="environment", credential_env="KEY"))
    with pytest.raises(RouteError, match="needs KEY, and it is not set"):
        resolve_route(gateway, "claude-agent", environment)


def test_an_inherit_route_never_reads_the_environment() -> None:
    """`inherit` means the SDK's own login, so there is nothing to resolve."""
    gateway = gateway_with(GatewayRoute(auth="inherit", credential_env="KEY"))
    assert resolve_route(gateway, "claude-agent", {"KEY": "secret"}).token is None


# ── validate_base_url ───────────────────────────────────────────


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("http://localhost:24000", "http://localhost:24000"),
        ("https://gw.example.com/", "https://gw.example.com"),
        ("  https://gw.example.com/  ", "https://gw.example.com"),
        ("http://localhost:26000/anthropic", "http://localhost:26000/anthropic"),
    ],
)
def test_a_good_url_is_trimmed_and_otherwise_untouched(given: str, expected: str) -> None:
    """**No path is ever appended.** Appending one is spec 43's job."""
    assert validate_base_url(given) == expected


@pytest.mark.parametrize(
    "given",
    [
        "",
        "   ",
        "localhost:24000",
        "ftp://gw.example.com",
        "file:///etc/passwd",
        "http://user:pass@gw.example.com",
        "http://gw.example.com?key=secret",
        "http://gw.example.com#fragment",
    ],
)
def test_anything_that_is_not_a_plain_address_is_refused(given: str) -> None:
    with pytest.raises(RouteError):
        validate_base_url(given)
