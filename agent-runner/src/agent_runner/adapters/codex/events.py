"""Spec 44 §8 — Codex's thread items, turned into `AgentEvent`s.

Pure functions over the SDK's item models, so a recorded turn can be replayed
through them with no CLI, no network and no key — which is what lets
`tests/test_codex_events.py` prove the mapping without spending a token.

Three rules run through all of it, and each is spec 42 §7's:

* **Nothing is invented.** An item type the adapter does not know produces no
  event at all, rather than a `text` guessed from it.
* **Only terminal items are durable.** `item/started` and the delta
  notifications drive what is on screen while a turn runs; emitting each
  snapshot would repeat one command several times in the transcript, which is
  the failure spec 38 exists to avoid.
* **The host's rendering decisions are not made here.** A `diff` carries the old
  lines and the new lines; how they are drawn is the host's business.
"""

import shlex
from collections.abc import Iterator
from enum import Enum
from pathlib import PurePosixPath
from typing import Any

from ...events import (
    AgentEvent,
    Diff,
    Text,
    Thinking,
    ToolCallEvent,
    ToolResultEvent,
    Wrote,
)
from .tools import CODEX_TOOL_NAMES, common_tool, mcp_tool_name

#: How much of a tool result a host is given. Beyond this it is a blob, not a
#: message, and it would be stored and replayed on every read of the thread.
RESULT_CLIP = 4000

#: How much of one file's change is shown as a diff, for the same reason.
DIFF_CLIP = 10_000


def _text(value: Any) -> str:
    """A field as a string, with a missing field being an empty one.

    An `Enum` gives up its **value** and not its `repr`. The SDK types several
    of these fields as plain enums, so `str()` on one produces
    `PatchApplyStatus.declined` — which no comparison against `"declined"` will
    ever match, and the failure is a status test that silently never fires.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, Enum):
        return _text(value.value)
    return str(value)


def _kind_of(change: Any) -> str:
    """`add`, `delete` or `update` — the SDK wraps it in a root model."""
    kind = getattr(change, "kind", None)
    root = getattr(kind, "root", kind)
    return _text(getattr(root, "type", root))


def diff_of_change(change: Any) -> Diff | None:
    """One file's change, as the old lines and the new ones.

    Codex hands over a **rendered unified patch**, where Claude hands over the
    old string and the new string. `Diff` is spec 42 §7's shape and carries the
    two texts, so the patch is read rather than passed through: a patch put into
    `after` would be drawn with a `+` in front of every context and removal line,
    which is worse than no diff at all.

    Context lines are dropped, which makes this exactly the shape a Claude
    `Edit` produces. `add` keeps `before = None` — a whole new file has no old
    text, and a host draws only additions for it, which is a different thing
    from `before = ""`.
    """
    kind = _kind_of(change)
    removed: list[str] = []
    added: list[str] = []
    for line in _text(getattr(change, "diff", "")).splitlines():
        # The file headers start with the same characters as the content lines
        # and are not content. Checked first, longest marker first.
        if line.startswith(("+++", "---", "@@", "diff --git", "index ")):
            continue
        if line.startswith("+"):
            added.append(line[1:])
        elif line.startswith("-"):
            removed.append(line[1:])

    if not removed and not added:
        return None
    return Diff(
        path=_text(getattr(change, "path", "")),
        before=None if kind == "add" else "\n".join(removed)[:DIFF_CLIP],
        after="\n".join(added)[:DIFF_CLIP],
    )


#: The shells Codex invokes a command through, bare or by absolute path.
#:
#: It uses the reviewer's own `$SHELL`, so this is a set rather than one name.
#: Matched on the last path segment, because `/bin/zsh` and `/opt/homebrew/bin/bash`
#: are the same fact.
_SHELLS = frozenset({"zsh", "bash", "sh", "dash", "ksh"})


def shell_command(command: str) -> str:
    """The command Codex will actually run, out of the shell it wraps it in.

    **Measured, and the reason this function exists.** Codex composes every
    shell call as `/bin/zsh -lc '<the real command>'`, where Claude's `Bash`
    tool passes the command itself. REX's gate reasons about the command — spec
    12 §6 matches on the BINARY and refuses anything whose write ability it
    cannot determine — so the wrapper made every Codex shell call in a read
    session a refusal, `cat` included. Measured 2026-09-04 end to end: the first
    benign ASK was denied with "REX cannot tell whether '/bin/zsh' writes".

    Unwrapping it is SDK knowledge and therefore the adapter's, and it makes the
    two SDKs' shell calls the same shape for one gate to judge. The alternative
    was teaching `gate.ts` about `zsh -lc`, which would have widened the shared
    gate for Claude too, to make a Codex detail work.

    **Conservative in every direction.** Anything that is not exactly
    `<known shell> -<flags including c> <one script>` comes back untouched, and
    the gate then judges the whole string — which is the safe answer, because a
    string the gate does not understand is a string it refuses.
    """
    try:
        parts = shlex.split(command)
    except ValueError:
        # Unbalanced quotes. Not something to guess at.
        return command

    # Exactly three words: the shell, its flags, and the script. A fourth would
    # be `$0` and friends for that script, and a script whose arguments are
    # elsewhere is not one this can hand over whole.
    if len(parts) != 3:
        return command
    shell, flags, script = parts
    if PurePosixPath(shell).name not in _SHELLS:
        return command
    # `-lc`, `-c`, `-ic` — one bundle, and `c` is the one that means "the next
    # word is the command". Anything else is a shell being asked to do
    # something other than run a command string.
    if not flags.startswith("-") or "c" not in flags or set(flags[1:]) - set("lic"):
        return command
    return script or command


def _reasoning_text(item: Any) -> str:
    """A reasoning item's words, from whichever of its two lists has them.

    `summary` is what a reasoning model usually fills; `content` is the raw
    text, and a local model measured 2026-09-04 through Envoy filled that one
    and left `summary` empty. Both are read so neither engine produces a silent
    gap in the trace.
    """
    return " ".join(getattr(item, "summary", None) or getattr(item, "content", None) or [])


def _command_events(item: Any) -> Iterator[AgentEvent]:
    """A shell command, as the call and then its output.

    The input is `{command}` and nothing else, because that is the field REX's
    own gate reads for a shell call — spec 44 §9.1. A different spelling here
    would be a gate that sees no command and allows everything.
    """
    yield ToolCallEvent(
        id=item.id,
        name=CODEX_TOOL_NAMES["commandExecution"],
        common=common_tool("commandExecution"),
        # Unwrapped, and the same string the policy was asked about. The wrapper
        # is Codex's fixed invocation and is on every call, so showing it would
        # put `/bin/zsh -lc` in front of every line of the trace and say nothing
        # — and a transcript that differs from what the gate judged is worse
        # than either on its own.
        input={"command": shell_command(_text(getattr(item, "command", "")))},
    )
    exit_code = getattr(item, "exit_code", None)
    output = _text(getattr(item, "aggregated_output", ""))
    yield ToolResultEvent(
        id=item.id,
        name=CODEX_TOOL_NAMES["commandExecution"],
        text=output[:RESULT_CLIP],
        # None is a command that never reported one — a sandbox refusal among
        # them — and that is not a success. Only a real zero is.
        is_error=exit_code != 0,
    )


def _file_change_events(item: Any) -> Iterator[AgentEvent]:
    """A patch, as one call, one `wrote` and one `diff` **per path**.

    One call per path rather than one for the whole patch, because the policy
    judges a write by the file it names (§9.1) and a single call carrying four
    paths is a decision a gate cannot make.
    """
    failed = _text(getattr(item, "status", "")) in ("failed", "declined")
    for index, change in enumerate(getattr(item, "changes", None) or []):
        path = _text(getattr(change, "path", ""))
        if not path:
            continue
        call_id = f"{item.id}:{index}"
        yield ToolCallEvent(
            id=call_id,
            name=CODEX_TOOL_NAMES["fileChange"],
            common=common_tool("fileChange"),
            input={"file_path": path},
        )
        # Reported whatever the patch's status: the host's accounting asks "what
        # did this run name", and a failed write is exactly the case where a
        # before-and-after scan needs to look at the path anyway.
        yield Wrote(path=path)
        change_event = diff_of_change(change)
        if change_event is not None:
            yield change_event
        if failed:
            yield ToolResultEvent(
                id=call_id,
                name=CODEX_TOOL_NAMES["fileChange"],
                text=f"The patch to {path} was not applied ({_text(getattr(item, 'status', ''))}).",
                is_error=True,
            )


def _mcp_events(item: Any) -> Iterator[AgentEvent]:
    name = mcp_tool_name(_text(getattr(item, "server", "")), _text(getattr(item, "tool", "")))
    yield ToolCallEvent(
        id=item.id,
        name=name,
        common=common_tool("mcpToolCall"),
        input=getattr(item, "arguments", None),
    )
    error = getattr(item, "error", None)
    if error is not None:
        yield ToolResultEvent(
            id=item.id, name=name, text=_text(getattr(error, "message", ""))[:RESULT_CLIP], is_error=True
        )
        return
    result = getattr(item, "result", None)
    yield ToolResultEvent(
        id=item.id,
        name=name,
        text=_text(getattr(result, "content", "") if result is not None else "")[:RESULT_CLIP],
        is_error=_text(getattr(item, "status", "")) == "failed",
    )


def _web_search_events(item: Any) -> Iterator[AgentEvent]:
    query = _text(getattr(item, "query", ""))
    yield ToolCallEvent(
        id=item.id,
        name=CODEX_TOOL_NAMES["webSearch"],
        common=common_tool("webSearch"),
        input={"query": query},
    )
    results = getattr(item, "results", None) or []
    yield ToolResultEvent(
        id=item.id,
        name=CODEX_TOOL_NAMES["webSearch"],
        text=f"{len(results)} result(s) for {query}"[:RESULT_CLIP],
    )


def item_events(item: Any) -> Iterator[AgentEvent]:
    """One completed thread item, as the events a host stores for it.

    `item` is the concrete item — `ThreadItem.root`, unwrapped by the caller, so
    that nothing downstream ever sees the SDK's wrapper.

    `plan` is dropped on purpose (spec 42 §7 rule 5): the plan is already in the
    `agentMessage` that accompanies it, and storing both would put the same
    sentences in the transcript twice. `userMessage` is dropped because the host
    wrote it and already has it.
    """
    kind = _text(getattr(item, "type", ""))

    if kind == "agentMessage":
        text = _text(getattr(item, "text", ""))
        if text:
            yield Text(text=text)

    elif kind == "reasoning":
        text = _reasoning_text(item)
        if text:
            yield Thinking(text=text)

    elif kind == "commandExecution":
        yield from _command_events(item)

    elif kind == "fileChange":
        yield from _file_change_events(item)

    elif kind == "mcpToolCall":
        yield from _mcp_events(item)

    elif kind == "webSearch":
        yield from _web_search_events(item)


#: The item types that are narration or state, and therefore never a tool call.
#:
#: **A list of what is NOT a tool call, and deliberately not a list of what is.**
#: The two are not the same under a version bump: an SDK that adds a tool item
#: would slip past a positive list unasked, and §9.1's whole design is that an
#: unmapped tool call reaches the policy as `common: None` and is refused by
#: name. So anything not written here is treated as a tool call, which makes the
#: fall-through a refusal rather than a hole.
NOT_TOOL_CALLS = frozenset(
    {
        "userMessage",
        "hookPrompt",
        "agentMessage",
        "plan",
        "reasoning",
        "enteredReviewMode",
        "exitedReviewMode",
        "contextCompaction",
    }
)


def policy_call_of(item: Any) -> tuple[str, Any] | None:
    """The name and input this item's policy question is about, or None.

    None means "not a tool call", and it is the only thing that skips the
    policy. Everything else is asked — an item type this file has never heard of
    included, under its own name and with `common: None`, which the host refuses.

    Asked when an item **starts**, because the Codex SDK exposes no usable
    pre-execution veto (§9.1, and milestone 0 measured why). One question per
    item and never one per path: a patch that names four files is one decision
    the host either allows or refuses, and the four `tool_call` events the
    completed item produces are the record of what it covered.
    """
    kind = _text(getattr(item, "type", ""))
    if kind in NOT_TOOL_CALLS:
        return None
    if kind == "mcpToolCall":
        name = mcp_tool_name(_text(getattr(item, "server", "")), _text(getattr(item, "tool", "")))
        return name, getattr(item, "arguments", None)
    if kind == "commandExecution":
        return CODEX_TOOL_NAMES[kind], {"command": shell_command(_text(getattr(item, "command", "")))}
    if kind == "fileChange":
        paths = [_text(getattr(change, "path", "")) for change in getattr(item, "changes", None) or []]
        return CODEX_TOOL_NAMES[kind], {"file_path": paths[0] if paths else "", "file_paths": paths}
    if kind == "webSearch":
        return CODEX_TOOL_NAMES[kind], {"query": _text(getattr(item, "query", ""))}
    # Unmapped, and named so the refusal says which item type it was about.
    return kind or "an unnamed Codex item", None
