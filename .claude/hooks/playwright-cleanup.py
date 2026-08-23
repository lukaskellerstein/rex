#!/usr/bin/env python3
"""SessionEnd hook: close the Playwright browser windows this session spawned.

"This session" is taken literally. Several Claude Code sessions run side by
side on this machine, each with its own Playwright MCP server, and every one of
them shares the desktop -- so a cleanup that closed *every* Playwright browser
closed the other sessions' browsers mid-task (measured 2026-08-18). A browser
is closed here only if its process ancestry leads back to this session's Claude
Code process, or if it is abandoned: nothing above it is still holding it and no
live MCP server is attached to its port, so no session can be driving it.
Hand-opened browsers and other sessions' browsers survive.

In practice Claude Code shuts its MCP servers down *before* SessionEnd fires,
and playwright-mcp takes its browser with it, so on a normal exit there is
usually nothing of our own left to close -- the abandoned case is what remains
after a session that did not get to exit normally.

That second case is the whole reason the scratch space filled up. Ancestry is
the only thing the first case can read, and `--cdp-endpoint` severs it: the
browser belongs to a dev server, which belongs to whatever shell started it, and
Claude Code is nowhere in the chain. Measured 2026-08-22 -- four browsers parked
on the scratch space, exactly one of them (an app a Bash call had launched in the
foreground) closable. `wm.is_abandoned_browser` is what reaches the other three
once nothing is driving them.

On macOS the scratch space is destroyed afterwards if this hook created it and
nothing else moved in.
"""

import sys

import wm


def main() -> None:
    manager = wm.detect()
    if manager.name == "none":
        sys.exit(0)

    session = wm.session_pid()
    for window in manager.browser_windows():
        pid = window["pid"]
        if not wm.was_automated(pid):
            continue  # opened by hand -- never ours to close
        if wm.is_owned_by(pid, session) or wm.is_abandoned_browser(pid):
            manager.close(window)

    manager.release_scratch()
    sys.exit(0)


if __name__ == "__main__":
    main()
