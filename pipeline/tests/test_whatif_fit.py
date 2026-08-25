"""Cover the what-if fit against a race whose parameters are known.

A fit is only worth publishing if it can recover numbers that were put in
on purpose, so most of this file builds a synthetic race from stated
parameters and checks the fit finds them again. The rest covers the two
answers that matter more than any coefficient: "these two effects are not
separable here" and "this race was suspended", both of which have to come
back as a refusal rather than a number.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models.whatif import median, monte_carlo  # noqa: E402
from models.whatif_fit import (  # noqa: E402
    fit_race,
    fit_race_params,
    neutralised_laps,
    race_was_suspended,
)

# Six cars, because a lap is only called neutralised on the evidence of
# the field: the detector wants at least five cars to have set a time on
# a lap before it will say anything about that lap at all.
BASE = {"HAM": 90.0, "LEC": 90.4, "NOR": 90.9, "PIA": 91.1, "RUS": 91.4, "ALO": 91.8}
DEG = {"SOFT": 0.09, "HARD": 0.04}
OFFSET = {"SOFT": 0.0, "HARD": 0.55}
FUEL = 0.055
PIT_LOSS = 21.0
START_LOSS = 5.0
TOTAL_LAPS = 50


def synthetic_race(stop_plan: dict[str, list[tuple[int, str]]]):
    """Lap times generated from the parameters above, exactly.

    `stop_plan` maps a driver to their stints as (laps, compound), so
    different drivers can be given genuinely different strategies — which
    is the whole reason a field-wide fit can separate tyre life from fuel
    load at all.
    """
    laps = []
    stints = []
    for driver, plan in stop_plan.items():
        lap = 0
        for stint_number, (stint_laps, compound) in enumerate(plan, start=1):
            start_lap = lap + 1
            for life in range(1, stint_laps + 1):
                lap += 1
                time = (
                    BASE[driver]
                    + OFFSET[compound]
                    + DEG[compound] * life
                    + FUEL * (TOTAL_LAPS - lap)
                )
                if lap == 1:
                    time += START_LOSS
                if life == stint_laps and stint_number < len(plan):
                    time += PIT_LOSS / 2.0  # in-lap
                if life == 1 and stint_number > 1:
                    time += PIT_LOSS / 2.0  # out-lap
                laps.append({"lap": lap, "driverId": driver, "timeS": time})
            stints.append({
                "driverId": driver,
                "stint": stint_number,
                "startLap": start_lap,
                "endLap": lap,
                "laps": stint_laps,
                "compound": compound,
            })
    return laps, stints


VARIED_PLAN = {
    "HAM": [(18, "SOFT"), (32, "HARD")],
    "LEC": [(24, "SOFT"), (26, "HARD")],
    "NOR": [(14, "HARD"), (36, "SOFT")],
    "PIA": [(21, "SOFT"), (29, "HARD")],
    "RUS": [(30, "HARD"), (20, "SOFT")],
    "ALO": [(16, "SOFT"), (34, "HARD")],
}


def test_fit_recovers_the_parameters_it_was_built_from():
    laps, stints = synthetic_race(VARIED_PLAN)
    fit = fit_race(laps, stints, TOTAL_LAPS, neutralised=set())
    assert fit is not None

    assert fit.fuel_effect == pytest.approx(FUEL, abs=0.005)
    for compound, rate in DEG.items():
        assert fit.compounds[compound]["deg_rate_s_per_lap"] == pytest.approx(rate, abs=0.005)
    # Pace differences between drivers are what the per-driver term is
    # for, and they have to survive the shared terms.
    assert fit.base_pace["LEC"] - fit.base_pace["HAM"] == pytest.approx(0.4, abs=0.02)
    assert fit.base_pace["NOR"] - fit.base_pace["HAM"] == pytest.approx(0.9, abs=0.02)


def test_identical_strategies_leave_tyre_life_and_fuel_inseparable():
    """Within a stint, tyre life counts up exactly as fuel counts down.
    If every driver runs the same stint boundaries on the same compounds,
    nothing in the race breaks that tie, and the honest answer is a
    refusal rather than whichever split the solver lands on.
    """
    same = {driver: [(20, "SOFT"), (30, "HARD")] for driver in BASE}
    laps, stints = synthetic_race(same)
    assert fit_race(laps, stints, TOTAL_LAPS, neutralised=set()) is None

    result = fit_race_params(laps, stints, TOTAL_LAPS)
    assert result["drivers"] == {}
    assert "not separately identifiable" in result["skipped"]


def test_replaying_the_real_strategy_reproduces_the_real_race():
    """The publish gate itself, on data where the answer is known."""
    laps, stints = synthetic_race(VARIED_PLAN)
    result = fit_race_params(laps, stints, TOTAL_LAPS)
    assert result["drivers"], result.get("skipped")

    for driver_id, built in result["drivers"].items():
        model = median(monte_carlo(built["params"]))
        actual = built["actualTotalS"]
        assert abs(model - actual) / actual < 0.01, driver_id


def test_measured_pit_loss_matches_what_was_put_in():
    laps, stints = synthetic_race(VARIED_PLAN)
    result = fit_race_params(laps, stints, TOTAL_LAPS)
    built = result["drivers"]["HAM"]
    assert built["params"]["pit_loss_s"] == pytest.approx(PIT_LOSS, abs=0.5)
    assert built["params"]["traffic_penalty_s"][0] == pytest.approx(START_LOSS, abs=0.5)


def test_suspended_race_is_refused_rather_than_modelled():
    """A red flag runs the clock with the cars stationary: round 12 of
    this season carries a 1758-second lap. Nothing in the model describes
    that, so the race is left out with the reason recorded."""
    laps, stints = synthetic_race(VARIED_PLAN)
    for lap in laps:
        if lap["lap"] == 7:
            lap["timeS"] = 1758.0

    assert race_was_suspended(laps) == pytest.approx(1758.0)
    result = fit_race_params(laps, stints, TOTAL_LAPS)
    assert result["drivers"] == {}
    assert "suspended" in result["skipped"]


def test_neutralised_laps_come_from_the_field_not_one_driver():
    laps, stints = synthetic_race(VARIED_PLAN)
    # One driver's slow lap is that driver's problem...
    for lap in laps:
        if lap["lap"] == 11 and lap["driverId"] == "LEC":
            lap["timeS"] += 40
    assert 11 not in neutralised_laps(laps, TOTAL_LAPS)

    # ...the whole field slowing is the race being neutralised.
    for lap in laps:
        if lap["lap"] == 20:
            lap["timeS"] += 40
    assert 20 in neutralised_laps(laps, TOTAL_LAPS)


def test_a_driver_who_did_not_finish_is_not_offered():
    """Their total is the time to a retirement, not a race time, and
    checking a model against it would compare two different things."""
    laps, stints = synthetic_race(VARIED_PLAN)
    laps = [l for l in laps if not (l["driverId"] == "NOR" and l["lap"] > 40)]
    result = fit_race_params(laps, stints, TOTAL_LAPS)
    assert "NOR" not in result["drivers"]
    assert "HAM" in result["drivers"]
