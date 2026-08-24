"""What-If Engine reference implementation (M5, docs/SPEC.md).

    predicted_lap(i) = base_pace
                     + deg(compound, tyre_life)
                     + fuel_effect * fuel_laps_remaining(i)
                     - track_evolution * (i - 1)
                     + traffic_penalty(i)
                     (+ sc_lap_extra on safety-car laps, + pit loss on in-laps)

Reference-point convention: base_pace here is the pace on fresh tyres
with the tank at its end-of-race level, so remaining fuel *adds* time.
The spec's formula writes the fuel term with a minus sign against a
heavy-car reference; either convention is fine as long as it's published
with the fitted parameters, which this docstring is the source of truth
for.

STATUS — implemented but NOT wired into the site. The spec gates M5 on a
validation test: re-running with a driver's actual strategy must
reproduce their actual race time within ~1% and their real finishing
position. That test (tests/test_whatif_parity.py, validation case) skips
until the first real race's fitted parameters exist under public/data,
and until it passes, nothing this model outputs is publishable.

PARITY CONTRACT — src/lib/whatifModel.js is a line-for-line port of this
module and must stay one. Both run the committed fixture in
tests/fixtures/ and are asserted against the same expected output
(Python: tests/test_whatif_parity.py, JS: src/lib/whatifModel.test.js).
Every arithmetic statement here is written in the exact order the JS
mirror uses, so IEEE-754 doubles produce bit-identical results — do not
"clean up" expression grouping on one side only. The RNG is Park-Miller
MINSTD specifically because every intermediate (state * 48271 < 2^53)
stays exactly representable in a JS double.
"""
from __future__ import annotations

MODULUS = 2147483647
MULTIPLIER = 48271


class ParkMillerRng:
    """Minimal-standard LCG. Identical to the JS implementation; both
    sides draw in the same documented order (per iteration: one deg-rate
    sample per stint, then one pit-loss sample per stop)."""

    def __init__(self, seed: int):
        seed = seed % MODULUS
        if seed <= 0:
            seed += MODULUS - 1
        self.state = seed

    def next(self) -> float:
        self.state = (self.state * MULTIPLIER) % MODULUS
        return self.state / MODULUS


def validate_params(params: dict) -> None:
    strategy_laps = 0
    for stint in params["strategy"]:
        strategy_laps += stint["laps"]
    if strategy_laps != params["total_laps"]:
        raise ValueError(
            f"strategy covers {strategy_laps} laps but the race is {params['total_laps']} laps"
        )
    for stint in params["strategy"]:
        if stint["compound"] not in params["compounds"]:
            raise ValueError(f"no degradation parameters for compound {stint['compound']}")


def simulate_race(params: dict, stint_deg_rates: list[float], pit_losses: list[float]) -> dict:
    """One deterministic race given already-sampled per-stint deg rates
    and per-stop pit losses. Returns lap times and the total."""
    total_laps = params["total_laps"]
    base_pace = params["base_pace_s"]
    fuel_effect = params["fuel_effect_s_per_lap"]
    evolution = params["track_evolution_s_per_lap"]
    sc_laps = set(params.get("sc_laps", []))
    sc_extra = params.get("sc_lap_extra_s", 0.0)
    traffic = params.get("traffic_penalty_s", [])

    lap_times = []
    total_time = 0.0
    lap = 0

    for stint_index, stint in enumerate(params["strategy"]):
        compound = params["compounds"][stint["compound"]]
        rate = stint_deg_rates[stint_index]
        is_last_stint = stint_index == len(params["strategy"]) - 1

        for life in range(1, stint["laps"] + 1):
            lap += 1
            deg = compound["offset_s"] + rate * life + compound["quad_s_per_lap2"] * life * life
            lap_time = base_pace + deg
            lap_time = lap_time + fuel_effect * (total_laps - lap)
            lap_time = lap_time - evolution * (lap - 1)
            if lap - 1 < len(traffic):
                lap_time = lap_time + traffic[lap - 1]
            if lap in sc_laps:
                lap_time = lap_time + sc_extra
            if life == stint["laps"] and not is_last_stint:
                lap_time = lap_time + pit_losses[stint_index]
            lap_times.append(lap_time)
            total_time = total_time + lap_time

    return {"lap_times": lap_times, "total_time_s": total_time}


def monte_carlo(params: dict) -> list[float]:
    """Total race times across params['iterations'] runs, varying each
    stint's deg rate within its confidence interval and each stop's loss
    within its sigma (uniform on ±1, matching the JS mirror exactly)."""
    validate_params(params)
    rng = ParkMillerRng(params["seed"])
    n_stints = len(params["strategy"])
    n_stops = n_stints - 1

    totals = []
    for _ in range(params["iterations"]):
        stint_deg_rates = []
        for stint in params["strategy"]:
            compound = params["compounds"][stint["compound"]]
            u = rng.next()
            rate = compound["deg_rate_s_per_lap"] + (2.0 * u - 1.0) * compound["deg_rate_ci_s"]
            stint_deg_rates.append(rate)
        pit_losses = []
        for _ in range(n_stops):
            u = rng.next()
            loss = params["pit_loss_s"] + (2.0 * u - 1.0) * params["pit_loss_sigma_s"]
            pit_losses.append(loss)

        result = simulate_race(params, stint_deg_rates, pit_losses)
        totals.append(result["total_time_s"])

    return totals


def median(values: list[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0
