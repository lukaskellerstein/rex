"""The sentence a failed run puts on the reviewer's screen.

Ported case for case from REX's `test/errors.spec.ts` when spec 42 moved
`classifyError` and `deniedBy` into this package. One assertion changed and it
is called out where it happens: the version-gate hint names the **Python**
package now, because that is the one that carries the CLI.

This file exists because of two measured wrong diagnoses.

The first: a run failed and the report said "check that the claude executable is
installed and on PATH". The SDK ships and resolves its own binary and never
consults PATH — a query spawns normally under
`PATH=/usr/bin:/bin:/usr/sbin:/sbin` — so the sentence was false, and the SDK's
own words had been discarded to make room for it.

The second: a thread reported two DENIED steps in a session where the gate never
fired. Both were `zsh` errors, and `is_error` was the whole basis for the word.
A reader who trusts REX about its own gate then goes looking for a safety bug
that does not exist.

A wrong hint costs more than no hint: it is read as a diagnosis.
"""

import pytest

from agent_runner.adapters.claude.errors import classify_error, denied_by, route_hint
from agent_runner.events import Denial
from agent_runner.types import ResolvedRoute


@pytest.mark.parametrize(
    "text",
    [
        "Connection reset by peer",
        "model 'claude-nope' not found",
        "ENOENT: no such file or directory, open '/tmp/plan.json'",
        "Request timed out after 600000ms",
        "401 unauthorized",
    ],
)
def test_the_original_error_always_survives(text: str) -> None:
    assert text in classify_error(Exception(text)), f"REX must not speak in place of: {text}"


@pytest.mark.parametrize(
    "text",
    [
        "model 'claude-nope' not found",
        "ENOENT: no such file or directory, open '/tmp/plan.json'",
        "MCP server 'media-mcp' not found",
        "404 not found",
    ],
)
def test_an_unrelated_not_found_is_not_blamed_on_the_executable(text: str) -> None:
    """The regression itself.

    Each of these contains "not found" or "enoent" and none of them is about the
    executable, so none may be blamed on it.
    """
    message = classify_error(Exception(text))
    assert "executable" not in message, f"must not name the executable for: {text}"


@pytest.mark.parametrize(
    "text",
    [
        "Claude Code executable not found at /usr/local/bin/claude. Is options.pathToClaudeCodeExecutable set?",
        "Claude Code native binary not found at /Users/x/.local/bin/claude.",
        "spawn /Users/x/.local/bin/claude ENOENT",
    ],
)
def test_the_sdks_own_executable_failures_do_get_the_hint(text: str) -> None:
    message = classify_error(Exception(text))
    assert "could not be started" in message, f"must hint for: {text}"
    assert text in message, "and must still carry the SDK's own words"


@pytest.mark.parametrize("text", ["401 unauthorized", "invalid api_key", "authentication failed"])
def test_authentication_is_matched_on_a_word(text: str) -> None:
    assert "Authentication failed" in classify_error(Exception(text))


@pytest.mark.parametrize(
    "text",
    ["author of the commit is unknown", "unauthorised is spelled -ised here"],
)
def test_authentication_is_not_matched_on_the_letters_auth(text: str) -> None:
    """ "author" contains "auth", and the old substring test fired on it."""
    assert "Authentication failed" not in classify_error(Exception(text))


def test_a_timeout_is_still_recognised() -> None:
    assert "timed out" in classify_error(Exception("Request timed out after 600000ms"))


def test_a_thrown_non_exception_is_stringified_rather_than_dropped() -> None:
    assert "plain string failure" in classify_error("plain string failure")


# ── `denied_by` — refused, or merely failed ─────────────────────

GATE = "A read session cannot change any file, so Bash may not redirect — 'ls > out.txt'."
REFUSAL = [Denial(tool_name="Bash", reason=GATE)]


def test_the_gates_own_sentence_handed_back_by_the_sdk_is_a_refusal() -> None:
    assert denied_by(REFUSAL, "Bash", GATE) is True


def test_a_command_that_exited_non_zero_in_the_same_run_is_not() -> None:
    # The run really did have a refusal in it — that is the case that made the
    # old rule look right. Every other failure in it is still just a failure.
    assert denied_by(REFUSAL, "Bash", "Exit code 1\n(eval):1: == not found") is False
    assert denied_by(REFUSAL, "Bash", "Exit code 1\nls: docs/review: No such file or directory") is False


def test_a_refusal_recorded_for_one_tool_does_not_mark_anothers_failure() -> None:
    assert denied_by(REFUSAL, "Read", GATE) is False


def test_the_sdks_own_refusal_is_a_refusal_with_nothing_recorded_by_the_gate() -> None:
    assert denied_by([], "Bash", "Permission to use Bash with command find . -type f has been denied.") is True


def test_output_that_merely_quotes_that_sentence_is_not_a_refusal() -> None:
    """A `grep` of REX's own log does exactly this.

    Matched loosely, REX would report a gate that fired because somebody
    searched for the words.
    """
    assert (
        denied_by(
            [],
            "Bash",
            "Exit code 1\nrex.log:41:Permission to use Bash with command find . has been denied.",
        )
        is False
    )


def test_nothing_refused_and_nothing_quoted_is_simply_a_failure() -> None:
    assert denied_by([], "Bash", "Exit code 2\ngrep: docs: Is a directory") is False


# ── The bundled CLI is older than the model needs ───────────────
#
# The API's own message ends "Run `claude update`", which is the one instruction
# that cannot work here: the SDK resolves its own binary. The machine's Claude
# Code was 2.1.259 while REX's runs were on 2.1.237 — so following the advice
# would have changed nothing and looked like REX being broken.

VERSION_GATE = (
    "API Error: 400 Claude Code 2.1.237 does not support this model; version 2.1.251 or newer "
    "is required. Run 'claude update', or update the Claude desktop app, then try again."
)


def test_the_version_gate_names_both_versions_and_the_dependency_to_update() -> None:
    said = classify_error(Exception(VERSION_GATE))

    assert "2.1.237" in said, "the version that is actually running"
    assert "2.1.251" in said, "the version the model needs"
    # CHANGED FROM THE TYPESCRIPT ORIGINAL, which asserted
    # `@anthropic-ai/claude-agent-sdk`. Spec 42 moved the SDK into this package,
    # so the npm one is no longer installed anywhere and naming it would send
    # the reader after a dependency that does not exist — which is precisely the
    # class of false diagnosis this whole module exists to stop.
    assert "claude-agent-sdk" in said, "the thing to update is this package's dependency"
    assert "uv add" in said, "and it is updated with uv, never pip"
    assert VERSION_GATE in said, "and the API's own words survive, as ever"


def test_the_version_gate_contradicts_the_clis_own_advice_out_loud() -> None:
    said = classify_error(Exception(VERSION_GATE))
    # Not merely omitting it: the wrong instruction is still there, three lines
    # below, and a hint that ignores it leaves the reader to follow it.
    assert 'Ignore the "run claude update" advice' in said


@pytest.mark.parametrize(
    "text",
    [
        "API Error: 400 messages.0: all messages must have non-empty content",
        "400 model 'claude-nope' not found",
        "Claude Code 2.1.237 exited with code 1",
    ],
)
def test_it_does_not_fire_on_any_other_400(text: str) -> None:
    assert classify_error(Exception(text)).startswith("Agent error:"), f"REX must add no hint to: {text}"


# ── Spec 43 §9 — the hints that need a gateway to make sense ────


ROUTED_NONE = ResolvedRoute(
    sdk="claude-agent",
    gateway_name="Envoy",
    base_url="http://localhost:26334/anthropic",
    auth="none",
)
ROUTED_ENV = ResolvedRoute(
    sdk="claude-agent",
    gateway_name="LiteLLM",
    base_url="http://localhost:24000",
    auth="environment",
    token="a-test-value",
)
ORIGINAL = ResolvedRoute(sdk="claude-agent", gateway_name="Original", auth="inherit")


def test_a_401_through_a_gateway_never_says_claude_login() -> None:
    """The wrong instruction twice over, and it reached a reviewer's screen.

    Measured 2026-09-04: a gateway started without its engine's key answered
    `401 Not authenticated` on every route, and REX advised running
    `claude login` — a credential it never sends to a gateway, for an account
    that was not the one refusing.
    """
    for route in (ROUTED_NONE, ROUTED_ENV):
        hint = route_hint("API Error: 401 Not authenticated", route)
        assert hint is not None
        assert "claude login" in hint, "the reader must be told NOT to do the obvious thing"
        assert "Do not run" in hint
        assert route.gateway_name in hint
        assert "ANTHROPIC_API_KEY" not in hint


def test_the_401_hint_says_which_half_is_REXs_to_check() -> None:
    """`environment` means REX sent something; `none` means it sent nothing.

    Which half failed is the whole question, and the auth mode is the only part
    of it `ResolvedRoute` can answer — it carries the credential's value and
    never its name.
    """
    assert "check that value first" in (route_hint("401", ROUTED_ENV) or "")
    assert "no credential at all" in (route_hint("401", ROUTED_NONE) or "")


def test_the_official_endpoint_keeps_the_login_advice() -> None:
    """On `Original` a 401 IS the reviewer's own login, and the advice is right."""
    said = classify_error("API Error: 401 Not authenticated", ORIGINAL)
    assert "claude login" in said
    assert "ANTHROPIC_API_KEY" in said


def test_a_hint_never_reads_a_field_the_route_does_not_have() -> None:
    """Every hint runs against every shape of route, and none may throw.

    A hint that raises takes the run down with it, which is worse than the error
    it was trying to explain — and one did, on a field `ResolvedRoute` has never
    carried.
    """
    texts = [
        "API Error: 401 Not authenticated",
        "thinking.type: Input should be 'disabled' or 'enabled'",
        "messages.2.content.str: Input should be a valid string",
        "connection refused",
        "invalid model name passed in model=claude-opus-5",
        "404 not found",
        "something nobody has a hint for",
    ]
    for route in (ROUTED_NONE, ROUTED_ENV, ORIGINAL, None):
        for text in texts:
            route_hint(text, route)
            route_hint(text, route, "some-model")
