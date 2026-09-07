"""Spec 46 §10 and §14 — the seal, asserted rather than assumed.

Two packages, and **neither imports the other**. `agent-runner` may hold no HTTP
server (spec 42 §3.2) and `litellm[proxy]` is one, so merging them would break
the rule that keeps the agent library reviewable and would put a 456 MB proxy in
the dependency closure of a package spec 42 §3.3 promises is reusable.

`agent-runner/tests/test_boundary.py` asserts its own half. This is the other,
plus the two rules that are specific to serving inference: no database, and
**never a bind on anything but loopback**.

It reads the source rather than the runtime, so an import inside a function or
behind a `TYPE_CHECKING` guard is caught too.
"""

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "src" / "local_gateway"

#: Everything the package may import from outside itself.
DECLARED = {"httpx", "litellm", "pydantic", "yaml"}

#: Names that would mean this package had grown a shape spec 46 rejected.
#:
#: `sqlite3` and `sqlalchemy` are here because §4.3 is explicit: LiteLLM runs
#: with no `DATABASE_URL`, and adding a database to get hot reload is not worth
#: 155 MB and a migration step (§17).
FORBIDDEN = {
    "nats",
    "socketserver",
    "http.server",
    "sqlite3",
    "sqlalchemy",
    "psycopg2",
    "asyncpg",
    "prisma",
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
            assert root in stdlib or root in DECLARED or root == "local_gateway", (
                f"{path.name} imports '{name}', which is neither stdlib nor a declared dependency"
            )


def test_holds_no_broker_and_no_database() -> None:
    for path in _sources():
        for name in _imported_roots(path):
            assert name not in FORBIDDEN and name.split(".")[0] not in FORBIDDEN, (
                f"{path.name} imports '{name}' — this gateway has no broker and no database"
            )


def test_never_imports_the_agent_runner() -> None:
    """Criterion A12, one direction. The other half lives in `agent-runner/`.

    They have nothing to say to each other: `agent-runner` is given a URL and
    does not care who serves it. An import either way would be the first step to
    one dependency list.
    """
    for path in _sources():
        for name in _imported_roots(path):
            assert not name.startswith("agent_runner"), (
                f"{path.name} imports '{name}' — the two packages never import each other"
            )


def test_the_agent_runner_never_imports_this_one() -> None:
    """Criterion A12, the other direction, asserted from here too.

    Deliberately duplicated across both packages. A rule about two things that
    lives in only one of them is a rule that disappears the day that one is
    moved, and this is four lines.
    """
    sibling = ROOT.parent / "agent-runner" / "src" / "agent_runner"
    if not sibling.exists():  # pragma: no cover — packaged without its sibling
        return
    for path in sorted(sibling.rglob("*.py")):
        for name in _imported_roots(path):
            assert not name.startswith("local_gateway"), (
                f"agent_runner/{path.name} imports '{name}' — the two never import each other"
            )
