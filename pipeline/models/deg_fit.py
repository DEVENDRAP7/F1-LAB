"""Tyre degradation model (M4, docs/SPEC.md):

    lap_time ~= base + deg_rate * tyre_life (+ quadratic term if it
    meaningfully improves R^2)

Fitted per compound per event on green-flag, non-in/out laps with the
fuel effect removed first. The fit is published in full — coefficients,
R^2, sample count and exclusions — because a curve from a handful of laps
is not a curve, and the UI has to be able to say so.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class DegradationFit:
    compound: str
    base_s: float
    deg_rate_s_per_lap: float
    quadratic_term: float | None
    r_squared: float
    sample_count: int
    excluded_laps: int
    exclusion_reason: str

    def to_json(self) -> dict:
        return {
            "compound": self.compound,
            "base_s": self.base_s,
            "deg_rate_s_per_lap": self.deg_rate_s_per_lap,
            "quadratic_term": self.quadratic_term,
            "r_squared": self.r_squared,
            "sample_count": self.sample_count,
            "excluded_laps": self.excluded_laps,
            "exclusion_reason": self.exclusion_reason,
            "reliable": self.sample_count >= MIN_RELIABLE_SAMPLES,
        }


MIN_RELIABLE_SAMPLES = 6
QUADRATIC_R2_IMPROVEMENT_THRESHOLD = 0.03


def fuel_corrected_lap_time(lap_time_s: np.ndarray, lap_number: np.ndarray, fuel_effect_s_per_lap: float,
                             race_total_laps: int) -> np.ndarray:
    """Remove the fuel-burn effect so what remains is attributable to tyre
    degradation only. `fuel_effect_s_per_lap` comes from config/model.json
    (a documented derivation, never a magic number — docs/SPEC.md M4)."""
    laps_of_fuel_remaining = race_total_laps - lap_number
    return lap_time_s - fuel_effect_s_per_lap * laps_of_fuel_remaining


def fit_compound_degradation(
    compound: str,
    tyre_life: np.ndarray,
    lap_time_s: np.ndarray,
    excluded_laps: int = 0,
    exclusion_reason: str = "in/out laps and non-green-flag laps removed upstream",
) -> DegradationFit:
    tyre_life = np.asarray(tyre_life, dtype=float)
    lap_time_s = np.asarray(lap_time_s, dtype=float)
    n = len(tyre_life)

    if n < 3:
        return DegradationFit(
            compound=compound,
            base_s=float(np.mean(lap_time_s)) if n else None,
            deg_rate_s_per_lap=None,
            quadratic_term=None,
            r_squared=None,
            sample_count=n,
            excluded_laps=excluded_laps,
            exclusion_reason=f"only {n} usable laps — {exclusion_reason}",
        )

    linear_coeffs = np.polyfit(tyre_life, lap_time_s, 1)
    linear_r2 = _r_squared(tyre_life, lap_time_s, linear_coeffs)

    quad_term = None
    best_coeffs = linear_coeffs
    best_r2 = linear_r2

    if n >= 5:
        quad_coeffs = np.polyfit(tyre_life, lap_time_s, 2)
        quad_r2 = _r_squared(tyre_life, lap_time_s, quad_coeffs)
        if quad_r2 - linear_r2 > QUADRATIC_R2_IMPROVEMENT_THRESHOLD:
            quad_term = float(quad_coeffs[0])
            best_coeffs = quad_coeffs
            best_r2 = quad_r2

    deg_rate = float(best_coeffs[-2])
    base = float(best_coeffs[-1])

    return DegradationFit(
        compound=compound,
        base_s=base,
        deg_rate_s_per_lap=deg_rate,
        quadratic_term=quad_term,
        r_squared=float(best_r2),
        sample_count=n,
        excluded_laps=excluded_laps,
        exclusion_reason=exclusion_reason,
    )


def _r_squared(x: np.ndarray, y: np.ndarray, coeffs: np.ndarray) -> float:
    predicted = np.polyval(coeffs, x)
    ss_res = float(np.sum((y - predicted) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    if ss_tot == 0:
        return 0.0
    return 1 - ss_res / ss_tot
