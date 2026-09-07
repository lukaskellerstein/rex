"""Spec 42 §9.3 — where the Claude CLI keeps its transcripts.

The CLI's transcript directory is an SDK's own cache, and reading it the way the
SDK does is exactly the kind of file §3.2 allows. It is **not** the library's
state: nothing is written here, and nothing outlives a run.

The host's own record of a conversation is the host's business. This module
answers one question — can the SDK still resume this session — so that a host
whose thread has outlived the cache knows to seed a fresh one instead.
"""

import os
import re
from pathlib import Path

from claude_agent_sdk import get_session_info, project_key_for_directory

from ...types import SessionState


def config_dir() -> Path:
    """Claude Code's own configuration directory.

    `CLAUDE_CONFIG_DIR` overrides `~/.claude`, and it is not exotic — this
    machine sets one. A hardcoded `~/.claude` therefore names a file that does
    not exist while the SDK writes the session somewhere else entirely, which is
    invisible until something asks the filesystem rather than the SDK.
    """
    override = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(override) if override else Path.home() / ".claude"


def project_dir_names(cwd: str) -> list[str]:
    """Every name the CLI might have given this working directory's folder.

    Two rules, tried in order, because they can disagree and a wrong answer here
    reads as "the session is gone":

    1. The SDK's own `project_key_for_directory`, which is the CLI's real rule —
       realpath, Unicode normalisation, and a hashed name for a long path.
    2. The plain substitution the host used before the library existed: every
       character outside ``[A-Za-z0-9]`` replaced by a dash.

    Both are only a fallback. `get_session_info` is asked first and answers for
    the default store without any path arithmetic at all.
    """
    names = [re.sub(r"[^A-Za-z0-9]", "-", cwd)]
    try:
        key = project_key_for_directory(cwd)
    except Exception:
        return names
    return [key, *names] if key not in names else names


def session_file_paths(cwd: str, session_id: str) -> list[Path]:
    """Where the transcript for this session could be, best guess first."""
    root = config_dir() / "projects"
    return [root / name / f"{session_id}.jsonl" for name in project_dir_names(cwd)]


def session_state(cwd: str, session_id: str) -> SessionState:
    """What the SDK has for this session, and what is on disk for it.

    `get_session_info` is the SDK's own supported answer — Vex reached into
    `claude_agent_sdk._internal.sessions` for this, which is a private import
    and breaks on a version bump. The path check stays as a fallback for the
    case where the session store is not the default one.

    Both are reported, never merged. `exists` is true when either can serve a
    resume; `summary` and `path` say which one actually did.
    """
    record = None
    try:
        record = get_session_info(session_id, cwd)
    except Exception:
        # The SDK could not answer at all — the filesystem is the fallback.
        record = None

    found: Path | None = None
    for candidate in session_file_paths(cwd, session_id):
        if candidate.exists():
            found = candidate
            break
    # Name the first guess even when nothing is there: "the file is missing" is
    # only useful next to the path that was looked at.
    shown = found or session_file_paths(cwd, session_id)[0]

    return SessionState(
        exists=record is not None or found is not None,
        summary=record.summary if record else None,
        last_modified=record.last_modified if record else None,
        path=str(shown),
        size=found.stat().st_size if found else None,
    )
