"""Spec 48 §5.3 — the deep agent's tools, in spec 42 §8's nine-word vocabulary.

The trap this file exists to close is spec 42 §8's: REX's gate matches `Write`,
`Edit`, `Bash` and `mcp__*`, and **returns allow for any name it does not know**.
Every `deepagents` tool is lower case with an underscore, so every one of them
would fall straight through. The mapping is therefore **closed**: a name this
table does not carry is `None`, never guessed, and the host denies `None` for
every SDK but Claude — a visible refusal with a name in it rather than a hole.

**The tool set was measured, not read off the spec.** At `deepagents` 0.7.13 a
default agent binds exactly eight tools:

    ls  read_file  write_file  edit_file  delete  glob  grep  task

Two things §5.3 assumed are wrong at this version. `write_todos` is **not** on
by default any more — §12.4 item 7 — so there is nothing to deny. And `task`
**is**, with no way to remove it: `subagents=[]` binds it just the same
(measured 2026-09-07). §14 puts subagents out of scope, and REX's own gate has
no rule for `task`, so leaving it to the gate would leave it allowed — which is
why `NEVER_OFFERED` below is refused in the adapter's own middleware instead.

`execute` is in the table and can never arrive: it exists only on a sandbox
backend and §5 uses none. It is mapped anyway, because a row that says `shell`
is cheaper than a row that says `None` on the day someone adds one.
"""

from typing import Any

from ...policy import CommonTool

#: What each `deepagents` tool DOES. Closed — see the module docstring.
DEEP_AGENTS_TO_COMMON: dict[str, CommonTool] = {
    "ls": "list",
    "glob": "list",
    "grep": "search",
    "read_file": "read",
    "write_file": "write",
    "edit_file": "edit",
    # §5.3 — `delete` is a write. The SDK's own rule vocabulary agrees: its
    # `"write"` operation covers `write_file`, `edit_file` and `delete` alike.
    "delete": "write",
    "task": "task",
    "execute": "shell",
}

#: The tools whose completion means a file on disk changed.
WRITING_TOOLS = frozenset({"write_file", "edit_file", "delete"})

#: Tools REX never lets this SDK use, whatever the profile and whatever the gate
#: would say.
#:
#: `task` is the only member and §14 is the reason: a subagent is a second model
#: call the reviewer did not ask for, it answers under a prompt REX did not
#: write, and the samples record it failing against a local engine for a reason
#: REX cannot fix (`3_deepagents/README.md:77-90` — Unsloth rejects the `name`
#: field `deepagents` puts on a subagent's messages).
#:
#: It is refused here rather than by the host because the host's gate has **no
#: opinion about `task`** — `GATE_NAMES` deliberately omits it and
#: `gateDecision` allows any name it does not know. Refusing it in the adapter
#: is the same class of decision as choosing an SDK's tool list, which is what
#: every adapter does; it is not the adapter overruling a policy, because there
#: is no policy here to overrule.
NEVER_OFFERED = frozenset({"task"})

#: Where each tool puts the path REX's gate wants to read.
#:
#: `gate.ts` is written in Claude's vocabulary and reads `file_path`, which is
#: what `deepagents` already calls it for every file tool. `ls` and `grep` say
#: `path`, and neither is a write, so the rename is one-way and only for them.
_PATH_KEYS: dict[str, str] = {
    "ls": "path",
    "grep": "path",
}


def common_tool(tool: str) -> CommonTool | None:
    """What this tool does, or None when the library cannot say."""
    return DEEP_AGENTS_TO_COMMON.get(tool)


def path_of(tool: str, args: Any) -> str | None:
    """The file or directory this call names, or None when it names none.

    One place, because three callers need the same answer for different reasons:
    the write boundary (§8.2), the `wrote` event (§6) and the policy input.
    """
    if not isinstance(args, dict):
        return None
    value = args.get(_PATH_KEYS.get(tool, "file_path"))
    return value if isinstance(value, str) and value else None


def policy_input(tool: str, args: Any) -> Any:
    """One call's arguments, with the key REX's gate reads.

    Passed through untouched but for the one rename: the gate reads `file_path`,
    and `ls` and `grep` spell it `path`. Anything that is not a mapping is
    returned as it arrived.
    """
    if not isinstance(args, dict):
        return args
    key = _PATH_KEYS.get(tool)
    if key is None or key not in args:
        return args
    return {("file_path" if name == key else name): value for name, value in args.items()}


def written_text(tool: str, args: Any) -> str | None:
    """The text a `write_file` put on disk, when the call carries it.

    Only `write_file`. An `edit_file` carries `old_string`/`new_string` rather
    than a whole file, and `Diff.after` is defined as the file's NEW TEXT — so
    filling it from a replacement fragment would put a fragment where a document
    belongs. §6's row says "from `content`, or from `old_string`/`new_string`",
    and `events.py` is where the second half is handled.
    """
    if tool != "write_file" or not isinstance(args, dict):
        return None
    content = args.get("content")
    return content if isinstance(content, str) else None


__all__ = [
    "DEEP_AGENTS_TO_COMMON",
    "NEVER_OFFERED",
    "WRITING_TOOLS",
    "common_tool",
    "path_of",
    "policy_input",
    "written_text",
]
