"""Spec 45 §6 — the three headers, and the injection they must make impossible."""

from agent_runner.attribution import anthropic_custom_headers, attribution_headers


def test_all_three_are_sent_when_all_three_are_known() -> None:
    assert attribution_headers("t-1", "r-1", "read") == {
        "x-rex-thread": "t-1",
        "x-rex-run": "r-1",
        "x-rex-profile": "read",
    }


def test_an_empty_value_is_left_out_rather_than_sent_empty() -> None:
    """An Apply has no comment thread. The collector labels that `none`; the
    library simply does not claim one."""
    assert attribution_headers("", "r-1", "") == {"x-rex-run": "r-1"}


def test_a_newline_cannot_forge_a_second_header() -> None:
    """The whole reason values are cleaned rather than escaped.

    In `ANTHROPIC_CUSTOM_HEADERS` a newline IS the separator between two
    headers, so a value carrying one would end its own header and start
    another — an `Authorization` of the caller's choosing, on REX's request.
    """
    headers = attribution_headers("t-1\nx-evil: yes", "r-1", "read")
    # The newline is gone, so what was meant to be a second header is now part
    # of the first one's VALUE. A colon survives because it is legal in a value
    # — a header parser splits on the first one — and `${run}:${root}` ids use it.
    assert headers["x-rex-thread"] == "t-1x-evil:yes"

    lines = anthropic_custom_headers(headers).split("\n")
    assert lines == [
        "x-rex-thread: t-1x-evil:yes",
        "x-rex-run: r-1",
        "x-rex-profile: read",
    ]
    # Three headers were asked for and three lines were produced. The forged
    # fourth did not happen, which is the whole assertion.
    assert len(lines) == 3


def test_a_carriage_return_is_removed_too() -> None:
    assert attribution_headers("a\r\nb", "", "")["x-rex-thread"] == "ab"


def test_a_value_is_capped_so_it_cannot_crowd_out_a_real_header() -> None:
    assert len(attribution_headers("x" * 500, "", "")["x-rex-thread"]) == 128


def test_the_anthropic_format_is_one_name_value_pair_per_line() -> None:
    rendered = anthropic_custom_headers(attribution_headers("t-1", "r-1", "write"))
    assert rendered.split("\n") == [
        "x-rex-thread: t-1",
        "x-rex-run: r-1",
        "x-rex-profile: write",
    ]


def test_nothing_known_renders_nothing() -> None:
    assert attribution_headers("", "", "") == {}
    assert anthropic_custom_headers({}) == ""
