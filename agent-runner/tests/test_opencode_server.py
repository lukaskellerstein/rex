"""Spec 47 §4, §5.1 and §5.2 — the config, the keys, the environment, the mirror.

No `opencode` process is started here. What is asserted is everything that is
decided before one is: the config a route becomes, which runs share a server,
what reaches the child's environment, and what a mirror does and does not copy.
Criterion 13 lives in this file — no credential value in the provider JSON.
"""

import os
from pathlib import Path

import pytest

from agent_runner.adapters.opencode import mirror as mirror_module
from agent_runner.adapters.opencode.mirror import (
    MAX_FILE_BYTES,
    SKIP_DIRECTORIES,
    reconcile,
)
from agent_runner.adapters.opencode.server import (
    EXECUTABLE_VAR,
    PROVIDER,
    PROVIDER_PACKAGE,
    TOKEN_VARIABLE,
    _child_env,
    provider_config,
    resolve_executable,
    route_key,
    sandbox_available,
    sandbox_command,
    sandbox_profile,
    server_key,
)
from agent_runner.types import ResolvedRoute

SECRET = "sk-rex-0123456789abcdef"


def routed(**changes: object) -> ResolvedRoute:
    values: dict[str, object] = {
        "sdk": "opencode",
        "gateway_name": "Built-in",
        "base_url": "http://127.0.0.1:24334/v1",
        "auth": "environment",
        "token": SECRET,
    }
    values.update(changes)
    return ResolvedRoute(**values)  # type: ignore[arg-type]


# ── §4 — the private provider ───────────────────────────────────


def test_a_routed_config_names_the_variable_and_never_the_value() -> None:
    """Criterion 13, and the reason the config can be logged at all.

    `{env:REX_AGENT_TOKEN}` stays in the JSON and OpenCode resolves it from the
    child's own environment, so the credential never enters a file, a log or a
    command line.
    """
    config = provider_config(routed(), "lmstudio-gemma")
    rendered = repr(config)
    assert SECRET not in rendered
    assert config["provider"][PROVIDER]["options"]["apiKey"] == f"{{env:{TOKEN_VARIABLE}}}"
    assert config["provider"][PROVIDER]["options"]["baseURL"] == "http://127.0.0.1:24334/v1"
    assert config["provider"][PROVIDER]["npm"] == PROVIDER_PACKAGE


def test_the_small_model_is_the_chosen_model_and_not_an_inherited_one() -> None:
    """§4 — OpenCode uses the small model for titles and summaries.

    Leaving it inherited would turn one local-model choice into an unnoticed
    cloud request, which spec 43 §10.2 forbids.
    """
    config = provider_config(routed(), "lmstudio-gemma")
    assert config["model"] == f"{PROVIDER}/lmstudio-gemma"
    assert config["small_model"] == config["model"]


def test_sharing_and_auto_update_are_off_in_an_agent_server() -> None:
    for config in (provider_config(routed(), "m"), provider_config(routed(base_url=None), "a/b")):
        assert config["share"] == "disabled"
        assert config["autoupdate"] is False


def test_a_route_with_no_url_synthesizes_no_provider() -> None:
    """§4 — `Original` MEANS OpenCode's own providers, so the model is
    `provider/model` and REX invents nothing for it to resolve."""
    config = provider_config(routed(base_url=None, auth="inherit", token=None), "openai/gpt-5.4")
    assert "provider" not in config
    assert config["model"] == "openai/gpt-5.4"


def test_a_probe_config_names_no_model_rather_than_an_empty_one() -> None:
    """`session_state` asks with no model. `rex/` would be a string OpenCode
    fails on, and a lookup needs no default model at all."""
    config = provider_config(routed(), "")
    assert "model" not in config
    assert config["provider"][PROVIDER]["models"] == {}


def test_no_authentication_sends_no_key() -> None:
    config = provider_config(routed(auth="none", token=None), "m")
    assert "apiKey" not in config["provider"][PROVIDER]["options"]


# ── §5.1 — which runs share what ────────────────────────────────


def test_the_session_store_is_keyed_by_route_and_not_by_model() -> None:
    """§10.6 B4 — sessions live in `XDG_DATA_HOME`.

    Keying the directories by model would mean that changing the model in the
    composer silently lost every OpenCode session on that gateway, and that
    `session_state` — asked with no model at all — could never find one.
    """
    assert route_key(routed()) == route_key(routed())
    assert route_key(routed()) == route_key(routed())  # model plays no part
    assert route_key(routed()) != route_key(routed(base_url="http://127.0.0.1:24335/v1"))
    assert route_key(routed()) != route_key(routed(gateway_name="Another"))
    assert route_key(routed()) != route_key(routed(auth="none"))


def test_two_models_on_one_gateway_are_two_servers_sharing_one_store() -> None:
    """§5.1 — the key is everything the config is built from, and §4 puts the
    model in the config."""
    one = server_key(routed(), "model-a")
    two = server_key(routed(), "model-b")
    assert one != two
    assert one.split(":")[0] == two.split(":")[0] == route_key(routed())


def test_an_edited_gateway_gets_a_different_server() -> None:
    assert server_key(routed(), "m") != server_key(routed(base_url="http://elsewhere/v1"), "m")


def test_a_key_is_safe_to_use_as_a_directory_name() -> None:
    """A gateway name may contain anything a person can type, and it becomes a
    path. Hashing is what stops a slash in a name escaping the root."""
    key = route_key(routed(gateway_name="../../etc; rm -rf /"))
    assert key.isalnum() and len(key) == 16


# ── §5.1 step 2 — the child's environment ───────────────────────


def test_the_credential_reaches_the_child_and_nothing_else_does() -> None:
    root = Path("/tmp/rex-opencode-test")
    env = _child_env(routed(), "m", root, "the-password")
    assert env[TOKEN_VARIABLE] == SECRET
    assert env["OPENCODE_SERVER_PASSWORD"] == "the-password"
    assert SECRET not in env["OPENCODE_CONFIG_CONTENT"]
    # §5.1 — the service's own environment survives, so PATH and HOME still work.
    assert env.get("PATH") == os.environ.get("PATH")


def test_a_routed_run_gets_isolated_directories() -> None:
    """§5.1 — so global providers and plugins cannot alter the route."""
    root = Path("/tmp/rex-opencode-test")
    env = _child_env(routed(), "m", root, "pw")
    assert env["XDG_CONFIG_HOME"] == str(root / "config")
    assert env["XDG_DATA_HOME"] == str(root / "data")
    assert env["XDG_CACHE_HOME"] == str(root / "cache")


def test_a_no_url_route_keeps_the_reviewers_own_configuration() -> None:
    """§5.1 — it MEANS their own `opencode auth login`, and moving the
    directories would take the login with it."""
    env = _child_env(routed(base_url=None, auth="inherit", token=None), "a/b", Path("/tmp/x"), "pw")
    assert "XDG_CONFIG_HOME" not in env
    assert "XDG_DATA_HOME" not in env
    assert TOKEN_VARIABLE not in env


def test_os_environ_is_never_assigned() -> None:
    """Spec 43 §6.2 — one Python process serves every run at once, so a
    process-global assignment would route one comment's credential into another
    comment's child."""
    before = dict(os.environ)
    _child_env(routed(), "m", Path("/tmp/x"), "pw")
    assert dict(os.environ) == before
    assert TOKEN_VARIABLE not in os.environ


# ── §2.1 — the executable ───────────────────────────────────────


def test_a_missing_executable_is_a_sentence_and_not_an_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """§2.1 — REX does not install software during a run, so the answer is what
    to install rather than a traceback from inside a spawn."""
    monkeypatch.delenv(EXECUTABLE_VAR, raising=False)
    found, problem = resolve_executable()
    assert found == ""
    assert problem is not None and "OpenCode" in problem


def test_a_path_that_is_not_a_program_is_refused_by_name(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    not_a_program = tmp_path / "opencode"
    not_a_program.write_text("#!/bin/sh\n")
    not_a_program.chmod(0o644)
    monkeypatch.setenv(EXECUTABLE_VAR, str(not_a_program))
    found, problem = resolve_executable()
    assert found == ""
    assert problem is not None and str(not_a_program) in problem


def test_an_executable_path_is_accepted(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    program = tmp_path / "opencode"
    program.write_text("#!/bin/sh\nexit 0\n")
    program.chmod(0o755)
    monkeypatch.setenv(EXECUTABLE_VAR, str(program))
    found, problem = resolve_executable()
    assert found == str(program)
    assert problem is None


# ── §5.2 — the mirror ───────────────────────────────────────────


@pytest.fixture(autouse=True)
def isolated_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("REX_OPENCODE_HOME", str(tmp_path / "home"))


def test_the_mirror_is_a_copy_and_the_source_is_never_touched(tmp_path: Path) -> None:
    """§5.2 — OpenCode never sees the reviewed tree.

    §7.2 is why: OpenCode has permission prompts and no operating-system
    sandbox, so the last line of defence is that the dangerous path is not
    reachable from the process at all.
    """
    source = tmp_path / "workspace"
    (source / "docs").mkdir(parents=True)
    (source / "README.md").write_text("# hello\n")
    (source / "docs" / "report.md").write_text("body\n")

    where, report = reconcile(str(source), "thread-1")
    assert where.resolve() != source.resolve()
    assert (where / "README.md").read_text() == "# hello\n"
    assert (where / "docs" / "report.md").read_text() == "body\n"
    assert report.copied == 2


def test_the_same_thread_gets_the_same_mirror_twice(tmp_path: Path) -> None:
    """§5.2 — stable, so a reply reuses one rather than paying for a fresh copy."""
    source = tmp_path / "workspace"
    source.mkdir()
    (source / "a.md").write_text("a\n")
    first, _ = reconcile(str(source), "thread-1")
    second, report = reconcile(str(source), "thread-1")
    assert first == second
    # Unchanged, so nothing is copied the second time.
    assert report.copied == 0
    assert reconcile(str(source), "thread-2")[0] != first


def test_a_reviewers_edit_between_two_turns_reaches_the_mirror(tmp_path: Path) -> None:
    """Run before EVERY turn, not only the first. A reply that read a stale copy
    would answer about text the reviewer has already changed."""
    source = tmp_path / "workspace"
    source.mkdir()
    target = source / "a.md"
    target.write_text("first\n")
    where, _ = reconcile(str(source), "t")
    assert (where / "a.md").read_text() == "first\n"
    target.write_text("second and longer\n")
    where, report = reconcile(str(source), "t")
    assert (where / "a.md").read_text() == "second and longer\n"
    assert report.copied == 1


def test_a_deleted_file_leaves_the_mirror(tmp_path: Path) -> None:
    """Without it an agent asked "is this still referenced" answers from a tree
    that no longer exists."""
    source = tmp_path / "workspace"
    source.mkdir()
    (source / "a.md").write_text("a\n")
    (source / "b.md").write_text("b\n")
    where, _ = reconcile(str(source), "t")
    (source / "b.md").unlink()
    where, report = reconcile(str(source), "t")
    assert (where / "a.md").exists()
    assert not (where / "b.md").exists()
    assert report.removed == 1


def test_a_file_the_agent_wrote_into_the_mirror_is_swept_away(tmp_path: Path) -> None:
    """The mirror is not the agent's to keep. Anything the source does not have
    goes on the next turn, which is what stops one turn's scratch file being read
    back as source on the next."""
    source = tmp_path / "workspace"
    source.mkdir()
    (source / "a.md").write_text("a\n")
    where, _ = reconcile(str(source), "t")
    (where / "hacked.txt").write_text("BOOM\n")
    reconcile(str(source), "t")
    assert not (where / "hacked.txt").exists()


def test_the_repository_itself_is_never_copied(tmp_path: Path) -> None:
    """`.git` is the one directory an agent must not be able to rewrite, and
    `node_modules` is the one that makes a refresh take minutes."""
    source = tmp_path / "workspace"
    (source / ".git").mkdir(parents=True)
    (source / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    (source / "node_modules" / "left-pad").mkdir(parents=True)
    (source / "node_modules" / "left-pad" / "index.js").write_text("x\n")
    (source / "README.md").write_text("# hello\n")

    where, report = reconcile(str(source), "t")
    assert not (where / ".git").exists()
    assert not (where / "node_modules").exists()
    assert (where / "README.md").exists()
    assert report.copied == 1
    assert ".git" in SKIP_DIRECTORIES and "node_modules" in SKIP_DIRECTORIES


def test_a_large_file_is_skipped_and_counted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A 5 MB file is a binary, a lock file or a build artefact, and copying one
    per turn is what makes a reply feel slow."""
    monkeypatch.setattr(mirror_module, "MAX_FILE_BYTES", 16)
    source = tmp_path / "workspace"
    source.mkdir()
    (source / "small.md").write_text("ok\n")
    (source / "big.bin").write_bytes(b"x" * 64)
    where, report = reconcile(str(source), "t")
    assert (where / "small.md").exists()
    assert not (where / "big.bin").exists()
    assert report.skipped_large == 1
    assert MAX_FILE_BYTES > 0


def test_a_source_that_is_not_a_directory_gives_an_empty_mirror(tmp_path: Path) -> None:
    """The agent then says it can see nothing, which is true — rather than
    reading whatever was left from last time."""
    where, report = reconcile(str(tmp_path / "does-not-exist"), "t")
    assert where.is_dir()
    assert report.copied == 0
    assert not list(where.iterdir())


# ── §5.1 as amended — attribution, and the lease ────────────────


def test_attribution_travels_in_the_provider_config() -> None:
    """Criterion 16, and the only path it has.

    REX's client talks to the OpenCode *server*, not to the gateway, so a header
    on one of its own requests never reaches LiteLLM. `options.headers` does —
    measured 2026-09-07, `x-rex-thread` and `x-rex-profile` in the traffic log.
    """
    headers = {"x-rex-thread": "thread-1", "x-rex-profile": "read"}
    config = provider_config(routed(), "m", headers)
    assert config["provider"][PROVIDER]["options"]["headers"] == headers


def test_no_attribution_writes_no_headers_key() -> None:
    """An absent thread is normal — an Apply, a probe — and is not an error."""
    assert "headers" not in provider_config(routed(), "m")["provider"][PROVIDER]["options"]


def test_two_threads_are_two_servers_sharing_one_session_store() -> None:
    """The measurement that turned §5.1's cache into a lease.

    Headers are per run and a server can only carry one set, so a shared server
    would file the second comment's spend under the first comment's thread.
    """
    one = server_key(routed(), "m", {"x-rex-thread": "a"})
    two = server_key(routed(), "m", {"x-rex-thread": "b"})
    assert one != two
    # ...and both still read and write the same `XDG_DATA_HOME`, which is what
    # lets the next run resume a session the last one made (§10.6 B4).
    assert one.split(":")[0] == two.split(":")[0] == route_key(routed())


def test_the_same_attribution_is_the_same_server() -> None:
    """A reply on one thread reuses its run's server rather than starting a
    second one beside it."""
    headers = {"x-rex-thread": "a", "x-rex-profile": "read"}
    assert server_key(routed(), "m", headers) == server_key(routed(), "m", dict(headers))
    # Key order must not matter — the same headers built in a different order are
    # the same headers.
    reversed_headers = {"x-rex-profile": "read", "x-rex-thread": "a"}
    assert server_key(routed(), "m", headers) == server_key(routed(), "m", reversed_headers)


def test_a_read_and_a_write_run_do_not_share_a_server() -> None:
    """The profile is in the attribution, so it is in the key. Which is right:
    a `write` run costing five times a `read` one is the single most useful thing
    the gateway's grouping shows (spec 45 §6)."""
    assert server_key(routed(), "m", {"x-rex-profile": "read"}) != server_key(routed(), "m", {"x-rex-profile": "write"})


# ── §7.4 and §10.9 — the operating-system boundary ──────────────


def test_the_command_is_wrapped_where_there_is_a_boundary(tmp_path: Path) -> None:
    """§7.4 — the one thing that must never silently stop happening.

    Asserted as an argument list rather than by starting a 242 MB process, for
    the reason `local-gateway`'s `serve_args` is its own function: a boundary
    that quietly stopped being applied would look exactly like one that works.
    """
    profile = tmp_path / "rex.sb"
    wrapped = sandbox_command(profile, "/bin/opencode", ["serve", "--port=1"])
    assert wrapped == ["/usr/bin/sandbox-exec", "-f", str(profile), "/bin/opencode", "serve", "--port=1"]


def test_a_platform_with_no_boundary_runs_the_program_bare() -> None:
    """Linux and Windows have no profile written, so they get no wrapper — and
    §7.4 makes that a gate on ACT rather than a silent downgrade."""
    assert sandbox_command(None, "/bin/opencode", ["serve"]) == ["/bin/opencode", "serve"]


def test_a_profile_names_every_writable_root(tmp_path: Path) -> None:
    """A spec 22 ACT can touch several working copies at once — one per document
    under review — so the sandbox names roots, plural (spec 44 §9.3's wording,
    for the same reason)."""
    one = tmp_path / "copy-a"
    two = tmp_path / "copy-b"
    one.mkdir()
    two.mkdir()
    profile = sandbox_profile([one, two], tmp_path / "root")
    assert f'(subpath "{one.resolve()}")' in profile
    assert f'(subpath "{two.resolve()}")' in profile


def test_the_profile_denies_writing_and_allows_only_three_places(tmp_path: Path) -> None:
    mirror = tmp_path / "mirror"
    root = tmp_path / "root"
    mirror.mkdir()
    root.mkdir()
    profile = sandbox_profile([mirror], root)
    assert "(deny file-write*)" in profile
    assert f'(subpath "{mirror.resolve()}")' in profile
    assert f'(subpath "{root.resolve()}")' in profile
    # Reading is not what the boundary is about: OpenCode has to read the
    # machine to run at all, and REX is not trying to stop it.
    assert "(allow default)" in profile


def test_every_path_in_the_profile_is_resolved(tmp_path: Path) -> None:
    """`/tmp` is a symlink to `/private/tmp` on macOS, and a profile written with
    the unresolved form allows nothing — **silently**, because seatbelt does not
    complain about a subpath matching no file. It was the first thing that went
    wrong when this was measured (§10.9)."""
    link = tmp_path / "link"
    real = tmp_path / "real"
    real.mkdir()
    link.symlink_to(real)
    profile = sandbox_profile([link], real)
    assert f'(subpath "{real}")' in profile
    assert f'(subpath "{link}")' not in profile


def test_the_boundary_is_claimed_only_where_it_was_proved() -> None:
    """§7.4 is a gate — now on the machine rather than on the platform.

    It was `sys.platform in {"darwin"}` until spec 50 made macOS the only
    platform. What is left is the question that can still be answered no: a
    machine without `sandbox-exec` has no boundary, and an ACT there refuses.
    """
    assert sandbox_available() == Path("/usr/bin/sandbox-exec").exists()
