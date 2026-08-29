"""Cover the broadcast team-radio timeline.

What matters here is what the module does not do: it does not transcribe,
it does not infer, and it does not treat a broadcast selection as a
driver's radio traffic.
"""
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_radio import (  # noqa: E402
    LIMITATIONS,
    MIN_CLIPS,
    assess,
    build_timeline,
    count_by_driver,
    lap_at,
)

T = datetime.datetime.fromisoformat
STARTS = [
    (1, T("2026-08-23T13:00:00+00:00")),
    (2, T("2026-08-23T13:01:30+00:00")),
    (3, T("2026-08-23T13:03:00+00:00")),
]


def clip(when, number=44, url="https://example.invalid/clip.mp3"):
    return {"date": when, "driverNumber": number, "recordingUrl": url}


class TestLapAt:
    def test_a_moment_inside_a_lap(self):
        assert lap_at(T("2026-08-23T13:02:00+00:00"), STARTS) == 2

    def test_a_moment_after_the_last_recorded_start(self):
        assert lap_at(T("2026-08-23T13:30:00+00:00"), STARTS) == 3

    def test_before_the_race_belongs_to_no_lap_rather_than_lap_one(self):
        assert lap_at(T("2026-08-23T12:50:00+00:00"), STARTS) is None

    def test_no_moment_means_no_lap(self):
        assert lap_at(None, STARTS) is None


class TestBuildTimeline:
    def test_joins_a_clip_to_a_driver_and_a_lap(self):
        out = build_timeline([clip("2026-08-23T13:02:00+00:00")], STARTS, {44: "HAM"})
        assert out[0]["driverCode"] == "HAM"
        assert out[0]["lap"] == 2

    def test_keeps_the_source_url_rather_than_any_audio(self):
        out = build_timeline([clip("2026-08-23T13:02:00+00:00")], STARTS, {44: "HAM"})
        assert out[0]["recordingUrl"] == "https://example.invalid/clip.mp3"
        # Nothing resembling a transcript is produced anywhere.
        assert set(out[0]) == {"date", "driverNumber", "driverCode", "lap", "recordingUrl"}

    def test_sorted_by_time(self):
        clips = [clip("2026-08-23T13:05:00+00:00"), clip("2026-08-23T13:02:00+00:00")]
        out = build_timeline(clips, STARTS, {44: "HAM"})
        assert [c["date"] for c in out] == [
            "2026-08-23T13:02:00+00:00", "2026-08-23T13:05:00+00:00",
        ]

    def test_an_unknown_driver_number_carries_no_invented_code(self):
        out = build_timeline([clip("2026-08-23T13:02:00+00:00", 99)], STARTS, {44: "HAM"})
        assert out[0]["driverCode"] is None


class TestCountByDriver:
    def test_counts_clips_per_driver_most_first(self):
        clips = [clip("2026-08-23T13:02:00+00:00", 16)] * 3 \
            + [clip("2026-08-23T13:04:00+00:00", 44)]
        timeline = build_timeline(clips, STARTS, {16: "LEC", 44: "HAM"})
        counts = count_by_driver(timeline)
        assert [c["driverCode"] for c in counts] == ["LEC", "HAM"]
        assert counts[0]["clips"] == 3


class TestAssess:
    def _clips(self, n):
        return [clip(f"2026-08-23T13:0{i}:00+00:00", 44) for i in range(n)]

    def test_publishes_a_covered_race(self):
        out = assess(self._clips(MIN_CLIPS), STARTS, {44: "HAM"})
        assert out["published"] is True
        assert out["clips"] == MIN_CLIPS

    def test_withholds_when_the_broadcast_released_almost_nothing(self):
        out = assess(self._clips(MIN_CLIPS - 1), STARTS, {44: "HAM"})
        assert out["published"] is False
        assert str(MIN_CLIPS) in out["withheldReason"]

    def test_an_empty_feed_says_so_rather_than_showing_an_empty_page(self):
        out = assess([], STARTS, {})
        assert out["published"] is False
        assert out["clips"] == 0

    def test_the_limitations_say_it_is_broadcast_selection_and_untranscribed(self):
        joined = " ".join(LIMITATIONS).lower()
        assert "broadcast selections" in joined
        assert "transcrib" in joined
        assert "no audio is copied" in joined
