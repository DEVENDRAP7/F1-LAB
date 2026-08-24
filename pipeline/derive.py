"""Pure(ish) derivations from an ingested FastF1 SessionBundle: circuit
geometry, racing-line channels ready for quantization, and a standings
cross-check. No network calls happen here — everything comes from the
`session` object ingest.py already loaded.
"""
from __future__ import annotations

import numpy as np

from common import SourcedValue


def rotate_xy(x, y, rotation_deg: float):
    """FastF1 position data is track-local and unrotated; every consumer
    must rotate by circuit_info.rotation or the track renders sideways
    (docs/SPEC.md FastF1 gotchas)."""
    theta = np.radians(rotation_deg)
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    return x * cos_t - y * sin_t, x * sin_t + y * cos_t


def build_circuit_outline(fastest_lap, rotation_deg: float):
    """Track outline as a rotated (x, y) point list in metres, built from
    one fastest lap's merged car+position telemetry."""
    tel = fastest_lap.get_telemetry()
    x_m, y_m = tel["X"] / 10.0, tel["Y"] / 10.0  # FastF1 X/Y are decimetres
    x_rot, y_rot = rotate_xy(x_m, y_m, rotation_deg)
    return list(zip(x_rot.tolist(), y_rot.tolist()))


def extract_corners(circuit_info, fastest_lap, rotation_deg: float) -> list[dict]:
    """Corner list with entry/min speed, apex distance, gear and braking
    point, matched to the nearest telemetry sample by distance."""
    tel = fastest_lap.get_telemetry()
    if "Distance" not in tel:
        tel = tel.add_distance()
    # np.argmin below yields positions; .loc lookups need labels. FastF1
    # telemetry frames keep their original (sliced) index, so align the
    # two by resetting to a RangeIndex first.
    tel = tel.reset_index(drop=True)

    corners = []
    for _, corner in circuit_info.corners.iterrows():
        x_m, y_m = corner["X"] / 10.0, corner["Y"] / 10.0
        x_rot, y_rot = rotate_xy(np.array([x_m]), np.array([y_m]), rotation_deg)

        # Nearest telemetry sample to this corner's marshal-sector position,
        # measured in the untransformed track frame (both are FastF1-native).
        dist_to_corner = np.hypot(tel["X"] / 10.0 - x_m, tel["Y"] / 10.0 - y_m)
        idx = int(np.argmin(dist_to_corner.values))
        window = tel.iloc[max(0, idx - 20) : idx + 20]

        brake_idx = window.index[window["Brake"] > 0]
        braking_point_dist = float(tel.loc[brake_idx[0], "Distance"]) if len(brake_idx) else None

        corners.append(
            {
                "number": int(corner["Number"]),
                "letter": corner.get("Letter", ""),
                "x": float(x_rot[0]),
                "y": float(y_rot[0]),
                "entrySpeedKph": float(window["Speed"].iloc[0]) if len(window) else None,
                "minSpeedKph": float(window["Speed"].min()) if len(window) else None,
                "apexDistanceM": float(tel.loc[idx, "Distance"]),
                "gear": int(tel.loc[idx, "nGear"]) if "nGear" in tel else None,
                "brakingPointDistanceM": braking_point_dist,
            }
        )
    return corners


def extract_drs_zones(fastest_lap) -> list[dict]:
    """Contiguous distance ranges where DRS is active on a flying lap."""
    tel = fastest_lap.get_telemetry()
    if "Distance" not in tel:
        tel = tel.add_distance()
    if "DRS" not in tel:
        return []

    active = tel["DRS"] >= 10  # FastF1: DRS values >=10 indicate open
    zones = []
    start = None
    for i, is_active in enumerate(active):
        if is_active and start is None:
            start = tel["Distance"].iloc[i]
        elif not is_active and start is not None:
            zones.append({"startM": float(start), "endM": float(tel["Distance"].iloc[i - 1])})
            start = None
    if start is not None:
        zones.append({"startM": float(start), "endM": float(tel["Distance"].iloc[-1])})
    return zones


def compute_pit_loss(laps) -> SourcedValue:
    """Empirical pit-loss time: median(in-lap + out-lap) minus 2 * median
    green-flag lap on comparable tyre, per docs/SPEC.md M1 — this is
    measured, never guessed. Returns None-valued SourcedValue (with
    sample_size 0) when there isn't enough data, so callers can render an
    explicit "not enough laps yet" state instead of a fabricated number.
    """
    accurate = laps.pick_accurate()
    green = accurate[accurate["TrackStatus"] == "1"] if "TrackStatus" in accurate else accurate
    if green.empty:
        return SourcedValue(value=None, source="insufficient green-flag laps", sample_size=0)

    baseline = float(green["LapTime"].dt.total_seconds().median())

    pit_laps = laps[laps["PitInTime"].notna() | laps["PitOutTime"].notna()]
    if pit_laps.empty:
        return SourcedValue(value=None, source="no pit stops recorded this session", sample_size=0)

    pit_total = pit_laps["LapTime"].dt.total_seconds().median()
    pit_loss = float(pit_total - 2 * baseline) if pit_total is not None else None

    return SourcedValue(
        value=pit_loss,
        source="median(in-lap + out-lap) - 2*median(green-flag lap), this session",
        sample_size=int(len(pit_laps)),
    )


def compute_standings_from_results(results_by_round: list[dict], points_system: dict) -> list[dict]:
    """Independently accumulate driver standings from per-round results
    using config/points_system.json, rather than trusting the API's
    standings endpoint outright. cross_check_standings() below is the
    safety net for this table having drifted from the real regulations
    (docs/SPEC.md M2)."""
    race_points = {int(k): v for k, v in points_system["race_points_by_position"].items()}
    sprint_points = {int(k): v for k, v in points_system["sprint_points_by_position"].items()}
    fastest_lap_points = points_system["fastest_lap_point"]["points"]

    totals: dict[str, dict] = {}

    for round_result in results_by_round:
        is_sprint = round_result.get("session") == "sprint"
        table = sprint_points if is_sprint else race_points

        for entry in round_result["results"]:
            code = entry["driverCode"]
            row = totals.setdefault(
                code,
                {
                    "driverCode": code,
                    "driverName": entry["driverName"],
                    "team": entry["team"],
                    "points": 0.0,
                    "wins": 0,
                    "_race_finishes": {},
                    "_sprint_finishes": {},
                },
            )
            row["team"] = entry["team"]  # keep current team on a mid-season change

            position = entry.get("position")
            pos_int = int(position) if position and position.isdigit() else None
            if pos_int in table:
                row["points"] += table[pos_int]
            if pos_int is not None:
                bucket = "_sprint_finishes" if is_sprint else "_race_finishes"
                row[bucket][pos_int] = row[bucket].get(pos_int, 0) + 1
            if pos_int == 1 and not is_sprint:
                row["wins"] += 1
            if not is_sprint and entry.get("fastestLapRank") == "1" and pos_int is not None and pos_int <= 10:
                row["points"] += fastest_lap_points

    # Ties break by FIA countback: most race wins, then most 2nds, and so
    # on down the classification (Sporting Regulations art. 7.2), with
    # sprint finishes as a further tier. The per-refresh cross-check
    # against the API standings is the arbiter for whether this matches
    # the season's actual regulation.
    def rank_key(row: dict):
        race = tuple(-row["_race_finishes"].get(p, 0) for p in range(1, 31))
        sprint = tuple(-row["_sprint_finishes"].get(p, 0) for p in range(1, 31))
        return (-row["points"], race, sprint)

    ranked = sorted(totals.values(), key=rank_key)
    for i, row in enumerate(ranked, start=1):
        row["position"] = i
        del row["_race_finishes"]
        del row["_sprint_finishes"]
    return ranked


def cross_check_standings(computed: list[dict], api_standings: list[dict]) -> dict:
    """Compare independently computed standings against the Jolpica-F1
    standings endpoint. Never silently prefer one — surface a mismatch as
    a warning banner in the UI (docs/SPEC.md M2)."""
    api_by_code = {s["driverCode"]: s for s in api_standings}
    mismatches = []
    for row in computed:
        api_row = api_by_code.get(row["driverCode"])
        if api_row is None:
            mismatches.append({"driverCode": row["driverCode"], "reason": "missing from API standings"})
        elif api_row["points"] != row["points"] or api_row["position"] != row["position"]:
            mismatches.append(
                {
                    "driverCode": row["driverCode"],
                    "computed": {"position": row["position"], "points": row["points"]},
                    "api": {"position": api_row["position"], "points": api_row["points"]},
                }
            )
    return {"mismatch": len(mismatches) > 0, "details": mismatches}


def build_stints(laps: list[dict], pitstops: list[dict], total_laps: int) -> list[dict]:
    """Per-driver stints inferred from pit-stop laps.

    A stop on lap N ends the stint that N belongs to; the next stint
    starts on N+1. This is the only stint signal available without the
    live-timing feed, and it carries a real limitation the UI must state:
    **no tyre compound**. Ergast/Jolpica publishes no compound data, so
    stints here are structural (when, how long) and never coloured by
    compound — inventing one would be exactly the fabricated state the
    project forbids.
    """
    stops_by_driver: dict[str, list[int]] = {}
    for stop in sorted(pitstops, key=lambda s: (s["driverId"], s["lap"])):
        stops_by_driver.setdefault(stop["driverId"], []).append(stop["lap"])

    laps_by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        laps_by_driver.setdefault(lap["driverId"], []).append(lap)

    stints = []
    for driver_id, driver_laps in laps_by_driver.items():
        driver_laps.sort(key=lambda entry: entry["lap"])
        last_lap = driver_laps[-1]["lap"] if driver_laps else total_laps
        boundaries = stops_by_driver.get(driver_id, [])

        start = 1
        for stint_number, stop_lap in enumerate(boundaries + [last_lap], start=1):
            end = stop_lap
            if end < start:
                continue
            in_stint = [entry for entry in driver_laps if start <= entry["lap"] <= end]
            stints.append(
                {
                    "driverId": driver_id,
                    "stint": stint_number,
                    "startLap": start,
                    "endLap": end,
                    "laps": end - start + 1,
                    "compound": None,
                    "compoundSource": "unavailable — Jolpica-F1 publishes no tyre compound data",
                    "lapTimesS": [entry["timeS"] for entry in in_stint],
                }
            )
            start = end + 1

    return stints


def cumulative_times(laps: list[dict]) -> dict[str, dict[int, float]]:
    """Elapsed race time per driver at the end of each lap.

    Summing lap times from lap 1 gives each driver's time since the
    start, so the difference between two drivers at the same lap is
    their real on-track gap in seconds. That is what makes an undercut
    measurable from a lap-time-only feed — no gap channel needed.

    A driver with any missing lap time has no elapsed time from that lap
    onward: the sum would silently under-count and turn a gap into
    fiction, so the series simply stops instead.
    """
    by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        by_driver.setdefault(lap["driverId"], []).append(lap)

    elapsed: dict[str, dict[int, float]] = {}
    for driver_id, driver_laps in by_driver.items():
        driver_laps.sort(key=lambda entry: entry["lap"])
        running = 0.0
        per_lap: dict[int, float] = {}
        for entry in driver_laps:
            if entry["timeS"] is None:
                break
            running += entry["timeS"]
            per_lap[entry["lap"]] = running
        elapsed[driver_id] = per_lap
    return elapsed


# A rival more than this far away before the stop was not in the fight,
# so a change in their gap is not an undercut outcome. Roughly one pit
# loss: closer than this and a stop can plausibly change the order.
UNDERCUT_RIVAL_WINDOW_S = 30.0
# Median lap time in the comparison window this far above the race
# median means the field was slowed (safety car, heavy traffic). The
# comparison is then contaminated, and there is no track-status channel
# to confirm it with, so the entry is flagged rather than dropped.
NEUTRALISED_WINDOW_FACTOR = 1.15
# A rival who stays out much longer than this is running a different
# strategy, not resisting an undercut; the laps in between accumulate
# every other thing that happens in a race.
MAX_UNDERCUT_WINDOW_LAPS = 10
# Beyond roughly four pit losses, the gap did not change because of a
# stop — it changed because someone retired, sat in the garage, or the
# race was red-flagged. Publishing that as a 20-minute "undercut" would
# be a fabricated claim about racing, so it is excluded and counted.
MAX_PLAUSIBLE_NET_S = 120.0


def build_undercut_ledger(laps: list[dict], pitstops: list[dict]) -> list[dict]:
    """Net time each pit stop won or lost against the cars actually being
    fought (docs/SPEC.md M4).

    For a stop by A on lap P, every rival B within
    UNDERCUT_RIVAL_WINDOW_S at lap P-1 who had not yet stopped is
    compared on the gap before A's stop and the gap once B has also
    stopped and completed a lap. The change is the net time A gained.
    Positive means A came out ahead of where they would have been.

    This is a measurement of what happened, not a claim about what
    would have happened otherwise: a driver can gain on a rival for
    reasons that have nothing to do with the stop, which is why the
    window is kept tight and neutralised periods are flagged.

    Returns {"entries": [...], "excluded": {reason: count}}. Pairs are
    excluded rather than published when the window cannot be about the
    stop — it runs too long, either driver stops again inside it, or the
    net swing is far beyond what any stop can produce (a retirement or a
    long repair sitting in the middle of it). The counts travel with the
    data so nothing is silently dropped.
    """
    elapsed = cumulative_times(laps)
    stops_by_driver: dict[str, list[int]] = {}
    for stop in sorted(pitstops, key=lambda s: (s["driverId"], s["lap"])):
        stops_by_driver.setdefault(stop["driverId"], []).append(stop["lap"])

    # Field median lap time per lap, to spot neutralised windows.
    times_by_lap: dict[int, list[float]] = {}
    for lap in laps:
        if lap["timeS"] is not None:
            times_by_lap.setdefault(lap["lap"], []).append(lap["timeS"])
    median_by_lap = {
        lap_no: sorted(values)[len(values) // 2] for lap_no, values in times_by_lap.items()
    }
    race_median = (
        sorted(median_by_lap.values())[len(median_by_lap) // 2] if median_by_lap else None
    )

    def gap(driver_a: str, driver_b: str, lap_no: int) -> float | None:
        a = elapsed.get(driver_a, {}).get(lap_no)
        b = elapsed.get(driver_b, {}).get(lap_no)
        if a is None or b is None:
            return None
        return b - a  # positive => A is ahead of B

    ledger = []
    excluded = {
        "window_too_long": 0,
        "another_stop_in_window": 0,
        "incomplete_lap_data": 0,
        "implausible_net": 0,
    }
    for driver_a, stop_laps in stops_by_driver.items():
        for stop_index, stop_lap in enumerate(stop_laps, start=1):
            before_lap = stop_lap - 1
            if before_lap < 1:
                continue

            for driver_b, rival_stops in stops_by_driver.items():
                if driver_b == driver_a:
                    continue
                # Only rivals who had not stopped yet when A stopped, and
                # who stop later — that is the shape of an undercut.
                later = [lap_no for lap_no in rival_stops if lap_no > stop_lap]
                already = [lap_no for lap_no in rival_stops if lap_no <= before_lap]
                if not later or already:
                    continue
                rival_stop = later[0]
                after_lap = rival_stop + 1

                gap_before = gap(driver_a, driver_b, before_lap)
                if gap_before is None or abs(gap_before) > UNDERCUT_RIVAL_WINDOW_S:
                    continue

                if after_lap - before_lap > MAX_UNDERCUT_WINDOW_LAPS:
                    excluded["window_too_long"] += 1
                    continue

                # A second stop by either car inside the window means the
                # gap change is the sum of several events, not this one.
                others = [
                    lap_no
                    for lap_no in stop_laps + rival_stops
                    if before_lap < lap_no <= after_lap
                    and lap_no not in (stop_lap, rival_stop)
                ]
                if others:
                    excluded["another_stop_in_window"] += 1
                    continue

                gap_after = gap(driver_a, driver_b, after_lap)
                if gap_after is None:
                    excluded["incomplete_lap_data"] += 1
                    continue

                if abs(gap_after - gap_before) > MAX_PLAUSIBLE_NET_S:
                    excluded["implausible_net"] += 1
                    continue

                window_medians = [
                    median_by_lap[lap_no]
                    for lap_no in range(before_lap, after_lap + 1)
                    if lap_no in median_by_lap
                ]
                neutralised = bool(
                    race_median
                    and window_medians
                    and (sorted(window_medians)[len(window_medians) // 2]
                         > race_median * NEUTRALISED_WINDOW_FACTOR)
                )

                ledger.append(
                    {
                        "driverId": driver_a,
                        "stop": stop_index,
                        "stopLap": stop_lap,
                        "rivalId": driver_b,
                        "rivalStopLap": rival_stop,
                        "comparedOverLaps": after_lap - before_lap,
                        "gapBeforeS": round(gap_before, 3),
                        "gapAfterS": round(gap_after, 3),
                        "netS": round(gap_after - gap_before, 3),
                        "aheadBefore": gap_before > 0,
                        "aheadAfter": gap_after > 0,
                        "neutralisedWindow": neutralised,
                    }
                )

    ledger.sort(key=lambda e: (e["stopLap"], e["driverId"], e["rivalId"]))
    return {"entries": ledger, "excluded": excluded}


def fit_stint_degradation(stint: dict, min_laps: int = 3) -> dict | None:
    """Fit lap time against tyre life across one stint.

    Excludes the in-lap and out-lap (the stint's first and last recorded
    laps) since both carry pit-lane time rather than pace, and excludes
    laps more than `OUTLIER_FACTOR` above the stint median, which is how
    safety-car and traffic laps present in a lap-time-only feed with no
    track-status channel to filter on.

    The fitted slope is **not** fuel-corrected: within a single stint,
    fuel burn and tyre degradation are both very close to linear in lap
    number and are therefore not separately identifiable from lap times
    alone. The returned slope is their sum, and `fuel_corrected: False`
    says so — config/model.json's fuel_effect_s_per_lap stays unfitted
    rather than being back-filled with a guess.
    """
    from models.deg_fit import fit_compound_degradation

    times = stint["lapTimesS"]
    usable = [(i + 1, t) for i, t in enumerate(times) if t is not None]
    # Drop out-lap (first) and in-lap (last) when the stint is long enough
    # to still leave a fit behind.
    if len(usable) >= min_laps + 2:
        usable = usable[1:-1]
    if len(usable) < min_laps:
        return None

    values = [t for _, t in usable]
    median_time = sorted(values)[len(values) // 2]
    OUTLIER_FACTOR = 1.07  # >7% off the stint median is not a green-flag lap
    kept = [(life, t) for life, t in usable if t <= median_time * OUTLIER_FACTOR]
    excluded = len(usable) - len(kept)
    if len(kept) < min_laps:
        return None

    fit = fit_compound_degradation(
        compound=stint["compound"] or "UNKNOWN",
        tyre_life=[life for life, _ in kept],
        lap_time_s=[t for _, t in kept],
        excluded_laps=excluded,
        exclusion_reason=(
            f"out/in laps removed; {excluded} lap(s) over {OUTLIER_FACTOR:.0%} of the "
            "stint median dropped as non-green-flag (no track-status channel available)"
        ),
    )
    out = fit.to_json()
    out["fuel_corrected"] = False
    out["fuel_note"] = (
        "slope combines tyre degradation and fuel burn; the two are not separately "
        "identifiable from lap times within one stint"
    )
    out["driverId"] = stint["driverId"]
    out["stint"] = stint["stint"]
    return out


def racing_line_channels(lap) -> dict:
    """Resample one lap's merged telemetry onto a fixed distance grid and
    return raw (unquantized) channel arrays keyed by common.LINE_CHANNELS
    name — export.py handles quantization and .bin/manifest writing."""
    from common import resample_by_distance

    tel = lap.get_telemetry()
    if "Distance" not in tel:
        tel = tel.add_distance()

    distance = tel["Distance"].values
    x_dm = tel["X"].values  # already decimetres, matches LINE_SCALE['x']=10
    y_dm = tel["Y"].values
    speed_x10 = tel["Speed"].values * 10
    throttle = tel["Throttle"].values
    brake = (tel["Brake"].values > 0).astype(float)
    gear = tel["nGear"].values if "nGear" in tel else np.zeros_like(distance)

    _, resampled = resample_by_distance(distance, x_dm, y_dm, speed_x10, throttle, brake, gear)
    names = ("x", "y", "speed", "throttle", "brake", "gear")
    return dict(zip(names, resampled))
