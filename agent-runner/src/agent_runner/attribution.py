"""Spec 45 §6 — telling the gateway which REX run is calling it.

The gateway authenticates nobody and has no idea who its caller is. Attribution
is three request headers and nothing else, so this module builds them and every
adapter installs them the way its own SDK wants:

* the Claude CLI reads `ANTHROPIC_CUSTOM_HEADERS`, `Name: Value` per line
* the Codex CLI reads `http_headers`, a table on the model provider

**Only ids go over the wire.** No document text, no file path, no prompt. A
header lands in a span and a span is stored for months; the thread id is a uuid
that names a row in `~/.rex/rex.db` and says nothing on its own.
"""

import re

#: Everything a header value may contain. A thread id and a run id are uuids and
#: a profile is a word, so this is not a restriction in practice — it is the
#: guard that makes header injection impossible rather than unlikely.
_UNSAFE = re.compile(r"[^A-Za-z0-9._:-]")

#: Long enough for a uuid and a suffix, short enough that a hostile value cannot
#: push a real header out of a size-limited request line.
_MAX = 128


def _clean(value: str) -> str:
    """One header value, with everything that could forge a header removed.

    A newline in a value ENDS the header and starts another one — that is the
    whole of header injection, and in `ANTHROPIC_CUSTOM_HEADERS` a newline is
    literally the separator between two headers. So this does not escape;
    it deletes, and what is left cannot be anything but a value.
    """
    return _UNSAFE.sub("", value.strip())[:_MAX]


def attribution_headers(thread_id: str, run_id: str, profile: str) -> dict[str, str]:
    """The `x-rex-*` headers for this run. Empty inputs are simply left out.

    An omitted header is not a failure. The collector labels what it cannot see
    as `none`, so a run with no thread still appears on every dashboard rather
    than vanishing from the totals.
    """
    pairs = (
        ("x-rex-thread", thread_id),
        ("x-rex-run", run_id),
        ("x-rex-profile", profile),
    )
    return {name: cleaned for name, raw in pairs if (cleaned := _clean(raw))}


def anthropic_custom_headers(headers: dict[str, str]) -> str:
    """`ANTHROPIC_CUSTOM_HEADERS` — `Name: Value`, one per line.

    Verified against the Claude Code environment-variable reference on
    2026-09-05. The values are already cleaned of newlines by `_clean`, which is
    what makes joining on one safe.
    """
    return "\n".join(f"{name}: {value}" for name, value in headers.items())
