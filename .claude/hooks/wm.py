#!/usr/bin/env python3
"""Window-manager abstraction shared by the Playwright hooks.

Two backends behind one surface:

  i3 (Linux)     parks windows on a throwaway workspace in the 100-120 range;
                 i3 discards those workspaces on its own once they empty out.
  yabai (macOS)  parks windows on a space labelled `playwright`, created on
                 demand and destroyed at session end if this module created it.

Every entry point degrades to a no-op when the window manager is absent or
unreachable, so a hook can never fail the tool call it is attached to.

macOS caveat: moving a window between spaces requires yabai's scripting
addition. When the SA is not loaded, yabai still exits 0 and silently does
nothing -- so `park()` re-queries and reports which windows did not land. The
caller stashes those with `stash()` (float + refocus) instead, which keeps the
window compositing and therefore keeps Playwright screencasts working.

The user must never be carried along to the scratch workspace. Sending a window
to another space does not follow it, but *focusing* one does -- so the only
dangerous step is restoring focus, and `restore_focus()` will not name a target
until it has re-queried it and found it on a space that is already visible.

A space is scratch only while it holds nothing but Playwright browsers. The
label is not something macOS shows (this machine's sketchybar now draws the
Playwright mask on that chip; another machine's bar will not), the space is an
ordinary desktop, and once the browser is closed it looks empty -- so sooner or
later the user opens a terminal there and it becomes *their* workspace. If the
hook kept treating it as scratch, every browser on the machine would be parked
into that workspace, a browser opened *from* it would never move at all, and
`focus_token()` would refuse the space as "home" and walk the user off their own
desktop on every navigation. Measured 2026-08-18: space 12 labelled `playwright`,
two Ghostty windows on it, exactly those symptoms. So `_remembered_index()`
re-checks the space for foreign windows on every run and abandons it -- label
cleared, state forgotten -- the moment one appears; a new scratch is created and
the browsers already there move along.

Ownership has two grains. `is_playwright_browser()` says "spawned by *some*
Playwright" and is enough for parking, which is harmless across sessions.
Closing is not: several Claude Code sessions run at once on this machine, each
with its own MCP server, and a SessionEnd that closed every Playwright browser
took the other sessions' browsers with it (measured 2026-08-18). The cleanup
hook therefore closes only what `is_owned_by(pid, session_pid())` proves
descends from *this* session's Claude process, plus true orphans -- browsers
whose MCP server has already exited and left them to launchd -- which no live
session can be using.
"""

import contextlib
import json
import os
import platform
import shutil
import signal
import subprocess
import tempfile
from pathlib import Path
from typing import Any

STATE_DIR = Path(tempfile.gettempdir()) / "playwright-hooks"
SCRATCH_STATE = STATE_DIR / "scratch-space.json"
# The last space the user was seen on that was not the scratch space. Needed
# because a hook can fire when they have already been dragged onto scratch, at
# which point the space underfoot is not an answer to "where were they?".
HOME_STATE = STATE_DIR / "home-space.json"

# Window classes (i3) / application names (yabai), compared lowercased. Both
# spellings of each browser are listed because the two window managers report
# different strings: i3 exposes the X11 WM_CLASS ("Google-chrome"), yabai the
# macOS application name ("Google Chrome"). Playwright ships its headed browser
# as "Google Chrome for Testing" on macOS, which is what actually shows up when
# the MCP server launches one.
BROWSER_APPS = frozenset(
    {
        "chromium",
        "chromium-browser",
        "chrome",
        "google-chrome",
        "google chrome",
        "chrome for testing",
        "google-chrome-for-testing",
        "google chrome for testing",
        "chrome canary",
        "google chrome canary",
        "electron",
    }
)

# A browser whose process ancestry contains one of these was spawned by the
# Playwright MCP server rather than opened by hand.
PLAYWRIGHT_ANCESTORS = ("playwright", "npx", "node", "npm")

# Ancestry stops being usable the moment the MCP server exits: the browser is
# reparented to init/launchd and looks user-opened. Playwright's own browser
# builds live under a `ms-playwright` cache directory and its throwaway
# profiles are named `playwright_*`, both of which survive reparenting -- so the
# command line is checked as a second, orphan-proof signal. Deliberately narrow:
# a bare "playwright" would also match a user browsing playwright.dev, and this
# predicate decides what the cleanup hook is allowed to close.
PLAYWRIGHT_COMMAND_MARKERS = ("ms-playwright", "playwright_", "playwright-core")

I3_SCRATCH_MIN = 100
I3_SCRATCH_MAX = 120

YABAI_SCRATCH_LABEL = "playwright"
YABAI_ADOPTABLE_LABELS = frozenset({"playwright", "claude", "scratch"})


# --------------------------------------------------------------------------
# process helpers
# --------------------------------------------------------------------------


def run(cmd: list[str], timeout: int = 5) -> str | None:
    """Run a command; return stdout on success, None on any failure."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None
    return result.stdout if result.returncode == 0 else None


def run_json(cmd: list[str], timeout: int = 5) -> Any:
    """Run a command expected to emit JSON; return None if it does not."""
    out = run(cmd, timeout)
    if out is None:
        return None
    try:
        return json.loads(out)
    except Exception:
        return None


def _ancestors_linux(pid: int) -> list[str]:
    """Walk /proc to collect the process-name chain above `pid`."""
    names: list[str] = []
    while pid and pid > 1:
        try:
            names.append(Path(f"/proc/{pid}/comm").read_text().strip().lower())
            stat = Path(f"/proc/{pid}/stat").read_text()
            # Format: pid (comm may contain spaces) state ppid ...
            close_paren = stat.rfind(")")
            if close_paren < 0:
                break
            fields = stat[close_paren + 1 :].split()
            pid = int(fields[1]) if len(fields) > 1 else 0
        except Exception:
            break
    return names


_PROCESS_TABLE: dict[int, tuple[int, str]] | None = None


def _process_table() -> dict[int, tuple[int, str]]:
    """pid -> (ppid, executable basename). macOS has no /proc, so shell out once."""
    global _PROCESS_TABLE
    if _PROCESS_TABLE is not None:
        return _PROCESS_TABLE

    _PROCESS_TABLE = {}
    for line in (run(["ps", "-axo", "pid=,ppid=,comm="]) or "").splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid, ppid = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        # `comm` is a full path here; reduce to a basename so it matches the
        # short names /proc/<pid>/comm reports on Linux.
        _PROCESS_TABLE[pid] = (ppid, Path(parts[2]).name.lower())
    return _PROCESS_TABLE


def _ancestors_darwin(pid: int) -> list[str]:
    table = _process_table()
    names: list[str] = []
    seen: set[int] = set()
    while pid and pid > 1 and pid not in seen:
        seen.add(pid)
        entry = table.get(pid)
        if entry is None:
            break
        pid, name = entry[0], entry[1]
        names.append(name)
    return names


def _command_line(pid: int) -> str:
    """Full argv of a process, lowercased; empty string when unreadable."""
    if platform.system() == "Darwin":
        return (run(["ps", "-p", str(pid), "-o", "command="]) or "").strip().lower()
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except Exception:
        return ""
    return raw.replace(b"\0", b" ").decode("utf-8", "replace").strip().lower()


def is_playwright_browser(pid: int | None) -> bool:
    """True when this browser was spawned by Playwright rather than by the user."""
    if not pid:
        return False

    if any(marker in _command_line(pid) for marker in PLAYWRIGHT_COMMAND_MARKERS):
        return True

    ancestors = _ancestors_darwin(pid) if platform.system() == "Darwin" else _ancestors_linux(pid)
    return any(indicator in name for name in ancestors for indicator in PLAYWRIGHT_ANCESTORS)


def _parent_of(pid: int) -> int | None:
    """ppid of `pid`, or None when the process is gone. Works on both platforms."""
    if platform.system() == "Darwin":
        entry = _process_table().get(pid)
        return entry[0] if entry else None
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        fields = stat[stat.rfind(")") + 1 :].split()
        return int(fields[1]) if len(fields) > 1 else None
    except Exception:
        return None


def _ancestor_pids(pid: int) -> list[int]:
    """The pid chain above `pid`, nearest first, stopping short of init/launchd."""
    chain: list[int] = []
    seen: set[int] = set()
    parent = _parent_of(pid)
    while parent and parent > 1 and parent not in seen:
        seen.add(parent)
        chain.append(parent)
        parent = _parent_of(parent)
    return chain


# Interpreters and shells a hook runs through on its way up to Claude Code:
# `python3 hook.py` under `sh -c`, or under a login shell. Anything else on the
# way up is the Claude Code process itself, whatever binary it happens to be.
_HOOK_WRAPPERS = ("python", "sh", "bash", "zsh", "dash", "env")


def session_pid() -> int | None:
    """The Claude Code process this hook runs under.

    Hooks are children of the Claude Code process (through `sh -c`), and so is
    the MCP server that launched the browser -- which makes that pid the one
    thing a browser of *this* session has in its ancestry that a browser of any
    other session does not. Found by walking up from the hook and skipping the
    shells and interpreters in between; identified by position, not by name, so
    it holds whether Claude Code is a native binary or `node cli.js`.
    """
    for pid in _ancestor_pids(os.getpid()):
        # A login shell reports itself as "-zsh"; strip the marker before matching.
        name = _process_name(pid).lstrip("-")
        if not name.startswith(_HOOK_WRAPPERS):
            return pid
    return None


def _process_name(pid: int) -> str:
    if platform.system() == "Darwin":
        entry = _process_table().get(pid)
        return entry[1] if entry else ""
    try:
        return Path(f"/proc/{pid}/comm").read_text().strip().lower()
    except Exception:
        return ""


def is_owned_by(pid: int | None, session: int | None) -> bool:
    """True when the browser at `pid` descends from the Claude process `session`."""
    if not pid or not session:
        return False
    return session in _ancestor_pids(pid)


def is_orphan_browser(pid: int | None) -> bool:
    """A Playwright browser whose MCP server is gone: reparented to init/launchd.

    Its command line still carries the Playwright markers (that is why they are
    checked, not the ancestry), but nothing alive can be driving it any more.
    Safe for any session to close; a browser with a live parent is left to the
    session that owns it.
    """
    if not pid:
        return False
    return _parent_of(pid) == 1 and any(
        marker in _command_line(pid) for marker in PLAYWRIGHT_COMMAND_MARKERS
    )


def _is_real_window(window: dict) -> bool:
    """A window a person could be working in.

    Same test sketchybar's `space.sh` and yabai's `space_focus.sh` use: only
    `AXStandardWindow` (tray and background windows have an empty subrole), and
    not sticky -- a sticky float such as a dictation status dialog lives on
    every space and would make every space look occupied.
    """
    return window.get("subrole") == "AXStandardWindow" and not window.get("is-sticky")


# --------------------------------------------------------------------------
# backends
# --------------------------------------------------------------------------


class WindowManager:
    """Common surface. A window is a dict: {id, pid, workspace, app}."""

    name = "none"

    def browser_windows(self) -> list[dict]:
        return []

    def focus_token(self) -> Any:
        """Opaque handle for whatever had focus before we started moving things."""
        return None

    def restore_focus(self, token: Any) -> None:
        pass

    def scratch(self) -> Any:
        """Workspace/space to park on, creating it if needed. None if unavailable."""
        return None

    def is_scratch(self, workspace: Any) -> bool:
        return False

    def park(self, windows: list[dict], scratch: Any) -> list[dict]:
        """Move windows to `scratch`; return the ones that did not land there."""
        return windows

    def stash(self, window: dict) -> None:
        """Fallback for windows that could not be parked."""

    def close(self, window: dict) -> None:
        pass

    def release_scratch(self) -> None:
        """Give back the scratch workspace if this module created it."""


class I3(WindowManager):
    name = "i3"

    def browser_windows(self) -> list[dict]:
        tree = run_json(["i3-msg", "-t", "get_tree"])
        if tree is None:
            return []

        windows: list[dict] = []

        def walk(node: dict, workspace: int | None) -> None:
            if node.get("type") == "workspace":
                workspace = node.get("num")
            app = (node.get("window_properties", {}).get("class") or "").lower()
            if app in BROWSER_APPS:
                windows.append(
                    {
                        "id": node.get("id"),
                        "pid": self._pid(node.get("window")),
                        "workspace": workspace,
                        "app": app,
                    }
                )
            for child in node.get("nodes", []) + node.get("floating_nodes", []):
                walk(child, workspace)

        walk(tree, None)
        return windows

    @staticmethod
    def _pid(window_id: int | None) -> int | None:
        """X11 windows do not carry their PID in the i3 tree; ask xprop."""
        if not window_id:
            return None
        out = run(["xprop", "-id", str(window_id), "_NET_WM_PID"]) or ""
        if "_NET_WM_PID" not in out:
            return None
        parts = out.strip().split("=")
        try:
            return int(parts[1].strip()) if len(parts) == 2 else None
        except ValueError:
            return None

    def _workspaces(self) -> list[dict]:
        return run_json(["i3-msg", "-t", "get_workspaces"]) or []

    def focus_token(self) -> str | None:
        for workspace in self._workspaces():
            if workspace.get("focused"):
                return workspace.get("name")
        return None

    def restore_focus(self, token: Any) -> None:
        if token:
            run(["i3-msg", f'workspace "{token}"'])

    def scratch(self) -> int:
        used = {ws.get("num") for ws in self._workspaces()}
        for num in range(I3_SCRATCH_MIN, I3_SCRATCH_MAX + 1):
            if num not in used:
                return num
        return I3_SCRATCH_MIN

    def is_scratch(self, workspace: Any) -> bool:
        return workspace is not None and I3_SCRATCH_MIN <= workspace <= I3_SCRATCH_MAX

    def park(self, windows: list[dict], scratch: Any) -> list[dict]:
        failed = []
        for window in windows:
            moved = run(
                [
                    "i3-msg",
                    f"[con_id={window['id']}] move container to workspace number {scratch}",
                ]
            )
            if moved is None:
                failed.append(window)
        return failed

    def close(self, window: dict) -> None:
        run(["i3-msg", f"[con_id={window['id']}] kill"])


class Yabai(WindowManager):
    name = "yabai"

    def __init__(self) -> None:
        # Space indices shift whenever spaces are added or removed, so the
        # scratch space is remembered by uuid and resolved to an index once.
        self._index: int | None = None
        self._resolved = False

    def browser_windows(self) -> list[dict]:
        windows = run_json(["yabai", "-m", "query", "--windows"]) or []
        return [
            {
                "id": w.get("id"),
                "pid": w.get("pid"),
                "workspace": w.get("space"),
                "app": (w.get("app") or "").lower(),
                "floating": w.get("is-floating", False),
            }
            for w in windows
            if (w.get("app") or "").lower() in BROWSER_APPS
        ]

    @staticmethod
    def _spaces() -> list[dict]:
        return run_json(["yabai", "-m", "query", "--spaces"]) or []

    def focus_token(self) -> dict:
        """Record where the user is standing, before anything gets moved.

        The space is remembered by uuid rather than index: `space --create`
        renumbers everything after the new space, so an index captured here can
        name a different desktop by the time focus is restored.
        """
        window = run_json(["yabai", "-m", "query", "--windows", "--window"])
        space = run_json(["yabai", "-m", "query", "--spaces", "--space"])
        token = {
            "window": window.get("id") if isinstance(window, dict) else None,
            "space": space.get("uuid") if isinstance(space, dict) else None,
        }

        # A hook can fire while the desktop is *already* on the scratch space:
        # Playwright calls bringToFront() on its own page, which raises the
        # parked window and macOS follows it there. Neither the space nor the
        # focused window is worth remembering in that state -- one is the place
        # we are trying to get the user out of, the other is the browser that
        # took them there. Fall back to the last space that was not scratch.
        #
        # "Scratch" here is the *validated* notion from `_remembered_index()`,
        # not the raw uuid in the state file: a space the user has since moved
        # into is their workspace, and treating it as scratch is what sent them
        # off their own desktop on every navigation (see the module docstring).
        scratch = self._remembered_index()
        on_scratch = (
            isinstance(space, dict) and scratch is not None and space.get("index") == scratch
        )
        if token["space"] and on_scratch:
            token["window"] = None
            token["space"] = self._read_home()
        elif token["space"]:
            self._write_home(token["space"])

        return token

    def restore_focus(self, token: Any) -> None:
        """Hand focus back without ever making the scratch space visible.

        This is the only step in the whole hook that can move the user between
        desktops. `window --focus` follows the window across spaces, so naming
        a window that was just parked drags the desktop onto the scratch space
        -- the one thing these hooks exist to prevent. A target is therefore
        used only after being re-queried and found on an already-visible space.
        """
        if not isinstance(token, dict):
            return

        spaces = self._spaces()
        visible = {s.get("index") for s in spaces if s.get("is-visible")}
        home = next((s for s in spaces if s.get("uuid") == token.get("space")), None)

        target = token.get("window")
        if target is not None:
            window = run_json(["yabai", "-m", "query", "--windows", "--window", str(target)])
            if not (isinstance(window, dict) and window.get("space") in visible):
                target = None  # parked, closed, or on a desktop we are not on

        # Whatever had focus is now out of view, so hand it to something else on
        # the user's own space -- otherwise keystrokes land wherever macOS
        # happened to drop focus when the window left. The something is the
        # window that had focus *before* the browser stole it: yabai lists a
        # space's windows front to back (`space_focus.sh` in this machine's
        # yabai config rests on the same fact), so with the browser gone the
        # front-most real window is the one the user was typing in. `first-window`
        # is the last resort, and is 0 on an empty space, which the truthiness
        # check below treats as "nothing".
        if target is None and home is not None and home.get("index") in visible:
            target = self._front_window(home.get("index")) or home.get("first-window")

        if target:
            run(["yabai", "-m", "window", str(target), "--focus"])

        # Safety net: nothing above is supposed to change which space is
        # visible, but if something did, walk the user back. Re-resolved by
        # uuid because an index read before the move may have shifted since.
        # Only when the *scratch* space is what became visible, though: that is
        # the one place a browser can carry the user to (a raised window drags
        # the desktop to its own space and nowhere else). If they are on any
        # other space, they switched there themselves while the hook was
        # running, and walking them back would fight their own keystroke.
        if token.get("space"):
            spaces_now = self._spaces()
            home_now = next((s for s in spaces_now if s.get("uuid") == token["space"]), None)
            scratch_now = self._remembered_index()
            scratch_visible = any(
                s.get("index") == scratch_now and s.get("is-visible") for s in spaces_now
            )
            if home_now is not None and not home_now.get("is-visible") and scratch_visible:
                run(["yabai", "-m", "space", str(home_now.get("index")), "--focus"])

    @staticmethod
    def _read_home() -> str | None:
        try:
            return json.loads(HOME_STATE.read_text()).get("uuid")
        except Exception:
            return None

    @staticmethod
    def _write_home(uuid: str) -> None:
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            HOME_STATE.write_text(json.dumps({"uuid": uuid}))
        except Exception:
            pass

    def _remembered_index(self) -> int | None:
        """Resolve the previously recorded scratch space to a current index.

        Resolving includes checking that it still *is* scratch. A space the
        user has moved into -- any real window on it that is not a Playwright
        browser -- is given back: our label comes off so nothing adopts it
        again, the state is forgotten, and the answer is "no scratch", which
        makes `scratch()` create a fresh one and `is_scratch()` treat the
        browsers still sitting there as candidates to move along.
        """
        if self._resolved:
            return self._index

        self._resolved = True
        state = self._read_state()
        if state:
            for space in self._spaces():
                if space.get("uuid") == state.get("uuid"):
                    if self._foreign_windows(space.get("index")):
                        self._abandon(space)
                    else:
                        self._index = space.get("index")
                    break
        return self._index

    def _foreign_windows(self, index: int | None) -> list[dict]:
        """Real windows on the space that are not Playwright browsers."""
        if index is None:
            return []
        windows = run_json(["yabai", "-m", "query", "--windows", "--space", str(index)]) or []
        return [
            w
            for w in windows
            if _is_real_window(w)
            and not (
                (w.get("app") or "").lower() in BROWSER_APPS and is_playwright_browser(w.get("pid"))
            )
        ]

    def _abandon(self, space: dict) -> None:
        """The user lives here now. Take our label off it and forget it."""
        if (space.get("label") or "") == YABAI_SCRATCH_LABEL:
            run(["yabai", "-m", "space", str(space.get("index")), "--label", ""])
        SCRATCH_STATE.unlink(missing_ok=True)
        self._index = None

    def _front_window(self, index: int | None) -> int | None:
        """The front-most real window on a space that is not a Playwright browser."""
        if index is None:
            return None
        for w in self._foreign_windows(index):
            if not w.get("is-minimized") and not w.get("is-hidden"):
                return w.get("id")
        return None

    def scratch(self) -> int | None:
        """Index of the scratch space -- remembered, adopted, or freshly created."""
        remembered = self._remembered_index()
        if remembered is not None:
            return remembered

        spaces = self._spaces()
        for space in spaces:
            # Adopt a labelled space only while it is actually free -- one the
            # user has moved into fails the same test the remembered one does.
            if (space.get("label") or "") in YABAI_ADOPTABLE_LABELS and not self._foreign_windows(
                space.get("index")
            ):
                self._adopt(space, created=False)
                return self._index

        return self._create_scratch({s.get("uuid") for s in spaces})

    def _create_scratch(self, known_uuids: set) -> int | None:
        """Create + label a space. Returns None when the SA is not loaded.

        `space --create` exits 0 even without the scripting addition, so the
        only reliable signal is a new uuid showing up in a fresh query.
        """
        run(["yabai", "-m", "space", "--create"])
        created = [s for s in self._spaces() if s.get("uuid") not in known_uuids]
        if not created:
            return None

        space = created[0]
        run(["yabai", "-m", "space", str(space.get("index")), "--label", YABAI_SCRATCH_LABEL])
        self._adopt(space, created=True)
        return self._index

    def _adopt(self, space: dict, created: bool) -> None:
        self._index = space.get("index")
        self._resolved = True
        self._write_state(space.get("uuid"), created=created)

    def is_scratch(self, workspace: Any) -> bool:
        remembered = self._remembered_index()
        return remembered is not None and workspace == remembered

    def park(self, windows: list[dict], scratch: Any) -> list[dict]:
        for window in windows:
            run(["yabai", "-m", "window", str(window["id"]), "--space", str(scratch)])

        landed = {w["id"] for w in self.browser_windows() if w["workspace"] == scratch}
        return [w for w in windows if w["id"] not in landed]

    def stash(self, window: dict) -> None:
        """Float the window so it stops disturbing the bsp layout."""
        if not window.get("floating"):
            run(["yabai", "-m", "window", str(window["id"]), "--toggle", "float"])

    def close(self, window: dict) -> None:
        """Close the window, then end the process behind it.

        macOS apps outlive their last window, so `--close` alone leaves an
        orphaned headless-ish browser running. Destroying an X11 client on i3
        takes the browser with it, so terminating here restores parity. Safe
        because ownership was already proven through the process ancestry.
        """
        run(["yabai", "-m", "window", str(window["id"]), "--close"])
        pid = window.get("pid")
        if not pid:
            return
        # Both failures are expected and mean the job is already done: the
        # process died with its window (ProcessLookupError), or it is not ours
        # to signal (PermissionError). Neither may fail the hook.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(pid, signal.SIGTERM)

    def release_scratch(self) -> None:
        state = self._read_state()
        SCRATCH_STATE.unlink(missing_ok=True)
        HOME_STATE.unlink(missing_ok=True)
        if not state or not state.get("created"):
            return
        for space in self._spaces():
            if space.get("uuid") == state.get("uuid") and not space.get("windows"):
                run(["yabai", "-m", "space", str(space.get("index")), "--destroy"])
                return

    @staticmethod
    def _read_state() -> dict | None:
        try:
            return json.loads(SCRATCH_STATE.read_text())
        except Exception:
            return None

    @staticmethod
    def _write_state(uuid: str | None, created: bool) -> None:
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            SCRATCH_STATE.write_text(json.dumps({"uuid": uuid, "created": created}))
        except Exception:
            pass


def detect() -> WindowManager:
    """Pick the backend for this machine; a no-op manager if neither is usable."""
    if platform.system() == "Darwin":
        if shutil.which("yabai") and run_json(["yabai", "-m", "query", "--spaces"]):
            return Yabai()
    elif shutil.which("i3-msg") and run_json(["i3-msg", "-t", "get_workspaces"]):
        return I3()
    return WindowManager()
