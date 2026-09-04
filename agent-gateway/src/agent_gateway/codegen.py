"""Spec 42 §4.3 — one contract, generated once.

The Pydantic models in `protocol.py` are the source of truth. This module turns
them into the three files that are committed beside them:

* `schema.json` — the JSON Schema of every message,
* `src/shared/agent-protocol.ts` — the host's TypeScript, **never hand-edited**,
* `catalogue.json` — the descriptor as data, so a host can preview a route
  without a round trip.

A test regenerates all three into a temporary place and fails if they differ
from what is committed, so a model edited on one side of the pipe cannot be
missed on the other.

The TypeScript is emitted from the models themselves rather than from the JSON
Schema. It is about two hundred lines either way, and reading the models means
the two hard parts come out right: a discriminated union stays a union of named
interfaces, and every field keeps the camelCase alias the wire uses.
"""

import json
from types import UnionType
from typing import Annotated, Any, Literal, Union, get_args, get_origin

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from .protocol import EXPORTED_ALIASES, EXPORTED_MODELS, PROTOCOL_VERSION

_HEADER = """// GENERATED FILE — DO NOT EDIT.
//
// Spec 42 §4.3. Written by `agent-gateway`'s Pydantic models:
//
//     uv run python -m agent_gateway.protocol --typescript > src/shared/agent-protocol.ts
//
// `test/protocol.spec.ts` regenerates this and fails when it differs, so a
// model changed on the Python side cannot be missed on this one.
//
// Every field is camelCase because the models set a camelCase alias generator
// and serialise by alias. `run_id` in Python is `runId` here and on the wire.
//
// Every field is required. The service always sends all of them, and a host
// should always send all of them — a missing field is accepted by Pydantic's
// defaults, but the contract does not promise it.

/** Bumped when a message changes shape. Carried by the `ready` message. */
export const PROTOCOL_VERSION = {version};
"""


def _alias_registry() -> dict[Any, str]:
    """Which annotations already have a name, so they are referred to and not repeated.

    An `Annotated[A | B, Field(discriminator=...)]` alias is registered twice:
    under itself, and under the bare `A | B` — because Pydantic moves the
    discriminator onto the field and leaves the plain union on the annotation,
    so a field typed with the alias arrives here without its wrapper.
    """
    registry: dict[Any, str] = {}
    for name, annotation in EXPORTED_ALIASES:
        registry[annotation] = name
        if get_origin(annotation) is Annotated:
            registry[get_args(annotation)[0]] = name
    return registry


def _lookup(registry: dict[Any, str], annotation: Any) -> str | None:
    try:
        return registry.get(annotation)
    except TypeError:
        # An unhashable annotation was never a named alias.
        return None


def _render(annotation: Any, registry: dict[Any, str], *, top: bool = False) -> str:
    """One Python annotation as one TypeScript type."""
    if not top:
        named = _lookup(registry, annotation)
        if named is not None:
            return named

    origin = get_origin(annotation)

    if origin is Annotated:
        return _render(get_args(annotation)[0], registry, top=top)
    if annotation is Any:
        return "unknown"
    if annotation is type(None):
        return "null"
    if annotation is str:
        return "string"
    if annotation is bool:
        return "boolean"
    if annotation in (int, float):
        return "number"
    if origin is Literal:
        return " | ".join(json.dumps(value) for value in get_args(annotation))
    if origin is list:
        inner = _render(get_args(annotation)[0], registry)
        return f"({inner})[]" if "|" in inner else f"{inner}[]"
    if origin is dict:
        key, value = get_args(annotation)
        rendered_value = _render(value, registry)
        rendered_key = _render(key, registry)
        if rendered_key == "string":
            return f"Record<string, {rendered_value}>"
        # A keyed-by-literal map is partial: a gateway need not offer every SDK.
        return f"Partial<Record<{rendered_key}, {rendered_value}>>"
    if origin in (Union, UnionType):
        return " | ".join(_render(arg, registry) for arg in get_args(annotation))
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation.__name__

    raise TypeError(f"agent-gateway codegen has no TypeScript for {annotation!r}")


def _doc(model: type[BaseModel]) -> str:
    """The model's own first paragraph, as a TypeScript doc comment."""
    text = (model.__doc__ or "").strip()
    if not text:
        return ""
    first = text.split("\n\n")[0]
    lines = [line.strip() for line in first.splitlines() if line.strip()]
    if len(lines) == 1:
        return f"/** {lines[0]} */\n"
    body = "\n".join(f" * {line}" for line in lines)
    return f"/**\n{body}\n */\n"


def _interface(model: type[BaseModel], registry: dict[Any, str]) -> str:
    rows = []
    for name, field in model.model_fields.items():
        key = field.alias or name
        rows.append(f"  {key}: {_render(field.annotation, registry)};")
    body = "\n".join(rows) if rows else ""
    return f"{_doc(model)}export interface {model.__name__} {{\n{body}\n}}\n"


#: The repository formats TypeScript at 100 columns. A union wider than that is
#: broken over lines here rather than left for a formatter, so the committed
#: file and a freshly generated one cannot differ over whitespace.
LINE_WIDTH = 100


def _alias(name: str, rendered: str) -> str:
    one_line = f"export type {name} = {rendered};"
    if len(one_line) <= LINE_WIDTH or " | " not in rendered:
        return one_line + "\n"
    members = "\n".join(f"  | {member}" for member in rendered.split(" | "))
    return f"export type {name} =\n{members};\n"


def typescript() -> str:
    """The whole generated module, ready to commit."""
    registry = _alias_registry()
    parts = [_HEADER.format(version=json.dumps(PROTOCOL_VERSION))]

    for name, annotation in EXPORTED_ALIASES:
        parts.append(_alias(name, _render(annotation, registry, top=True)))

    for model in EXPORTED_MODELS:
        parts.append(_interface(model, registry))

    parts.append(_catalogue_constant())
    return "\n".join(parts)


def _catalogue_constant() -> str:
    """The descriptor, inlined as a constant rather than read from a file.

    §10 wants the host to preview a route without a round trip, which means the
    catalogue has to be reachable from the host's own code. Inlining it here
    keeps that to **one** generated file and one drift test — a JSON file
    imported across the package boundary would need a bundler rule, a loader
    attribute and a path that is right in both a build and a bare test run.
    `catalogue.json` still exists beside `schema.json` for anything that wants
    the raw data.
    """
    from .describe import list_kinds, list_sdks
    from .protocol import DescribeResult

    result = DescribeResult(sdks=list_sdks(), kinds=list_kinds())
    body = json.dumps(result.model_dump(by_alias=True), indent=2, sort_keys=True)
    return (
        "/** §10 — what `describe` answers, frozen at generation time. */\n"
        f"export const CATALOGUE: DescribeResult = {body};\n"
    )


def json_schema() -> str:
    """Every message, as one JSON Schema document keyed by model name."""
    _, definitions = models_json_schema(
        [(model, "serialization") for model in EXPORTED_MODELS],
        by_alias=True,
        ref_template="#/$defs/{model}",
        title="agent-gateway protocol",
    )
    return json.dumps(definitions, indent=2, sort_keys=True) + "\n"


def catalogue_json() -> str:
    """The descriptor as data — what `describe` answers, frozen for the host."""
    from .describe import list_kinds, list_sdks
    from .protocol import DescribeResult

    result = DescribeResult(sdks=list_sdks(), kinds=list_kinds())
    return json.dumps(result.model_dump(by_alias=True), indent=2, sort_keys=True) + "\n"
