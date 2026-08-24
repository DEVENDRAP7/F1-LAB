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


def test_validation_against_actual_race_result():
    """The M5 publish gate (docs/SPEC.md): with the actual strategy, the
    model must reproduce the actual race time within ~1%. It can only run
    once the pipeline has exported fitted parameters and the actual
    result for at least one real 2026 race; until then it skips with the
    reason on record rather than silently passing."""
    candidates = list(PUBLIC_DATA.glob("2026/*/R/whatif_params.json"))
    if not candidates:
        pytest.skip(
            "no real race artifacts under public/data yet — the what-if model "
            "stays unpublishable until this test runs and passes (docs/SPEC.md M5)"
        )

    for params_path in candidates:
        payload = json.loads(params_path.read_text())
        params = payload["params"]
        actual_total_s = payload["actual_total_s"]
        totals = monte_carlo(params)
        model_median = median(totals)
        assert abs(model_median - actual_total_s) / actual_total_s < 0.01, (
            f"{params_path}: model median {model_median:.1f}s vs actual "
            f"{actual_total_s:.1f}s — drift exceeds 1%, nothing this model outputs is publishable"
        )
