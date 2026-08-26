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
import derive_compounds
import export
from common import CONFIG_DIR, PUBLIC_DATA, SEASON_YEAR, SourcedValue


# Bumped whenever the shape or the model behind an exported laps.json
# changes. refresh_race_laps re-exports any round written under an older
# version: without this, the skip-if-exists check meant a corrected model
# silently never reached rounds that had already been exported (a fix to
# the fit-reliability rule left 97 stale fits labelled "reliable" on
# disk, because their rounds were simply skipped).
LAPS_SCHEMA_VERSION = 4


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


def refresh_race_laps(year: int, round_info: dict,
                      openf1_sessions: list[dict] | None = None) -> None:
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
            existing = json.loads(out_path.read_text())
        except (json.JSONDecodeError, OSError):
            existing = {}  # unreadable: treat as stale and rebuild
        existing_version = existing.get("schemaVersion", 0)
        stale_name = existing.get("raceName") != round_info["raceName"]
        if existing_version == LAPS_SCHEMA_VERSION and stale_name:
            # Round 1 sat in the repository as raceName "X" because the
            # calendar was regenerated after the export and the version
            # check alone had nothing to notice.
            print(f"[laps] round {round_}: re-exporting, stored name "
                  f"{existing.get('raceName')!r} no longer matches the calendar")
        elif existing_version == LAPS_SCHEMA_VERSION:
            # A round at the current version is still stale if the
            # compound join never actually ran for it — a transient
            # OpenF1 failure would otherwise freeze that round with no
            # compounds forever, which is the same staleness trap that
            # once kept 97 corrected fits off disk. "Ran and found
            # nothing" is a real answer and is not retried.
            try:
                attempted = existing.get("compounds", {}).get("attempted", False)
            except AttributeError:
                attempted = False
            if attempted or openf1_sessions is None:
                print(f"[laps] round {round_}: already exported at v{existing_version}, skipping")
                return
            print(f"[laps] round {round_}: re-exporting, compound join never ran")
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

    # Real tyre compounds, where they can be matched confidently. Every
    # stint this project published before now carried compound: None,
    # because the Jolpica feed has none and shading a bar by a guessed
    # compound would be invented state. OpenF1 publishes it, so the
    # colour can finally mean what a reader assumes it means — and a
    # stint that cannot be matched keeps the blank rather than taking a
    # plausible-looking guess.
    compound_report = {"identified": 0, "stints": len(stints), "share": 0.0,
                       "attempted": False, "reason": "OpenF1 session list unavailable"}
    if openf1_sessions is not None:
        session = _match_openf1_session(round_info, openf1_sessions)
        if session is None:
            compound_report["reason"] = "no OpenF1 race session matched this round"
        else:
            try:
                of1_stints = ingest_openf1.fetch_stints(session["sessionKey"])
                of1_drivers = ingest_openf1.fetch_drivers(session["sessionKey"])
                code_by_number = {d["driverNumber"]: d.get("code") for d in of1_drivers}
                entry_codes = {
                    e["driverId"]: e.get("code")
                    for e in json.loads(
                        (CONFIG_DIR / f"season_{year}.json").read_text()
                    )["entryList"]
                }
                by_code = derive_compounds.index_openf1_stints(of1_stints, code_by_number)
                compound_report = derive_compounds.attach_compounds(
                    stints, by_code, lambda did: entry_codes.get(did)
                )
                compound_report["attempted"] = True
                if not compound_report["identified"]:
                    compound_report["reason"] = (
                        f"the stint feed returned {len(of1_stints)} stint(s) for this "
                        "session and none overlapped ours enough to identify"
                    )
                print(f"[laps] round {round_}: compounds identified for "
                      f"{compound_report['identified']}/{compound_report['stints']} stints")
            except Exception as exc:  # noqa: BLE001 - compounds are additive
                compound_report["reason"] = f"{type(exc).__name__}: {exc}"
                print(f"[laps] round {round_}: compound join skipped "
                      f"({type(exc).__name__}: {exc})")
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
        "compounds": compound_report,
        "generated_at": ingest._now_iso(),
        "source": f"Jolpica-F1 {year} round {round_} laps + pitstops",
        "limitations": [
            ("Tyre compounds come from the OpenF1 stint feed, matched to these "
             "pit-stop-derived stints by driver code and lap overlap. A stint that "
             "could not be matched confidently is left uncoloured rather than guessed."
             if compound_report["identified"]
             else "No tyre compound could be matched for this race, so stints are "
                  "structural only and are shaded by stint order."),
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


# Bumped when the fit or the exported shape changes, so a corrected model
# reaches rounds that were already written.
WHATIF_SCHEMA_VERSION = 3

# The publish gate from docs/SPEC.md: replaying a driver's actual strategy
# has to reproduce their actual race time this closely. A driver whose
# race the model cannot reproduce gets no counterfactual — the page has
# nothing to offer them, and says so.
WHATIF_MAX_ERROR = 0.01


def refresh_whatif(year: int, round_info: dict) -> None:
    """Fit the what-if model to a race that has already been exported.

    Reads the round's own laps.json rather than re-fetching: the fit needs
    exactly the laps and stints that were published, and re-fetching would
    let the two drift apart. Runs on its own schema version so a corrected
    fit reaches rounds already written — the lesson from the error review,
    which for a while rode inside the telemetry step and therefore never
    reached the rounds furthest along.
    """
    from models import whatif, whatif_fit

    round_ = round_info["round"]
    laps_path = PUBLIC_DATA / str(year) / str(round_) / "R" / "laps.json"
    if not laps_path.exists():
        return

    race = json.loads(laps_path.read_text())

    out_path = PUBLIC_DATA / str(year) / str(round_) / "R" / "whatif.json"
    if out_path.exists():
        try:
            stored = json.loads(out_path.read_text())
        except (json.JSONDecodeError, OSError):
            stored = {}
        # The version alone is not enough. This artifact is derived from
        # the round's laps.json, so a re-export of that round has to
        # reach it too — the staleness trap that once left 97 corrected
        # fits on disk, and that kept a wrong race name in place for a
        # week, was in both cases a check that only asked one question.
        fresh = (
            stored.get("schemaVersion") == WHATIF_SCHEMA_VERSION
            and stored.get("sourceGeneratedAt") == race.get("generated_at")
        )
        if fresh:
            return
    result = whatif_fit.fit_race_params(race["laps"], race["stints"], race["totalLaps"])

    drivers = {}
    validated = 0
    for driver_id, built in result["drivers"].items():
        totals = whatif.monte_carlo(built["params"])
        model_median = whatif.median(totals)
        actual = built["actualTotalS"]
        error = (model_median - actual) / actual
        built["validation"] = {
            "modelMedianS": model_median,
            "actualTotalS": actual,
            "errorPct": error * 100.0,
            "validated": abs(error) < WHATIF_MAX_ERROR,
            "thresholdPct": WHATIF_MAX_ERROR * 100.0,
        }
        if built["validation"]["validated"]:
            validated += 1
        drivers[driver_id] = built

    payload = {
        "schemaVersion": WHATIF_SCHEMA_VERSION,
        "year": year,
        "round": round_,
        "raceName": round_info["raceName"],
        "totalLaps": race["totalLaps"],
        "sourceGeneratedAt": race.get("generated_at"),
        "drivers": drivers,
        "validatedDrivers": validated,
        "fit": result.get("fit"),
        "neutralisedLaps": result.get("neutralisedLaps", []),
        "skipped": result.get("skipped"),
        "generated_at": ingest._now_iso(),
        "source": f"fitted to Jolpica-F1 {year} round {round_} lap times and stints",
        "limitations": [
            "Parameters are fitted to this race and nothing else. They describe the "
            "car, tyres and track as they were on the day, and carry no claim about "
            "any other round.",
            "Fuel burn and track evolution are both linear in lap number and cannot be "
            "told apart from one race, so the whole coefficient is published as fuel "
            "and the evolution rate is zero rather than guessed.",
            "Pit loss, the standing-start loss and the cost of a neutralised lap are "
            "measured against the fit, not fitted as free parameters.",
            "A stint starting on used tyres is modelled as starting on fresh ones: the "
            "source publishes the age but this model has no term for it, so the "
            "compound's offset absorbs the average.",
            "Only drivers whose replayed real strategy reproduces their real race time "
            f"within {WHATIF_MAX_ERROR:.0%} are offered as a what-if. The rest are "
            "listed with the error, because a model that cannot reproduce what "
            "happened has no standing to say what would have.",
        ],
    }

    export.export_whatif(year, round_, payload)
    note = result.get("skipped") or f"{validated}/{len(drivers)} driver(s) validated"
    print(f"[whatif] round {round_}: {note}")


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

TELEMETRY_SCHEMA_VERSION = 2

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


def _match_openf1_session(round_info: dict, sessions: list[dict],
                          slack_days: int = 1) -> dict | None:
    """Pair a calendar round with its OpenF1 session of one kind.

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
        if abs((session_date - target).days) <= slack_days:
            return session
    return None


ERROR_REVIEW_SCHEMA_VERSION = 5


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

    session = _match_openf1_session(round_info, sessions, slack_days)
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


def _lines_are_consistent(out_dir, manifest: dict) -> bool:
    """Do the binaries decode at the stride their own manifest declares?

    A round at the current schema version is still stale if the two
    disagree — which they did, silently, the first time the elevation
    channel appeared: seven-channel binaries under a manifest that still
    said six. The version check alone had nothing to notice, so it is
    asked here as well, and the same arithmetic is a hard gate in
    validate_export.py.
    """
    channels = manifest.get("channels") or []
    if not channels:
        return False
    for code, entry in (manifest.get("drivers") or {}).items():
        binary = out_dir / f"{code}.bin"
        if not binary.exists():
            return False
        if binary.stat().st_size != entry["pointCount"] * len(channels) * 2:
            return False
    return True


QUALIFYING_MATCH_SLACK_DAYS = 3

# What a session directory means, in the words a page should use.
SESSION_LABELS = {"R": "the race", "Q": "qualifying"}


def refresh_telemetry(year: int, round_info: dict, sessions: list[dict],
                      session_name: str = "R", slack_days: int = 1) -> bool:
    """Track geometry and racing lines for one session, from real position data.

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
    label = f"round {round_} {session_name}"
    out_dir = PUBLIC_DATA / str(year) / str(round_) / session_name / "lines"
    manifest = out_dir / "manifest.json"
    if manifest.exists():
        try:
            stored_doc = json.loads(manifest.read_text())
        except (json.JSONDecodeError, OSError):
            stored_doc = {}
        stored = stored_doc.get("schemaVersion", 0)
        if stored == TELEMETRY_SCHEMA_VERSION and _lines_are_consistent(out_dir, stored_doc):
            print(f"[telemetry] {label}: already exported, skipping")
            return False
        if stored == TELEMETRY_SCHEMA_VERSION:
            print(f"[telemetry] {label}: re-exporting, the manifest and the "
                  "binaries beside it disagree about the channel count")

    session = _match_openf1_session(round_info, sessions, slack_days)
    if session is None:
        print(f"[telemetry] {label}: no OpenF1 {session_name} session near "
              f"{round_info['date']}")
        return False

    session_key = session["sessionKey"]
    try:
        laps = ingest_openf1.fetch_laps(session_key)
        drivers = ingest_openf1.fetch_drivers(session_key)
    except Exception as exc:  # noqa: BLE001 - one round must not abort the refresh
        print(f"[telemetry] {label}: unavailable ({type(exc).__name__}: {exc})")
        return True

    if not laps:
        print(f"[telemetry] {label}: OpenF1 has no laps for session {session_key}")
        return True

    code_by_number = {d["driverNumber"]: (d.get("code") or str(d["driverNumber"]))
                      for d in drivers}

    fastest = ingest_openf1.pick_fastest_laps(laps)
    ranked = sorted(fastest.items(), key=lambda kv: kv[1]["lapDurationS"])
    selected = ranked[:LINE_DRIVERS_PER_ROUND]

    scale: SourcedValue | None = None
    exported = []
    built: list[tuple[str, dict]] = []
    attempts: list[dict] = []
    best_line = None

    for driver_number, lap in selected:
        code = code_by_number.get(driver_number, str(driver_number))
        try:
            location = ingest_openf1.fetch_lap_location(session_key, driver_number, lap)
            car_data = ingest_openf1.fetch_lap_car_data(session_key, driver_number, lap)
        except Exception as exc:  # noqa: BLE001 - degrade per driver, not per round
            print(f"[telemetry] {label} {code}: fetch failed "
                  f"({type(exc).__name__}: {exc})")
            continue

        aligned = derive_telemetry.align_to_location(location, car_data)
        if not aligned:
            detail = (f"no position samples: the feed returned {len(location)} "
                      f"location row(s) and {len(car_data)} car-data row(s) for "
                      "this lap's window")
            attempts.append({"code": code, "reason": detail})
            print(f"[telemetry] {label} {code}: {detail}")
            continue

        # The unit is measured once per round, off the first lap that can
        # support the measurement, and then applied to every driver: it is
        # a property of the feed, not of a driver, and re-measuring it per
        # driver would let two lines end up on subtly different scales.
        if scale is None:
            scale = derive_telemetry.estimate_position_scale(aligned)
            if scale is None:
                print(f"[telemetry] {label} {code}: cannot measure the "
                      "position unit without speed; skipping this driver")
                continue
            print(f"[telemetry] {label}: position unit measured at "
                  f"{scale.value:.3f} raw units/m over {scale.sample_size} samples")

        line = derive_telemetry.build_racing_line(aligned, scale.value)
        if line is None:
            detail = derive_telemetry.describe_line_capture(aligned, scale.value)
            attempts.append({"code": code, "reason": detail})
            print(f"[telemetry] {label} {code}: no line — {detail}")
            continue

        built.append((code, line))
        exported.append({
            "code": code,
            "driverNumber": driver_number,
            "lapNumber": lap.get("lapNumber"),
            "lapTimeS": lap.get("lapDurationS"),
        })
        if best_line is None:
            best_line = line

    if not exported or best_line is None or scale is None:
        # Record the refusal where the frontend can read it. Two rounds
        # have no lines for reasons that are not "the backfill has not got
        # there yet" — Monaco's location endpoint returns nothing at all
        # while car data for the same window returns 285 rows, and
        # Hungary's repeats the same coordinates so hard that 326 samples
        # contain about 30 distinct positions. A page that says "not
        # processed yet" about either of those is telling the reader
        # something false.
        export.export_lines_unavailable(year, round_, session_name, {
            "schemaVersion": TELEMETRY_SCHEMA_VERSION,
            "source": f"OpenF1 session {session_key} ({session.get('countryName')})",
            "unavailable": {
                "reason": (
                    "the position feed does not carry a usable lap for this session"
                ),
                "perDriver": attempts,
                "checkedAt": ingest._now_iso(),
            },
        })
        print(f"[telemetry] {label}: nothing publishable")
        return True

    # Elevation is decided once for the round, not per driver: the
    # manifest declares one channel list for the session, so a lap that
    # kept z beside one that dropped it would leave the decoder reading
    # every other driver's line off by a channel.
    elevation = derive_telemetry.elevation_summary(best_line)
    if not elevation["usable"]:
        for _, line in built:
            line.pop("z", None)
        print(f"[telemetry] {label}: no elevation — {elevation['reason']}")
    else:
        print(f"[telemetry] {label}: elevation over {elevation['rangeM']:.0f}m "
              "published")

    for code, line in built:
        export.export_racing_line(year, round_, session_name, code, line)

    export.annotate_line_manifest(year, round_, session_name, {
        "schemaVersion": TELEMETRY_SCHEMA_VERSION,
        "sessionName": session_name,
        "sessionLabel": SESSION_LABELS.get(session_name, session_name),
        "source": f"OpenF1 session {session_key} ({session.get('countryName')})",
        "positionUnitsPerMetre": scale.to_json(),
        "elevation": elevation,
        "laps": exported,
        "limitations": [
            f"Each line is one driver's fastest non-out lap of "
            f"{SESSION_LABELS.get(session_name, session_name)}, not an average and "
            "not an ideal line.",
            "Position samples arrive at roughly 3.7 Hz and are resampled onto a "
            "fixed distance grid, so the line is interpolated between samples.",
            "Corner numbering is not published by this source, so the map carries "
            "the driven path and no official corner labels.",
        ],
    })

    # The atlas draws one outline per circuit, and qualifying is the
    # better lap to draw it from: low fuel, fresh tyres, the closest thing
    # the data has to the limit of the track. So a qualifying trace always
    # replaces a race one, and a race trace never overwrites a qualifying
    # one — it fills in where qualifying has nothing.
    if _circuit_outline_should_be_written(circuit_key, session_name):
        _export_circuit_outline(
            circuit_key, round_info, round_, session_name, session_key,
            best_line, elevation, scale, exported,
        )
        print(f"[telemetry] {label}: outline written for {circuit_key}")

    print(f"[telemetry] {label}: exported {len(exported)} racing line(s)")
    return True


def _circuit_outline_should_be_written(circuit_key: str, session_name: str) -> bool:
    if session_name == "Q":
        return True
    path = PUBLIC_DATA / "circuits" / f"{circuit_key}.json"
    if not path.exists():
        return True
    try:
        stored = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return True
    return stored.get("sessionName") != "Q"


def _export_circuit_outline(circuit_key, round_info, round_, session_name,
                            session_key, best_line, elevation, scale, exported):
    export.export_circuit(circuit_key, {
        "circuitId": circuit_key,
        "circuitName": round_info["circuitName"],
        "round": round_,
        "sessionName": session_name,
        "sessionLabel": SESSION_LABELS.get(session_name, session_name),
        "outline": derive_telemetry.build_outline_from_line(best_line),
        "elevation": elevation,
        # Turns are detected in the browser from the published line rather
        # than stored here: one implementation of the detection, and no
        # stored corner list that can fall out of step with the lap it
        # was read from.
        "drsZones": [],
        "generated_at": ingest._now_iso(),
        "source": (
            f"OpenF1 position trace, session {session_key}, fastest "
            f"{SESSION_LABELS.get(session_name, session_name)} lap "
            f"({exported[0]['code']}, lap {exported[0]['lapNumber']})"
        ),
        "positionUnitsPerMetre": scale.to_json(),
        "limitations": [
            "The outline is one measured lap's driven path, so it follows the "
            "racing line rather than the centre line or the track edges.",
            (f"Traced from {SESSION_LABELS.get(session_name, session_name)}. "
             "Qualifying is preferred where it exists — low fuel and fresh tyres "
             "put that lap closest to the limit of the circuit — and a race lap "
             "fills in where it does not."),
            "No official corner numbering: this source publishes none. The atlas "
            "detects turns from the published line and numbers them in lap order, "
            "which is this lap's own sequence rather than the circuit's names.",
            "No DRS zones: the feed carries a DRS channel, but turning its integer "
            "codes into 'the flap was open here' needs a mapping this project has no "
            "verified source for.",
        ],
    })


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


def refresh_telemetry_index(year: int) -> None:
    """List what the telemetry backfill has actually produced.

    Built by reading the exported tree rather than by remembering what
    this run did: a round exported three refreshes ago belongs in the
    index just as much as one written a minute ago, and a listing that
    only knows about the current run would drop most of the season.
    """
    rounds: dict[str, dict] = {}
    year_dir = PUBLIC_DATA / str(year)
    for manifest_path in sorted(year_dir.glob("*/*/lines/manifest.json")):
        session_name = manifest_path.parent.parent.name
        round_ = manifest_path.parent.parent.parent.name
        try:
            manifest = json.loads(manifest_path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        entry = rounds.setdefault(round_, {})
        entry[session_name] = {
            "drivers": sorted((manifest.get("drivers") or {}).keys()),
            "sessionLabel": manifest.get("sessionLabel")
            or SESSION_LABELS.get(session_name, session_name),
            "unavailable": bool(manifest.get("unavailable")),
        }

    export.export_telemetry_index(year, {
        "year": year,
        "generated_at": ingest._now_iso(),
        "rounds": rounds,
        "note": (
            "Which sessions have exported racing lines. A session marked "
            "unavailable was attempted and the position feed had nothing usable "
            "for it; a session absent here has not been attempted yet."
        ),
    })
    with_lines = sum(
        1 for sessions in rounds.values()
        for entry in sessions.values() if entry["drivers"]
    )
    print(f"[telemetry] index: {len(rounds)} round(s), {with_lines} session(s) with lines")


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

    try:
        qualifying_sessions = ingest_openf1.fetch_qualifying_sessions(args.year)
        print(f"OpenF1: {len(qualifying_sessions)} qualifying session(s) run so far")
    except Exception as exc:  # noqa: BLE001 - qualifying is additive on top of additive
        print(f"OpenF1 qualifying listing unavailable this run ({exc})")
        qualifying_sessions = []

    telemetry_budget = TELEMETRY_ROUNDS_PER_RUN
    # Newest first: the most recent race is the one a reader is most
    # likely to want, so a partial backfill should be useful rather than
    # merely early.
    for round_info in reversed(rounds_due(season_config["calendar"])):
        refresh_race_laps(args.year, round_info, openf1_sessions)
        refresh_whatif(args.year, round_info)
        if openf1_sessions:
            refresh_error_review(args.year, round_info, openf1_sessions)
        # Qualifying first: it is the faster lap of the weekend, so it is
        # the one the atlas wants for its outline and the one a reader
        # comparing driving styles is most likely to look at. Both
        # sessions draw on the same budget — the limit is there to pace
        # fetching, and a qualifying lap costs exactly what a race lap
        # costs.
        if qualifying_sessions and telemetry_budget > 0:
            if refresh_telemetry(args.year, round_info, qualifying_sessions,
                                 session_name="Q",
                                 slack_days=QUALIFYING_MATCH_SLACK_DAYS):
                telemetry_budget -= 1
        if openf1_sessions and telemetry_budget > 0:
            if refresh_telemetry(args.year, round_info, openf1_sessions):
                telemetry_budget -= 1

    refresh_telemetry_index(args.year)
    refresh_standings(args.year, season_config["calendar"])
    refresh_upcoming(args.year, season_config["calendar"])

    return 0


if __name__ == "__main__":
    sys.exit(main())
