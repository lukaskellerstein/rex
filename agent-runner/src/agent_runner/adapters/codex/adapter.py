"""Spec 44 — the Codex SDK, behind `AgentAdapter`.

`openai-codex` is a programmatic wrapper around a Codex CLI child process, so it
carries the same shape as the Claude Agent SDK: the library does not speak HTTP
to the model, the child does. What differs is where the safety lives. For Claude
the policy is primary and the SDK's `disallowed_tools` supports it; here the
**sandbox** is primary and the policy is defence in depth, because the Codex SDK
exposes no usable pre-execution veto (§9.1) and a sandbox stops a write before
the tool runs rather than after.

`AsyncCodex`, never the synchronous `Codex`: the service is one asyncio loop
(spec 42 §4.1) and a blocking `thread.run()` would stall every other run on the
pipe. `turn.stream()`, never `thread.run()` alone: a completed run cannot fill
the trace block while work is happening, and spec 38's trace is not a log written
afterwards — it is what the reviewer watches.

Every symbol here was checked against `openai-codex` 0.147.0 on 2026-09-04, which
is what §13 milestone 0 is for. Four of the spec's guesses were wrong and are
recorded in §10.2: `model_provider` is a keyword argument rather than a config
key, `network_access_enabled` and `web_search_mode` are not config names,
`CodexConfig.env` is **merged** onto the inherited environment rather than
replacing it, and the item type the spec calls `todoList` is `plan`.
"""

import asyncio
import contextlib
import os
import sys
import traceback
from pathlib import Path
from typing import Any

from openai_codex import ApprovalMode, AsyncCodex, CodexConfig, Sandbox
from openai_codex.generated.v2_all import (
    ErrorNotification,
    ItemCompletedNotification,
    ItemStartedNotification,
    ThreadTokenUsageUpdatedNotification,
    TurnCompletedNotification,
    TurnStatus,
)

from ...attribution import attribution_headers
from ...events import (
    Completed,
    Denial,
    DeniedEvent,
    ErrorEvent,
    RunResult,
    Started,
    StoppedEvent,
)
from ...policy import ToolCall
from ...types import (
    AgentSdk,
    ModelChoice,
    ResolvedRoute,
    ResumeSession,
    RouteCapabilities,
    RunRequest,
    SessionState,
)
from ..base import AskPolicy, Emit
from .errors import classify_error
from .events import item_events, policy_call_of
from .tools import common_tool

#: The value that MEANS "say nothing to the SDK". The host strips it before the
#: request is built, so this is only the row a picker draws.
DEFAULT_MODEL = "default"

#: The credential variable a routed run's child is given, and the name the
#: provider's `env_key` points at. One constant, used in both halves, because a
#: mismatch between them is a run that authenticates with nothing and says 401.
TOKEN_VARIABLE = "REX_AGENT_TOKEN"

#: The provider id every routed run defines. A constant and not a generated
#: name, because the config is built per run and never shared: each `AsyncCodex`
#: instance sees exactly one provider, so there is nothing for a unique id to
#: tell apart.
PROVIDER_ID = "rex"


def rex_codex_home() -> Path:
    """Spec 44 §7 — REX's own Codex home, so a routed run holds REX's toolbox.

    **The reviewer's own Codex toolbox is not REX's to hand over.** Codex reads
    `$CODEX_HOME/config.toml` — `~/.codex` by default — and *starts what it
    finds* before a turn begins. Measured on this machine 2026-09-05: a REX
    Codex run spawned `node_repl`, a JavaScript interpreter, and two Playwright
    MCP browsers, from eleven installed plugins including Slack, Google Calendar
    and a site deployer.

    REX's own gate is deny-by-default for MCP (spec 12 §6.4.3) and that is not
    enough on its own: `writeGateDecision` says why in its own words — starting
    an MCP server has already happened by the time anything is shown. A server
    that has started has read whatever it was configured to read.

    **Two other mechanisms were measured and do not work.** Neither
    `thread_start(config={"mcp_servers": {}, "plugins": {}})` nor
    `CodexConfig(config_overrides=("mcp_servers={}", "plugins={}"))` stops the
    spawn at 0.147.0 — the second reaches the binary as a `--config` argument
    and is ignored. `CODEX_HOME` takes it from five processes to zero, which is
    why the isolation is a directory rather than a setting.

    Stable and never per run, because Codex keeps its **rollouts** here and
    `thread_resume` (§6.1) reads them: a fresh directory each time would make
    every reply a replay. It also keeps REX's own sessions out of the
    reviewer's `~/.codex`, which is the same courtesy spec 42 §9.3 records for
    the Claude transcript store.
    """
    home = Path(os.environ.get("REX_CODEX_HOME") or Path.home() / ".rex" / "codex-home")
    home.mkdir(parents=True, exist_ok=True)
    return home


#: The window a routed run tells Codex to assume, in tokens.
#:
#: A floor rather than a truth: REX has no per-route context size, and the wrong
#: number in one direction compacts early while the wrong number in the other
#: sends a request the gateway rejects. This is the value the reviewer's own
#: gateway recipes use for the local models on this machine, on both the
#: Anthropic and the Responses surface.
ROUTED_CONTEXT_WINDOW = 122880

#: The platforms REX has actually proved the §9.3 write boundary on.
#:
#: Codex's sandbox is a different mechanism on each operating system — seatbelt,
#: landlock, and a Windows sandbox — so a proof on one is not a proof on
#: another. §9.3 makes ACT a gate rather than a feature flag: a platform without
#: the proof advertises Codex ASK and not ACT, and Claude ACT is unaffected.
#:
#: Proved on macOS 2026-09-04: with `cwd` set to one working copy and a second
#: named in `writable_roots`, a run that was told to append to all three targets
#: read the repository, wrote both working copies, and got `operation not
#: permitted` on the repository. §10 records it.
ACT_PROVED = frozenset({"darwin"})


class CodexAdapter:
    """One turn of the Codex SDK, streamed as `AgentEvent`s."""

    sdk: AgentSdk = "codex"
    package = "openai-codex"
    #: §7 — Claude's output styles do not silently become Codex personalities.
    supports_styles = False
    #: §7 — nor do Claude plugins become Codex plugins. Codex's own hooks,
    #: subagents and skills are config-file features of the CLI, not SDK API,
    #: and a directory REX resolved for Claude describes none of them.
    supports_plugins = False

    def validate(self, route: ResolvedRoute) -> str | None:
        if route.sdk != self.sdk:
            return f"The Codex adapter cannot run a '{route.sdk}' route."
        if route.auth == "environment":
            if not route.token:
                # The host resolves the variable (spec 42 §5.3) and this is the
                # backstop. A run that reached here with an empty credential
                # would fail inside the CLI, where the sentence names nothing.
                return f"The Codex route on '{route.gateway_name}' needs a credential, and none was resolved."
            if not route.base_url:
                # §5 — the credential reaches the child through a custom
                # provider's `env_key`, and a route with no URL defines no
                # provider. Refused by name rather than started with a
                # credential nothing will read.
                return (
                    f"The Codex route on '{route.gateway_name}' carries a credential but no URL. "
                    "Codex sends a per-run credential only to a gateway it was given the address of."
                )
        return None

    # ── §5 — a custom provider, not only a base URL ─────────────

    def _provider(self, route: ResolvedRoute, headers: dict[str, str] | None = None) -> dict[str, Any]:
        """The `config.toml` vocabulary for one gateway, as this run's config.

        The Codex CLI's built-in OpenAI provider can be pointed at a proxy, but
        it describes an authenticated OpenAI-compatible host and does not
        describe an unauthenticated local one. So every explicit URL gets a
        provider of its own.

        A route with no URL adds nothing at all: that is Codex's own endpoint on
        the reviewer's own `codex login`, which is what `Original` means.
        """
        if not route.base_url:
            return {}
        provider: dict[str, Any] = {
            "name": route.gateway_name,
            "base_url": route.base_url,
            "wire_api": "responses",
            # The broadly implemented path. A gateway that speaks Responses over
            # SSE is the common case; websockets are not.
            "supports_websockets": False,
        }
        # Never both. `requires_openai_auth` means "use the account's own login",
        # and `env_key` means "read this variable" — set together, the CLI has
        # two answers to one question.
        if route.auth == "inherit":
            provider["requires_openai_auth"] = True
        elif route.auth == "environment":
            provider["env_key"] = TOKEN_VARIABLE
        # Spec 45 §6 — which REX thread is spending this. `http_headers` is a
        # static table on the provider, which is exactly what these are: three
        # ids fixed for the life of this one child.
        if headers:
            provider["http_headers"] = dict(headers)
        return {"model_provider": PROVIDER_ID, "model_providers": {PROVIDER_ID: provider}}

    def _env(self, route: ResolvedRoute) -> dict[str, str] | None:
        """§5.1 — this run's credential, for this child and no other.

        `CodexConfig.env` is **merged** onto `os.environ.copy()` — read from the
        SDK's own spawn at 0.147.0 — so only the one variable is named here and
        `PATH`, `HOME` and proxy settings survive on their own.

        **`os.environ` is never assigned.** One Python process serves every run
        at once, and a process-global assignment would route one comment's
        credential into another comment's child. This is the whole of §9.3's
        promise in spec 43 §6.2, and it is why the SDK's per-child `env` was
        milestone 0's second measurement.
        """
        if not route.base_url:
            # `Original` MEANS the Codex CLI's own endpoint on the reviewer's
            # own login, and that login lives in `~/.codex`. Moving the home
            # would take the account with it, so this route is left exactly as
            # it is — including, deliberately, the reviewer's own toolbox.
            return None

        env = {"CODEX_HOME": str(rex_codex_home())}
        if route.auth == "environment" and route.token:
            env[TOKEN_VARIABLE] = route.token
        return env

    # ── §6 — threads, sessions and profiles ─────────────────────

    def _sandbox(self, request: RunRequest) -> tuple[Sandbox, dict[str, Any], str]:
        """The sandbox, its settings, and the directory the child runs in.

        `request.disallowed` is spec 42 §6's common vocabulary. There is no
        per-tool disallow list to map it onto here, so the presence of `write`
        selects the read-only sandbox and its absence the workspace-write one.
        That is the whole mapping, and §9.2 is why it is enough: read-only stops
        the write before the tool runs, where Claude's list only hides the tool.

        For a writing run the working directory **moves**. Codex makes `cwd`
        writable implicitly — measured 2026-09-04, and it is the finding that
        decided this design — so leaving it on the reviewer's repository would
        make the repository writable however carefully `writable_roots` was
        filled. §9.3's answer is to run the child in the first working copy and
        name the rest, which leaves the repository readable by absolute path and
        not writable at all.
        """
        if "write" in request.disallowed:
            return Sandbox.read_only, {}, request.cwd

        return (
            Sandbox.workspace_write,
            {
                "sandbox_workspace_write": {
                    "writable_roots": list(request.writable[1:]),
                    # A document edit needs no network, and the model's own
                    # traffic does not go through the sandbox.
                    "network_access": False,
                    # Codex leaves /tmp writable by default so tools have a
                    # scratch area. REX's boundary is "the working copies and
                    # nothing else", and a reviewer whose workspace sits under
                    # /tmp would otherwise have it silently inside the sandbox.
                    "exclude_slash_tmp": True,
                    "exclude_tmpdir_env_var": True,
                }
            },
            request.writable[0],
        )

    async def run(
        self,
        request: RunRequest,
        emit: Emit,
        ask_policy: AskPolicy,
        stop: asyncio.Event,
    ) -> RunResult:
        denials: list[Denial] = []
        session_id = request.session.id if isinstance(request.session, ResumeSession) else ""
        input_tokens: int | None = None
        output_tokens: int | None = None
        duration_ms: int | None = None
        error: str | None = None
        answered = False
        #: The one refusal that ends the turn, kept so the reason survives the
        #: interrupt that follows it.
        refusal: str | None = None

        def report_stopped() -> RunResult:
            emit(StoppedEvent())
            return RunResult(
                session_id=session_id,
                duration_ms=duration_ms,
                denials=denials,
                error=None,
                stopped=True,
            )

        # A host's queue can leave a run waiting behind a concurrency cap, and
        # those are the ones a reviewer most wants back. Stopped here, nothing
        # is spawned and the run costs nothing.
        if stop.is_set():
            return report_stopped()

        if request.route.base_url and not request.model:
            # A gateway ROUTES on the model name, so "say nothing" is never a
            # thing to say to one: the CLI fills the gap with its own default —
            # a first-party id no local gateway has heard of — and the reviewer
            # pays a round trip to be told 404 by a gateway that is working.
            #
            # `Original` is the opposite and is why this is not simply "a model
            # is required": no URL MEANS the Codex CLI's own endpoint on the
            # reviewer's own login, where its own default is exactly right.
            return self._refuse(
                emit,
                session_id,
                f"'{request.route.gateway_name}' is a gateway, and a gateway routes on the model "
                "name — so this run needs one and was given none. Open Manage gateways, edit "
                "this gateway, and type the models it answers to under MODELS FOR CODEX.",
            )

        if "write" not in request.disallowed and not request.writable:
            # §9.3 fails closed. A writing run with nowhere it may write would,
            # under `workspace_write`, be given the reviewer's own repository as
            # its writable working directory — which is the one thing this
            # adapter exists to prevent.
            return self._refuse(
                emit,
                session_id,
                "A Codex run that may write was given no writable directory, so it was not started. "
                "This is REX's bug, not the gateway's — report it.",
            )

        sandbox, sandbox_config, cwd = self._sandbox(request)
        config = {
            **self._provider(
                request.route,
                attribution_headers(request.thread_id, request.run_id, request.profile),
            ),
            **sandbox_config,
            # Belt and braces beside `CODEX_HOME`: measured not to take at
            # 0.147.0, kept because it costs nothing and is what a future
            # version would honour.
            "mcp_servers": {},
            "plugins": {},
            # The CLI's own name for the option. `web_search_mode` is not a
            # config key at 0.147.0 — milestone 0, §10.2.
            "web_search": "disabled",
        }
        if request.route.base_url:
            # §10.0.4 — Codex compacts a conversation when it thinks the window
            # is full, and for a model it has never heard of it assumes a small
            # one. On a local model that reads as an agent forgetting things
            # mid-thread for no visible reason. Only for a routed run: on
            # Codex's own endpoint the CLI knows its own models' windows.
            config["model_context_window"] = ROUTED_CONTEXT_WINDOW

        watcher: asyncio.Task[None] | None = None
        try:
            async with AsyncCodex(config=CodexConfig(env=self._env(request.route), cwd=cwd)) as codex:
                options: dict[str, Any] = {
                    "model": request.model,
                    "sandbox": sandbox,
                    # `deny_all` is `askForApproval: never` — fully headless. The
                    # default, `auto_review`, stalls a headless run on the first
                    # escalation because there is nobody to prompt.
                    "approval_mode": ApprovalMode.deny_all,
                    "developer_instructions": request.system_prompt or None,
                    "cwd": cwd,
                    "config": config,
                }
                if request.route.base_url:
                    options["model_provider"] = PROVIDER_ID

                # §6.1 — Codex names its own thread. A `seed` session's supplied
                # id is discarded rather than sent: the SDK has no parameter for
                # it, and inventing one would put a REX id in a field the CLI
                # would then ignore silently.
                if isinstance(request.session, ResumeSession):
                    thread = await codex.thread_resume(request.session.id, **options)
                else:
                    thread = await codex.thread_start(**options)
                session_id = thread.id

                emit(Started(session_id=session_id, model=request.model, tools=None))

                turn = await thread.turn(request.prompt)
                watcher = asyncio.create_task(_interrupt_when(stop, turn))

                # Narrowed by TYPE and not by `event.method`. Every notification
                # this branch reads is its own model, so `isinstance` says the
                # same thing the method string does and says it to the type
                # checker too — a payload field renamed by an SDK bump is then a
                # compile-time finding rather than an attribute error inside a
                # paid turn.
                async for event in turn.stream():
                    payload = event.payload

                    if isinstance(payload, ItemStartedNotification):
                        refusal = await self._judge(payload.item.root, ask_policy, emit, denials)
                        if refusal is not None:
                            await _quietly_interrupt(turn)

                    elif isinstance(payload, ItemCompletedNotification):
                        for produced in item_events(payload.item.root):
                            emit(produced)

                    elif isinstance(payload, ThreadTokenUsageUpdatedNotification):
                        total = payload.token_usage.total
                        input_tokens = total.input_tokens
                        output_tokens = total.output_tokens

                    elif isinstance(payload, ErrorNotification):
                        # The CLI retries a dropped stream several times and says
                        # so. Only the last one — the one it will not retry — is
                        # this run's failure.
                        if not payload.will_retry and error is None:
                            error = classify_error(payload.error.message, request.route, request.model)

                    elif isinstance(payload, TurnCompletedNotification):
                        duration_ms = payload.turn.duration_ms
                        if payload.turn.status is TurnStatus.completed:
                            answered = True
                        elif payload.turn.status is TurnStatus.failed and payload.turn.error is not None:
                            error = classify_error(payload.turn.error.message, request.route, request.model)

        except Exception as thrown:
            if stop.is_set():
                return report_stopped()
            # The traceback is what a maintainer needs and the one thing a
            # reviewer's screen has no room for, so it goes to stderr — the
            # host's log.
            traceback.print_exc()
            error = classify_error(thrown, request.route, request.model)

        finally:
            if watcher is not None:
                watcher.cancel()

        # A late interrupt can end the stream cleanly, with nothing thrown.
        # `answered` is what keeps a stop pressed on the last millisecond of a
        # run that DID answer from writing "you stopped this run" under it.
        if not answered and stop.is_set():
            return report_stopped()

        # A refusal ends the turn, and it is the run's error however the turn
        # itself reported ending. Never over a real error the run already has:
        # the gateway's own failure is the more useful sentence.
        if refusal is not None and error is None:
            error = refusal

        if error is not None:
            emit(ErrorEvent(text=error, duration_ms=duration_ms))
        else:
            emit(
                Completed(
                    # §8 — Codex reports tokens and, for a custom provider, no
                    # dollar cost. None MEANS "not reported" and is drawn as
                    # unknown; it is never drawn as $0.00 (spec 43 §8.1).
                    cost_usd=None,
                    duration_ms=duration_ms,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            )

        return RunResult(
            session_id=session_id,
            cost_usd=None,
            duration_ms=duration_ms,
            denials=denials,
            error=error,
            stopped=False,
        )

    async def _judge(
        self,
        item: Any,
        ask_policy: AskPolicy,
        emit: Emit,
        denials: list[Denial],
    ) -> str | None:
        """§9.1 — ask the host about a tool call that has just started.

        Where this runs is the honest part. The Codex SDK's approval handler is
        not reachable through `AsyncCodex`, it is synchronous on the sole stdout
        reader thread, and `deny_all` means the CLI never sends one — measured,
        §10.2. So the question is asked at `item/started`, which is after the
        sandbox has already decided and before the item completes: **the sandbox
        is what stops the write; the policy is what makes the attempt visible**
        and what ends a turn that should not continue.
        """
        call = policy_call_of(item)
        if call is None:
            return None
        name, tool_input = call
        item_type = getattr(item, "type", "")
        reason = await ask_policy(ToolCall(name=name, common=common_tool(str(item_type)), input=tool_input))
        if reason is None:
            return None
        denials.append(Denial(tool_name=name, reason=reason))
        emit(DeniedEvent(name=name, reason=reason))
        return f"{name} was not allowed, so the run was ended. {reason}"

    def _refuse(self, emit: Emit, session_id: str, reason: str) -> RunResult:
        emit(ErrorEvent(text=reason))
        return RunResult(session_id=session_id, error=reason)

    # ── the two questions that are not a run ────────────────────

    async def capabilities(self, route: ResolvedRoute, cwd: str) -> RouteCapabilities:
        """§7 — what a Codex route offers, without spending anything.

        **Nothing is probed.** The Claude adapter asks its CLI because the model
        and style lists are the account's; Codex has no gateway-independent
        catalogue to ask for, so a route offers the models typed into it (spec
        43 §4.3) and `Original` offers the one row that means "the Codex CLI's
        own default". Starting a CLI to learn nothing would be seconds a
        reviewer waits for an empty answer.
        """
        _ = cwd
        refusal = self.validate(route)
        act = sys.platform in ACT_PROVED
        return RouteCapabilities(
            models=[
                ModelChoice(
                    value=DEFAULT_MODEL,
                    display_name="Default",
                    description="Whatever the Codex CLI is configured to use.",
                )
            ]
            if not route.base_url
            else [],
            styles=[],
            supports_styles=False,
            supports_plugins=False,
            # §8 — a Codex turn reports tokens and no dollar cost.
            supports_cost=False,
            supports_ask=refusal is None,
            supports_act=refusal is None and act,
            supports_resume=True,
            error=refusal
            or (
                None
                if act
                else (
                    f"Codex can answer on {sys.platform} but cannot make changes: REX has only "
                    "proved the write boundary on macOS, and Codex's sandbox is a different "
                    "mechanism on each platform. Claude ACT is unaffected."
                )
            ),
        )

    async def session_state(self, route: ResolvedRoute, cwd: str, session_id: str) -> SessionState:
        """§6.2 — whether the SDK can still resume this thread.

        Asked by resuming it and closing again, because that is the SDK's own
        supported answer and it is the exact question: `thread_list` pages
        through every thread the CLI knows and would have to be walked, and a
        guess at where the CLI keeps its rollout files would break on a version
        bump for a reason nothing on screen explains.

        A false answer is not a failure — it sends the host down its own replay
        path (spec 42 §8.5) with the route unchanged, which is what a REX thread
        that outlived an SDK's cache needs.
        """
        _ = cwd
        try:
            async with AsyncCodex(config=CodexConfig(env=self._env(route), cwd=cwd)) as codex:
                options: dict[str, Any] = {"config": self._provider(route)}
                if route.base_url:
                    options["model_provider"] = PROVIDER_ID
                thread = await codex.thread_resume(session_id, **options)
                found = thread.id == session_id
        except Exception:
            found = False
        return SessionState(
            exists=found,
            summary=None,
            last_modified=None,
            # Codex keeps its own thread store and does not publish the path, so
            # naming a guess would be worse than naming nothing.
            path=None,
            size=None,
        )


async def _interrupt_when(stop: asyncio.Event, turn: Any) -> None:
    """Turn the host's stop into the SDK's own cancellation.

    `AsyncTurnHandle.interrupt()` ends the turn with `interrupted` and lets the
    stream finish cleanly, so nothing is thrown and the caller's own `stopped`
    check is what writes the one event a stop gets.
    """
    await stop.wait()
    await _quietly_interrupt(turn)


async def _quietly_interrupt(turn: Any) -> None:
    with contextlib.suppress(Exception):
        # A turn that has already ended cannot be interrupted, and that is not
        # an error — it is the race this exists inside.
        await turn.interrupt()


__all__ = ["ACT_PROVED", "CodexAdapter", "rex_codex_home"]
