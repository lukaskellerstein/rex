"""Spec 48 §5.1 and §8.2 — where a deep agent may read, and where it may write.

A deep agent has no sandbox and no shell. What it has instead is a **backend** —
a filesystem its tools see — and **permission rules** on it, and those two plus
REX's own policy are the whole boundary. This module builds both, for the two
profiles, and carries the one check the SDK's own rules cannot make.

## The two shapes, and how little they differ

Both speak **real paths**, and the difference between them is one rule: ACT may
write inside `RunRequest.writable`, and ASK may write nowhere.

ASK was virtual once — `virtual_mode=True`, the workspace as the agent's whole
world — and spec 50 §3.1 is why it is not any more. REX's read prompt names each
working copy by ABSOLUTE path (`prompts.ts`), those copies live outside `cwd`,
and a virtual backend re-roots an absolute path inside itself. So the agent was
told to read a file it could not reach, and answered "not found" about a file
that was there. It is spec 48 §8.2's finding, in the half of this module it had
not been applied to.

What replaces the virtual root is `RunRequest.readable`: the folders REX names
in the prompt, allowed for reading and nothing more. Measured 2026-09-08 — the
copy opens by full path, and a file outside `cwd` and `readable` is refused.

ACT **cannot** use §8.2's `CompositeBackend` with the repository mounted at
`/source/`, and this is the one place the spec's design did not survive being
built. Measured 2026-09-07: REX's write prompt (spec 22) names each working copy
by its **absolute path** under `~/.rex/work/<documentId>/`, and those are N
sibling directories rather than one tree. A virtual backend re-roots an absolute
path inside itself, so every edit an ACT is supposed to make would land in a
made-up directory and the run would look successful and change nothing.

So ACT speaks real paths — `virtual_mode=False` — and the boundary is the rules:
allow writes under each writable root, then deny everything. It is spec 47
§7.4.1 option B's decision reached again by the same road: **where the agent
runs follows what it may do**, and the boundary is expressed on the real
filesystem rather than by pretending the filesystem is somewhere else.

## Why there are two checks and not one

The SDK's matcher is **textual**, and that was measured rather than assumed. A
symlink inside a writable directory pointing at the reviewer's repository
matched `<writable>/**` and the write went through to the real file
(2026-09-07 — the one escape of ten spellings tried; `..`, `~`, `//` and a bare
relative name were all refused by the backend itself).

`refusal()` below is the second check, and it closes exactly that hole: it
resolves the candidate and the roots with `Path.resolve()` — which follows
symlinks — and refuses anything that is not really inside one. Two independent
checks that must both pass, and the one that fails is not the one that holds.

Nothing in this adapter can create a link: there is no shell (§5 — no
`execute`), and none of the eight tools makes one. So the resolution cannot be
raced between the check and the write.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol

from deepagents import FilesystemPermission
from deepagents.backends import FilesystemBackend

from .tools import WRITING_TOOLS, path_of

#: §5.1 layer 2 — the ASK rule, and the SDK's own documented read-only example.
#:
#: `"write"` covers `write_file`, `edit_file` and `delete`; `"read"` covers `ls`,
#: `read_file`, `glob` and `grep`. One rule denies all three writes, which is why
#: `RunRequest.disallowed` carrying `write` and `edit` separately still becomes
#: one line: the SDK's rule vocabulary has one word for both.
READ_ONLY: list[FilesystemPermission] = [
    FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"),
]


class Boundary(Protocol):
    """Why this call is outside what the run may touch, or None when it is not."""

    def __call__(self, tool: str, args: Any) -> str | None: ...


def for_ask(cwd: str, readable: Sequence[str] = ()) -> tuple[FilesystemBackend, list[FilesystemPermission], Boundary]:
    """§8.1, as spec 50 §3.3 rewrote it — the workspace and the copies, read-only.

    `readable` is REX's working copies. They are outside `cwd` and the prompt
    names them by absolute path, so without them the agent cannot open the
    document it was asked about.

    The boundary check still refuses every writing tool **by name** rather than
    by path, and that is deliberate: there is nowhere this run may write, so no
    path could make a write allowed, and a name is the clearer refusal to read
    in a thread. The deny-all write rule below is the second of the two.
    """
    backend = FilesystemBackend(root_dir=cwd, virtual_mode=False)

    def refusal(tool: str, args: Any) -> str | None:
        _ = args
        if tool in WRITING_TOOLS:
            return (
                f"'{tool}' cannot be used in a read session. The agent may read the document "
                "and answer the comment; Apply is what changes files."
            )
        return None

    return backend, [*READ_ONLY, *_read_rules(cwd, readable)], refusal


def _read_rules(cwd: str, roots: Sequence[str]) -> list[FilesystemPermission]:
    """Reads scoped to the workspace and the named folders. First match wins.

    The reviewer's other files are not evidence for this review, and a backend
    on real paths would otherwise offer the whole disk. Measured 2026-09-08:
    these rules hold at the tool layer — but **not** in `FilesystemBackend`'s own
    methods, which ignore them. A test that calls the backend directly measures
    nothing (spec 50 §3.4 B).
    """
    allowed = [cwd, f"{cwd}/**", *(str(root) for root in roots), *(f"{root}/**" for root in roots)]
    return [
        FilesystemPermission(operations=["read"], paths=allowed, mode="allow"),
        FilesystemPermission(operations=["read"], paths=["/**"], mode="deny"),
    ]


def for_act(cwd: str, writable: Sequence[str]) -> tuple[FilesystemBackend, list[FilesystemPermission], Boundary]:
    """§8.2 — real paths, writable only inside `RunRequest.writable`.

    `writable` is REX's working copies and nothing else. `cwd` is the reviewer's
    repository: readable, so the agent can see what it is editing a copy of, and
    **never writable** — it is not in the allow list, so the deny-all rule below
    catches every spelling of it.
    """
    roots = [Path(path) for path in writable]
    resolved = [_resolve(root) for root in roots]

    permissions = [
        # First match wins, so the allows come first and the catch-all last.
        FilesystemPermission(operations=["write"], paths=[f"{root}/**" for root in roots], mode="allow"),
        FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"),
        # Reads are scoped too, by the same rule ASK uses.
        *_read_rules(cwd, [str(root) for root in roots]),
    ]

    def refusal(tool: str, args: Any) -> str | None:
        if tool not in WRITING_TOOLS:
            return None
        path = path_of(tool, args)
        if path is None:
            return f"'{tool}' was called with no file path, so REX could not check where it would write."
        if _resolve(Path(path)) is None or not _within(Path(path), resolved):
            return (
                f"REX refused to write {path}. This run may change only the working copies REX "
                "made for it, and that path is not inside one. The reviewer's own files are "
                "changed when they approve the diff, never by the agent."
            )
        return None

    return FilesystemBackend(root_dir=None, virtual_mode=False), permissions, refusal


def _resolve(path: Path) -> Path | None:
    """A real path with every symlink and `..` gone, or None when it has none.

    `Path.resolve()` does not need the file to exist — a new file inside a
    working copy resolves through its parents — but it can still raise on a
    symlink loop, and a boundary check that raises is a boundary check that
    fails open somewhere upstream.
    """
    try:
        return path.expanduser().resolve()
    except (OSError, RuntimeError, ValueError):
        return None


def _within(candidate: Path, roots: Sequence[Path | None]) -> bool:
    """Whether `candidate` really is inside one of `roots`, symlinks followed."""
    real = _resolve(candidate)
    if real is None:
        return False
    return any(root is not None and (real == root or real.is_relative_to(root)) for root in roots)


__all__ = ["READ_ONLY", "Boundary", "for_act", "for_ask"]
