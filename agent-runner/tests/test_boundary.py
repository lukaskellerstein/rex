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

PACKAGE = Path(__file__).resolve().parent.parent / "src" / "agent_runner"

#: Everything the package is allowed to import from outside itself.
#:
#: `httpx` arrived with spec 47 and is the only dependency that adapter adds
#: (§9, criterion 15). OpenCode publishes no usable Python SDK, so REX's client
#: IS the binding — which makes an HTTP library a dependency here in a way it is
#: not for the two adapters whose SDK spawns a CLI.
#:
#: The five LangChain names arrived with spec 48. `deepagents`,
#: `langchain_openai` and `langchain_anthropic` are the three that spec §3 names
#: and `uv add` installed; `langchain` and `langgraph` come with them and are
#: imported directly for `AgentMiddleware`, `ToolMessage` and `InMemorySaver`,
#: which §3's own table says is what they are for.
DECLARED = {
    "claude_agent_sdk",
    "deepagents",
    "httpx",
    "langchain",
    "langchain_anthropic",
    "langchain_core",
    "langchain_openai",
    "langgraph",
    "openai_codex",
    "pydantic",
}

#: Spec 42 §2 rule 2 — each SDK is reachable from its own adapter and nowhere
#: else. The directory each module may be imported from, by module root.
#:
#: `httpx` is in the table for the same reason the three SDKs are, even though it
#: is a library rather than an SDK: spec 47 §9 makes it that adapter's own, and
#: the moment a second module reaches for it the "no HTTP client outside the one
#: adapter that needs one" rule has quietly stopped being true. `verify.py` says
#: so in its own words and uses `urllib` on purpose.
SDK_HOMES = {
    "claude_agent_sdk": "adapters/claude",
    "openai_codex": "adapters/codex",
    "httpx": "adapters/opencode",
    # Spec 48 §11 — the whole LangChain stack belongs to one adapter. It is the
    # biggest dependency in the package by far, and the rule that keeps it from
    # spreading is the same rule that keeps the three SDKs where they are: a
    # `ChatOpenAI` imported by `verify.py` for one convenient probe would make
    # every future caller's shortest path go through LangChain.
    "deepagents": "adapters/deep_agents",
    "langchain": "adapters/deep_agents",
    "langchain_anthropic": "adapters/deep_agents",
    "langchain_core": "adapters/deep_agents",
    "langchain_openai": "adapters/deep_agents",
    "langgraph": "adapters/deep_agents",
}

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
            assert root in stdlib or root in DECLARED or root == "agent_runner", (
                f"{path.name} imports '{name}', which is neither stdlib nor a declared dependency"
            )


def test_holds_no_server_no_broker_and_no_database() -> None:
    for path in _sources():
        for name in _imported_roots(path):
            assert name not in FORBIDDEN and name.split(".")[0] not in FORBIDDEN, (
                f"{path.name} imports '{name}' — the library has no server, broker or database"
            )


def test_each_sdk_is_imported_only_from_its_own_adapter() -> None:
    """Spec 42 §2 rule 2, and spec 44 §11 criterion 14.

    An SDK import that escapes its adapter directory is the seam leaking: the
    next caller reaches past `AgentAdapter` for one convenient symbol, and the
    interface stops being the only way in. Cheap to assert, and it is the one
    rule adding a second SDK could quietly break.
    """
    for path in _sources():
        where = path.relative_to(PACKAGE).as_posix()
        for name in _imported_roots(path):
            home = SDK_HOMES.get(name.split(".")[0])
            assert home is None or where.startswith(f"{home}/"), (
                f"{where} imports '{name}', which belongs under {home}/ only"
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
