# local-gateway

REX's own LiteLLM, on one loopback port. Spec 46.

It is a **sibling** of `agent-runner/`, never a part of it, and the two never
import each other — `tests/test_boundary.py` asserts both directions. The reason
is one line of spec 42 §3.2: the agent library may hold no HTTP server, and
`litellm[proxy]` is one. Putting the proxy there would break the rule that keeps
that library reviewable, and would put a 479 MB proxy in the dependency closure
of a package spec 42 §3.3 promises is reusable.

They have nothing to say to each other. `agent-runner` is given a URL; it does
not care who serves it.

## What it does

| Command | Shape | Purpose |
|:--|:--|:--|
| `serve --port N` | long-running | LiteLLM itself, bound to `127.0.0.1` |
| `discover --provider <id> [--url <url>]` | one shot, JSON on stdout | what a provider serves (§5.3) |
| `write-config --out <path>` | one shot, reads JSON on stdin | the `config.yaml` REX writes (§4.4) |

Two of the three are ordinary commands that print JSON and exit, which is the
simplest thing that works and needs no generated contract. There is **no pipe
protocol here** — that belongs to `agent-runner/`, and having one would be a
second one to keep in step.

## What it must never contain

A database, a NATS client, an import of anything in REX, or an import of
`agent_runner`. It binds `127.0.0.1` and never any other interface (§14 rule 1),
and a test asserts the argument.

## Credentials

`config.yaml` holds `os.environ/REX_PROVIDER_<ID>` and **never a value**. The
value reaches the child in its process environment, decrypted in REX's main
process immediately before spawn. The master key is random per launch and is
never written to a disk.

## Running it by hand

```bash
uv sync
uv run python -m local_gateway discover --provider lmstudio --url http://127.0.0.1:1234
echo '{"models":[],"traffic":false}' | uv run python -m local_gateway write-config --out /tmp/config.yaml
LITELLM_MASTER_KEY=sk-test uv run python -m local_gateway serve --port 24334 --config /tmp/config.yaml
```
