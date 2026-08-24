"""Undercut ledger and elapsed-time maths.

The ledger is the one place the pipeline turns lap times into a claim
about racing ("this stop gained 4 seconds on that rival"), so the cases
that would make it lie are pinned here: a missing lap time silently
under-counting a gap, a rival who was never in the fight, and a
neutralised window that makes any comparison meaningless.
"""
import pytest

from derive import (
    NEUTRALISED_WINDOW_FACTOR,
    UNDERCUT_RIVAL_WINDOW_S,
    build_undercut_ledger,
    cumulative_times,
)


def laps_for(driver, times, start=1):
    return [
        {"lap": start + i, "driverId": driver, "position": 1, "timeS": t}
        for i, t in enumerate(times)
    ]


class TestCumulativeTimes:
    def test_sums_lap_times_into_elapsed_race_time(self):
        elapsed = cumulative_times(laps_for("a", [90.0, 91.0, 89.0]))
        assert elapsed["a"][1] == pytest.approx(90.0)
        assert elapsed["a"][2] == pytest.approx(181.0)
        assert elapsed["a"][3] == pytest.approx(270.0)

    def test_stops_at_a_missing_lap_rather_than_under_counting(self):
        # Skipping the None and carrying on would make the driver look
        # 90s faster than they were, turning a gap into fiction.
        elapsed = cumulative_times(laps_for("a", [90.0, None, 89.0]))
        assert elapsed["a"] == {1: pytest.approx(90.0)}
        assert 3 not in elapsed["a"]

    def test_gap_between_drivers_is_the_difference(self):
        laps = laps_for("a", [90.0, 90.0]) + laps_for("b", [92.0, 92.0])
        elapsed = cumulative_times(laps)
        assert elapsed["b"][2] - elapsed["a"][2] == pytest.approx(4.0)


class TestUndercutLedger:
    def test_measures_time_gained_over_a_rival_who_stopped_later(self):
        # A pits on lap 3 and runs 88s laps after; B stays out on 92s
        # laps and pits on lap 5. A should come out ahead on net time.
        a = laps_for("a", [90, 90, 112, 88, 88, 88])  # lap 3 carries the pit loss
        b = laps_for("b", [90, 90, 92, 92, 112, 88])
        stops = [
            {"driverId": "a", "lap": 3, "stop": 1, "durationS": 22.0},
            {"driverId": "b", "lap": 5, "stop": 1, "durationS": 22.0},
        ]

        ledger = build_undercut_ledger(a + b, stops)["entries"]

        entry = next(e for e in ledger if e["driverId"] == "a" and e["rivalId"] == "b")
        assert entry["stopLap"] == 3
        assert entry["rivalStopLap"] == 5
        # gap before (lap 2) = 0; after B's stop (lap 6) A is ahead.
        assert entry["gapBeforeS"] == pytest.approx(0.0)
        assert entry["netS"] > 0
        assert entry["aheadAfter"] is True

    def test_ignores_a_rival_who_was_never_in_the_fight(self):
        a = laps_for("a", [90, 90, 112, 88, 88, 88])
        far = laps_for("far", [140, 140, 140, 140, 112, 88])  # minutes behind
        stops = [
            {"driverId": "a", "lap": 3, "stop": 1, "durationS": 22.0},
            {"driverId": "far", "lap": 5, "stop": 1, "durationS": 22.0},
        ]

        ledger = build_undercut_ledger(a + far, stops)["entries"]

        assert all(e["rivalId"] != "far" for e in ledger)

    def test_ignores_a_rival_who_had_already_stopped(self):
        # B stopped first, so A's later stop is not an undercut on B.
        a = laps_for("a", [90, 90, 90, 112, 88, 88])
        b = laps_for("b", [90, 112, 88, 88, 88, 88])
        stops = [
            {"driverId": "b", "lap": 2, "stop": 1, "durationS": 22.0},
            {"driverId": "a", "lap": 4, "stop": 1, "durationS": 22.0},
        ]

        ledger = build_undercut_ledger(a + b, stops)["entries"]

        assert all(not (e["driverId"] == "a" and e["rivalId"] == "b") for e in ledger)

    def test_flags_a_neutralised_window(self):
        # Every car crawls through the comparison window: the gap change
        # says nothing about the stop, and there is no track-status
        # channel to prove it, so it must be flagged not silently kept.
        #
        # The race has to be mostly green for this to mean anything — in
        # a 6-lap fixture the slow laps drag the race median up with them
        # and nothing is detectable, which is correct behaviour, not a
        # gap in the detector.
        slow = 90 * NEUTRALISED_WINDOW_FACTOR + 20
        green = [90.0] * 10
        a = laps_for("a", green + [112, slow, slow, 88] + [88.0] * 6)
        b = laps_for("b", green + [92, slow, 112, 88] + [88.0] * 6)
        stops = [
            {"driverId": "a", "lap": 11, "stop": 1, "durationS": 22.0},
            {"driverId": "b", "lap": 13, "stop": 1, "durationS": 22.0},
        ]

        ledger = build_undercut_ledger(a + b, stops)["entries"]

        entry = next(e for e in ledger if e["driverId"] == "a" and e["rivalId"] == "b")
        assert entry["neutralisedWindow"] is True

    def test_does_not_flag_an_ordinary_green_window(self):
        green = [90.0] * 10
        a = laps_for("a", green + [112, 88, 88, 88] + [88.0] * 6)
        b = laps_for("b", green + [92, 92, 112, 88] + [88.0] * 6)
        stops = [
            {"driverId": "a", "lap": 11, "stop": 1, "durationS": 22.0},
            {"driverId": "b", "lap": 13, "stop": 1, "durationS": 22.0},
        ]

        ledger = build_undercut_ledger(a + b, stops)["entries"]

        entry = next(e for e in ledger if e["driverId"] == "a" and e["rivalId"] == "b")
        assert entry["neutralisedWindow"] is False
        assert entry["netS"] > 0

    def test_skips_pairs_with_missing_times_instead_of_guessing(self):
        a = laps_for("a", [90, 90, 112, 88, 88, 88])
        b = laps_for("b", [90, 90, 92, None, 112, 88])  # data gap
        stops = [
            {"driverId": "a", "lap": 3, "stop": 1, "durationS": 22.0},
            {"driverId": "b", "lap": 5, "stop": 1, "durationS": 22.0},
        ]

        ledger = build_undercut_ledger(a + b, stops)["entries"]

        assert all(e["rivalId"] != "b" for e in ledger)

    def test_window_constant_is_on_the_scale_of_a_pit_loss(self):
        assert 15 <= UNDERCUT_RIVAL_WINDOW_S <= 45

    def test_excludes_and_counts_an_implausible_swing(self):
        # A retirement or a long repair inside the window produced net
        # swings over 1000s on real race data. Publishing that as an
        # "undercut" would be a fabricated claim about racing.
        green = [90.0] * 10
        a = laps_for("a", green + [112, 88, 88, 88] + [88.0] * 6)
        b = laps_for("b", green + [92, 900, 112, 88] + [88.0] * 6)  # 15 min in the garage
        stops = [
            {"driverId": "a", "lap": 11, "stop": 1, "durationS": 22.0},
            {"driverId": "b", "lap": 13, "stop": 1, "durationS": 22.0},
        ]

        result = build_undercut_ledger(a + b, stops)

        assert all(e["rivalId"] != "b" for e in result["entries"])
        assert result["excluded"]["implausible_net"] == 1

    def test_excludes_a_window_containing_another_stop(self):
        green = [90.0] * 10
        a = laps_for("a", green + [112, 88, 112, 88] + [88.0] * 6)  # stops twice
        b = laps_for("b", green + [92, 92, 92, 112] + [88.0] * 6)
        stops = [
            {"driverId": "a", "lap": 11, "stop": 1, "durationS": 22.0},
            {"driverId": "a", "lap": 13, "stop": 2, "durationS": 22.0},
            {"driverId": "b", "lap": 14, "stop": 1, "durationS": 22.0},
        ]

        result = build_undercut_ledger(a + b, stops)

        assert result["excluded"]["another_stop_in_window"] >= 1

    def test_excludes_a_rival_who_stayed_out_far_longer(self):
        green = [90.0] * 10
        a = laps_for("a", green + [112] + [88.0] * 20)
        b = laps_for("b", green + [92.0] * 15 + [112] + [88.0] * 5)
        stops = [
            {"driverId": "a", "lap": 11, "stop": 1, "durationS": 22.0},
            {"driverId": "b", "lap": 26, "stop": 1, "durationS": 22.0},
        ]

        result = build_undercut_ledger(a + b, stops)

        assert all(e["rivalId"] != "b" for e in result["entries"])
        assert result["excluded"]["window_too_long"] == 1
