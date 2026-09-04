"""Spec 42 §9 — the Claude Agent SDK, behind `AgentAdapter`.

A port **back** into Python. Vex's `claude_code_sdk.py` supplies the SDK
mechanics — one `ClaudeSDKClient` per run, a `receive_response()` loop with
per-block dispatch, a `PreToolUse` `HookMatcher`, `session_id=` to seed and
`resume=` to continue, `interrupt()` to stop. REX's `runner.ts` supplies the
rules built on top of it: the four session shapes, the three error phrase
patterns, refusal told apart from failure, and the stopped-versus-answered race
at the end of a run.

Neither is copied whole. What is deliberately **not** here: Vex's NATS publish,
its file logger, its Playwright auth injection, its extra hooks that wrote its
own tables, and its private `claude_agent_sdk._internal.sessions` import.

The one decision that is not this adapter's: **whether a tool may run.** It asks
`ask_policy` and turns the answer into the SDK's own veto. It never decides.
"""

import asyncio
import json
import traceback
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookJSONOutput,
    HookMatcher,
    ResultMessage,
    SystemMessage,
    UserMessage,
)

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
    ResolvedRoute,
    ResumeSession,
    RouteCapabilities,
    RunRequest,
    SeedSession,
    SessionState,
)
from ..base import AskPolicy, Emit
from .errors import classify_error, route_hint
from .events import assistant_events, user_events
from .models import DEFAULT_MODEL, DEFAULT_STYLE, probe
from .sessions import session_state
from .tools import claude_tools_for, common_tool


def _library_version() -> str:
    """This package's own version, for the one header that identifies the caller."""
    try:
        return version("agent-gateway")
    except PackageNotFoundError:
        return "unknown"


_LIBRARY_VERSION = _library_version()

_LOCAL_SENTINEL = "rex-local"
"""What a `none`-auth route sends where a credential would go.

**Not a secret and not a real key.** A local endpoint checks nothing, and the
Claude Code client the SDK bundles still expects an authentication value to be
present — so a word that is obviously a placeholder goes there, rather than an
empty string that some client versions read as "unset".
"""

_ALLOW: HookJSONOutput = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
    }
}
"""An explicit allow, and not merely decoration.

Without one the SDK's default permission mode prompts for approval on every
write, and a headless session has nobody to prompt: the edit comes back
"requested permissions to write to …" and the run produces nothing.
"""


def _deny(reason: str) -> HookJSONOutput:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


class ClaudeAdapter:
    """One turn of the Claude Agent SDK, streamed as `AgentEvent`s."""

    sdk: AgentSdk = "claude-agent"
    package = "claude-agent-sdk"
    supports_styles = True
    supports_plugins = True

    def validate(self, route: ResolvedRoute) -> str | None:
        if route.sdk != self.sdk:
            return f"The Claude adapter cannot run a '{route.sdk}' route."
        if route.auth == "environment" and not route.token:
            # The host resolves the variable (spec 42 §5.3) and this is the
            # backstop. A run that reached here with an empty credential would
            # fail inside the CLI, where the sentence names nothing useful.
            return f"The Claude route on '{route.gateway_name}' needs a credential, and none was resolved."
        return None

    # ── the run ─────────────────────────────────────────────────

    async def run(
        self,
        request: RunRequest,
        emit: Emit,
        ask_policy: AskPolicy,
        stop: asyncio.Event,
    ) -> RunResult:
        denials: list[Denial] = []
        tool_names: dict[str, str] = {}
        session_id = getattr(request.session, "id", "")
        cost_usd: float | None = None
        duration_ms: int | None = None
        error: str | None = None
        #: The turn ran to its own end and said so — the SDK's `result: success`.
        answered = False
        #: A gateway's refusal, found in the assistant's own words. See below.
        gateway_refusal: str | None = None

        def report_stopped() -> RunResult:
            emit(StoppedEvent())
            return RunResult(
                session_id=session_id,
                cost_usd=cost_usd,
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

        client = ClaudeSDKClient(options=self._options(request, emit, ask_policy, denials))
        watcher: asyncio.Task[None] | None = None
        try:
            await client.connect(request.prompt)
            watcher = asyncio.create_task(_interrupt_when(stop, client))

            async for message in client.receive_response():
                found = _session_id_of(message)
                if found:
                    session_id = found

                if isinstance(message, SystemMessage):
                    if message.subtype == "init":
                        emit(_started(session_id, message.data))

                elif isinstance(message, AssistantMessage):
                    for block in message.content:
                        block_id = getattr(block, "id", None)
                        block_name = getattr(block, "name", None)
                        if block_id and block_name:
                            tool_names[block_id] = block_name
                    for event in assistant_events(message.content):
                        emit(event)
                        # **A gateway's refusal can arrive as the assistant's own
                        # words.** The CLI catches an HTTP error from the upstream
                        # and reports it as prose in a turn the SDK then calls a
                        # success — measured 2026-09-04, where a 400 about the
                        # `thinking` field came back as `API Error: 400 …` with a
                        # `completed` beside it and `error` null.
                        #
                        # Read literally that is a run that worked, and every
                        # surface believed it: the card, the cost line, the Test
                        # button. So a routed run reads its own answer, and a
                        # sentence that is a gateway saying no becomes the failure
                        # it is. Only when there IS a gateway — on the SDK's own
                        # endpoint nothing here can fire, so spec 42 §13
                        # criterion 10's byte-for-byte parity is untouched.
                        if event.type == "text" and request.route.base_url:
                            refusal = route_hint(event.text, request.route, request.model)
                            if refusal is not None and gateway_refusal is None:
                                gateway_refusal = f"{refusal}\n\n{event.text}"

                elif isinstance(message, UserMessage):
                    for event in user_events(message.content, tool_names, denials):
                        emit(event)

                elif isinstance(message, ResultMessage):
                    cost_usd = _cost_of(message, request.route)
                    duration_ms = message.duration_ms
                    if message.subtype == "success":
                        answered = True
                        usage = message.usage or {}
                        emit(
                            Completed(
                                cost_usd=cost_usd,
                                duration_ms=duration_ms,
                                input_tokens=usage.get("input_tokens"),
                                output_tokens=usage.get("output_tokens"),
                            )
                        )
                    elif not stop.is_set():
                        # "ended" and not "stopped" on purpose: a stop is a
                        # person, and this line is the case that is a failure.
                        error = "; ".join(message.errors or []) or (f"Agent ended: {message.subtype}")
                        # Spec 43 §9 — a gateway's own refusal usually arrives
                        # here rather than as a throw. Only the route's hints,
                        # so a run on the SDK's own endpoint reads exactly as it
                        # did before spec 43 (spec 42 §13 criterion 10).
                        gateway_hint = route_hint(error, request.route, request.model)
                        if gateway_hint:
                            error = f"{gateway_hint}\n\n{error}"
                        emit(ErrorEvent(text=error))
                    # An interrupt also arrives as an unsuccessful turn. Its cost
                    # and duration are kept; `report_stopped` below writes the
                    # one event a stop gets.

        except Exception as thrown:
            # An interrupt surfaces as a thrown error, and the library asks its
            # own event rather than matching that class: both are true, and the
            # event is the one it owns, so it cannot change under a version bump.
            if stop.is_set():
                return report_stopped()
            # The traceback is what a maintainer needs and the one thing a
            # reviewer's screen has no room for, so it goes to stderr — which is
            # the host's log.
            traceback.print_exc()
            error = classify_error(thrown, request.route, request.model)
            emit(ErrorEvent(text=error))

        finally:
            if watcher is not None:
                watcher.cancel()
            await _quietly_disconnect(client)

        # A late interrupt can end the stream cleanly, with nothing thrown.
        # `answered` is what keeps a stop pressed on the last millisecond of a
        # run that DID answer from writing "you stopped this run" under a
        # finished answer.
        if not answered and stop.is_set():
            return report_stopped()

        # A turn the SDK called a success, whose only content was a gateway
        # refusing it, is a failed turn. Reported once, and never over a real
        # error the run already has.
        if error is None and gateway_refusal is not None:
            error = gateway_refusal
            emit(ErrorEvent(text=gateway_refusal))

        return RunResult(
            session_id=session_id,
            cost_usd=cost_usd,
            duration_ms=duration_ms,
            denials=denials,
            error=error,
            stopped=False,
        )

    # ── what the adapter decides by itself (§9.1) ───────────────

    def _options(
        self,
        request: RunRequest,
        emit: Emit,
        ask_policy: AskPolicy,
        denials: list[Denial],
    ) -> ClaudeAgentOptions:
        options = ClaudeAgentOptions(
            cwd=request.cwd,
            # The preset is what makes the SDK behave as Claude Code; the host
            # writes only the append.
            system_prompt={
                "type": "preset",
                "preset": "claude_code",
                "append": request.system_prompt,
            },
            # The repository's own `.claude/` is part of what "run in this
            # directory" means.
            setting_sources=["project"],
            disallowed_tools=claude_tools_for(request.disallowed),
            plugins=[{"type": "local", "path": path} for path in request.plugins],
            hooks={"PreToolUse": [HookMatcher(matcher=".*", hooks=[_policy_hook(emit, ask_policy, denials)])]},
            env=self._env(request.route, request.model),
        )

        if request.max_turns is not None:
            options.max_turns = request.max_turns

        # `default` is a value the CLI advertises and a host records, and it
        # MEANS "the host says nothing". Omitting the option is how that is said
        # to the SDK. The record keeps the reviewer's word; the call does not
        # repeat it.
        if request.model and request.model != DEFAULT_MODEL:
            options.model = request.model

        # The Python SDK has no `output_style` option. `settings` is the CLI's
        # own `--settings`, which takes a JSON string — measured on 2026-09-04
        # by reading `output_style` back out of the init message.
        if request.style and request.style != DEFAULT_STYLE:
            options.settings = json.dumps({"outputStyle": request.style})

        session = request.session
        if isinstance(session, SeedSession):
            options.session_id = session.id
        elif isinstance(session, ResumeSession):
            options.resume = session.id
        # A `new` session says nothing, and the SDK names it.

        return options

    def _env(self, route: ResolvedRoute, model: str | None = None) -> dict[str, str]:
        """Spec 43 §6.3 — where this run's inference is served from, per run.

        **Nothing at all for the SDK's own endpoint.** `auth: inherit` with no
        URL is today's behaviour exactly: the CLI inherits what the library was
        started with and uses `claude login`, and REX changes nothing.

        `ClaudeAgentOptions.env` is **merged** on top of the inherited
        environment — measured at `claude-agent-sdk` 0.2.152, spec 42 §17.6 — so
        only the routing keys are named here and `PATH`, `HOME` and proxy
        settings survive on their own. A merge cannot unset, which is why the
        three cloud-routing flags are set to an empty string rather than
        deleted: an inherited `CLAUDE_CODE_USE_BEDROCK` would send this run
        somewhere the reviewer did not choose.

        Built fresh on every call and never from `process.environ`. Two comments
        can run at once on two different gateways, and a process-global
        assignment would route one of them nondeterministically.
        """
        if not route.base_url:
            return {}

        env = {
            "ANTHROPIC_BASE_URL": route.base_url,
            "CLAUDE_AGENT_SDK_CLIENT_APP": f"rex/{_LIBRARY_VERSION}",
            # §15 — a non-Anthropic backend does not implement the beta headers
            # the SDK sends by default, and the failure is a 400 from inside a
            # paid turn.
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
            # §7 — a local model's first token can be minutes away. This is the
            # gateway's own documented recipe; the SDK's default would kill the
            # turn while the model was still reading the prompt.
            "API_TIMEOUT_MS": "3600000",
            "CLAUDE_CODE_USE_BEDROCK": "",
            "CLAUDE_CODE_USE_VERTEX": "",
            "CLAUDE_CODE_USE_FOUNDRY": "",
        }

        # §6.4 — the three model slots. REX sends its chosen model explicitly,
        # so the MAIN slot is covered; the background slot the SDK uses for
        # titles and summaries is not, and an unset one makes the CLI send a
        # real Claude id that no gateway has heard of. Setting all three to one
        # id is deliberate: leaving the small slot inherited would turn one
        # local-model choice into an unnoticed cloud request.
        if model and model != DEFAULT_MODEL:
            env |= {
                "ANTHROPIC_DEFAULT_SONNET_MODEL": model,
                "ANTHROPIC_DEFAULT_OPUS_MODEL": model,
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": model,
            }

        # Both credential variables get the same value, and neither is ever set
        # to "". `ANTHROPIC_AUTH_TOKEN` becomes `Authorization: Bearer` and
        # `ANTHROPIC_API_KEY` becomes `x-api-key`; which one is read has moved
        # between versions, and an empty string is not the same as an unset
        # variable to every client. The gateway author's own recipe
        # (`ai-gateway/litellm/README.md`) sets both.
        if route.auth == "environment" and route.token:
            env |= {"ANTHROPIC_AUTH_TOKEN": route.token, "ANTHROPIC_API_KEY": route.token}
        elif route.auth == "none":
            # A non-secret sentinel rather than an empty value: the bundled
            # Claude Code client expects an authentication value even when the
            # server ignores it, and Envoy checks no caller key at all.
            env |= {"ANTHROPIC_AUTH_TOKEN": _LOCAL_SENTINEL, "ANTHROPIC_API_KEY": _LOCAL_SENTINEL}

        return env

    # ── the two questions that are not a run ────────────────────

    async def capabilities(self, route: ResolvedRoute, cwd: str) -> RouteCapabilities:
        # No model: a probe completes the CLI handshake and sends the model
        # nothing, so the three slots have nothing to cover.
        return await probe(cwd, self._env(route))

    async def session_state(self, route: ResolvedRoute, cwd: str, session_id: str) -> SessionState:
        _ = route
        return await asyncio.to_thread(session_state, cwd, session_id)


def _policy_hook(emit: Emit, ask_policy: AskPolicy, denials: list[Denial]):
    """The `PreToolUse` hook — the shape in which *Claude* asks a policy."""

    async def hook(
        input_data: Any,
        tool_use_id: str | None,
        context: Any,
    ) -> HookJSONOutput:
        _ = (tool_use_id, context)
        name = str(input_data.get("tool_name", ""))
        subagent_id = input_data.get("agent_id") or None
        reason = await ask_policy(
            ToolCall(
                name=name,
                common=common_tool(name),
                input=input_data.get("tool_input"),
                subagent_id=subagent_id,
            )
        )
        if reason is None:
            return _ALLOW

        denials.append(Denial(tool_name=name, reason=reason, subagent_id=subagent_id))
        emit(DeniedEvent(name=name, reason=reason, subagent_id=subagent_id))
        return _deny(reason)

    return hook


def _cost_of(message: ResultMessage, route: ResolvedRoute) -> float | None:
    """What this turn cost, and **None whenever that cannot be known**.

    The CLI prices every turn from its own table of first-party models. Point it
    at a gateway and it prices a model it has never heard of: measured
    2026-09-04 against `unsloth-26b` through LiteLLM, 23 input and 62 output
    tokens were reported as $0.09252, and the CLI's own log said
    `unrecognized_model` in the same second.

    That number is not small or approximate — it is about a model that does not
    exist, and REX adds it to a document's running spend. Spec 42 §7 rule 2 says
    None MEANS "not reported", so this is what None is for: a host draws it as
    unknown, and nobody reconciles a local run against a bill.

    `duration_ms` is untouched, because a duration measured by a stopwatch is
    true wherever the tokens came from.
    """
    return None if route.base_url else message.total_cost_usd


def _started(session_id: str, data: dict[str, Any]) -> Started:
    """The CLI's RESOLVED values, so a setting it ignored shows as a disagreement.

    `tools` and `plugins` are here because the host writes one line about the
    start of a run and needs all four numbers to write it. They are counts and
    names, never the plugin objects themselves.
    """
    plugins = data.get("plugins") or []
    return Started(
        session_id=session_id,
        model=data.get("model"),
        style=data.get("output_style"),
        tools=len(data.get("tools") or []),
        plugins=[str(plugin.get("name", "")) for plugin in plugins if isinstance(plugin, dict)],
    )


def _session_id_of(message: Any) -> str | None:
    found = getattr(message, "session_id", None)
    if isinstance(found, str) and found:
        return found
    data = getattr(message, "data", None)
    if isinstance(data, dict):
        inner = data.get("session_id")
        if isinstance(inner, str) and inner:
            return inner
    return None


async def _interrupt_when(stop: asyncio.Event, client: ClaudeSDKClient) -> None:
    """Turn the host's stop into the SDK's own cancellation.

    `ClaudeSDKClient` always runs in the streaming mode `interrupt()` needs, so
    there is no abort-controller workaround here.
    """
    await stop.wait()
    try:
        await client.interrupt()
    except Exception:
        # A run that has already ended cannot be interrupted, and that is not an
        # error — it is the race this task exists inside.
        pass


async def _quietly_disconnect(client: ClaudeSDKClient) -> None:
    try:
        await client.disconnect()
    except Exception:
        pass
