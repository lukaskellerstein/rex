"""Spec 46 §4.4 — the four rules, each asserted where it can actually break."""

from typing import Any

import pytest
import yaml

from local_gateway.config import ConfigRequest, ModelEntry, build, max_input_tokens, render
from local_gateway.types import OUTPUT_RESERVE


def _entry(**over) -> ModelEntry:
    base = {
        "alias": "lmstudio-google-gemma-4-e4b",
        "provider": "lmstudio",
        "model": "google/gemma-4-e4b",
        "url": "http://127.0.0.1:1234",
        "key_env": "REX_PROVIDER_LMSTUDIO",
        "context": 131072,
    }
    return ModelEntry(**{**base, **over})


# ── rule 1: every model names its key, and only ever names it ────


def test_every_model_names_its_key_explicitly() -> None:
    """A missing `api_key` lets LiteLLM fall back to an inherited OPENAI_API_KEY.

    That is not a tidiness point: it would send a paid request against a key the
    person never configured for REX, from a model they thought was local.
    """
    document = build(ConfigRequest(models=[_entry(), _entry(alias="b", provider="openai", url=None)]))
    for row in document["model_list"]:
        assert row["litellm_params"]["api_key"] == f"os.environ/{row['litellm_params']['api_key'].split('/')[-1]}"
        assert row["litellm_params"]["api_key"].startswith("os.environ/REX_PROVIDER_")


@pytest.mark.parametrize("bad", ["sk-a-real-key", "", "lowercase_name", "OTHER_VAR", "REX_PROVIDER_"])
def test_a_value_can_never_be_written_where_a_name_belongs(bad: str) -> None:
    """Rule 4, made structural. A value does not look like a name, so it is refused."""
    with pytest.raises(ValueError, match="credential reference"):
        build(ConfigRequest(models=[_entry(key_env=bad)]))


def test_no_secret_shaped_string_reaches_the_file() -> None:
    text = render(ConfigRequest(models=[_entry()]))
    assert "sk-" not in text
    assert "Bearer" not in text
    assert "REX_PROVIDER_LMSTUDIO" in text  # the NAME is there, and only the name


# ── rule 2: the line that makes the Claude SDK work ──────────────


def test_the_anthropic_bridge_setting_is_always_on() -> None:
    """Without it the Claude Agent SDK receives NO thinking blocks from an `openai/` provider.

    Global; there is no per-model override. It is therefore either in every
    config REX writes or in none, and this asserts which.
    """
    for request in (ConfigRequest(), ConfigRequest(models=[_entry()])):
        settings = build(request)["litellm_settings"]
        assert settings["use_chat_completions_url_for_anthropic_messages"] is True


# ── rule 3: the window is the provider's, or absent ──────────────


def test_the_window_is_the_providers_less_the_output_reserve() -> None:
    assert max_input_tokens(131072) == 122880  # the reviewer's own hand-written number
    assert max_input_tokens(262144) == 253952


def test_a_small_window_is_floored_at_half_rather_than_going_negative() -> None:
    assert max_input_tokens(8192) == 4096
    assert max_input_tokens(1024) == 512


def test_a_provider_that_states_no_window_gets_no_limit() -> None:
    """§17 — REX writes no limit it was not told.

    A limit REX invented is wrong the day the vendor changes it, and the
    truncation it causes reads as REX losing part of the prompt.
    """
    assert max_input_tokens(None) is None
    row = build(ConfigRequest(models=[_entry(provider="openai", url=None, context=None)]))["model_list"][0]
    assert "model_info" not in row


def test_a_stated_window_reaches_the_file() -> None:
    row = build(ConfigRequest(models=[_entry()]))["model_list"][0]
    assert row["model_info"] == {"max_input_tokens": 122880, "max_output_tokens": OUTPUT_RESERVE}


# ── the rest of the document ─────────────────────────────────────


def test_the_provider_prefix_and_base_come_from_the_catalogue() -> None:
    row = build(ConfigRequest(models=[_entry()]))["model_list"][0]
    assert row["litellm_params"]["model"] == "lm_studio/google/gemma-4-e4b"
    assert row["litellm_params"]["api_base"] == "http://127.0.0.1:1234/v1"


def test_a_fixed_endpoint_provider_ignores_a_url() -> None:
    row = build(ConfigRequest(models=[_entry(provider="openai", model="gpt-5.4", url="http://nope")]))
    assert row["model_list"][0]["litellm_params"]["api_base"] == "https://api.openai.com/v1"


def test_a_local_turn_is_given_an_hour() -> None:
    """LiteLLM's 600 s default expires mid-prompt on a local model (spec 43 §7)."""
    row = build(ConfigRequest(models=[_entry()]))["model_list"][0]
    assert row["litellm_params"]["timeout"] == 3600


def test_the_traffic_callback_is_named_only_when_it_is_wanted() -> None:
    assert "callbacks" in build(ConfigRequest(models=[_entry()], traffic=True))["litellm_settings"]
    assert "callbacks" not in build(ConfigRequest(models=[_entry()], traffic=False))["litellm_settings"]


def test_a_model_id_from_a_remote_server_cannot_rewrite_the_file() -> None:
    """§14 rule 6 — a remote string is data.

    Rendered through `yaml.safe_dump`, so a name carrying a newline, a `#` or a
    quote lands as one scalar rather than as new keys. Hand-rendered YAML is
    where this goes wrong, and the reference implementation hand-rendered.
    """
    hostile = "evil\nmodel_list:\n- model_name: injected #"
    text = render(ConfigRequest(models=[_entry(model=hostile)]))
    # Narrowed by assertion rather than annotation. `safe_load` can answer a
    # list or None, and both are exactly what a successful injection would
    # produce — so checking the shape IS part of the test, not ceremony.
    document = yaml.safe_load(text)
    assert isinstance(document, dict)
    rows: Any = document["model_list"]
    assert isinstance(rows, list)
    assert len(rows) == 1
    assert rows[0]["litellm_params"]["model"] == f"lm_studio/{hostile}"


def test_the_file_says_it_is_generated() -> None:
    text = render(ConfigRequest())
    assert text.splitlines()[0].startswith("# Written by REX")
    assert yaml.safe_load(text) is not None
