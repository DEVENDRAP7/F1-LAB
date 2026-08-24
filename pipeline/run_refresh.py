"""Orchestrates one full data refresh: verify the season config, then for
every round whose sessions have already happened, ingest what's needed,
derive circuit/racing-line/standings artifacts, and export them.

This is the entry point `.github/workflows/refresh-data.yml` runs. It is
idempotent (`--year --round --session` targeting lives in the individual
pipeline modules; this script just decides which rounds are due) and
degrades per-round rather than aborting the whole refresh when one
session's data is partial or unavailable, per docs/SPEC.md's "degrade
per-driver, not per-page" rule extended to rounds.

The one exception is standings, which are all-or-nothing — see
refresh_standings for why a partial recomputation is worse than none.
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


# Bumped whenever the shape or the model behind an exported laps.json
# changes. refresh_race_laps re-exports any round written under an older
# version: without this, the skip-if-exists check meant a corrected model
# silently never reached rounds that had already been exported (a fix to
# the fit-reliability rule left 97 stale fits labelled "reliable" on
# disk, because their rounds were simply skipped).
LAPS_SCHEMA_VERSION = 2


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

    # The whole per-round derivation sits inside one boundary: FastF1
    # reports live-timing fetch failures as warnings and session.load()
    # returns anyway, so the first exception often surfaces later, at
    # session.laps or inside a derive step — not in fetch_session itself.
    # (First real run failed exactly this way: every live-timing endpoint
    # failed, load() returned, and .laps raised DataNotLoadedError past
    # the old, narrower try block, killing the refresh for every round.)
    try:
        bundle = ingest.fetch_session(year, round_info["round"], "Q")
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
    except Exception as exc:  # noqa: BLE001 - a single round's failure must not abort the refresh
        print(f"[circuit] {circuit_key}: unavailable ({type(exc).__name__}: {exc})")
        return

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


def refresh_race_laps(year: int, round_info: dict) -> None:
    """Lap times, pit-stop-derived stints and per-stint degradation fits
    for one completed race, all from Jolpica-F1.

    This is the telemetry-free path (see ingest.py's module docstring):
    it produces real pace and strategy structure, but no tyre compounds
    and no position/telemetry channels, and the exported payload says so
    explicitly rather than leaving the frontend to assume.
    """
    round_ = round_info["round"]
    out_path = PUBLIC_DATA / str(year) / str(round_) / "R" / "laps.json"
    if out_path.exists():
        try:
            existing_version = json.loads(out_path.read_text()).get("schemaVersion", 0)
        except (json.JSONDecodeError, OSError):
            existing_version = 0  # unreadable: treat as stale and rebuild
        if existing_version == LAPS_SCHEMA_VERSION:
            print(f"[laps] round {round_}: already exported at v{existing_version}, skipping")
            return
        print(f"[laps] round {round_}: re-exporting (v{existing_version} -> v{LAPS_SCHEMA_VERSION})")

    try:
        laps = ingest.fetch_laps(year, round_)
        if not laps:
            print(f"[laps] round {round_}: no lap data published")
            return
        pitstops = ingest.fetch_pitstops(year, round_)
    except Exception as exc:  # noqa: BLE001 - one round must not abort the refresh
        print(f"[laps] round {round_}: unavailable ({type(exc).__name__}: {exc})")
        return

    total_laps = max(lap["lap"] for lap in laps)
    stints = derive.build_stints(laps, pitstops, total_laps)

    deg_fits = []
    for stint in stints:
        fit = derive.fit_stint_degradation(stint)
        if fit is not None:
            deg_fits.append(fit)

    payload = {
        "schemaVersion": LAPS_SCHEMA_VERSION,
        "year": year,
        "round": round_,
        "raceName": round_info["raceName"],
        "totalLaps": total_laps,
        "laps": laps,
        # lapTimesS is dropped from the exported stints: it duplicates the
        # laps array above and would roughly double the payload for
        # nothing the frontend cannot recompute.
        "stints": [{k: v for k, v in s.items() if k != "lapTimesS"} for s in stints],
        "degradation": deg_fits,
        "generated_at": ingest._now_iso(),
        "source": f"Jolpica-F1 {year} round {round_} laps + pitstops",
        "limitations": [
            "No tyre compound: Jolpica-F1 publishes none, so stints are structural only.",
            "Degradation slopes are not fuel-corrected; within one stint fuel burn and "
            "tyre degradation are not separately identifiable from lap times.",
            "No track-status channel, so safety-car and traffic laps are excluded by an "
            "outlier rule rather than by flag.",
        ],
    }

    export.export_race_laps(year, round_, payload)
    print(f"[laps] round {round_}: exported {len(laps)} laps, {len(stints)} stints, "
          f"{len(deg_fits)} fits")


def refresh_standings(year: int, calendar: list[dict]) -> None:
    """Recompute the championship table from every completed round.

    Standings are all-or-nothing: the table is a running total, so a
    round that fails to fetch does not degrade the result, it falsifies
    it. A rate-limited run once produced a table computed from a subset
    of rounds — internally consistent, plausible-looking, and wrong by
    more than 150 points — which then shipped. So any per-round failure
    now aborts the export and leaves the previous good artifact in
    place, rather than overwriting it with a partial recomputation.
    """
    points_system = load_points_system()
    results_by_round = []
    failed_rounds = []

    for round_info in rounds_due(calendar):
        try:
            race_results = ingest.fetch_race_results(year, round_info["round"])
            sprint_results = (
                ingest.fetch_sprint_results(year, round_info["round"])
                if round_info.get("sprint")
                else {"results": []}
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[standings] round {round_info['round']}: could not fetch results ({exc})")
            failed_rounds.append(round_info["round"])
            continue
        if sprint_results["results"]:
            results_by_round.append({"session": "sprint", "results": sprint_results["results"]})
        if race_results["results"]:
            results_by_round.append({"session": "race", "results": race_results["results"]})

    if failed_rounds:
        print(
            f"[standings] ABORTED: {len(failed_rounds)} round(s) could not be fetched "
            f"({failed_rounds}). A championship table built from a subset of rounds would be "
            "wrong, not merely incomplete — keeping the existing standings.json untouched."
        )
        return

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
        refresh_race_laps(args.year, round_info)

    refresh_standings(args.year, season_config["calendar"])

    return 0


if __name__ == "__main__":
    sys.exit(main())
