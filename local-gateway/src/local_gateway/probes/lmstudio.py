"""LM Studio — the richest answer of the six, and the only one that states tool support.

`GET /api/v0/models` is LM Studio's own REST listing. Its plain `/v1/models`
carries `id`, `object` and `owned_by` and nothing else, which is why the richer
path is worth knowing per provider rather than assuming one shape for all
(§5.3).

Measured 2026-09-06, 14 models::

    {
        "id": "google/gemma-4-e4b",
        "type": "vlm",
        "state": "loaded",
        "max_context_length": 131072,
        "quantization": "4bit",
        "capabilities": ["tool_use"],
    }

Every model ON DISK is listed, with `state` saying which are resident. Both are
offered: LM Studio JIT-loads a model that is not loaded, so a not-loaded model
answers on the first call — just slowly.
"""

from ..providers import api_base, descriptor
from ..types import DiscoveredModel

#: LM Studio's `type` field. `vlm` is a vision-capable llm, still a chat route.
CHAT_TYPES = frozenset({"llm", "vlm"})


def probe(provider: str, url: str | None, key: str | None) -> list[DiscoveredModel]:
    from . import auth_headers, get_json, root_of

    found = descriptor(provider)
    body = get_json(
        f"{root_of(api_base(provider, url))}/api/v0/models",
        auth_headers(found, key),
    )

    models: list[DiscoveredModel] = []
    for row in body.get("data") or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        row_type = row.get("type") or ""
        if row_type in CHAT_TYPES:
            kind = "chat"
        elif row_type == "embeddings":
            kind = "embedding"
        else:
            # A type this package does not know how to serve. Listed as unknown
            # rather than dropped: the person can still see it and decide.
            kind = "unknown"
        capabilities = row.get("capabilities") or []
        models.append(
            DiscoveredModel(
                id=row["id"],
                context=int(row["max_context_length"]) if row.get("max_context_length") else None,
                kind=kind,
                # The only provider of the six that states this (§5.5). Where a
                # provider says nothing REX says nothing; here it says.
                tools="tool_use" in capabilities,
                note=f"{row_type or 'unknown type'}, {row.get('quantization', 'unknown quant')}, "
                f"{row.get('state', 'unknown state')} when asked",
            )
        )
    return models
