"""Spec 44 §5, §5.1, §6, §7 and §9 — everything the Codex adapter decides
before a child is spawned.

No CLI runs here. What is asserted is the configuration a run would be started
with, because that configuration **is** the safety story: the sandbox is the
primary boundary (§9.2), and a sandbox built from the wrong directory is a
boundary that is not there.
"""

import asyncio
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import pytest
from openai_codex import Sandbox

from agent_runner.adapters.codex.adapter import (
    PROVIDER_ID,
    ROUTED_CONTEXT_WINDOW,
    TOKEN_VARIABLE,
    CodexAdapter,
    ask_scratch,
    discard_ask_scratch,
    rex_codex_home,
)
from agent_runner.adapters.codex.errors import route_hint
from agent_runner.events import Denial, RunResult
from agent_runner.policy import ToolCall
from agent_runner.types import NewSession, ResolvedRoute, RunRequest

ADAPTER = CodexAdapter()

ORIGINAL = ResolvedRoute(sdk="codex", gateway_name="Original")
KEYED = ResolvedRoute(
    sdk="codex",
    gateway_name="LiteLLM",
    base_url="http://localhost:24000/v1",
    auth="environment",
    token="sk-secret",
)
OPEN = ResolvedRoute(sdk="codex", gateway_name="Envoy", base_url="http://localhost:26334/v1", auth="none")


def _request(**overrides: object) -> RunRequest:
    fields: dict[str, object] = {
        "run_id": "r1",
        "route": ORIGINAL,
        "cwd": "/repo",
        "prompt": "hello",
        "session": NewSession(),
        "disallowed": ["write", "edit"],
    }
    fields.update(overrides)
    return RunRequest.model_validate(fields)


# ── §5 — the provider ───────────────────────────────────────────


def test_a_route_with_no_url_defines_no_provider_at_all() -> None:
    """`Original` MEANS the Codex CLI's own endpoint on the reviewer's own login."""
    assert ADAPTER._provider(ORIGINAL) == {}


def test_a_keyed_route_names_the_variable_and_never_the_value() -> None:
    config = ADAPTER._provider(KEYED)
    provider = config["model_providers"][PROVIDER_ID]
    assert config["model_provider"] == PROVIDER_ID
    assert provider["base_url"] == "http://localhost:24000/v1"
    assert provider["wire_api"] == "responses"
    assert provider["env_key"] == TOKEN_VARIABLE
    assert "requires_openai_auth" not in provider
    assert "sk-secret" not in repr(config), "the credential never enters the config"


def test_an_unauthenticated_route_sends_no_credential_of_any_kind() -> None:
    provider = ADAPTER._provider(OPEN)["model_providers"][PROVIDER_ID]
    assert "env_key" not in provider
    assert "requires_openai_auth" not in provider


def test_the_two_authentication_flags_are_never_set_together() -> None:
    """§5 — set together, the CLI has two answers to one question."""
    inherited = ResolvedRoute(sdk="codex", gateway_name="Proxy", base_url="https://proxy.example/v1", auth="inherit")
    provider = ADAPTER._provider(inherited)["model_providers"][PROVIDER_ID]
    assert provider["requires_openai_auth"] is True
    assert "env_key" not in provider


# ── §5.1 — the child environment ────────────────────────────────


def test_the_credential_reaches_the_child_and_not_this_process() -> None:
    before = dict(os.environ)
    assert (ADAPTER._env(KEYED) or {})[TOKEN_VARIABLE] == "sk-secret"
    assert dict(os.environ) == before, "os.environ is never assigned"
    assert TOKEN_VARIABLE not in os.environ


def test_a_route_that_needs_no_credential_changes_nothing_about_the_environment() -> None:
    """`CodexConfig.env` is merged, so None is "inherit exactly what we have"."""
    assert ADAPTER._env(ORIGINAL) is None
    # A routed run without a credential still moves the Codex home (§7).
    assert ADAPTER._env(OPEN) == {"CODEX_HOME": str(rex_codex_home())}


# ── §6 and §9.2 — the sandbox ───────────────────────────────────


def test_a_read_run_can_reach_the_network_and_may_write_only_its_throwaway() -> None:
    """Spec 56 §3.1 — an ASK needs the web, and only `workspace_write` has a switch.

    Measured 2026-09-11 under `codex sandbox`: `network_access` beside
    `read_only` is ignored, and `workspace_write` makes `cwd` writable whatever
    `writable_roots` says. So the mode changes and the working directory moves
    onto something losing is free. What the reviewer owns is refused either way.
    """
    request = _request(run_id="sandbox-shape-under-test")
    sandbox, config, cwd = ADAPTER._sandbox(request)
    assert sandbox is Sandbox.workspace_write
    settings = config["sandbox_workspace_write"]
    assert settings["network_access"] is True, "an ASK that cannot fetch cannot check a citation"
    assert settings["writable_roots"] == [], "the throwaway cwd is the only writable path"
    assert settings["exclude_slash_tmp"] is True
    assert settings["exclude_tmpdir_env_var"] is True

    # The repository is NOT the working directory, which is the whole reason
    # this shape is safe: `cwd` is implicitly writable and must hold nothing.
    assert cwd != request.cwd
    assert Path(cwd).parent == Path.home() / ".rex" / "work" / "ask"
    assert Path(cwd).is_dir() and not any(Path(cwd).iterdir()), "born empty"
    discard_ask_scratch(cwd)


async def test_a_denial_is_recorded_and_emitted_and_does_not_end_the_run() -> None:
    """Spec 56 §3.4 — a refusal stops the command, not the run.

    Thread ef3df7aa, 2026-09-11: six good steps and the answer were discarded
    because the seventh call was denied. §9.2 is why that was always the wrong
    trade here — the sandbox has already refused the action by the time `_judge`
    is asked, so ending the turn buys nothing and loses the work.
    """
    events: list[object] = []
    denials: list[Denial] = []

    async def deny_everything(call: ToolCall) -> str:
        return f"no {call.name} in a read session"

    item = SimpleNamespace(type="commandExecution", command="curl -o x https://example.com")
    await ADAPTER._judge(item, deny_everything, events.append, denials)

    # Recorded for the host, drawn in the trace...
    assert [d.tool_name for d in denials] == ["command_execution"]
    assert [getattr(event, "type", "") for event in events] == ["denied"]
    # ...and nothing asks the caller to interrupt the turn.
    assert (await ADAPTER._judge(item, deny_everything, events.append, denials)) is None, (
        "a sentence here is what used to kill the run"
    )


def test_web_search_is_on_for_codex_own_endpoint_and_off_for_every_gateway() -> None:
    """Spec 56 §3.2 — the tool is hosted, so only an endpoint that runs it gets it.

    Measured 2026-09-11: `live` adds `{"type": "web_search",
    "external_web_access": true}` to the request. It carries no schema, so the
    model's server executes it. LM Studio accepted it, dropped it, and the model
    wrote a counterfeit tool call as prose — HTTP 200, no error. A routed run
    must therefore stay `disabled` and use the shell.
    """
    assert ADAPTER._config(_request(route=ORIGINAL), {})["web_search"] == "live"
    for route in (KEYED, OPEN):
        config = ADAPTER._config(_request(route=route), {})
        assert config["web_search"] == "disabled", f"{route.gateway_name} cannot run a hosted tool"


def test_the_throwaway_is_removed_and_nothing_else_ever_is() -> None:
    """The guard matters: this is called with whatever cwd the run had."""
    scratch = ask_scratch("run-under-test")
    (scratch / "left-behind.txt").write_text("scratch", encoding="utf8")
    discard_ask_scratch(str(scratch))
    assert not scratch.exists()

    # An ACT's cwd is one of the reviewer's working copies. It must survive.
    with TemporaryDirectory() as other:
        (Path(other) / "keep.md").write_text("a working copy", encoding="utf8")
        discard_ask_scratch(other)
        assert (Path(other) / "keep.md").exists()


def test_a_write_run_runs_in_the_first_working_copy_and_names_the_rest() -> None:
    """§9.3 — Codex makes `cwd` writable, so the child must not sit in the repository."""
    request = _request(disallowed=[], writable=["/work/a", "/work/b", "/work/c"])
    sandbox, config, cwd = ADAPTER._sandbox(request)
    assert sandbox is Sandbox.workspace_write
    assert cwd == "/work/a", "the repository would be writable if the child stayed in it"
    settings = config["sandbox_workspace_write"]
    assert settings["writable_roots"] == ["/work/b", "/work/c"]
    assert settings["network_access"] is False
    # Codex leaves /tmp writable by default, and a workspace under /tmp would
    # then be inside the sandbox without anybody having said so.
    assert settings["exclude_slash_tmp"] is True
    assert settings["exclude_tmpdir_env_var"] is True


def test_the_repository_is_never_among_the_writable_roots() -> None:
    request = _request(disallowed=[], writable=["/work/a", "/work/b"])
    _, config, cwd = ADAPTER._sandbox(request)
    everything = [cwd, *config["sandbox_workspace_write"]["writable_roots"]]
    assert request.cwd not in everything


async def test_a_write_run_with_nowhere_to_write_is_refused_before_anything_spawns() -> None:
    """Fails closed. Under `workspace_write` the fallback would be the repository."""
    events: list[object] = []
    result = await ADAPTER.run(
        _request(disallowed=[], writable=[]),
        events.append,
        _never_asked,
        asyncio.Event(),
    )
    assert isinstance(result, RunResult)
    assert result.error is not None
    assert "no writable directory" in result.error
    assert [getattr(event, "type", "") for event in events] == ["error"]


async def test_a_run_already_stopped_spawns_nothing_and_costs_nothing() -> None:
    stop = asyncio.Event()
    stop.set()
    events: list[object] = []
    result = await ADAPTER.run(_request(), events.append, _never_asked, stop)
    assert result.stopped is True
    assert result.error is None
    assert [getattr(event, "type", "") for event in events] == ["stopped"]


async def _never_asked(call: object) -> str | None:
    raise AssertionError(f"the policy was asked about {call} before a child existed")


# ── §5 and §7 — refusals and capabilities ───────────────────────


def test_another_sdks_route_is_refused_by_name() -> None:
    other = ResolvedRoute(sdk="claude-agent", gateway_name="Original")
    assert ADAPTER.validate(other) == "The Codex adapter cannot run a 'claude-agent' route."


def test_a_credential_that_was_never_resolved_is_refused_before_the_cli_sees_it() -> None:
    unresolved = ResolvedRoute(sdk="codex", gateway_name="LiteLLM", base_url="http://x/v1", auth="environment")
    assert "needs a credential" in (ADAPTER.validate(unresolved) or "")


def test_a_credential_with_no_url_is_refused_because_nothing_would_read_it() -> None:
    """§5.1 outcome 3, in the one shape that reaches it: `env_key` needs a provider."""
    homeless = ResolvedRoute(sdk="codex", gateway_name="Odd", auth="environment", token="sk-x")
    refusal = ADAPTER.validate(homeless) or ""
    assert "no URL" in refusal


def test_valid_routes_are_not_refused() -> None:
    assert ADAPTER.validate(ORIGINAL) is None
    assert ADAPTER.validate(KEYED) is None
    assert ADAPTER.validate(OPEN) is None


async def test_capabilities_answer_without_spending_anything() -> None:
    """§7 — no probe. There is no gateway-independent catalogue to ask for."""
    answer = await ADAPTER.capabilities(ORIGINAL, "/repo")
    assert answer.supports_styles is False
    assert answer.supports_plugins is False
    assert answer.supports_cost is False, "a Codex turn reports tokens and no dollar cost"
    assert answer.supports_ask is True
    assert answer.supports_resume is True
    assert [model.value for model in answer.models] == ["default"]


async def test_a_routed_gateway_offers_only_the_models_typed_into_it() -> None:
    """Spec 43 §4.3 — the host fills the picker from the route, not from a probe."""
    answer = await ADAPTER.capabilities(OPEN, "/repo")
    assert answer.models == []


async def test_act_is_offered_only_where_the_write_boundary_was_proved() -> None:
    """§9.3 — the sandbox is a different mechanism on each platform."""
    answer = await ADAPTER.capabilities(ORIGINAL, "/repo")
    assert answer.supports_act is (sys.platform == "darwin")
    if not answer.supports_act:
        assert "cannot make changes" in (answer.error or "")


async def test_a_route_that_cannot_run_offers_neither_ask_nor_act() -> None:
    broken = ResolvedRoute(sdk="codex", gateway_name="LiteLLM", base_url="http://x/v1", auth="environment")
    answer = await ADAPTER.capabilities(broken, "/repo")
    assert answer.supports_ask is False
    assert answer.supports_act is False
    assert "needs a credential" in (answer.error or "")


# ── §7 — what run() refuses on the library's behalf ─────────────


@pytest.mark.parametrize(
    ("field", "value", "phrase"),
    [("style", "explanatory", "output styles"), ("plugins", ["/tmp/p"], "cannot load plugins")],
)
async def test_a_capability_codex_does_not_have_is_refused_rather_than_ignored(
    field: str, value: object, phrase: str
) -> None:
    """§7 — a Claude style or plugin sent here is a rejection, never a silent drop."""
    from agent_runner.run import run

    events: list[object] = []
    result = await run(_request(**{field: value}), events.append, _never_asked, asyncio.Event())
    assert phrase in (result.error or "")


# ── §4.3 — a gateway routes on the model name ───────────────────


async def test_a_routed_run_with_no_model_is_refused_before_it_spawns() -> None:
    """Measured 2026-09-05: it reached Envoy and came back 404.

    `Default` in the picker means "REX says nothing", the host strips it to
    None, and the CLI then sends its OWN default id — a first-party name no
    local gateway serves. The reviewer paid a round trip to learn it, and the
    404 read as a broken address.
    """
    events: list[object] = []
    result = await ADAPTER.run(_request(route=OPEN, model=None), events.append, _never_asked, asyncio.Event())
    assert result.error is not None
    assert "routes on the model name" in result.error
    assert [getattr(event, "type", "") for event in events] == ["error"]


async def test_the_sdk_s_own_endpoint_needs_no_model_because_it_has_a_default() -> None:
    """`Original` is the opposite case, and why this is not "a model is required"."""
    stop = asyncio.Event()
    stop.set()
    result = await ADAPTER.run(_request(route=ORIGINAL, model=None), lambda _: None, _never_asked, stop)
    # Stopped rather than refused: it got past the model check to the stop check.
    assert result.stopped is True
    assert result.error is None


def test_a_gateway_that_does_not_serve_the_model_is_not_reported_as_a_bad_path() -> None:
    """Envoy says "No matching route found" and means the model.

    REX answered that with advice about `/v1/responses` — a hint that
    contradicted the error it sat above, and sent the reviewer to check a base
    URL that was correct.
    """
    envoy = (
        "unexpected status 404 Not Found: No matching route found. It is likely because the "
        "model specified in your request is not configured in the Gateway., "
        "url: http://localhost:26334/v1/responses"
    )
    named = route_hint(envoy, OPEN, "lms-26b") or ""
    assert "does not serve 'lms-26b'" in named
    assert "the address is fine" in named
    assert "/v1/responses" not in named

    unnamed = route_hint(envoy, OPEN, None) or ""
    assert "no particular model" in unnamed
    assert "MODELS FOR CODEX" in unnamed


def test_a_real_path_404_still_reports_a_path() -> None:
    """The other 404 has not been swallowed by the model one."""
    hint = route_hint("404 Not Found", OPEN, "lms-26b") or ""
    assert "serves no Responses endpoint" in hint


# ── §7 — the reviewer's own Codex toolbox is not REX's to hand over ──


def test_a_routed_run_is_given_rexs_own_codex_home() -> None:
    """Codex STARTS what `$CODEX_HOME/config.toml` lists, before a turn begins.

    Measured on this machine 2026-09-05: a REX Codex run spawned `node_repl` —
    a JavaScript interpreter — and two Playwright MCP browsers, out of eleven
    installed plugins. Moving the home took it from five processes to zero;
    neither `thread_start(config=…)` nor `config_overrides` did anything.
    """
    env = ADAPTER._env(OPEN) or {}
    assert env["CODEX_HOME"] == str(rex_codex_home())


def test_the_sdk_s_own_endpoint_keeps_the_reviewers_home_because_the_login_is_in_it() -> None:
    """`Original` means their account, and their account lives in `~/.codex`."""
    assert ADAPTER._env(ORIGINAL) is None


def test_a_keyed_route_carries_both_the_home_and_the_credential() -> None:
    env = ADAPTER._env(KEYED) or {}
    assert env[TOKEN_VARIABLE] == "sk-secret"
    assert env["CODEX_HOME"] == str(rex_codex_home())


def test_a_routed_run_tells_codex_how_big_the_window_is() -> None:
    """Left unset for an unknown model, Codex assumes a small one and compacts
    early — which reads as an agent forgetting things mid-thread."""
    assert ROUTED_CONTEXT_WINDOW == 122880
