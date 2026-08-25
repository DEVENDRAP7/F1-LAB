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
import ingest_openf1
import derive
import derive_telemetry
import derive_errors
import export
from common import CONFIG_DIR, PUBLIC_DATA, SEASON_YEAR, SourcedValue


# Bumped whenever the shape or the model behind an exported laps.json
# changes. refresh_race_laps re-exports any round written under an older
# version: without this, the skip-if-exists check meant a corrected model
# silently never reached rounds that had already been exported (a fix to
# the fit-reliability rule left 97 stale fits labelled "reliable" on
# disk, because their rounds were simply skipped).
LAPS_SCHEMA_VERSION = 3


def load_points_system() -> dict:
    return json.loads((CONFIG_DIR / "points_system.json").read_text())


def rounds_due(calendar: list[dict]) -> list[dict]:
    today = datetime.date.today()
    return [r for r in calendar if datetime.date.fromisoformat(r["date"]) <= today]


# refresh_circuit is gone.
#
# It built the circuit atlas from FastF1's qualifying telemetry, and it
# never once succeeded: FastF1 depends on livetiming.formula1.com, which
# answers 403 to this network. Every refresh still paid for it — twelve
# rounds each retrying a blocked host before giving up, which was the
# bulk of a ~30-minute run that produced nothing from those minutes.
#
# refresh_telemetry now writes the same artifact from OpenF1 position
# data, which works. Keeping a second, permanently failing path to the
# same file would only cost time and invite the two to disagree.
#
# The one thing lost with it is pit_loss_s, which was derived from
# FastF1 lap data. It was never actually obtained either, so nothing
# regresses; whenever a real measurement is available it belongs in
# refresh_telemetry alongside the outline.


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
    undercuts = derive.build_undercut_ledger(laps, pitstops)

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
        "pitstops": pitstops,
        "undercuts": undercuts,
        "degradation": deg_fits,
        "generated_at": ingest._now_iso(),
        "source": f"Jolpica-F1 {year} round {round_} laps + pitstops",
        "limitations": [
            "No tyre compound: Jolpica-F1 publishes none, so stints are structural only.",
            "Degradation slopes are not fuel-corrected; within one stint fuel burn and "
            "tyre degradation are not separately identifiable from lap times.",
            "No track-status channel, so safety-car and traffic laps are excluded by an "
            "outlier rule rather than by flag.",
            "Undercut figures measure what happened to the gap, not what would have "
            "happened otherwise; a driver can gain on a rival for reasons unrelated to "
            "the stop. Entries whose window looks neutralised are flagged, not dropped.",
        ],
    }

    export.export_race_laps(year, round_, payload)
    print(f"[laps] round {round_}: exported {len(laps)} laps, {len(stints)} stints, "
          f"{len(deg_fits)} fits, {len(pitstops)} stops, {len(undercuts)} undercut pairs")


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
    per_round = []  # ordered, for the points-progression snapshots
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
        sessions = []
        if sprint_results["results"]:
            sessions.append({"session": "sprint", "results": sprint_results["results"]})
        if race_results["results"]:
            sessions.append({"session": "race", "results": race_results["results"]})
        results_by_round.extend(sessions)
        if sessions:
            per_round.append(
                {"round": round_info["round"], "raceName": round_info["raceName"], "sessions": sessions}
            )

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

    progression = derive.compute_points_progression(per_round, points_system)

    # The progression's final snapshot and the standings table come from
    # the same engine over the same sessions, so any disagreement means a
    # bug — fail the run (no commit happens) rather than publish two
    # tables that contradict each other.
    if progression:
        final = progression[-1]["points"]
        table = {row["driverCode"]: row["points"] for row in computed}
        if final != table:
            raise RuntimeError(
                "points progression's final snapshot disagrees with the standings table — "
                f"diff keys: {sorted(set(final) ^ set(table)) or 'values differ'}"
            )

    today = datetime.date.today()
    remaining = [r for r in calendar if datetime.date.fromisoformat(r["date"]) > today]
    elimination = derive.compute_elimination(computed, remaining, points_system)

    export.export_standings(computed, ingest._now_iso(), source_check,
                            progression=progression, elimination=elimination)
    eliminated = sum(1 for d in elimination["drivers"].values() if d["eliminated"])
    print(f"[standings] exported {len(computed)} drivers, mismatch={source_check['mismatch']}, "
          f"{len(progression)} progression rounds, {eliminated} mathematically out")


HISTORY_SEASONS = 4

# How many drivers get a racing line exported per round. The spec's
# Racing Lines module overlays up to 4 at once; exporting a few more than
# that gives the picker something to choose between without turning one
# round into a multi-megabyte download.
LINE_DRIVERS_PER_ROUND = 4

TELEMETRY_SCHEMA_VERSION = 1

# How many rounds may have their telemetry built in a single refresh.
#
# OpenF1 is free and rate-limited, and a full-season backfill is ~150
# windowed requests. Attempting all of it in one run means the run
# spends most of its time asleep in backoff and may not finish at all,
# which is the worst outcome: no round completes and the next run starts
# from the same place.
#
# Bounded instead. Each run exports a few rounds, the schema check skips
# rounds already done, so successive runs walk the backfill forward and
# every run finishes having actually banked something.
TELEMETRY_ROUNDS_PER_RUN = 4


def _match_openf1_session(round_info: dict, sessions: list[dict]) -> dict | None:
    """Pair a calendar round with its OpenF1 race session.

    Matched on date rather than name: the two sources spell events
    differently ("Belgian Grand Prix" against a country of "Belgium"),
    while the date of a race is the same fact in both. A day of slack
    absorbs the timezone difference between a local race date and a UTC
    session start.
    """
    target = datetime.date.fromisoformat(round_info["date"])
    for session in sessions:
        started = session.get("dateStart")
        if not started:
            continue
        try:
            session_date = datetime.datetime.fromisoformat(started).date()
        except ValueError:
            continue
        if abs((session_date - target).days) <= 1:
            return session
    return None


ERROR_REVIEW_SCHEMA_VERSION = 4


def refresh_error_review(year: int, round_info: dict, sessions: list[dict]) -> None:
    """Driver Error Review for one round.

    Deliberately separate from refresh_telemetry rather than riding along
    inside it. The first version did ride along, which meant a round that
    already had racing lines returned at the skip check before the review
    was ever written — so precisely the rounds furthest along were the
    ones guaranteed to have no review.

    It is also much cheaper than the line export (three requests, no
    per-driver position fetches), so it is not paced by the telemetry
    budget and can cover rounds the line backfill has not reached.
    """
    round_ = round_info["round"]
    out_path = PUBLIC_DATA / str(year) / str(round_) / "R" / "errors.json"
    if out_path.exists():
        try:
            stored = json.loads(out_path.read_text()).get("schemaVersion", 0)
        except (json.JSONDecodeError, OSError):
            stored = 0
        if stored == ERROR_REVIEW_SCHEMA_VERSION:
            return

    session = _match_openf1_session(round_info, sessions)
    if session is None:
        return
    session_key = session["sessionKey"]

    try:
        laps = ingest_openf1.fetch_laps(session_key)
        if not laps:
            print(f"[errors] round {round_}: no laps published")
            return
        drivers = ingest_openf1.fetch_drivers(session_key)
        race_control = ingest_openf1.fetch_race_control(session_key)
    except Exception as exc:  # noqa: BLE001 - additive, never fatal
        print(f"[errors] round {round_}: unavailable ({type(exc).__name__}: {exc})")
        return

    code_by_number = {d["driverNumber"]: (d.get("code") or str(d["driverNumber"]))
                      for d in drivers}
    review = derive_errors.build_error_review(laps, race_control, code_by_number)
    review.update({
        "schemaVersion": ERROR_REVIEW_SCHEMA_VERSION,
        "year": year,
        "round": round_,
        "raceName": round_info["raceName"],
        "generated_at": ingest._now_iso(),
        "source": f"OpenF1 session {session_key}: race control messages + lap times",
    })
    export.export_error_review(year, round_, review)

    recorded = sum(len(d["recorded"]) for d in review["drivers"].values())
    flagged = sum(len(d["flagged"]) for d in review["drivers"].values())
    print(f"[errors] round {round_}: {recorded} recorded event(s), {flagged} flagged lap(s), "
          f"{len(review['neutralisedLaps'])} neutralised lap(s)")


def refresh_telemetry(year: int, round_info: dict, sessions: list[dict]) -> bool:
    """Track geometry and racing lines for one round, from real position data.

    This is the module that was empty for the whole project so far. It was
    empty because livetiming.formula1.com 403s this network, which was
    then over-read as "position data is unobtainable" — it is not, and
    OpenF1 serves it.

    Degrades per round like every other step: a round whose telemetry is
    missing leaves the previous artifacts alone and says why.

    Returns whether this call consumed a slot of the run's telemetry
    budget — attempted work counts, a skip of an already-exported round
    does not, so the budget paces new work rather than being spent
    walking past rounds that are already done.
    """
    round_ = round_info["round"]
    circuit_key = round_info["circuitId"]
    out_dir = PUBLIC_DATA / str(year) / str(round_) / "R" / "lines"
    manifest = out_dir / "manifest.json"
    if manifest.exists():
        try:
            stored = json.loads(manifest.read_text()).get("schemaVersion", 0)
        except (json.JSONDecodeError, OSError):
            stored = 0
        if stored == TELEMETRY_SCHEMA_VERSION:
            print(f"[telemetry] round {round_}: already exported, skipping")
            return False

    session = _match_openf1_session(round_info, sessions)
    if session is None:
        print(f"[telemetry] round {round_}: no OpenF1 race session matches "
              f"{round_info['date']}")
        return False

    session_key = session["sessionKey"]
    try:
        laps = ingest_openf1.fetch_laps(session_key)
        drivers = ingest_openf1.fetch_drivers(session_key)
    except Exception as exc:  # noqa: BLE001 - one round must not abort the refresh
        print(f"[telemetry] round {round_}: unavailable ({type(exc).__name__}: {exc})")
        return True

    if not laps:
        print(f"[telemetry] round {round_}: OpenF1 has no laps for session {session_key}")
        return True

    code_by_number = {d["driverNumber"]: (d.get("code") or str(d["driverNumber"]))
                      for d in drivers}

    fastest = ingest_openf1.pick_fastest_laps(laps)
    ranked = sorted(fastest.items(), key=lambda kv: kv[1]["lapDurationS"])
    selected = ranked[:LINE_DRIVERS_PER_ROUND]

    scale: SourcedValue | None = None
    exported = []
    best_line = None

    for driver_number, lap in selected:
        code = code_by_number.get(driver_number, str(driver_number))
        try:
            location = ingest_openf1.fetch_lap_location(session_key, driver_number, lap)
            car_data = ingest_openf1.fetch_lap_car_data(session_key, driver_number, lap)
        except Exception as exc:  # noqa: BLE001 - degrade per driver, not per round
            print(f"[telemetry] round {round_} {code}: fetch failed "
                  f"({type(exc).__name__}: {exc})")
            continue

        aligned = derive_telemetry.align_to_location(location, car_data)
        if not aligned:
            print(f"[telemetry] round {round_} {code}: no position samples")
            continue

        # The unit is measured once per round, off the first lap that can
        # support the measurement, and then applied to every driver: it is
        # a property of the feed, not of a driver, and re-measuring it per
        # driver would let two lines end up on subtly different scales.
        if scale is None:
            scale = derive_telemetry.estimate_position_scale(aligned)
            if scale is None:
                print(f"[telemetry] round {round_} {code}: cannot measure the "
                      "position unit without speed; skipping this driver")
                continue
            print(f"[telemetry] round {round_}: position unit measured at "
                  f"{scale.value:.3f} raw units/m over {scale.sample_size} samples")

        line = derive_telemetry.build_racing_line(aligned, scale.value)
        if line is None:
            print(f"[telemetry] round {round_} {code}: lap capture too partial to publish")
            continue

        export.export_racing_line(year, round_, "R", code, line)
        exported.append({
            "code": code,
            "driverNumber": driver_number,
            "lapNumber": lap.get("lapNumber"),
            "lapTimeS": lap.get("lapDurationS"),
        })
        if best_line is None:
            best_line = line

    if not exported or best_line is None or scale is None:
        print(f"[telemetry] round {round_}: nothing publishable")
        return True

    export.annotate_line_manifest(year, round_, "R", {
        "schemaVersion": TELEMETRY_SCHEMA_VERSION,
        "source": f"OpenF1 session {session_key} ({session.get('countryName')})",
        "positionUnitsPerMetre": scale.to_json(),
        "laps": exported,
        "limitations": [
            "Each line is one driver's fastest non-out lap of the race, not an "
            "average or an ideal line.",
            "Position samples arrive at roughly 3.7 Hz and are resampled onto a "
            "fixed distance grid, so the line is interpolated between samples.",
            "Corner numbering is not published by this source, so the map carries "
            "the driven path and no official corner labels.",
        ],
    })

    export.export_circuit(circuit_key, {
        "circuitId": circuit_key,
        "circuitName": round_info["circuitName"],
        "round": round_,
        "outline": derive_telemetry.build_outline_from_line(best_line),
        "corners": [],
        "drsZones": [],
        "generated_at": ingest._now_iso(),
        "source": (
            f"OpenF1 position trace, session {session_key}, fastest race lap "
            f"({exported[0]['code']}, lap {exported[0]['lapNumber']})"
        ),
        "positionUnitsPerMetre": scale.to_json(),
        "limitations": [
            "The outline is one measured lap's driven path, so it follows the "
            "racing line rather than the centre line or the track edges.",
            "No corner numbering or DRS zones: this source publishes neither, and "
            "numbering them from memory would be invented detail.",
        ],
    })

    print(f"[telemetry] round {round_}: exported {len(exported)} racing line(s) "
          f"and a measured outline for {circuit_key}")
    return True


def refresh_upcoming(year: int, calendar: list[dict]) -> None:
    """Export the brief for the next round that has not happened yet.

    Degrades to a written-out reason rather than an absent file: once the
    season is over there is no next round, and the page should say so
    instead of showing a stale brief for a race already run.
    """
    today = datetime.date.today()
    upcoming = [r for r in calendar if datetime.date.fromisoformat(r["date"]) > today]
    if not upcoming:
        export.export_upcoming({
            "generated_at": ingest._now_iso(),
            "next": None,
            "reason": "Every round on the published calendar has been run.",
        })
        print("upcoming: no rounds remain on the calendar")
        return

    next_round = min(upcoming, key=lambda r: r["date"])
    years = [year - n for n in range(1, HISTORY_SEASONS + 1)]

    try:
        editions = ingest.fetch_circuit_history(next_round["circuitId"], years)
    except Exception as exc:  # noqa: BLE001
        # A brief is a nice-to-have; it must never take the refresh down
        # with it, and an empty brief that says why beats a missing file.
        print(f"upcoming: circuit history unavailable ({exc})")
        export.export_upcoming({
            "generated_at": ingest._now_iso(),
            "next": next_round,
            "history": None,
            "reason": f"Past editions could not be fetched: {exc}",
        })
        return

    history = derive.summarise_circuit_history(editions)
    export.export_upcoming({
        "generated_at": ingest._now_iso(),
        "next": next_round,
        "historyYearsRequested": years,
        "history": history,
    })
    print(f"upcoming: R{next_round['round']} {next_round['raceName']} "
          f"from {history['editions']} past edition(s)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=SEASON_YEAR)
    args = parser.parse_args()

    ingest.write_season_config(args.year)
    season_config = json.loads((CONFIG_DIR / f"season_{args.year}.json").read_text())
    export.export_season(season_config)

    # Fetched once and shared across rounds: the season's race sessions
    # are one listing, and re-requesting it per round would be 23 calls
    # for one answer.
    try:
        openf1_sessions = ingest_openf1.fetch_race_sessions(args.year)
        print(f"OpenF1: {len(openf1_sessions)} race session(s) run so far")
    except Exception as exc:  # noqa: BLE001 - telemetry is additive, never fatal
        print(f"OpenF1 unavailable, skipping telemetry this run ({exc})")
        openf1_sessions = []

    telemetry_budget = TELEMETRY_ROUNDS_PER_RUN
    # Newest first: the most recent race is the one a reader is most
    # likely to want, so a partial backfill should be useful rather than
    # merely early.
    for round_info in reversed(rounds_due(season_config["calendar"])):
        refresh_race_laps(args.year, round_info)
        if openf1_sessions:
            refresh_error_review(args.year, round_info, openf1_sessions)
        if openf1_sessions and telemetry_budget > 0:
            if refresh_telemetry(args.year, round_info, openf1_sessions):
                telemetry_budget -= 1

    refresh_standings(args.year, season_config["calendar"])
    refresh_upcoming(args.year, season_config["calendar"])

    return 0


if __name__ == "__main__":
    sys.exit(main())
