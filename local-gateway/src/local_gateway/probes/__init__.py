"""Spec 46 §5.2 — how to ask a provider what it serves.

**A lookup table keyed by provider id, and nothing else.** There is no
`if provider ==` here or anywhere downstream: a provider whose listing is a
plain `GET {api_base}/models` reuses `shared()` and adds no function at all,
which is what makes criterion A8 true rather than aspirational.

Three of the six need their own function, and each for a stated reason:

===========  =====================================  ==============================
provider     asked                                  why it cannot be shared
===========  =====================================  ==============================
lmstudio     ``GET /api/v0/models``                 a richer listing than /v1/models
ollama       ``GET /api/tags`` + ``POST /api/show``  **two calls** for the window
unsloth      ``GET /v1/models``                     reports quant and loaded state
===========  =====================================  ==============================

The logic is ported from `ai-gateway/litellm/discover/gateway_discovery.py`
at commit `b4ad0af` — 561 proven lines — rather than reinvented. What changed is
the answer type: that file rendered YAML directly, and these return
`DiscoveredModel` so that the config writer is the only thing that knows YAML.
"""

from collections.abc import Callable

import httpx

from ..providers import api_base, descriptor
from ..types import DiscoveredModel, ProviderDescriptor

#: Long enough for a local engine that is paging a model in, short enough that a
#: wrong address fails while the person is still looking at the screen.
TIMEOUT_SECONDS = 15.0


def auth_headers(found: ProviderDescriptor, key: str | None) -> dict[str, str]:
    """The key, presented the way this provider wants it.

    Data-driven from the descriptor (§5.2), which is the whole reason OpenAI,
    OpenRouter and Anthropic need no probe of their own: they differ in this
    header and in nothing else.
    """
    headers = dict(found.headers)
    if key:
        if found.auth == "bearer":
            headers["Authorization"] = f"Bearer {key}"
        elif found.auth == "x-api-key":
            headers["x-api-key"] = key
    return headers


def get_json(url: str, headers: dict[str, str], payload: dict | None = None) -> dict:
    """One request, one JSON body, or an exception the caller turns into a sentence."""
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = (
            client.post(url, headers=headers, json=payload) if payload is not None else client.get(url, headers=headers)
        )
        response.raise_for_status()
        body = response.json()
    if not isinstance(body, dict):
        raise ValueError(f"{url} answered with {type(body).__name__}, not an object.")
    return body


def root_of(base: str) -> str:
    """The address with `/v1` taken off.

    LM Studio's and Ollama's listings sit OUTSIDE the OpenAI-compatible surface —
    `/api/v0/models` and `/api/tags` — while `api_base` ends in `/v1` because
    that is what LiteLLM calls. Both facts are true at once, so one of them has
    to be undone here.
    """
    return base.rstrip("/").removesuffix("/v1")


def shared(provider: str, url: str | None, key: str | None) -> list[DiscoveredModel]:
    """`GET {api_base}/models` — the OpenAI listing, which carries ids and little else.

    OpenAI, OpenRouter and Anthropic all answer this and state no context window
    (§5.3). **REX writes none rather than inventing one** (§17): a limit REX made
    up is a limit that is wrong on the day the vendor changes it, and the failure
    it causes looks like REX truncating a prompt for no reason.
    """
    found = descriptor(provider)
    body = get_json(f"{api_base(provider, url)}/models", auth_headers(found, key))
    rows = body.get("data") or []
    return [
        DiscoveredModel(id=row["id"], context=None, kind="unknown", tools=None, note="")
        for row in rows
        if isinstance(row, dict) and row.get("id")
    ]


#: The three that need a function, plus every other provider falling through to
#: `shared`. Import order matters only in that these modules import from this
#: one, so they are imported at the bottom.
from .lmstudio import probe as _probe_lmstudio  # noqa: E402
from .ollama import probe as _probe_ollama  # noqa: E402
from .unsloth import probe as _probe_unsloth  # noqa: E402

Probe = Callable[[str, str | None, str | None], list[DiscoveredModel]]

PROBES: dict[str, Probe] = {
    "lmstudio": _probe_lmstudio,
    "ollama": _probe_ollama,
    "unsloth": _probe_unsloth,
}


def probe_for(provider: str) -> Probe:
    """This provider's function, or the shared one. Never a branch on the id."""
    descriptor(provider)  # refuses a provider REX does not know, with its own message
    return PROBES.get(provider, shared)
