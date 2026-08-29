"""Hard validation gate run by .github/workflows/refresh-data.yml right
before the commit step. Every check here must raise/exit non-zero on
failure — since commits land straight on `main` with no review step
(docs/SPEC.md), this script is the only thing standing between a bad
export and a live, broken deploy.
"""
from __future__ import annotations

import json
import sys

from common import CONFIG_DIR, PUBLIC_DATA, BudgetExceeded
import derive_conditions
import derive_overtakes
import derive_pit_loss
import derive_radio
import derive_sprint
import export


def check_budgets() -> list[str]:
    errors = []
    try:
        export.check_site_budget()
    except BudgetExceeded as exc:
        errors.append(str(exc))

    for session_dir in PUBLIC_DATA.glob("*/*/*"):
        if not session_dir.is_dir():
            continue
        try:
            total = sum(f.stat().st_size for f in session_dir.rglob("*") if f.is_file())
            from common import MAX_SESSION_BYTES

            if total > MAX_SESSION_BYTES:
                errors.append(f"{session_dir} totals {total} bytes, over the {MAX_SESSION_BYTES} byte session budget")
        except OSError as exc:
            errors.append(f"{session_dir}: {exc}")

    for bin_file in PUBLIC_DATA.rglob("lines/*.bin"):
        from common import MAX_RACING_LINE_BYTES

        size = bin_file.stat().st_size
        if size > MAX_RACING_LINE_BYTES:
            errors.append(f"{bin_file} is {size} bytes, over the {MAX_RACING_LINE_BYTES} byte racing-line budget")

    return errors


def check_standings_cross_check() -> list[str]:
    """Fail the run on a standings mismatch, per docs/SPEC.md 2.4.

    An earlier version of this check treated a flagged mismatch as a
    benign "warning banner" state and passed it through. That reasoning
    was wrong and it cost a bad deploy: a rate-limited refresh computed
    the table from a subset of rounds, the cross-check flagged all 23
    drivers, and this gate waved it through to the live site anyway.

    A mismatch means the independently computed table and the API
    disagree. One of them is wrong and this process cannot tell which,
    so nothing ships until a human looks. A missing or skipped
    cross-check fails too — not running is not the same as passing.
    """
    standings_path = PUBLIC_DATA / "standings.json"
    if not standings_path.exists():
        return []  # nothing computed yet this run; not an error

    data = json.loads(standings_path.read_text())
    source_check = data.get("source_check")
    if source_check is None:
        return ["standings.json is missing source_check — the cross-check against the API did not run"]

    if source_check.get("mismatch"):
        details = source_check.get("details", [])
        sample = ", ".join(str(d.get("driverCode")) for d in details[:5])
        return [
            f"standings cross-check FAILED for {len(details)} driver(s) [{sample} ...]: the "
            "computed table disagrees with the API's. Inspect source_check in "
            "public/data/standings.json — nothing is published until this is resolved."
        ]

    if source_check.get("note"):
        return [
            f"standings cross-check did not actually run ({source_check['note']}) — "
            "a skipped check is not a passed check, so this run is not publishable."
        ]

    return []


def check_upcoming_brief() -> list[str]:
    """Self-check the Upcoming Race Brief's arithmetic before it ships.

    The brief's numbers are not cross-checkable against a published
    table the way standings are, so the gate checks them against each
    other instead. The failure this is really guarding against already
    happened once in development: classification was keyed off the
    finishing-status text, whose wording changes between seasons, which
    silently reclassified every lapped finisher as a retirement. That
    produces a brief that is internally plausible and wrong — exactly
    the shape of error a reader cannot catch — but it shows up here as
    a finish rate that no longer squares with its own per-edition rows.
    """
    path = PUBLIC_DATA / "upcoming.json"
    if not path.exists():
        return []

    data = json.loads(path.read_text())
    history = data.get("history")
    if history is None:
        return []  # a brief that states why it has no history is valid

    errors = []
    per_edition = history.get("perEdition", [])

    if history.get("editions") != len(per_edition):
        errors.append(
            f"upcoming.json claims {history.get('editions')} editions but carries "
            f"{len(per_edition)} per-edition rows"
        )

    finish = history.get("finishRate", {})
    classified_sum = sum(e.get("classified", 0) for e in per_edition)
    starters_sum = sum(e.get("starters", 0) for e in per_edition)
    if finish.get("classified") != classified_sum or finish.get("starters") != starters_sum:
        errors.append(
            f"upcoming.json finish rate ({finish.get('classified')}/{finish.get('starters')}) "
            f"does not match the sum of its per-edition rows ({classified_sum}/{starters_sum})"
        )

    for edition in per_edition:
        if edition.get("classified", 0) > edition.get("starters", 0):
            errors.append(
                f"upcoming.json {edition.get('year')}: {edition['classified']} cars classified "
                f"out of {edition['starters']} starters — more finishers than starters"
            )

    n = history.get("positionChange", {}).get("n", 0)
    if n > classified_sum:
        errors.append(
            f"upcoming.json position-change sample ({n}) exceeds the number of classified "
            f"finishes ({classified_sum}) it can be drawn from"
        )

    return errors


def check_line_manifests() -> list[str]:
    """Every racing-line binary must decode at the stride its manifest declares.

    This is the gate the elevation work needed and did not have. The
    manifest kept its original channel list when one already existed, so
    a re-export that added the elevation channel wrote seven-channel
    binaries under a manifest still promising six. Nothing raised: the
    pipeline was happy, the tests were green, and the frontend read every
    channel after x off by one for three rounds.

    The arithmetic is exact — a binary is point count x channels x 2
    bytes — so this is a real check rather than a heuristic, and a
    mismatch is always corruption.
    """
    errors = []
    for path in sorted(PUBLIC_DATA.glob("*/*/*/lines/manifest.json")):
        manifest = json.loads(path.read_text())
        if manifest.get("unavailable"):
            # A round the feed has nothing usable for says so on purpose,
            # and carries no drivers to check.
            if manifest.get("drivers"):
                errors.append(f"{path}: marked unavailable but lists drivers")
            continue

        channels = manifest.get("channels") or []
        if not channels:
            errors.append(f"{path}: declares no channels")
            continue

        for code, entry in (manifest.get("drivers") or {}).items():
            binary = path.parent / f"{code}.bin"
            if not binary.exists():
                errors.append(f"{path}: lists {code} but {code}.bin is missing")
                continue
            expected = entry["pointCount"] * len(channels) * 2
            actual = binary.stat().st_size
            if actual != expected:
                errors.append(
                    f"{binary}: {actual} bytes but the manifest declares "
                    f"{entry['pointCount']} points x {len(channels)} channels "
                    f"({expected} bytes) — the line would decode off by a channel"
                )

    return errors


def check_whatif() -> list[str]:
    """Re-run every published what-if against the race it was fitted to.

    This is the model self-check the spec makes a hard gate. The page
    offers a counterfactual only for drivers whose real strategy the model
    reproduces within 1%, so a driver marked validated who does not
    reproduce is not a bad estimate — it is the gate itself being broken,
    and the site would then be publishing counterfactuals it has no
    standing to publish.

    The check re-simulates from the exported parameters rather than
    trusting the stored figure, because the stored figure is exactly what
    would be wrong if the export or the model drifted.
    """
    from models.whatif import median, monte_carlo

    errors = []
    for path in sorted(PUBLIC_DATA.glob("*/*/R/whatif.json")):
        data = json.loads(path.read_text())
        for driver_id, entry in (data.get("drivers") or {}).items():
            validation = entry.get("validation") or {}
            if not validation.get("validated"):
                continue
            actual = entry["actualTotalS"]
            model_median = median(monte_carlo(entry["params"]))
            error = abs(model_median - actual) / actual
            if error >= 0.01:
                errors.append(
                    f"{path}: {driver_id} is marked validated but the model lands on "
                    f"{model_median:.1f}s against an actual {actual:.1f}s ({error:.2%})"
                )

        if not data.get("drivers") and not data.get("skipped"):
            errors.append(f"{path}: no drivers and no reason given for having none")

    return errors


# The two sources agree to the millisecond on every qualifying lap this
# project has published — 24 driver-laps across 12 rounds, exactly. So a
# disagreement is not a rounding difference: it means the wrong OpenF1
# session was matched to a round, or the wrong lap was picked out of it,
# or the lap-time channel is not what it claims to be. A hundredth of
# tolerance leaves room for a future feed to round differently without
# leaving room for any of those.
QUALIFYING_CROSS_SOURCE_TOLERANCE_S = 0.01


def check_qualifying_cross_source() -> list[str]:
    """Check the telemetry lap times against the official results.

    This is the only place in the project where two independent sources
    describe the same event: OpenF1 publishes the lap a racing line was
    traced from, and Jolpica publishes what that driver's qualifying
    times officially were. Everything else here is internally consistent
    by construction; this can actually be wrong.
    """
    errors = []
    for qualifying_path in sorted(PUBLIC_DATA.glob("*/qualifying.json")):
        year = qualifying_path.parent.name
        try:
            document = json.loads(qualifying_path.read_text())
        except (json.JSONDecodeError, OSError):
            errors.append(f"{qualifying_path}: unreadable")
            continue

        by_round = {str(entry["round"]): entry for entry in document.get("rounds", [])}
        for manifest_path in sorted(PUBLIC_DATA.glob(f"{year}/*/Q/lines/manifest.json")):
            round_ = manifest_path.parent.parent.parent.name
            manifest = json.loads(manifest_path.read_text())
            official = by_round.get(round_)
            if not official or not manifest.get("laps"):
                continue

            results = {row.get("code"): row for row in official["results"]}
            for lap in manifest["laps"]:
                row = results.get(lap.get("code"))
                if not row:
                    continue
                times = [row[key] for key in ("q1S", "q2S", "q3S") if row.get(key)]
                if not times:
                    continue
                drift = abs(float(lap["lapTimeS"]) - min(times))
                if drift > QUALIFYING_CROSS_SOURCE_TOLERANCE_S:
                    errors.append(
                        f"{manifest_path}: {lap['code']} traced a "
                        f"{lap['lapTimeS']:.3f}s lap but the official result's best "
                        f"qualifying time is {min(times):.3f}s ({drift:.3f}s apart) — "
                        "the session or the lap does not match"
                    )

    return errors


def check_sprint() -> list[str]:
    """Re-derive the sprint document's own figures from its own rows.

    Every number on the sprint page is computed from driver rows that
    ship in the same file, so the gate can recompute all of them and
    compare. That is the check that would have caught the manifest
    corruption earlier in this project: a document can be internally
    wrong while every unit test passes, and the only way to notice is to
    redo the arithmetic against what was actually published.

    It also checks the document against two others - the calendar it
    claims rounds from, and the standings its points have to fit inside.
    """
    errors = []
    try:
        season = json.loads((PUBLIC_DATA / "season.json").read_text())
    except (json.JSONDecodeError, OSError):
        season = None

    for sprint_path in sorted(PUBLIC_DATA.glob("*/sprint.json")):
        try:
            document = json.loads(sprint_path.read_text())
        except (json.JSONDecodeError, OSError):
            errors.append(f"{sprint_path}: unreadable")
            continue

        calendar = {}
        if season:
            calendar = {str(r["round"]): r for r in season.get("calendar", [])}

        for entry in document.get("rounds", []):
            round_ = str(entry.get("round"))
            listed = calendar.get(round_)
            if calendar and not listed:
                errors.append(f"{sprint_path}: round {round_} is not on the calendar")
            elif listed and not listed.get("sprint"):
                errors.append(
                    f"{sprint_path}: round {round_} is published as a sprint weekend "
                    "but the calendar does not flag it as one"
                )

            drivers = entry.get("drivers", [])
            # Who counted as having raced, re-decided from the status
            # each row carries. A document written under an older
            # reading of the feed's vocabulary is stale in a way that
            # recomputing the means from its own flags cannot see: the
            # flags themselves are what went wrong.
            for driver in drivers:
                for status_key, flag_key in (
                    ("sprintStatus", "sprintClassified"),
                    ("raceStatus", "raceClassified"),
                ):
                    expected = derive_sprint.classified(driver.get(status_key))
                    if bool(driver.get(flag_key)) != expected:
                        errors.append(
                            f"{sprint_path}: round {round_} marks {driver.get('driverCode')} "
                            f"{flag_key}={driver.get(flag_key)} for status "
                            f"{driver.get(status_key)!r}, which now reads as {expected}"
                        )

            for key, grid_key, finish_key, flag in (
                ("sprintMovement", "sprintGrid", "sprintFinish", "sprintClassified"),
                ("raceMovement", "raceGrid", "raceFinish", "raceClassified"),
            ):
                published = entry.get(key) or {}
                recomputed = derive_sprint.movement(drivers, grid_key, finish_key, flag)
                if not _same_number(published.get("meanAbsolute"), recomputed["meanAbsolute"]):
                    errors.append(
                        f"{sprint_path}: round {round_} {key} says "
                        f"{published.get('meanAbsolute')} but its own rows give "
                        f"{recomputed['meanAbsolute']}"
                    )
                if published.get("sample") != recomputed["sample"]:
                    errors.append(
                        f"{sprint_path}: round {round_} {key} claims a sample of "
                        f"{published.get('sample')} over {recomputed['sample']} usable row(s)"
                    )

            both = [
                d for d in drivers
                if d.get("sprintClassified") and d.get("raceClassified")
                and d.get("sprintFinish") and d.get("raceFinish")
            ]
            published = entry.get("rankAgreement") or {}
            recomputed = derive_sprint.spearman(
                [float(d["sprintFinish"]) for d in both],
                [float(d["raceFinish"]) for d in both],
            )
            if not _same_number(published.get("rho"), recomputed):
                errors.append(
                    f"{sprint_path}: round {round_} publishes rho {published.get('rho')} "
                    f"but its own rows give {recomputed}"
                )
            if published.get("n") != len(both):
                errors.append(
                    f"{sprint_path}: round {round_} claims rho over {published.get('n')} "
                    f"driver(s) but {len(both)} were classified in both races"
                )
            if recomputed is None and not published.get("withheldReason"):
                errors.append(
                    f"{sprint_path}: round {round_} withholds rho without saying why"
                )

        # A status string this project has never seen drops those drivers
        # from every mean and every correlation without saying so. It is
        # named in the document and fails here, rather than quietly
        # shrinking a sample nobody is watching.
        unseen = derive_sprint.unrecognised_statuses(document.get("rounds", []))
        if unseen:
            errors.append(
                f"{sprint_path}: the results feed used status(es) this project does "
                f"not classify: {', '.join(unseen)} — those drivers are excluded from "
                "every figure until the derivation is taught what they mean"
            )

        season_block = derive_sprint.build_season(document.get("rounds", []))
        for key in ("medianRho", "sprintMeanPlacesChanged", "raceMeanPlacesChanged"):
            if not _same_number((document.get("season") or {}).get(key), season_block[key]):
                errors.append(
                    f"{sprint_path}: season {key} says "
                    f"{(document.get('season') or {}).get(key)} but the rounds give "
                    f"{season_block[key]}"
                )

        errors += _check_sprint_points_fit_standings(sprint_path, document)

    return errors


def _same_number(published, recomputed, tolerance: float = 1e-9) -> bool:
    """None must match None: a withheld figure and a computed one are
    different claims, and treating them as interchangeable is how a
    refusal quietly turns into a number."""
    if published is None or recomputed is None:
        return published is None and recomputed is None
    return abs(float(published) - float(recomputed)) <= tolerance


def _check_sprint_points_fit_standings(sprint_path, document) -> list[str]:
    """Points taken on sprint weekends cannot exceed a driver's season.

    Two documents built from different endpoints, so this can be wrong
    in a way the arithmetic checks above cannot: a round counted twice,
    or a driver's rows joined under the wrong code, shows up here as
    points that do not fit inside a total nobody disputes.
    """
    try:
        standings = json.loads((PUBLIC_DATA / "standings.json").read_text())
    except (json.JSONDecodeError, OSError):
        return []

    totals = {row["driverCode"]: row["points"] for row in standings.get("standings", [])}
    if not totals:
        return []

    errors = []
    for row in (document.get("season") or {}).get("pointsByDriver", []):
        total = totals.get(row["driverCode"])
        if total is None:
            errors.append(
                f"{sprint_path}: {row['driverCode']} scores on sprint weekends "
                "but does not appear in the standings"
            )
            continue
        if row["weekendPoints"] > total + 1e-9:
            errors.append(
                f"{sprint_path}: {row['driverCode']} is credited with "
                f"{row['weekendPoints']} points from sprint weekends but has "
                f"{total} for the season"
            )
    return errors


def check_pit_loss() -> list[str]:
    """Re-derive every circuit's pit loss from the documents it read.

    This one is worth checking twice because it is a second read of data
    published elsewhere: the what-if fits are the measurement, and this
    file is a summary of them. A summary that has drifted from its source
    is the failure mode, so the gate goes back to the source.
    """
    errors = []
    for path in sorted(PUBLIC_DATA.glob("*/pitloss.json")):
        year = path.parent.name
        try:
            document = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            errors.append(f"{path}: unreadable")
            continue

        published = 0
        for entry in document.get("circuits", []):
            round_ = entry.get("round")
            whatif_path = PUBLIC_DATA / year / str(round_) / "R" / "whatif.json"
            if not whatif_path.exists():
                errors.append(
                    f"{path}: round {round_} is listed but {whatif_path.name} is not "
                    "published, so nothing measured it"
                )
                continue
            try:
                whatif = json.loads(whatif_path.read_text())
            except (json.JSONDecodeError, OSError):
                errors.append(f"{whatif_path}: unreadable")
                continue

            recomputed = derive_pit_loss.assess(derive_pit_loss.driver_losses(whatif))
            claimed = entry.get("pitLoss") or {}
            if bool(claimed.get("published")) != recomputed["published"]:
                errors.append(
                    f"{path}: round {round_} says published={claimed.get('published')} "
                    f"but its own source gives {recomputed['published']}"
                )
                continue
            if recomputed["published"]:
                published += 1
                for key in ("medianS", "q1S", "q3S", "drivers"):
                    if not _same_number(claimed.get(key), recomputed[key]):
                        errors.append(
                            f"{path}: round {round_} publishes {key}={claimed.get(key)} "
                            f"but the what-if fit gives {recomputed[key]}"
                        )
            elif not claimed.get("withheldReason"):
                errors.append(
                    f"{path}: round {round_} withholds a pit loss without saying why"
                )

        if document.get("publishedCount") != published:
            errors.append(
                f"{path}: claims {document.get('publishedCount')} published circuit(s) "
                f"over {published} that its own rows support"
            )

    return errors


def check_conditions() -> list[str]:
    """The second cross-source check in this project, enforced.

    Qualifying telemetry against official results was the first. This is
    the second: a trackside thermometer against an independent
    reanalysis of the same hours at the same coordinates. Both exist for
    the same reason — everything else here is internally consistent by
    construction and cannot be caught being wrong.
    """
    errors = []
    for path in sorted(PUBLIC_DATA.glob("*/conditions.json")):
        try:
            document = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            errors.append(f"{path}: unreadable")
            continue

        published = 0
        for round_ in document.get("rounds", []):
            for entry in round_.get("sessions", []):
                where = f"round {round_.get('round')} {entry.get('session')}"
                conditions = entry.get("conditions") or {}
                if not conditions.get("published"):
                    if not conditions.get("withheldReason"):
                        errors.append(
                            f"{path}: {where} withholds its conditions without saying why"
                        )
                    continue

                published += 1
                check = conditions.get("crossCheck") or {}
                recomputed = derive_conditions.cross_check(
                    conditions.get("trackside") or {}, conditions.get("archive") or {},
                )
                if bool(check.get("compared")) != recomputed["compared"]:
                    errors.append(
                        f"{path}: {where} claims compared={check.get('compared')} but "
                        f"its own summaries give {recomputed['compared']}"
                    )
                    continue
                if not recomputed["compared"]:
                    continue
                if not _same_number(check.get("deltaC"), recomputed["deltaC"]):
                    errors.append(
                        f"{path}: {where} publishes a {check.get('deltaC')}C gap between "
                        f"its sources but they are {recomputed['deltaC']}C apart"
                    )
                if not recomputed["agrees"]:
                    errors.append(
                        f"{path}: {where} publishes conditions its own two sources "
                        f"disagree about by {recomputed['deltaC']:.1f}C — the trackside "
                        f"feed says {recomputed['tracksideC']:.1f}C and the independent "
                        f"archive says {recomputed['archiveC']:.1f}C"
                    )

        if document.get("publishedCount") != published:
            errors.append(
                f"{path}: claims {document.get('publishedCount')} published session(s) "
                f"over {published} its own rows support"
            )

    return errors


def check_overtakes() -> list[str]:
    """Internal arithmetic on the position-change feed."""
    errors = []
    for path in sorted(PUBLIC_DATA.glob("*/overtakes.json")):
        try:
            document = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            errors.append(f"{path}: unreadable")
            continue

        for race in document.get("races", []):
            where = f"round {race.get('round')}"
            entry = race.get("overtakes") or {}
            if not entry.get("published"):
                if not entry.get("withheldReason"):
                    errors.append(f"{path}: {where} withholds without saying why")
                continue

            by_driver = entry.get("byDriver") or []
            made = sum(d.get("made", 0) for d in by_driver)
            suffered = sum(d.get("suffered", 0) for d in by_driver)
            # Every change has one driver on each side, so the two totals
            # are the same number counted twice.
            if made != suffered:
                errors.append(
                    f"{path}: {where} records {made} change(s) made and {suffered} "
                    "suffered, and every change has one of each"
                )
            for driver in by_driver:
                if driver.get("net") != driver.get("made", 0) - driver.get("suffered", 0):
                    errors.append(
                        f"{path}: {where} driver {driver.get('driverNumber')} has a net "
                        "that is not made minus suffered"
                    )
            for row in (entry.get("completeness") or {}).get("rows", []):
                if row.get("residual") != row.get("recordedNet", 0) - row.get("officialNet", 0):
                    errors.append(
                        f"{path}: {where} {row.get('driverCode')} has a residual that is "
                        "not the recorded net minus the official one"
                    )

    return errors


# Fields that would mean this project had turned audio into text. The
# rule is a refusal, so the gate enforces it structurally rather than
# leaving it to a comment nobody re-reads.
FORBIDDEN_RADIO_FIELDS = ("transcript", "text", "message", "content", "summary",
                          "sentiment", "tone", "audio", "clip")


def check_radio() -> list[str]:
    """No transcripts, no audio, and a link for every clip."""
    errors = []
    for path in sorted(PUBLIC_DATA.glob("*/radio.json")):
        try:
            document = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            errors.append(f"{path}: unreadable")
            continue

        for race in document.get("races", []):
            where = f"round {race.get('round')}"
            entry = race.get("radio") or {}
            if not entry.get("published"):
                if not entry.get("withheldReason"):
                    errors.append(f"{path}: {where} withholds without saying why")
                continue

            for clip in entry.get("timeline") or []:
                for field in FORBIDDEN_RADIO_FIELDS:
                    if field in clip:
                        errors.append(
                            f"{path}: {where} carries a '{field}' field on a radio clip. "
                            "This project publishes when a message exists and links the "
                            "recording; it never turns the audio into text"
                        )
                if not clip.get("recordingUrl"):
                    errors.append(
                        f"{path}: {where} has a clip with no link to its recording, which "
                        "leaves a reader nothing to check it against"
                    )

    return errors


def main() -> int:
    errors = (
        check_budgets()
        + check_standings_cross_check()
        + check_upcoming_brief()
        + check_whatif()
        + check_line_manifests()
        + check_qualifying_cross_source()
        + check_sprint()
        + check_pit_loss()
        + check_conditions()
        + check_overtakes()
        + check_radio()
    )

    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print("Validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
