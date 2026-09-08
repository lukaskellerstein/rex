"""Spec 48 §4 — one route, as the LangChain chat model that answers it.

Two shapes, and which one is built is decided by whether the route has a URL:

* **a gateway** — `ChatOpenAI` against its `/v1`, in the samples' own shape
  (`1_basics/model.py:60-65`). Every gateway REX supports is a LiteLLM and every
  LiteLLM serves the OpenAI chat protocol, so there is one class for all of them
  and the alias decides who really answers (§4.1);
* **`Original`** — no URL, so the model id must be `provider:model` and the
  adapter builds that provider's own class with the key as an argument (§4.2).

**Nothing is written to `os.environ`.** The key goes into one client object that
lives for one run, which is the in-process form of spec 43 §6.2's per-child
environment. Two runs on two gateways build two clients and share nothing.
"""

from __future__ import annotations

from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from ...types import ResolvedRoute

#: §4.3 — the client library refuses an empty key and the gateway ignores the
#: value, so a route with no authentication still needs a string to send.
PLACEHOLDER_KEY = "rex-local"

#: §12.3 — a local model spends its reply budget thinking before it answers, and
#: too small a budget returns an empty `content` with no error at all. The
#: reviewer's own proxy states 8192 once for every lesson; REX states it here.
MAX_TOKENS = 8192

#: The `provider:` prefixes `Original` accepts, and the class each one builds.
#:
#: **There is no third entry and adding one is not free.** Each is a dependency
#: spec 48 §3 names, and a prefix with no class is refused BY NAME below rather
#: than reaching a constructor that does not exist.
PROVIDERS: dict[str, type[BaseChatModel]] = {
    "anthropic": ChatAnthropic,
    "openai": ChatOpenAI,
}


class ModelError(Exception):
    """A route or a model id that cannot build a client. Refused before a run."""


def build(route: ResolvedRoute, model: str | None, headers: dict[str, str] | None = None) -> BaseChatModel:
    """The chat model this run talks to. Raises `ModelError` with a sentence.

    `headers` is spec 45 §6's attribution — which REX thread is spending this —
    and it is sent only to a gateway. `Original` talks to the vendor's own API,
    and REX's book-keeping is nobody's business there.
    """
    if route.base_url:
        return _gateway_model(route, model, headers or {})
    return _original_model(route, model)


def _gateway_model(route: ResolvedRoute, model: str | None, headers: dict[str, str]) -> BaseChatModel:
    """§4.1 — `ChatOpenAI` at the route's `/v1`."""
    if not model:
        # A gateway ROUTES on the model name, so "say nothing" is never a thing
        # to say to one. `Original` is the opposite, which is why this is not
        # simply "a model is required".
        raise ModelError(
            f"'{route.gateway_name}' is a gateway, and a gateway routes on the model name — "
            "so this run needs one and was given none. Open Manage gateways, edit this "
            "gateway, and tick the models it answers to."
        )
    # `max_tokens` is the FIELD's name on both classes and both accept it, but
    # each declares a different wire ALIAS — `max_completion_tokens` here and
    # `max_tokens_to_sample` on `ChatAnthropic` — and a type checker generates
    # `__init__` from the alias. Writing two spellings for one idea is exactly
    # what the shared field name exists to avoid, so the field name is kept and
    # the checker is told why. Asserted at runtime in `test_deep_agents_model`.
    return ChatOpenAI(
        model=model,
        base_url=route.base_url,
        api_key=_key(route),
        streaming=True,
        max_tokens=MAX_TOKENS,  # pyright: ignore[reportCallIssue]
        # §12.4 item 5, measured 2026-09-07: **without this `usage_metadata` is
        # None on every message.** A streamed OpenAI response carries no usage
        # block unless `stream_options.include_usage` is asked for, and
        # `stream_usage` is what asks. Spec 48 §6 promised token counts; this
        # one argument is the whole difference between having them and not.
        stream_usage=True,
        # Spec 45 §6 and criterion 13 — which REX thread is spending this. It is
        # the one adapter where attribution costs nothing to install: REX owns
        # the client, so the headers are an argument rather than an environment
        # variable a CLI has to be persuaded to read.
        default_headers=headers or None,
    )


def _original_model(route: ResolvedRoute, model: str | None) -> BaseChatModel:
    """§4.2 — no URL, so `provider:model` names both the class and the key."""
    if not model:
        raise ModelError(
            "A Deep Agents route with no gateway needs a model written as provider:model — "
            "for example anthropic:claude-sonnet-5 — and this run was given none."
        )
    provider, _, name = model.partition(":")
    factory = PROVIDERS.get(provider)
    if factory is None or not name:
        raise ModelError(
            f"'{model}' is not a model this route can use. A Deep Agents route with no "
            "gateway names the provider itself, as one of "
            f"{', '.join(f'{key}:<model>' for key in sorted(PROVIDERS))}."
        )
    if not route.token:
        # §4.2 — LangChain has no login. `claude login`'s subscription token is a
        # Claude Code credential and `ChatAnthropic` cannot use it, so the
        # refusal has to name the variable rather than arriving as a 401 from
        # inside a run the reviewer already paid to start.
        raise ModelError(
            f"The Deep Agents route on '{route.gateway_name}' uses {provider}'s own API key, "
            f"and none was found. LangChain has no login of its own, so set "
            f"{provider.upper()}_API_KEY in REX's environment, or point this route at a gateway."
        )
    arguments: dict[str, Any] = {
        "model": name,
        "api_key": route.token,
        "streaming": True,
        "max_tokens": MAX_TOKENS,
    }
    if factory is ChatOpenAI:
        arguments["stream_usage"] = True
    return factory(**arguments)


def _key(route: ResolvedRoute) -> str:
    """§4.3 — the credential this route presents. Never read from the environment.

    The host resolved it moments ago (spec 42 §5.3) and it crossed the pipe once,
    going down. `inherit` cannot reach here: `validate()` refuses it for a route
    with a URL, because a generated OpenAI-compatible client has no login
    convention to inherit.
    """
    return route.token or PLACEHOLDER_KEY


__all__ = ["MAX_TOKENS", "PLACEHOLDER_KEY", "PROVIDERS", "ModelError", "build"]
