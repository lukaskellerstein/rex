"""Spec 47 §5.1 — the loopback OpenCode server, and the one registry that owns it.

OpenCode is the only SDK with two planes: REX's client talks HTTP and SSE to an
**OpenCode server**, and that server talks to the model API. This module owns the
first hop. `route.base_url` always means the second one (§2).

The registry holds **OpenCode's processes**, never REX's data — which is the
whole of what spec 42 §3.2 allows. It is **leased rather than cached**: a server
is started for a run and closed when the last holder lets go, so between runs
this package keeps nothing at all. `server_key` records the three measurements
that turned §5.1's cache into a lease.

Three things here came out of measurement rather than the spec's prose, and all
three are load-bearing (spec 47 §10.6):

* **The server password is HTTP Basic with the literal username `opencode`.** A
  fresh random password per child, so anything else on the machine that finds
  the port gets a 401 instead of a shell.
* **The bootstrap does not land in the project directory.** With the three
  isolated `XDG_*` directories below it goes to `XDG_CACHE_HOME/opencode/bin`
  and `XDG_DATA_HOME/opencode/{repos,log}`. §5.2's stated reason for the mirror
  did not reproduce at 1.18.27; the mirror stays for the reasons that did.
* **Attribution can only travel in the provider config.** REX's client talks to
  the OpenCode server rather than to the gateway, so `options.headers` is the
  only path `x-rex-thread` has to LiteLLM — and headers are per run, which is
  what makes a shared server impossible and the lease necessary.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import secrets
import shutil
import socket
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from ...types import ResolvedRoute
from .client import SERVER_USER, OpenCodeClient

#: §2.1 — the resolved `opencode` path, app-wide, set by the host on this child.
#:
#: **Not a field on `RunRequest`**, which is a deliberate divergence from §8's
#: sketch and is worth the sentence. `capabilities()` and `session_state()` need
#: the same value and carry no request, so a request-only block would leave two
#: of an adapter's four questions unanswerable — and §2.1 itself calls the value
#: app-wide rather than part of a route. `REX_CODEX_HOME` in the Codex adapter is
#: the same shape for the same reason. The library still never SEARCHES for it.
EXECUTABLE_VAR = "REX_OPENCODE_EXECUTABLE"

#: §5.1 and §5.2 — the directory the HOST supplies, under which the library puts
#: this route's isolated config and this thread's mirror. The library picks the
#: subdirectories; it never picks the root.
HOME_VAR = "REX_OPENCODE_HOME"

#: The credential variable the private provider's config points at (§4).
#:
#: One constant used in both halves — the config that says `{env:REX_AGENT_TOKEN}`
#: and the environment that carries the value — because a mismatch between them
#: is a run that authenticates with nothing and says 401.
TOKEN_VARIABLE = "REX_AGENT_TOKEN"

#: §4 — the private provider's id. A constant, because each server is built for
#: exactly one route and there is nothing for a unique id to tell apart.
PROVIDER = "rex"

#: The one npm package §4 pins. Never taken from IPC, and never widened without
#: the review §12 asks for.
PROVIDER_PACKAGE = "@ai-sdk/openai-compatible"

#: How long `opencode serve` gets to answer `/global/health`.
#:
#: Measured at 0.44 s on this machine (§10.6 B1); the margin is for a cold file
#: cache and a loaded machine, not for a hang.
HEALTH_TIMEOUT = 30.0

#: §7.4 — the platforms where REX can put an operating-system boundary around
#: the server, and therefore the only ones where §7.2's third layer is real.
#:
#: **`sandbox-exec` is macOS's, and it is deprecated and still works.** Measured
#: on 26.6.2, spec 47 §10.9: `opencode serve` starts inside one in 0.43 s, an
#: edit in the mirror succeeds, and a shell command aimed at a directory outside
#: it gets `operation not permitted`. It is the same mechanism Codex's own
#: seatbelt sandbox uses, which is the argument for it: REX is not inventing a
#: containment scheme, it is using the one the platform already gives agents.
#:
#: REX is macOS only (spec 50), so there is one mechanism and no platform gate.
#: `sandbox_available()` still asks, because the binary can be absent from a
#: machine and an ACT with no boundary must refuse rather than run.

#: The seatbelt profile, and every line of it was earned by a run that failed
#: without it.
#:
#: `(allow default)` then `(deny file-write*)` is the shape: OpenCode needs to
#: read the machine — Bun's own runtime, the executable, certificates — and REX
#: is not trying to stop it reading. **What it must not do is write**, anywhere
#: but the three directories that are REX's to lose.
#:
#: The temp directory is allowed because Bun will not start without it, and that
#: is the profile's one real weakness: a workspace under `TMPDIR` would be
#: inside the boundary. It is also the bug that made the first measurement lie —
#: the fake repository was under `TMPDIR`, the escape "succeeded", and the
#: boundary was blamed for the test's mistake (§10.9).
SANDBOX_PROFILE = """(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  {writable}
  (subpath "{root}")
  (subpath "{tmp}")
  (literal "/dev/null")
  (literal "/dev/dtracehelper")
)
(allow file-write-data (regex #"^/dev/tty"))
"""


def sandbox_available() -> bool:
    """Whether this machine has the boundary REX has actually proved."""
    return os.path.exists("/usr/bin/sandbox-exec")


def sandbox_profile(writable: list[Path], root: Path) -> str:
    """The profile for one server: what it may write, its own directories, temp.

    **Every path is resolved first.** `/tmp` is a symlink to `/private/tmp` on
    macOS, and a profile written with the unresolved form allows nothing at all —
    silently, because seatbelt does not complain about a subpath that matches
    no file. It was the first thing to go wrong when this was measured.

    `writable` is a LIST because a spec 22 ACT can touch several working copies
    at once — one per document under review — and a sandbox names roots rather
    than files (spec 44 §9.3's own wording, for the same reason).
    """
    allowed = "\n  ".join(f'(subpath "{path.resolve()}")' for path in writable)
    return SANDBOX_PROFILE.format(
        writable=allowed,
        root=root.resolve(),
        tmp=Path(tempfile.gettempdir()).resolve(),
    )


def sandbox_command(profile: Path | None, executable: str, arguments: list[str]) -> list[str]:
    """The argv to spawn: wrapped where REX has a boundary, bare where it has not.

    Separated from the spawn so a test can read the argument list without
    starting a 242 MB process — the same reason `local-gateway`'s `serve_args`
    is its own function, and for the same rule: the thing that must never
    silently stop happening is asserted rather than trusted.
    """
    if profile is None:
        return [executable, *arguments]
    return ["/usr/bin/sandbox-exec", "-f", str(profile), executable, *arguments]


def home() -> Path:
    """The root the host supplied, or REX's own default beside the database."""
    root = Path(os.environ.get(HOME_VAR) or Path.home() / ".rex" / "opencode")
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_executable() -> tuple[str, str | None]:
    """The `opencode` binary, and why there is none.

    §2.1 — **the host resolves it and the library never searches.** Searching a
    machine is a host decision, and spec 42 §3.2 keeps this package out of REX's
    settings. What is left here is the check that the answer is usable, because
    a path that no longer exists must fail with a sentence rather than with
    `FileNotFoundError` from inside a spawn.
    """
    named = (os.environ.get(EXECUTABLE_VAR) or "").strip()
    if not named:
        return "", (
            "REX could not find the `opencode` program. Install OpenCode, or name its "
            "path under OPENCODE EXECUTABLE in Manage gateways. REX does not install "
            "software during a run."
        )
    found = named if os.path.isabs(named) else (shutil.which(named) or "")
    if not found or not os.path.isfile(found) or not os.access(found, os.X_OK):
        return "", f"'{named}' is not a program REX can run. Check OPENCODE EXECUTABLE in Manage gateways."
    return found, None


def free_port() -> int:
    """A loopback port, bound and released — the course's `_free_port()` (`:415-418`).

    A race in principle and never one in practice: the window is microseconds
    and the loser gets a spawn that fails to bind, which `wait_healthy` reports
    with the child's exit status rather than as a timeout.
    """
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def provider_config(route: ResolvedRoute, model: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    """§4 — one private provider, inline, for exactly this route.

    `model` and `small_model` are both the chosen model. OpenCode uses the small
    one for titles and summaries, and leaving it inherited would turn one local
    model choice into an unnoticed cloud request — which spec 43 §10.2 forbids.

    A route with no URL synthesizes nothing: the model must be in `provider/model`
    form and OpenCode's own provider configuration resolves it. That is what
    `Original` means.

    `headers` is spec 45 §6's attribution, and **the provider config is the only
    place it can go**. REX's client talks to the OpenCode *server*, not to the
    gateway, so a header on one of its requests never reaches LiteLLM; the AI
    SDK's `options.headers` does. Measured 2026-09-07: `x-rex-thread` and
    `x-rex-profile` arrive in the gateway's traffic log, which is criterion 16.
    """
    base: dict[str, Any] = {"share": "disabled", "autoupdate": False}
    # An empty model is `session_state`'s probe (§5.3): a server that answers
    # `GET /session/{id}` needs no default model, and naming an empty one would
    # produce the string `rex/` for OpenCode to fail on.
    if not route.base_url:
        return {**base, **({"model": model, "small_model": model} if model else {})}

    options: dict[str, Any] = {"baseURL": route.base_url}
    if route.auth in ("environment", "stored"):
        # The NAME, never the value. OpenCode resolves it from the child's own
        # environment, so the credential never enters JSON, a log or a command
        # line — criterion 13.
        options["apiKey"] = f"{{env:{TOKEN_VARIABLE}}}"
    if headers:
        options["headers"] = dict(headers)
    config: dict[str, Any] = {
        **base,
        "enabled_providers": [PROVIDER],
        "provider": {
            PROVIDER: {
                "name": route.gateway_name,
                "npm": PROVIDER_PACKAGE,
                "options": options,
                "models": {model: {"name": model}} if model else {},
            },
        },
    }
    if model:
        config["model"] = f"{PROVIDER}/{model}"
        config["small_model"] = f"{PROVIDER}/{model}"
    return config


def route_key(route: ResolvedRoute) -> str:
    """Which ROUTE this is — and therefore which session store it uses.

    The model is deliberately **not** in it. OpenCode keeps its sessions in
    `XDG_DATA_HOME`, so keying the directories by model would mean that changing
    the model in the composer silently lost every OpenCode session on that
    gateway — and `session_state`, which is asked with no model at all, could
    never find one. Spec 47 §10.6 B4 is the measurement that the data home is
    what makes a session resumable.
    """
    material = json.dumps([route.gateway_name, route.base_url, route.auth], separators=(",", ":"))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def server_key(route: ResolvedRoute, model: str, headers: dict[str, str] | None = None) -> str:
    """Which SERVER PROCESS this is: everything the config is built from.

    §5.1 says "keyed by … everything the config is built from", and once §4's
    config carries attribution headers that includes the run — so this is **one
    server per run**, not one per route, and §5.1 is amended by measurement.
    Three things forced it, in order:

    1. **Attribution has to be in the config.** REX's client talks to the
       OpenCode server rather than to the gateway, so `options.headers` is the
       only path a `x-rex-thread` has to LiteLLM (criterion 16). Headers are
       per run; a shared server can only carry one set, and the second comment's
       spend would be filed under the first comment's thread.
    2. **A cached server is not free.** Measured 2026-09-07 with `lukas-ps`: an
       idle REX-spawned `opencode serve` holds **242 MB**. Five of them, held for
       the life of the app to save half a second, is 1.2 GB.
    3. **A server costs 0.44 s to start** (§10.6 B1), against a turn that takes
       seconds. So the cache was buying very little.

    Nothing is lost. Session state lives in `XDG_DATA_HOME`, which `route_key`
    still keys by route alone, so a session made by one run is resumed by the
    next — §10.6 B4 measured exactly that across a server restart. And §5.4's
    session-id filter becomes belt and braces rather than load-bearing, which is
    the right direction for a rule whose failure mode is one comment's answer
    landing in another's transcript.
    """
    material = json.dumps([model, headers or {}], sort_keys=True, separators=(",", ":"))
    return f"{route_key(route)}:{hashlib.sha256(material.encode('utf-8')).hexdigest()[:12]}"


@dataclass
class Server:
    """One `opencode serve` child, and the password only REX knows."""

    process: asyncio.subprocess.Process
    url: str
    password: str
    key: str
    drains: list[asyncio.Task[None]] = field(default_factory=list)

    def client(self, directory: str) -> OpenCodeClient:
        """A client for one project directory on this server.

        One server serves many mirrors, which is why `directory` is a parameter
        here and not a property of the server: §5.1 caches per route and §5.2
        wants a mirror per thread, and the two only fit because the directory
        rides on every request.
        """
        return OpenCodeClient(self.url, directory, self.password)

    async def close(self) -> None:
        """The course's own shutdown (`:402-412`): terminate, five seconds, kill."""
        if self.process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    self.process.kill()
                await self.process.wait()
        for task in self.drains:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


async def _drain(stream: asyncio.StreamReader | None) -> None:
    """§5.1 step 3 — the child's output becomes the service's, so a crash lands
    in `rex.log` (spec 42 §4.1) instead of filling a pipe nobody reads."""
    if stream is None:
        return
    while line := await stream.readline():
        sys.stderr.write(f"[opencode] {line.decode('utf-8', 'replace').rstrip()}\n")


async def _wait_healthy(url: str, password: str, process: asyncio.subprocess.Process) -> float:
    """Poll `/global/health` — the course's `_wait_healthy()` (`:428-441`).

    **An early exit is reported with its status**, not as a timeout with nothing
    in it: a server that died because the port was taken and one that is merely
    slow look identical from the outside, and only one of them is worth waiting
    for.
    """
    loop = asyncio.get_running_loop()
    started = loop.time()
    deadline = started + HEALTH_TIMEOUT
    while loop.time() < deadline:
        if process.returncode is not None:
            raise RuntimeError(f"The OpenCode server exited with status {process.returncode} while starting.")
        try:
            async with httpx.AsyncClient(timeout=0.5) as probe:
                answer = await probe.get(f"{url}/global/health", auth=(SERVER_USER, password))
                if answer.is_success:
                    return loop.time() - started
        except (httpx.HTTPError, OSError):
            pass
        await asyncio.sleep(0.1)
    raise TimeoutError(f"The OpenCode server did not answer at {url} within {HEALTH_TIMEOUT:.0f}s.")


class ServerRegistry:
    """§5.1 — the servers that are open right now, and nothing else.

    **Leased, not cached**, which is the amendment `server_key` explains: a
    server is started for a run and closed when the last holder lets go. So the
    registry keeps nothing between runs — which is what spec 42 §3.2 wants of
    this package anyway, and which is why a 242 MB process is not sitting idle
    for the life of the app.

    The lock is not decoration. Two comments sent at once arrive as two tasks in
    one event loop, and without it both would see an empty registry and spawn a
    server; the second would win the dictionary and the first would be a 242 MB
    process nobody ever closes.
    """

    def __init__(self) -> None:
        self._servers: dict[str, Server] = {}
        self._holders: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def acquire(
        self,
        route: ResolvedRoute,
        model: str,
        executable: str,
        headers: dict[str, str] | None = None,
        writable: list[Path] | None = None,
    ) -> Server:
        """A server for this run. **Every acquire needs a matching `release`.**

        `writable` is every directory outside REX's own that this child may
        write to, and it is what the §7.4 sandbox is built around. For a read run
        that is the one disposable mirror; for a write run it is the working
        copies (§7.4.1 option B). A caller that passes none gets a server
        confined to REX's own directories — right for a probe, and wrong for a
        run, which is why the run path never omits it.
        """
        key = server_key(route, model, headers)
        async with self._lock:
            found = self._servers.get(key)
            if found is not None and found.process.returncode is None:
                self._holders[key] = self._holders.get(key, 0) + 1
                return found
            if found is not None:
                # It died. Drop it rather than hand back a URL nothing answers.
                await found.close()
            server = await self._start(route, model, executable, key, headers, writable)
            self._servers[key] = server
            self._holders[key] = 1
            return server

    async def release(self, server: Server) -> None:
        """Let go. The last holder closes it.

        Never `close()` a `Server` directly: with two runs on one key — a reply
        sent twice, a retry — the first to finish would kill the second's server
        mid-turn, and the symptom would be a stream that simply stopped.
        """
        async with self._lock:
            left = self._holders.get(server.key, 1) - 1
            if left > 0:
                self._holders[server.key] = left
                return
            self._holders.pop(server.key, None)
            if self._servers.get(server.key) is server:
                self._servers.pop(server.key, None)
        with contextlib.suppress(Exception):
            await server.close()

    def open_servers(self) -> int:
        """How many are running. For a test, and for a debug report."""
        return len(self._servers)

    async def _start(
        self,
        route: ResolvedRoute,
        model: str,
        executable: str,
        key: str,
        headers: dict[str, str] | None,
        writable: list[Path] | None,
    ) -> Server:
        # Keyed by ROUTE and not by server, so every model on one gateway shares
        # one session store. Stable across restarts on purpose: OpenCode keeps
        # session state in `XDG_DATA_HOME`, and §10.6 B4 is the proof that this
        # is what makes a session resumable after the server has been replaced.
        root = home() / "servers" / route_key(route)
        for leaf in ("config", "data", "cache"):
            (root / leaf).mkdir(parents=True, exist_ok=True)
        password = secrets.token_urlsafe(24)
        port = free_port()
        url = f"http://127.0.0.1:{port}"

        # §7.4 — the third layer, where the platform has one. It is written per
        # server rather than once, because the mirror it names is this run's.
        profile: Path | None = None
        if sandbox_available():
            profile = root / f"{key.replace(':', '-')}.sb"
            profile.write_text(sandbox_profile(writable or [home()], root))

        process = await asyncio.create_subprocess_exec(
            *sandbox_command(
                profile,
                executable,
                ["serve", "--hostname=127.0.0.1", f"--port={port}"],
            ),
            cwd=str(home()),
            env=_child_env(route, model, root, password, headers),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        server = Server(process=process, url=url, password=password, key=key)
        server.drains = [
            asyncio.create_task(_drain(process.stdout)),
            asyncio.create_task(_drain(process.stderr)),
        ]
        try:
            await _wait_healthy(url, password, process)
        except BaseException:
            await server.close()
            raise
        return server

    async def close(self) -> None:
        """Spec 42 §4.2 — every server ends when the service does. Criterion 4.

        The backstop, not the ordinary path: leases close a server the moment its
        run ends, so on a healthy shutdown there is usually nothing here. It
        exists for the run that was still going when the host asked to quit.
        """
        async with self._lock:
            servers = list(self._servers.values())
            self._servers.clear()
            self._holders.clear()
        for server in servers:
            with contextlib.suppress(Exception):
                await server.close()


def _child_env(
    route: ResolvedRoute,
    model: str,
    root: Path,
    password: str,
    headers: dict[str, str] | None = None,
) -> dict[str, str]:
    """§5.1 step 2 — the service's own environment, with only these keys changed.

    **`os.environ` is never assigned.** One Python process serves every run at
    once, so a process-global assignment would route one comment's credential
    into another comment's child — spec 43 §6.2, and the same rule the Codex
    adapter keeps.

    A no-URL `inherit` route deliberately gets **no** isolated directories: it
    MEANS the reviewer's own OpenCode configuration and their own
    `opencode auth login`, and moving the directories would take the login with
    them.
    """
    env = {key: value for key, value in os.environ.items() if isinstance(value, str)}
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(provider_config(route, model, headers))
    # §10.6 C — without it the server prints "server is unsecured" and anything
    # on this machine can drive it for as long as a run is open.
    env["OPENCODE_SERVER_PASSWORD"] = password
    if route.base_url:
        env["XDG_CONFIG_HOME"] = str(root / "config")
        env["XDG_DATA_HOME"] = str(root / "data")
        env["XDG_CACHE_HOME"] = str(root / "cache")
        if route.token:
            env[TOKEN_VARIABLE] = route.token
    return env


#: The service's registry. One per process, which is one per REX.
REGISTRY = ServerRegistry()


__all__ = [
    "EXECUTABLE_VAR",
    "HOME_VAR",
    "PROVIDER",
    "PROVIDER_PACKAGE",
    "REGISTRY",
    "TOKEN_VARIABLE",
    "Server",
    "ServerRegistry",
    "free_port",
    "home",
    "provider_config",
    "resolve_executable",
    "route_key",
    "sandbox_available",
    "sandbox_command",
    "sandbox_profile",
    "server_key",
]
