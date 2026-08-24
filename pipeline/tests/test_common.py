import json

import numpy as np

from common import (
    LINE_CHANNELS,
    quantize_int16,
    resample_by_distance,
    upsert_manifest_driver,
    write_line_binary,
)


def test_resample_by_distance_preserves_endpoints_and_spacing():
    distance = np.linspace(0, 100, 501)  # 0.2 m native spacing
    speed = np.sin(distance / 10.0) * 50 + 200

    grid, (resampled_speed,) = resample_by_distance(distance, speed, spacing=2.0)

    assert grid[0] == distance[0]
    assert grid[-1] <= distance[-1]
    assert np.allclose(np.diff(grid), 2.0)
    # interpolated values should stay within the original signal's range
    assert resampled_speed.max() <= speed.max() + 1e-6
    assert resampled_speed.min() >= speed.min() - 1e-6


def test_quantize_int16_clips_instead_of_wrapping():
    values = np.array([0, 3200, -3200, 100000, -100000])
    out = quantize_int16(values, scale=1)
    assert out.dtype == np.dtype("<i2")
    assert out[3] == 32767  # clipped, not wrapped negative
    assert out[4] == -32768


def test_write_line_binary_roundtrips_with_manifest(tmp_path):
    point_count = 10
    channels = {
        "x": quantize_int16(np.arange(point_count), 10),
        "y": quantize_int16(np.zeros(point_count), 10),
        "speed": quantize_int16(np.full(point_count, 250), 10),
        "throttle": quantize_int16(np.full(point_count, 100), 1),
        "brake": quantize_int16(np.zeros(point_count), 1),
        "gear": quantize_int16(np.full(point_count, 8), 1),
    }
    bin_path = tmp_path / "HAM.bin"
    manifest_path = tmp_path / "manifest.json"

    written_count = write_line_binary(bin_path, channels)
    upsert_manifest_driver(manifest_path, "HAM", written_count)

    assert written_count == point_count
    raw = np.frombuffer(bin_path.read_bytes(), dtype="<i2")
    assert raw.size == point_count * len(LINE_CHANNELS)

    # first channel (x) was quantized at scale=10 (metres -> decimetres),
    # so it should read back as 0, 10, 20, ... at stride len(channels)
    x_values = raw[0 :: len(LINE_CHANNELS)]
    assert list(x_values) == [i * 10 for i in range(point_count)]


def test_manifest_upsert_keeps_other_drivers(tmp_path):
    manifest_path = tmp_path / "manifest.json"
    upsert_manifest_driver(manifest_path, "HAM", 2500)
    upsert_manifest_driver(manifest_path, "VER", 2512)
    upsert_manifest_driver(manifest_path, "HAM", 2501)  # re-export updates in place

    manifest = json.loads(manifest_path.read_text())
    assert manifest["channels"] == list(LINE_CHANNELS)
    assert manifest["drivers"]["HAM"]["pointCount"] == 2501
    assert manifest["drivers"]["VER"]["pointCount"] == 2512
