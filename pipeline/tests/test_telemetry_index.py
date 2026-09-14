"""The telemetry index: what the site knows before it asks for anything.

The index exists so no page has to probe the exported tree to find out
what is in it. Its elevation field is the newest reason: the landing
page's 3D view can only draw a lap whose elevation channel survived
derive_telemetry.elevation_summary, and before this it fetched all
thirteen session manifests to work out which those were — thirteen round
trips to answer one question, which is exactly the probing the index was
written to stop.
"""

import json

import pytest

import export
import run_refresh


@pytest.fixture
def published(tmp_path, monkeypatch):
    """A published tree under tmp_path, with both modules pointed at it.

    export.py holds its own PUBLIC_DATA reference, so redirecting only
    run_refresh's would let the export escape into the repository's real
    data — see the session-wide guard in conftest.py, which exists
    because that happened.
    """
    monkeypatch.setattr(run_refresh, "PUBLIC_DATA", tmp_path)
    monkeypatch.setattr(export, "PUBLIC_DATA", tmp_path)
    return tmp_path


def write_manifest(root, round_, session, manifest):
    path = root / "2026" / str(round_) / session / "lines" / "manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest))
    return path


def read_index(root):
    return json.loads((root / "2026" / "telemetry.json").read_text())


def test_carries_a_usable_elevation_channel_into_the_index(published):
    write_manifest(published, 10, "Q", {
        "drivers": {"VER": {"pointCount": 3000}},
        "sessionLabel": "qualifying",
        "elevation": {
            "usable": True,
            "rangeM": 102.4,
            "minM": 365.5,
            "maxM": 467.9,
            "source": "OpenF1 position z",
        },
    })

    run_refresh.refresh_telemetry_index(2026)
    entry = read_index(published)["rounds"]["10"]["Q"]

    assert entry["elevation"]["usable"] is True
    assert entry["elevation"]["rangeM"] == 102.4


def test_carries_a_refusal_and_the_reason_for_it(published):
    # A refused channel has to be reported as refused, not omitted: the
    # view needs to be able to say why a round is missing rather than
    # silently not offering it.
    write_manifest(published, 1, "Q", {
        "drivers": {"NOR": {"pointCount": 3000}},
        "elevation": {
            "usable": False,
            "rangeM": 2.49,
            "reason": "the elevation channel varies by only 2.5m over the lap",
        },
    })

    run_refresh.refresh_telemetry_index(2026)
    entry = read_index(published)["rounds"]["1"]["Q"]

    assert entry["elevation"]["usable"] is False
    assert "2.5m" in entry["elevation"]["reason"]


def test_omits_the_field_where_a_manifest_has_no_elevation_at_all(published):
    # Absent is not the same as refused. A session exported before the
    # elevation summary existed carries no judgement either way, and the
    # index must not invent one — `usable: false` here would report a
    # refusal the pipeline never made.
    write_manifest(published, 4, "R", {"drivers": {"HAM": {"pointCount": 10}}})

    run_refresh.refresh_telemetry_index(2026)
    entry = read_index(published)["rounds"]["4"]["R"]

    assert "elevation" not in entry


def test_does_not_repeat_the_judgement_the_pipeline_already_made(published):
    # The index copies; it never re-derives. A manifest claiming a usable
    # channel over a tiny range is the pipeline's business to fix, and
    # the index must report what the manifest says rather than applying
    # a second, divergent threshold of its own.
    write_manifest(published, 5, "Q", {
        "drivers": {"PIA": {"pointCount": 3000}},
        "elevation": {"usable": True, "rangeM": 0.4},
    })

    run_refresh.refresh_telemetry_index(2026)

    assert read_index(published)["rounds"]["5"]["Q"]["elevation"]["usable"] is True


def test_still_lists_the_fields_the_index_already_carried(published):
    write_manifest(published, 6, "R", {
        "drivers": {},
        "sessionLabel": "the race",
        "unavailable": True,
        "reason": "the position feed had nothing usable",
    })

    run_refresh.refresh_telemetry_index(2026)
    entry = read_index(published)["rounds"]["6"]["R"]

    assert entry["drivers"] == []
    assert entry["unavailable"] is True
    assert entry["sessionLabel"] == "the race"


def test_the_note_says_the_index_now_covers_elevation(published):
    # The note is what a reader of the raw artifact has to go on.
    write_manifest(published, 2, "Q", {"drivers": {"LEC": {"pointCount": 1}}})

    run_refresh.refresh_telemetry_index(2026)

    assert "elevation" in read_index(published)["note"]
