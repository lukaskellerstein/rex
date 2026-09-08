"""Spec 48 — the adapter, driven end to end with a scripted model.

The model is scripted rather than mocked away: `create_deep_agent` really builds
the graph, the real `FilesystemBackend` really touches `tmp_path`, the real
middleware really runs, and the only thing replaced is the half that would cost
money and vary. So what these tests assert is the boundary and the event stream
as they actually behave, which is the whole point of §8.1 and §8.2.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from agent_runner.adapters.deep_agents import adapter as module
from agent_runner.adapters.deep_agents.adapter import TURN_OVERHEAD, TURN_STEPS, DeepAgentsAdapter
from agent_runner.events import AgentEvent
from agent_runner.policy import ToolCall
from agent_runner.types import ResolvedRoute, RunRequest, SeedSession


class Scripted(BaseChatModel):
    """A chat model that says exactly what the script says, in order.

    Out of script it repeats the last message, which is how a run that tries a
    refused tool more times than the script expects still ends rather than
    looping to the recursion limit.
    """

    script: list[AIMessage] = []
    calls: int = 0
    #: Set while a tool is running, so a stop can be timed against a real turn.
    slow: float = 0.0

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        index = min(self.calls, len(self.script) - 1)
        object.__setattr__(self, "calls", self.calls + 1)
        return ChatResult(generations=[ChatGeneration(message=self.script[index])])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        if self.slow:
            await asyncio.sleep(self.slow)
        return self._generate(messages, stop, None, **kwargs)


def call(name: str, args: dict[str, Any], call_id: str = "c1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


ANSWER = AIMessage(content="Revenue fell because two accounts churned.")


def route(**overrides: Any) -> ResolvedRoute:
    values: dict[str, Any] = {
        "sdk": "deep-agents",
        "gateway_name": "REX built-in",
        "base_url": "http://127.0.0.1:24334/v1",
        "auth": "environment",
        "token": "sk-secret",
    }
    values.update(overrides)
    return ResolvedRoute.model_validate(values)


def request(cwd: Path, **overrides: Any) -> RunRequest:
    values: dict[str, Any] = {
        "run_id": "run-1",
        "route": route(),
        "cwd": str(cwd),
        "prompt": "Why did revenue fall?",
        "session": SeedSession(id="seed-1"),
        "model": "an-alias",
        "system_prompt": "You are reviewing a document.",
        "disallowed": ["write", "edit", "shell"],
        "max_turns": 30,
    }
    values.update(overrides)
    return RunRequest.model_validate(values)


class Recorder:
    """One run's events, and the policy answers it was given."""

    def __init__(self, answer: str | None = None) -> None:
        self.events: list[AgentEvent] = []
        self.asked: list[ToolCall] = []
        self.answer = answer

    def emit(self, event: AgentEvent) -> None:
        self.events.append(event)

    async def ask(self, call: ToolCall) -> str | None:
        self.asked.append(call)
        return self.answer

    def kinds(self) -> list[str]:
        return [event.type for event in self.events]


async def drive(
    script: list[AIMessage],
    given: RunRequest,
    monkeypatch: pytest.MonkeyPatch,
    recorder: Recorder,
    stop: asyncio.Event | None = None,
    slow: float = 0.0,
) -> Any:
    monkeypatch.setattr(module.models, "build", lambda *_: Scripted(script=script, slow=slow))
    return await DeepAgentsAdapter().run(given, recorder.emit, recorder.ask, stop or asyncio.Event())


# ── validate ────────────────────────────────────────────────────


def test_a_route_for_another_sdk_is_refused() -> None:
    assert "cannot run a 'codex' route" in (DeepAgentsAdapter().validate(route(sdk="codex")) or "")


def test_a_url_plus_the_sdks_own_login_is_refused() -> None:
    """§4.3 — LangChain has no login, so `inherit` with a URL means nothing."""
    refusal = DeepAgentsAdapter().validate(route(auth="inherit", token=None))
    assert refusal is not None
    assert "LangChain has no login" in refusal


def test_a_credential_with_no_url_is_refused() -> None:
    refusal = DeepAgentsAdapter().validate(route(base_url=None))
    assert refusal is not None
    assert "only to a gateway it was given the address of" in refusal


def test_a_credential_route_with_nothing_resolved_is_refused() -> None:
    refusal = DeepAgentsAdapter().validate(route(token=None))
    assert refusal is not None
    assert "needs a credential" in refusal


def test_a_good_route_validates() -> None:
    assert DeepAgentsAdapter().validate(route()) is None
    assert DeepAgentsAdapter().validate(route(base_url=None, auth="inherit", token=None)) is None


# ── capabilities and sessions ───────────────────────────────────


async def test_capabilities_probes_nothing_and_offers_no_models() -> None:
    """§4.4 — the models are what Settings ticked or what the route lists."""
    found = await DeepAgentsAdapter().capabilities(route(), "/tmp")
    assert found.models == []
    assert found.supports_ask is True
    assert found.supports_act is True
    assert found.supports_resume is False
    assert found.supports_cost is False
    assert found.supports_styles is False
    assert found.supports_plugins is False
    assert found.error is None


async def test_a_broken_route_reports_its_sentence_rather_than_an_empty_picker() -> None:
    found = await DeepAgentsAdapter().capabilities(route(auth="inherit", token=None), "/tmp")
    assert found.supports_ask is False
    assert found.supports_act is False
    assert found.error is not None


async def test_there_are_no_sessions_and_it_says_so() -> None:
    """§7 — an `InMemorySaver` lives for one run, so every send replays."""
    state = await DeepAgentsAdapter().session_state(route(), "/tmp", "seed-1")
    assert state.exists is False
    assert state.path is None


# ── ASK ─────────────────────────────────────────────────────────


async def test_an_ask_reads_the_document_and_answers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    document = tmp_path / "report.md"
    document.write_text("Revenue fell 12% because two accounts churned.\n")
    recorder = Recorder()
    result = await drive(
        [call("read_file", {"file_path": str(document)}), ANSWER],
        request(tmp_path),
        monkeypatch,
        recorder,
    )
    assert recorder.kinds() == ["started", "tool_call", "tool_result", "text", "completed"]
    # Spec 50 §3.1 — assert the read WORKED, not merely that a result arrived.
    # A failed read produces the same five events, which is how a "not found"
    # about a file that was there went unnoticed through 42 green checks.
    read = next(event for event in recorder.events if event.type == "tool_result")
    assert read.is_error is False, read.text
    assert [ask.name for ask in recorder.asked] == ["read_file"]
    assert recorder.asked[0].common == "read"
    assert result.error is None
    assert result.stopped is False
    assert result.session_id == "seed-1"
    # §6 — LangChain reports tokens and never a price, and §7 rule 2 forbids
    # drawing $0.00 for a run whose SDK said nothing about money.
    assert result.cost_usd is None


async def test_an_ask_cannot_change_the_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """§8.1 and criterion 5 — one `denied` event, one `tool_result` marked denied,
    and the file untouched. Not an error, and not a silent no-op."""
    document = tmp_path / "report.md"
    document.write_text("original\n")
    recorder = Recorder()
    result = await drive(
        [call("write_file", {"file_path": "/report.md", "content": "HACKED"}), ANSWER],
        request(tmp_path),
        monkeypatch,
        recorder,
    )
    # The call is announced, then refused, then its result carries the sentence.
    # `tool_call` comes first because the graph yields the model's message before
    # the tools node runs the middleware, which is the order a reviewer reads:
    # the agent asked for this, and REX said no.
    assert recorder.kinds() == ["started", "tool_call", "denied", "tool_result", "text", "completed"]
    denied = next(event for event in recorder.events if event.type == "tool_result")
    assert denied.denied is True
    assert denied.is_error is True
    assert [denial.tool_name for denial in result.denials] == ["write_file"]
    assert document.read_text() == "original\n"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["report.md"]
    # The refusal never reached the host's gate: the boundary answered first, so
    # there was nothing to ask about.
    assert recorder.asked == []


async def test_an_ask_cannot_escape_the_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Criterion 5 — "or anything outside the workspace", under every spelling."""
    workspace = tmp_path / "repo"
    workspace.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    victim = outside / "victim.md"
    victim.write_text("untouched\n")
    for spelling in (str(victim), "/../../victim.md", "~/victim.md"):
        recorder = Recorder()
        await drive(
            [call("write_file", {"file_path": spelling, "content": "HACKED"}), ANSWER],
            request(workspace),
            monkeypatch,
            recorder,
        )
        assert "denied" in recorder.kinds(), spelling
    assert victim.read_text() == "untouched\n"
    assert sorted(p.name for p in outside.iterdir()) == ["victim.md"]
    assert list(workspace.rglob("*")) == []


async def test_an_ask_reads_the_working_copy_named_in_readable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec 50 §3.1 — the regression test for the bug this field exists to fix.

    REX's ASK prompt says `Read it at: <working copy>`, by absolute path, and
    the copy lives outside `cwd`. Before `readable` this read failed with
    "not found" about a file that was there.
    """
    workspace = tmp_path / "repo"
    workspace.mkdir()
    work = tmp_path / "work" / "doc-1"
    work.mkdir(parents=True)
    copy = work / "report.md"
    copy.write_text("the current version, the one REX points the agent at\n")

    recorder = Recorder()
    await drive(
        [call("read_file", {"file_path": str(copy)}), ANSWER],
        request(workspace, readable=[str(work)]),
        monkeypatch,
        recorder,
    )
    read = next(event for event in recorder.events if event.type == "tool_result")
    assert read.is_error is False, read.text
    assert "the current version" in read.text


async def test_an_ask_cannot_read_outside_the_workspace_and_the_copies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spec 50 §7 criterion 3 — `readable` widens the reads, it does not open the disk."""
    workspace = tmp_path / "repo"
    workspace.mkdir()
    work = tmp_path / "work" / "doc-1"
    work.mkdir(parents=True)
    (work / "report.md").write_text("allowed\n")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "private.md").write_text("not evidence for a review\n")

    for spelling in (str(elsewhere / "private.md"), "/etc/hosts"):
        recorder = Recorder()
        await drive(
            [call("read_file", {"file_path": spelling}), ANSWER],
            request(workspace, readable=[str(work)]),
            monkeypatch,
            recorder,
        )
        read = next(event for event in recorder.events if event.type == "tool_result")
        assert read.is_error is True, f"{spelling} was readable: {read.text}"


async def test_task_is_denied_by_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Criterion 4 — §14 puts subagents out of scope, and REX's gate has no rule
    for `task`, so leaving it to the gate would leave it allowed."""
    recorder = Recorder()
    result = await drive(
        [call("task", {"description": "do it", "subagent_type": "general-purpose"}), ANSWER],
        request(tmp_path),
        monkeypatch,
        recorder,
    )
    denial = next(event for event in recorder.events if event.type == "denied")
    assert denial.name == "task"
    assert "task" in denial.reason
    assert [entry.tool_name for entry in result.denials] == ["task"]
    assert recorder.asked == []


async def test_a_tool_rex_does_not_know_reaches_the_host_unmapped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§5.3 — never guessed. The host denies `common: None` for this SDK."""
    recorder = Recorder(answer="REX does not know this tool.")
    await drive(
        [call("write_todos", {"todos": []}), ANSWER],
        request(tmp_path),
        monkeypatch,
        recorder,
    )
    assert [ask.common for ask in recorder.asked] == [None]
    assert "denied" in recorder.kinds()


async def test_the_hosts_refusal_becomes_the_models_result(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """§5.2 — the model reads REX's sentence as the tool's own result."""
    (tmp_path / "report.md").write_text("x\n")
    recorder = Recorder(answer="A read session may not do that.")
    await drive(
        [call("read_file", {"file_path": "/report.md"}), ANSWER],
        request(tmp_path),
        monkeypatch,
        recorder,
    )
    result = next(event for event in recorder.events if event.type == "tool_result")
    assert result.text == "A read session may not do that."
    assert result.denied is True


# ── ACT ─────────────────────────────────────────────────────────


def act_request(repo: Path, copies: list[Path], **overrides: Any) -> RunRequest:
    return request(
        repo,
        disallowed=[],
        writable=[str(path) for path in copies],
        max_turns=None,
        **overrides,
    )


async def test_an_act_writes_the_working_copy_and_reports_it(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """§8.2 and criterion 6 — the intended copy is writable, and `wrote`/`diff` say so."""
    repo = tmp_path / "repo"
    copy = tmp_path / "work" / "docA"
    repo.mkdir()
    copy.mkdir(parents=True)
    (repo / "report.md").write_text("the reviewer's own file\n")
    target = copy / "report.md"
    target.write_text("original\n")

    recorder = Recorder()
    result = await drive(
        [call("write_file", {"file_path": str(target), "content": "revised\n"}), ANSWER],
        act_request(repo, [copy]),
        monkeypatch,
        recorder,
    )
    assert recorder.kinds() == ["started", "tool_call", "tool_result", "wrote", "diff", "text", "completed"]
    assert target.read_text() == "revised\n"
    assert (repo / "report.md").read_text() == "the reviewer's own file\n"
    assert result.error is None


async def test_an_act_cannot_change_the_reviewers_repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Criterion 6 — the originals are byte-for-byte unchanged before approval."""
    repo = tmp_path / "repo"
    copy = tmp_path / "work" / "docA"
    repo.mkdir()
    copy.mkdir(parents=True)
    original = repo / "report.md"
    original.write_text("the reviewer's own file\n")

    recorder = Recorder()
    result = await drive(
        [call("write_file", {"file_path": str(original), "content": "HACKED"}), ANSWER],
        act_request(repo, [copy]),
        monkeypatch,
        recorder,
    )
    assert "denied" in recorder.kinds()
    assert "wrote" not in recorder.kinds()
    assert original.read_text() == "the reviewer's own file\n"
    assert [denial.tool_name for denial in result.denials] == ["write_file"]


async def test_an_act_with_nowhere_to_write_is_refused_rather_than_downgraded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fail closed — the same rule spec 44 §9.3 gives Codex."""
    recorder = Recorder()
    result = await drive([ANSWER], act_request(tmp_path, []), monkeypatch, recorder)
    assert recorder.kinds() == ["error"]
    assert result.error is not None
    assert "no writable directory" in result.error


# ── stopping, and failing ───────────────────────────────────────


async def test_a_run_stopped_before_it_starts_costs_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    stop = asyncio.Event()
    stop.set()
    recorder = Recorder()
    result = await drive([ANSWER], request(tmp_path), monkeypatch, recorder, stop=stop)
    assert recorder.kinds() == ["stopped"]
    assert result.stopped is True
    assert result.error is None


async def test_a_stop_mid_turn_ends_in_one_stopped_event(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Criterion 8 — a stop is never a failure. Measured 2026-09-07: cancelling
    the stream's task raises `CancelledError` at once and waits for nothing."""
    stop = asyncio.Event()
    recorder = Recorder()

    async def ring() -> None:
        await asyncio.sleep(0.2)
        stop.set()

    ringer = asyncio.create_task(ring())
    result = await drive([ANSWER], request(tmp_path), monkeypatch, recorder, stop=stop, slow=5.0)
    await ringer
    assert recorder.kinds()[-1] == "stopped"
    assert recorder.kinds().count("stopped") == 1
    assert result.stopped is True
    assert result.error is None


async def test_a_model_that_cannot_be_built_is_refused_before_anything_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    recorder = Recorder()
    result = await DeepAgentsAdapter().run(request(tmp_path, model=None), recorder.emit, recorder.ask, asyncio.Event())
    assert recorder.kinds() == ["error"]
    assert result.error is not None
    assert "routes on the model name" in result.error


class VagueConnectionError(Exception):
    """What the OpenAI client really raises, measured 2026-09-07.

    `openai.APIConnectionError`'s whole message is the two words "Connection
    error." — no host, no errno, and not an `OSError`. It is reproduced here as
    its own class rather than imported, because what this test guards is REX's
    reaction to that *wording*, and importing the real class would let a future
    version change the words without failing anything.
    """


@pytest.mark.parametrize(
    "thrown",
    [
        ConnectionRefusedError("[Errno 61] Connection refused"),
        VagueConnectionError("Connection error."),
        VagueConnectionError("wrapped").with_traceback(None),
    ],
)
async def test_a_gateway_that_is_switched_off_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, thrown: Exception
) -> None:
    """Criterion 15 — a sentence naming the switch, not a connection error."""
    if str(thrown) == "wrapped":
        thrown.__cause__ = ConnectionRefusedError("[Errno 61] Connection refused")

    def refuse(*_: Any) -> Any:
        raise thrown

    monkeypatch.setattr(module.models, "build", refuse)
    recorder = Recorder()
    result = await DeepAgentsAdapter().run(request(tmp_path), recorder.emit, recorder.ask, asyncio.Event())
    assert result.error is not None
    assert "switched off — turn it on in Settings" in result.error


async def test_a_refused_credential_says_which_key_to_check(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec 47 §10.6 A3 — LiteLLM answers `400 No connected db.` for a wrong key,
    because with no `DATABASE_URL` it cannot look a non-master key up. REX has
    to supply the sentence, because the gateway's own is about a database."""

    def refuse(*_: Any) -> Any:
        raise RuntimeError("Error code: 400 - No connected db.")

    monkeypatch.setattr(module.models, "build", refuse)
    recorder = Recorder()
    result = await DeepAgentsAdapter().run(request(tmp_path), recorder.emit, recorder.ask, asyncio.Event())
    assert result.error is not None
    assert "refused REX's credential" in result.error


# ── the arithmetic §6 got wrong ─────────────────────────────────


def test_the_recursion_limit_is_the_measured_arithmetic() -> None:
    """§6 said `2 * max_turns + 1`; measured, one tool turn needs 5, two need 7.

    The three extra steps are the `before_agent` node, the model step that
    answers after the last tool, and the end. A limit one too small is a
    `GraphRecursionError` in the middle of a turn that was going to succeed.
    """
    assert (TURN_STEPS, TURN_OVERHEAD) == (2, 3)
    assert 1 * TURN_STEPS + TURN_OVERHEAD == 5
    assert 2 * TURN_STEPS + TURN_OVERHEAD == 7
    assert 3 * TURN_STEPS + TURN_OVERHEAD == 9
