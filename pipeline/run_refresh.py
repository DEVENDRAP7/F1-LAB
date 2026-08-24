"""Orchestrates one full data refresh: verify the season config, then for
every round whose sessions have already happened, ingest what's needed,
derive circuit/racing-line/standings artifacts, and export them.

This is the entry point `.github/workflows/refresh-data.yml` runs. It is
idempotent (`--year --round --session` targeting lives in the individual
pipeline modules; this script just decides which rounds are due) and
degrades per-round rather than aborting the whole refresh when one
session's data is partial or unavailable, per docs/SPEC.md's "degrade
per-driver, not per-page" rule extended to rounds.
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys

import ingest
import derive
import export
from common import CONFIG_DIR, PUBLIC_DATA, SEASON_YEAR


def load_points_system() -> dict:
    return json.loads((CONFIG_DIR / "points_system.json").read_text())


def rounds_due(calendar: list[dict]) -> list[dict]:
    today = datetime.date.today()
    return [r for r in calendar if datetime.date.fromisoformat(r["date"]) <= today]


def refresh_circuit(year: int, round_info: dict) -> None:
    """Build the circuit atlas from qualifying's fastest lap. Skips
    quietly (with a printed reason) if this round's circuit already has
    an exported artifact, or if the session can't be loaded — a missing
    circuit is a per-round gap, not a reason to fail the whole refresh.
    """
    circuit_key = round_info["circuitId"]
    existing = PUBLIC_DATA / "circuits" / f"{circuit_key}.json"
    if existing.exists():
        print(f"[circuit] {circuit_key}: already exported, skipping")
        return

    try:
        bundle = ingest.fetch_session(year, round_info["round"], "Q")
    except Exception as exc:  # noqa: BLE001 - a single round's ingest failure must not abort the refresh
        print(f"[circuit] {circuit_key}: could not load qualifying session ({exc})")
        return

    session = bundle.session
    fastest = session.laps.pick_accurate().pick_fastest()
    if fastest is None:
        print(f"[circuit] {circuit_key}: no accurate fastest lap available")
        return

    circuit_info = session.get_circuit_info()
    rotation = circuit_info.rotation

    outline = derive.build_circuit_outline(fastest, rotation)
    corners = derive.extract_corners(circuit_info, fastest, rotation)
    drs_zones = derive.extract_drs_zones(fastest)
    pit_loss = derive.compute_pit_loss(session.laps)

    circuit_doc = {
        "circuitId": circuit_key,
        "circuitName": round_info["circuitName"],
        "round": round_info["round"],
        "outline": outline,
        "corners": corners,
        "drsZones": drs_zones,
        "pitLossS": pit_loss.to_json(),
        "generated_at": ingest._now_iso(),
        "source": f"FastF1 {year} round {round_info['round']} qualifying, fastest accurate lap",
    }
    export.export_circuit(circuit_key, circuit_doc)
    print(f"[circuit] {circuit_key}: exported ({len(corners)} corners)")


def refresh_standings(year: int, calendar: list[dict]) -> None:
    points_system = load_points_system()
    results_by_round = []

    for round_info in rounds_due(calendar):
        try:
            race_results = ingest.fetch_race_results(year, round_info["round"])
        except Exception as exc:  # noqa: BLE001
            print(f"[standings] round {round_info['round']}: could not fetch results ({exc})")
            continue
        if race_results["results"]:
            results_by_round.append({"session": "race", "results": race_results["results"]})

    if not results_by_round:
        print("[standings] no completed rounds yet — nothing to compute")
        return

    computed = derive.compute_standings_from_results(results_by_round, points_system)

    try:
        api_standings = ingest.fetch_standings(year)["standings"]
    except Exception as exc:  # noqa: BLE001
        print(f"[standings] could not fetch API standings for cross-check ({exc})")
        api_standings = []

    source_check = derive.cross_check_standings(computed, api_standings) if api_standings else {
        "mismatch": False,
        "details": [],
        "note": "API standings unavailable this run — cross-check skipped, not passed",
    }

    export.export_standings(computed, ingest._now_iso(), source_check)
    print(f"[standings] exported {len(computed)} drivers, mismatch={source_check['mismatch']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=SEASON_YEAR)
    args = parser.parse_args()

    ingest.write_season_config(args.year)
    season_config = json.loads((CONFIG_DIR / f"season_{args.year}.json").read_text())
    export.export_season(season_config)

    for round_info in rounds_due(season_config["calendar"]):
        refresh_circuit(args.year, round_info)

    refresh_standings(args.year, season_config["calendar"])

    return 0


if __name__ == "__main__":
    sys.exit(main())
