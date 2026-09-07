"""Spec 46 §5.3 and §5.5 — what each probe reads, and what it refuses to guess.

Every probe is driven against a recorded answer rather than a live engine: the
answers below are what these providers really said on 2026-09-06, so the test is
about the parsing and never about what happens to be running.
"""

from typing import Any

import pytest

from local_gateway.probes import lmstudio, ollama, shared, unsloth

# ── recorded answers, 2026-09-06 ─────────────────────────────────

LMSTUDIO_BODY = {
    "data": [
        {
            "id": "google/gemma-4-e4b",
            "type": "vlm",
            "state": "loaded",
            "max_context_length": 131072,
            "quantization": "4bit",
            "capabilities": ["tool_use"],
        },
        {
            "id": "text-embedding-nomic-embed-text-v1.5",
            "type": "embeddings",
            "state": "not-loaded",
            "max_context_length": 2048,
            "quantization": "Q4_K_M",
        },
    ]
}

OLLAMA_TAGS = {
    "models": [
        {
            "name": "gemma4:26b",
            "capabilities": ["completion", "tools", "thinking"],
            "details": {"context_length": 262144, "quantization_level": "Q4_K_M"},
        },
        # The row that forces the second call: no `details.context_length`.
        {
            "name": "gemma4:latest",
            "capabilities": ["completion", "tools"],
            "details": {"quantization_level": "Q4_K_M"},
        },
    ]
}

OLLAMA_SHOW = {"model_info": {"gemma4.context_length": 131072, "general.architecture": "gemma4"}}

UNSLOTH_BODY = {
    "data": [
        {"id": "unsloth/gemma-4-26b", "quant": "Q4_K_M", "loaded": True, "context_length": 131072},
        {"id": "unsloth/gemma-4-31b", "quant": "Q4_K_M", "loaded": False, "context_length": None},
    ]
}

OPENAI_BODY = {"data": [{"id": "gpt-5.4", "object": "model"}, {"id": "gpt-5.4-mini", "object": "model"}]}


@pytest.fixture
def answers(monkeypatch):
    """Replace the one HTTP call every probe makes, and record what was asked."""
    asked: list[tuple[str, dict, Any]] = []
    replies: dict[str, dict] = {}

    def fake(url: str, headers: dict[str, str], payload: dict | None = None) -> dict:
        asked.append((url, headers, payload))
        for fragment, body in replies.items():
            if fragment in url:
                return body
        raise AssertionError(f"nothing recorded for {url}")

    import local_gateway.probes as probes

    monkeypatch.setattr(probes, "get_json", fake)
    return asked, replies


# ── LM Studio: the only provider that states tool support ────────


def test_lmstudio_is_asked_its_own_richer_listing(answers) -> None:
    asked, replies = answers
    replies["/api/v0/models"] = LMSTUDIO_BODY
    lmstudio.probe("lmstudio", "http://127.0.0.1:1234", None)
    assert asked[0][0] == "http://127.0.0.1:1234/api/v0/models"


def test_lmstudio_reports_the_window_the_kind_and_the_tools(answers) -> None:
    _, replies = answers
    replies["/api/v0/models"] = LMSTUDIO_BODY
    models = lmstudio.probe("lmstudio", "http://127.0.0.1:1234", None)
    chat = models[0]
    assert chat.id == "google/gemma-4-e4b"
    assert chat.context == 131072
    assert chat.kind == "chat"  # `vlm` is a vision-capable llm, still a chat route
    assert chat.tools is True


def test_lmstudio_names_an_embedding_model_as_one(answers) -> None:
    """§5.5 — LM Studio's `type` names them, so REX does not have to guess by name."""
    _, replies = answers
    replies["/api/v0/models"] = LMSTUDIO_BODY
    assert lmstudio.probe("lmstudio", "http://127.0.0.1:1234", None)[1].kind == "embedding"


# ── Ollama: the two-call path §5.2 exists for ────────────────────


def test_ollama_asks_a_second_time_only_for_a_row_that_omits_its_window(answers) -> None:
    asked, replies = answers
    replies["/api/tags"] = OLLAMA_TAGS
    replies["/api/show"] = OLLAMA_SHOW
    models = ollama.probe("ollama", "http://127.0.0.1:11434", None)

    shows = [call for call in asked if "/api/show" in call[0]]
    assert len(shows) == 1, "only the row with no context_length needs the second call"
    assert shows[0][2] == {"model": "gemma4:latest"}
    assert models[0].context == 262144  # read from /api/tags
    assert models[1].context == 131072  # read from /api/show


def test_ollama_finds_the_window_under_whatever_architecture_names_it(answers) -> None:
    """`/api/show` files it as `<architecture>.context_length`, so it must be found."""
    _, replies = answers
    replies["/api/tags"] = {"models": [{"name": "nomic-embed-text", "capabilities": ["embedding"], "details": {}}]}
    replies["/api/show"] = {"model_info": {"nomic-bert.context_length": 2048}}
    models = ollama.probe("ollama", "http://127.0.0.1:11434", None)
    assert models[0].context == 2048
    assert models[0].kind == "embedding"


def test_one_model_that_will_not_describe_itself_does_not_cost_the_listing(answers, monkeypatch) -> None:
    _, replies = answers
    replies["/api/tags"] = OLLAMA_TAGS

    import local_gateway.probes as probes

    original = probes.get_json

    def sometimes(url: str, headers: dict, payload: dict | None = None) -> dict:
        if "/api/show" in url:
            raise OSError("connection reset")
        return original(url, headers, payload)

    monkeypatch.setattr(probes, "get_json", sometimes)
    models = ollama.probe("ollama", "http://127.0.0.1:11434", None)
    assert len(models) == 2
    assert models[1].context is None  # the honest record of "it did not say"


# ── Unsloth: the window for the loaded model only ────────────────


def test_unsloth_reads_a_window_when_it_is_there_and_leaves_it_out_when_it_is_not(answers) -> None:
    _, replies = answers
    replies["/v1/models"] = UNSLOTH_BODY
    models = unsloth.probe("unsloth", "http://127.0.0.1:8888", None)
    assert models[0].context == 131072
    assert models[1].context is None


def test_unsloth_never_guesses_the_kind_from_a_name(answers) -> None:
    """§5.5 — the reference implementation guessed; REX does not.

    A chat model with "embed" in its name would be classified wrongly, and the
    failure is a send that does nothing. `unknown` is honest, and an embedding
    model added by hand fails with the gateway's own error.
    """
    _, replies = answers
    replies["/v1/models"] = {"data": [{"id": "some-embed-model", "quant": "Q8_0", "loaded": False}]}
    assert unsloth.probe("unsloth", "http://127.0.0.1:8888", None)[0].kind == "unknown"


def test_unsloth_sends_its_key_as_a_bearer_token(answers) -> None:
    asked, replies = answers
    replies["/v1/models"] = UNSLOTH_BODY
    unsloth.probe("unsloth", "http://127.0.0.1:8888", "sk-unsloth")
    assert asked[0][1]["Authorization"] == "Bearer sk-unsloth"


# ── the shared probe, and the header that is data ────────────────


def test_the_shared_probe_lists_ids_and_states_no_window(answers) -> None:
    """§17 — OpenAI, OpenRouter and Anthropic state no limits, so REX writes none."""
    _, replies = answers
    replies["/models"] = OPENAI_BODY
    models = shared("openai", None, "sk-openai")
    assert [model.id for model in models] == ["gpt-5.4", "gpt-5.4-mini"]
    assert all(model.context is None and model.tools is None for model in models)


def test_anthropic_is_addressed_the_way_anthropic_wants_without_its_own_function(answers) -> None:
    """The whole reason three providers share one probe: they differ in a header, and it is data."""
    asked, replies = answers
    replies["/models"] = OPENAI_BODY
    shared("anthropic", None, "sk-ant")
    url, headers, _ = asked[0]
    assert url == "https://api.anthropic.com/v1/models"
    assert headers["x-api-key"] == "sk-ant"
    assert headers["anthropic-version"] == "2023-06-01"
    assert "Authorization" not in headers


def test_a_provider_that_needs_no_key_is_sent_none(answers) -> None:
    asked, replies = answers
    replies["/api/v0/models"] = LMSTUDIO_BODY
    lmstudio.probe("lmstudio", "http://127.0.0.1:1234", "ignored")
    assert "Authorization" not in asked[0][1]
