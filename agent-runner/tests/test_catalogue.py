"""Spec 42 §10 — the descriptor is data, and every kind fills every route it names.

The warning in `catalogue.py` is the thing worth testing: **every string a host
renders comes from the library's own source.** A label a remote server could set
is a remote server writing the host's interface, so nothing here may be built
from a response.
"""

from typing import cast

from agent_runner import list_kinds, list_sdks
from agent_runner.adapters import ADAPTERS
from agent_runner.catalogue import BUILTIN_KEY_VAR, BUILTIN_PORT, CATALOGUE
from agent_runner.describe import build_routes, substitute, validate_gateway
from agent_runner.types import ALL_SDKS, GatewayKind


def test_only_sdks_with_an_adapter_are_offered() -> None:
    """A choice a host offers must not fail after the reviewer has made it."""
    offered = [sdk.id for sdk in list_sdks()]
    assert offered == [sdk for sdk in ALL_SDKS if sdk in ADAPTERS]
    assert offered == ["claude-agent", "codex"], "spec 42 built one adapter, spec 44 the second"


def test_the_declared_vocabulary_is_wider_than_what_is_built() -> None:
    """Specs 47 and 48 add an adapter and change no type."""
    assert set(ALL_SDKS) - set(ADAPTERS) == {"opencode", "deep-agents"}


def test_the_second_adapter_added_a_control_and_no_type() -> None:
    """Spec 44 §2 — `AgentSdk` already carried `codex`, so nothing moved.

    The claim worth asserting is that the vocabulary did not grow when the
    adapter landed: a spec that has to widen a type to add an SDK has a seam
    that does not hold.
    """
    assert ALL_SDKS == ("claude-agent", "codex", "opencode", "deep-agents")
    assert "codex" in CATALOGUE["litellm"].routes
    assert "codex" in CATALOGUE["builtin"].routes
    assert "codex" in CATALOGUE["original"].routes


def test_spec_43_adds_three_kinds_and_spec_46_adds_the_builtin() -> None:
    """Spec 42 shipped `original` alone; 43 filled `GatewayKind`; 46 added `builtin`.

    `builtin` sits second because that is the order the Settings screen draws
    them (§8): the reviewer's own login, then REX's own gateway, then whatever
    somebody else runs. `envoy` and `custom` LEFT in spec 46 milestone 3 —
    §1.1's measurement decided it, and §3 is the rule: **REX supports exactly
    one gateway product**, because two products mean two sets of conventions.
    """
    assert [kind.id for kind in list_kinds()] == ["original", "builtin", "litellm"]


def test_the_builtin_and_the_external_litellm_share_every_route_template() -> None:
    """Spec 46 §3 — they are the same product, so a route difference is a bug.

    The only thing that differs is who runs the process and who owns the
    configuration, and neither of those is a route. If these ever diverge, one
    of the two is being configured against a shape LiteLLM does not have.
    """
    builtin = CATALOGUE["builtin"].routes
    external = CATALOGUE["litellm"].routes
    assert set(builtin) == set(external)
    for sdk, note in builtin.items():
        assert note.base_url == external[sdk].base_url, sdk
        assert note.appends == external[sdk].appends, sdk
        assert note.protocol == external[sdk].protocol, sdk


def test_the_builtin_asks_the_reviewer_for_nothing_it_owns() -> None:
    """§4.1 — REX creates this row, REX addresses it, and a person never types a URL.

    The `url` field exists so `build_routes` has something to substitute, and it
    carries a default so a route can be built before the child has ever run.
    §4.2.1 then rewrites all four with the port the child really got.
    """
    fields = {field.key: field for field in CATALOGUE["builtin"].fields}
    assert set(fields) == {"url"}
    assert fields["url"].default == f"http://127.0.0.1:{BUILTIN_PORT}"
    assert not fields["url"].required


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
            assert field.kind in ("url", "text", "textarea", "select", "env-var", "password")


# ── Spec 43 §3 — the two routes that cost a live test to find ───


def test_the_claude_route_never_ends_in_v1() -> None:
    """The trap. The SDK appends `/v1/messages`, so a base ending in `/v1`
    produces `/v1/v1/messages` and a 404 that explains nothing."""
    cases: list[tuple[GatewayKind, dict[str, str]]] = [
        ("litellm", {"url": "http://localhost:4000", "key": "sk-x"}),
        ("builtin", {"url": "http://127.0.0.1:24334"}),
    ]
    for kind, values in cases:
        route = build_routes(kind, values)["claude-agent"]
        assert route.base_url is not None
        assert not route.base_url.endswith("/v1"), f"{kind} would produce /v1/v1/messages"


def test_the_anthropic_route_is_at_the_root_and_the_rest_under_v1() -> None:
    """Spec 43 §3 — LiteLLM serves Anthropic Messages at the ROOT.

    This is why a kind fills the route and the reviewer types only a host: the
    Claude SDK appends `/v1/messages` itself, and a base ending in `/v1`
    produces `/v1/v1/messages` and a 404 explaining nothing.
    """
    both: list[tuple[GatewayKind, dict[str, str]]] = [
        ("litellm", {"url": "http://localhost:4000", "key": "sk-x"}),
        ("builtin", {"url": "http://127.0.0.1:24334"}),
    ]
    for kind, values in both:
        routes = build_routes(kind, values)
        host = values["url"]
        assert routes["claude-agent"].base_url == host, kind
        assert routes["codex"].base_url == f"{host}/v1", kind


def test_a_field_default_fills_in_for_an_answer_the_host_did_not_send() -> None:
    """A host that sends nothing and one that sends the default must agree.

    Otherwise the preview and the saved row disagree, which is the class of bug
    that only shows up after somebody saves.
    """
    bare = build_routes("builtin", {})
    filled = build_routes("builtin", {"url": f"http://127.0.0.1:{BUILTIN_PORT}"})
    assert bare == filled


def test_litellm_stores_its_key_and_never_names_a_variable() -> None:
    """Spec 46 §7 — the REVERSAL of spec 43 §6.1, and the reason for it.

    Spec 43 stored the NAME of an environment variable and deliberately added
    no keychain. A person installing REX has no `direnv` and no `~/.secrets`,
    so `stored` is what makes an external gateway configurable by a person
    rather than by a shell. **The route still holds no value** — the host keeps
    the ciphertext and decrypts it into `ResolvedRoute.token` before a run.
    """
    route = build_routes("litellm", {"url": "http://localhost:4000", "key": "sk-x"})["claude-agent"]
    assert route.auth == "stored"
    assert route.credential_env is None
    # The key the host answered with reaches no route field at all.
    assert "sk-x" not in route.model_dump_json()


def test_the_builtin_key_lives_in_an_environment_and_nowhere_else() -> None:
    """§7.1 — random per launch, so there is no file for it to leak from."""
    route = build_routes("builtin", {})["claude-agent"]
    assert route.auth == "environment"
    assert route.credential_env == BUILTIN_KEY_VAR


def test_no_kind_ships_unverified_any_more() -> None:
    """§2.3 — `unverified` is set until a kind is measured against a live server.

    Spec 43 milestone 3 measured Envoy on 2026-09-04: one real agent turn,
    thinking blocks across two round trips, a tool call landed and a write
    refused. LiteLLM was measured in milestone 0. So neither carries a marker.
    """
    for kind in ("original", "builtin", "litellm"):
        assert CATALOGUE[kind].unverified is None, kind


def test_an_external_litellm_needs_both_a_host_and_a_key() -> None:
    """§6 — "an external LiteLLM needs its master key before it will say anything".

    The reviewer's own on 24000 answers 401 at `/v1/models` AND at
    `/model/info`, so a gateway saved without one cannot even be asked what it
    serves. Refusing at save time is what turns that into a sentence rather
    than an empty model list.
    """
    assert [error.key for error in validate_gateway("litellm", {})] == ["url", "key"]
    assert [error.key for error in validate_gateway("litellm", {"url": "http://x:4000"})] == ["key"]
    assert validate_gateway("litellm", {"url": "http://x:4000", "key": "sk-x"}) == []


def test_a_bad_url_is_refused_with_the_field_it_belongs_to() -> None:
    """§3.1 — `validate_base_url`'s refusals, reported per field."""
    for value, fragment in (
        ("ftp://localhost:24000", "http:// or https://"),
        ("http://user:pw@localhost:24000", "username or a password"),
        ("http://localhost:24000?k=1", "query or a fragment"),
        ("not a url", "http:// or https://"),
    ):
        # The key is supplied, so the only complaint left is about the URL.
        errors = validate_gateway("litellm", {"url": value, "key": "sk-x"})
        assert [error.key for error in errors] == ["url"], value
        assert fragment in errors[0].message, value


def test_a_trailing_slash_and_surrounding_space_build_the_same_route() -> None:
    tidy = build_routes("litellm", {"url": "http://localhost:24000"})
    messy = build_routes("litellm", {"url": "  http://localhost:24000/  "})
    assert tidy == messy


def test_every_sdk_declares_what_it_appends_so_verify_can_ask_for_it() -> None:
    """§2.4 — REX appends no suffix. This is the one place a suffix is written."""
    from agent_runner.catalogue import APPENDS

    assert set(APPENDS) == set(ALL_SDKS)
    assert APPENDS["claude-agent"] == "/v1/messages"
    for kind in list_kinds():
        for sdk, note in kind.routes.items():
            # A route with no URL of its own addresses the SDK's endpoint, and
            # there is nothing on this host to ask about.
            assert (note.appends is None) == (note.base_url is None), f"{kind.id}/{sdk}"
