"""Spec 47 §3 — REX's own OpenCode client. Eleven calls and an SSE loop.

**There is no SDK, and that is a decision.** PyPI's `opencode-ai` is a stale
alpha (0.1.0a36) and OpenCode's server is plain HTTP with an SSE event bus, so a
wrapper would be a dependency that adds a second thing to keep in step with the
server. The reviewer, 2026-09-04: "having our own Python client for this OpenCode
HTTP server is fine with me. I don't need to have some wrapper library just to
communicate via HTTP."

Modelled on the reviewer's course client
(`vibe-coding-course/50_opencode_sdk/python/opencode_course/client.py`), cut down
to what a review comment needs: **the endpoints §3's table lists and no others.**
It grows when a spec needs a call, never because a server has one.

Two things here are not in the course client, and both were measured
(spec 47 §10.6):

* **HTTP Basic on every call, including the SSE stream.** `OPENCODE_SERVER_PASSWORD`
  is Basic auth whose username is the literal string `opencode` — Bearer, a query
  parameter and an `x-opencode-password` header are all 401.
* **`permission` on `POST /session`.** The default agent allows everything, so a
  session created without a ruleset writes files.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict

#: §10.6 C — the username OpenCode's Basic auth accepts. Any other is 401.
SERVER_USER = "opencode"

#: How long one HTTP call may take. A prompt is fire-and-forget so nothing here
#: waits on a model, but a local engine under load can make even a session
#: create sit for a while, and a client that gives up mid-run loses the stream.
REQUEST_TIMEOUT = 120.0


class OpenCodeError(RuntimeError):
    """One HTTP failure, carrying the status a caller may want to branch on.

    `status` matters in exactly one place and it is worth the class: a 404 from
    `GET /session/{id}` MEANS "this server has lost the session", which sends
    REX down its own replay path, while every other status means the server is
    unwell and the run should say so.
    """

    def __init__(self, method: str, path: str, response: httpx.Response) -> None:
        self.status = response.status_code
        self.body = response.text[:500]
        super().__init__(f"OpenCode answered HTTP {self.status} to {method} {path}: {self.body}")


class _Wire(BaseModel):
    """A shape OpenCode owns, not one REX does.

    `extra="ignore"` and never `forbid`: this models **another project's**
    payloads, and a field added by an `opencode` release must not turn a working
    run into a validation error. It is the same rule as spec 42 §7's fifth —
    what REX does not understand is dropped, not guessed and not fatal.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class ToolState(_Wire):
    """§3 — the state machine a tool part walks: pending, running, completed, error."""

    status: Literal["pending", "running", "completed", "error"] = "pending"
    input: Any = None
    output: str | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None
    title: str | None = None


class Part(_Wire):
    """One piece of one message. `type` says which of §3's five it is.

    Modelled as one class rather than a discriminated union because REX reads
    four of the types and drops the rest, and a union would need a member per
    type OpenCode ships — including `step-start` and `step-finish`, which exist
    only to be ignored (§10.5).
    """

    id: str = ""
    type: str = ""
    session_id: str = ""
    message_id: str = ""
    text: str | None = None
    tool: str | None = None
    call_id: str | None = None
    state: ToolState | None = None

    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        # OpenCode is camelCase on the wire; this package is snake_case.
        alias_generator=lambda name: {
            "session_id": "sessionID",
            "message_id": "messageID",
            "call_id": "callID",
        }.get(name, name),
    )


class MessageTime(_Wire):
    created: float | None = None
    completed: float | None = None


class MessageInfo(_Wire):
    """The `info` half of a history entry. An assistant message is done when
    `time.completed` is set — the course's own test (`2_sessions/3_…:18-19`)."""

    id: str = ""
    role: str = ""
    session_id: str = ""
    time: MessageTime | None = None
    tokens: dict[str, Any] | None = None
    cost: float | None = None

    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        alias_generator=lambda name: {"session_id": "sessionID"}.get(name, name),
    )


class HistoryEntry(_Wire):
    """`GET /session/{id}/message` returns these: one `info`, many `parts`."""

    info: MessageInfo = MessageInfo()
    parts: list[Part] = []


class PermissionRequest(_Wire):
    """`permission.asked`. The `patterns` and `metadata` are what the tool is about.

    `tool.callID` is what ties one of these to the tool part the policy is being
    asked about — and it is absent on a permission that is not a tool call, so
    nothing may require it.
    """

    id: str = ""
    session_id: str = ""
    permission: str = ""
    patterns: list[str] = []
    metadata: dict[str, Any] = {}
    tool: dict[str, str] | None = None

    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        alias_generator=lambda name: {"session_id": "sessionID"}.get(name, name),
    )


class OpenCodeClient:
    """One server, one project directory, the eleven calls §3 names."""

    def __init__(self, base_url: str, directory: str, password: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.directory = directory
        self._auth = (SERVER_USER, password) if password else None
        self._http = httpx.AsyncClient(base_url=self.base_url, timeout=REQUEST_TIMEOUT)

    async def aclose(self) -> None:
        await self._http.aclose()

    # ── the one request path ─────────────────────────────────────

    def _params(self, extra: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """`directory` on every call — the course client's own default (`:347-350`).

        It is how the server knows which project a session belongs to, and
        leaving it off silently uses the server's working directory instead,
        which for REX is the wrong tree by construction.
        """
        params = dict(extra or {})
        params.setdefault("directory", self.directory)
        return params

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        params = self._params(kwargs.pop("params", None))
        response = await self._http.request(method, path, params=params, auth=self._auth, **kwargs)
        if response.is_error:
            raise OpenCodeError(method, path, response)
        return response.json() if response.content else None

    # ── §3's table, in its order ─────────────────────────────────

    async def health(self) -> dict[str, Any]:
        """Polled during launch. `{"healthy": true, "version": "1.18.27"}`."""
        return await self.request("GET", "/global/health")

    async def create_session(self, title: str, permission: list[dict[str, str]]) -> dict[str, Any]:
        """§7.3 — a session is created WITH its ruleset, never adjusted afterwards.

        There is no window between the two in which the default `allow` applies,
        which there would be if the ruleset were a second call.
        """
        return await self.request("POST", "/session", json={"title": title, "permission": permission})

    async def get_session(self, session_id: str) -> dict[str, Any]:
        """§5.3 — validate a stored id. A 404 is the adapter's `session_exists` answer."""
        return await self.request("GET", f"/session/{session_id}")

    async def prompt_async(self, session_id: str, text: str, system: str | None = None) -> None:
        """Fire and forget. It answers 204; the run is watched on `/event`."""
        body: dict[str, Any] = {"parts": [{"type": "text", "text": text}]}
        if system:
            body["system"] = system
        await self.request("POST", f"/session/{session_id}/prompt_async", json=body)

    async def messages(self, session_id: str, limit: int = 50) -> list[HistoryEntry]:
        """§5.4 — history, for the reconciliation that runs on `session.idle`."""
        rows = await self.request("GET", f"/session/{session_id}/message", params={"limit": limit})
        return [HistoryEntry.model_validate(row) for row in rows or []]

    async def status(self) -> dict[str, Any]:
        """Every BUSY session. §10.6 B — an idle session is absent, not `"idle"`."""
        return await self.request("GET", "/session/status") or {}

    async def abort(self, session_id: str) -> None:
        """§5.4 — the reviewer's Stop. Measured to answer 200 (§10.5 proof 5)."""
        await self.request("POST", f"/session/{session_id}/abort")

    async def reply_permission(self, request_id: str, reply: str, message: str | None = None) -> None:
        """§7.1 — `once` or `reject`. **Never `always`**; the adapter enforces that."""
        body: dict[str, Any] = {"reply": reply}
        if message:
            body["message"] = message
        await self.request("POST", f"/permission/{request_id}/reply", json=body)

    async def providers(self) -> Any:
        """§7.5 — what OpenCode itself resolved. Never the model gateway directly."""
        return await self.request("GET", "/config/providers")

    async def config(self) -> Any:
        """What the inline `OPENCODE_CONFIG_CONTENT` became. Used by the spike and
        by `capabilities`, so a misread config is visible rather than mysterious."""
        return await self.request("GET", "/config")

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """The bus. `data:` lines, one JSON each — the course's own loop (`:290-299`).

        **No reconnect, and none is wanted.** The subscription lives exactly as
        long as the run and the adapter closes it; a client that silently
        reconnected would resume in the middle of a stream it had already lost
        events from, and report a partial answer as a whole one.
        """
        async with self._http.stream("GET", "/event", params=self._params(), auth=self._auth, timeout=None) as response:
            if response.is_error:
                await response.aread()
                raise OpenCodeError("GET", "/event", response)
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    yield json.loads(payload)
                except ValueError:
                    # Spec 42 §7 rule 5, at the lowest level there is: a line
                    # this client cannot read is dropped, never guessed at, and
                    # never allowed to end a run that is otherwise fine.
                    continue


__all__ = [
    "SERVER_USER",
    "HistoryEntry",
    "MessageInfo",
    "OpenCodeClient",
    "OpenCodeError",
    "Part",
    "PermissionRequest",
    "ToolState",
]
