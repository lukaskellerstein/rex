#!/usr/bin/env python3
"""Compatibility stub — the pre-2026-08-30 hook entry point.

Sessions started before the hook swap have this file name snapshotted in their
hook config, and hook scripts are read fresh on every event — so this stub is
what lets a running session pick up the new behaviour without a restart. It
does nothing but run the current PostToolUse hook. Delete it once no session
started before 2026-08-30 is alive.
"""

import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name("playwright-post.py")), run_name="__main__")
