"""Spec 44 §9.4 — the sentence a failed Codex run puts on the reviewer's screen.

The rule is spec 42 §9.2's and does not change here: **the SDK's original text
always survives.** One sentence may go in front of it; nothing ever speaks in its
place.

A separate module from the Claude one on purpose. The hints are about a
**Responses** endpoint, and the Claude hints name Anthropic Messages and
`/v1/messages`. Reusing them would answer a Codex 404 with advice about a path
Codex never asks for, which is the false-diagnosis failure that module was
written to stop.
"""

import re

from ...types import ResolvedRoute

REFUSED = re.compile(
    r"connection refused|econnrefused|failed to connect|cannot connect|error sending request",
    re.IGNORECASE,
)

#: A 404 that is genuinely about the PATH, and not about the model.
#:
#: `no matching route` is deliberately **not** here. It reads like a routing
#: failure and is a gateway's way of saying it does not serve that model —
#: `UNKNOWN_MODEL` claims it first, and it must, because this hint tells the
#: reviewer to go and check a base URL that is perfectly correct.
NOT_FOUND = re.compile(r"\b404\b|not[_ ]found", re.IGNORECASE)

#: The gateway does not serve the model this run asked for.
#:
#: Three spellings, because three products say the same thing three ways and one
#: of them says it in the vocabulary of routing. Measured 2026-09-05, Envoy:
#: "unexpected status 404 Not Found: No matching route found. It is likely
#: because the model specified in your request is not configured in the
#: Gateway." — the server's own diagnosis is exactly right, and REX answered it
#: with advice about `/v1/responses`. A hint that contradicts the error it sits
#: above is worse than no hint, which is spec 42 §9.2's whole rule.
UNKNOWN_MODEL = re.compile(
    r"invalid model name|model[_ ]not[_ ]found|unknown model"
    r"|no matching route|not configured in the gateway",
    re.IGNORECASE,
)

UPSTREAM_AUTH = re.compile(
    r"\b401\b|\b403\b|not authenticated|authentication_error|unauthorized|invalid[_ ]api[_ ]key",
    re.IGNORECASE,
)


def route_hint(text: str, route: ResolvedRoute | None, model: str | None = None) -> str | None:
    """The hints that only make sense once a run has a gateway.

    Each names the gateway and the address the run actually used, because the
    same sentence means four different things depending on where it was pointed.
    """
    if route is None or not route.base_url:
        return None
    where = f"'{route.gateway_name}' ({route.base_url})"

    if UNKNOWN_MODEL.search(text):
        if model:
            return (
                f"{where} does not serve '{model}'. A gateway routes on the model name, so "
                "the wrong one is a refusal from a gateway that is working perfectly — the "
                "address is fine. Check this route's model list in Manage gateways. A "
                "LiteLLM deployment that has just failed reports its cooled-down alias with "
                "this same sentence."
            )
        # The commonest way to reach here, and it is REX's own doing: a routed
        # route with no model list leaves the picker on `Default`, `Default`
        # means "say nothing", and the CLI then sends its OWN default id — a
        # first-party name no local gateway has heard of. Measured 2026-09-05.
        return (
            f"This run asked {where} for no particular model, so Codex sent its own default "
            "— a name this gateway does not serve. A routed gateway needs a model list: open "
            "Manage gateways, edit this one, and type the aliases it answers to under "
            "MODELS FOR CODEX."
        )
    if UPSTREAM_AUTH.search(text):
        ours = (
            "REX resolved the variable this route names and sent it, so check that value first. "
            if route.auth == "environment"
            else "REX sends this gateway no credential at all, so this is not about a REX login. "
        )
        return (
            f"{where} refused the request as unauthenticated. {ours}"
            "The other half is the gateway's OWN credential for whatever is behind it. "
            "Do not run `codex login` — REX never sends your Codex login to a gateway."
        )
    if NOT_FOUND.search(text):
        return (
            f"{where} serves no Responses endpoint where this route points. Codex appends "
            "`/v1/responses` itself, so this base URL must be the part before it — and an "
            "OpenAI Chat Completions endpoint is not enough. Verify, in Manage gateways, "
            "says what the server publishes."
        )
    if REFUSED.search(text):
        return (
            f"Nothing answered at {where}. The gateway is not running, it is on another port, "
            "or it closed the stream part-way. REX never falls back to api.openai.com on its "
            "own, because a local choice must not become a cloud request."
        )
    return None


def classify_error(
    error: BaseException | str,
    route: ResolvedRoute | None = None,
    model: str | None = None,
) -> str:
    """An actionable message ABOVE the SDK's own words, never instead of them."""
    text = str(error)
    hint = route_hint(text, route, model)
    return f"{hint}\n\n{text}" if hint else f"Codex error: {text}"
