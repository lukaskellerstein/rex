"""Spec 46 §4.6 and §14 rule 7 — the traffic log, and the credential that must never reach it.

.. warning::
   This file is the one artefact a person is most likely to paste into a bug
   report. That is the whole reason rule 7 exists and the whole reason it is
   tested here rather than reviewed.
"""

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from local_gateway import rex_trace
from local_gateway.rex_trace import RexTrafficLogger, _is_traffic, _row, redact

START = datetime(2026, 9, 6, 12, 0, 0, tzinfo=UTC)
END = START + timedelta(milliseconds=427)

HEADERS = {
    "x-rex-thread": "thread-abc123",
    "x-rex-run": "run-777",
    "x-rex-profile": "read",
    # Everything below is what must never be recorded.
    "authorization": "Bearer sk-a-real-master-key",
    "x-api-key": "sk-a-real-provider-key",
    "user-agent": "claude-cli/2.0",
}

KWARGS = {
    "model": "google/gemma-4-e4b",
    "response_cost": 0.0,
    "messages": [{"role": "user", "content": "what does this paragraph mean?"}],
    # Spec 51 §3 loss 1 — none of these four reached the log, because
    # `request_body` was `kwargs["messages"]` and nothing else.
    "tools": [{"type": "function", "function": {"name": "Read"}}],
    "temperature": 0.2,
    "max_tokens": 4096,
    "stream": False,
    "litellm_params": {
        "proxy_server_request": {"headers": HEADERS},
        "api_key": "sk-another-real-key",
    },
}


class _Response:
    usage = {"prompt_tokens": 22, "completion_tokens": 2}

    def __init__(self) -> None:
        self.choices = [{"message": {"content": "it means the deadline moved."}}]


# ── what a row carries ───────────────────────────────────────────


def test_a_row_carries_spec_45s_three_headers() -> None:
    """They were attribution for a Grafana that is going away; they are now the join key."""
    row = _row(KWARGS, _Response(), START, END, None)
    assert row["thread"] == "thread-abc123"
    assert row["run"] == "run-777"
    assert row["profile"] == "read"


def test_a_row_carries_the_engines_own_model_and_not_the_alias() -> None:
    assert _row(KWARGS, _Response(), START, END, None)["model"] == "google/gemma-4-e4b"


def test_a_row_carries_the_timing_the_tokens_and_the_cost() -> None:
    row = _row(KWARGS, _Response(), START, END, None)
    assert row["ms"] == 427
    assert row["tokens_in"] == 22
    assert row["tokens_out"] == 2
    assert row["cost"] == 0.0


def test_a_failure_leaves_a_row_saying_why() -> None:
    """More than the Grafana stack gave: a request that never reached a model still records."""
    row = _row(KWARGS, None, START, END, "the upstream refused the connection")
    assert row["error"] == "the upstream refused the connection"
    assert row["thread"] == "thread-abc123"


# ── §14 rule 7 ───────────────────────────────────────────────────


def test_no_credential_survives_redaction_at_any_depth() -> None:
    dirty = {
        "api_key": "sk-1",
        "nested": {"authorization": "Bearer sk-2", "deep": [{"x-api-key": "sk-3"}]},
        "keep": "this",
    }
    text = json.dumps(redact(dirty))
    for secret in ("sk-1", "sk-2", "sk-3"):
        assert secret not in text
    assert "this" in text


def test_a_row_written_from_a_real_request_holds_no_key() -> None:
    text = json.dumps(_row(KWARGS, _Response(), START, END, None), default=str)
    for secret in ("sk-a-real-master-key", "sk-a-real-provider-key", "sk-another-real-key"):
        assert secret not in text, "a credential reached the traffic log"
    assert "Bearer" not in text


def test_only_rexs_own_headers_are_recorded_and_never_the_rest() -> None:
    """An allow-list, never a deny-list: a deny-list records the next header an SDK invents."""
    row = _row(KWARGS, _Response(), START, END, None)
    text = json.dumps(row, default=str)
    assert "claude-cli/2.0" not in text
    assert "user-agent" not in text.lower()


# ── the bodies switch (criterion A15) ────────────────────────────


def test_bodies_are_captured_by_default(monkeypatch) -> None:
    monkeypatch.delenv(rex_trace.TRAFFIC_BODIES_VAR, raising=False)
    row = _row(KWARGS, _Response(), START, END, None)
    assert "request_body" in row and "response" in row


def test_turning_bodies_off_keeps_the_timing_tokens_and_cost(monkeypatch) -> None:
    monkeypatch.setenv(rex_trace.TRAFFIC_BODIES_VAR, "0")
    row = _row(KWARGS, _Response(), START, END, None)
    assert "request_body" not in row and "response" not in row
    assert row["ms"] == 427 and row["tokens_in"] == 22 and row["cost"] == 0.0
    assert row["thread"] == "thread-abc123"


# ── spec 51 §3 — the record must be whole ────────────────────────


def test_the_whole_request_is_recorded_and_not_one_field_out_of_it() -> None:
    """Criterion A1. `request_body` was `kwargs["messages"]`, so four fields were lost."""
    body = _row(KWARGS, _Response(), START, END, None)["request_body"]
    parsed = json.loads(json.dumps(body))
    assert parsed["model"] == "google/gemma-4-e4b"
    assert parsed["messages"][0]["content"] == "what does this paragraph mean?"
    assert parsed["tools"][0]["function"]["name"] == "Read"
    assert parsed["temperature"] == 0.2
    assert parsed["max_tokens"] == 4096
    assert parsed["stream"] is False


def test_recording_the_whole_request_still_records_only_rexs_own_headers() -> None:
    """The allow-list is the half of §14 rule 7 that recording everything could have broken.

    `kwargs` now reaches `litellm_params.proxy_server_request.headers`, which
    carries every header the SDK sent. A deny-list would record the next one an
    SDK invents; the allow-list is applied at every depth instead.
    """
    body = _row(KWARGS, _Response(), START, END, None)["request_body"]
    headers = body["litellm_params"]["proxy_server_request"]["headers"]
    assert headers == {
        "x-rex-thread": "thread-abc123",
        "x-rex-run": "run-777",
        "x-rex-profile": "read",
    }


def test_a_pydantic_response_is_a_dict_and_not_its_own_repr() -> None:
    """Criterion A2. It began `ModelResponse(id='chatcmpl-…`, which nothing can parse."""
    from pydantic import BaseModel

    class Usage(BaseModel):
        prompt_tokens: int = 22
        completion_tokens: int = 2

    class Choice(BaseModel):
        finish_reason: str = "tool_calls"

    class ModelResponse(BaseModel):
        id: str = "chatcmpl-777"
        choices: list[Choice] = [Choice()]
        usage: Usage = Usage()

    parsed = json.loads(json.dumps(_row(KWARGS, ModelResponse(), START, END, None)["response"]))
    assert parsed["choices"][0]["finish_reason"] == "tool_calls"
    assert parsed["usage"]["prompt_tokens"] == 22


def test_an_object_with_no_shape_still_falls_back_to_its_string() -> None:
    """Everything that is not a Pydantic model keeps today's behaviour."""
    assert redact(object()).startswith("<object object")


def test_a_body_over_the_limit_is_stored_and_not_dropped(tmp_path: Path, monkeypatch) -> None:
    """Criterion A3. It used to be replaced by `{"omitted": …}` and lost."""
    monkeypatch.setenv(rex_trace.TRAFFIC_DIR_VAR, str(tmp_path))
    # Real prose, so this measures the SIZE rule and not the payload rule: a
    # 200 000-character run of one letter is base64 as far as anything can tell.
    huge = "The watershed report says the deadline moved. " * 5_000
    big = dict(KWARGS)
    big["messages"] = [{"role": "user", "content": huge}]
    body = _row(big, _Response(), START, END, None)["request_body"]

    assert body["overflow"].startswith(rex_trace.OVERFLOW_PREFIX)
    relative = body["overflow"][len(rex_trace.OVERFLOW_PREFIX) :]
    stored = json.loads((tmp_path / relative).read_text())
    assert stored["messages"][0]["content"] == huge


def test_an_inline_image_leaves_the_line_and_is_readable_from_its_blob(tmp_path: Path, monkeypatch) -> None:
    """Criterion A4. One 84 KB image is ~114 000 characters of base64."""
    monkeypatch.setenv(rex_trace.TRAFFIC_DIR_VAR, str(tmp_path))
    image = "data:image/png;base64," + ("iVBORw0KGgo" * 12_000)
    withimage = dict(KWARGS)
    withimage["messages"] = [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": image}}]}]

    logger = RexTrafficLogger()
    logger.log_success_event(withimage, _Response(), START, END)

    line = (tmp_path / f"{datetime.now(UTC).strftime('%Y-%m-%d')}.jsonl").read_text()
    assert "iVBORw0KGgo" not in line, "the base64 stayed in the log line"
    reference = json.loads(line)["request_body"]["messages"][0]["content"][0]["image_url"]["url"]
    assert reference.startswith(rex_trace.BLOB_PREFIX)
    relative = reference[len(rex_trace.BLOB_PREFIX) :]
    assert (tmp_path / relative).read_text() == image


def test_one_image_sent_twice_is_written_once() -> None:
    """Content-addressed: a turn that carries one image through five exchanges pays once."""
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        os.environ[rex_trace.TRAFFIC_DIR_VAR] = directory
        try:
            image = "data:image/png;base64," + ("iVBORw0KGgo" * 12_000)
            assert redact(image) == redact(image)
            blobs = list((Path(directory) / "blobs").rglob("*.b64"))
            assert len(blobs) == 1
        finally:
            del os.environ[rex_trace.TRAFFIC_DIR_VAR]


def test_a_long_piece_of_prose_is_not_mistaken_for_an_image() -> None:
    """Length alone would move a 40 KB document out of the log, which is text to read."""
    prose = "The watershed report says the deadline moved. " * 500
    assert redact(prose) == prose


def test_a_clipped_branch_says_that_it_was_clipped() -> None:
    """Rule 5. A bare `"…"` reads as something the model wrote."""
    deep: Any = "floor"
    for _ in range(rex_trace.MAX_DEPTH + 2):
        deep = {"down": deep}
    assert rex_trace.CLIPPED in json.dumps(redact(deep))


def test_the_depth_cap_is_deep_enough_for_a_whole_request() -> None:
    """12 was too shallow once `request_body` became the request rather than one field."""
    assert rex_trace.MAX_DEPTH == 32
    text = json.dumps(_row(KWARGS, _Response(), START, END, None), default=str)
    assert rex_trace.CLIPPED not in text


# ── which API surface answered ───────────────────────────────────


def test_litellms_own_call_type_names_the_surface() -> None:
    """Measured 2026-09-09: every Claude Agent SDK request recorded `anthropic_messages`."""
    assert _row({**KWARGS, "call_type": "anthropic_messages"}, None, START, END, None)["api"] == "anthropic"
    assert _row({**KWARGS, "call_type": "acompletion"}, None, START, END, None)["api"] == "openai-chat"
    assert _row({**KWARGS, "call_type": "aresponses"}, None, START, END, None)["api"] == "openai-responses"


def test_the_url_answers_when_the_call_type_does_not() -> None:
    """§4.5 — one model is reachable three ways, and the path says which was used."""
    for path, expected in (
        ("http://127.0.0.1:24334/v1/messages?beta=true", "anthropic"),
        ("http://127.0.0.1:24334/v1/chat/completions", "openai-chat"),
        ("http://127.0.0.1:24334/v1/responses", "openai-responses"),
    ):
        kwargs = {
            **KWARGS,
            "litellm_params": {"proxy_server_request": {"headers": HEADERS, "url": path}},
        }
        assert _row(kwargs, None, START, END, None)["api"] == expected, path


def test_a_request_that_cannot_be_placed_is_unplaced_and_never_guessed() -> None:
    """A guess would put two genuinely different shapes under one name."""
    assert _row(KWARGS, None, START, END, None)["api"] is None


# ── LiteLLM's own bookkeeping is not traffic ─────────────────────


def test_litellms_internal_failures_are_not_written() -> None:
    """Measured 2026-09-06: with no database LiteLLM fires `No connected db.` events.

    They name no model and carry no REX header because no REX run made them. A
    log whose first rows are internal errors reads as a broken gateway to the
    one person most likely to open it.
    """
    assert not _is_traffic({"model": "", "thread": None, "run": None, "profile": None, "error": "No connected db."})
    assert not _is_traffic({"model": None, "thread": None, "run": None, "profile": None})


def test_a_real_failure_is_still_written() -> None:
    assert _is_traffic({"model": "google/gemma-4-e4b", "error": "upstream timed out"})
    assert _is_traffic({"model": None, "thread": "thread-abc123", "error": "refused"})


# ── the file ─────────────────────────────────────────────────────


def test_one_json_line_per_request_in_a_file_per_day(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv(rex_trace.TRAFFIC_DIR_VAR, str(tmp_path))
    logger = RexTrafficLogger()
    logger.log_success_event(KWARGS, _Response(), START, END)
    logger.log_success_event(KWARGS, _Response(), START, END)

    files = list(tmp_path.glob("*.jsonl"))
    assert len(files) == 1
    assert files[0].stem == datetime.now(UTC).strftime("%Y-%m-%d")
    rows = [json.loads(line) for line in files[0].read_text().splitlines()]
    assert len(rows) == 2
    assert all(row["thread"] == "thread-abc123" for row in rows)


def test_a_broken_log_never_breaks_the_request_it_is_logging(tmp_path: Path, monkeypatch) -> None:
    """A callback that throws inside LiteLLM fails a request that was already answered."""
    monkeypatch.setenv(rex_trace.TRAFFIC_DIR_VAR, str(tmp_path / "file-not-a-dir"))
    (tmp_path / "file-not-a-dir").write_text("in the way")
    RexTrafficLogger().log_success_event(KWARGS, _Response(), START, END)  # must not raise


def test_a_day_older_than_the_retention_window_is_deleted(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv(rex_trace.TRAFFIC_DIR_VAR, str(tmp_path))
    stale = tmp_path / "2020-01-01.jsonl"
    stale.write_text('{"thread":"old"}\n')
    import os
    import time

    ancient = time.time() - (rex_trace.RETENTION_DAYS + 5) * 86400
    os.utime(stale, (ancient, ancient))

    RexTrafficLogger().log_success_event(KWARGS, _Response(), START, END)
    assert not stale.exists()


def test_deleting_a_day_deletes_that_days_blobs(tmp_path: Path, monkeypatch) -> None:
    """Criterion A6 — retention now has two jobs.

    Deleting only the `.jsonl` leaves the blob directory growing without bound
    while the log looks bounded, and the rows that named those files are gone,
    so nothing will ever ask for them again.
    """
    monkeypatch.setenv(rex_trace.TRAFFIC_DIR_VAR, str(tmp_path))
    import time

    stale = tmp_path / "2020-01-01.jsonl"
    stale.write_text('{"thread":"old"}\n')
    orphan = tmp_path / "blobs" / "2020-01-01"
    orphan.mkdir(parents=True)
    (orphan / "deadbeef.b64").write_text("an image nothing will ever ask for again")
    spilled = tmp_path / "overflow" / "2020-01-01"
    spilled.mkdir(parents=True)
    (spilled / "cafe.json").write_text("{}")

    ancient = time.time() - (rex_trace.RETENTION_DAYS + 5) * 86400
    os.utime(stale, (ancient, ancient))

    RexTrafficLogger().log_success_event(KWARGS, _Response(), START, END)
    assert not stale.exists()
    assert not orphan.exists()
    assert not spilled.exists()
