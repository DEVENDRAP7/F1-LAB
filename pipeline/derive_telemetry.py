"""Derivations from OpenF1 position and car telemetry.

Pure functions over the rows ingest_openf1.py returns — no network here.

The one genuinely subtle thing in this module is the coordinate unit.
OpenF1's location x/y/z are integers in an unstated unit, and every
distance-based figure downstream (racing-line resampling, the track
map's scale bar, any corner speed keyed to a position) is wrong by a
constant factor if that unit is assumed instead of established. So it is
measured, not assumed — see estimate_position_scale.
"""
from __future__ import annotations

import datetime

import numpy as np

from common import LINE_CHANNELS, resample_by_distance
from common import SourcedValue

# A lap needs enough position samples to be a line rather than a
# polygon. At OpenF1's ~3.7 Hz a 70-second lap gives ~260 samples, so
# anything under this is a partial capture and is refused rather than
# published as a mangled line.
MIN_LINE_SAMPLES = 120

# Speeds below this contribute almost nothing to distance but a lot of
# noise to the scale fit (a stationary car still jitters in position),
# so the calibration ignores them.
SCALE_MIN_SPEED_KPH = 50.0


def _to_seconds(dates: list[str]) -> np.ndarray:
    """Timestamps to seconds elapsed from the first sample."""
    parsed = [datetime.datetime.fromisoformat(d) for d in dates]
    base = parsed[0]
    return np.array([(p - base).total_seconds() for p in parsed], dtype=float)


def align_to_location(location: list[dict], car_data: list[dict]) -> dict:
    """Put car telemetry on the position clock.

    The two channels are sampled independently and at different rates, so
    they share no timestamps. Each telemetry channel is interpolated onto
    the position timestamps; position is the base because it is what the
    line's geometry is made of, and resampling geometry to a coarser
    clock would visibly cut corners off the track map.

    Interpolation is linear for the continuous channels and
    previous-value for the discrete ones: a gear is 4 or 5 and never 4.5,
    and averaging a brake flag across a braking point would invent a
    half-pressed pedal that never happened.
    """
    if not location:
        return {}

    loc_t = _to_seconds([r["date"] for r in location])
    out = {
        "t": loc_t,
        "x": np.array([r["x"] for r in location], dtype=float),
        "y": np.array([r["y"] for r in location], dtype=float),
    }

    # Elevation, when the feed carries it. It is documented nowhere and
    # is flat at some circuits, so it is carried through here and judged
    # later, on the lap itself, rather than trusted or dismissed now.
    z = np.array(
        [np.nan if r.get("z") is None else float(r["z"]) for r in location],
        dtype=float,
    )
    if np.isfinite(z).all() and z.size:
        out["z"] = z

    if not car_data:
        return out

    car_t = _to_seconds_relative([r["date"] for r in car_data], location[0]["date"])

    def linear(field):
        values = np.array(
            [np.nan if r.get(field) is None else float(r[field]) for r in car_data],
            dtype=float,
        )
        ok = ~np.isnan(values)
        if ok.sum() < 2:
            return None
        return np.interp(loc_t, car_t[ok], values[ok])

    def previous(field):
        values = [r.get(field) for r in car_data]
        idx = np.searchsorted(car_t, loc_t, side="right") - 1
        idx = np.clip(idx, 0, len(values) - 1)
        return np.array([0.0 if values[i] is None else float(values[i]) for i in idx])

    speed = linear("speedKph")
    if speed is not None:
        out["speed"] = speed
    throttle = linear("throttle")
    if throttle is not None:
        out["throttle"] = throttle

    out["gear"] = previous("gear")
    # OpenF1 reports brake as 0 or 100 rather than a 0/1 flag; the line
    # format stores it as a bitmask, so anything non-zero is "on the
    # brakes". Rescaling it to 0/1 keeps the stored channel honest to its
    # declared scale of 1.
    out["brake"] = (previous("brake") > 0).astype(float)
    return out


def _to_seconds_relative(dates: list[str], base_date: str) -> np.ndarray:
    base = datetime.datetime.fromisoformat(base_date)
    return np.array(
        [(datetime.datetime.fromisoformat(d) - base).total_seconds() for d in dates],
        dtype=float,
    )


def estimate_position_scale(aligned: dict) -> SourcedValue | None:
    """Measure how many raw position units make a metre.

    OpenF1 does not document the unit of location x/y, and guessing it
    would put a constant multiplicative error into every distance on the
    site — the resampling spacing, the track map's proportions against
    any real-world figure, and any speed-versus-distance trace.

    It does not have to be guessed. Speed is published in km/h, so
    integrating speed over the lap's own timestamps gives the lap's
    length in real metres, and summing the position steps gives the same
    lap in raw units. Their ratio is the unit, measured off this lap.

    Returns None when the lap lacks the speed channel needed to do it,
    because a scale this load-bearing should be absent rather than
    assumed.
    """
    if "speed" not in aligned:
        return None

    t = aligned["t"]
    x = aligned["x"]
    y = aligned["y"]
    speed = aligned["speed"]
    if t.size < MIN_LINE_SAMPLES:
        return None

    dt = np.diff(t)
    moving = speed[1:] >= SCALE_MIN_SPEED_KPH
    if moving.sum() < 20:
        return None

    metres = float(np.sum(speed[1:][moving] / 3.6 * dt[moving]))
    raw_steps = np.hypot(np.diff(x), np.diff(y))
    raw = float(np.sum(raw_steps[moving]))
    if metres <= 0 or raw <= 0:
        return None

    return SourcedValue(
        value=raw / metres,
        source=(
            "measured on this lap: raw position path length divided by the "
            "lap length obtained by integrating published speed over the "
            "sample timestamps"
        ),
        sample_size=int(moving.sum()),
    )


def build_racing_line(aligned: dict, units_per_metre: float) -> dict | None:
    """Resample one lap onto a fixed distance grid, in metres.

    Distance is cumulative along the driven path rather than a lap
    fraction, so two drivers' lines are comparable point-for-point even
    though they cover slightly different ground.
    """
    if not aligned or aligned["t"].size < MIN_LINE_SAMPLES:
        return None
    if not units_per_metre:
        return None

    x = aligned["x"] / units_per_metre
    y = aligned["y"] / units_per_metre

    steps = np.hypot(np.diff(x), np.diff(y))
    distance = np.concatenate([[0.0], np.cumsum(steps)])

    # A stationary or duplicated sample makes distance non-monotonic,
    # which np.interp silently reads as a fold in the track. Keep only
    # samples that advanced.
    keep = np.concatenate([[True], np.diff(distance) > 0])
    if keep.sum() < MIN_LINE_SAMPLES:
        return None
    distance = distance[keep]

    channels = {"x": x[keep], "y": y[keep]}
    if "z" in aligned:
        # Same raw unit as x and y, so the same measured scale applies.
        channels["z"] = (aligned["z"] / units_per_metre)[keep]
    for name in LINE_CHANNELS:
        if name in ("x", "y", "z"):
            continue
        if name in aligned:
            channels[name] = aligned[name][keep]

    names = [n for n in LINE_CHANNELS if n in channels]
    _, resampled = resample_by_distance(distance, *[channels[n] for n in names])
    return dict(zip(names, resampled))


def build_outline_from_line(line: dict, max_points: int = 1200) -> list[list[float]]:
    """The circuit outline is the driven path itself, thinned.

    This is a real measured lap, not a drawing: the outline the map shows
    is where a car actually went. It is thinned only to keep the SVG path
    small, and by taking every Nth sample rather than by smoothing, so no
    corner is rounded off into a shape nobody drove.
    """
    if not line or "x" not in line:
        return []
    x = np.asarray(line["x"])
    y = np.asarray(line["y"])
    step = max(1, int(np.ceil(len(x) / max_points)))
    return [[round(float(a), 1), round(float(b), 1)] for a, b in zip(x[::step], y[::step])]


# An elevation channel that varies by less than this over a whole lap is
# not elevation: it is the feed reporting a constant, or noise around
# one. Spa climbs about 100 m and Zandvoort about 15, so a real profile
# clears this by an order of magnitude — and a circuit that genuinely is
# flat is better described as having no published profile than as having
# a two-metre one drawn at full scale.
MIN_ELEVATION_RANGE_M = 3.0


def elevation_summary(line: dict) -> dict:
    """Whether this lap's z channel carries a usable elevation profile.

    Returns the range either way: a refusal that states the number it
    refused on is checkable, and a silent absence is not.
    """
    z = line.get("z") if line else None
    if z is None or len(z) == 0:
        return {
            "usable": False,
            "reason": "the position feed published no elevation for this lap",
        }

    z = np.asarray(z, dtype=float)
    finite = z[np.isfinite(z)]
    if finite.size < 2:
        return {
            "usable": False,
            "reason": "the elevation channel is empty for this lap",
        }

    span = float(finite.max() - finite.min())
    if span < MIN_ELEVATION_RANGE_M:
        return {
            "usable": False,
            "rangeM": round(span, 2),
            "reason": (
                f"the elevation channel varies by only {span:.1f}m over the lap, "
                f"below the {MIN_ELEVATION_RANGE_M:.0f}m floor this project treats "
                "as a real profile"
            ),
        }

    return {
        "usable": True,
        "rangeM": round(span, 2),
        "minM": round(float(finite.min()), 2),
        "maxM": round(float(finite.max()), 2),
        "source": (
            "OpenF1 position z, on the same measured unit as x and y; relative to "
            "the feed's own datum, not to sea level"
        ),
    }
