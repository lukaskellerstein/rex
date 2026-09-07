"""The committed `catalogue.json` is what the descriptors produce.

Spec 46 §5.2 — **the library describes the configuration and the host renders
it.** REX's renderer cannot import Python, so the six descriptors are emitted as
JSON and committed, exactly as `agent-runner` ships the gateway kinds
(spec 42 §10).

A committed artefact that nothing checks is an artefact that goes stale on the
first edit and is then wrong in the one place a person is looking — the Settings
screen. So this compares the file with the module, and the fix when it fails is
one command, printed in the message.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMITTED = ROOT / "catalogue.json"

REGENERATE = "uv run python -m local_gateway catalogue > catalogue.json"


def _produced() -> str:
    result = subprocess.run(
        [sys.executable, "-m", "local_gateway", "catalogue"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def test_the_committed_catalogue_is_what_the_descriptors_produce() -> None:
    assert COMMITTED.exists(), f"{COMMITTED} is missing. Make it with: {REGENERATE}"
    assert COMMITTED.read_text() == _produced(), (
        f"catalogue.json has drifted from providers.py. Regenerate it with: {REGENERATE}"
    )


def test_it_carries_the_six_and_everything_a_screen_needs_to_draw_one() -> None:
    rows = json.loads(COMMITTED.read_text())["providers"]
    assert [row["id"] for row in rows] == [
        "lmstudio",
        "ollama",
        "unsloth",
        "openai",
        "openrouter",
        "anthropic",
    ]
    for row in rows:
        assert row["label"], f"{row['id']} has no label to draw"
        assert row["note"], f"{row['id']} has no sentence for the screen"
        # §5.4 — the screen has to know which providers bill a real account, so
        # that it can refuse to add anything without a click.
        assert isinstance(row["local"], bool)
        for field in row["fields"]:
            assert field["kind"] in {"url", "text", "password"}


def test_no_credential_is_ever_in_the_committed_file() -> None:
    """It is committed to git, so this is the one artefact that must never hold one."""
    text = COMMITTED.read_text()
    assert "sk-" not in text
    assert "Bearer " not in text
