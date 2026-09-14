#!/usr/bin/env python3
"""Keep file-tool edits inside the checkout assigned to this Codex session.

Codex manages worktree creation, cleanup, and Handoff itself. This hook does
not reimplement those operations. It adds concise session context and rejects
an apply_patch request whose paths escape the active Local or Worktree checkout.
Shell writes remain the permission profile's responsibility.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

PATCH_PATH_PREFIXES = (
    "*** Add File: ",
    "*** Delete File: ",
    "*** Update File: ",
    "*** Move to: ",
)


def git(cwd: Path, *args: str):
    try:
        result = subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True,
            check=False,
            text=True,
            timeout=3,
        )
    except Exception:
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def within(path: Path, root: Path) -> bool:
    try:
        return os.path.commonpath((str(path), str(root))) == str(root)
    except ValueError:
        return False


def patch_paths(command: str, cwd: Path) -> list[Path]:
    paths: list[Path] = []
    for line in command.splitlines():
        for prefix in PATCH_PATH_PREFIXES:
            if not line.startswith(prefix):
                continue
            raw = line[len(prefix) :].strip()
            if not raw:
                continue
            candidate = Path(raw)
            if not candidate.is_absolute():
                candidate = cwd / candidate
            paths.append(candidate.resolve(strict=False))
            break
    return paths


def deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except Exception:
        return

    cwd = Path(event.get("cwd") or os.getcwd()).resolve(strict=False)
    checkout_text = git(cwd, "rev-parse", "--show-toplevel")
    if not checkout_text:
        return
    checkout = Path(checkout_text).resolve(strict=False)

    event_name = event.get("hook_event_name")
    if event_name == "SessionStart":
        common_text = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
        main_checkout = Path(common_text).resolve(strict=False).parent if common_text else checkout
        location = "Local checkout" if checkout == main_checkout else "Codex worktree"
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "SessionStart",
                        "additionalContext": (
                            f"Workspace guard: {location} {checkout}. Keep every edit, "
                            "command, and test inside this checkout. Use Codex Handoff "
                            "to move between Local and Worktree; do not create, remove, "
                            "or switch worktrees yourself."
                        ),
                    }
                }
            )
        )
        return

    if event_name != "PreToolUse":
        return

    command = str((event.get("tool_input") or {}).get("command") or "")
    paths = patch_paths(command, cwd)
    if not paths:
        deny(
            "The patch paths could not be identified safely. Keep edits inside the active checkout and retry with explicit paths."
        )
        return

    escaped = [path for path in paths if not within(path, checkout)]
    if escaped:
        shown = ", ".join(str(path) for path in escaped[:3])
        deny(
            f"This session may edit only {checkout}. The patch targets another "
            f"checkout or an outside path: {shown}. Use Codex Handoff instead."
        )


if __name__ == "__main__":
    main()

