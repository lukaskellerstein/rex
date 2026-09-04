"""Spec 42 §3.2 and §13 criterion 1 — the seal, asserted rather than assumed.

The boundary is a process, so the library **cannot** import the host. What this
test guards is the other half of §3.2: no HTTP server, no NATS client, no socket
listener, and nothing outside the two dependencies `pyproject.toml` declares.

It reads the source rather than the runtime, so an import inside a function or
behind a `TYPE_CHECKING` guard is caught too.
"""

import ast
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "src" / "agent_gateway"

#: Everything the package is allowed to import from outside itself.
DECLARED = {"claude_agent_sdk", "pydantic"}

#: Names that would mean the library had grown the shape spec 01 §12 rejected.
FORBIDDEN = {
    "fastapi",
    "uvicorn",
    "starlette",
    "flask",
    "aiohttp",
    "nats",
    "socketserver",
    "http.server",
    "websockets",
    "sqlite3",
    "sqlalchemy",
}


def _sources() -> list[Path]:
    files = sorted(PACKAGE.rglob("*.py"))
    assert files, f"no sources under {PACKAGE}"
    return files


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            # A relative import is inside the package by construction.
            if node.level == 0 and node.module:
                roots.add(node.module)
    return roots


def test_imports_nothing_outside_its_declared_dependencies() -> None:
    stdlib = sys.stdlib_module_names
    for path in _sources():
        for name in _imported_roots(path):
            root = name.split(".")[0]
            assert root in stdlib or root in DECLARED or root == "agent_gateway", (
                f"{path.name} imports '{name}', which is neither stdlib nor a declared dependency"
            )


def test_holds_no_server_no_broker_and_no_database() -> None:
    for path in _sources():
        for name in _imported_roots(path):
            assert name not in FORBIDDEN and name.split(".")[0] not in FORBIDDEN, (
                f"{path.name} imports '{name}' — the library has no server, broker or database"
            )


def test_never_reaches_for_the_sdk_s_private_internals() -> None:
    """Vex imported `claude_agent_sdk._internal.sessions`; spec 42 §9 says no.

    A private import is not a style point here: it is the one thing that breaks
    silently on a version bump, and the SDK's public `get_session_info` answers
    the same question.
    """
    for path in _sources():
        for name in _imported_roots(path):
            assert "_internal" not in name, f"{path.name} imports the SDK's private {name}"
