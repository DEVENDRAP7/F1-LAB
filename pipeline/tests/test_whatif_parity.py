"""Parity + behavior tests for the What-If reference model.

The committed expected file is the parity anchor: the JS port
(src/lib/whatifModel.js, tested by src/lib/whatifModel.test.js) is
asserted against the *same* file, so a drift on either side of the port
fails one suite or the other. Tolerances are 1e-9 s on multi-thousand-
second totals — effectively bit-equality, which the shared Park-Miller
RNG and mirrored statement ordering are designed to guarantee.
"""
import json
from pathlib import Path

import pytest

from models.whatif import ParkMillerRng, median, monte_carlo, simulate_race, validate_params

FIXTURES = Path(__file__).parent / "fixtures"
PUBLIC_DATA = Path(__file__).resolve().parent.parent.parent / "public" / "data"


def load_fixture():
    return json.loads((FIXTURES / "whatif_fixture.json").read_text())


def test_monte_carlo_matches_committed_expected_output():
    params = load_fixture()
    expected = json.loads((FIXTURES / "whatif_expected.json").read_text())

    totals = monte_carlo(params)

    assert len(totals) == expected["iterations"]
    for actual, want in zip(totals[:3], expected["first_totals_s"]):
        assert abs(actual - want) < 1e-9
    assert abs(totals[-1] - expected["last_total_s"]) < 1e-9
    assert abs(median(totals) - expected["median_total_s"]) < 1e-9


def test_rng_is_deterministic_and_in_range():
    a = ParkMillerRng(12345)
    b = ParkMillerRng(12345)
    for _ in range(1000):
        u = a.next()
        assert u == b.next()
        assert 0.0 <= u < 1.0


def test_simulate_race_lap_count_and_pit_loss_placement():
    params = load_fixture()
    rates = [c["deg_rate_s_per_lap"] for c in
             (params["compounds"][s["compound"]] for s in params["strategy"])]
    result = simulate_race(params, rates, [params["pit_loss_s"]])

    assert len(result["lap_times"]) == params["total_laps"]
    assert abs(sum(result["lap_times"]) - result["total_time_s"]) < 1e-9

    # The in-lap of stint 1 (lap 20) carries the pit loss; lap 21 does not.
    assert result["lap_times"][19] - result["lap_times"][20] > params["pit_loss_s"] * 0.9


def test_validate_params_rejects_wrong_lap_count():
    params = load_fixture()
    params["strategy"][0]["laps"] += 1
    with pytest.raises(ValueError, match="58 laps"):
        validate_params(params)


def _exported_whatif():
    return sorted(PUBLIC_DATA.glob("2026/*/R/whatif.json"))


def test_validation_against_actual_race_result():
    """The M5 publish gate (docs/SPEC.md): replaying a driver's actual
    strategy must reproduce their actual race time within ~1%.

    Every driver the pipeline marked `validated` is re-simulated here from
    the exported parameters. A driver who does not clear the bar is not a
    failure — the export keeps them, unvalidated, and the page refuses to
    offer them a counterfactual — but a driver marked validated who does
    not reproduce is a broken gate, and fails.
    """
    exports = _exported_whatif()
    if not exports:
        pytest.skip(
            "no whatif.json exported yet — the what-if model stays unpublishable "
            "until this test runs and passes (docs/SPEC.md M5)"
        )

    checked = 0
    for path in exports:
        payload = json.loads(path.read_text())
        for driver_id, entry in payload["drivers"].items():
            if not entry["validation"]["validated"]:
                continue
            model_median = median(monte_carlo(entry["params"]))
            actual = entry["actualTotalS"]
            error = abs(model_median - actual) / actual
            assert error < 0.01, (
                f"{path.parent.parent.name}/{driver_id}: model median "
                f"{model_median:.1f}s vs actual {actual:.1f}s ({error:.2%}) — "
                "marked validated but does not reproduce the race"
            )
            checked += 1

    assert checked > 0, (
        "no driver-race cleared the 1% gate in any exported round, so nothing "
        "this model outputs is publishable"
    )


def test_unvalidated_drivers_are_kept_with_their_error():
    """A driver the model cannot reproduce is recorded, not deleted: the
    page needs the error to explain why it is offering them nothing."""
    exports = _exported_whatif()
    if not exports:
        pytest.skip("no whatif.json exported yet")

    for path in exports:
        payload = json.loads(path.read_text())
        for entry in payload["drivers"].values():
            validation = entry["validation"]
            assert "errorPct" in validation
            assert isinstance(validation["validated"], bool)
            assert validation["thresholdPct"] == 1.0


def test_suspended_races_are_skipped_with_a_reason():
    """A red flag leaves the clock running with the cars stationary. The
    model has no term for that, and the export says so rather than
    publishing a race total it cannot reach."""
    for path in _exported_whatif():
        payload = json.loads(path.read_text())
        if payload["drivers"]:
            continue
        assert payload["skipped"], f"{path} has no drivers and no reason"
