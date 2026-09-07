"""Spec 46 §4.6 and §14 rule 7 — the traffic log, and the credential that must never reach it.

.. warning::
   This file is the one artefact a person is most likely to paste into a bug
   report. That is the whole reason rule 7 exists and the whole reason it is
   tested here rather than reviewed.
"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

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
