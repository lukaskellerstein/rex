"""Spec 42 §10 — the descriptor. The library describes; the host renders.

The reviewer's requirement was that the configuration for gateway and model is
handed to the library. The library cannot ship React, so what it hands over is
**data**: which SDKs are real, which gateway kinds exist, what to ask about
each, and what each SDK gets when the answers come back.

`build_routes` and `validate_gateway` are template substitution over
`catalogue.py`, which is why the catalogue is also exported as
`catalogue.json`: a host carries the same forty lines and previews a route with
no round trip, and one test feeds both sides the same fixtures.
"""

import re

from .adapters import ADAPTERS
from .catalogue import CATALOGUE, FieldError, KindDescriptor, SdkDescriptor
from .resolve import RouteError, validate_base_url
from .types import ALL_SDKS, SDK_LABELS, AgentSdk, GatewayKind, GatewayRoute

_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")


def list_sdks() -> list[SdkDescriptor]:
    """Every SDK that has an adapter, in the order the vocabulary declares them.

    An SDK that is declared and not built is **not** listed. A host cannot offer
    a choice that would fail after the reviewer made it.
    """
    return [
        SdkDescriptor(
            id=sdk,
            label=SDK_LABELS[sdk],
            supports_styles=ADAPTERS[sdk].supports_styles,
            supports_plugins=ADAPTERS[sdk].supports_plugins,
        )
        for sdk in ALL_SDKS
        if sdk in ADAPTERS
    ]


def list_kinds() -> list[KindDescriptor]:
    """Every gateway kind, with the fields a host draws for it."""
    return list(CATALOGUE.values())


def substitute(template: str | None, values: dict[str, str]) -> str | None:
    """`{key}` becomes `values[key]`. An unknown key becomes an empty string.

    Empty rather than left as `{key}`: a half-substituted URL that still looks
    like a URL is the shape that reaches a server and fails there. An empty one
    fails validation here, with the field's name on it.
    """
    if template is None:
        return None
    return _PLACEHOLDER.sub(lambda found: values.get(found.group(1), ""), template)


def answers(descriptor: KindDescriptor, values: dict[str, str]) -> dict[str, str]:
    """The host's answers, with each field's own default filled in where it said nothing.

    Trimmed here and only here, so a pasted URL with a trailing space builds the
    same route as a typed one. A field the descriptor does not declare is passed
    through untouched: it costs nothing and a template can only read a `{key}`
    that exists.
    """
    filled = {key: (value or "").strip() for key, value in values.items()}
    for field in descriptor.fields:
        if not filled.get(field.key) and field.default is not None:
            filled[field.key] = field.default
        # A URL loses its trailing slash here, exactly as `validate_base_url`
        # would: `http://host/` and `http://host` are the same address, and a
        # route built from one that a validator approved as the other is a
        # difference spec 43 §5.2 case 2b reads as "the gateway moved" and
        # answers by throwing away a live session.
        if field.kind == "url" and filled.get(field.key):
            filled[field.key] = filled[field.key].rstrip("/")
    return filled


def build_routes(kind: GatewayKind, values: dict[str, str]) -> dict[AgentSdk, GatewayRoute]:
    """The routes this kind gives each SDK, for these answers.

    **A route whose URL template resolved to nothing is left out.** A kind that
    means to give an SDK a URL (`base_url` is a template) and got no answer for
    it describes an SDK the reviewer has not configured — `custom` with one of
    its four filled in is the ordinary case. Offering it anyway would store a
    gateway that addresses nothing, and spec 43 §4.2 already says what a missing
    route looks like on screen: present, greyed, with the reason on hover.

    `base_url=None` is the opposite and is a route: it MEANS "this SDK's own
    endpoint", which is the whole `original` kind.
    """
    descriptor = CATALOGUE.get(kind)
    if descriptor is None:
        return {}
    filled = answers(descriptor, values)

    routes: dict[AgentSdk, GatewayRoute] = {}
    for sdk, note in descriptor.routes.items():
        base_url = substitute(note.base_url, filled) or None
        if note.base_url is not None and base_url is None:
            continue
        routes[sdk] = GatewayRoute(
            base_url=base_url,
            auth=note.auth,
            credential_env=substitute(note.credential_env, filled) or None,
        )
    return routes


def validate_gateway(kind: GatewayKind, values: dict[str, str]) -> list[FieldError]:
    """What the reviewer must fix, one entry per field. Empty means it is good.

    Field by field first, then the whole gateway: a kind whose fields are all
    good can still describe a gateway that offers nothing, and "Host is
    required" is not the sentence for that.
    """
    descriptor = CATALOGUE.get(kind)
    if descriptor is None:
        return [FieldError(key="kind", message=f"There is no gateway kind called '{kind}'.")]

    filled = answers(descriptor, values)
    errors: list[FieldError] = []
    for field in descriptor.fields:
        value = filled.get(field.key) or ""
        if field.required and not value:
            errors.append(FieldError(key=field.key, message=f"{field.label} is required."))
            continue
        if not value:
            continue
        if field.kind == "url":
            try:
                validate_base_url(value)
            except RouteError as refusal:
                errors.append(FieldError(key=field.key, message=str(refusal)))
        elif field.kind == "select" and field.options is not None:
            allowed = [option.value for option in field.options]
            if value not in allowed:
                errors.append(FieldError(key=field.key, message=f"{field.label} must be one of {allowed}."))
    if errors:
        return errors

    # Spec 43 §2.2's two CHECK constraints, said in the reviewer's words before
    # the database says them in SQLite's. A row that cannot run must not be
    # creatable by any route, and a refusal that arrives as a constraint error
    # names a column rather than a field.
    routes = build_routes(kind, values)
    if not routes:
        errors.append(
            FieldError(key="kind", message=f"{descriptor.label} needs at least one URL before it can be saved.")
        )
    for sdk, route in routes.items():
        if route.auth == "environment" and not route.credential_env:
            errors.append(
                FieldError(
                    key="tokenEnv",
                    message=f"The {sdk} route needs a credential but names no variable.",
                )
            )
        if route.auth == "none" and not route.base_url:
            errors.append(FieldError(key="url", message=f"The {sdk} route has no authentication, so it needs a URL."))
    return errors
