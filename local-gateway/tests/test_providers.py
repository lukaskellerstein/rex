"""Spec 46 §5 and criterion A8 — adding a seventh provider is a row and at most one function.

The rule is only worth stating if something checks it, and what breaks it is
always the same thing: an `if provider ==` appearing in code that renders,
validates, builds a route or writes `config.yaml`. So that is asserted against
the source, not left to review.
"""

import ast
from pathlib import Path

import pytest

from local_gateway.probes import PROBES, probe_for, shared
from local_gateway.providers import CATALOGUE, api_base, descriptor

PACKAGE = Path(__file__).resolve().parent.parent / "src" / "local_gateway"

#: The files that must stay generic. `probes/` is exempt by design — it is the
#: one place a provider's own shape is allowed to live (§5.2).
GENERIC = ["config.py", "providers.py", "types.py", "__main__.py", "serve.py"]


def test_the_six_are_the_six() -> None:
    assert set(CATALOGUE) == {"lmstudio", "ollama", "unsloth", "openai", "openrouter", "anthropic"}


def test_every_descriptor_states_its_prefix_and_whether_it_costs_money() -> None:
    for provider, found in CATALOGUE.items():
        assert found.id == provider
        assert found.prefix.endswith("/"), f"{provider}'s prefix must be a LiteLLM provider prefix"
        assert found.note, f"{provider} needs a sentence for the Settings screen"
        assert isinstance(found.local, bool)


def test_the_three_paid_providers_are_the_ones_that_bill() -> None:
    """§5.4 — money is never discovered, so which side each provider is on matters."""
    paid = {name for name, found in CATALOGUE.items() if not found.local}
    assert paid == {"openai", "openrouter", "anthropic"}


def test_a_provider_with_a_fixed_endpoint_needs_no_address_from_a_person() -> None:
    for provider in ("openai", "openrouter", "anthropic"):
        assert api_base(provider, None) == CATALOGUE[provider].default_url
        assert not any(field.key == "url" for field in CATALOGUE[provider].fields)


def test_a_self_hosted_provider_asks_for_an_address_and_gets_v1_appended() -> None:
    for provider in ("lmstudio", "ollama", "unsloth"):
        assert any(field.key == "url" for field in CATALOGUE[provider].fields)
        assert api_base(provider, "http://127.0.0.1:9999") == "http://127.0.0.1:9999/v1"
        # Typed with the path already on it, which is spec 43 §3's trap. Not
        # doubled, because that produces a 404 explaining nothing.
        assert api_base(provider, "http://127.0.0.1:9999/v1") == "http://127.0.0.1:9999/v1"
        assert api_base(provider, "http://127.0.0.1:9999/") == "http://127.0.0.1:9999/v1"


def test_a_self_hosted_provider_with_no_address_is_refused_by_name() -> None:
    with pytest.raises(ValueError, match="LM Studio needs an address"):
        api_base("lmstudio", None)


def test_an_unknown_provider_is_refused_with_the_list_of_known_ones() -> None:
    with pytest.raises(ValueError, match="anthropic, lmstudio, ollama"):
        descriptor("nope")


# ── criterion A8 ─────────────────────────────────────────────────


def test_only_three_providers_need_a_function_of_their_own() -> None:
    """§5.3 — OpenAI, OpenRouter and Anthropic share `shared` and add no code.

    They differ in one header, and that header is data on the descriptor. That
    is the whole reason this rule holds rather than being aspirational.
    """
    assert set(PROBES) == {"lmstudio", "ollama", "unsloth"}
    for provider in ("openai", "openrouter", "anthropic"):
        assert probe_for(provider) is shared


def test_nothing_generic_branches_on_a_provider_id() -> None:
    """The rule that keeps a seventh provider to a row and a function.

    Looks for a comparison against any known provider id outside `probes/`. A
    lookup table keyed by id is fine and is what the package uses; a branch is
    what this refuses.
    """
    ids = set(CATALOGUE)
    for name in GENERIC:
        tree = ast.parse((PACKAGE / name).read_text(), filename=name)
        for node in ast.walk(tree):
            if isinstance(node, ast.Compare):
                for side in [node.left, *node.comparators]:
                    literal = getattr(side, "value", None)
                    assert literal not in ids, (
                        f"{name} compares against the provider id '{literal}'. "
                        "A provider's own shape belongs in probes/, never in code "
                        "that renders, validates or writes config (§5.2, A8)."
                    )
