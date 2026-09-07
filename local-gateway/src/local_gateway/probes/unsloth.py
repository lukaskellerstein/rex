"""Unsloth — an OpenAI-shaped listing that is richer than it looks, and thinner than it seems.

`GET /v1/models` reports every model ON DISK by id, with `quant` and `loaded` on
every row, so the NAME is never the problem. Two things it does not give, each
with a different consequence:

**The context window is reported for the LOADED model only.** Unsloth holds one
model at a time, and `context_length` is null on every other row — measured by
the reference implementation on 2026-09-03, 1 of 15 rows carried 131072. So the
window is read when it is there and left **None** when it is not. The reference
assumed 8192 at that point; this package does not, because §17 says REX writes
no limit it was not told, and a wrong small window truncates prompts silently.

**There is no type or capabilities field**, unlike LM Studio and Ollama. The
reference guessed chat-against-embedding from the id. This package does not
guess (§5.5): `unknown` is the honest answer, and an embedding model added by
hand fails at the first send with the gateway's own error.

Measured 2026-09-06: `:8888/v1/models` answered **401**, which is why the key
field on this provider exists and is optional.
"""

from ..providers import api_base, descriptor
from ..types import DiscoveredModel


def probe(provider: str, url: str | None, key: str | None) -> list[DiscoveredModel]:
    from . import auth_headers, get_json

    found = descriptor(provider)
    body = get_json(f"{api_base(provider, url)}/models", auth_headers(found, key))

    models: list[DiscoveredModel] = []
    for row in body.get("data") or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        reported = row.get("context_length") or row.get("native_context_length")
        state = "loaded" if row.get("loaded") else "not loaded"
        window = (
            "window read from the server"
            if reported
            else "window not reported — Unsloth gives it for the loaded model only"
        )
        models.append(
            DiscoveredModel(
                id=row["id"],
                context=int(reported) if reported else None,
                kind="unknown",
                tools=None,
                note=f"{row.get('quant', 'unknown quant')}, {state} when asked; {window}",
            )
        )
    return models
