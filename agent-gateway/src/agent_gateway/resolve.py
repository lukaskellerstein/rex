"""Spec 42 §5.3 — turning a stored gateway into the route one run is given.

`resolve_route` exists on **both** sides of the pipe: here for a Python
consumer, and in the host for a host, because it is the host that holds the
process environment and the host that must never send an unresolved variable
name and hope.

Both take the environment as an argument rather than reading the process's, so a
test can hand them a fake — and so that "which environment did this credential
come from" is a question with an answer.
"""

from collections.abc import Mapping
from urllib.parse import urlparse

from .adapters import ADAPTERS
from .types import AgentGateway, AgentSdk, ResolvedRoute


class RouteError(ValueError):
    """A route that cannot be used, named. Never a silent fallback."""


def resolve_route(
    gateway: AgentGateway,
    sdk: AgentSdk,
    env: Mapping[str, str],
) -> ResolvedRoute:
    """The route this gateway offers this SDK, with its credential resolved.

    Raises `RouteError`, by name, for each of the three ways it can fail: the
    gateway does not offer the SDK, no adapter is built for the SDK, or the
    variable the route names is unset or empty.
    """
    if sdk not in ADAPTERS:
        raise RouteError(f"No adapter for '{sdk}'.")

    route = gateway.routes.get(sdk)
    if route is None:
        raise RouteError(f"The gateway '{gateway.name}' does not offer {sdk}.")

    token: str | None = None
    if route.auth == "environment":
        name = route.credential_env
        if not name:
            raise RouteError(f"The {sdk} route on '{gateway.name}' needs a credential but names no variable.")
        value = env.get(name)
        if not value:
            raise RouteError(f"The {sdk} route on '{gateway.name}' needs {name}, and it is not set.")
        token = value

    return ResolvedRoute(
        sdk=sdk,
        gateway_name=gateway.name,
        base_url=route.base_url,
        auth=route.auth,
        token=token,
    )


def validate_base_url(url: str) -> str:
    """An absolute `http:` or `https:` URL, trimmed. **No path is ever appended.**

    A username, a password, a query or a fragment is refused: each is a way for
    a stored gateway to carry something that is not an address, and appending a
    path is spec 43's job, done from the catalogue rather than guessed here.
    """
    trimmed = url.strip().rstrip("/")
    if not trimmed:
        raise RouteError("A gateway URL cannot be empty.")

    parsed = urlparse(trimmed)
    if parsed.scheme not in ("http", "https"):
        raise RouteError(f"A gateway URL must start with http:// or https:// — got '{url}'.")
    if not parsed.hostname:
        raise RouteError(f"A gateway URL must name a host — got '{url}'.")
    if parsed.username or parsed.password:
        raise RouteError("A gateway URL must not carry a username or a password.")
    if parsed.query or parsed.fragment:
        raise RouteError("A gateway URL must not carry a query or a fragment.")

    return trimmed
