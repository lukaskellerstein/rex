"""Spec 48 §4 — a route, as the chat model that answers it.

No network: a constructor either builds the right class with the right arguments
or it raises, and both are decided before a byte leaves the process. Criterion 11
is the one this file exists to keep — **no credential value outlives the run** —
and it is asserted by reading the client back rather than by trusting the call.
"""

from __future__ import annotations

import os

import pytest
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

from agent_runner.adapters.deep_agents.model import MAX_TOKENS, PLACEHOLDER_KEY, ModelError, build
from agent_runner.types import ResolvedRoute


def _openai(chat: object) -> ChatOpenAI:
    """`build` returns the base class, and these tests are about the concrete one."""
    assert isinstance(chat, ChatOpenAI)
    return chat


def _sent_key(chat: ChatOpenAI) -> str:
    """The credential this client will send, read back off the object.

    Through `getattr` because `openai_api_key` is an aliased pydantic field and a
    type checker resolves the class attribute to its validator rather than to a
    `SecretStr`. What criterion 11 is about is the VALUE, and this returns it.
    """
    secret = getattr(chat, "openai_api_key", None)
    assert secret is not None
    return str(secret.get_secret_value())


def _route(**overrides: object) -> ResolvedRoute:
    values: dict[str, object] = {
        "sdk": "deep-agents",
        "gateway_name": "REX built-in",
        "base_url": "http://127.0.0.1:24334/v1",
        "auth": "environment",
        "token": "sk-secret",
    }
    values.update(overrides)
    return ResolvedRoute.model_validate(values)


def test_a_gateway_is_the_openai_chat_protocol() -> None:
    """§4.1 — one class for both LiteLLM kinds, in the samples' own shape."""
    chat = _openai(build(_route(), "lmstudio-google-gemma-4-e4b"))
    assert chat.model_name == "lmstudio-google-gemma-4-e4b"
    assert str(chat.openai_api_base) == "http://127.0.0.1:24334/v1"
    assert chat.max_tokens == MAX_TOKENS


def test_a_streamed_run_asks_for_its_own_token_counts() -> None:
    """§12.4 item 5, measured: without `stream_usage` every `usage_metadata` is
    None, and `completed` would carry no tokens at all."""
    chat = _openai(build(_route(), "an-alias"))
    assert chat.streaming is True
    assert chat.stream_usage is True


def test_the_credential_reaches_the_client_and_nothing_else() -> None:
    """Criterion 11 — one client object, one run, and never `os.environ`."""
    before = dict(os.environ)
    chat = _openai(build(_route(token="sk-only-here"), "an-alias"))
    assert _sent_key(chat) == "sk-only-here"
    assert dict(os.environ) == before


def test_a_route_with_no_authentication_still_sends_a_string() -> None:
    """§4.3 — the client library refuses an empty key; the gateway ignores it."""
    chat = _openai(build(_route(auth="none", token=None), "an-alias"))
    assert _sent_key(chat) == PLACEHOLDER_KEY


def test_a_gateway_run_carries_the_thread_it_is_spending(monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec 45 §6 and criterion 13 — only ids, and only to a gateway."""
    chat = _openai(build(_route(), "an-alias", {"x-rex-thread": "t1", "x-rex-profile": "read"}))
    assert chat.default_headers == {"x-rex-thread": "t1", "x-rex-profile": "read"}


def test_original_sends_no_attribution_to_the_vendor() -> None:
    """REX's book-keeping is the gateway's business, and nobody else's."""
    chat = _openai(
        build(_route(base_url=None, auth="inherit", token="sk"), "openai:gpt-5.4-mini", {"x-rex-thread": "t1"})
    )
    assert not chat.default_headers


def test_a_gateway_with_no_model_is_refused_by_name() -> None:
    """A gateway ROUTES on the model name, so saying nothing is never a thing to say."""
    with pytest.raises(ModelError, match="routes on the model name"):
        build(_route(), None)


# ── §4.2 — `Original` ───────────────────────────────────────────


def test_original_builds_the_provider_the_model_id_names() -> None:
    anthropic = build(_route(base_url=None, auth="inherit", token="sk-ant"), "anthropic:claude-sonnet-5")
    assert isinstance(anthropic, ChatAnthropic)
    assert anthropic.model == "claude-sonnet-5"

    openai = _openai(build(_route(base_url=None, auth="inherit", token="sk-oai"), "openai:gpt-5.4-mini"))
    assert openai.model_name == "gpt-5.4-mini"
    assert openai.openai_api_base is None


def test_original_refuses_a_prefix_it_has_no_class_for() -> None:
    with pytest.raises(ModelError, match="names the provider itself"):
        build(_route(base_url=None, auth="inherit", token="k"), "unsloth:gemma-26b")
    with pytest.raises(ModelError, match="names the provider itself"):
        build(_route(base_url=None, auth="inherit", token="k"), "claude-sonnet-5")


def test_original_refuses_before_a_run_when_the_variable_is_unset() -> None:
    """§4.2 — LangChain has no login, so an unset key is a named refusal here
    rather than a 401 from inside a run the reviewer already paid to start."""
    with pytest.raises(ModelError, match="ANTHROPIC_API_KEY"):
        build(_route(base_url=None, auth="inherit", token=None), "anthropic:claude-sonnet-5")


def test_original_with_no_model_says_what_shape_one_takes() -> None:
    with pytest.raises(ModelError, match="provider:model"):
        build(_route(base_url=None, auth="inherit", token="k"), None)
