"""Spec 46 §4.6 — the traffic log. What actually went through, per request.

Spec 45 gave a comment card a button that opens **this thread's** requests and
responses. Spec 46 milestone 3 deletes the four containers behind it, so the
gateway keeps the record itself: a LiteLLM callback, named in the config REX
writes, appending one JSON line per request.

**Failures are recorded too**, which is more than the Grafana stack gave — a
request that never reached a model still leaves a row saying why.

.. important::
   **This is what spec 45's three headers are for.** They were attribution for a
   Grafana that is going away; they are now the join key that turns a pile of
   requests into *this comment's traffic*. `x-rex-thread` is read here and is
   what the sheet filters on.

.. warning::
   **This file is a plaintext record of prompts and document text.** It holds no
   credential — `_redact` is why, and §14 rule 7 is the rule — but it does hold
   what was asked and what was answered. It lives under `~/.rex/`, outside every
   repository, and the Settings switch that turns bodies off is there because on
   someone else's machine that trade lands differently.

Nothing here may raise. A callback that throws inside LiteLLM's logging path
fails the request that was already answered, which would turn "the traffic log
is broken" into "the gateway is broken".
"""

import hashlib
import json
import os
import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from litellm.integrations.custom_logger import CustomLogger

#: Where the log goes. One file per day (§4.6).
#:
#: The host names the directory so that a test never writes into a real
#: `~/.rex`; the default is what the child gets in production.
TRAFFIC_DIR_VAR = "REX_TRAFFIC_DIR"

#: §4.6 — capture request and response bodies. `0` keeps the timing, token and
#: cost rows and drops the two big ones (criterion A15).
TRAFFIC_BODIES_VAR = "REX_TRAFFIC_BODIES"

#: 30 days, oldest day deleted first (§4.6).
RETENTION_DAYS = 30

#: The total the log may hold before the oldest day goes, whatever its age.
MAX_TOTAL_BYTES = 256 * 1024 * 1024

#: The three headers spec 45 sends, and the only request headers ever recorded.
#:
#: An allow-list and never a deny-list. A deny-list records every header a
#: future SDK invents, and `Authorization` is one of the things it would then be
#: recording (§14 rule 7).
REX_HEADERS = ("x-rex-thread", "x-rex-run", "x-rex-profile")


def _normalise(name: str) -> str:
    """One spelling for a key, so a set membership test cannot miss a synonym.

    `x-api-key`, `X-API-Key` and `x_api_key` are the same header, and a header
    that gets past this is a credential in a file people paste into bug reports.
    Applied to `SECRET_KEYS` itself as well as to every lookup, because a set
    written in one spelling and searched in another is exactly how the first
    version of this leaked (caught by `test_no_credential_survives_redaction`).
    """
    return name.strip().lower().replace("-", "_")


#: Keys whose value is a credential wherever it appears. Removed from anything
#: this file writes, at every depth.
SECRET_KEYS = frozenset(
    _normalise(name)
    for name in (
        "api_key",
        "apikey",
        "authorization",
        "x-api-key",
        "x-goog-api-key",
        "proxy_server_request_headers",
        "master_key",
        "litellm_master_key",
        "aws_secret_access_key",
        "aws_access_key_id",
        "bearer",
        "token",
        "access_token",
        "refresh_token",
        "password",
        "secret",
        "cookie",
        "set-cookie",
    )
)

#: Bigger than this and the body goes to its own file (spec 51 §3.1 rule 3).
#:
#: The number has not changed; what happens at it has. It used to DELETE the
#: body and leave `{"omitted": …}`, which is the one loss depth 4 cannot draw
#: around.
MAX_BODY_CHARS = 200_000

#: Spec 51 §3.1 rule 5 — how deep `redact` walks before it stops.
#:
#: 12 was too shallow for a whole request: `kwargs.litellm_params.metadata…`
#: reaches eight levels before the messages start. The cap is still a cap — a
#: response object can hold a cycle through a client, and a recursive walk that
#: meets one never returns.
MAX_DEPTH = 32

#: What a clipped branch says. Never `"…"`: spec 51 §3.1 rule 5 is that a clip
#: must be impossible to mistake for the model's own text.
CLIPPED = f"rex-clipped: deeper than {MAX_DEPTH} levels"

#: Spec 51 §3.1 rule 4 — a string this long is not prose, it is a payload.
#:
#: One 84 KB image is about 114 000 characters of base64. Left inline it trips
#: `MAX_BODY_CHARS` on its own, and it drowns both the log and the 30-day
#: retention. 4 096 is comfortably above any real sentence and far below any
#: real image.
MAX_INLINE_CHARS = 4_096

#: The prefix a blob reference wears, so a reader can tell one from a string the
#: model wrote. `blobs/<day>/<sha256>.b64` follows it.
BLOB_PREFIX = "rex-blob:"

#: The prefix an overflowed body's file wears, for the same reason.
OVERFLOW_PREFIX = "rex-overflow:"

#: `data:image/png;base64,…`, which is how both SDK shapes carry an image.
_DATA_URI = re.compile(r"^data:[^;,]{0,120};base64,", re.IGNORECASE)

#: Base64 and nothing else. An Anthropic `source.data` is bare base64 with no
#: `data:` prefix, so length alone cannot separate it from a long document.
#:
#: No whitespace, deliberately: an image arrives as one unbroken string, and
#: allowing spaces made a long piece of plain prose match. The length test in
#: `_is_payload` is the second half of the same guard.
_BASE64_ONLY = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


#: Which API surface a request used, and the reason the traffic view can align
#: two shapes that are genuinely different.
#:
#: Spec 46 §4.5 — LiteLLM answers `/v1/messages`, `/v1/chat/completions` and
#: `/v1/responses` from the same `model_name`, so one model REX offers is
#: reachable three ways and which one an SDK picked is invisible in the model
#: name. It is not invisible in the messages: Anthropic puts a tool call in a
#: `tool_use` content block and its result in a **user** message, while OpenAI
#: puts the call in `tool_calls` and its result in a **tool** message. A reader
#: comparing two agents needs to know which they are looking at.
API_ANTHROPIC = "anthropic"
API_OPENAI_CHAT = "openai-chat"
API_OPENAI_RESPONSES = "openai-responses"

#: LiteLLM's own word for the call, which is the most direct signal there is.
#: Measured against `~/.rex/gateway/traffic/` on 2026-09-09: every Claude Agent
#: SDK request recorded `anthropic_messages`.
_CALL_TYPES = {
    "anthropic_messages": API_ANTHROPIC,
    "completion": API_OPENAI_CHAT,
    "acompletion": API_OPENAI_CHAT,
    "text_completion": API_OPENAI_CHAT,
    "atext_completion": API_OPENAI_CHAT,
    "responses": API_OPENAI_RESPONSES,
    "aresponses": API_OPENAI_RESPONSES,
}

#: The path the request actually arrived on, when `call_type` says nothing.
_PATHS = (
    ("/v1/messages", API_ANTHROPIC),
    ("/v1/chat/completions", API_OPENAI_CHAT),
    ("/v1/responses", API_OPENAI_RESPONSES),
)


def _api_of(kwargs: dict[str, Any]) -> str | None:
    """Which of the three surfaces this request came in on.

    `call_type` first because it is LiteLLM's own answer, then the URL, and
    then nothing — a request REX cannot place is recorded as unplaced rather
    than guessed into one of the three. The view draws "—" for it, which is the
    truth, where a guess would have a reader comparing two shapes under one
    name.
    """
    named = _CALL_TYPES.get(str(kwargs.get("call_type") or "").strip().lower())
    if named:
        return named

    params = kwargs.get("litellm_params") or {}
    for source in ((params.get("proxy_server_request") or {}), (kwargs.get("proxy_server_request") or {})):
        url = source.get("url") if isinstance(source, dict) else None
        if not isinstance(url, str):
            continue
        for path, api in _PATHS:
            if path in url:
                return api
    return None


def _traffic_dir() -> Path:
    return Path(os.environ.get(TRAFFIC_DIR_VAR) or (Path.home() / ".rex" / "gateway" / "traffic"))


def _day() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _blob_dir() -> Path:
    """One directory per day, so retention deletes blobs with the day that made them."""
    return _traffic_dir() / "blobs" / _day()


def _overflow_dir() -> Path:
    return _traffic_dir() / "overflow" / _day()


def _bodies_wanted() -> bool:
    return (os.environ.get(TRAFFIC_BODIES_VAR) or "1").strip().lower() not in {"0", "false", "no", "off"}


def _is_payload(text: str) -> bool:
    """A long base64 blob, as opposed to a long piece of prose.

    Both SDK shapes are caught: OpenAI sends `data:image/png;base64,…` under
    `image_url.url`, and Anthropic sends bare base64 under `source.data`. Length
    alone would also catch a 40 KB document, which is text a reviewer wants to
    read — so the string has to be base64 and nothing else.
    """
    if len(text) <= MAX_INLINE_CHARS:
        return False
    if _DATA_URI.match(text):
        return True
    # Bare base64 is padded to a multiple of four, always. It costs nothing to
    # check and it is what stops a long unbroken run of letters — which is
    # otherwise indistinguishable — from being carried off to a file.
    return len(text) % 4 == 0 and bool(_BASE64_ONLY.match(text))


def _store_blob(text: str) -> str | None:
    """Write one payload once, named by its own hash, and give back the reference.

    Content-addressed, so an image carried through five exchanges of a turn is
    on the disk once. Returns None when it cannot be written, and the caller
    then keeps the string inline — a body may be absent, but it may never be
    wrong (spec 51 §10 rule 4).
    """
    try:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        directory = _blob_dir()
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{digest}.b64"
        if not path.exists():
            path.write_text(text, encoding="utf-8")
        return f"{BLOB_PREFIX}blobs/{_day()}/{digest}.b64"
    except OSError:
        return None


def _headers_allowed(value: dict[str, Any]) -> dict[str, Any]:
    """Spec 45's three headers out of a header map, and never a fourth.

    Recording the whole request (spec 51 §3.1 rule 1) means `kwargs` now reaches
    `litellm_params.proxy_server_request.headers`, which carries every header
    the SDK sent. `REX_HEADERS` is an **allow-list and never a deny-list** — a
    deny-list records every header a future SDK invents — so the allow-list is
    applied here, at every depth, rather than only where `_headers_of` looks.
    """
    out: dict[str, Any] = {}
    for key, item in value.items():
        if str(key).strip().lower() in REX_HEADERS:
            out[str(key)] = item
    return out


def redact(value: Any, depth: int = 0) -> Any:
    """Everything but the credentials, at every depth.

    §14 rule 7: the callback sees the request body and the response, never an
    `api_key` and never an `Authorization` header. A test asserts that a row
    containing a key cannot be written, **because this file is the one artefact
    a person is most likely to paste into a bug report.**

    The depth cap is not tidiness. A response object can hold a cycle through a
    client, and a recursive walk that meets one never returns.

    Spec 51 §3.1 adds three things and takes none away: a Pydantic model becomes
    a dict instead of its own repr, a header map keeps only spec 45's three, and
    a base64 payload becomes a reference to a file.
    """
    if depth > MAX_DEPTH:
        return CLIPPED
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key)
            if _normalise(name) in SECRET_KEYS:
                continue
            if _normalise(name) == "headers" and isinstance(item, dict):
                out[name] = redact(_headers_allowed(item), depth + 1)
                continue
            out[name] = redact(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item, depth + 1) for item in value]
    if isinstance(value, str):
        if _is_payload(value):
            return _store_blob(value) or value
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    # Spec 51 §3.1 rule 2 — a Pydantic model is a dict, and that is what gives
    # depth 4 a finish reason, a usage object and structured `tool_calls`. Until
    # this, `response` was `ModelResponse(id='chatcmpl-…` — a repr string, which
    # nothing can parse and nothing can fold.
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return redact(dump(), depth + 1)
        except Exception:  # noqa: BLE001 - a model that will not dump is not worth failing over
            pass
    # A client, an exception, something with no shape. `str` is the only safe
    # thing to do with something this file did not define.
    return str(value)


def _shrink(value: Any) -> Any:
    """A body too large for the line is stored beside it, never dropped.

    Spec 51 §3.1 rule 3. It used to be replaced by `{"omitted": …}`, which is
    the one loss depth 4 cannot draw around: the row says a body existed and
    gives no way to read it. Now the line carries a reference and the body
    carries on existing.

    The `omitted` marker survives as the fallback for a body that cannot be
    written to disk at all — the only case where a body may still be absent.
    """
    try:
        text = json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)[:MAX_BODY_CHARS]
    if len(text) <= MAX_BODY_CHARS:
        return value
    try:
        directory = _overflow_dir()
        directory.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}.json"
        (directory / name).write_text(text, encoding="utf-8")
        return {"overflow": f"{OVERFLOW_PREFIX}overflow/{_day()}/{name}", "chars": len(text)}
    except OSError:
        return {"omitted": f"{len(text)} characters, over the {MAX_BODY_CHARS} limit"}


def _headers_of(kwargs: dict[str, Any]) -> dict[str, str]:
    """Spec 45's three headers, wherever LiteLLM filed them this version.

    Two places are checked because the proxy moves the request between them and
    which one carries it is not a stable part of LiteLLM's contract. Missing is
    a real answer: a run started before the headers existed simply has none.
    """
    found: dict[str, str] = {}
    params = kwargs.get("litellm_params") or {}
    candidates = [
        (params.get("proxy_server_request") or {}).get("headers") or {},
        (kwargs.get("proxy_server_request") or {}).get("headers") or {},
        (params.get("metadata") or {}).get("headers") or {},
    ]
    for source in candidates:
        if not isinstance(source, dict):
            continue
        for name in REX_HEADERS:
            value = source.get(name) or source.get(name.title())
            if value and name not in found:
                found[name] = str(value)[:128]
    return found


def _row(kwargs: dict[str, Any], response: Any, start: Any, end: Any, error: str | None) -> dict[str, Any]:
    headers = _headers_of(kwargs)
    usage = {}
    try:
        usage = dict(getattr(response, "usage", None) or (response or {}).get("usage") or {})
    except (AttributeError, TypeError, ValueError):
        usage = {}

    # How many messages this request SENT, counted from the request itself and
    # written on the row.
    #
    # It has to be recorded here rather than derived by the reader, because a
    # real conversation overflows: measured against `~/.rex/gateway/traffic/` on
    # 2026-09-09, every exchange of a live Claude Code turn was 1.1–1.2 MB, so
    # `request_body` became `{"overflow": …}` and a reader counting `messages`
    # on the row found nothing. Every exchange showed "? messages".
    sent = kwargs.get("messages")
    row: dict[str, Any] = {
        "at": datetime.now(UTC).isoformat(),
        "thread": headers.get("x-rex-thread"),
        "run": headers.get("x-rex-run"),
        "profile": headers.get("x-rex-profile"),
        "messages": len(sent) if isinstance(sent, list) else None,
        # Which of §4.5's three surfaces answered. On the ROW and not derived by
        # the reader, for the reason `messages` is: a real body overflows to a
        # file, and a reader that had to open one to learn the shape would open
        # every one of them to draw a list.
        "api": _api_of(kwargs),
        # The ENGINE's own id, not the alias REX generated — which is the one
        # that says what actually answered.
        "model": kwargs.get("model"),
        "ms": _elapsed_ms(start, end),
        "tokens_in": usage.get("prompt_tokens"),
        "tokens_out": usage.get("completion_tokens"),
        "cost": kwargs.get("response_cost"),
        "error": error,
    }
    if _bodies_wanted():
        # Spec 51 §3.1 rule 1 — the REQUEST, not one field out of it. It was
        # `kwargs["messages"]`, so `tools`, `temperature`, `max_tokens`,
        # `stream` and `tool_choice` were never recorded at all, and depth 4
        # could not say what the model was actually asked to do.
        row["request_body"] = _shrink(redact(kwargs))
        row["response"] = _shrink(redact(response))
    return row


def _elapsed_ms(start: Any, end: Any) -> int | None:
    try:
        return int((end - start).total_seconds() * 1000)
    except (TypeError, AttributeError):
        return None


def _write(row: dict[str, Any]) -> None:
    directory = _traffic_dir()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f"{_day()}.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, default=str, ensure_ascii=False) + "\n")
    _prune(directory)


def _drop_day(directory: Path, path: Path) -> None:
    """Delete one day's log, and everything that day's rows point at.

    Spec 51 §3's warning: **retention now has two jobs.** A day's blobs and
    overflowed bodies are files of their own, so deleting only the `.jsonl`
    leaves them behind — the log looks bounded while the directory beside it
    grows without limit, and the rows that named those files are gone, so
    nothing will ever ask for them again.
    """
    try:
        path.unlink()
    except OSError:
        return
    for kind in ("blobs", "overflow"):
        side = directory / kind / path.stem
        try:
            for file in side.iterdir():
                file.unlink()
            side.rmdir()
        except OSError:
            # Not there, or something else is in it. Neither is worth failing a
            # request that was already answered.
            pass


def _prune(directory: Path) -> None:
    """30 days, and a total size cap. Oldest day deleted first (§4.6)."""
    files = sorted(directory.glob("*.jsonl"))
    if not files:
        return
    cutoff = time.time() - RETENTION_DAYS * 86400
    for path in list(files):
        try:
            stale = path.stat().st_mtime < cutoff
        except OSError:
            continue
        if stale:
            _drop_day(directory, path)
            files.remove(path)
    total = 0
    for path in files:
        try:
            total += path.stat().st_size
        except OSError:
            pass
    for path in files:
        if total <= MAX_TOTAL_BYTES:
            break
        try:
            total -= path.stat().st_size
        except OSError:
            continue
        _drop_day(directory, path)


class RexTrafficLogger(CustomLogger):
    """One JSON line per request, success or failure."""

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time) -> None:  # noqa: ANN001
        self._record(kwargs, response_obj, start_time, end_time, None)

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time) -> None:  # noqa: ANN001
        reason = kwargs.get("exception") or response_obj
        self._record(kwargs, None, start_time, end_time, str(reason) if reason else "the request failed")

    def log_success_event(self, kwargs, response_obj, start_time, end_time) -> None:  # noqa: ANN001
        self._record(kwargs, response_obj, start_time, end_time, None)

    def log_failure_event(self, kwargs, response_obj, start_time, end_time) -> None:  # noqa: ANN001
        reason = kwargs.get("exception") or response_obj
        self._record(kwargs, None, start_time, end_time, str(reason) if reason else "the request failed")

    def _record(self, kwargs, response, start, end, error) -> None:  # noqa: ANN001
        """Never raises. A broken log must not break the request it is logging."""
        try:
            row = _row(kwargs or {}, response, start, end, error)
            if _is_traffic(row):
                _write(row)
        except Exception:  # noqa: BLE001
            pass


def _is_traffic(row: dict[str, Any]) -> bool:
    """Was this a request through the gateway, or LiteLLM talking to itself?

    Measured 2026-09-06: with no database, LiteLLM fires a failure event reading
    ``No connected db.`` for its own spend bookkeeping, and one reading ``No api
    key passed in.`` for an unauthenticated probe. Both are real events and
    neither is traffic — they name no model and carry none of spec 45's headers,
    because no REX run made them.

    Writing them would be worse than noise. §4.6's file is what the comment
    card's button reads, and a log whose first four rows are internal errors
    reads as a broken gateway to the one person most likely to look.

    So the test is what the row can be attributed to: a model, or a REX header.
    **A genuine failure keeps both** — a run that is refused still sends
    ``x-rex-thread`` — so this drops the bookkeeping without dropping the
    failures §4.6 exists to record.
    """
    return bool(row.get("model") or row.get("thread") or row.get("run") or row.get("profile"))


#: What `config.yaml`'s `callbacks:` names (§4.4).
proxy_handler_instance = RexTrafficLogger()
