"""Spec 46 §4.2 and §4.3 — LiteLLM, on one loopback port.

.. danger::
   **LiteLLM's own default host is ``0.0.0.0``.** Verified against
   `litellm.proxy.proxy_cli.run_server` on 2026-09-06: the ``--host`` option's
   default binds every interface on the machine. So the address is passed
   **explicitly, every time**, and `HOST` below is the only value this package
   will use. §14 rule 1 and criterion A3 are the rule; this is where it is kept,
   and `tests/test_serve.py` asserts the argument rather than trusting it.

**A busy port is never adopted** (§4.2). REX claims a port by starting its own
child on it; if the child cannot bind, REX moves up a number. There is no "is
something already there?" probe whose answer could be trusted — anything that
answers on 24334 might be somebody else's proxy, and sending it a provider key
would be handing credentials to a stranger.

The master key arrives as ``LITELLM_MASTER_KEY`` in the environment and is never
written to a disk (§4.3). It is random per launch, so a key read out of one
run's process listing is worthless to the next.
"""

import sys
from pathlib import Path

#: §4.2 — `127.0.0.1` only. Never `0.0.0.0`, and never configurable.
#:
#: Not a parameter on purpose. A host that can be passed in is a host that can
#: be passed `0.0.0.0` by a future caller who thought it would be convenient,
#: and the whole of §14 rule 1 turns on it not being possible.
HOST = "127.0.0.1"


def serve_args(port: int, config: Path) -> list[str]:
    """The argument list `run_server` is given. Separated so a test can read it."""
    return [
        "--host",
        HOST,
        "--port",
        str(port),
        "--config",
        str(config),
        # A desktop application does not phone home about its owner's usage
        # without being asked, and nobody is asked here.
        "--telemetry",
        "False",
    ]


def serve(port: int, config: Path) -> int:
    """Run the proxy until it is killed. Returns only on failure.

    `run_server` is LiteLLM's own click command, invoked rather than
    reimplemented: it loads the config, wires the callbacks and starts uvicorn,
    and every one of those is behaviour REX wants to inherit rather than copy.
    `standalone_mode=False` stops click calling `sys.exit` out from under us.
    """
    if not config.exists():
        print(f"local-gateway: no config at {config}", file=sys.stderr)
        return 2

    from litellm.proxy.proxy_cli import run_server

    run_server.main(args=serve_args(port, config), standalone_mode=False)
    return 0
