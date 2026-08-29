"""Cover the per-circuit pit loss.

Most of what matters here is when the measurement refuses to become a
circuit constant: too few drivers, or drivers who do not agree.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_pit_loss import (  # noqa: E402
    MAX_SPREAD_RATIO,
    MIN_DRIVERS,
    assess,
    build,
    driver_losses,
    summarise,
)


class TestSummarise:
    def test_median_of_an_odd_sample(self):
        assert summarise([3.0, 1.0, 2.0])["medianS"] == 2.0

    def test_median_of_an_even_sample_is_the_midpoint(self):
        assert summarise([1.0, 2.0, 3.0, 4.0])["medianS"] == 2.5

    def test_quartiles_are_samples_rather_than_interpolations(self):
        stats = summarise([10.0, 20.0, 30.0, 40.0])
        assert stats["q1S"] in (10.0, 20.0)
        assert stats["q3S"] in (30.0, 40.0)

    def test_spread_is_the_interquartile_range_over_the_median(self):
        stats = summarise([10.0, 20.0, 30.0, 40.0])
        assert stats["spreadRatio"] == (stats["q3S"] - stats["q1S"]) / stats["medianS"]

    def test_carries_the_extremes_and_the_count(self):
        stats = summarise([5.0, 9.0, 7.0])
        assert stats["minS"] == 5.0
        assert stats["maxS"] == 9.0
        assert stats["drivers"] == 3


class TestAssess:
    def _tight(self, n):
        # A tight cluster: every driver within a few tenths.
        return [20.0 + i * 0.1 for i in range(n)]

    def test_publishes_when_enough_drivers_agree(self):
        out = assess(self._tight(MIN_DRIVERS + 2))
        assert out["published"] is True
        assert out["medianS"] > 0
        assert "withheldReason" not in out

    def test_withholds_below_the_driver_floor_and_says_the_count(self):
        out = assess(self._tight(MIN_DRIVERS - 1))
        assert out["published"] is False
        assert out["drivers"] == MIN_DRIVERS - 1
        assert str(MIN_DRIVERS) in out["withheldReason"]

    def test_one_stop_is_never_a_circuit_constant(self):
        # The Shanghai case: a single 45.8s stop.
        out = assess([45.8])
        assert out["published"] is False
        assert "1 driver(s)" in out["withheldReason"]

    def test_withholds_when_the_drivers_disagree(self):
        # The Silverstone case: plenty of drivers, no agreement.
        out = assess([14.8, 17.0, 19.0, 23.8, 28.3, 30.0, 33.0, 41.8])
        assert out["published"] is False
        assert "of the median" in out["withheldReason"]

    def test_a_withheld_spread_still_reports_what_it_measured(self):
        out = assess([14.8, 17.0, 19.0, 23.8, 28.3, 30.0, 33.0, 41.8])
        assert out["drivers"] == 8
        assert out["q1S"] < out["q3S"]

    def test_the_threshold_is_the_one_the_module_states(self):
        median = 20.0
        inside = [median - median * MAX_SPREAD_RATIO * 0.2] * 3 + [median] * 3 \
            + [median + median * MAX_SPREAD_RATIO * 0.2] * 3
        assert assess(inside)["published"] is True
        outside = [median - median * MAX_SPREAD_RATIO] * 4 + [median] \
            + [median + median * MAX_SPREAD_RATIO] * 4
        assert assess(outside)["published"] is False


class TestDriverLosses:
    def _doc(self, values):
        return {"drivers": {
            f"d{i}": {"params": {"pit_loss_s": v}} for i, v in enumerate(values)
        }}

    def test_reads_the_measured_stops(self):
        assert driver_losses(self._doc([20.0, 21.0])) == [20.0, 21.0]

    def test_a_zero_is_an_absence_and_not_a_fast_stop(self):
        assert driver_losses(self._doc([20.0, 0.0])) == [20.0]

    def test_survives_a_document_with_nothing_in_it(self):
        assert driver_losses({}) == []
        assert driver_losses({"drivers": {"d": {}}}) == []
        assert driver_losses({"drivers": {"d": {"params": {}}}}) == []

    def test_ignores_a_non_numeric_value(self):
        assert driver_losses(self._doc([None, "20", 22.0])) == [22.0]


class TestBuild:
    def test_counts_what_it_published_and_what_it_did_not(self):
        circuits = [
            {"circuitId": "a", "pitLoss": {"published": True, "medianS": 20.0}},
            {"circuitId": "b", "pitLoss": {"published": False, "withheldReason": "x"}},
        ]
        doc = build(2026, circuits, "2026-01-01T00:00:00Z", "test")
        assert doc["publishedCount"] == 1
        assert doc["withheldCount"] == 1
        assert len(doc["limitations"]) >= 4
