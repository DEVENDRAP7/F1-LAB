"""Write final static artifacts to public/data/ from ingested + derived
data, enforcing the payload budgets in docs/SPEC.md. Any write that breaks
a budget raises common.BudgetExceeded, which the refresh-data workflow
treats as a hard failure — the commit step never runs on a bad export.
"""
from __future__ import annotations

import json
from pathlib import Path

from common import (
    LINE_CHANNELS,
    LINE_SCALE,
    MAX_FILE_BYTES,
    MAX_RACING_LINE_BYTES,
    MAX_SESSION_BYTES,
    PUBLIC_DATA,
    check_file_budget,
    quantize_int16,
    upsert_manifest_driver,
    write_line_binary,
)


def export_season(season_config: dict) -> Path:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    path = PUBLIC_DATA / "season.json"
    path.write_text(json.dumps(
        {
            "year": season_config["year"],
            "calendar": season_config["calendar"],
            "entryList": season_config["entryList"],
            "generated_at": season_config["generated_at"],
        },
        indent=2,
    ))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_standings(standings: list[dict], generated_at: str, source_check: dict) -> Path:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    path = PUBLIC_DATA / "standings.json"
    path.write_text(json.dumps(
        {"standings": standings, "generated_at": generated_at, "source_check": source_check},
        indent=2,
    ))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_circuit(circuit_key: str, circuit_doc: dict) -> Path:
    out_dir = PUBLIC_DATA / "circuits"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{circuit_key}.json"
    path.write_text(json.dumps(circuit_doc, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_racing_line(year: int, round_: int, session_name: str, driver_code: str, channels: dict) -> Path:
    """Quantize resampled channel arrays to Int16 and write the .bin +
    manifest.json pair described in docs/SPEC.md 2.3."""
    out_dir = PUBLIC_DATA / str(year) / str(round_) / session_name / "lines"
    out_dir.mkdir(parents=True, exist_ok=True)

    quantized = {name: quantize_int16(arr, LINE_SCALE[name]) for name, arr in channels.items() if name in LINE_CHANNELS}

    bin_path = out_dir / f"{driver_code}.bin"
    point_count = write_line_binary(bin_path, quantized)
    check_file_budget(bin_path, MAX_RACING_LINE_BYTES)

    upsert_manifest_driver(out_dir / "manifest.json", driver_code, point_count)

    return bin_path


def export_race_laps(year: int, round_: int, payload: dict) -> Path:
    """Lap times, stints and degradation fits for one race, under the
    round's R session directory so the frontend lazy-loads it per round."""
    out_dir = PUBLIC_DATA / str(year) / str(round_) / "R"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "laps.json"
    path.write_text(json.dumps(payload, separators=(",", ":")))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_session_meta(year: int, round_: int, session_name: str, meta: dict) -> Path:
    out_dir = PUBLIC_DATA / str(year) / str(round_) / session_name
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "meta.json"
    path.write_text(json.dumps(meta, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def check_session_directory_budget(year: int, round_: int, session_name: str) -> None:
    """Sum every file under one session's directory against the 3 MB
    per-session lazy-load budget (docs/SPEC.md 2.3)."""
    from common import BudgetExceeded

    session_dir = PUBLIC_DATA / str(year) / str(round_) / session_name
    if not session_dir.exists():
        return
    total = sum(f.stat().st_size for f in session_dir.rglob("*") if f.is_file())
    if total > MAX_SESSION_BYTES:
        raise BudgetExceeded(
            f"{session_dir.relative_to(PUBLIC_DATA.parent.parent)} totals {total} bytes, "
            f"over the {MAX_SESSION_BYTES} byte per-session budget"
        )


def check_site_budget() -> None:
    from common import BudgetExceeded, MAX_SITE_BYTES

    total = sum(f.stat().st_size for f in PUBLIC_DATA.rglob("*") if f.is_file())
    if total > MAX_SITE_BYTES:
        raise BudgetExceeded(f"public/data totals {total} bytes, over the {MAX_SITE_BYTES} byte site budget")
