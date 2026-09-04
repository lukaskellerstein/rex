"""Spec 43 §2.4 — discovery's one honest use: **verification, never guessing.**

REX cannot ask a gateway for its routes. An OpenAPI document lists paths; it
does not say that `/v1/messages` is the Anthropic Messages route the Claude SDK
needs while `/v1/chat/completions` is not. That mapping is a judgement, and
`catalogue.py` is where it was made, at the cost spec 43 §15 records.

What a document *can* do is confirm a judgement already made. So this module
asks one question and answers it plainly:

    the route says the SDK will address <base><appends>.
    does this server say that path exists?

Three rules it keeps:

* **It never rewrites a route.** Nothing here returns a URL for anything to
  store. The reviewer's answers are the reviewer's.
* **A server that publishes nothing is not penalised.** "None published" is a
  result, not a failure — MLflow answered `404` at `/openapi.json` and declared
  only `POST` routes, and it was a working gateway.
* **It spends no tokens.** Two `GET`s at most, and never a completion.

The client is the standard library's, on purpose: this is one `GET` and one
`json.loads`, and `agent-gateway`'s declared dependencies are the specs' to
choose. `httpx` arrives with spec 45, for a client that genuinely needs one.
"""

import asyncio
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from pydantic import Field

from .base import Model
from .catalogue import APPENDS
from .types import ResolvedRoute

#: A gateway that has not answered in this long is not going to.
TIMEOUT_SECONDS = 10.0

#: How many published paths cross the pipe. A large gateway publishes hundreds,
#: a host draws a handful, and the answer is diagnostics rather than data.
MAX_PATHS = 60

#: Where servers put a description of themselves, most likely first.
#:
#: `/openapi.json` is FastAPI's default and is what LiteLLM serves. `/swagger.json`
#: is the older spelling. Both are tried at the route's own path first and then at
#: the host's root, because a gateway under a prefix usually documents itself at
#: the root and serves the prefix from the same process.
DOCUMENTS = ("/openapi.json", "/swagger.json")


class VerifyResult(Model):
    """What one server said about itself, and whether it named this route's path."""

    #: The expected path was found in a document the server published.
    ok: bool
    #: The address this check was about — the route's own base URL, sanitised.
    base_url: str
    #: The path this SDK appends by itself. REX never appends it; it is asked about.
    expected: str | None = None
    #: Where the description came from, or None when the server published none.
    document: str | None = None
    #: The paths the server declared, capped. Empty when it published nothing.
    published: list[str] = Field(default_factory=list)
    #: The status of the last request that answered, for a reader who needs it.
    status: int | None = None
    #: One sentence, ready to draw.
    note: str


def _expected_path(route: ResolvedRoute) -> str | None:
    """Where this SDK will actually knock, as a path on this host.

    The route's own path plus what the SDK appends — which is the whole trap
    spec 43 §3 names: a base ending in `/v1` produces `/v1/v1/messages`, and
    seeing the doubled path written out is how a reviewer spots it.
    """
    appends = APPENDS.get(route.sdk)
    if appends is None or route.base_url is None:
        return None
    prefix = urlsplit(route.base_url).path.rstrip("/")
    return f"{prefix}{appends}"


def _origin(base_url: str) -> str:
    parts = urlsplit(base_url)
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def _headers(route: ResolvedRoute) -> dict[str, str]:
    """The same credential the run would send, to the same server and no other.

    Both spellings, for the reason spec 43 §6.3 gives: which one a server reads
    has moved between versions, and a check that fails on authentication says
    nothing about the path it was asking after.
    """
    if not route.token:
        return {"Accept": "application/json"}
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {route.token}",
        "x-api-key": route.token,
    }


def _fetch(url: str, headers: dict[str, str]) -> tuple[int | None, Any]:
    """One `GET`. Returns the status and the parsed body, or `(status, None)`.

    Never raises. Every way a gateway can fail to describe itself — refused,
    404, HTML, a truncated body — is the same answer here: "no document", which
    §2.4 says is not a failure.

    The scheme is checked here rather than trusted from the caller. `urlopen`
    also opens `file:` and `ftp:`, and a base URL that reached this far without
    `validate_base_url` having seen it must not turn a verification into a local
    file read.
    """
    if urlsplit(url).scheme not in ("http", "https"):
        return None, None

    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as answer:
            status = int(answer.status)
            body = answer.read(4 * 1024 * 1024)
    except HTTPError as refused:
        return int(refused.code), None
    except (URLError, OSError, ValueError):
        return None, None

    try:
        return status, json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return status, None


def _paths_of(document: Any) -> list[str] | None:
    """An OpenAPI document's declared paths, or None when this is not one."""
    if not isinstance(document, dict):
        return None
    paths = document.get("paths")
    if not isinstance(paths, dict):
        return None
    return sorted(str(path) for path in paths)


def verify_route_blocking(route: ResolvedRoute) -> VerifyResult:
    """The whole check, synchronously. `verify_route` is the one to call."""
    base_url = route.base_url
    if not base_url:
        return VerifyResult(
            ok=False,
            base_url="",
            note="This route uses the SDK's own endpoint, so there is nothing to verify.",
        )

    expected = _expected_path(route)
    headers = _headers(route)
    origin = _origin(base_url)
    last_status: int | None = None

    for where in (base_url.rstrip("/"), origin):
        for name in DOCUMENTS:
            status, body = _fetch(f"{where}{name}", headers)
            if status is not None:
                last_status = status
            paths = _paths_of(body)
            if paths is None:
                continue
            found = expected is not None and expected in paths
            # The path that was asked about goes first when it is there. A large
            # gateway publishes hundreds, and an alphabetical cap that hides the
            # one row the reader came for makes a correct answer look unproven.
            shown = [expected, *(path for path in paths if path != expected)] if found and expected else paths
            return VerifyResult(
                ok=found,
                base_url=base_url,
                expected=expected,
                document=f"{where}{name}",
                published=shown[:MAX_PATHS],
                status=status,
                note=(
                    f"The server publishes {expected}, which is what this route will address."
                    if found
                    else (
                        f"The server published {len(paths)} paths and {expected} is not among them. "
                        "That may still work — a gateway need not declare every route it serves."
                    )
                ),
            )

    # Nothing described itself. Envoy publishes no OpenAPI document but does
    # serve `/v1/models` under each prefix, so one more question is worth
    # asking: a 200 there says the prefix at least exists.
    models_status, _ = _fetch(f"{base_url.rstrip('/')}/v1/models", headers)
    if models_status is not None:
        last_status = models_status
    reachable = models_status is not None and 200 <= models_status < 300
    return VerifyResult(
        ok=False,
        base_url=base_url,
        expected=expected,
        document=None,
        published=[],
        status=last_status,
        note=(
            "This server publishes no description of itself, which is not a failure. "
            + (
                f"It answered {models_status} at /v1/models, so the address is reachable."
                if reachable
                else (
                    f"Its /v1/models answered {models_status}."
                    if models_status is not None
                    else "Nothing answered at that address at all."
                )
            )
        ),
    )


async def verify_route(route: ResolvedRoute) -> VerifyResult:
    """§2.4 — what the server publishes, checked against what this route needs.

    Off the event loop, because two blocking `GET`s inside it would stall every
    other run's events for as long as the gateway takes to answer.
    """
    return await asyncio.to_thread(verify_route_blocking, route)
