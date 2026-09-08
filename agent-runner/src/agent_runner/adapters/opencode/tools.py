"""Spec 47 §7.1 — OpenCode's two vocabularies, mapped.

There are **two** tables here and conflating them is the bug this file exists to
prevent. OpenCode names the same action twice:

* a **tool name** — what `message.part.updated` calls it, and what REX's policy
  is asked about;
* a **permission name** — what a `PermissionRuleset` is written in, and what
  `permission.asked` carries.

They agree everywhere except one place, and it is the place that matters:
a ``write`` tool call asks under the permission ``edit``. Measured 2026-09-07,
spec 47 §10.6 E. A ruleset that denies ``write`` and not ``edit`` stops nothing.

The trap behind the first table is spec 42 §8's: REX's own gate matches `Write`,
`Edit`, `NotebookEdit`, `Bash` and `mcp__*`, and **returns allow for any name it
does not know**. Every OpenCode tool is lower case, so every one of them would
fall straight through. So the mapping is **closed**: a name that is not in the
table is `None`, never guessed, and the host denies `None` for every SDK but
Claude — a visible refusal with a name in it rather than a silent hole.
"""

from typing import Any

from ...policy import CommonTool

#: `GET /experimental/tool/ids` at `opencode` 1.18.27, measured — not guessed.
#:
#: Spec 47 §7.1's table named `list` and `patch`, and **neither exists**. The
#: real fourteen are below; `apply_patch` is what `patch` was meant to be.
OPENCODE_TOOL_IDS: tuple[str, ...] = (
    "invalid",
    "question",
    "bash",
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "task",
    "webfetch",
    "todowrite",
    "websearch",
    "skill",
    "apply_patch",
)

#: What each OpenCode tool DOES, in spec 42 §8's nine-word vocabulary.
#:
#: `todowrite`, `skill`, `question` and `invalid` are deliberately absent rather
#: than mapped to something close. None of them is one of the nine, and inventing
#: a row would turn "REX has an opinion about this" into "REX has never seen
#: this" — which are opposite answers with the same spelling.
OPENCODE_TO_COMMON: dict[str, CommonTool] = {
    "bash": "shell",
    "edit": "edit",
    "apply_patch": "edit",
    "write": "write",
    "read": "read",
    "glob": "list",
    "grep": "search",
    "webfetch": "fetch",
    "websearch": "fetch",
    "task": "task",
}

#: The permission each tool asks under. **Only `write` differs from its own
#: name**, and that one row is the whole reason this table exists (§10.6 E).
TOOL_TO_PERMISSION: dict[str, str] = {
    "bash": "bash",
    "edit": "edit",
    "apply_patch": "edit",
    "write": "edit",
    "read": "read",
    "glob": "glob",
    "grep": "grep",
    "webfetch": "webfetch",
    "websearch": "websearch",
    "task": "task",
    "todowrite": "todowrite",
}

#: The permissions a `read` run may take without asking.
#:
#: Everything else asks, through a trailing `*` rule, and REX's own policy is
#: what refuses. An **open** ask beats a closed deny-list because OpenCode ships
#: new tools and a deny-list cannot name one that does not exist yet — while
#: `*` cannot miss one. §7.3 rule 1.
READ_ONLY_PERMISSIONS: tuple[str, ...] = ("read", "glob", "grep")

#: What OpenCode calls a file path, and what REX's gate reads.
#:
#: `gate.ts` is written in Claude's vocabulary (spec 44 §9.1's note), so the key
#: is renamed here rather than the gate widened. One rename, in the adapter that
#: needs it.
_INPUT_KEYS = {"filePath": "file_path", "filepath": "file_path"}


def common_tool(tool: str) -> CommonTool | None:
    """What this OpenCode tool does, or None when the library cannot say."""
    return OPENCODE_TO_COMMON.get(tool)


def permission_for(tool: str) -> str:
    """The permission name this tool asks under. Its own, unless the table says otherwise."""
    return TOOL_TO_PERMISSION.get(tool, tool)


def policy_input(state_input: Any) -> Any:
    """One tool call's input, with the keys REX's gate reads.

    Passed through untouched but for the rename: the gate reads `command` for a
    shell call and `file_path` for a write, and OpenCode spells the second one
    `filePath`. Anything that is not a mapping is returned as it arrived — a
    pending part carries `{}` and an unknown tool may carry anything.
    """
    if not isinstance(state_input, dict):
        return state_input
    return {_INPUT_KEYS.get(key, key): value for key, value in state_input.items()}


def read_ruleset() -> list[dict[str, str]]:
    """§7.3 — the ASK ruleset: read freely, ask about everything else.

    **`ask` and never `deny`.** Both stop the write and both were measured to
    (§10.6 D), but a denied tool tells the model nothing and it retries — 22
    wasted calls in the measured run — while a rejection carries REX's own
    sentence back and the model stops. The refusal has to be REX's anyway
    (§7.1), so asking is both safer and the one that says why.

    Order matters: OpenCode applies the rules in order, so the allows come first
    and the catch-all last.
    """
    return [
        *({"permission": name, "pattern": "*", "action": "allow"} for name in READ_ONLY_PERMISSIONS),
        {"permission": "*", "pattern": "*", "action": "ask"},
    ]


def write_ruleset() -> list[dict[str, str]]:
    """The ACT ruleset. Identical in shape, and `external_directory` always asks.

    A writing run still asks about every mutating permission, because REX's
    policy is the thing that decides and the gate has to see the call. What
    changes between the profiles is the ANSWER `policyFor` gives, not the
    question OpenCode is told to raise — which is why these two functions differ
    by one row rather than by a philosophy.
    """
    return [
        *({"permission": name, "pattern": "*", "action": "allow"} for name in READ_ONLY_PERMISSIONS),
        # **`external_directory` is ALLOWED here, and only here.** §7.4.1 option
        # B runs a write turn in the workspace while the working copies live
        # under `~/.rex/work` — outside it — so every edit an ACT is supposed to
        # make is an "external directory" write by OpenCode's reckoning. Without
        # this the write is refused before the tool call reaches a file, and it
        # looks exactly like the model failing to call the tool. Measured
        # 2026-09-07, §10.10.
        #
        # What stops it going anywhere else is layer 4, the seatbelt, which
        # allows precisely `RunRequest.writable` and nothing more — and that is
        # why ACT is refused outright on a platform with no seatbelt (§7.4).
        {"permission": "external_directory", "pattern": "*", "action": "allow"},
        {"permission": "*", "pattern": "*", "action": "ask"},
    ]


__all__ = [
    "OPENCODE_TOOL_IDS",
    "OPENCODE_TO_COMMON",
    "READ_ONLY_PERMISSIONS",
    "TOOL_TO_PERMISSION",
    "common_tool",
    "permission_for",
    "policy_input",
    "read_ruleset",
    "write_ruleset",
]
