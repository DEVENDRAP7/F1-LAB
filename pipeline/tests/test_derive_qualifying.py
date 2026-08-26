"""Cover the team-mate qualifying head-to-head.

The tests that matter are about what the count is allowed to mean: a
weekend counted, a gap measured against a comparable lap, and a pairing
that is not guessed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_qualifying import build_head_to_head, deepest_shared_segment  # noqa: E402


def row(driver, constructor, position, q1=None, q2=None, q3=None, code=None):
    return {
        "driverId": driver,
        "code": code or driver[:3].upper(),
        "constructorId": constructor,
        "constructorName": constructor.title(),
        "position": position,
        "q1S": q1,
        "q2S": q2,
        "q3S": q3,
    }


def round_(n, results, name="Grand Prix"):
    return {"round": n, "raceName": name, "results": results}


def test_the_gap_uses_the_last_segment_both_reached():
    """A Q3 time against a Q2 time is two track states and two fuel loads."""
    a = row("norris", "mclaren", 1, q1=80.5, q2=79.9, q3=79.2)
    b = row("piastri", "mclaren", 4, q1=80.7, q2=80.1)
    assert deepest_shared_segment(a, b) == "q2S"

    doc = build_head_to_head([round_(1, [a, b])])
    entry = doc["teams"][0]["rounds"][0]
    assert entry["segment"] == "Q2"
    assert entry["gapS"] == 0.2


def test_a_weekend_still_counts_when_there_is_no_comparable_lap():
    """Knocked out in different segments with no shared time is still a
    result on the road, and the count says so without inventing a gap."""
    a = row("norris", "mclaren", 3, q1=80.5, q2=79.9, q3=79.2)
    b = row("piastri", "mclaren", 16)  # no time published at all
    doc = build_head_to_head([round_(1, [a, b])])
    team = doc["teams"][0]

    assert team["rounds_compared"] == 1
    assert team["roundsWithGap"] == 0
    assert team["rounds"][0]["gapS"] is None
    assert team["rounds"][0]["segment"] is None
    assert team["rounds"][0]["ahead"] == "norris"


def test_the_count_is_of_weekends_and_carries_its_sample():
    rounds = [
        round_(1, [row("norris", "mclaren", 1, q3=79.2), row("piastri", "mclaren", 2, q3=79.4)]),
        round_(2, [row("norris", "mclaren", 4, q3=80.4), row("piastri", "mclaren", 3, q3=80.1)]),
        round_(3, [row("norris", "mclaren", 2, q3=78.9), row("piastri", "mclaren", 5, q3=79.0)]),
    ]
    team = build_head_to_head(rounds)["teams"][0]
    beats = {d["driverId"]: d["beats"] for d in team["drivers"]}

    assert beats == {"norris": 2, "piastri": 1}
    assert team["rounds_compared"] == 3
    assert team["roundsWithGap"] == 3
    assert team["medianGapS"] == 0.2


def test_position_and_lap_time_can_disagree_and_both_are_kept():
    """One driver can be ahead on the grid while the other set the quicker
    lap of the two in their shared segment — a penalty, or a Q3 run the
    other did not get. The row carries both rather than picking one."""
    a = row("hamilton", "ferrari", 8, q1=80.0, q2=79.5)
    b = row("leclerc", "ferrari", 5, q1=80.2, q2=79.7)
    entry = build_head_to_head([round_(1, [a, b])])["teams"][0]["rounds"][0]

    assert entry["ahead"] == "leclerc"          # further up the grid
    assert entry["aheadBySegment"] == "hamilton"  # quicker in Q2
    assert entry["gapS"] == 0.2


def test_a_third_driver_in_one_weekend_leaves_the_team_unpaired():
    """A reserve stepping in has no unambiguous pairing, and pairing by
    the order the feed returned would invent one."""
    rounds = [round_(1, [
        row("norris", "mclaren", 1, q3=79.2),
        row("piastri", "mclaren", 2, q3=79.4),
        row("reserve", "mclaren", 15, q1=81.0),
    ])]
    assert build_head_to_head(rounds)["teams"] == []


def test_a_mid_season_change_becomes_two_pairings_with_their_own_samples():
    """Keying by constructor threw away both Red Bull teams on real data —
    a driver moved between them, so each looked like a team with three
    drivers. What they actually have is two pairings."""
    rounds = [
        round_(1, [row("a", "team", 1, q3=79.0), row("b", "team", 2, q3=79.2)]),
        round_(2, [row("a", "team", 1, q3=79.0), row("b", "team", 3, q3=79.4)]),
        round_(3, [row("a", "team", 1, q3=79.0), row("c", "team", 2, q3=79.3)]),
    ]
    teams = build_head_to_head(rounds)["teams"]
    assert len(teams) == 2

    # The longer partnership comes first.
    assert teams[0]["rounds_compared"] == 2
    assert {d["driverId"] for d in teams[0]["drivers"]} == {"a", "b"}
    assert teams[1]["rounds_compared"] == 1
    assert {d["driverId"] for d in teams[1]["drivers"]} == {"a", "c"}

    # Every pairing is still two drivers, never three merged together.
    assert all(len(t["drivers"]) == 2 for t in teams)


def test_it_names_what_a_head_to_head_cannot_say():
    doc = build_head_to_head([])
    joined = " ".join(doc["limitations"]).lower()
    assert "not speed" in joined
    assert "red flag" in joined
