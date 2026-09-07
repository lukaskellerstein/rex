"""Spec 46 §4.4 — the `config.yaml` REX writes.

One file, **regenerated whole every time**, never hand-edited and never merged.
It says so in its own first line, because a generated file that does not
announce itself is a file somebody will edit once and be puzzled by twice.

The four rules of §4.4 are enforced here rather than remembered:

1. **Every model names its key explicitly**, as ``os.environ/REX_PROVIDER_<ID>``.
   A missing ``api_key`` lets LiteLLM fall back to whatever ``OPENAI_API_KEY``
   happens to be in the inherited environment, which would send a paid request
   the person never configured. `_key_reference` refuses anything else.
2. **``use_chat_completions_url_for_anthropic_messages: true``, always.** It is
   the line that makes the Claude SDK work through an ``openai/``-provider model.
3. **``max_input_tokens`` comes from the provider**, less an output reserve,
   floored at half the window — and is **absent** when the provider said nothing.
4. **No secret value is ever written into the file.** `_key_reference` is the
   only thing that produces an ``api_key`` line, and it can only produce a name.

The body is built as data and rendered with `yaml.safe_dump`, never by string
concatenation. Model ids come from a remote server (§14 rule 6), and a name
carrying a newline or a ``#`` would rewrite a hand-rendered file into something
else entirely.
"""

import re
from typing import Any

import yaml

from .base import Model
from .providers import api_base, descriptor
from .types import OUTPUT_RESERVE

#: §4.4 rule 1 — the only shape an `api_key` line may take.
#:
#: A name, upper case, in REX's own namespace. Matching it is what makes rule 4
#: structural: a value cannot be mistaken for a name, because a value does not
#: look like this.
KEY_REFERENCE = re.compile(r"^REX_PROVIDER_[A-Z0-9_]+$")

#: Prompt processing measures about 100 tokens a second on a local engine, so a
#: large prompt needs 5 to 15 minutes before its first token (spec 43 §7).
#: LiteLLM's own 600 s default expires mid-prompt, and the run then fails in a
#: way that reads as the model hanging.
REQUEST_TIMEOUT_SECONDS = 3600

#: Where the traffic callback lives (§4.6).
#:
#: Package-qualified rather than the bare ``rex_trace`` the spec sketches: a bare
#: name makes LiteLLM resolve the module off ``sys.path``, which depends on the
#: child's working directory. The installed package is addressable from
#: anywhere, and this is the same object either way.
TRAFFIC_CALLBACK = "local_gateway.rex_trace.proxy_handler_instance"


class ModelEntry(Model):
    """One ticked model, as the host asks for it to be written."""

    #: The LiteLLM `model_name` a caller types. REX generates it (§11); a person
    #: never does.
    alias: str
    provider: str
    #: The provider's own id for the model, passed through verbatim.
    model: str
    #: For a provider whose address the person gave. Ignored for a fixed one.
    url: str | None = None
    #: The name of the environment variable holding this provider's key.
    #:
    #: The host owns the naming, because the host is what guarantees it is
    #: unique across two rows of the same provider. This package only checks the
    #: shape, and refuses to write anything that is not a name.
    key_env: str
    #: The window the provider stated, or None when it stated nothing.
    context: int | None = None


class ConfigRequest(Model):
    """Everything `write-config` needs. Read as JSON on stdin."""

    models: list[ModelEntry] = []
    #: §4.6 — capture request and response bodies in the traffic log.
    traffic: bool = True


def _key_reference(name: str) -> str:
    """Rule 1 and rule 4, in the one place an `api_key` line is produced."""
    if not KEY_REFERENCE.match(name or ""):
        raise ValueError(
            f"'{name}' is not a credential reference. config.yaml holds the NAME of an "
            "environment variable and never a value, so it must look like "
            "REX_PROVIDER_<ID>."
        )
    return f"os.environ/{name}"


def max_input_tokens(context: int | None) -> int | None:
    """Rule 3 — the window, less the reply's share of it.

    The formula is the reference implementation's
    (`gateway_discovery.py` `Model.max_input_tokens`) and is copied rather than
    reinvented. The `// 2` floor stops a small window going to zero or negative.

    **None in, None out.** Where a provider states no window REX writes none
    (§17): a limit REX invented is wrong the day the vendor changes it, and the
    truncation it causes looks like REX losing part of the prompt.
    """
    if context is None:
        return None
    return max(context - OUTPUT_RESERVE, context // 2)


def build(request: ConfigRequest) -> dict[str, Any]:
    """The whole document, as data. Rendering is `render`'s job and YAML's."""
    model_list: list[dict[str, Any]] = []
    for entry in request.models:
        found = descriptor(entry.provider)
        params: dict[str, Any] = {
            "model": f"{found.prefix}{entry.model}",
            "api_base": api_base(entry.provider, entry.url),
            "api_key": _key_reference(entry.key_env),
            "timeout": REQUEST_TIMEOUT_SECONDS,
        }
        row: dict[str, Any] = {"model_name": entry.alias, "litellm_params": params}
        window = max_input_tokens(entry.context)
        if window is not None:
            row["model_info"] = {
                "max_input_tokens": window,
                "max_output_tokens": OUTPUT_RESERVE,
            }
        model_list.append(row)

    settings: dict[str, Any] = {
        # Rule 2. Global; there is no per-model override. Without it the Claude
        # Agent SDK receives NO thinking blocks from any `openai/` provider — the
        # evidence is `ai-gateway/litellm/config/settings.yaml`, measured by its
        # author across three engines.
        "use_chat_completions_url_for_anthropic_messages": True,
        # Forward what the model understands and drop the rest. It is what turns
        # "OpenCode against a GPT model" from a 400 into a call (§1.1), and it is
        # the reviewer's own pinned setting.
        "drop_params": True,
    }
    if request.traffic:
        settings["callbacks"] = TRAFFIC_CALLBACK

    return {"model_list": model_list, "litellm_settings": settings}


#: The first thing a person opening the file reads.
HEADER = """\
# Written by REX. Every edit here is lost on the next change in Settings.
#
# It holds no credential. `os.environ/REX_PROVIDER_*` is the NAME of a variable;
# the value reaches this gateway in its own process environment and is never
# written to a disk.
"""


def render(request: ConfigRequest) -> str:
    """The file's whole text."""
    body = yaml.safe_dump(build(request), sort_keys=False, allow_unicode=True, width=100)
    return f"{HEADER}\n{body}"
