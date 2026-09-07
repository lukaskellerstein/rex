"""Ollama — the one provider that needs two calls, which is why the descriptor cannot describe it.

`GET /api/tags` lists what is on the disk. It carries `details.context_length`
for **some** models and omits it for others, so a second call —
`POST /api/show` — fills the window in per model.

Measured by the reference implementation on 2026-09-03: `gemma4:26b` carries it
while `gemma4:31b`, `gemma4:latest` and `nomic-embed-text` do not. `/api/show`
always has it, but files it under `<architecture>.context_length` —
`gemma4.`, `nomic-bert.`, `llama.` — so the architecture has to be **found**
rather than assumed.

This is §5.2's whole argument in one file: a data language able to express "one
GET, then a POST per row, then a key whose name you must search for" is a
programming language with worse syntax.
"""

from ..providers import api_base, descriptor
from ..types import DiscoveredModel


def probe(provider: str, url: str | None, key: str | None) -> list[DiscoveredModel]:
    from . import auth_headers, get_json, root_of

    found = descriptor(provider)
    headers = auth_headers(found, key)
    root = root_of(api_base(provider, url))
    body = get_json(f"{root}/api/tags", headers)

    models: list[DiscoveredModel] = []
    for row in body.get("models") or []:
        if not isinstance(row, dict) or not row.get("name"):
            continue
        name = row["name"]
        capabilities = row.get("capabilities") or []
        details = row.get("details") or {}
        context = details.get("context_length") or _context(root, headers, name)
        models.append(
            DiscoveredModel(
                id=name,
                context=int(context) if context else None,
                kind="embedding" if "embedding" in capabilities else "chat",
                # Ollama's `capabilities` names `tools` on models that have them,
                # and omits the key entirely on older rows. Present-and-absent is
                # a real answer; absent-because-not-reported is not, so an empty
                # list stays None rather than becoming False.
                tools=("tools" in capabilities) if capabilities else None,
                note=f"{', '.join(capabilities) or 'no capabilities reported'}; "
                f"{details.get('quantization_level', 'unknown quant')}",
            )
        )
    return models


def _context(root: str, headers: dict[str, str], name: str) -> int | None:
    """The window for a model whose `/api/tags` row omits it.

    A failure here returns None rather than raising: one model that will not
    describe itself must not cost the whole listing, and None is already the
    honest record of "the provider did not say" (§17).
    """
    from . import get_json

    try:
        body = get_json(f"{root}/api/show", headers, payload={"model": name})
    except Exception:
        return None
    for key, value in (body.get("model_info") or {}).items():
        if key.endswith(".context_length"):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None
