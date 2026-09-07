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

import json
import os
import time
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

#: One body may not fill a disk. Beyond this it is recorded as a length.
MAX_BODY_CHARS = 200_000


def _traffic_dir() -> Path:
    return Path(os.environ.get(TRAFFIC_DIR_VAR) or (Path.home() / ".rex" / "gateway" / "traffic"))


def _bodies_wanted() -> bool:
    return (os.environ.get(TRAFFIC_BODIES_VAR) or "1").strip().lower() not in {"0", "false", "no", "off"}


def redact(value: Any, depth: int = 0) -> Any:
    """Everything but the credentials, at every depth.

    §14 rule 7: the callback sees the request body and the response, never an
    `api_key` and never an `Authorization` header. A test asserts that a row
    containing a key cannot be written, **because this file is the one artefact
    a person is most likely to paste into a bug report.**

    The depth cap is not tidiness. A response object can hold a cycle through a
    client, and a recursive walk that meets one never returns.
    """
    if depth > 12:
        return "…"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key)
            if _normalise(name) in SECRET_KEYS:
                continue
            out[name] = redact(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item, depth + 1) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    # A model object, a client, an exception. `str` is the only safe thing to do
    # with something this file did not define.
    return str(value)


def _shrink(value: Any) -> Any:
    """A body too large to keep is kept as its size, never truncated silently."""
    try:
        text = json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)[:MAX_BODY_CHARS]
    if len(text) <= MAX_BODY_CHARS:
        return value
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

    row: dict[str, Any] = {
        "at": datetime.now(UTC).isoformat(),
        "thread": headers.get("x-rex-thread"),
        "run": headers.get("x-rex-run"),
        "profile": headers.get("x-rex-profile"),
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
        row["request_body"] = _shrink(redact(kwargs.get("messages") or kwargs.get("input")))
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
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    with (directory / f"{day}.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, default=str, ensure_ascii=False) + "\n")
    _prune(directory)


def _prune(directory: Path) -> None:
    """30 days, and a total size cap. Oldest day deleted first (§4.6)."""
    files = sorted(directory.glob("*.jsonl"))
    if not files:
        return
    cutoff = time.time() - RETENTION_DAYS * 86400
    for path in list(files):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                files.remove(path)
        except OSError:
            pass
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
            path.unlink()
        except OSError:
            pass


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
