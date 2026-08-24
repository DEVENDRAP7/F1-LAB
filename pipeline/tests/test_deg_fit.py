import numpy as np

from models.deg_fit import MIN_RELIABLE_SAMPLES, fit_compound_degradation


def test_fit_recovers_known_linear_degradation():
    tyre_life = np.arange(1, 21)
    true_base, true_rate = 90.0, 0.08
    rng = np.random.default_rng(0)
    lap_time = true_base + true_rate * tyre_life + rng.normal(0, 0.01, size=tyre_life.size)

    fit = fit_compound_degradation("MEDIUM", tyre_life, lap_time)

    assert fit.sample_count == 20
    assert abs(fit.base_s - true_base) < 0.1
    assert abs(fit.deg_rate_s_per_lap - true_rate) < 0.01
    assert fit.r_squared > 0.99


def test_fit_marks_small_samples_unreliable():
    tyre_life = np.array([1, 2])
    lap_time = np.array([90.1, 90.2])

    fit = fit_compound_degradation("SOFT", tyre_life, lap_time)

    assert fit.sample_count < MIN_RELIABLE_SAMPLES
    assert fit.to_json()["reliable"] is False
    assert "usable laps" in fit.exclusion_reason
