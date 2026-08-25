"""Cover the compound join.

The bar for adopting a compound is deliberately high: a wrong compound
is a confident claim about a strategy that never happened, and it is
worse than the honest blank this project shipped for months.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_compounds import (  # noqa: E402
    MATCHED,
    UNMATCHED,
    attach_compounds,
    index_openf1_stints,
)

CODES = {1: "VER", 16: "LEC"}


def ours(driver_id, stint, start, end):
    return {
        "driverId": driver_id,
        "stint": stint,
        "startLap": start,
        "endLap": end,
        "laps": end - start + 1,
        "compound": None,
        "compoundSource": "unavailable — Jolpica-F1 publishes no tyre compound data",
    }


def theirs(number, start, end, compound, age=0):
    return {
        "driverNumber": number,
        "lapStart": start,
        "lapEnd": end,
        "compound": compound,
        "tyreAgeAtStart": age,
    }


def code_for(driver_id):
    return {"max_verstappen": "VER", "leclerc": "LEC"}.get(driver_id)


def test_compound_is_taken_when_the_stint_lines_up():
    stints = [ours("leclerc", 1, 1, 20)]
    by_code = index_openf1_stints([theirs(16, 1, 20, "SOFT", age=2)], CODES)
    report = attach_compounds(stints, by_code, code_for)

    assert stints[0]["compound"] == "SOFT"
    assert stints[0]["compoundSource"] == MATCHED
    assert stints[0]["tyreAgeAtStart"] == 2
    assert report["identified"] == 1


def test_boundaries_need_not_match_exactly():
    """The two derivations come from different feeds, so a stint that is
    a lap or two out must still resolve."""
    stints = [ours("leclerc", 1, 1, 20)]
    by_code = index_openf1_stints([theirs(16, 2, 21, "MEDIUM")], CODES)
    attach_compounds(stints, by_code, code_for)
    assert stints[0]["compound"] == "MEDIUM"


def test_a_weak_overlap_is_refused():
    """A stint that only grazes ours is a guess, not a match."""
    stints = [ours("leclerc", 1, 20, "x".__len__() and 40)]
    by_code = index_openf1_stints([theirs(16, 38, 60, "HARD")], CODES)
    attach_compounds(stints, by_code, code_for)
    assert stints[0]["compound"] is None
    assert stints[0]["compoundSource"] == UNMATCHED


def test_the_longest_overlap_wins():
    stints = [ours("leclerc", 2, 21, 40)]
    by_code = index_openf1_stints(
        [theirs(16, 1, 22, "SOFT"), theirs(16, 23, 45, "HARD")], CODES)
    attach_compounds(stints, by_code, code_for)
    assert stints[0]["compound"] == "HARD"


def test_a_driver_with_no_feed_data_keeps_the_blank():
    stints = [ours("leclerc", 1, 1, 20)]
    by_code = index_openf1_stints([theirs(1, 1, 20, "SOFT")], CODES)  # VER only
    attach_compounds(stints, by_code, code_for)
    assert stints[0]["compound"] is None


def test_an_empty_compound_string_is_not_adopted():
    stints = [ours("leclerc", 1, 1, 20)]
    by_code = index_openf1_stints([theirs(16, 1, 20, "")], CODES)
    attach_compounds(stints, by_code, code_for)
    assert stints[0]["compound"] is None
    assert stints[0]["compoundSource"] == UNMATCHED


def test_report_counts_what_was_actually_identified():
    stints = [ours("leclerc", 1, 1, 20), ours("leclerc", 2, 21, 40)]
    by_code = index_openf1_stints([theirs(16, 1, 20, "SOFT")], CODES)
    report = attach_compounds(stints, by_code, code_for)
    assert report["identified"] == 1
    assert report["stints"] == 2
    assert 0.4 < report["share"] < 0.6
