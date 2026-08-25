"""Shared paths, constants and pure-math helpers for the ingest/derive/export
pipeline. Nothing in this module touches the network — see ingest.py for
the only place FastF1/Jolpica-F1 are called.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
CONFIG_DIR = REPO_ROOT / "config"
FASTF1_CACHE_DIR = REPO_ROOT / "pipeline" / ".cache"

SEASON_YEAR = 2026

# Payload budgets from docs/SPEC.md — enforced by export.py and by the
# `budget-check` CI step so a bloated artifact fails the workflow instead
# of silently landing on Pages.
MAX_SITE_BYTES = 300 * 1024 * 1024
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_SESSION_BYTES = 3 * 1024 * 1024
MAX_RACING_LINE_BYTES = 60 * 1024

# Racing-line channel layout. Order here is authoritative: export.py packs
# channels in this order and writes it into every manifest.json so the JS
# decoder never has to guess it.
LINE_CHANNELS = ("x", "y", "z", "speed", "throttle", "brake", "gear")
LINE_SCALE = {
    "x": 10,        # decimetres -> metres
    "y": 10,
    # Elevation, in the same unit as x and y. Published only for a lap
    # where the feed's z actually varies — see derive_telemetry.
    "z": 10,
    "speed": 10,    # km/h * 10
    "throttle": 1,  # 0-100
    "brake": 1,     # 0/1 bitmask
    "gear": 1,
}

# Fixed distance spacing for racing-line resampling (docs/SPEC.md 2.3):
# turns a ~5 km lap into ~2,500 points instead of ~50,000 timestamped
# samples.
LINE_RESAMPLE_SPACING_M = 2.0


class BudgetExceeded(RuntimeError):
    """Raised when a written artifact breaks a payload budget. This must
    hard-fail the refresh-data workflow rather than let a bloated commit
    land on Pages (docs/SPEC.md)."""


def check_file_budget(path: Path, max_bytes: int = MAX_FILE_BYTES) -> None:
    size = path.stat().st_size
    if size > max_bytes:
        try:
            label = path.relative_to(REPO_ROOT)
        except ValueError:
            label = path
        raise BudgetExceeded(f"{label} is {size} bytes, over the {max_bytes} byte budget")


def resample_by_distance(distance, *channels, spacing=LINE_RESAMPLE_SPACING_M):
    """Resample one or more channels (each a sequence aligned to `distance`)
    onto a fixed-spacing distance grid via linear interpolation.

    `distance` must be monotonically increasing (FastF1's `add_distance()`
    output on a single lap satisfies this). Returns (new_distance, [new_channel, ...]).
    """
    import numpy as np

    distance = np.asarray(distance, dtype=float)
    if distance.size < 2:
        raise ValueError("need at least 2 samples to resample")

    total = distance[-1] - distance[0]
    n_points = max(2, int(total // spacing) + 1)
    grid = distance[0] + np.arange(n_points) * spacing
    grid = grid[grid <= distance[-1]]

    resampled = []
    for ch in channels:
        ch = np.asarray(ch, dtype=float)
        resampled.append(np.interp(grid, distance, ch))
    return grid, resampled


def quantize_int16(values, scale: float):
    """Scale physical units into an Int16-safe integer range and clip
    instead of silently wrapping on overflow, since a wrapped speed/x/y
    value would corrupt the line without any visible error at runtime.
    """
    import numpy as np

    scaled = np.round(np.asarray(values, dtype=float) * scale)
    return np.clip(scaled, -32768, 32767).astype("<i2")


def write_line_binary(path: Path, channel_arrays: dict) -> int:
    """Interleave channel arrays in LINE_CHANNELS order and write a raw
    little-endian Int16 .bin file. Returns point count."""
    order = [channel_arrays[name] for name in LINE_CHANNELS if name in channel_arrays]
    point_count = len(order[0])
    interleaved = bytearray(point_count * len(order) * 2)
    for i in range(point_count):
        for ch_idx, arr in enumerate(order):
            offset = (i * len(order) + ch_idx) * 2
            struct.pack_into("<h", interleaved, offset, int(arr[i]))
    path.write_bytes(bytes(interleaved))
    return point_count


def upsert_manifest_driver(path: Path, driver_code: str, point_count: int,
                           channels=LINE_CHANNELS, scale=None) -> None:
    """Merge one driver's entry into the session's line manifest. Each
    driver's lap has its own point count (laps differ slightly in sampled
    length), so the manifest carries a per-driver map rather than a single
    pointCount — a bare rewrite per driver would clobber every earlier
    entry and leave the JS decoder misreading all but the last .bin."""
    scale = scale or LINE_SCALE
    if path.exists():
        manifest = json.loads(path.read_text())
    else:
        manifest = {
            "channels": list(channels),
            "scale": {k: scale[k] for k in channels},
            "drivers": {},
        }
    manifest["drivers"][driver_code] = {"pointCount": point_count}
    path.write_text(json.dumps(manifest, indent=2))


@dataclass
class SourcedValue:
    """Wraps a derived/config constant with the source it came from, per
    the "every field carries a source string" rule for circuit constants
    (docs/SPEC.md M1)."""

    value: float
    source: str
    sample_size: int | None = None

    def to_json(self) -> dict:
        d = {"value": self.value, "source": self.source}
        if self.sample_size is not None:
            d["sample_size"] = self.sample_size
        return d
