"""Race-day conditions, from two sources that do not know about each other.

Every degradation slope, every stint fit and every corner speed on this
site was published without any statement of the conditions it was
measured in. A tyre at 20C and the same tyre at 50C are different tyres,
and the site has been silent about which one it was describing.

TWO SOURCES, ON PURPOSE

OpenF1 publishes a weather channel measured at the circuit, roughly once
a minute: air temperature, track temperature, humidity, pressure, wind,
and a rainfall flag. Open-Meteo publishes an hourly reanalysis of the
same hours at the same coordinates, from a different chain of
instruments and models, and knows nothing about motor racing.

Only one number can be compared — air temperature — because it is the
only quantity both actually measure. That comparison is the point of
this module. Track temperature has no second source anywhere and is
published on OpenF1's word alone, which is stated rather than hidden.

WHAT DISAGREEMENT MEANS

A trackside sensor and a reanalysis grid cell will never match exactly:
one is a thermometer beside a pit wall, the other is an average over a
cell kilometres across. A degree or two apart is two instruments
agreeing. Ten degrees apart is not a weather fact, it is a wrong session,
a wrong circuit, or a wrong day — the class of error that has hit this
project before, when a manifest and its binaries drifted apart while
every test passed.

So the tolerance here is wide enough to be uninteresting when things are
right and to fire loudly when a session has been matched to the wrong
place.
"""
from __future__ import annotations

# How far apart the two sources may be on air temperature before the
# session's conditions are withheld. Wide on purpose: this is a
# wrong-session detector, not a calibration check between a thermometer
# and a reanalysis grid cell.
MAX_AIR_TEMP_DISAGREEMENT_C = 8.0

# A session with fewer trackside samples than this is not a description
# of the session's conditions, it is a couple of readings.
MIN_TRACKSIDE_SAMPLES = 10


def _median(values: list[float]):
    ordered = sorted(v for v in values if v is not None)
    if not ordered:
        return None
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def _span(values: list[float]):
    present = [v for v in values if v is not None]
    if not present:
        return None
    return {"minC": min(present), "maxC": max(present)}


def summarise_trackside(rows: list[dict]) -> dict:
    """What the circuit's own sensors said over a session."""
    air = [r.get("airTemperatureC") for r in rows]
    track = [r.get("trackTemperatureC") for r in rows]
    # rainfall is published as a flag rather than a depth, so the honest
    # summary is how much of the session carried it, not how much fell.
    flags = [r.get("rainfall") for r in rows if r.get("rainfall") is not None]
    wet = sum(1 for f in flags if f)
    return {
        "samples": len(rows),
        "airTemperatureC": _median(air),
        "airRange": _span(air),
        "trackTemperatureC": _median(track),
        "trackRange": _span(track),
        "humidityPct": _median([r.get("humidityPct") for r in rows]),
        "windSpeedMs": _median([r.get("windSpeedMs") for r in rows]),
        "rainfallSamples": wet,
        "rainfallShare": (wet / len(flags)) if flags else None,
    }


def hours_within(archive: dict, start_iso: str | None, end_iso: str | None) -> list[dict]:
    """The reanalysis hours overlapping a session's own window.

    An hour is kept when its timestamp falls inside the window, or when
    the window falls inside the hour — a qualifying hour that begins at
    14:05 and ends at 15:03 must not come back empty because neither
    published hour started inside it.
    """
    hours = archive.get("hours") or []
    if not start_iso or not end_iso:
        return []
    start = start_iso[:13]
    end = end_iso[:13]
    return [h for h in hours if h.get("time") and start <= h["time"][:13] <= end] \
        or [h for h in hours if h.get("time") and h["time"][:13] == start]


def summarise_archive(hours: list[dict]) -> dict:
    return {
        "hours": len(hours),
        "airTemperatureC": _median([h.get("airTemperatureC") for h in hours]),
        "humidityPct": _median([h.get("humidityPct") for h in hours]),
        "windSpeedMs": _median([h.get("windSpeedMs") for h in hours]),
        "precipitationMm": sum(
            h["precipitationMm"] for h in hours if h.get("precipitationMm") is not None
        ) if hours else None,
    }


def cross_check(trackside: dict, archive: dict,
                tolerance_c: float = MAX_AIR_TEMP_DISAGREEMENT_C) -> dict:
    """The one number both sources measure, compared."""
    a = trackside.get("airTemperatureC")
    b = archive.get("airTemperatureC")
    if a is None or b is None:
        return {
            "compared": False,
            "reason": (
                "only one of the two sources reported an air temperature for this "
                "session, so there is nothing to check it against"
            ),
        }
    delta = abs(a - b)
    return {
        "compared": True,
        "tracksideC": a,
        "archiveC": b,
        "deltaC": delta,
        "toleranceC": tolerance_c,
        "agrees": delta <= tolerance_c,
    }


def assess(trackside_rows: list[dict], archive_hours: list[dict],
           min_samples: int = MIN_TRACKSIDE_SAMPLES,
           tolerance_c: float = MAX_AIR_TEMP_DISAGREEMENT_C) -> dict:
    """One session's conditions, or the reason there are none."""
    if len(trackside_rows) < min_samples:
        return {
            "published": False,
            "withheldReason": (
                f"the trackside feed carried {len(trackside_rows)} reading(s) for this "
                f"session, below the {min_samples} this project treats as a description "
                "of the conditions rather than a couple of samples"
            ),
        }

    trackside = summarise_trackside(trackside_rows)
    archive = summarise_archive(archive_hours)
    check = cross_check(trackside, archive, tolerance_c)

    if check["compared"] and not check["agrees"]:
        return {
            "published": False,
            "trackside": trackside,
            "archive": archive,
            "crossCheck": check,
            "withheldReason": (
                f"the circuit's own sensors say {check['tracksideC']:.1f}C and the "
                f"independent reanalysis says {check['archiveC']:.1f}C, "
                f"{check['deltaC']:.1f}C apart. Two instruments disagreeing by more "
                f"than {tolerance_c:.0f}C is not a weather fact — it means this session "
                "has been matched to the wrong place or the wrong day"
            ),
        }

    return {
        "published": True,
        "trackside": trackside,
        "archive": archive,
        "crossCheck": check,
    }


LIMITATIONS = [
    "Track temperature has one source and no second opinion. No "
    "reanalysis product publishes the temperature of a specific piece of "
    "tarmac, so it is carried on the trackside feed's word alone while "
    "air temperature is checked against an independent measurement.",
    "Rainfall from the trackside feed is a flag rather than a depth, so "
    "it is reported as the share of a session's readings that carried "
    "it. A session that was 20% wet is not a session in which 20% of the "
    "rain fell.",
    "The reanalysis is hourly and its grid cell is kilometres across, "
    "while the trackside sensor is one instrument beside the circuit. "
    "They are compared to catch a session matched to the wrong place, "
    "not to calibrate one against the other.",
    "The conditions are a median across a whole session. A race that "
    "started dry and finished wet has a median that describes neither "
    "half, which is why the range is published beside it.",
    "Nothing here is joined to the degradation fits or the corner "
    "speeds. The conditions are stated so a reader can see what a figure "
    "was measured in; no figure on this site is corrected for them.",
]


def build(year: int, rounds: list[dict], generated_at: str, source: str) -> dict:
    published = sum(
        1 for r in rounds for s in r["sessions"] if s["conditions"]["published"]
    )
    total = sum(len(r["sessions"]) for r in rounds)
    return {
        "year": year,
        "generated_at": generated_at,
        "source": source,
        "rounds": rounds,
        "publishedCount": published,
        "withheldCount": total - published,
        "limitations": LIMITATIONS,
    }
