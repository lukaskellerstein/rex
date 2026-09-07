"""Spec 46 §5.1 — the six providers, as data.

These are the six the reviewer named, and they are the six their own
`ai-gateway/litellm/config/` already carries, which is why the details here are
copied rather than guessed.

> **The rule, stated precisely** (§5.2). Adding a seventh provider is a row in
> this table and **at most one** probe function. There is no `if provider ==` in
> anything that renders, validates, builds a route, or writes `config.yaml`.

.. warning::
   **Every string here comes from this file.** Never from a provider, a model,
   or a config file REX did not write. A label a remote server can set is a
   remote server writing the host's interface (§14 rule 6).
"""

from .types import ConfigField, ProviderDescriptor


#: The control every self-hosted provider needs: where it listens.
#:
#: The help says what NOT to do, because appending `/v1` by hand is the mistake
#: that produces a 404 explaining nothing — spec 43 §3's trap, and it costs a
#: live test to find every time.
def _url_field(placeholder: str) -> ConfigField:
    return ConfigField(
        key="url",
        label="Address",
        kind="url",
        required=True,
        placeholder=placeholder,
        help="Just the host and port. REX adds the rest of the path itself.",
    )


def _key_field(*, required: bool, help_text: str) -> ConfigField:
    return ConfigField(
        key="key",
        label="API key",
        kind="password",
        required=required,
        help=help_text,
    )


#: Every provider REX can put behind its own gateway.
#:
#: Ordered as the Settings screen draws them: the three that are free to
#: enumerate first, then the three that bill a real account (§5.4).
CATALOGUE: dict[str, ProviderDescriptor] = {
    "lmstudio": ProviderDescriptor(
        id="lmstudio",
        label="LM Studio",
        prefix="lm_studio/",
        fields=[_url_field("http://127.0.0.1:1234")],
        local=True,
        note=(
            "Models on this machine. LM Studio JIT-loads a model that is not resident, "
            "and a JIT load comes back at 8192 context whatever the window says — "
            "`lms ps --json` is the truth, not the app window."
        ),
        auth="none",
    ),
    "ollama": ProviderDescriptor(
        id="ollama",
        label="Ollama",
        prefix="openai/",
        fields=[_url_field("http://127.0.0.1:11434")],
        local=True,
        note=(
            "Models on this machine. `openai/` here is a protocol and not a company: "
            "Ollama speaks the OpenAI wire format, and the address is the only thing "
            "separating it from api.openai.com."
        ),
        auth="none",
    ),
    "unsloth": ProviderDescriptor(
        id="unsloth",
        label="Unsloth",
        prefix="openai/",
        fields=[
            _url_field("http://127.0.0.1:8888"),
            _key_field(
                required=False,
                help_text="Only if your server asks for one. It answers 401 on every route without it.",
            ),
        ],
        local=True,
        note=(
            "Models on this machine, one loaded at a time. It reports a context window "
            "for the loaded model only; the rest are listed without one."
        ),
    ),
    "openai": ProviderDescriptor(
        id="openai",
        label="OpenAI",
        prefix="openai/",
        fields=[
            _key_field(required=True, help_text="Stored encrypted by your operating system. Never written to a file.")
        ],
        local=False,
        note="Every model here bills your account. Nothing is added until you tick it.",
        default_url="https://api.openai.com/v1",
    ),
    "openrouter": ProviderDescriptor(
        id="openrouter",
        label="OpenRouter",
        prefix="openrouter/",
        fields=[
            _key_field(required=True, help_text="Stored encrypted by your operating system. Never written to a file.")
        ],
        local=False,
        note="Hundreds of models from many vendors. Every one of them bills your account.",
        default_url="https://openrouter.ai/api/v1",
    ),
    "anthropic": ProviderDescriptor(
        id="anthropic",
        label="Anthropic",
        prefix="anthropic/",
        fields=[
            _key_field(required=True, help_text="Stored encrypted by your operating system. Never written to a file.")
        ],
        local=False,
        note=(
            "A second hop: REX to this gateway to Anthropic, for a protocol that was "
            "already Anthropic. Worth having with an API key and no Claude subscription. "
            "For a Claude model on a Claude login, Original is the shorter path."
        ),
        default_url="https://api.anthropic.com/v1",
        auth="x-api-key",
        # Anthropic rejects a request with no version header. It is a constant of
        # the API rather than a choice, which is why it is written down once here
        # instead of being remembered at three call sites.
        headers={"anthropic-version": "2023-06-01"},
    ),
}


def descriptor(provider: str) -> ProviderDescriptor:
    """One descriptor, or a refusal that names what REX does know.

    A provider id reaches this from the host's own database, so an unknown one
    means a row survived a downgrade rather than that a person typed something.
    Naming the six is what turns that into a fixable sentence.
    """
    found = CATALOGUE.get(provider)
    if found is None:
        known = ", ".join(sorted(CATALOGUE))
        raise ValueError(f"'{provider}' is not a provider REX knows. It knows {known}.")
    return found


def api_base(provider: str, url: str | None) -> str:
    """The OpenAI-compatible root, which is what `config.yaml` and the shared probe both address.

    One function, so the two callers cannot disagree about where a provider
    lives — a config written against one root and a model list read from another
    is the failure that reads as "the gateway lists models it cannot serve".

    A provider with a fixed endpoint ignores `url` entirely; one without needs
    it, and `/v1` is appended here rather than typed by a person (§5.1's help
    text is the other half of that promise).
    """
    found = descriptor(provider)
    if found.default_url:
        return found.default_url
    if not url:
        raise ValueError(f"{found.label} needs an address, and none was given.")
    trimmed = url.rstrip("/")
    return trimmed if trimmed.endswith("/v1") else f"{trimmed}/v1"
