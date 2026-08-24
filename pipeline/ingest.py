"""Fetch real session and season data. This is the only module in the
pipeline that touches the network — derive.py and export.py work purely
on what this module returns, so a season/session that hasn't been
ingested here simply doesn't exist for the rest of the pipeline.

Run from GitHub Actions (see .github/workflows/refresh-data.yml), where
Jolpica-F1 and FastF1's live-timing backend are both reachable. It cannot
be exercised from a network-restricted dev sandbox; that's a deployment
fact, not a code path to special-case around.
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


def _jolpica_get(path: str) -> dict:
    url = f"{JOLPICA_BASE}/{path}.json"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    time.sleep(JOLPICA_RATE_LIMIT_S)
    return resp.json()


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
    data = _jolpica_get(f"{year}/drivers")
    drivers = data["MRData"]["DriverTable"]["Drivers"]
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
