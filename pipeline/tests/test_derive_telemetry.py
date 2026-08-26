"""Cover the OpenF1 telemetry derivations.

The load-bearing one is estimate_position_scale. OpenF1 does not document
the unit of its position coordinates, and every distance on the site
scales by whatever that unit is, so the test builds a synthetic lap with
a KNOWN unit and checks the estimator recovers it.
"""
import datetime
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_telemetry import (  # noqa: E402
    MIN_LINE_SAMPLES,
    align_to_location,
    build_outline_from_line,
    build_racing_line,
    estimate_position_scale,
)

BASE = datetime.datetime(2026, 8, 23, 13, 0, 0, tzinfo=datetime.timezone.utc)


def stamp(seconds: float) -> str:
    return (BASE + datetime.timedelta(seconds=seconds)).isoformat()


def synthetic_lap(units_per_metre: float, n: int = 400, speed_kph: float = 180.0):
    """A car going round a circle at constant speed.

    Position is emitted in `units_per_metre`, so the estimator has a
    single right answer to find.
    """
    dt = 0.27  # OpenF1 location arrives at roughly 3.7 Hz
    speed_ms = speed_kph / 3.6
    radius_m = 300.0

    location, car_data = [], []
    for i in range(n):
        t = i * dt
        angle = (speed_ms * t) / radius_m
        location.append({
            "date": stamp(t),
            "x": radius_m * np.cos(angle) * units_per_metre,
            "y": radius_m * np.sin(angle) * units_per_metre,
            "z": 0,
        })
        car_data.append({
            "date": stamp(t),
            "speedKph": speed_kph,
            "throttle": 100,
            "brake": 0,
            "gear": 7,
            "drs": 0,
            "rpm": 11000,
        })
    return location, car_data


@pytest.mark.parametrize("units_per_metre", [1.0, 10.0, 100.0])
def test_position_scale_is_measured_not_assumed(units_per_metre):
    location, car_data = synthetic_lap(units_per_metre)
    aligned = align_to_location(location, car_data)
    scale = estimate_position_scale(aligned)

    assert scale is not None
    # Chord-vs-arc: summing straight steps between samples on a curve
    # slightly under-measures the path, so allow a small tolerance rather
    # than demanding an exact hit.
    assert scale.value == pytest.approx(units_per_metre, rel=0.01)
    assert scale.sample_size > 0
    assert "integrating published speed" in scale.source


def test_position_scale_absent_rather_than_guessed_without_speed():
    """No speed channel means no way to measure the unit. The honest
    answer is None — a guessed scale would silently mis-size every
    distance on the site."""
    location, _ = synthetic_lap(10.0)
    aligned = align_to_location(location, [])
    assert estimate_position_scale(aligned) is None


def test_gear_and_brake_are_not_linearly_interpolated():
    """A gear is 4 or 5, never 4.5, and averaging a brake flag across a
    braking point invents a half-pressed pedal."""
    location = [{"date": stamp(i * 0.25), "x": i, "y": 0, "z": 0} for i in range(8)]
    car_data = [
        {"date": stamp(0.0), "speedKph": 300, "throttle": 100, "brake": 0, "gear": 8},
        {"date": stamp(1.0), "speedKph": 100, "throttle": 0, "brake": 100, "gear": 2},
    ]
    aligned = align_to_location(location, car_data)

    assert set(np.unique(aligned["gear"])) <= {8.0, 2.0}
    assert set(np.unique(aligned["brake"])) <= {0.0, 1.0}


def test_brake_is_normalised_to_the_bitmask_it_claims_to_be():
    """OpenF1 reports brake as 0/100; the stored channel declares a scale
    of 1, so it must be stored as 0/1 or the declared scale is a lie."""
    location = [{"date": stamp(i * 0.25), "x": i, "y": 0, "z": 0} for i in range(4)]
    car_data = [{"date": stamp(0.0), "speedKph": 100, "brake": 100, "gear": 3}]
    aligned = align_to_location(location, car_data)
    assert np.all(aligned["brake"] == 1.0)


def test_racing_line_refuses_a_partial_capture():
    """Too few samples is a partial capture, not a lap. Publishing it
    would render a polygon that misrepresents the track."""
    location = [{"date": stamp(i * 0.27), "x": i, "y": 0, "z": 0} for i in range(10)]
    aligned = align_to_location(location, [])
    assert aligned["t"].size < MIN_LINE_SAMPLES
    assert build_racing_line(aligned, 10.0) is None


def test_racing_line_resamples_into_metres():
    location, car_data = synthetic_lap(10.0)
    aligned = align_to_location(location, car_data)
    line = build_racing_line(aligned, 10.0)

    assert line is not None
    # The synthetic lap is a 300 m radius circle, so every point must sit
    # on that radius once converted out of raw units.
    radius = np.hypot(line["x"], line["y"])
    assert radius.mean() == pytest.approx(300.0, rel=0.01)
    assert {"x", "y", "speed", "throttle", "brake", "gear"} <= set(line)


def test_stationary_samples_do_not_fold_the_track():
    """Duplicate position samples make cumulative distance non-monotonic,
    which interpolation reads as the track folding back on itself."""
    location, car_data = synthetic_lap(10.0)
    # Freeze the car for a few samples, as happens on a grid or in a stop.
    for i in range(50, 60):
        location[i]["x"] = location[50]["x"]
        location[i]["y"] = location[50]["y"]

    aligned = align_to_location(location, car_data)
    line = build_racing_line(aligned, 10.0)
    assert line is not None
    assert np.all(np.isfinite(line["x"]))


def test_outline_thins_without_smoothing_corners_away():
    location, car_data = synthetic_lap(10.0)
    aligned = align_to_location(location, car_data)
    line = build_racing_line(aligned, 10.0)

    outline = build_outline_from_line(line, max_points=50)
    assert len(outline) <= 50
    # Every retained point is a real sample from the line, not an average
    # of neighbours.
    xs = set(round(float(v), 1) for v in line["x"])
    assert all(point[0] in xs for point in outline)


class TestElevation:
    """Elevation is published only where the feed's z is really elevation.

    The z channel is documented nowhere and is flat at some circuits, so
    the pipeline judges it on the lap rather than trusting or dismissing
    it — and states the number it judged on either way.
    """

    def test_a_climbing_lap_is_published_with_its_range(self):
        import numpy as np
        from derive_telemetry import elevation_summary

        z = np.linspace(0, 40, 500)  # a lap that climbs 40 m
        summary = elevation_summary({"z": z})
        assert summary["usable"] is True
        assert summary["rangeM"] == 40.0
        assert "sea level" in summary["source"]

    def test_a_flat_channel_is_refused_with_the_number_it_refused_on(self):
        import numpy as np
        from derive_telemetry import elevation_summary

        z = np.full(500, 12.0)
        z[10] = 13.2  # a metre of noise is not a circuit
        summary = elevation_summary({"z": z})
        assert summary["usable"] is False
        assert summary["rangeM"] == 1.2
        assert "below the 3m floor" in summary["reason"]

    def test_a_lap_with_no_elevation_channel_says_so(self):
        from derive_telemetry import elevation_summary

        summary = elevation_summary({"x": [1, 2, 3]})
        assert summary["usable"] is False
        assert "no elevation" in summary["reason"]


def test_align_carries_elevation_when_the_feed_publishes_it():
    from derive_telemetry import align_to_location

    location = [
        {"date": "2026-08-23T13:00:00.000000+00:00", "x": 0, "y": 0, "z": 100},
        {"date": "2026-08-23T13:00:00.250000+00:00", "x": 10, "y": 0, "z": 140},
        {"date": "2026-08-23T13:00:00.500000+00:00", "x": 20, "y": 0, "z": 180},
    ]
    aligned = align_to_location(location, [])
    assert "z" in aligned
    assert list(aligned["z"]) == [100.0, 140.0, 180.0]


def test_align_drops_a_partial_elevation_channel_rather_than_guessing():
    """A feed that publishes z for some samples and not others would give
    a profile with invented gaps filled in; better to have none."""
    from derive_telemetry import align_to_location

    location = [
        {"date": "2026-08-23T13:00:00.000000+00:00", "x": 0, "y": 0, "z": 100},
        {"date": "2026-08-23T13:00:00.250000+00:00", "x": 10, "y": 0, "z": None},
        {"date": "2026-08-23T13:00:00.500000+00:00", "x": 20, "y": 0, "z": 180},
    ]
    assert "z" not in align_to_location(location, [])


class TestCaptureDiagnostics:
    """Two rounds sat unexplained behind "lap capture too partial to
    publish" — a message that covers a lap with no samples, a lap with a
    few, and a lap with plenty that never moved."""

    def _aligned(self, n, moving=True):
        import numpy as np

        return {
            "t": np.arange(n, dtype=float),
            "x": (np.arange(n, dtype=float) * 10 if moving else np.zeros(n)),
            "y": np.zeros(n),
        }

    def test_it_names_a_lap_with_too_few_samples(self):
        from derive_telemetry import describe_line_capture

        assert "fewer than the" in describe_line_capture(self._aligned(20), 10.0)

    def test_it_names_a_lap_whose_coordinates_never_moved(self):
        from derive_telemetry import describe_line_capture

        reason = describe_line_capture(self._aligned(400, moving=False), 10.0)
        assert "advanced along the track" in reason
        assert "repeated the same coordinates" in reason

    def test_it_reports_a_healthy_capture_as_counts(self):
        from derive_telemetry import describe_line_capture

        assert describe_line_capture(self._aligned(400), 10.0).startswith("400 sample")
