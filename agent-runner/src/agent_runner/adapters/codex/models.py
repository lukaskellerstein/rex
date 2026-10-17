"""Spec 60 §6 — what Codex offers on `Original`, asked rather than assumed.

Spec 44 §7 probed nothing, reasoning that Codex had no gateway-independent
catalogue to ask for. It has one: `AsyncCodex.models()`, public, answering in
about 210 ms with no tokens spent (measured 2026-10-17). Each row carries the
model's levels and its own level, which is everything spec 58's effort control
needs.
"""

import asyncio
from typing import Any

from openai_codex import AsyncCodex, CodexConfig
from openai_codex.generated.v2_all import Model, ReasoningEffort

from ...types import ModelChoice

#: The values that MEAN "say nothing to the SDK", as the Claude adapter has them.
#: The host strips the model before the request is built; the effort is
#: stripped by the run (spec 58 §3.1).
DEFAULT_MODEL = "default"
DEFAULT_EFFORT = "default"

#: A probe that has not answered in this long answers nothing: the picker keeps
#: the one `Default` row, and a run still works on the CLI's own default.
TIMEOUT_SECONDS = 10.0

FALLBACK = ModelChoice(
    value=DEFAULT_MODEL,
    display_name="Default",
    description="Whatever the Codex CLI is configured to use.",
)


def name_models(listed: list[Model]) -> list[ModelChoice]:
    """The CLI's rows, with `default` first, named for what it stands for today.

    `default` is not one of Codex's rows: Codex marks one model `isDefault`. REX
    keeps `default` as a row of its own anyway, because it is what "say nothing"
    means (spec 25 §5.1) and what an existing comment may have stored. It is named
    as spec 58 §7.1 names Claude's — `Recommended (GPT-5.6-Sol)` — so the two
    agents' menus read alike.
    """
    shown = [model for model in listed if not model.hidden]
    recommended = next((model for model in shown if model.is_default), None)
    first = (
        ModelChoice(
            value=DEFAULT_MODEL,
            display_name=f"Recommended ({recommended.display_name})",
            description=f"The Codex CLI's own choice today · {recommended.id}",
            effort_levels=_levels(recommended),
            default_effort=recommended.default_reasoning_effort.value,
            resolves_to=recommended.display_name,
        )
        if recommended
        else FALLBACK
    )
    return [
        first,
        *(
            ModelChoice(
                value=model.id,
                display_name=model.display_name,
                description=f"{model.description} · {model.id}",
                effort_levels=_levels(model),
                default_effort=model.default_reasoning_effort.value,
            )
            for model in shown
        ),
    ]


def effort_of(level: str | None) -> ReasoningEffort | None:
    """§6 — the level a turn is started with. `default` and none say nothing,
    so the CLI's own level for the model applies (spec 58 §3.1)."""
    return ReasoningEffort(level) if level and level != DEFAULT_EFFORT else None


def _levels(model: Model) -> list[str]:
    """The levels in the CLI's order. `max` and `ultra` are not in the SDK's
    enum, which accepts any string, so `.value` carries them through as sent."""
    return [option.reasoning_effort.value for option in model.supported_reasoning_efforts]


async def probe(env: dict[str, str] | None, cwd: str) -> tuple[list[ModelChoice], str | None]:
    """The rows, or the one fallback row and the reason it is the only one."""
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            async with AsyncCodex(config=CodexConfig(env=env, cwd=cwd)) as codex:
                listed: Any = await codex.models()
    except Exception as error:
        reason = str(error) or error.__class__.__name__
        return [FALLBACK], f"REX could not ask the Codex CLI which models it offers. {reason}"
    return name_models(list(listed.data)), None
