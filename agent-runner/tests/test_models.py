"""Naming a model row — spec 25 §6.4, ported from REX's `test/models.spec.ts`.

The rows below are the CLI's real answer on 2026-09-03, copied from a probe. Two
of them are called `Fable` and BOTH describe themselves as "Fable 5"; only the id
differs. That is the case this whole section exists for, and a fixture invented
by hand would not have contained it.
"""

from typing import Any

from agent_runner.adapters.claude.models import DEFAULT_STYLE, failed, name_models

REAL_ROWS: list[dict[str, Any]] = [
    {
        "value": "default",
        "resolvedModel": "claude-opus-5[1m]",
        "displayName": "Default (recommended)",
        "description": "Opus 5 with 1M context",
    },
    {
        "value": "opus[1m]",
        "resolvedModel": "claude-opus-5[1m]",
        "displayName": "Opus (1M context)",
        "description": "Opus 5 with 1M context",
    },
    {
        "value": "claude-fable-5[1m]",
        "resolvedModel": "claude-fable-5",
        "displayName": "Fable",
        "description": "Fable 5 · Most capable",
    },
    {
        "value": "claude-fable-5-1[1m]",
        "resolvedModel": "claude-fable-5-1",
        "displayName": "Fable",
        "description": "Fable 5 · Most capable",
    },
    {
        "value": "sonnet",
        "resolvedModel": "claude-sonnet-5",
        "displayName": "Sonnet",
        "description": "Sonnet 5",
    },
    {
        "value": "haiku",
        "resolvedModel": "claude-haiku-4-5-20251001",
        "displayName": "Haiku",
        "description": "Haiku 4.5",
    },
]


def name_of(value: str) -> str:
    for row in name_models(REAL_ROWS):
        if row.value == value:
            return row.display_name
    return "(missing)"


def test_the_two_fable_rows_are_told_apart_by_version() -> None:
    assert name_of("claude-fable-5[1m]") == "Fable 5 (1M)"
    assert name_of("claude-fable-5-1[1m]") == "Fable 5.1 (1M)"


def test_the_version_comes_from_the_id_and_the_context_from_either_id() -> None:
    # `sonnet` carries no version; `claude-sonnet-5` does.
    assert name_of("sonnet") == "Sonnet 5"
    # `[1m]` is on `value` here and not on `resolvedModel`, and vice versa above.
    assert name_of("opus[1m]") == "Opus 5 (1M)"


def test_a_dated_snapshot_is_a_snapshot_not_a_version() -> None:
    assert name_of("haiku") == "Haiku 4.5", "the 8-digit date is not part of the name"


def test_default_keeps_the_clis_own_name() -> None:
    """What it resolves to today is not what it MEANS.

    Naming it by today's answer would be wrong the day the CLI's default moves.
    """
    assert name_of("default") == "Default (recommended)"


def test_an_id_the_library_cannot_parse_keeps_the_clis_name() -> None:
    rows: list[dict[str, Any]] = [
        {"value": "something-new", "displayName": "Something", "description": "d"},
        {"value": "claude-x", "resolvedModel": "claude-x", "displayName": "X", "description": "d"},
    ]
    assert [row.display_name for row in name_models(rows)] == ["Something", "X"], (
        "nothing is invented for a naming scheme the library has not seen"
    )


def test_two_rows_that_would_still_read_the_same_are_named_apart_by_id() -> None:
    """An alias and the explicit id it points at.

    Both parse to the same name, so the parser alone cannot separate them —
    which is the case this guarantee exists for, and one the CLI is a single
    release away from listing: it already offers `opus[1m]`, and
    `claude-opus-5[1m]` beside it would collide.
    """
    rows: list[dict[str, Any]] = [
        {
            "value": "thing[1m]",
            "resolvedModel": "claude-thing-9",
            "displayName": "Thing",
            "description": "d",
        },
        {
            "value": "claude-thing-9[1m]",
            "resolvedModel": "claude-thing-9",
            "displayName": "Thing",
            "description": "d",
        },
    ]
    names = [row.display_name for row in name_models(rows)]
    assert names == ["Thing 9 (1M) · thing[1m]", "Thing 9 (1M) · claude-thing-9[1m]"]
    # The guarantee that does not depend on the parser being right about the
    # future: `value` is the CLI's own key, so it is unique by construction.
    assert len(set(names)) == 2, "no two rows in the menu may read the same"


def test_the_wire_id_is_always_in_the_description() -> None:
    row = next(one for one in name_models(REAL_ROWS) if one.value == "claude-fable-5-1[1m]")
    assert row.description.endswith("claude-fable-5-1"), (
        "the CLI's own sentence said 'Fable 5' for both Fable rows, so the tooltip needs something that cannot be stale"
    )


def test_a_probe_that_could_not_answer_leaves_exactly_one_row_of_each() -> None:
    """§3.4 — no invented names, and the reason on the row.

    A probe that cannot answer means the CLI cannot start, so no run would have
    worked either. The picker is not the thing that is broken, and it must not
    offer a stale id that fails inside a paid run.
    """
    probe = failed("It exploded.")
    assert [row.value for row in probe.models] == ["default"]
    assert probe.styles == [DEFAULT_STYLE]
    assert probe.error is not None
    assert "It exploded." in probe.error
