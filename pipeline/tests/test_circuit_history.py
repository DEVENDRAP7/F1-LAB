"""Cover the Upcoming Race Brief's priors, and in particular the trap the
source probe surfaced: Jolpica-F1's finishing-status wording changes
between seasons, so a classifier that matched on status strings would
have silently counted every lapped 2025 finisher as a retirement.

The fixtures below use the exact status/positionText pairings observed
at Monza across 2022-2025 (see pipeline/diagnose_sources.py).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive import summarise_circuit_history  # noqa: E402


def result(position, position_text, grid, status):
    return {
        "position": position,
        "positionText": position_text,
        "grid": grid,
        "status": status,
        "driverCode": f"D{position:02d}",
    }


def test_lapped_finisher_counts_as_classified_in_both_vocabularies():
    """2022 says "+1 Lap", 2025 says "Lapped" for the same outcome."""
    old = [result(1, "1", 1, "Finished"), result(2, "2", 2, "+1 Lap")]
    new = [result(1, "1", 1, "Finished"), result(2, "2", 2, "Lapped")]

    for results in (old, new):
        summary = summarise_circuit_history([{"year": 2022, "results": results}])
        assert summary["finishRate"]["classified"] == 2
        assert summary["finishRate"]["starters"] == 2
        assert summary["finishRate"]["share"] == 1.0


def test_retirement_is_a_starter_but_not_classified():
    results = [
        result(1, "1", 1, "Finished"),
        result(2, "R", 2, "Engine"),
        result(3, "R", 3, "Retired"),
    ]
    summary = summarise_circuit_history([{"year": 2024, "results": results}])
    assert summary["finishRate"]["starters"] == 3
    assert summary["finishRate"]["classified"] == 1


def test_did_not_start_is_not_counted_as_a_starter():
    """A car with positionText 'W' never took the start, so counting it
    among the starters would understate the finish rate."""
    results = [result(1, "1", 1, "Finished"), result(2, "W", 2, "Did not start")]
    summary = summarise_circuit_history([{"year": 2023, "results": results}])
    assert summary["finishRate"]["starters"] == 1
    assert summary["finishRate"]["classified"] == 1


def test_pit_lane_start_is_excluded_from_position_change():
    """Grid 0 is a pit-lane start, not P0: counting it would book a
    fictional 19-place gain."""
    results = [
        result(1, "1", 3, "Finished"),   # gained 2
        result(2, "2", 0, "Finished"),   # pit lane, excluded
    ]
    summary = summarise_circuit_history([{"year": 2025, "results": results}])
    assert summary["positionChange"]["n"] == 1
    assert summary["positionChange"]["medianPlaces"] == 2


def test_missing_pitstops_is_not_zero_stops():
    """A source that did not answer must stay distinguishable from a race
    in which nobody stopped."""
    results = [result(1, "1", 1, "Finished")]
    summary = summarise_circuit_history([{"year": 2025, "results": results, "pitstops": None}])
    assert summary["stops"]["editionsWithData"] == 0
    assert summary["stops"]["n"] == 0
    assert summary["stops"]["medianPerDriver"] is None


def test_stops_are_counted_per_driver():
    results = [result(1, "1", 1, "Finished"), result(2, "2", 2, "Finished")]
    pitstops = [
        {"driverId": "a", "lap": 12, "stop": 1},
        {"driverId": "a", "lap": 34, "stop": 2},
        {"driverId": "b", "lap": 20, "stop": 1},
    ]
    summary = summarise_circuit_history([
        {"year": 2025, "results": results, "pitstops": pitstops},
    ])
    assert summary["stops"]["n"] == 2
    assert summary["stops"]["medianPerDriver"] == 1.5
    assert summary["stops"]["editionsWithData"] == 1


def test_editions_without_results_are_not_counted():
    summary = summarise_circuit_history([
        {"year": 2025, "results": []},
        {"year": 2024, "results": [result(1, "1", 1, "Finished")]},
    ])
    assert summary["editions"] == 1
    assert summary["years"] == [2024]


def test_winner_grid_range_is_reported_with_its_sample_count():
    summary = summarise_circuit_history([
        {"year": 2025, "results": [result(1, "1", 4, "Finished")]},
        {"year": 2024, "results": [result(1, "1", 1, "Finished")]},
    ])
    assert summary["winnerGrid"] == {"median": 2.5, "best": 1, "worst": 4, "n": 2}


def test_unavailable_priors_are_named_rather_than_omitted():
    summary = summarise_circuit_history([])
    assert "safetyCar" in summary["unavailable"]
    assert "tyreCompounds" in summary["unavailable"]
    assert summary["editions"] == 0
