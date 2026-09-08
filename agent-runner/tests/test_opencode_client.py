"""Spec 47 §3 — `client.py` against a fake server.

A real socket and a real `httpx`, because what is worth asserting is the wire:
that `directory` rides on every request, that HTTP Basic is sent with the one
username OpenCode accepts, and that the SSE loop reads `data:` lines the way the
course client does. A mocked transport would assert the mock.
"""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from agent_runner.adapters.opencode.client import (
    SERVER_USER,
    HistoryEntry,
    OpenCodeClient,
    OpenCodeError,
)

PASSWORD = "pw-for-the-fake"

#: Every request the fake saw, so a test can assert what actually went out.
SEEN: list[dict[str, Any]] = []


class Fake(BaseHTTPRequestHandler):
    """Enough of `opencode serve` to drive §3's table."""

    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 — the base class's own name
        """Keep the test output readable. The signature is the base class's."""
        return

    def _record(self, body: Any = None) -> str:
        path, _, query = self.path.partition("?")
        params: dict[str, str] = {}
        for pair in query.split("&"):
            if not pair:
                continue
            name, _, value = pair.partition("=")
            params[name] = value
        SEEN.append(
            {
                "method": self.command,
                "path": path,
                "params": params,
                "authorization": self.headers.get("Authorization"),
                "body": body,
            }
        )
        return path

    def _authorised(self) -> bool:
        header = self.headers.get("Authorization") or ""
        if not header.startswith("Basic "):
            return False
        decoded = base64.b64decode(header[6:]).decode()
        return decoded == f"{SERVER_USER}:{PASSWORD}"

    def _send(self, status: int, payload: Any) -> None:
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler's own spelling
        path = self._record()
        if not self._authorised():
            self._send(401, {"error": "unauthorised"})
            return
        if path == "/global/health":
            self._send(200, {"healthy": True, "version": "1.18.27"})
        elif path == "/session/ses_known":
            self._send(200, {"id": "ses_known", "title": "REX"})
        elif path == "/session/ses_gone":
            self._send(404, {"error": "no such session"})
        elif path == "/session/ses_known/message":
            self._send(
                200,
                [
                    {"info": {"id": "m1", "role": "user"}, "parts": []},
                    {
                        "info": {
                            "id": "m2",
                            "role": "assistant",
                            "cost": 0,
                            "tokens": {"input": 7279, "output": 2},
                            "time": {"completed": 1788810986600},
                            # A field this client does not model. It must not be
                            # a validation error — spec 42 §7 rule 5.
                            "somethingNewInTheNextRelease": True,
                        },
                        "parts": [{"id": "p1", "type": "text", "text": "hello"}],
                    },
                ],
            )
        elif path == "/session/status":
            self._send(200, {})
        elif path == "/event":
            self._stream()
        else:
            self._send(404, {"error": path})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        path = self._record(json.loads(raw) if raw else None)
        if not self._authorised():
            self._send(401, {"error": "unauthorised"})
            return
        if path == "/session":
            self._send(200, {"id": "ses_new"})
        elif path.endswith("/prompt_async"):
            self._send(204, None)
        elif path.endswith("/abort"):
            self._send(200, True)
        elif path.startswith("/permission/"):
            self._send(200, True)
        else:
            self._send(404, {"error": path})

    def _stream(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for line in (
            b'data: {"type":"server.connected","properties":{}}\n\n',
            b": a comment line the client must skip\n\n",
            b"data: \n\n",
            b"data: {not json at all\n\n",
            b'data: {"type":"session.idle","properties":{"sessionID":"ses_known"}}\n\n',
        ):
            self.wfile.write(line)
        self.close_connection = True


@pytest.fixture
def server() -> Any:
    SEEN.clear()
    httpd = HTTPServer(("127.0.0.1", 0), Fake)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


async def test_directory_rides_on_every_request(server: str) -> None:
    """The course client's own default (`:347-350`), and it is how the server
    knows which project a session belongs to.

    Leaving it off silently uses the server's working directory — which for REX
    is the wrong tree by construction, and wrong in the direction that writes.
    """
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    try:
        await client.health()
        await client.create_session("REX", [{"permission": "*", "pattern": "*", "action": "ask"}])
        await client.abort("ses_known")
    finally:
        await client.aclose()
    assert SEEN, "the fake saw nothing"
    for request in SEEN:
        assert request["params"].get("directory"), request["path"]


async def test_basic_auth_is_sent_with_the_one_username_opencode_accepts(server: str) -> None:
    """§10.6 C — Bearer is 401 and so is every username but `opencode`."""
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    try:
        assert (await client.health())["version"] == "1.18.27"
    finally:
        await client.aclose()
    expected = base64.b64encode(f"{SERVER_USER}:{PASSWORD}".encode()).decode()
    assert SEEN[0]["authorization"] == f"Basic {expected}"


async def test_a_client_with_no_password_is_refused_by_the_server(server: str) -> None:
    """The failure has to be an error and not an empty answer, or a run would
    report "the model said nothing" for what is a configuration mistake."""
    client = OpenCodeClient(server, "/tmp/mirror", "")
    try:
        with pytest.raises(OpenCodeError) as refused:
            await client.health()
    finally:
        await client.aclose()
    assert refused.value.status == 401


async def test_a_session_is_created_with_its_ruleset_in_the_same_call(server: str) -> None:
    """§7.3 — never adjusted afterwards, so there is no window in which the
    default `allow` applies."""
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    rules = [{"permission": "read", "pattern": "*", "action": "allow"}]
    try:
        created = await client.create_session("REX", rules)
    finally:
        await client.aclose()
    assert created["id"] == "ses_new"
    posted = [request for request in SEEN if request["path"] == "/session"][0]
    assert posted["body"] == {"title": "REX", "permission": rules}


async def test_a_lost_session_is_a_404_and_carries_its_status(server: str) -> None:
    """§5.3 — a 404 MEANS "this server has lost it", which sends REX down its own
    replay path. Every other status means the server is unwell."""
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    try:
        assert (await client.get_session("ses_known"))["id"] == "ses_known"
        with pytest.raises(OpenCodeError) as lost:
            await client.get_session("ses_gone")
    finally:
        await client.aclose()
    assert lost.value.status == 404


async def test_history_survives_a_field_this_client_does_not_model(server: str) -> None:
    """`extra="ignore"` — a field an `opencode` release adds must not turn a
    working run into a validation error."""
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    try:
        history = await client.messages("ses_known")
    finally:
        await client.aclose()
    assert [entry.info.role for entry in history] == ["user", "assistant"]
    assistant = history[1]
    assert isinstance(assistant, HistoryEntry)
    assert assistant.info.tokens == {"input": 7279, "output": 2}
    # §6 — a private provider has no pricing table and reports 0, not nothing.
    assert assistant.info.cost == 0
    assert assistant.parts[0].text == "hello"


async def test_the_prompt_is_fire_and_forget_and_answers_204(server: str) -> None:
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    try:
        assert await client.prompt_async("ses_known", "hello", system="be brief") is None
    finally:
        await client.aclose()
    body = [request for request in SEEN if request["path"].endswith("/prompt_async")][0]["body"]
    assert body == {"parts": [{"type": "text", "text": "hello"}], "system": "be brief"}


async def test_the_sse_loop_reads_data_lines_and_survives_the_rest(server: str) -> None:
    """A comment line, an empty `data:` and one line of broken JSON.

    All three arrive on a real bus, and none of them may end a run that is
    otherwise fine — spec 42 §7 rule 5 at the lowest level there is.
    """
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    kinds: list[str] = []
    try:
        async for event in client.events():
            kinds.append(str(event.get("type")))
            if event.get("type") == "session.idle":
                break
    finally:
        await client.aclose()
    assert kinds == ["server.connected", "session.idle"]


async def test_an_idle_session_is_absent_from_status_rather_than_idle(server: str) -> None:
    """§10.6 B — `GET /session/status` reports only busy and retrying sessions,
    so it is not a liveness check and §3's table must not be read as one."""
    client = OpenCodeClient(server, "/tmp/mirror", PASSWORD)
    try:
        assert await client.status() == {}
    finally:
        await client.aclose()
