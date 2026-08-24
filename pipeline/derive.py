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
                code, {"driverCode": code, "driverName": entry["driverName"], "team": entry["team"], "points": 0.0, "wins": 0}
            )
            row["team"] = entry["team"]  # keep current team on a mid-season change

            position = entry.get("position")
            pos_int = int(position) if position and position.isdigit() else None
            if pos_int in table:
                row["points"] += table[pos_int]
            if pos_int == 1:
                row["wins"] += 1
            if not is_sprint and entry.get("fastestLapRank") == "1" and pos_int is not None and pos_int <= 10:
                row["points"] += fastest_lap_points

    ranked = sorted(totals.values(), key=lambda r: (-r["points"], -r["wins"]))
    for i, row in enumerate(ranked, start=1):
        row["position"] = i
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
