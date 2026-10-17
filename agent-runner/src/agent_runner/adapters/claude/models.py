"""Spec 42 §9.4 — what this route offers, asked rather than assumed.

The library holds no list of model or style names. It asks the CLI, because the
lists are this ACCOUNT's and this CLI VERSION's: a model the account has no
credits for, a model released next month, and a style somebody wrote into
`~/.claude/output-styles/` all come out right with no change here. A hardcoded
`claude-opus-5` would be a claim the library cannot check, and a wrong one fails
inside a run somebody has already paid to start.

**One call answers both lists.** `get_server_info()` returns the CLI's own
initialize response, which carries `models` and `available_output_styles`
together — measured on 2026-09-04 against `claude-agent-sdk` 0.2.152. One CLI
process instead of two, and two lists that cannot disagree about which session
they came from.
"""

import asyncio
import json
import re
from collections import Counter
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import SettingSource

from ...types import ModelChoice, RouteCapabilities

#: The value that MEANS "say nothing to the SDK". The CLI offers a row for it.
DEFAULT_MODEL = "default"
DEFAULT_STYLE = "default"
DEFAULT_EFFORT = "default"

FALLBACK = ModelChoice(
    value=DEFAULT_MODEL,
    display_name="Default",
    description="Whatever the Claude CLI is configured to use.",
)
"""The one row a failed probe leaves, and no more.

**Not a static list of ids.** A stale id is worse than no choice, because it is
sent and rejected inside a paid run rather than in the picker. And a probe that
cannot answer means the CLI cannot start, so no run would have worked either —
the picker is not the thing that is broken.
"""

#: The settings files a run loads, and so the ones the probe must load. A probe
#: that read more would describe a different CLI: on 2026-10-17 it reported
#: `xhigh` for Fable 5.1 from the reviewer's `~/.claude/settings.json`, while
#: the run, which never reads that file, ran at `high`.
SETTING_SOURCES: list[SettingSource] = ["project"]


def cli_settings(style: str | None = None) -> str:
    """The CLI's `--settings`, which outranks the project's own file.

    Spec 62 — `disableAllHooks`, always. The repository's hooks are its
    boundary, not its context: its `PreToolUse` deny outranked REX's gate and
    stopped an ACT edit spec 22 asks for, and its `SessionStart` ran its code on
    every run. REX's gate is an SDK callback, which the CLI still runs —
    measured 2026-10-17. `default` style is said by saying nothing.
    """
    settings: dict[str, Any] = {"disableAllHooks": True}
    if style and style != DEFAULT_STYLE:
        settings["outputStyle"] = style
    return json.dumps(settings)


#: Measured on this machine, 2026-09-04: a cold probe answers in about six
#: seconds. Ten is what the app allowed before the library existed, and the pipe
#: adds nothing measurable, so ten it stays.
TIMEOUT_SECONDS = 10.0


def failed(reason: str, costed: bool = True) -> RouteCapabilities:
    """What a probe that answered nothing useful leaves behind."""
    return RouteCapabilities(
        models=[FALLBACK],
        styles=[DEFAULT_STYLE],
        supports_styles=True,
        supports_plugins=True,
        supports_cost=costed,
        supports_ask=True,
        supports_act=True,
        supports_resume=True,
        error=(f"REX could not ask the Claude CLI what it offers, so only the defaults are available. {reason}"),
    )


# ── Naming a model row ──────────────────────────────────────────
#
# The CLI's own `displayName` is not always enough to tell two rows apart, and on
# 2026-09-03 it stopped being enough: the list held **two rows both called
# `Fable`**, whose descriptions ALSO both read "Fable 5". The only field that
# differed was the id — `claude-fable-5` against `claude-fable-5-1`.
#
# That is not a bug in the CLI: `displayName` is a family name and it is right
# for a menu that shows one row per family. It becomes a problem the moment two
# rows of the same family are offered at once, and the id is the field that
# settles it.
#
# The rule is narrow on purpose. The id is parsed, and **only** what it really
# carries is shown; nothing is inferred and nothing is invented. An id that does
# not parse keeps the CLI's own name, which is the honest fallback for a naming
# scheme the library has not seen before.

_CONTEXT = re.compile(r"\[(\d+m)\]", re.IGNORECASE)
_BRACKETS = re.compile(r"\[[^\]]*\]")


def context_of(value: str, resolved: str | None) -> str | None:
    """`[1m]` in either id becomes `1M`. Absent from `resolvedModel` on some rows."""
    found = _CONTEXT.search(value) or _CONTEXT.search(resolved or "")
    return found.group(1).upper() if found else None


def family_version(identifier: str) -> str | None:
    """`claude-fable-5-1` becomes `Fable 5.1`; `claude-haiku-4-5-20251001` becomes `Haiku 4.5`.

    None when the id is not a model id at all — `default` is the one that
    matters, and it must keep the CLI's name: what it resolves to today is not
    what it MEANS, and a row labelled by today's answer would be wrong tomorrow.

    The date suffix is dropped by taking only one- and two-digit segments. It is
    a snapshot, not a version, and `Haiku 4.5.20251001` names nothing a person
    would recognise.
    """
    bare = re.sub(r"^claude-", "", _BRACKETS.sub("", identifier))
    parts = bare.split("-")
    family, rest = parts[0], parts[1:]
    if not family or not re.fullmatch(r"[a-z]+", family, re.IGNORECASE):
        return None

    digits: list[str] = []
    for part in rest:
        if not re.fullmatch(r"\d{1,2}", part):
            break
        digits.append(part)
    if not digits:
        return None

    return f"{family[0].upper()}{family[1:]} {'.'.join(digits)}"


def with_context(named: str, row: dict[str, Any]) -> str:
    """`Opus 5` becomes `Opus 5 (1M)` when either id carries a context length."""
    context = context_of(row["value"], row.get("resolvedModel"))
    return f"{named} ({context})" if context else named


def resolved_name(row: dict[str, Any]) -> str | None:
    """The resolution's name — but only when the row is an **alias** for it.

    `sonnet` carries no version and `claude-sonnet-5` does, so an alias has to
    borrow its resolution's name to gain one. `default` resolves too, and must
    NOT borrow it as its own name: it means "whatever the CLI is set to", so a
    row named `Opus 5 (1M)` would read exactly the same as the real Opus row.
    `default` says what it stands for in brackets instead — `default_name`.

    The two are told apart by whether the value names the resolution's family.
    `sonnet` is the family word of `claude-sonnet-5`; `default` is not the
    family word of `claude-opus-5`, which is what makes it a choice rather than
    a name.
    """
    named = family_version(row.get("resolvedModel") or "")
    if named is None:
        return None
    family = named.split(" ")[0].lower()
    return named if _BRACKETS.sub("", row["value"]).lower() == family else None


def default_name(row: dict[str, Any]) -> str | None:
    """Spec 58 §7.1 — what the CLI's `default` row stands for today, or None.

    The reviewer's report of 2026-10-17: *"you are showing me 'default
    recommended', I don't know what the default is."* The probe runs again on
    every start, so the name is today's answer and moves when the CLI's does.
    """
    if row["value"] != DEFAULT_MODEL:
        return None
    named = family_version(row.get("resolvedModel") or "")
    if named is None:
        return None
    # After a comma, not in brackets: this name is itself drawn in brackets.
    context = context_of(row["value"], row.get("resolvedModel"))
    return f"{named}, {context}" if context else named


def name_for(row: dict[str, Any]) -> str:
    """One row's name: version from the id, context length when the id carries one."""
    stands_for = default_name(row)
    if stands_for:
        return f"Recommended ({stands_for})"
    named = family_version(row["value"]) or resolved_name(row)
    return with_context(named, row) if named else row["displayName"]


def name_models(
    rows: list[dict[str, Any]],
    routed: bool = False,
    own_levels: dict[str, str] | None = None,
) -> list[ModelChoice]:
    """The rows, named — and **named apart**.

    The second pass is the guarantee, and it is what makes this safe against a
    list the library has never seen: if two rows still read the same after the
    rule above, both get their id appended. A parser cannot promise to tell every
    future pair apart; a uniqueness check can, because `value` is the key the
    CLI keys on and is unique by construction.

    Spec 58 §3 — each row keeps the effort levels the CLI says it takes, except
    on a `routed` probe. Whether a gateway's engine accepts an effort at all is
    unmeasured, and a refusal would land inside a turn already paid for (§3.2).
    `own_levels` is each model's own level, keyed by `value` (§3.1).
    """
    levels = own_levels or {}
    named = [(row, name_for(row)) for row in rows]
    seen = Counter(name for _, name in named)

    return [
        ModelChoice(
            value=row["value"],
            display_name=f"{name} · {row['value']}" if seen[name] > 1 else name,
            # The wire id, always. The CLI's own sentence said "Fable 5" for both
            # Fable rows on 2026-09-03, so the tooltip needs something that
            # cannot go stale.
            description=f"{row.get('description', '')} · {row.get('resolvedModel') or row['value']}",
            effort_levels=[] if routed else list(row.get("supportedEffortLevels") or []),
            default_effort=None if routed else levels.get(row["value"]),
            resolves_to=default_name(row),
        )
        for row, name in named
    ]


#: Measured on this machine, 2026-10-17: about 0.3 s a model, so 13 rows take
#: about four seconds. A level is a label, so a slow CLI costs the label and
#: never the probe.
LEVELS_TIMEOUT_SECONDS = 8.0


async def own_levels(client: ClaudeSDKClient, rows: list[dict[str, Any]]) -> dict[str, str]:
    """Spec 58 §3.1 — the level each model runs at when REX sends none.

    The CLI decides it per model (Sonnet 5.5 `medium`, Fable 5.1 `high` on
    2026-10-17), after the settings it loaded and the environment, and reports
    the result only through its `get_settings` control request, as
    `applied.effort`. The TypeScript SDK wraps that request as `getSettings()`;
    the Python SDK 0.2.168 does not, so this sends it through the client's
    private `_query`. **That is the one private call in the library**, and it is
    allowed only because a failure costs a label: any error returns what was
    learned so far, and the menu says `Default effort` with no level. Swap it
    for the public call when the Python SDK gains one.

    `set_model` and `get_settings` are control requests: no user message is
    sent, so no tokens are spent.
    """
    learned: dict[str, str] = {}
    try:
        async with asyncio.timeout(LEVELS_TIMEOUT_SECONDS):
            for row in rows:
                if not row.get("supportedEffortLevels"):
                    continue
                await client.set_model(row["value"])
                settings = await client._query._send_control_request({"subtype": "get_settings"})  # pyright: ignore[reportPrivateUsage, reportOptionalMemberAccess]
                effort = (settings.get("applied") or {}).get("effort")
                if isinstance(effort, str):
                    learned[row["value"]] = effort
    except Exception:
        pass
    return learned


async def probe(cwd: str, env: dict[str, str]) -> RouteCapabilities:
    """Start the CLI, complete the handshake, send the model nothing.

    `env` is what the route resolved to — nothing for the SDK's own endpoint,
    and spec 43's routing variables for a gateway with a URL.

    `connect()` with no prompt opens the session and returns once the CLI has
    answered the initialize request. **No user message is ever sent, so no
    tokens are spent.**
    """
    # Spec 43 §8.1 — a routed run has no knowable cost, and the flag has to say
    # so before a host draws one. `ANTHROPIC_BASE_URL` in the environment is
    # exactly "this route goes somewhere else"; see `_cost_of` in the adapter.
    costed = "ANTHROPIC_BASE_URL" not in env
    options = ClaudeAgentOptions(
        cwd=cwd,
        env=env,
        setting_sources=SETTING_SOURCES,
        settings=cli_settings(),
    )
    client = ClaudeSDKClient(options=options)
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            await client.connect()
            info = await client.get_server_info()
    except Exception as error:
        # Every failure is the same answer: the pickers get the defaults and the
        # reason, rather than an empty menu and no explanation.
        await _quietly_disconnect(client)
        return failed(str(error) or error.__class__.__name__, costed)

    models = (info or {}).get("models") or []
    # §3.2 — a routed probe offers no levels, so there is nothing to label.
    levels = await own_levels(client, models) if costed else {}
    await _quietly_disconnect(client)

    if info is None:
        return failed("It answered nothing.", costed)

    # The style list may legitimately be short; the model list may not. A CLI
    # that offers no model at all is a CLI nothing would run on.
    if not models:
        return failed("It offered no models.", costed)

    styles = list(info.get("available_output_styles") or [])
    return RouteCapabilities(
        models=name_models(models, routed=not costed, own_levels=levels),
        # The CLI's own `default` first, then whatever else it knows. Its list
        # already contains `default`, so this only guards the shape.
        styles=styles if DEFAULT_STYLE in styles else [DEFAULT_STYLE, *styles],
        supports_styles=True,
        supports_plugins=True,
        supports_cost=costed,
        supports_ask=True,
        supports_act=True,
        supports_resume=True,
        error=None,
    )


async def _quietly_disconnect(client: ClaudeSDKClient) -> None:
    """A probe that could not be closed is still a probe that answered."""
    try:
        await client.disconnect()
    except Exception:
        pass
