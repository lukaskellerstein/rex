#!/usr/bin/env python3
"""PostToolUse hook: park Playwright browser windows out of the way.

Finds every Playwright-spawned browser window (verified through the process
ancestry, so hand-opened browsers are left alone) that is not already on the
scratch workspace, and moves it there -- i3 workspace 100-120 on Linux, the
`playwright` space on macOS. Windows that cannot be moved (yabai without its
scripting addition) are floated instead so they at least stop disturbing the
tiling layout.

Every session's browsers are parked, not just this one's -- parking is harmless
across sessions and the desktop is shared. What counts as "the scratch
workspace" is re-checked each run: a space the user has moved into is theirs,
and the browsers on it are moved along to a fresh one (see `wm.py`).

It runs on *every* `browser_*` tool, not only the navigating ones, and on
`Bash` as well -- because `--cdp-endpoint` inverts who creates the window. With
`--isolated` Playwright spawns the browser and `browser_navigate` is the moment
it appears. With an attached app nothing in the MCP server creates anything: the
shell does, on `npx electron .`, and again on every restart. A session can even
drive that app over raw CDP and never call an MCP tool at all (measured in `rex`
2026-08-21: 132 `Bash` calls, zero `browser_*`), at which point an MCP-only
matcher is a trigger that never fires. `Bash` is the one event that is always
there. See the matcher note in `projects/claude-code.md`.
"""

import json
import sys
import time

import wm

WINDOW_APPEAR_DELAY = 0.5  # one beat, for a window Playwright just spawned
LAUNCH_POLL_LIMIT = 3.0  # an app the shell just started takes seconds to map

# Bash commands that start a desktop app. These are the only ones worth waiting
# on: everything else either has its window already or is not making one, and a
# session runs hundreds of them.
LAUNCH_MARKERS = (
    "electron",
    "remote-debugging-port",
    "npm run dev",
    "npm start",
    "pnpm dev",
    "yarn dev",
    "bun run dev",
)


def _candidates(manager: "wm.WindowManager") -> list[dict]:
    """Playwright-owned browser windows that are not already parked."""
    return [
        window
        for window in manager.browser_windows()
        if not manager.is_scratch(window["workspace"]) and wm.is_playwright_browser(window["pid"])
    ]


def _tool_command() -> str | None:
    """The shell command this hook fired on; None when the tool was not Bash.

    Claude Code feeds a hook its payload on stdin. An MCP `browser_*` call has
    no `command` field and a `Bash` call does, which is the whole distinction
    needed here -- so the two triggers can share one script without the script
    having to know which matcher brought it in. Reading is skipped on a tty so
    the hook can still be run by hand.
    """
    if sys.stdin.isatty():
        return None
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return None
    command = (payload.get("tool_input") or {}).get("command")
    return command.lower() if isinstance(command, str) else None


def _wait_budget(command: str | None) -> float:
    """How long it is worth waiting for a window that is not there yet.

    Who creates the window decides this. An MCP call that spawned a browser
    needs one beat. A shell command that launched an app needs seconds --
    electron-vite is slow to map its first window, and the command returns
    immediately because the app is started in the background. Every *other*
    Bash call must pay nothing beyond the look already taken; there are
    hundreds of them in a session and none of them makes a window.
    """
    if command is None:
        return WINDOW_APPEAR_DELAY
    if any(marker in command for marker in LAUNCH_MARKERS):
        return LAUNCH_POLL_LIMIT
    return 0.0


def main() -> None:
    # Before anything else: stdin is only readable once, and `wm.detect()`
    # shells out.
    command = _tool_command()

    manager = wm.detect()
    if manager.name == "none":
        sys.exit(0)

    focus = manager.focus_token()

    # Look first, and only wait when there is nothing to park yet. An attached
    # app's window usually already exists and is already misplaced, so it is
    # found on the first look; paying a delay unconditionally would tax every
    # click and keystroke of a session for nothing.
    candidates = _candidates(manager)
    waited = 0.0
    budget = _wait_budget(command)
    while not candidates and waited < budget:
        time.sleep(WINDOW_APPEAR_DELAY)
        waited += WINDOW_APPEAR_DELAY
        # The process table is cached for the run, and a window we are waiting
        # for belongs to a process that did not exist when it was built.
        wm.forget_processes()
        candidates = _candidates(manager)

    if candidates:
        scratch = manager.scratch()
        if scratch is None:
            # No scratch workspace reachable -- float the windows instead.
            for window in candidates:
                manager.stash(window)
        else:
            for window in manager.park(candidates, scratch):
                manager.stash(window)

    # Unconditional, even when there was nothing to park: an already-parked
    # browser that raised itself has taken the desktop with it, and putting the
    # user back is the whole point. `restore_focus` is a no-op when they never
    # left.
    manager.restore_focus(focus)
    sys.exit(0)


if __name__ == "__main__":
    main()
