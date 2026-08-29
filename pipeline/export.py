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


def export_standings(standings: list[dict], generated_at: str, source_check: dict,
                     progression: list[dict] | None = None,
                     elimination: dict | None = None) -> Path:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    path = PUBLIC_DATA / "standings.json"
    payload = {"standings": standings, "generated_at": generated_at, "source_check": source_check}
    if progression is not None:
        payload["progression"] = progression
    if elimination is not None:
        payload["elimination"] = elimination
    path.write_text(json.dumps(payload, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_upcoming(payload: dict) -> Path:
    """The Upcoming Race Brief: the next round plus priors from past
    editions of its circuit. One small file at a fixed path, because the
    page that reads it does not know which round is next until it has
    read it."""
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    path = PUBLIC_DATA / "upcoming.json"
    path.write_text(json.dumps(payload, indent=2))
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

    # The manifest declares the channels this round actually wrote, not
    # every channel the project knows about: elevation is published only
    # where the feed's z varies, and a manifest promising a channel the
    # binary does not carry reads every later channel off by one.
    written = tuple(name for name in LINE_CHANNELS if name in quantized)
    upsert_manifest_driver(
        out_dir / "manifest.json", driver_code, point_count, channels=written)

    return bin_path


def export_qualifying(year: int, payload: dict) -> Path:
    """The season's qualifying results and the team-mate head-to-head."""
    out_dir = PUBLIC_DATA / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "qualifying.json"
    path.write_text(json.dumps(payload, separators=(",", ":")))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_sprint(year: int, payload: dict) -> Path:
    """The season's sprint weekends: both races of each, side by side."""
    out_dir = PUBLIC_DATA / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "sprint.json"
    path.write_text(json.dumps(payload, separators=(",", ":")))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_pit_loss(year: int, payload: dict) -> Path:
    """Measured pit loss per circuit, and the circuits with none."""
    out_dir = PUBLIC_DATA / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "pitloss.json"
    path.write_text(json.dumps(payload, separators=(",", ":")))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def _export_year_doc(year: int, name: str, payload: dict) -> Path:
    out_dir = PUBLIC_DATA / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps(payload, separators=(",", ":")))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_conditions(year: int, payload: dict) -> Path:
    """Session conditions, from two sources and the check between them."""
    return _export_year_doc(year, "conditions.json", payload)


def export_overtakes(year: int, payload: dict) -> Path:
    """Position changes per race, with the feed's own gaps measured."""
    return _export_year_doc(year, "overtakes.json", payload)


def export_radio(year: int, payload: dict) -> Path:
    """Broadcast team-radio metadata. Links only — no audio, no transcripts."""
    return _export_year_doc(year, "radio.json", payload)


def export_refusals(year: int, ledger: dict) -> Path:
    """The ledger of everything the site declined to publish."""
    out_dir = PUBLIC_DATA / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "refusals.json"
    path.write_text(json.dumps(ledger, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_telemetry_index(year: int, index: dict) -> Path:
    """One listing of which sessions have racing lines, and which do not.

    Without it every page has to probe: request a manifest, catch the 404,
    try the round before. That works, and it fills the console with
    failures that look like bugs while quietly asking the network for
    files nobody expects to exist. The site should know what it has.
    """
    out_dir = PUBLIC_DATA / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "telemetry.json"
    path.write_text(json.dumps(index, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_lines_unavailable(year: int, round_: int, session_name: str,
                             payload: dict) -> Path:
    """Write a lines manifest that says there are no lines, and why.

    Absence and refusal look identical to a frontend that only sees a 404,
    and they are not the same thing: "the backfill has not reached this
    round" and "the position feed has nothing usable for this race" are
    different facts, and only one of them will change on its own.
    """
    out_dir = PUBLIC_DATA / str(year) / str(round_) / session_name / "lines"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "manifest.json"
    manifest = {"channels": [], "scale": {}, "drivers": {}}
    manifest.update(payload)
    path.write_text(json.dumps(manifest, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def annotate_line_manifest(year: int, round_: int, session_name: str, extra: dict) -> Path:
    """Merge session-level metadata into a lines manifest.

    Kept separate from upsert_manifest_driver, which owns the per-driver
    point counts: this writes the facts that belong to the session as a
    whole — the measured position unit, which lap each line is, and what
    the source does not provide. Merging rather than replacing matters
    because the per-driver entries are written first and must survive.
    """
    path = PUBLIC_DATA / str(year) / str(round_) / session_name / "lines" / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    manifest.update(extra)
    path.write_text(json.dumps(manifest, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_error_review(year: int, round_: int, payload: dict) -> Path:
    """Per-round Driver Error Review, under the round's R session dir so
    the frontend loads it only for the round being read."""
    out_dir = PUBLIC_DATA / str(year) / str(round_) / "R"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "errors.json"
    path.write_text(json.dumps(payload, indent=2))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


def export_whatif(year: int, round_: int, payload: dict) -> Path:
    """Fitted what-if parameters for one race, per driver.

    Written even when no driver could be fitted: the payload then carries
    the reason, and the page says why there is nothing to run rather than
    rendering as though the round had not happened yet.
    """
    out_dir = PUBLIC_DATA / str(year) / str(round_) / "R"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "whatif.json"
    path.write_text(json.dumps(payload, separators=(",", ":")))
    check_file_budget(path, MAX_FILE_BYTES)
    return path


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
