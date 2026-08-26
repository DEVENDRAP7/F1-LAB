"""Regression tests for the safety net that failed.

A rate-limited refresh once recomputed the championship from a subset of
rounds, the cross-check flagged every driver, and the gate published it
anyway. These tests pin the two behaviours that prevent a repeat: the
gate fails on a flagged or skipped cross-check, and the fit reliability
label accounts for explanatory power rather than sample count alone.
"""
import json

import pytest

import validate_export
from models.deg_fit import MIN_RELIABLE_R2, MIN_RELIABLE_SAMPLES, fit_compound_degradation


@pytest.fixture
def standings_file(tmp_path, monkeypatch):
    monkeypatch.setattr(validate_export, "PUBLIC_DATA", tmp_path)

    def write(source_check):
        payload = {"standings": [], "generated_at": "x"}
        if source_check is not None:
            payload["source_check"] = source_check
        (tmp_path / "standings.json").write_text(json.dumps(payload))

    return write


class TestStandingsGate:
    def test_passes_when_cross_check_agrees(self, standings_file):
        standings_file({"mismatch": False, "details": []})
        assert validate_export.check_standings_cross_check() == []

    def test_fails_on_a_flagged_mismatch(self, standings_file):
        standings_file(
            {"mismatch": True, "details": [{"driverCode": "ANT"}, {"driverCode": "NOR"}]}
        )
        errors = validate_export.check_standings_cross_check()
        assert len(errors) == 1
        assert "FAILED" in errors[0]
        assert "ANT" in errors[0]

    def test_fails_when_cross_check_was_skipped(self, standings_file):
        # "API unavailable, check skipped" must not count as a pass.
        standings_file({"mismatch": False, "details": [], "note": "API standings unavailable"})
        errors = validate_export.check_standings_cross_check()
        assert len(errors) == 1
        assert "not a passed check" in errors[0]

    def test_fails_when_cross_check_is_absent(self, standings_file):
        standings_file(None)
        assert len(validate_export.check_standings_cross_check()) == 1

    def test_no_standings_file_is_not_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(validate_export, "PUBLIC_DATA", tmp_path)
        assert validate_export.check_standings_cross_check() == []


class TestFitReliability:
    def test_noisy_fit_is_not_reliable_despite_many_laps(self):
        # 20 laps of pure scatter: plenty of samples, no real trend.
        tyre_life = list(range(1, 21))
        lap_time = [90.0, 91.5, 89.2, 92.1, 90.3, 88.9, 91.8, 90.1, 92.4, 89.5,
                    91.2, 90.8, 89.1, 92.0, 90.6, 91.1, 89.8, 90.4, 91.9, 90.2]

        fit = fit_compound_degradation("UNKNOWN", tyre_life, lap_time)
        payload = fit.to_json()

        assert fit.sample_count >= MIN_RELIABLE_SAMPLES
        assert fit.r_squared < MIN_RELIABLE_R2
        assert payload["reliable"] is False
        assert "below" in payload["reliability_reason"]

    def test_clean_trend_with_enough_laps_is_reliable(self):
        tyre_life = list(range(1, 21))
        lap_time = [90.0 + 0.08 * i for i in tyre_life]

        payload = fit_compound_degradation("UNKNOWN", tyre_life, lap_time).to_json()

        assert payload["reliable"] is True
        assert "R^2" in payload["reliability_reason"]

    def test_short_sample_is_not_reliable_even_with_perfect_fit(self):
        payload = fit_compound_degradation("UNKNOWN", [1, 2, 3], [90.0, 90.1, 90.2]).to_json()
        assert payload["reliable"] is False
        assert "usable laps" in payload["reliability_reason"]


class TestLapsSchemaVersioning:
    """A corrected model must reach rounds that were already exported.

    The first version of refresh_race_laps skipped any round whose
    laps.json existed, so a fix to the fit-reliability rule left 97 stale
    fits on disk still labelled "reliable". Export is now versioned.
    """

    def _round(self, tmp_path, monkeypatch, existing: dict | None):
        """A round on disk under a temporary public/data, with no network.

        Both halves of that matter, and the second one was learned the
        hard way. These tests only exercise the decision to rebuild, but
        `refresh_race_laps` goes on to fetch and export, and `export` holds
        its own reference to PUBLIC_DATA — redirecting run_refresh's alone
        left the write pointing at the repository. On CI, where the
        network works, this suite therefore re-exported round 1 into the
        real public/data with the fixture's raceName, and "X" was
        committed as the Australian Grand Prix on every refresh.
        """
        import export
        import ingest
        import run_refresh

        monkeypatch.setattr(run_refresh, "PUBLIC_DATA", tmp_path)
        monkeypatch.setattr(export, "PUBLIC_DATA", tmp_path)

        def no_network(*args, **kwargs):
            raise RuntimeError("network is not used by this test")

        monkeypatch.setattr(ingest, "fetch_laps", no_network)
        monkeypatch.setattr(ingest, "fetch_pitstops", no_network)

        out = tmp_path / "2026" / "1" / "R"
        out.mkdir(parents=True)
        if existing is not None:
            (out / "laps.json").write_text(json.dumps(existing))
        return run_refresh, out / "laps.json"

    def test_skips_a_round_already_at_the_current_version(self, tmp_path, monkeypatch, capsys):
        run_refresh, _ = self._round(
            tmp_path, monkeypatch,
            {"schemaVersion": run_refresh_version(), "raceName": "Australian Grand Prix",
             "compounds": {"attempted": True}},
        )
        run_refresh.refresh_race_laps(
            2026, {"round": 1, "raceName": "Australian Grand Prix"}
        )
        assert "skipping" in capsys.readouterr().out

    def test_re_exports_when_the_stored_race_name_no_longer_matches(
        self, tmp_path, monkeypatch, capsys
    ):
        """Round 1 sat in the repository named "X" — a name from a test
        fixture — because the version check alone had nothing to notice
        once the calendar was regenerated."""
        run_refresh, _ = self._round(
            tmp_path, monkeypatch,
            {"schemaVersion": run_refresh_version(), "raceName": "X",
             "compounds": {"attempted": True}},
        )
        run_refresh.refresh_race_laps(
            2026, {"round": 1, "raceName": "Australian Grand Prix"}
        )
        out = capsys.readouterr().out
        assert "no longer matches the calendar" in out
        assert "skipping" not in out

    def test_re_exports_a_round_written_at_an_older_version(self, tmp_path, monkeypatch, capsys):
        run_refresh, _ = self._round(tmp_path, monkeypatch, {"schemaVersion": 1})
        # The fetch is stubbed out, so it fails after deciding to rebuild
        # — the decision itself is what matters here.
        run_refresh.refresh_race_laps(2026, {"round": 1, "raceName": "X"})
        out = capsys.readouterr().out
        assert "re-exporting" in out
        assert "skipping" not in out

    def test_treats_an_unversioned_file_as_stale(self, tmp_path, monkeypatch, capsys):
        run_refresh, _ = self._round(tmp_path, monkeypatch, {"laps": []})
        run_refresh.refresh_race_laps(2026, {"round": 1, "raceName": "X"})
        assert "re-exporting" in capsys.readouterr().out


def run_refresh_version():
    import run_refresh

    return run_refresh.LAPS_SCHEMA_VERSION


class TestLineManifestIntegrity:
    """The gate that was missing when elevation arrived.

    A racing-line binary is exactly point count x channels x 2 bytes, so
    a manifest that disagrees with the file beside it is corruption
    rather than a judgement call — and it is invisible everywhere else:
    the pipeline was happy, the suite was green, and three rounds shipped
    reading every channel after x off by one.
    """

    def _round(self, tmp_path, monkeypatch, channels, point_count, size_bytes):
        import validate_export

        monkeypatch.setattr(validate_export, "PUBLIC_DATA", tmp_path)
        lines = tmp_path / "2026" / "12" / "R" / "lines"
        lines.mkdir(parents=True)
        (lines / "manifest.json").write_text(json.dumps({
            "channels": list(channels),
            "drivers": {"LEC": {"pointCount": point_count}},
        }))
        (lines / "LEC.bin").write_bytes(b"\x00" * size_bytes)
        return validate_export

    def test_a_matching_manifest_passes(self, tmp_path, monkeypatch):
        validate_export = self._round(
            tmp_path, monkeypatch, ["x", "y", "speed"], 100, 100 * 3 * 2)
        assert validate_export.check_line_manifests() == []

    def test_a_binary_with_an_extra_channel_fails(self, tmp_path, monkeypatch):
        validate_export = self._round(
            tmp_path, monkeypatch, ["x", "y", "speed"], 100, 100 * 4 * 2)
        errors = validate_export.check_line_manifests()
        assert len(errors) == 1
        assert "off by a channel" in errors[0]

    def test_a_missing_binary_fails(self, tmp_path, monkeypatch):
        validate_export = self._round(
            tmp_path, monkeypatch, ["x", "y", "speed"], 100, 100 * 3 * 2)
        (tmp_path / "2026" / "12" / "R" / "lines" / "LEC.bin").unlink()
        assert "is missing" in validate_export.check_line_manifests()[0]


class TestCircuitOutlineSession:
    """The atlas draws one outline per circuit, from the best lap available.

    Qualifying is that lap: low fuel, fresh tyres, the closest the data
    gets to the limit of the track, and what docs/SPEC.md asks for. So a
    qualifying trace replaces a race one and a race trace never overwrites
    a qualifying one — it fills in where qualifying has nothing.
    """

    def _circuits(self, tmp_path, monkeypatch, stored=None):
        import run_refresh

        monkeypatch.setattr(run_refresh, "PUBLIC_DATA", tmp_path)
        if stored is not None:
            out = tmp_path / "circuits"
            out.mkdir(parents=True)
            (out / "zandvoort.json").write_text(json.dumps(stored))
        return run_refresh

    def test_qualifying_always_writes(self, tmp_path, monkeypatch):
        run_refresh = self._circuits(
            tmp_path, monkeypatch, {"sessionName": "Q", "outline": [[0, 0]]})
        assert run_refresh._circuit_outline_should_be_written("zandvoort", "Q") is True

    def test_a_race_lap_fills_in_where_there_is_nothing(self, tmp_path, monkeypatch):
        run_refresh = self._circuits(tmp_path, monkeypatch)
        assert run_refresh._circuit_outline_should_be_written("zandvoort", "R") is True

    def test_a_race_lap_does_not_overwrite_a_qualifying_outline(self, tmp_path, monkeypatch):
        run_refresh = self._circuits(
            tmp_path, monkeypatch, {"sessionName": "Q", "outline": [[0, 0]]})
        assert run_refresh._circuit_outline_should_be_written("zandvoort", "R") is False

    def test_a_race_lap_replaces_an_older_race_outline(self, tmp_path, monkeypatch):
        run_refresh = self._circuits(
            tmp_path, monkeypatch, {"sessionName": "R", "outline": [[0, 0]]})
        assert run_refresh._circuit_outline_should_be_written("zandvoort", "R") is True

    def test_an_outline_from_before_sessions_were_recorded_is_replaced(
        self, tmp_path, monkeypatch
    ):
        """Files written before the atlas knew which session it drew carry
        no sessionName, and should not be mistaken for qualifying."""
        run_refresh = self._circuits(tmp_path, monkeypatch, {"outline": [[0, 0]]})
        assert run_refresh._circuit_outline_should_be_written("zandvoort", "R") is True


class TestSessionMatching:
    """Qualifying runs the day before a normal weekend and two days before
    a sprint one, so it needs more slack than a race does."""

    SESSIONS = [
        {"sessionKey": 1, "dateStart": "2026-08-21T13:00:00+00:00"},  # Friday
        {"sessionKey": 2, "dateStart": "2026-08-22T13:00:00+00:00"},  # Saturday
    ]

    def test_a_race_matches_only_its_own_day(self):
        import run_refresh

        found = run_refresh._match_openf1_session(
            {"date": "2026-08-23"}, self.SESSIONS[1:], slack_days=1)
        assert found["sessionKey"] == 2

        assert run_refresh._match_openf1_session(
            {"date": "2026-08-23"}, self.SESSIONS[:1], slack_days=1) is None

    def test_qualifying_reaches_back_far_enough_for_a_sprint_weekend(self):
        import run_refresh

        found = run_refresh._match_openf1_session(
            {"date": "2026-08-23"}, self.SESSIONS[:1],
            slack_days=run_refresh.QUALIFYING_MATCH_SLACK_DAYS)
        assert found["sessionKey"] == 1


class TestQualifyingCrossSource:
    """The only check in this project where two independent sources
    describe the same event.

    OpenF1 publishes the lap a racing line was traced from; Jolpica
    publishes what that driver's qualifying times officially were. On
    real data they agree to the millisecond across every published lap,
    so a disagreement means the wrong session was matched to a round or
    the wrong lap was picked out of it.
    """

    def _round(self, tmp_path, monkeypatch, traced_s, official="1:11.163"):
        import validate_export

        monkeypatch.setattr(validate_export, "PUBLIC_DATA", tmp_path)
        (tmp_path / "2026").mkdir(parents=True)
        (tmp_path / "2026" / "qualifying.json").write_text(json.dumps({
            "rounds": [{
                "round": 12,
                "results": [{"driverId": "norris", "code": "NOR",
                             "q1S": 72.695, "q2S": 71.628, "q3S": 71.163}],
            }],
        }))
        lines = tmp_path / "2026" / "12" / "Q" / "lines"
        lines.mkdir(parents=True)
        (lines / "manifest.json").write_text(json.dumps({
            "channels": ["x", "y", "speed"],
            "drivers": {},
            "laps": [{"code": "NOR", "lapTimeS": traced_s}],
        }))
        return validate_export

    def test_matching_times_pass(self, tmp_path, monkeypatch):
        validate_export = self._round(tmp_path, monkeypatch, 71.163)
        assert validate_export.check_qualifying_cross_source() == []

    def test_a_lap_from_the_wrong_session_fails(self, tmp_path, monkeypatch):
        validate_export = self._round(tmp_path, monkeypatch, 71.563)
        errors = validate_export.check_qualifying_cross_source()
        assert len(errors) == 1
        assert "does not match" in errors[0]

    def test_a_driver_with_no_official_row_is_not_invented(self, tmp_path, monkeypatch):
        """A line for someone the results do not carry is a gap, not a
        mismatch: there is nothing to compare it against."""
        validate_export = self._round(tmp_path, monkeypatch, 71.163)
        lines = tmp_path / "2026" / "12" / "Q" / "lines" / "manifest.json"
        manifest = json.loads(lines.read_text())
        manifest["laps"] = [{"code": "XXX", "lapTimeS": 60.0}]
        lines.write_text(json.dumps(manifest))
        assert validate_export.check_qualifying_cross_source() == []
