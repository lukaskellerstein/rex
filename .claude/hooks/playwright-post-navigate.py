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
"""

import sys
import time

import wm

WINDOW_APPEAR_DELAY = 0.5  # seconds to wait for a freshly spawned window


def main() -> None:
    manager = wm.detect()
    if manager.name == "none":
        sys.exit(0)

    focus = manager.focus_token()

    time.sleep(WINDOW_APPEAR_DELAY)

    candidates = [
        window
        for window in manager.browser_windows()
        if not manager.is_scratch(window["workspace"]) and wm.is_playwright_browser(window["pid"])
    ]

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
