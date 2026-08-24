import pytest

from derive import build_stints, fit_stint_degradation
from ingest import _lap_time_to_seconds


def make_laps(driver: str, n: int, base: float = 90.0, deg: float = 0.05):
    return [
        {"lap": i, "driverId": driver, "position": 1, "timeS": base + deg * i}
        for i in range(1, n + 1)
    ]


class TestLapTimeParsing:
    def test_parses_minute_colon_seconds(self):
        assert _lap_time_to_seconds("1:32.264") == pytest.approx(92.264)

    def test_parses_bare_seconds(self):
        assert _lap_time_to_seconds("32.264") == pytest.approx(32.264)

    def test_returns_none_rather_than_guessing(self):
        assert _lap_time_to_seconds("") is None
        assert _lap_time_to_seconds("no time") is None
        assert _lap_time_to_seconds(None) is None


class TestBuildStints:
    def test_two_stops_produce_three_stints_covering_every_lap(self):
        laps = make_laps("hamilton", 57)
        pitstops = [
            {"driverId": "hamilton", "lap": 20, "stop": 1, "durationS": 22.1},
            {"driverId": "hamilton", "lap": 38, "stop": 2, "durationS": 21.8},
        ]

        stints = build_stints(laps, pitstops, total_laps=57)

        assert [s["startLap"] for s in stints] == [1, 21, 39]
        assert [s["endLap"] for s in stints] == [20, 38, 57]
        assert sum(s["laps"] for s in stints) == 57

    def test_no_stops_is_a_single_stint(self):
        stints = build_stints(make_laps("norris", 44), [], total_laps=44)
        assert len(stints) == 1
        assert stints[0]["laps"] == 44

    def test_compound_is_null_and_labelled_never_invented(self):
        stints = build_stints(make_laps("russell", 10), [], total_laps=10)
        assert stints[0]["compound"] is None
        assert "no tyre compound" in stints[0]["compoundSource"]

    def test_separates_drivers(self):
        laps = make_laps("a", 10) + make_laps("b", 10)
        pitstops = [{"driverId": "a", "lap": 5, "stop": 1, "durationS": 22.0}]

        stints = build_stints(laps, pitstops, total_laps=10)

        by_driver = {}
        for s in stints:
            by_driver.setdefault(s["driverId"], []).append(s)
        assert len(by_driver["a"]) == 2
        assert len(by_driver["b"]) == 1


class TestFitStintDegradation:
    def test_recovers_a_known_slope_and_flags_it_uncorrected(self):
        # 20 clean laps rising 0.06 s per lap.
        stint = {
            "driverId": "hamilton",
            "stint": 1,
            "compound": None,
            "lapTimesS": [90.0 + 0.06 * i for i in range(1, 21)],
        }

        fit = fit_stint_degradation(stint)

        assert fit["deg_rate_s_per_lap"] == pytest.approx(0.06, abs=0.005)
        assert fit["fuel_corrected"] is False
        assert "not separately identifiable" in fit["fuel_note"]

    def test_drops_a_safety_car_lap_as_an_outlier(self):
        times = [90.0 + 0.05 * i for i in range(1, 21)]
        times[10] = 140.0  # a lap far off the median, e.g. a safety car
        stint = {"driverId": "x", "stint": 1, "compound": None, "lapTimesS": times}

        fit = fit_stint_degradation(stint)

        assert fit["excluded_laps"] >= 1
        # The outlier must not drag the slope; without exclusion it would.
        assert fit["deg_rate_s_per_lap"] == pytest.approx(0.05, abs=0.01)

    def test_returns_none_for_a_stint_too_short_to_fit(self):
        stint = {"driverId": "x", "stint": 1, "compound": None, "lapTimesS": [90.0, 90.1]}
        assert fit_stint_degradation(stint) is None

    def test_ignores_missing_lap_times(self):
        stint = {
            "driverId": "x",
            "stint": 1,
            "compound": None,
            "lapTimesS": [90.0, None, 90.1, None, 90.2, 90.3, 90.4, 90.5],
        }
        fit = fit_stint_degradation(stint)
        assert fit is not None
        assert fit["sample_count"] >= 3
