"""Spec 43 §6 — the child environment, which is where a routing mistake becomes
a run against the wrong server.

Every test here is about one sentence in §6.2: **no adapter touches the process
environment.** Two comments can run at once on two different gateways, so an
environment is built per run, from the route it was handed, and nothing else.

Milestone 0 proved the same thing live on 2026-09-04: two concurrent runs, one
on `http://localhost:24000` and one on a dead port, each reached its own and
neither borrowed the other's.
"""

import os

from agent_gateway import ResolvedRoute
from agent_gateway.adapters.claude.adapter import ClaudeAdapter

ADAPTER = ClaudeAdapter()

ROUTED = ResolvedRoute(
    sdk="claude-agent",
    gateway_name="LiteLLM",
    base_url="http://localhost:24000",
    auth="environment",
    token="a-test-value",
)

ORIGINAL = ResolvedRoute(sdk="claude-agent", gateway_name="Original", auth="inherit")


def env(route: ResolvedRoute, model: str | None = None) -> dict[str, str]:
    return ADAPTER._env(route, model)  # noqa: SLF001 — the unit under test


def test_the_original_gateway_changes_nothing_at_all() -> None:
    """§6.3 — today's behaviour exactly, on the reviewer's own subscription."""
    assert env(ORIGINAL) == {}
    assert env(ORIGINAL, "claude-opus-5") == {}


def test_a_routed_run_names_the_base_url_and_the_timeout() -> None:
    values = env(ROUTED)
    assert values["ANTHROPIC_BASE_URL"] == "http://localhost:24000"
    # §7 — a local model's first token can be minutes away, and the SDK's own
    # default would kill the turn while the model was still reading the prompt.
    assert values["API_TIMEOUT_MS"] == "3600000"
    # §15 — a non-Anthropic backend does not implement the beta headers, and the
    # failure is a 400 from inside a paid turn.
    assert values["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] == "1"


def test_the_cloud_flags_are_emptied_rather_than_deleted() -> None:
    """§6.2 — `ClaudeAgentOptions.env` MERGES, and a merge cannot unset.

    An inherited Bedrock, Vertex or Foundry flag would re-route the run to a
    place the reviewer did not choose, and dropping the key from this dict would
    leave the inherited one standing.
    """
    values = env(ROUTED)
    for flag in ("CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"):
        assert values[flag] == ""


def test_all_three_model_slots_get_the_chosen_model() -> None:
    """§6.4 — leaving the background slot inherited turns one local-model choice
    into an unnoticed cloud request, and an unset slot sends a real Claude id
    that the gateway answers `Invalid model name passed in model=claude-…`."""
    values = env(ROUTED, "unsloth-26b")
    assert values["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "unsloth-26b"
    assert values["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "unsloth-26b"
    assert values["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "unsloth-26b"


def test_the_word_default_is_not_a_model_and_fills_no_slot() -> None:
    """`default` MEANS "REX says nothing", so it is not sent as an id."""
    assert "ANTHROPIC_DEFAULT_SONNET_MODEL" not in env(ROUTED, "default")
    assert "ANTHROPIC_DEFAULT_SONNET_MODEL" not in env(ROUTED, None)


def test_both_credential_variables_get_the_same_value_and_neither_is_empty() -> None:
    """§6.3 — `ANTHROPIC_AUTH_TOKEN` becomes `Authorization: Bearer` and
    `ANTHROPIC_API_KEY` becomes `x-api-key`, and which one is read has moved
    between versions. An empty string is not an unset variable to every client,
    so neither is ever set to one."""
    values = env(ROUTED)
    assert values["ANTHROPIC_AUTH_TOKEN"] == "a-test-value"
    assert values["ANTHROPIC_API_KEY"] == "a-test-value"


def test_a_no_authentication_route_sends_a_sentinel_and_not_an_empty_value() -> None:
    """The bundled client expects a value even when the server ignores it.
    Envoy checks no caller key at all, so this is the auth its route will use."""
    local = ResolvedRoute(
        sdk="claude-agent",
        gateway_name="Envoy",
        base_url="http://localhost:26000/anthropic",
        auth="none",
    )
    values = env(local)
    assert values["ANTHROPIC_AUTH_TOKEN"] == "rex-local"
    assert values["ANTHROPIC_API_KEY"] == "rex-local"
    assert "sk-" not in values["ANTHROPIC_API_KEY"]


def test_an_inherit_route_with_a_url_supplies_no_credential() -> None:
    """`inherit` MEANS "give no gateway credential" — even through a gateway."""
    custom = ResolvedRoute(
        sdk="claude-agent",
        gateway_name="Custom",
        base_url="http://localhost:9999",
        auth="inherit",
    )
    values = env(custom)
    assert values["ANTHROPIC_BASE_URL"] == "http://localhost:9999"
    assert "ANTHROPIC_AUTH_TOKEN" not in values
    assert "ANTHROPIC_API_KEY" not in values


def test_building_an_environment_never_touches_the_process_environment() -> None:
    """§6.2 — the whole reason this is a returned dict and not an assignment."""
    before = dict(os.environ)
    env(ROUTED, "unsloth-26b")
    env(ORIGINAL)
    assert dict(os.environ) == before


def test_two_routes_built_in_one_breath_do_not_share_a_dict() -> None:
    """Two comments can run at once on two gateways. If these were one object,
    one of them would be routed by the other's answer."""
    first = env(ROUTED, "unsloth-26b")
    second = env(
        ResolvedRoute(sdk="claude-agent", gateway_name="Other", base_url="http://localhost:26000", auth="none"),
        "lms-4b",
    )
    assert first["ANTHROPIC_BASE_URL"] == "http://localhost:24000"
    assert second["ANTHROPIC_BASE_URL"] == "http://localhost:26000"
    assert first["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "unsloth-26b"
    assert second["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "lms-4b"


def test_a_routed_run_refuses_to_start_without_the_credential_it_names() -> None:
    """The host resolves the variable; this is the backstop, and it names it."""
    starved = ROUTED.model_copy(update={"token": None})
    refusal = ADAPTER.validate(starved)
    assert refusal is not None
    assert "needs a credential" in refusal


def test_a_gateway_with_a_url_is_no_longer_refused() -> None:
    """Spec 42 refused one on purpose. This spec is what makes it work."""
    assert ADAPTER.validate(ROUTED) is None
    assert ADAPTER.validate(ORIGINAL) is None
