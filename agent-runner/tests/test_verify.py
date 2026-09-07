"""Spec 43 §2.4 — verification, and the three rules that keep it honest.

The point of these tests is what verification must NOT do. It must not rewrite a
route, it must not call a model, and it must not report a server that publishes
nothing as broken. A check that fails a working gateway is worse than no check,
because the reviewer then distrusts the one that would have caught a real fault.

Every test here runs against a throwaway HTTP server in this process. Nothing
reaches the network, and nothing needs a gateway to be running.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from agent_runner import ResolvedRoute, verify_route_blocking

LITELLM_SHAPED = {
    "openapi": "3.1.0",
    "paths": {
        "/v1/messages": {"post": {}},
        "/v1/chat/completions": {"post": {}},
        "/health/liveliness": {"get": {}},
    },
}


class _Handler(BaseHTTPRequestHandler):
    document: Any = None
    seen: list[str] = []

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler's own spelling
        type(self).seen.append(self.path)
        # The document lives at the ROOT and nowhere else, which is the shape a
        # gateway serving prefixes actually has: one process, one description of
        # itself, several paths served under it.
        if self.path == "/openapi.json" and type(self).document is not None:
            body = json.dumps(type(self).document).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 — the base class's own name
        """Quiet. The test runner's output is not this server's log."""


@pytest.fixture
def server():
    _Handler.document = None
    _Handler.seen = []
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}", _Handler
    httpd.shutdown()
    httpd.server_close()


def route_to(base_url: str | None, **extra: Any) -> ResolvedRoute:
    return ResolvedRoute(
        sdk="claude-agent",
        gateway_name="Under test",
        base_url=base_url,
        auth="none",
        **extra,
    )


def test_a_published_path_that_matches_the_route_is_confirmed(server) -> None:
    host, handler = server
    handler.document = LITELLM_SHAPED
    found = verify_route_blocking(route_to(host))
    assert found.ok
    assert found.expected == "/v1/messages"
    assert found.document == f"{host}/openapi.json"
    # The path asked about goes first, so a cap on a long list cannot hide it.
    assert found.published[0] == "/v1/messages"


def test_the_v1_trap_is_visible_as_the_doubled_path_it_produces(server) -> None:
    """Spec 43 §3 — the SDK appends `/v1/messages` itself, so a base ending in
    `/v1` produces `/v1/v1/messages` and a 404 that explains nothing. Seeing the
    doubled path written out is how a reviewer spots it."""
    host, handler = server
    handler.document = LITELLM_SHAPED
    found = verify_route_blocking(route_to(f"{host}/v1"))
    assert found.expected == "/v1/v1/messages"
    assert not found.ok
    assert "not among them" in found.note


def test_a_server_that_publishes_nothing_is_not_a_failure(server) -> None:
    """§4.5 — "none published" is a result. MLflow answered 404 at
    `/openapi.json` and was a working gateway."""
    host, _ = server
    found = verify_route_blocking(route_to(host))
    assert not found.ok
    assert found.document is None
    assert found.published == []
    assert "publishes no description of itself, which is not a failure" in found.note


def test_nothing_at_the_address_at_all_says_so_plainly() -> None:
    found = verify_route_blocking(route_to("http://127.0.0.1:1"))
    assert not found.ok
    assert found.status is None
    assert "Nothing answered at that address" in found.note


def test_a_route_with_no_url_has_nothing_to_verify() -> None:
    """`Original` addresses the SDK's own endpoint, which is not REX's to check."""
    found = verify_route_blocking(route_to(None))
    assert not found.ok
    assert "nothing to verify" in found.note


def test_the_document_is_looked_for_under_the_prefix_and_at_the_root(server) -> None:
    """A gateway under a prefix usually documents itself at the root, and serves
    the prefix from the same process — Envoy's shape."""
    host, handler = server
    handler.document = LITELLM_SHAPED
    found = verify_route_blocking(route_to(f"{host}/anthropic"))
    assert handler.seen[0] == "/anthropic/openapi.json"
    assert found.document == f"{host}/openapi.json"
    # And the expected path is still the one this route will really address.
    assert found.expected == "/anthropic/v1/messages"


def test_verification_never_returns_a_url_for_anything_to_store(server) -> None:
    """The one rule that separates verifying from guessing.

    `base_url` echoes what it was given and no field carries a correction, so
    there is nothing here a caller could mistake for a route to save.
    """
    host, handler = server
    handler.document = LITELLM_SHAPED
    given = f"{host}/v1"
    found = verify_route_blocking(route_to(given))
    assert found.base_url == given
    assert set(found.model_dump()) == {
        "ok",
        "base_url",
        "expected",
        "document",
        "published",
        "status",
        "note",
    }


def test_a_scheme_that_is_not_http_is_never_opened(tmp_path) -> None:
    """`urlopen` also opens `file:`. A base URL that reached here without
    `validate_base_url` having seen it must not turn a check into a file read."""
    secret = tmp_path / "secret.json"
    secret.write_text(json.dumps({"paths": {"/v1/messages": {}}}))
    found = verify_route_blocking(route_to(f"file://{secret.parent}"))
    assert not found.ok
    assert found.document is None
    assert found.status is None
