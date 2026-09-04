"""Spec 42 §9.2 — the sentence a failed run puts on the reviewer's screen.

Ported line for line from REX's `runner.ts`, and the rule it implements does not
change: **the SDK's original text always survives.** The library may put one
sentence in front of it; it never speaks in its place.

That rule exists because of a measured wrong diagnosis. A run failed and the
report said "check that the claude executable is installed and on PATH". The SDK
ships and resolves its own binary and never consults PATH, so the sentence was
not merely unhelpful — it was false, it sent the reader after a bug that does not
exist, and the SDK's own words had already been thrown away to make room for it.

A wrong hint costs more than no hint: it is read as a diagnosis.
"""

import re

from ...events import Denial
from ...types import ResolvedRoute

EXECUTABLE_FAILURE = re.compile(
    r"claude code (?:executable|native binary) not found"
    r"|claude code executable at .* failed to launch"
    r"|spawn \S*claude\S* enoent",
    re.IGNORECASE,
)
"""The phrases the SDK itself produces when it cannot start or run its binary.

Matched as phrases rather than as the words "not found", and that distinction is
the whole point of this constant: "not found" appears in a dozen unrelated
sentences, and matching it blamed every one of them on the executable.
"""

MODEL_NEEDS_NEWER_CLI = re.compile(
    r"claude code ([\d.]+) does not support this model; version ([\d.]+) or newer is required",
    re.IGNORECASE,
)
"""The bundled Claude Code is older than the model needs.

The API's own message ends "Run `claude update`", and that is the one
instruction that cannot work here, for the reason `EXECUTABLE_FAILURE` records:
the SDK **ships and resolves its own binary** and never looks at PATH. Updating
the Claude Code on PATH changes nothing this package does. The fix is this
package's own `claude-agent-sdk` dependency.
"""

SDK_REFUSAL = re.compile(r"^Permission to use \S+ .*has been denied\.?$")
"""The SDK's own refusal, which is not the host's gate and is still not a failure.

Anchored at both ends deliberately. Matched loosely it would catch a `grep`
whose OUTPUT quotes this sentence — a search of a transcript does exactly that.
"""


FIRST_PARTY_MODEL = re.compile(r"invalid model name passed in model=(claude-\S*)", re.IGNORECASE)
"""A gateway was sent a real Claude id, which it has never heard of.

Spec 43 §6.4 — it reads like a broken proxy and it is an unmapped model slot.
Every id the CLI can send is covered by §6.3's environment, so seeing this at
all means REX did not fill one, which makes it REX's bug and not the gateway's.
"""

TRANSLATED = re.compile(
    r"thinking\.type: Input should be"
    r"|messages\.\d+\.content\.str: Input should be a valid string",
    re.IGNORECASE,
)
"""A gateway that TRANSLATED the request instead of passing it through.

Two errors, one cause, and neither is the gateway's fault. A route that reaches a
backend declared with a non-Anthropic schema is converted to that schema on the
way in, and the ENGINE then sees Anthropic shapes it has no place for:

* `thinking.type: Input should be 'disabled' or 'enabled'` — the field Claude
  Code sends with every request; and
* `messages.N.content.str: Input should be a valid string` — the reply's own
  thinking block, sent back on the next turn, where an OpenAI `content` part may
  only be `text` or `image_url`.

The second is the one that matters, because it is **intermittent**: the engine
emits reasoning on some replies and not others, so a one-shot usually passes and
an agent run fails about one time in five. Measured 2026-09-04 direct on the
engines, with no gateway in the path — Unsloth, LM Studio and Ollama alike.

There is no environment variable for it. The cure is a route.
"""

UPSTREAM_AUTH = re.compile(
    r"\b401\b|\b403\b|not authenticated|authentication_error|unauthorized",
    re.IGNORECASE,
)
"""A gateway whose OWN upstream credential is missing, refused or expired.

The general `hint_for` answer to a 401 is "set ANTHROPIC_API_KEY, or run
`claude login`", and through a gateway that is **the wrong instruction twice
over**: REX never sends its own login to a gateway, and the credential that
failed belongs to the gateway, not to the reviewer's machine. Measured
2026-09-04, where a gateway started without its engine's key answered
`401 Not authenticated` on every route and REX advised logging in to Anthropic.
"""

NOT_FOUND = re.compile(r"\b404\b|not[_ ]found", re.IGNORECASE)

REFUSED = re.compile(r"connection refused|econnrefused|failed to connect|cannot connect", re.IGNORECASE)


def route_hint(text: str, route: ResolvedRoute | None, model: str | None = None) -> str | None:
    """Spec 43 §9 — the hints that only make sense once a run has a gateway.

    Each names the gateway and the address the run actually used, because the
    same sentence from the SDK means four different things depending on where it
    was pointed — and "connection refused" with no host in it has sent more than
    one person to debug the wrong process.
    """
    if route is None or not route.base_url:
        return None
    where = f"'{route.gateway_name}' ({route.base_url})"

    if REFUSED.search(text):
        return (
            f"Nothing is listening at {where}. The gateway is not running, or it is on another port. "
            "Start it and send this again — REX never falls back to the official API on its own, "
            "because a local choice must not become a cloud request."
        )
    if FIRST_PARTY_MODEL.search(text):
        return (
            f"{where} was sent a first-party Claude model id. This is REX's bug, not the gateway's — "
            "one of the three model slots was left unset. Report it."
        )
    if UPSTREAM_AUTH.search(text):
        # `ResolvedRoute` carries the credential's VALUE and never its name
        # (§5.3), so the auth MODE is all this can say — and the mode is the
        # half that decides where to look.
        ours = (
            "REX resolved the variable this route names and sent it, so check that value first. "
            if route.auth == "environment"
            else "REX sends this gateway no credential at all, so this is not about a REX login. "
        )
        return (
            f"{where} refused the request as unauthenticated. {ours}"
            "The other half is the gateway's OWN credential for whatever is behind it: an engine "
            "that needs a key, fronted by a gateway started without one, answers exactly this on "
            "every route it serves. Do not run `claude login` — REX never sends your Anthropic "
            "login to a gateway."
        )
    if TRANSLATED.search(text):
        # The remedy is one word on the end of the model name, so the hint says
        # the word. A reviewer who has to work out that a second alias exists,
        # and what it would be called, has been told a fact rather than an
        # instruction.
        instead = (
            f"Pick '{model}-anthropic' instead of '{model}'."
            if model and not model.endswith("-anthropic")
            else "Pick a model whose alias ends '-anthropic'."
        )
        return (
            f"{instead} {where} TRANSLATED this request rather than passing it through, and the "
            "engine behind it refuses the `thinking` blocks that translation carries — an OpenAI "
            "content part may only be text or an image. A one-shot usually survives it and an "
            "agent conversation does not, at random, so this is worth fixing rather than retrying. "
            "The `-anthropic` alias reaches a backend declared `schema: {name: Anthropic}`, where "
            "nothing is translated and nothing can be mangled. No environment variable fixes the "
            "translated route."
        )
    if NOT_FOUND.search(text):
        return (
            f"{where} has no Anthropic Messages endpoint where this route points. The SDK appends "
            "`/v1/messages` itself, so a base URL ending in `/v1` produces `/v1/v1/messages`. "
            "Check the route in Manage gateways — Verify says what the server publishes."
        )
    return None


def hint_for(text: str) -> str | None:
    """A sentence to put ABOVE the error, or None when there is nothing to add."""
    lowered = text.lower()

    if (
        re.search(r"\b(401|403)\b", text)
        or "api_key" in lowered
        or "unauthorized" in lowered
        or "authentication" in lowered
    ):
        return "Authentication failed. Set ANTHROPIC_API_KEY, or run 'claude login' to authenticate."
    if "timeout" in lowered or "timed out" in lowered:
        return "The agent timed out. The question may be too broad — try narrowing the comment."
    if EXECUTABLE_FAILURE.search(text):
        return (
            "The Claude Code executable could not be started. Reinstall Claude Code, "
            "or set options.pathToClaudeCodeExecutable."
        )
    older = MODEL_NEEDS_NEWER_CLI.search(text)
    if older:
        # The dependency named here is the PYTHON one, because that is the one
        # that carries the CLI now. Saying `npm install @anthropic-ai/...` would
        # send the reader to a package the app no longer has — the same class of
        # false diagnosis this whole module exists to stop.
        return (
            f"This model needs Claude Code {older.group(2)} or newer, and the Agent SDK inside "
            f'the agent library is {older.group(1)}. Ignore the "run claude update" advice '
            "below — it updates the Claude Code on your PATH, which the library never uses. "
            "Update the library's own dependency instead: run 'uv add claude-agent-sdk@latest' "
            "in agent-gateway/. Or pick a model the bundled version supports."
        )
    return None


def classify_error(
    error: BaseException | str,
    route: ResolvedRoute | None = None,
    model: str | None = None,
) -> str:
    """An actionable message ABOVE the stack, never instead of it.

    The route's own hints come first when there is a route with a URL. They are
    more specific than the general ones and they say *where*, and the general
    "Authentication failed. Set ANTHROPIC_API_KEY, or run 'claude login'" is
    exactly the wrong advice about a gateway that refused a connection.
    """
    text = str(error)
    hint = route_hint(text, route, model) or hint_for(text)
    return f"{hint}\n\n{text}" if hint else f"Agent error: {text}"


def denied_by(denials: list[Denial], tool_name: str | None, text: str) -> bool:
    """Whether an errored result is the GATE speaking, rather than the tool.

    The SDK marks both with `is_error`, and they are not the same event: a `grep`
    that matches nothing and an `ls` of a missing directory both exit non-zero
    without anything having been refused.

    Told apart here because this is the only place that can. The policy runs
    before the tool, so every refusal is already known when its result arrives,
    and the SDK hands the reason back verbatim as the result's content. The host
    wrote that sentence itself moments earlier, so matching on it is
    identification and not a guess about somebody else's error text.
    """
    if SDK_REFUSAL.match(text.strip()):
        return True
    return any((tool_name is None or denial.tool_name == tool_name) and denial.reason in text for denial in denials)
