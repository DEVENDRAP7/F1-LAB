"""Cover the position-change feed and the measurement of its gaps."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_overtakes import (  # noqa: E402
    MIN_CHANGES,
    assess,
    completeness,
    net_by_driver,
)


def change(by, over):
    return {"overtakingDriverNumber": by, "overtakenDriverNumber": over}


class TestNetByDriver:
    def test_counts_both_sides_of_a_change(self):
        out = net_by_driver([change(1, 4)])
        assert out[1] == {"driverNumber": 1, "made": 1, "suffered": 0, "net": 1}
        assert out[4] == {"driverNumber": 4, "made": 0, "suffered": 1, "net": -1}

    def test_nets_out_across_a_race(self):
        events = [change(1, 4)] * 3 + [change(4, 1)] * 2
        out = net_by_driver(events)
        assert out[1]["net"] == 1
        assert out[4]["net"] == -1

    def test_a_half_recorded_event_still_counts_the_side_it_has(self):
        out = net_by_driver([change(1, None)])
        assert out[1]["made"] == 1
        assert 4 not in out


class TestCompleteness:
    def _results(self, rows):
        return [{"driverCode": c, "grid": g, "position": str(p)} for c, g, p in rows]

    def test_a_feed_that_matches_the_official_net_has_no_residual(self):
        net = net_by_driver([change(1, 4)] * 5)
        out = completeness(net, self._results([("VER", 10, 5), ("NOR", 2, 7)]),
                           {"VER": 1, "NOR": 4})
        assert out["medianAbsResidual"] == 0
        assert out["exact"] == 2

    def test_a_feed_that_missed_changes_shows_a_residual(self):
        # Official says VER gained 5; the feed recorded 2.
        net = net_by_driver([change(1, 4)] * 2)
        out = completeness(net, self._results([("VER", 10, 5)]), {"VER": 1})
        assert out["rows"][0]["officialNet"] == 5
        assert out["rows"][0]["recordedNet"] == 2
        assert out["rows"][0]["residual"] == -3

    def test_a_pit_lane_start_is_left_out_rather_than_treated_as_last(self):
        out = completeness({}, self._results([("VER", 0, 5)]), {"VER": 1})
        assert out["drivers"] == 0

    def test_a_driver_the_feed_does_not_number_is_skipped(self):
        out = completeness({}, self._results([("VER", 5, 3)]), {})
        assert out["drivers"] == 0

    def test_no_comparable_driver_reports_nothing_rather_than_zero(self):
        assert completeness({}, [], {})["medianAbsResidual"] is None


class TestAssess:
    def _results(self):
        return [{"driverCode": "VER", "grid": 10, "position": "5"}]

    def test_publishes_a_covered_race(self):
        out = assess([change(1, 4)] * MIN_CHANGES, self._results(), {"VER": 1})
        assert out["published"] is True
        assert out["changes"] == MIN_CHANGES
        assert out["byDriver"][0]["driverNumber"] == 1

    def test_withholds_a_race_the_feed_barely_covered(self):
        out = assess([change(1, 4)] * (MIN_CHANGES - 1), self._results(), {"VER": 1})
        assert out["published"] is False
        assert str(MIN_CHANGES) in out["withheldReason"]

    def test_an_empty_feed_is_a_refusal_and_not_a_quiet_race(self):
        out = assess([], self._results(), {"VER": 1})
        assert out["published"] is False
        assert out["changes"] == 0

    def test_every_published_race_carries_the_completeness_measurement(self):
        out = assess([change(1, 4)] * MIN_CHANGES, self._results(), {"VER": 1})
        assert "completeness" in out
        assert out["completeness"]["drivers"] == 1
