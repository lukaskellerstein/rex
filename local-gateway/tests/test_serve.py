"""Spec 46 §14 rule 1 and criterion A3 — loopback, and nothing else.

.. danger::
   LiteLLM's ``--host`` default is ``0.0.0.0``. Measured against
   `litellm.proxy.proxy_cli.run_server` on 2026-09-06. So "we did not pass a
   host" and "we bound every interface on the machine" are the same sentence,
   and that is exactly the kind of failure nobody sees until it matters.

The argument list is asserted rather than the socket, because the socket needs a
running proxy and a test that needs 456 MB of imports to prove one string is a
test people turn off.
"""

from pathlib import Path

from local_gateway.serve import HOST, serve_args


def test_binds_loopback_and_says_so_explicitly() -> None:
    args = serve_args(24334, Path("/tmp/config.yaml"))
    assert "--host" in args, "the host must be passed; LiteLLM's own default is 0.0.0.0"
    assert args[args.index("--host") + 1] == "127.0.0.1"


def test_never_offers_any_other_interface() -> None:
    assert HOST == "127.0.0.1"
    args = serve_args(24334, Path("/tmp/config.yaml"))
    assert "0.0.0.0" not in args
    # Not a hostname either: `localhost` can resolve to a v6 address the SDK
    # then fails to reach, and it depends on a hosts file REX does not own.
    assert "localhost" not in args


def test_carries_the_port_and_the_config_it_was_given() -> None:
    args = serve_args(24999, Path("/somewhere/config.yaml"))
    assert args[args.index("--port") + 1] == "24999"
    assert args[args.index("--config") + 1] == "/somewhere/config.yaml"


def test_does_not_phone_home() -> None:
    """A desktop app does not report its owner's usage without being asked."""
    args = serve_args(24334, Path("/tmp/config.yaml"))
    assert args[args.index("--telemetry") + 1] == "False"


def test_a_missing_config_is_a_refusal_and_not_a_crash(tmp_path: Path) -> None:
    from local_gateway.serve import serve

    assert serve(24334, tmp_path / "absent.yaml") == 2
