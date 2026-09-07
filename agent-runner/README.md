# agent-runner

Agent SDKs and AI gateways behind one interface.

The package knows about **SDKs and gateways**, and nothing about documents,
comments, threads, databases, windows or the app that spawned it. It cannot
import any of those — it runs in its own interpreter.

Spec: `docs/my-specs/42-the-agent-library/SPEC.md` in the REX repository.

## What is in it

| Module | Holds |
|:--|:--|
| `protocol.py` | every message on the pipe, as Pydantic models. The contract. |
| `service.py` | the asyncio loop: read a line, dispatch it, write lines back |
| `types.py` | `AgentSdk`, `GatewayKind`, `AgentGateway`, `ResolvedRoute`, `AgentSession` |
| `events.py` | `AgentEvent` — the SDK-independent union — and `RunResult` |
| `policy.py` | `CommonTool`, `ToolCall`; the host answers, the library never decides |
| `describe.py`, `catalogue.py` | the descriptor a host renders as its own UI |
| `resolve.py` | `resolve_route()`, `validate_base_url()` |
| `run.py` | pick an adapter, run it, stream its events |
| `adapters/claude/` | the Claude Agent SDK behind `AgentAdapter` |

## Two ways to use it

### 1. As a library, from Python

Call `run()` directly. No service, no pipe, no subprocess of ours.

```bash
uv add --editable /path/to/rex/agent-runner
```

```python
import asyncio

from agent_runner import (
    ORIGINAL_GATEWAY,
    NewSession,
    RunRequest,
    resolve_route,
    run,
)


async def main() -> None:
    request = RunRequest(
        run_id="demo",
        route=resolve_route(ORIGINAL_GATEWAY, "claude-agent", {}),
        cwd=".",
        prompt="In one sentence, what is in this directory?",
        session=NewSession(),
        system_prompt="Answer briefly.",
        disallowed=["write", "edit"],
    )

    def emit(event) -> None:
        if event.type == "text":
            print(event.text, end="")

    async def allow(call) -> str | None:
        return None  # None allows; a string is the refusal reason

    result = await run(request, emit, allow, asyncio.Event())
    print("\ncost:", result.cost_usd)


asyncio.run(main())
```

`emit` receives an `AgentEvent`. `ask_policy` receives a `ToolCall` and returns
`None` to allow it or a sentence to refuse it — **the host owns every
decision**; the library only asks.

### 2. As a service, from a host in another language

```bash
uv run python -m agent_runner
```

One JSON object per line on stdin, one per line on stdout. The first line out
is `{"type":"ready", ...}`. `stderr` is not the protocol — it is where every
log line and every traceback goes.

**File descriptor 1 carries the protocol and nothing else.** The service
rebinds `sys.stdout` to `sys.stderr` at startup, so a stray `print()` in an SDK
cannot corrupt the stream.

The message shapes are in `protocol.py`. A host in TypeScript gets them
generated:

```bash
uv run python -m agent_runner.protocol --schema     > schema.json
uv run python -m agent_runner.protocol --typescript > ../src/shared/agent-protocol.ts
uv run python -m agent_runner.protocol --catalogue  > catalogue.json
```

**Every field is camelCase on the wire.** `run_id` in Python is `runId` in
JSON and in the generated TypeScript.

## What it must never grow

- an import of the host application
- an HTTP server, a NATS client, or any socket listener
- a database, a session store, a gateway store, or any cache that outlives a run

`tests/test_boundary.py` fails if the first one appears.

## Development

```bash
uv sync                # make .venv
uv run pytest          # the tests
```

`uv` only. Never `pip`.
