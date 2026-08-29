"""Cover the two-source conditions check.

The point of this module is the cross-check, so most of these are about
what it refuses: a thin sample, and two instruments that disagree by more
than any weather can explain.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_conditions import (  # noqa: E402
    MAX_AIR_TEMP_DISAGREEMENT_C,
    MIN_TRACKSIDE_SAMPLES,
    assess,
    cross_check,
    hours_within,
    summarise_archive,
    summarise_trackside,
)


def trackside(n=30, air=22.0, track=40.0, rain=0):
    return [{
        "airTemperatureC": air, "trackTemperatureC": track,
        "humidityPct": 50, "windSpeedMs": 3.0, "rainfall": rain,
    } for _ in range(n)]


def hours(n=2, air=22.5, precip=0.0):
    return [{
        "time": f"2026-08-23T1{4 + i}:00", "airTemperatureC": air,
        "humidityPct": 51, "windSpeedMs": 3.1, "precipitationMm": precip,
    } for i in range(n)]


class TestSummariseTrackside:
    def test_reports_a_median_and_a_range(self):
        rows = [{"airTemperatureC": t} for t in (20.0, 22.0, 30.0)]
        out = summarise_trackside(rows)
        assert out["airTemperatureC"] == 22.0
        assert out["airRange"] == {"minC": 20.0, "maxC": 30.0}

    def test_rainfall_is_a_share_of_readings_not_a_depth(self):
        rows = [{"rainfall": 1}] * 3 + [{"rainfall": 0}] * 1
        out = summarise_trackside(rows)
        assert out["rainfallSamples"] == 3
        assert out["rainfallShare"] == 0.75

    def test_a_missing_channel_is_none_rather_than_zero(self):
        out = summarise_trackside([{"airTemperatureC": None}])
        assert out["airTemperatureC"] is None
        assert out["airRange"] is None


class TestHoursWithin:
    def test_keeps_the_hours_the_session_spans(self):
        archive = {"hours": [
            {"time": "2026-08-23T13:00"}, {"time": "2026-08-23T14:00"},
            {"time": "2026-08-23T15:00"}, {"time": "2026-08-23T16:00"},
        ]}
        out = hours_within(archive, "2026-08-23T14:05:00+00:00", "2026-08-23T15:40:00+00:00")
        assert [h["time"] for h in out] == ["2026-08-23T14:00", "2026-08-23T15:00"]

    def test_a_session_inside_one_hour_still_finds_it(self):
        archive = {"hours": [{"time": "2026-08-23T14:00"}]}
        out = hours_within(archive, "2026-08-23T14:05:00+00:00", "2026-08-23T14:50:00+00:00")
        assert len(out) == 1

    def test_no_window_means_no_hours(self):
        assert hours_within({"hours": [{"time": "x"}]}, None, None) == []


class TestCrossCheck:
    def test_two_instruments_close_together_agree(self):
        out = cross_check({"airTemperatureC": 22.0}, {"airTemperatureC": 23.5})
        assert out["compared"] is True
        assert out["agrees"] is True
        assert out["deltaC"] == 1.5

    def test_a_wide_gap_does_not_agree(self):
        out = cross_check({"airTemperatureC": 22.0},
                          {"airTemperatureC": 22.0 + MAX_AIR_TEMP_DISAGREEMENT_C + 1})
        assert out["agrees"] is False

    def test_one_source_alone_is_not_a_check(self):
        out = cross_check({"airTemperatureC": 22.0}, {"airTemperatureC": None})
        assert out["compared"] is False
        assert "nothing to check it against" in out["reason"]


class TestAssess:
    def test_publishes_when_both_sources_agree(self):
        out = assess(trackside(), hours())
        assert out["published"] is True
        assert out["crossCheck"]["agrees"] is True
        assert out["trackside"]["trackTemperatureC"] == 40.0

    def test_withholds_a_thin_trackside_sample(self):
        out = assess(trackside(MIN_TRACKSIDE_SAMPLES - 1), hours())
        assert out["published"] is False
        assert str(MIN_TRACKSIDE_SAMPLES) in out["withheldReason"]

    def test_withholds_when_the_two_sources_disagree(self):
        out = assess(trackside(air=22.0), hours(air=45.0))
        assert out["published"] is False
        assert "wrong place or the wrong day" in out["withheldReason"]

    def test_publishes_on_the_trackside_feed_alone_when_there_is_no_second_source(self):
        # The archive being unreachable must not delete the conditions —
        # it deletes the check, and the document says the check did not run.
        out = assess(trackside(), [])
        assert out["published"] is True
        assert out["crossCheck"]["compared"] is False

    def test_track_temperature_is_carried_with_no_second_opinion(self):
        out = assess(trackside(track=48.0), hours())
        assert out["trackside"]["trackTemperatureC"] == 48.0
        assert "trackTemperatureC" not in out["archive"]


class TestSummariseArchive:
    def test_precipitation_is_summed_over_the_hours(self):
        out = summarise_archive(hours(n=3, precip=0.5))
        assert out["precipitationMm"] == 1.5
        assert out["hours"] == 3


class TestSessionWindowRegression:
    """A session with no end time silently produced no archive hours at
    all, which reported as "no second source" on every race — the check
    would have looked like it ran and never have run."""

    def test_a_window_with_no_end_finds_nothing(self):
        archive = {"hours": [{"time": "2026-08-23T14:00"}]}
        assert hours_within(archive, "2026-08-23T14:05:00+00:00", None) == []

    def test_the_session_fetcher_carries_an_end_time(self):
        import ingest_openf1
        import inspect
        source = inspect.getsource(ingest_openf1.fetch_sessions)
        assert '"dateEnd"' in source

    def test_a_non_utc_window_is_normalised_before_matching(self):
        import run_refresh
        # 15:00+02:00 is 13:00 UTC, and the archive is requested in UTC.
        assert run_refresh._utc_iso("2026-08-23T15:00:00+02:00").startswith("2026-08-23T13")
