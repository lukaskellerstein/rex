"""Spec 61 §3 — every SDK's token counts arrive with one meaning.

`input_tokens` is every token the model read, the cache included, and the two
cache counts are parts of it. Anthropic and OpenCode leave the cache out of
their `input`, so their adapters add it back; LangChain already counts it in.
"""

from langchain_core.messages import AIMessage

from agent_runner.adapters.claude.adapter import _completed as claude_completed
from agent_runner.adapters.deep_agents.events import Translator
from agent_runner.adapters.opencode.adapter import _completed as opencode_completed


def test_claude_input_counts_the_cache() -> None:
    """The reviewer's database held a $2.26 Opus run reported as 40 tokens in."""
    completed = claude_completed(
        2.26,
        1200,
        {
            "input_tokens": 40,
            "cache_read_input_tokens": 410_000,
            "cache_creation_input_tokens": 22_000,
            "output_tokens": 27_924,
        },
    )
    assert completed.input_tokens == 432_040
    assert completed.output_tokens == 27_924
    assert completed.cache_read_tokens == 410_000
    assert completed.cache_write_tokens == 22_000


def test_claude_usage_without_counts_reports_none() -> None:
    completed = claude_completed(None, None, {})
    assert completed.input_tokens is None
    assert completed.output_tokens is None
    assert completed.cache_read_tokens is None
    assert completed.cache_write_tokens is None


def test_opencode_input_counts_the_cache() -> None:
    tokens = {"input": 120, "output": 45, "reasoning": 0, "cache": {"read": 9_000, "write": 300}}
    completed = opencode_completed(None, 800, tokens)
    assert completed.input_tokens == 9_420
    assert completed.output_tokens == 45
    assert completed.cache_read_tokens == 9_000
    assert completed.cache_write_tokens == 300


def test_opencode_without_a_cache_reports_none_for_it() -> None:
    completed = opencode_completed(None, 800, {"input": 120, "output": 45})
    assert completed.input_tokens == 120
    assert completed.cache_read_tokens is None
    assert completed.cache_write_tokens is None


def test_langchain_cache_is_summed_and_input_is_left_alone() -> None:
    translator = Translator({}, writes_allowed=False)
    for given, read in ((100, 60), (200, 150)):
        message = AIMessage(
            content="step",
            usage_metadata={
                "input_tokens": given,
                "output_tokens": 5,
                "total_tokens": given + 5,
                "input_token_details": {"cache_read": read},
            },
        )
        translator.updates({"model": {"messages": [message]}})
    assert translator.input_tokens == 300
    assert translator.cache_read_tokens == 210
    assert translator.cache_write_tokens is None
