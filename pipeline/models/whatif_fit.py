"""Fit the What-If model's parameters to a real race (M5, docs/SPEC.md).

The model in models/whatif.py has always existed; what it lacked was
numbers. This module produces them from the lap data the pipeline already
ingests, per driver per race, so the model can be checked against the
race it was fitted to before anything it says is published.

WHAT IS FITTED, AND FROM WHAT

    lap_time = base_pace(driver)
             + compound_offset(compound) + deg_rate(compound) * tyre_life
             + fuel_effect * laps_remaining

One least-squares fit over the whole field's green racing laps, not one
per driver. That is forced by the arithmetic, not chosen for convenience:
within any single stint, tyre life counts up by one exactly as laps
remaining counts down by one, so their sum is a constant that the stint's
own intercept absorbs. Fitted driver by driver the design matrix is rank
deficient — every single-stop race in this season's data came back
unfittable — and the fit is rejected rather than returning whichever
split of the two the solver happened to land on.

Fitted across the field it is identifiable, because different drivers ran
the same compound over different parts of the race. It is also the more
defensible model: fuel burn is a property of the car and the circuit and
tyre degradation is a property of the compound, so the field shares them,
while pace is the driver's own and stays a per-driver term.

WHAT IS NOT SEPARABLE, AND IS NOT PRETENDED TO BE

Track evolution is linear in lap number and so is fuel burn. One race
cannot tell them apart: any evolution rate can be traded against a fuel
rate for an identical fit. So track_evolution_s_per_lap is fixed at zero
and the fitted coefficient is published as what it is — fuel burn and
track evolution combined. Splitting it would need a number this project
has no source for.

WHAT IS MEASURED RATHER THAN FITTED

Pit loss is measured: the time the in-lap and out-lap actually cost
against what the fit says those laps should have taken green. Safety-car
laps and the standing start are measured the same way, as the excess over
what the fit predicts. None of these are free parameters chosen to close
the gap — they are observations of specific laps, and the validation
compares the assembled model against the race total afterwards.
"""
from __future__ import annotations

import numpy as np

# A lap whose field-median time is this far above the race's own green
# median was run behind a safety car, a virtual safety car or a red flag.
# The same factor derive.py uses for the undercut ledger, for the same
# reason: without a track-status channel for every round, the field's own
# pace is the only available witness.
NEUTRALISED_FACTOR = 1.15

# Below this many usable laps a compound's degradation slope is not a
# trend, and a race with fewer than this many green laps is not a race
# this model can be fitted to.
MIN_LAPS_PER_COMPOUND = 5
MIN_GREEN_LAPS = 20

# An Ergast pit-stop duration longer than this is not a pit stop: it is a
# red flag with the cars stationary in the pit lane. Round 12 publishes
# 1571 seconds for a "stop" on lap 2 for the whole field.
MAX_RACING_STOP_S = 120.0

# docs/SPEC.md sets the floor: a counterfactual is reported as a
# distribution, and a distribution from a couple of hundred runs is a
# shape with holes in it.
MONTE_CARLO_ITERATIONS = 1000

# The sport's own bands. A stint whose compound could not be matched gets
# a per-stint placeholder instead, and a placeholder belongs to the driver
# whose stint it came from: offering "the compound Norris was on for his
# third stint" as a choice in someone else's strategy would be inviting a
# reader to build a race out of an unknown.
KNOWN_COMPOUNDS = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"}

# A lap this many times the race's median lap time was not driven: the
# race was suspended and the cars were stationary in the pit lane.
SUSPENSION_FACTOR = 3.0


def neutralised_laps(laps: list[dict], total_laps: int) -> set[int]:
    """Laps where the whole field was slowed, from the field's own pace."""
    by_lap: dict[int, list[float]] = {}
    for lap in laps:
        if lap.get("timeS"):
            by_lap.setdefault(int(lap["lap"]), []).append(float(lap["timeS"]))

    medians = {lap: float(np.median(times)) for lap, times in by_lap.items() if len(times) >= 5}
    if not medians:
        return set()
    green_median = float(np.median(list(medians.values())))
    return {lap for lap, m in medians.items() if m > green_median * NEUTRALISED_FACTOR}


def _driver_stints(stints: list[dict], driver_id: str) -> list[dict]:
    return sorted(
        (s for s in stints if s["driverId"] == driver_id),
        key=lambda s: s["startLap"],
    )


def _compound_key(stint: dict) -> str:
    """The compound, or a per-stint placeholder when it is unknown.

    A placeholder keeps the stint in the fit with its own offset and its
    own slope, which is honest — "this stint, whatever it was on" — and
    never merges two unknown stints into one compound they may not share.
    """
    return stint.get("compound") or f"UNKNOWN-{stint['driverId']}-{stint['stint']}"


def _stint_index(driver_stints: list[dict]) -> tuple[dict, dict, set, set]:
    stint_of_lap: dict[int, dict] = {}
    life_of_lap: dict[int, int] = {}
    for stint in driver_stints:
        for offset, lap_number in enumerate(
            range(stint["startLap"], stint["endLap"] + 1), start=1
        ):
            stint_of_lap[lap_number] = stint
            life_of_lap[lap_number] = offset
    out_laps = {s["startLap"] for s in driver_stints[1:]}
    in_laps = {s["endLap"] for s in driver_stints[:-1]}
    return stint_of_lap, life_of_lap, out_laps, in_laps


class RaceFit:
    """The field-wide fit: shared tyre and fuel terms, per-driver pace."""

    def __init__(self, base_pace: dict[str, float], compounds: dict[str, dict],
                 fuel_effect: float, diagnostics: dict):
        self.base_pace = base_pace
        self.compounds = compounds
        self.fuel_effect = fuel_effect
        self.diagnostics = diagnostics

    def predict(self, driver_id: str, compound: str, life: int, lap: int,
                total_laps: int) -> float:
        c = self.compounds[compound]
        return (
            self.base_pace[driver_id]
            + c["offset_s"]
            + c["deg_rate_s_per_lap"] * life
            + self.fuel_effect * (total_laps - lap)
        )


def fit_race(laps: list[dict], stints: list[dict], total_laps: int,
             neutralised: set[int]) -> RaceFit | None:
    """Least squares over every driver's green racing laps."""
    drivers = sorted({s["driverId"] for s in stints})
    rows_meta = []  # (driver_id, compound, life, lap, time)

    for driver_id in drivers:
        driver_stints = _driver_stints(stints, driver_id)
        if not driver_stints:
            continue
        stint_of_lap, life_of_lap, out_laps, in_laps = _stint_index(driver_stints)
        for lap in laps:
            if lap["driverId"] != driver_id or not lap.get("timeS"):
                continue
            number = int(lap["lap"])
            if number == 1 or number in out_laps or number in in_laps:
                continue
            if number in neutralised or number not in stint_of_lap:
                continue
            rows_meta.append((
                driver_id,
                _compound_key(stint_of_lap[number]),
                life_of_lap[number],
                number,
                float(lap["timeS"]),
            ))

    if len(rows_meta) < MIN_GREEN_LAPS:
        return None

    # A compound seen on a handful of laps has no slope worth fitting, and
    # dropping it is better than letting five laps set a degradation rate
    # the page would then state as a number.
    counts: dict[str, int] = {}
    for _, compound, _, _, _ in rows_meta:
        counts[compound] = counts.get(compound, 0) + 1
    usable_compounds = sorted(c for c, n in counts.items() if n >= MIN_LAPS_PER_COMPOUND)
    if not usable_compounds:
        return None
    rows_meta = [r for r in rows_meta if r[1] in usable_compounds]

    fitted_drivers = sorted({r[0] for r in rows_meta})
    if len(rows_meta) < MIN_GREEN_LAPS or not fitted_drivers:
        return None

    n_d = len(fitted_drivers)
    n_c = len(usable_compounds)
    # Columns: one pace per driver, one degradation slope per compound,
    # one offset per compound except the reference (the driver terms
    # already carry a constant, so all of them would be redundant), and
    # the shared fuel term.
    width = n_d + n_c + (n_c - 1) + 1
    design = np.zeros((len(rows_meta), width))
    y = np.zeros(len(rows_meta))

    for r, (driver_id, compound, life, lap, time_s) in enumerate(rows_meta):
        design[r, fitted_drivers.index(driver_id)] = 1.0
        c = usable_compounds.index(compound)
        design[r, n_d + c] = life
        if c > 0:
            design[r, n_d + n_c + (c - 1)] = 1.0
        design[r, -1] = total_laps - lap
        y[r] = time_s

    coeffs, _, rank, _ = np.linalg.lstsq(design, y, rcond=None)
    if rank < width:
        # Every driver stopping on the same lap on the same compounds
        # leaves tyre life and fuel load inseparable even across the
        # field. There is no honest split to publish, so there is none.
        return None

    resid = y - design @ coeffs
    dof = max(1, len(rows_meta) - width)
    sigma2 = float(resid @ resid) / dof
    try:
        cov = sigma2 * np.linalg.inv(design.T @ design)
    except np.linalg.LinAlgError:
        return None
    errors = np.sqrt(np.clip(np.diag(cov), 0.0, None))

    compounds = {}
    for c, compound in enumerate(usable_compounds):
        compounds[compound] = {
            "offset_s": 0.0 if c == 0 else float(coeffs[n_d + n_c + (c - 1)]),
            "deg_rate_s_per_lap": float(coeffs[n_d + c]),
            "deg_rate_ci_s": float(errors[n_d + c]),
            "quad_s_per_lap2": 0.0,
            "sample_laps": counts[compound],
        }

    return RaceFit(
        base_pace={d: float(coeffs[i]) for i, d in enumerate(fitted_drivers)},
        compounds=compounds,
        fuel_effect=float(coeffs[-1]),
        diagnostics={
            "greenLaps": len(rows_meta),
            "driversInFit": n_d,
            "residualRmsS": float(np.sqrt(sigma2)),
            "fuelEffectStdErrS": float(errors[-1]),
        },
    )


def build_driver_params(fit: RaceFit, laps: list[dict], stints: list[dict],
                        driver_id: str, total_laps: int,
                        neutralised: set[int]) -> dict | None:
    """One driver's parameters, their actual strategy, and their real total."""
    if driver_id not in fit.base_pace:
        return None

    driver_laps = sorted(
        (l for l in laps if l["driverId"] == driver_id and l.get("timeS")),
        key=lambda l: l["lap"],
    )
    driver_stints = _driver_stints(stints, driver_id)
    if not driver_stints or len(driver_laps) != total_laps:
        # A driver who did not run every lap has no race total to check
        # the model against: theirs is the time to a retirement, or to
        # being lapped, and neither is the race this model describes.
        return None

    stint_of_lap, life_of_lap, _, _ = _stint_index(driver_stints)
    if any(_compound_key(s) not in fit.compounds for s in driver_stints):
        return None

    time_of = {int(l["lap"]): float(l["timeS"]) for l in driver_laps}

    def predict(lap_number: int) -> float:
        stint = stint_of_lap[lap_number]
        return fit.predict(
            driver_id, _compound_key(stint), life_of_lap[lap_number],
            lap_number, total_laps,
        )

    # Measured, not fitted: what a stop actually cost over and above what
    # the fit says the in-lap and out-lap should have taken green.
    stop_losses = []
    for stint in driver_stints[:-1]:
        in_lap = stint["endLap"]
        out_lap = in_lap + 1
        if in_lap not in time_of or out_lap not in time_of:
            continue
        if in_lap in neutralised or out_lap in neutralised:
            continue  # a stop under a safety car costs a different amount
        loss = (time_of[in_lap] - predict(in_lap)) + (time_of[out_lap] - predict(out_lap))
        if 0 < loss < MAX_RACING_STOP_S:
            stop_losses.append(loss)

    sc_laps = sorted(lap for lap in neutralised if 1 < lap <= total_laps and lap in time_of)
    sc_excess = [time_of[lap] - predict(lap) for lap in sc_laps]
    start_loss = time_of[1] - predict(1) if 1 in time_of else 0.0

    reference = next(iter(fit.compounds))
    own_placeholders = {
        _compound_key(s) for s in driver_stints if _compound_key(s) not in KNOWN_COMPOUNDS
    }
    params = {
        "total_laps": total_laps,
        "base_pace_s": fit.base_pace[driver_id],
        "fuel_effect_s_per_lap": fit.fuel_effect,
        # Track evolution and fuel burn are both linear in lap number, so
        # one race cannot tell them apart. The whole coefficient is
        # published as fuel, and this zero is the statement that no
        # evolution rate was separately identified.
        "track_evolution_s_per_lap": 0.0,
        "compounds": {
            key: dict(value)
            for key, value in fit.compounds.items()
            if key in KNOWN_COMPOUNDS or key in own_placeholders
        },
        "strategy": [
            {"compound": _compound_key(s), "laps": s["laps"]} for s in driver_stints
        ],
        "pit_loss_s": float(np.median(stop_losses)) if stop_losses else 0.0,
        "pit_loss_sigma_s": float(np.std(stop_losses)) if len(stop_losses) > 1 else 0.0,
        "sc_laps": sc_laps,
        "sc_lap_extra_s": float(np.median(sc_excess)) if sc_excess else 0.0,
        # Lap 1 only. A standing start costs time no term in the model
        # describes, and it is measured on the lap it happened.
        "traffic_penalty_s": [float(start_loss)],
        "iterations": MONTE_CARLO_ITERATIONS,
        "seed": 20260101 + total_laps,
    }
    if reference:
        params["reference_compound"] = reference

    return {
        "params": params,
        "actualTotalS": sum(time_of[lap] for lap in range(1, total_laps + 1) if lap in time_of),
        "measured": {
            "stops": len(stop_losses),
            "pitLossS": params["pit_loss_s"],
            "startLossS": params["traffic_penalty_s"][0],
            "neutralisedLapsRun": len(sc_laps),
        },
    }


def race_was_suspended(laps: list[dict]) -> float | None:
    """The longest lap time, when the race was stopped rather than run.

    A red flag leaves the cars stationary and the clock running: round 12
    of this season carries a 1758-second lap 3. Nothing in this model
    describes a suspension, and a race total that contains one is not a
    quantity the model can be checked against — so such a race is left
    out, with the lap time that caused it on record.
    """
    times = [float(l["timeS"]) for l in laps if l.get("timeS")]
    if not times:
        return None
    green_median = float(np.median(times))
    longest = max(times)
    return longest if longest > green_median * SUSPENSION_FACTOR else None


def fit_race_params(laps: list[dict], stints: list[dict], total_laps: int) -> dict:
    """Per-driver what-if parameters for one race, or the reason there are none."""
    suspended = race_was_suspended(laps)
    if suspended is not None:
        return {
            "drivers": {},
            "skipped": (
                f"the race was suspended — a lap of {suspended:.0f}s was run with the "
                "cars stationary, and no term in this model describes a red flag"
            ),
        }

    neutralised = neutralised_laps(laps, total_laps)
    fit = fit_race(laps, stints, total_laps, neutralised)
    if fit is None:
        return {
            "drivers": {},
            "skipped": (
                "tyre life and fuel load are not separately identifiable in this race: "
                "no compound was run over enough different parts of it"
            ),
        }

    drivers = {}
    for driver_id in sorted({s["driverId"] for s in stints}):
        built = build_driver_params(fit, laps, stints, driver_id, total_laps, neutralised)
        if built:
            drivers[driver_id] = built

    return {
        "drivers": drivers,
        "fit": fit.diagnostics,
        "neutralisedLaps": sorted(neutralised),
    }
