"""Spec 46 §5.2 — the provider catalogue's types.

> **The descriptor says what to ask the person and what to write into
> `config.yaml`. It never says how to ask the provider what it serves.**

That split is the whole design, and §5.2 records why it was forced: LM Studio
answers one `GET` with everything, OpenAI answers one `GET` with almost nothing,
and Ollama needs two calls. A data language able to express that is a
programming language with worse syntax. So the shape of the question lives in
`probes/`, one function per provider, and everything else is the table below.

.. note::
   `ConfigField` is spec 42 §10's type, re-declared rather than imported.
   Spec 46 §10 forbids `local_gateway` importing `agent_runner` in either
   direction and a test asserts it, so the two packages share a *shape* and not
   a module. Keeping them in step is a review job; merging them would cost the
   seal, which is the more expensive of the two.
"""

from typing import Literal

from pydantic import Field

from .base import Model

#: Reserved out of a model's window for the reply.
#:
#: §4.4 rule 3, and the number is the reviewer's own: every hand-written config
#: in `ai-gateway/litellm/config/` reserves exactly this, which is where
#: 131072 - 8192 = 122880 comes from.
OUTPUT_RESERVE = 8192

#: Used only when a provider will not say what a model's window is.
#:
#: Small on purpose. A window that is too small refuses an over-long prompt with
#: REX's own message; one that is too large lets it through to fail deep inside
#: the engine with a worse one.
DEFAULT_CONTEXT = 8192


class ConfigField(Model):
    """One control the host draws, and one value it sends back."""

    key: str
    label: str
    #: `password` is this package's addition to spec 42's list. §8 rule 4: the
    #: screen never shows a key, not even masked-with-a-reveal, so the control
    #: that takes one is a different control from the one that takes a URL.
    kind: Literal["url", "text", "password"]
    required: bool = False
    placeholder: str | None = None
    help: str | None = None
    default: str | None = None


class ProviderDescriptor(Model):
    """One model provider: what to ask the person, and what `config.yaml` gets."""

    id: str
    label: str
    #: What `litellm_params.model` is prefixed with (§4.4).
    #:
    #: `openai/` is a PROTOCOL, not a company (§5.1). Ollama and Unsloth use it
    #: because they speak the OpenAI wire format, and `api_base` is the only
    #: thing separating them from `api.openai.com`.
    prefix: str
    fields: list[ConfigField] = Field(default_factory=list)
    #: §5.4 — free to enumerate?
    #:
    #: A local provider may be listed and ticked freely: naming everything on
    #: the disk costs nothing. A paid one bills a real account per model, so it
    #: is listed and **nothing is added without a click**.
    local: bool
    #: One sentence, drawn in Settings.
    note: str
    #: The endpoint, when the provider has a fixed one and the person gives none.
    #:
    #: Null means the person must supply it, and `fields` then carries a `url`
    #: control. It always ends at the OpenAI-compatible root, so the shared
    #: probe's `GET {api_base}/models` is the same sentence for every provider
    #: that has no probe of its own.
    default_url: str | None = None
    #: How a key is presented to the provider, for the shared probe.
    #:
    #: Data rather than a function, deliberately: it is the one thing that
    #: differs between OpenAI, OpenRouter and Anthropic, and putting it here is
    #: what lets all three share a probe and add no code (§5.3, criterion A8).
    auth: Literal["bearer", "x-api-key", "none"] = "bearer"
    #: Static headers the provider requires beside the key. Anthropic's alone.
    headers: dict[str, str] = Field(default_factory=dict)


class DiscoveredModel(Model):
    """One model a provider said it serves.

    Every probe answers this, and that is what keeps the rest of the package
    generic — the config writer, the validator and the host's screen all read
    this shape and never a provider's own.
    """

    #: The provider's own name for it, passed back **verbatim**.
    #:
    #: The one field that must never be normalised: it is what the engine is
    #: asked for. `alias` is the derived name a caller types (§11).
    id: str
    #: None when the provider does not say. Never guessed.
    context: int | None = None
    kind: Literal["chat", "embedding", "unknown"] = "unknown"
    #: None when the provider does not say (§5.5). A guess would be worse than
    #: silence: a model that cannot call tools is useless to an agent in a way
    #: that is invisible until a run silently does nothing.
    tools: bool | None = None
    #: What the probe read, in one line, for the Settings screen to show.
    note: str = ""


class ProviderQuery(Model):
    """What `discover` is told about one provider before it asks."""

    provider: str
    url: str | None = None
    key: str | None = None


class DiscoveryResult(Model):
    """What `discover` prints. A failure is a result, not a traceback."""

    provider: str
    models: list[DiscoveredModel] = Field(default_factory=list)
    #: Null when the provider answered. A sentence the host shows when it did not.
    error: str | None = None
