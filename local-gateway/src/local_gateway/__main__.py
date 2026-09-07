"""Spec 46 §10 — the three entry points, all spawned by REX's main process.

=======================================  =============  ==========================
command                                  shape          purpose
=======================================  =============  ==========================
``serve --port N --config <path>``       long-running   LiteLLM itself
``discover --provider <id> [--url U]``   one shot       what a provider serves
``write-config --out <path>``            one shot       the config REX writes
=======================================  =============  ==========================

**No new pipe protocol.** Two of the three are ordinary commands that print JSON
and exit, which is the simplest thing that works and needs no generated
contract. `agent-runner/` has the pipe; a second one would be a second thing to
keep in step, for two commands that answer once and end.

A key never arrives as an argument. ``discover`` reads it from
``REX_PROVIDER_KEY`` in its own environment, because an argument is visible in
`ps` to every process on the machine and an environment variable is not.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from .config import ConfigRequest, render
from .probes import probe_for
from .providers import CATALOGUE
from .serve import serve
from .types import DiscoveryResult

#: Where `discover` reads a provider key from. Never an argument (see above).
KEY_VAR = "REX_PROVIDER_KEY"


def _discover(provider: str, url: str | None) -> int:
    """Ask one provider what it serves, and print the answer as JSON.

    **A failure is a result, not a traceback.** The host draws this in a
    Settings screen, and "could not reach LM Studio at …" is a sentence a person
    can act on, while a stack trace on stderr and a non-zero exit is not.
    """
    try:
        models = probe_for(provider)(provider, url, os.environ.get(KEY_VAR) or None)
        result = DiscoveryResult(provider=provider, models=models)
    except Exception as error:  # noqa: BLE001 — every failure is reported, none escapes
        result = DiscoveryResult(provider=provider, error=f"{type(error).__name__}: {error}")
    sys.stdout.write(result.model_dump_json(by_alias=True))
    sys.stdout.write("\n")
    return 0


def _write_config(out: Path) -> int:
    """Read the ticked models as JSON on stdin, write `config.yaml`, say where."""
    try:
        request = ConfigRequest.model_validate_json(sys.stdin.read() or "{}")
    except ValueError as error:
        print(f"local-gateway: unreadable request — {error}", file=sys.stderr)
        return 2
    try:
        text = render(request)
    except ValueError as error:
        print(f"local-gateway: {error}", file=sys.stderr)
        return 2
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    sys.stdout.write(json.dumps({"wrote": str(out), "models": len(request.models)}) + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="local-gateway", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("serve", help="run LiteLLM on one loopback port")
    run.add_argument("--port", type=int, required=True)
    run.add_argument("--config", type=Path, required=True)

    ask = commands.add_parser("discover", help="what one provider serves, now")
    ask.add_argument("--provider", required=True)
    ask.add_argument("--url", default=None)

    write = commands.add_parser("write-config", help="render config.yaml from JSON on stdin")
    write.add_argument("--out", type=Path, required=True)

    commands.add_parser("catalogue", help="the six provider descriptors, as JSON")

    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    if args.command == "serve":
        return serve(args.port, args.config)
    if args.command == "discover":
        return _discover(args.provider, args.url)
    if args.command == "catalogue":
        return _catalogue()
    return _write_config(args.out)


def _catalogue() -> int:
    """The provider table, for a host to render controls from.

    Spec 46 §5.2 — **the library describes the configuration and the host
    renders it.** REX cannot import Python from its renderer, so the six
    descriptors are emitted as JSON and committed as `catalogue.json`, exactly
    as `agent-runner` does with the gateway kinds (spec 42 §10).

    `tests/test_catalogue.py` compares the committed file with what this
    produces, so the two cannot drift without a test failing.
    """
    rows = [CATALOGUE[key].model_dump(by_alias=True, mode="json") for key in CATALOGUE]
    sys.stdout.write(json.dumps({"providers": rows}, indent=2, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
