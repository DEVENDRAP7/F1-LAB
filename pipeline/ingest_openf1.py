"""OpenF1 ingest — the telemetry channels livetiming.formula1.com refuses.

Why this module exists
----------------------
The project's first diagnostic established that livetiming.formula1.com
answers HTTP 403 to every request from a datacenter IP, including its own
root and a prior-season control. That finding was correct, but the
conclusion drawn from it was too strong: it says one *host* refuses this
network, not that car position and telemetry are unobtainable. Four
modules sat on permanent empty states on the back of that overreach.

A probe (pipeline/diagnose_sources.py --openf1) measured the difference.
OpenF1 answers 200 from the same runners and carries, for the current
season, the exact channels that were missing:

    location      x / y / z position, ~3.7 Hz  (track map, racing lines)
    car_data      speed, throttle, brake, n_gear, drs, rpm
    stints        compound and tyre age        (real compounds at last)
    race_control  flags AND a SafetyCar category (real track status)
    intervals     gap_to_leader and interval
    laps          per-sector durations and speed-trap figures

Fetch discipline
----------------
`location` returns ~42,000 rows for one driver across one race. Pulling
that per driver per round would be both a large payload and a rude way to
treat a free API, and almost all of it is not wanted: a racing line is
ONE lap. So every heavy fetch here is windowed to a single lap's time
range, derived from that lap's own `date_start` and `lap_duration`, which
turns ~42,000 rows into a few hundred.

Nothing in this module derives or models anything — it fetches and
normalises, and derive.py does the rest.
"""
from __future__ import annotations

import datetime
import time

import requests
from urllib.parse import urlencode

OPENF1_BASE = "https://api.openf1.org/v1"

# A free, community-run API. Be a polite client: a small gap between
# calls, and back off rather than hammer when it pushes back.
RATE_LIMIT_S = 0.4
MAX_RETRIES = 5
MAX_BACKOFF_S = 30.0
TIMEOUT_S = 60

# Padding around a lap's [start, start + duration] window. Position and
# car telemetry are sampled on their own clocks, not the timing system's,
# so the first and last samples of a lap can fall a beat outside the
# timing window. Without the pad a lap loses its start/finish line
# samples and the line renders with a visible gap at the most important
# point on the track.
LAP_WINDOW_PAD_S = 1.5


def _range_filter(field: str, op: str, value: str) -> str:
    """Build one of OpenF1's comparison filters as a raw query fragment.

    These cannot go through requests' `params`. OpenF1 spells a range
    filter `date>2026-08-23T13:00:00`, with the operator as a literal
    character in the query string, and percent-encoding it to `date%3E=`
    stops it matching — the API then ignores the filter and returns the
    whole session. That failure is silent and expensive in exactly the
    wrong way: the request still answers 200 with plausible rows, so a
    "one lap" fetch quietly becomes a whole race, and the racing line
    derived from it would be the entire race's path rather than a lap.

    The timestamp is normalised to naive UTC for the same reason: a
    '+00:00' offset encodes to '%2B00:00' and breaks the comparison.
    """
    stamp = value.replace("+00:00", "").replace("Z", "")
    return f"{field}{op}{stamp}"


def _get(path: str, params: dict, raw_filters: list[str] | None = None) -> list[dict]:
    """One OpenF1 GET, retrying through rate limiting.

    A 404 here means "no rows matched", not "endpoint missing" — OpenF1
    answers 404 with {"detail": "No results found."} for an empty result
    set. That is a legitimate answer (a session that has not run yet, a
    driver who set no laps), so it returns empty rather than raising:
    the caller decides whether emptiness is a problem.
    """
    url = f"{OPENF1_BASE}/{path}"
    if raw_filters:
        encoded = urlencode(params)
        url = f"{url}?{encoded}&{'&'.join(raw_filters)}" if encoded else \
              f"{url}?{'&'.join(raw_filters)}"
        params = None

    for attempt in range(MAX_RETRIES):
        resp = requests.get(url, params=params, timeout=TIMEOUT_S)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else 2.0 ** attempt
            except ValueError:
                wait = 2.0 ** attempt
            time.sleep(min(wait, MAX_BACKOFF_S))
            continue
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        time.sleep(RATE_LIMIT_S)
        return resp.json()
    resp.raise_for_status()
    raise RuntimeError(f"OpenF1 still rate-limiting after {MAX_RETRIES} attempts: {url}")


def _parse_iso(raw: str | None) -> datetime.datetime | None:
    if not raw:
        return None
    try:
        return datetime.datetime.fromisoformat(raw)
    except ValueError:
        return None


def fetch_race_sessions(year: int) -> list[dict]:
    """Race sessions for a season that have actually been run.

    Future sessions are filtered out here rather than left to callers.
    They are listed months ahead and their entry list even answers 200,
    while every per-car channel answers "no results" — which reads as an
    outage if you do not know the race simply has not happened. (That
    exact confusion cost a probe run and nearly a wrong conclusion about
    the whole source.)
    """
    sessions = _get("sessions", {"year": year, "session_name": "Race"})
    now = datetime.datetime.now(datetime.timezone.utc)
    run = []
    for session in sessions:
        started = _parse_iso(session.get("date_start"))
        if started is None or started >= now:
            continue
        run.append({
            "sessionKey": session["session_key"],
            "meetingKey": session.get("meeting_key"),
            "countryName": session.get("country_name"),
            "location": session.get("location"),
            "circuitKey": session.get("circuit_key"),
            "circuitShortName": session.get("circuit_short_name"),
            "dateStart": session.get("date_start"),
            "year": session.get("year"),
        })
    run.sort(key=lambda s: s["dateStart"])
    return run


def fetch_drivers(session_key: int) -> list[dict]:
    rows = _get("drivers", {"session_key": session_key})
    return [
        {
            "driverNumber": r["driver_number"],
            "code": r.get("name_acronym"),
            "fullName": r.get("full_name"),
            "team": r.get("team_name"),
        }
        for r in rows
    ]


def fetch_laps(session_key: int) -> list[dict]:
    rows = _get("laps", {"session_key": session_key})
    return [
        {
            "driverNumber": r["driver_number"],
            "lapNumber": r.get("lap_number"),
            "lapDurationS": r.get("lap_duration"),
            "dateStart": r.get("date_start"),
            "isPitOutLap": bool(r.get("is_pit_out_lap")),
            "sector1S": r.get("duration_sector_1"),
            "sector2S": r.get("duration_sector_2"),
            "sector3S": r.get("duration_sector_3"),
            "speedTrapKph": r.get("st_speed"),
        }
        for r in rows
    ]


def fetch_stints(session_key: int) -> list[dict]:
    """Stints WITH compound — the field the Jolpica-derived strategy board
    has had to leave null on every stint it has ever published."""
    rows = _get("stints", {"session_key": session_key})
    return [
        {
            "driverNumber": r["driver_number"],
            "stintNumber": r.get("stint_number"),
            "lapStart": r.get("lap_start"),
            "lapEnd": r.get("lap_end"),
            "compound": r.get("compound"),
            "tyreAgeAtStart": r.get("tyre_age_at_start"),
        }
        for r in rows
    ]


def fetch_race_control(session_key: int) -> list[dict]:
    """Flags, safety cars and session status — the track-status channel
    whose absence forced every neutralised lap so far to be guessed at by
    an outlier rule instead of read off a flag."""
    rows = _get("race_control", {"session_key": session_key})
    return [
        {
            "date": r.get("date"),
            "category": r.get("category"),
            "flag": r.get("flag"),
            "scope": r.get("scope"),
            "lapNumber": r.get("lap_number"),
            "sector": r.get("sector"),
            "message": r.get("message"),
            "driverNumber": r.get("driver_number"),
        }
        for r in rows
    ]


def pick_fastest_laps(laps: list[dict]) -> dict[int, dict]:
    """The fastest timed lap per driver, as the basis for a racing line.

    Out-laps are excluded: a lap leaving the pits is not a representative
    line, and including one would put a pit-lane excursion in the middle
    of a track map. Laps with no recorded duration or no start timestamp
    are unusable here — the timestamp is what makes the windowed position
    fetch possible at all.
    """
    best: dict[int, dict] = {}
    for lap in laps:
        if lap["isPitOutLap"]:
            continue
        duration = lap.get("lapDurationS")
        if not duration or not lap.get("dateStart"):
            continue
        number = lap["driverNumber"]
        if number not in best or duration < best[number]["lapDurationS"]:
            best[number] = lap
    return best


def _lap_window(lap: dict) -> tuple[str, str] | None:
    start = _parse_iso(lap.get("dateStart"))
    duration = lap.get("lapDurationS")
    if start is None or not duration:
        return None
    begin = start - datetime.timedelta(seconds=LAP_WINDOW_PAD_S)
    end = start + datetime.timedelta(seconds=float(duration) + LAP_WINDOW_PAD_S)
    return begin.isoformat(), end.isoformat()


def fetch_lap_location(session_key: int, driver_number: int, lap: dict) -> list[dict]:
    """Position samples for exactly one lap.

    Windowed deliberately: unwindowed, this endpoint returns ~42,000 rows
    for one driver across one race, and a racing line needs one lap of
    them.
    """
    window = _lap_window(lap)
    if window is None:
        return []
    begin, end = window
    rows = _get(
        "location",
        {"session_key": session_key, "driver_number": driver_number},
        [_range_filter("date", ">", begin), _range_filter("date", "<", end)],
    )
    out = []
    for r in rows:
        if r.get("x") is None or r.get("y") is None:
            continue
        out.append({
            "date": r.get("date"),
            "x": r["x"],
            "y": r["y"],
            "z": r.get("z"),
        })
    out.sort(key=lambda r: r["date"] or "")
    _assert_window_honoured(out, lap, "location")
    return out


def _assert_window_honoured(rows: list[dict], lap: dict, channel: str) -> None:
    """Fail loudly if the API returned far more than the lap asked for.

    The range filter is a query-string convention, not a typed parameter:
    if its spelling ever stops matching, OpenF1 does not error, it just
    ignores the filter and returns the whole session with a 200. The
    result still parses, still looks like telemetry, and would quietly
    turn a one-lap racing line into the entire race's path.

    Comparing the span of what came back against the lap that was
    requested turns that silent corruption into a visible failure.
    """
    duration = lap.get("lapDurationS")
    if not rows or not duration:
        return
    first = _parse_iso(rows[0].get("date"))
    last = _parse_iso(rows[-1].get("date"))
    if first is None or last is None:
        return
    span = (last - first).total_seconds()
    allowed = float(duration) + 4 * LAP_WINDOW_PAD_S
    if span > allowed * 2:
        raise RuntimeError(
            f"OpenF1 {channel} ignored the lap window: asked for ~{duration:.1f}s "
            f"and got {span:.1f}s of samples. The range filter is not matching — "
            "check that the operator is a literal '>' and not percent-encoded."
        )


def fetch_lap_car_data(session_key: int, driver_number: int, lap: dict) -> list[dict]:
    window = _lap_window(lap)
    if window is None:
        return []
    begin, end = window
    rows = _get(
        "car_data",
        {"session_key": session_key, "driver_number": driver_number},
        [_range_filter("date", ">", begin), _range_filter("date", "<", end)],
    )
    out = [
        {
            "date": r.get("date"),
            "speedKph": r.get("speed"),
            "throttle": r.get("throttle"),
            "brake": r.get("brake"),
            "gear": r.get("n_gear"),
            "drs": r.get("drs"),
            "rpm": r.get("rpm"),
        }
        for r in rows
    ]
    out.sort(key=lambda r: r["date"] or "")
    _assert_window_honoured(out, lap, "car_data")
    return out
