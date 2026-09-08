"""Spec 47 §5.2 — the project mirror. OpenCode never sees the reviewed tree.

Every other adapter runs its child **in** the reviewed workspace and relies on a
sandbox or a prompt to keep it read-only. OpenCode gets a copy instead, and the
reason is §7.2: OpenCode has permission prompts and no operating-system sandbox,
so the last line of defence has to be that the dangerous path is not reachable
from the process at all.

**What §5.2 said and what 1.18.27 does are not the same**, and the difference is
recorded in §10.6 F rather than quietly relied on. §5.2's reason was that
OpenCode bootstraps `.opencode/package.json` into its project directory; with
§5.1's isolated `XDG_*` directories it does not — the bootstrap goes to the
cache and data homes. The mirror stays for the reasons that DID reproduce:

* a tool call writes into the project directory whenever the ruleset lets it,
  and one measured turn wrote `hacked.txt` before the ruleset existed;
* ACT needs somewhere that is not the repository to put its changes;
* an isolation that rests on three environment variables being right is not one
  to hang a read boundary on by itself.

**What this file is not.** It is not a general-purpose sync, and it is not a
backup. It copies what an agent reads a document review with — text, bounded —
and says plainly what it left out.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from .server import home

#: Directories never mirrored. Each is either enormous, regenerable, or the one
#: thing an agent must not be able to rewrite.
SKIP_DIRECTORIES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        "dist",
        "build",
        "out",
        "release",
        ".next",
        ".turbo",
        ".DS_Store",
        # OpenCode's own bootstrap, if a future version does put one here.
        ".opencode",
    }
)

#: The largest file worth copying, in bytes.
#:
#: A document review reads prose and source. A 5 MB file is a binary, a lock
#: file or a build artefact, and none of the three is what a comment is about —
#: while copying them per turn is what would make a reply feel slow.
MAX_FILE_BYTES = 5 * 1024 * 1024

#: The most files one mirror holds. A guard against a workspace nobody expected,
#: not a design limit; `Reconciliation.truncated` says when it bit.
MAX_FILES = 4000


@dataclass
class Reconciliation:
    """What one refresh did, so a run can say it rather than guess."""

    copied: int = 0
    removed: int = 0
    skipped_large: int = 0
    truncated: bool = False

    def summary(self) -> str:
        parts = [f"{self.copied} files"]
        if self.removed:
            parts.append(f"{self.removed} removed")
        if self.skipped_large:
            parts.append(f"{self.skipped_large} too large")
        if self.truncated:
            parts.append(f"stopped at {MAX_FILES}")
        return ", ".join(parts)


def mirror_for(key: str) -> Path:
    """This thread's mirror directory. Stable, so a reply reuses one.

    §5.2 — **the host supplies the root and the library picks the leaf.** The key
    is hashed because it is a thread id or a session id, both of which are
    opaque strings REX owns and neither of which is guaranteed to be a legal
    file name on every platform REX ships to.
    """
    leaf = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    path = home() / "mirrors" / leaf
    path.mkdir(parents=True, exist_ok=True)
    return path


def _walk(source: Path) -> list[Path]:
    """Every mirrorable file under `source`, as relative paths.

    Pruned in place rather than filtered afterwards: `node_modules` is skipped
    without being walked, which is the difference between a refresh that takes
    a moment and one that reads a hundred thousand inodes to throw them away.
    """
    found: list[Path] = []
    for directory, subdirectories, files in os.walk(source):
        subdirectories[:] = sorted(
            name for name in subdirectories if name not in SKIP_DIRECTORIES and not name.startswith(".git")
        )
        here = Path(directory)
        for name in sorted(files):
            if name in SKIP_DIRECTORIES:
                continue
            found.append((here / name).relative_to(source))
            if len(found) >= MAX_FILES:
                return found
    return found


def reconcile(source: str, key: str) -> tuple[Path, Reconciliation]:
    """Bring this thread's mirror up to date with the reviewed tree.

    Run before **every** turn, not only the first: §5.2's "reconciles reviewed
    source changes and pending REX working copies before each later turn". A
    reply that read a stale copy would answer about text the reviewer has
    already changed, and would do it without saying so.

    Copies by modification time and size rather than by content hash. Reading
    every file to decide whether to copy it costs the same as copying it, and
    the case this exists for — a reviewer edited one file between two turns — is
    caught by both.
    """
    root = Path(source).resolve()
    mirror = mirror_for(key)
    report = Reconciliation()
    if not root.is_dir():
        # A run whose cwd is not a directory is a caller's bug, and an empty
        # mirror is the honest answer: the agent then says it can see nothing,
        # which is true, instead of reading whatever was left from last time.
        return mirror, report

    wanted = _walk(root)
    report.truncated = len(wanted) >= MAX_FILES
    keep: set[Path] = set()

    for relative in wanted:
        origin = root / relative
        try:
            stat = origin.stat()
        except OSError:
            continue
        if stat.st_size > MAX_FILE_BYTES:
            report.skipped_large += 1
            continue
        keep.add(relative)
        target = mirror / relative
        try:
            existing = target.stat()
            if existing.st_size == stat.st_size and existing.st_mtime >= stat.st_mtime:
                continue
        except OSError:
            pass
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(origin, target)
            report.copied += 1
        except OSError:
            # A file that cannot be read is a file the agent will not see, and
            # that is better than a refresh that fails half-way and leaves a
            # mirror nobody can describe.
            keep.discard(relative)

    report.removed = _prune(mirror, keep)
    return mirror, report


def _prune(mirror: Path, keep: set[Path]) -> int:
    """Delete what the source no longer has.

    Without it a file the reviewer deleted stays readable for the life of the
    thread, and an agent asked "is this still referenced anywhere" answers from
    a tree that no longer exists.

    **Only inside the mirror**, and only files this function's own walk found —
    it never follows a link out and never touches the source.
    """
    removed = 0
    for directory, subdirectories, files in os.walk(mirror, topdown=False):
        here = Path(directory)
        for name in files:
            relative = (here / name).relative_to(mirror)
            if relative in keep:
                continue
            try:
                (here / name).unlink()
                removed += 1
            except OSError:
                pass
        for name in subdirectories:
            # `rmdir` succeeds only when it is empty, which is exactly the test:
            # a directory the source still has keeps at least one kept file.
            with contextlib.suppress(OSError):
                (here / name).rmdir()
    return removed


__all__ = [
    "MAX_FILES",
    "MAX_FILE_BYTES",
    "SKIP_DIRECTORIES",
    "Reconciliation",
    "mirror_for",
    "reconcile",
]
