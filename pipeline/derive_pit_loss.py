"""Measured pit loss per circuit.

docs/SPEC.md asks the Circuit Atlas for per-circuit constants that carry
a source, and says pit loss is measured rather than guessed. This is that
measurement, and most of the work is deciding when it is not one.

WHERE THE NUMBER COMES FROM

Nothing new is fetched. The what-if fit already measures, per driver per
race, what a racing stop cost: the in-lap and out-lap each run slower
than that driver's fitted pace, and the sum of the two excesses is the
stop. Stops under a safety car are excluded there, because a stop taken
while the field is slow costs a different amount.

This reads those published figures back and asks whether the drivers at
one circuit agree with each other.

WHEN IT IS NOT A CIRCUIT CONSTANT

Two gates, both of which fire on real 2026 data.

Too few drivers. Shanghai published exactly one driver's stop, at 45.8s.
One stop is a story about one stop — a slow wheel gun, a queue in the pit
lane, a penalty served — and calling it "the pit loss at Shanghai" would
be inventing a circuit property out of an incident.

Too much disagreement. Silverstone has seventeen drivers and an
interquartile range of 11s on a 24s median. A figure the drivers do not
agree on is not a property of the pit lane; it is a distribution of what
happened to each of them, and publishing its middle as a constant would
hide exactly the thing that makes it useless. Miami's seventeen-percent
narrower spread is a circuit constant. Silverstone's is not.
"""
from __future__ import annotations

# A median over fewer drivers than this is a story about one stop.
MIN_DRIVERS = 5

# The interquartile range, as a share of the median, above which the
# drivers are taken to disagree. Set from the 2026 data: the circuits
# that agree land at 6-11%, the ones that do not at 45-47%. Nothing sits
# near the line, which is the good case for a threshold and also the
# reason not to read precision into it.
MAX_SPREAD_RATIO = 0.25


def _quantile(ordered: list[float], q: float) -> float:
    """Nearest-rank quantile. No interpolation: with seven samples the
    honest quartile is one of the samples, not a point between two."""
    if not ordered:
        raise ValueError("no values")
    index = min(len(ordered) - 1, int(q * len(ordered)))
    return ordered[index]


def summarise(values: list[float]) -> dict:
    """Median, quartiles and spread of one circuit's measured stops."""
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    median = ordered[mid] if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    q1 = _quantile(ordered, 0.25)
    q3 = _quantile(ordered, 0.75)
    return {
        "medianS": median,
        "q1S": q1,
        "q3S": q3,
        "minS": ordered[0],
        "maxS": ordered[-1],
        "drivers": n,
        "spreadRatio": (q3 - q1) / median if median else None,
    }


def assess(values: list[float], min_drivers: int = MIN_DRIVERS,
           max_spread_ratio: float = MAX_SPREAD_RATIO) -> dict:
    """One circuit's pit loss, or the reason there is not one."""
    if len(values) < min_drivers:
        return {
            "published": False,
            "drivers": len(values),
            "withheldReason": (
                f"{len(values)} driver(s) had a measurable racing stop here, and a median "
                f"over fewer than {min_drivers} is a story about one stop rather than a "
                "property of the pit lane"
            ),
        }

    stats = summarise(values)
    if stats["spreadRatio"] is not None and stats["spreadRatio"] > max_spread_ratio:
        return {
            "published": False,
            **stats,
            "withheldReason": (
                f"the middle half of {stats['drivers']} drivers spans "
                f"{stats['q1S']:.1f}-{stats['q3S']:.1f}s, which is "
                f"{stats['spreadRatio'] * 100:.0f}% of the median — above the "
                f"{max_spread_ratio * 100:.0f}% this project treats as agreement. What "
                "happened to each driver dominates whatever the pit lane costs"
            ),
        }

    return {"published": True, **stats}


def driver_losses(whatif: dict) -> list[float]:
    """Every positive measured stop loss in one race's what-if document.

    Zero means that driver had no stop the fit could measure — every one
    of theirs was under a safety car, or outside the window the fit
    accepts — and a zero pit loss is an absence, not a fast stop.
    """
    out = []
    for entry in (whatif.get("drivers") or {}).values():
        value = ((entry or {}).get("params") or {}).get("pit_loss_s")
        if isinstance(value, (int, float)) and value > 0:
            out.append(float(value))
    return out


def build(year: int, circuits: list[dict], generated_at: str, source: str) -> dict:
    published = [c for c in circuits if c["pitLoss"]["published"]]
    return {
        "year": year,
        "generated_at": generated_at,
        "source": source,
        "circuits": circuits,
        "publishedCount": len(published),
        "withheldCount": len(circuits) - len(published),
        "limitations": LIMITATIONS,
    }


LIMITATIONS = [
    "A stop is measured as how much slower the in-lap and out-lap ran "
    "than that driver's own fitted pace, added together. It is therefore "
    "everything the stop cost — the pit lane, the stationary time, the "
    "traffic on the way out — and not the pit lane's own delta.",
    "Stops taken under a safety car are excluded by the fit that "
    "measures them, because a stop while the field is slow costs a "
    "different amount and mixing the two would describe neither.",
    "The figure is a median across the drivers who had a measurable "
    "racing stop at that circuit, and the quartiles are published beside "
    "it. Where the drivers disagree by more than a quarter of the "
    "median, no figure is published at all.",
    "One race per circuit so far. A circuit visited in a later season "
    "would be a different measurement, not more samples of this one: pit "
    "lane limits, layouts and cars all change.",
    "It rests on the same fitted pace the what-if engine uses, so a "
    "round where that fit was not published carries no pit loss here "
    "either.",
]
