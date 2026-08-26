"""Fetch real session and season data. This is the only module in the
pipeline that touches the network — derive.py and export.py work purely
on what this module returns, so a season/session that hasn't been
ingested here simply doesn't exist for the rest of the pipeline.

Run from GitHub Actions (see .github/workflows/refresh-data.yml). It
cannot be exercised from a network-restricted dev sandbox; that's a
deployment fact, not a code path to special-case around.

Source availability, measured (see pipeline/diagnose_sources.py and the
"Data sources" section of the README):
  - Jolpica-F1 answers 200 for schedule, results, standings, laps and
    pit stops. It carries no telemetry and no tyre compounds.
  - livetiming.formula1.com, which FastF1 needs, answers CloudFront 403
    for every path from a datacenter IP — including its own root and a
    prior-season control, so this is a network-origin block, not
    anything about 2026. FastF1's own fallback mirror serves an SPA 404
    at every static path.
Everything FastF1-backed here is therefore written to degrade to an
empty state rather than to fail, and the lap-level functions below are
the telemetry-free path that actually returns data today.
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass

import requests

from common import CONFIG_DIR, FASTF1_CACHE_DIR, SEASON_YEAR

JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"
JOLPICA_RATE_LIMIT_S = 0.3  # be a polite client of a free, rate-limited API


JOLPICA_PAGE_LIMIT = 100  # the API's own maximum page size


JOLPICA_MAX_RETRIES = 6
JOLPICA_MAX_BACKOFF_S = 60.0


def _jolpica_get(path: str, params: dict | None = None) -> dict:
    """GET one Jolpica page, retrying through the API's rate limiting.

    Jolpica caps both burst and hourly request volume, and a full-season
    lap ingest sits close to that cap — several refreshes in one hour
    will cross it. A bare raise on 429 is what turned a rate limit into
    missing rounds and, worse, a standings table computed from a partial
    set of results, so back off and retry instead. Retry-After is
    honoured when present; otherwise the wait doubles per attempt.
    """
    url = f"{JOLPICA_BASE}/{path}.json"
    for attempt in range(JOLPICA_MAX_RETRIES):
        resp = requests.get(url, params=params or {}, timeout=30)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else 2.0 ** attempt
            except ValueError:
                wait = 2.0 ** attempt
            time.sleep(min(wait, JOLPICA_MAX_BACKOFF_S))
            continue
        resp.raise_for_status()
        time.sleep(JOLPICA_RATE_LIMIT_S)
        return resp.json()

    # Out of retries: raise, so the caller records a real failure rather
    # than proceeding on partial data.
    resp.raise_for_status()
    raise RuntimeError(f"Jolpica-F1 still rate-limiting after {JOLPICA_MAX_RETRIES} attempts: {url}")


def _jolpica_paged(path: str, extract):
    """Follow Jolpica's offset pagination to completion.

    A race's lap table is ~20 drivers x ~60 laps, well past the API's
    100-row page cap, so anything lap-level must page or it silently
    returns a truncated race. `extract` pulls the list of interest out of
    one page's MRData; total comes from MRData.total.
    """
    collected = []
    offset = 0
    while True:
        page = _jolpica_get(path, {"limit": JOLPICA_PAGE_LIMIT, "offset": offset})
        mrdata = page["MRData"]
        rows = extract(mrdata)
        collected.extend(rows)

        total = int(mrdata.get("total", 0))
        offset += JOLPICA_PAGE_LIMIT
        if offset >= total or not rows:
            return collected


def fetch_season_calendar(year: int = SEASON_YEAR) -> list[dict]:
    """Verified calendar for `year`, straight from Jolpica-F1 — never typed
    from memory (docs/SPEC.md ground rule 6)."""
    data = _jolpica_get(f"{year}")
    races = data["MRData"]["RaceTable"]["Races"]
    return [
        {
            "round": int(r["round"]),
            "raceName": r["raceName"],
            "circuitName": r["Circuit"]["circuitName"],
            "circuitId": r["Circuit"]["circuitId"],
            "date": r["date"],
            "sprint": "Sprint" in r,
        }
        for r in races
    ]


def fetch_entry_list(year: int = SEASON_YEAR) -> list[dict]:
    """Every driver entered this season — paginated.

    This read the endpoint unpaged and got exactly 30 rows back, which is
    the API's default page size, not the size of the field. The list is
    ordered by driverId, so the truncation silently dropped whoever
    sorted last — in 2026 that was Verstappen, who then had no published
    three-letter code anywhere in the site and fell back to a long name
    in columns of short codes.

    A cut-off list is worse than a failed fetch here: it looks complete.
    """

    def extract(mrdata):
        return mrdata["DriverTable"]["Drivers"]

    drivers = _jolpica_paged(f"{year}/drivers", extract)
    return [
        {
            "code": d.get("code"),
            "driverId": d["driverId"],
            "givenName": d["givenName"],
            "familyName": d["familyName"],
            "permanentNumber": d.get("permanentNumber"),
        }
        for d in drivers
    ]


def fetch_standings(year: int = SEASON_YEAR, round_: int | None = None) -> dict:
    path = f"{year}/{round_}/driverStandings" if round_ else f"{year}/driverStandings"
    data = _jolpica_get(path)
    lists = data["MRData"]["StandingsTable"]["StandingsLists"]
    if not lists:
        return {"standings": []}
    standings = lists[0]["DriverStandings"]
    return {
        "standings": [
            {
                "position": int(s["position"]),
                "points": float(s["points"]),
                "wins": int(s["wins"]),
                "driverCode": s["Driver"].get("code"),
                "driverName": f"{s['Driver']['givenName']} {s['Driver']['familyName']}",
                "team": s["Constructors"][0]["name"] if s.get("Constructors") else None,
            }
            for s in standings
        ]
    }


def fetch_race_results(year: int, round_: int) -> dict:
    data = _jolpica_get(f"{year}/{round_}/results")
    races = data["MRData"]["RaceTable"]["Races"]
    if not races:
        return {"results": []}
    results = races[0]["Results"]
    return {
        "results": [
            {
                "position": r.get("position"),
                "grid": int(r["grid"]),
                "driverCode": r["Driver"].get("code"),
                "driverName": f"{r['Driver']['givenName']} {r['Driver']['familyName']}",
                "team": r["Constructor"]["name"],
                "status": r["status"],
                "points": float(r["points"]),
                "laps": int(r["laps"]),
                "fastestLapRank": (r.get("FastestLap") or {}).get("rank"),
            }
            for r in results
        ]
    }


def fetch_sprint_results(year: int, round_: int) -> dict:
    """Sprint-session results for a sprint weekend. Returns empty results
    for a non-sprint round (the endpoint just has no races), so callers
    can gate on the calendar's `sprint` flag or on emptiness."""
    data = _jolpica_get(f"{year}/{round_}/sprint")
    races = data["MRData"]["RaceTable"]["Races"]
    if not races:
        return {"results": []}
    results = races[0]["SprintResults"]
    return {
        "results": [
            {
                "position": r.get("position"),
                "grid": int(r["grid"]),
                "driverCode": r["Driver"].get("code"),
                "driverName": f"{r['Driver']['givenName']} {r['Driver']['familyName']}",
                "team": r["Constructor"]["name"],
                "status": r["status"],
                "points": float(r["points"]),
                "laps": int(r["laps"]),
            }
            for r in results
        ]
    }


def _lap_time_to_seconds(text: str) -> float | None:
    """'1:32.264' -> 92.264. Returns None for anything unparseable rather
    than guessing, so a malformed row becomes a visible gap instead of a
    plausible wrong number."""
    if not isinstance(text, str):
        return None
    try:
        if ":" in text:
            minutes, seconds = text.split(":", 1)
            return int(minutes) * 60 + float(seconds)
        return float(text)
    except ValueError:
        return None


def fetch_laps(year: int, round_: int) -> list[dict]:
    """Every driver's every lap for one race, flattened and paginated.

    This is the telemetry-free backbone for stint and pace work: real
    lap times, but no tyre compound and no per-sample telemetry — those
    exist only behind the live-timing endpoint that blocks datacenter IPs.
    """

    def extract(mrdata):
        races = mrdata["RaceTable"]["Races"]
        return races[0]["Laps"] if races else []

    flattened = []
    for lap in _jolpica_paged(f"{year}/{round_}/laps", extract):
        lap_number = int(lap["number"])
        for timing in lap["Timings"]:
            flattened.append(
                {
                    "lap": lap_number,
                    "driverId": timing["driverId"],
                    "position": int(timing["position"]),
                    "timeS": _lap_time_to_seconds(timing["time"]),
                }
            )
    return flattened


def fetch_pitstops(year: int, round_: int) -> list[dict]:
    """Pit stops for one race. Stint boundaries are derived from these
    (pipeline/derive.build_stints) since no compound/stint feed exists on
    this source."""

    def extract(mrdata):
        races = mrdata["RaceTable"]["Races"]
        return races[0]["PitStops"] if races else []

    return [
        {
            "driverId": stop["driverId"],
            "lap": int(stop["lap"]),
            "stop": int(stop["stop"]),
            "durationS": _lap_time_to_seconds(stop.get("duration", "")),
        }
        for stop in _jolpica_paged(f"{year}/{round_}/pitstops", extract)
    ]


def fetch_qualifying(year: int, round_: int) -> list[dict]:
    """One round's qualifying result: position, and the Q1/Q2/Q3 times.

    Each row carries its constructor, so team-mate pairings come from the
    weekend itself rather than from a stored roster. A mid-season driver
    change then pairs the drivers who actually shared a car that weekend,
    which a season-long roster would get wrong for both of them.

    A session a driver did not set a time in is absent from the payload
    and stays absent here: knocked out in Q1 and no lap in Q2 are the
    same shape in a table of numbers and are not the same fact.
    """

    def extract(mrdata):
        races = mrdata["RaceTable"]["Races"]
        return races[0].get("QualifyingResults", []) if races else []

    rows = []
    for result in _jolpica_paged(f"{year}/{round_}/qualifying", extract):
        driver = result.get("Driver", {})
        constructor = result.get("Constructor", {})
        rows.append({
            "driverId": driver.get("driverId"),
            "code": driver.get("code"),
            "constructorId": constructor.get("constructorId"),
            "constructorName": constructor.get("name"),
            "position": int(result["position"]),
            "q1S": _lap_time_to_seconds(result.get("Q1", "")),
            "q2S": _lap_time_to_seconds(result.get("Q2", "")),
            "q3S": _lap_time_to_seconds(result.get("Q3", "")),
        })
    rows.sort(key=lambda r: r["position"])
    return rows


def fetch_circuit_history(circuit_id: str, years: list[int]) -> list[dict]:
    """Past editions of one circuit, for the Upcoming Race Brief's priors.

    Circuit-scoped results answer and carry the round each edition was,
    which matters because the circuit-scoped pitstops endpoint answers
    400 — stops are only reachable per round, and the round comes from
    this response. A year the circuit was not raced simply has no races
    and is skipped.

    positionText is carried through deliberately. The status vocabulary
    changes between seasons ("+1 Lap" in 2022, "Lapped" in 2025), so
    classification downstream keys off positionText, which stays a
    position number for a classified car and a letter code otherwise.

    An edition whose stops cannot be fetched gets `pitstops: None`, never
    an empty list: "the source did not answer" and "nobody stopped" are
    different facts and must not collapse into the same number.
    """
    editions = []
    for year in years:
        data = _jolpica_get(f"{year}/circuits/{circuit_id}/results", {"limit": JOLPICA_PAGE_LIMIT})
        races = data["MRData"]["RaceTable"]["Races"]
        if not races:
            continue
        race = races[0]
        round_ = int(race["round"])
        results = [
            {
                "position": int(r["position"]),
                "positionText": r.get("positionText"),
                "grid": int(r["grid"]),
                "driverCode": r["Driver"].get("code"),
                "driverName": f"{r['Driver']['givenName']} {r['Driver']['familyName']}",
                "status": r["status"],
                "laps": int(r["laps"]),
            }
            for r in race["Results"]
        ]

        try:
            pitstops = fetch_pitstops(year, round_)
        except Exception:  # noqa: BLE001 - a missing edition must not abort the brief
            pitstops = None

        editions.append({
            "year": year,
            "round": round_,
            "raceName": race["raceName"],
            "results": results,
            "pitstops": pitstops,
        })
    return editions


@dataclass
class SessionBundle:
    """Everything derive.py needs for one session, as returned by FastF1.
    Kept as a thin dataclass (not a dict) so downstream code fails fast on
    a missing field instead of silently reading None."""

    year: int
    round: int
    session_name: str
    session: object  # fastf1.core.Session — typed loosely to avoid a hard
    # import-time dependency on fastf1 for callers that only need the
    # Jolpica-derived functions above (e.g. unit tests).


def fetch_session(year: int, round_: int, session_name: str) -> SessionBundle:
    """Load one FastF1 session with position + car telemetry.

    `session_name` is one of FastF1's own identifiers: 'FP1', 'FP2', 'FP3',
    'Q', 'S' (sprint), 'R'. Sprint weekends have a different session set
    than standard weekends — call sites must check the calendar's
    `sprint` flag rather than assuming 'FP2'/'FP3' exist (docs/SPEC.md).
    """
    import fastf1

    FASTF1_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(FASTF1_CACHE_DIR))

    session = fastf1.get_session(year, round_, session_name)
    session.load(laps=True, telemetry=True, weather=True, messages=True)
    return SessionBundle(year=year, round=round_, session_name=session_name, session=session)


def write_season_config(year: int = SEASON_YEAR) -> None:
    """Verify the calendar + entry list against the API and write
    config/season_{year}.json. This is the one config file that is always
    regenerated from a live fetch, never hand-edited (docs/SPEC.md)."""
    calendar = fetch_season_calendar(year)
    entry_list = fetch_entry_list(year)
    out = {
        "year": year,
        "calendar": calendar,
        "entryList": entry_list,
        "generated_at": _now_iso(),
        "source": f"{JOLPICA_BASE}/{year}",
    }
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    (CONFIG_DIR / f"season_{year}.json").write_text(json.dumps(out, indent=2))


def _now_iso() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=SEASON_YEAR)
    parser.add_argument("--round", type=int, help="Round number; omit to only refresh season config")
    parser.add_argument("--session", type=str, help="FastF1 session identifier, e.g. Q, R, FP1")
    args = parser.parse_args()

    write_season_config(args.year)

    if args.round and args.session:
        bundle = fetch_session(args.year, args.round, args.session)
        print(
            f"Loaded {bundle.year} round {bundle.round} session {bundle.session_name}: "
            f"{len(bundle.session.laps)} laps"
        )


if __name__ == "__main__":
    main()
