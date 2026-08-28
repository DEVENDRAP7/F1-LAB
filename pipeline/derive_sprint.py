"""Sprint weekends: two races, one circuit, two days apart.

A third of this calendar is a sprint weekend, and until now the site
showed only the grand prix. That threw away the one comparison this
format makes available and no other weekend does: the same drivers, the
same cars and the same piece of track, racing twice from two different
grids within about twenty-four hours.

WHAT IS COMPUTED

Positions changed. For each race, the mean of |finish - grid| over the
drivers classified in it. It is a count of places, not a count of
overtakes: a place can change at a pit stop, at a retirement ahead, or
in a penalty applied after the flag, and this source publishes no
overtake feed to separate those. The number of laps travels with it,
because a shorter race has less time in which to change anything.

Rank agreement. Spearman's rho between sprint finishing position and
grand prix finishing position for the drivers classified in both, per
round. Ranks are averaged over ties and rho is Pearson's correlation on
those ranks, which is the definition rather than an approximation of it.

WHAT IS NOT CLAIMED

Rho is not a prediction. A high value says the two orders agreed that
weekend, not that the sprint told anyone what Sunday would do; the same
car being quick twice in two days is the least surprising reason for two
orders to agree. It is reported per round with its own n, and withheld
below MIN_CORRELATION_N, because a rho over four drivers is a shape, not
a measurement.

A driver who did not finish has a classified position in the results
feed but not a racing outcome, so retirements are excluded from both the
movement means and the correlation, and the counts say how many were
excluded rather than quietly shrinking the sample.
"""
from __future__ import annotations

import math

# Ergast's status convention, which Jolpica inherits: a classified
# finisher reads "Finished" or "+N Lap(s)". Everything else - a
# retirement, a disqualification, a car that never started - is a
# status string naming the cause. Matching the two positive forms is
# safer than trying to enumerate the causes, which are open-ended.
FINISHED = "Finished"
LAPPED_PREFIX = "+"
LAPPED_SUFFIX = ("Lap", "Laps")

# Below this many drivers a rank correlation is not reported at all.
# Five is not a magic number and is not a claim that six is enough; it
# is the point below which the statistic is more sensitive to one
# retirement than to anything that happened on track.
MIN_CORRELATION_N = 5


def classified(status: str | None) -> bool:
    """Whether a results row is a driver who finished the race."""
    if not status:
        return False
    if status == FINISHED:
        return True
    if not status.startswith(LAPPED_PREFIX):
        return False
    return status.rstrip(".").split(" ")[-1] in LAPPED_SUFFIX


def ranks(values: list[float]) -> list[float]:
    """Ranks, ties averaged.

    Two drivers cannot share a finishing position, but this is also used
    on grid positions, where a shared penalty or a pit-lane start can
    put two cars on the same number in the feed.
    """
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[order[k]] = shared
        i = j + 1
    return out


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """Spearman's rho: Pearson's r computed on averaged ranks.

    None when there are too few points, or when either side has no
    spread at all - a correlation with a zero denominator is not zero,
    it is undefined, and returning 0.0 there would read as "no
    relationship" when the truth is "no question was asked".
    """
    if len(xs) != len(ys) or len(xs) < MIN_CORRELATION_N:
        return None
    rx, ry = ranks(xs), ranks(ys)
    mx = sum(rx) / len(rx)
    my = sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    dy = math.sqrt(sum((b - my) ** 2 for b in ry))
    if dx == 0 or dy == 0:
        return None
    # Clamped because the arithmetic can land a hair outside the range
    # the statistic is defined on, and a published "rho = 1.0000000002"
    # invites a reader to wonder what it means rather than reading it as
    # the perfect agreement it is.
    return max(-1.0, min(1.0, num / (dx * dy)))


def movement(rows: list[dict], grid_key: str, finish_key: str, classified_key: str) -> dict:
    """Mean places changed between the grid and the flag.

    Grid position 0 in this feed means a pit-lane start, which has no
    grid slot to measure a change from, so those rows are counted as
    excluded rather than treated as "started first".
    """
    used = [
        r for r in rows
        if r.get(classified_key)
        and isinstance(r.get(grid_key), int) and r[grid_key] > 0
        and isinstance(r.get(finish_key), int) and r[finish_key] > 0
    ]
    if not used:
        return {"meanAbsolute": None, "sample": 0, "excluded": len(rows)}
    total = sum(abs(r[finish_key] - r[grid_key]) for r in used)
    return {
        "meanAbsolute": total / len(used),
        "sample": len(used),
        "excluded": len(rows) - len(used),
    }


def _index(results: list[dict]) -> dict[str, dict]:
    return {r["driverCode"]: r for r in results if r.get("driverCode")}


def _position(row: dict) -> int | None:
    value = row.get("position")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def build_round(round_info: dict, sprint: list[dict], race: list[dict]) -> dict:
    """One sprint weekend: both results joined on the driver code."""
    sprint_by_code = _index(sprint)
    race_by_code = _index(race)
    codes = sorted(set(sprint_by_code) | set(race_by_code))

    drivers = []
    for code in codes:
        s = sprint_by_code.get(code, {})
        r = race_by_code.get(code, {})
        drivers.append({
            "driverCode": code,
            "driverName": s.get("driverName") or r.get("driverName"),
            "team": s.get("team") or r.get("team"),
            "sprintGrid": s.get("grid"),
            "sprintFinish": _position(s) if s else None,
            "sprintStatus": s.get("status"),
            "sprintClassified": classified(s.get("status")),
            "sprintPoints": s.get("points"),
            "raceGrid": r.get("grid"),
            "raceFinish": _position(r) if r else None,
            "raceStatus": r.get("status"),
            "raceClassified": classified(r.get("status")),
            "racePoints": r.get("points"),
        })

    # Rho over the drivers classified in both races only. A driver who
    # retired from one of them has no pair of racing outcomes to
    # correlate, and dropping them is the honest sample, not a filter
    # chosen to move the number.
    both = [
        d for d in drivers
        if d["sprintClassified"] and d["raceClassified"]
        and d["sprintFinish"] and d["raceFinish"]
    ]
    rho = spearman(
        [float(d["sprintFinish"]) for d in both],
        [float(d["raceFinish"]) for d in both],
    )

    return {
        "round": round_info["round"],
        "raceName": round_info["raceName"],
        "circuitId": round_info.get("circuitId"),
        "date": round_info.get("date"),
        "drivers": drivers,
        "sprintLaps": max((s.get("laps") or 0) for s in sprint) if sprint else 0,
        "raceLaps": max((r.get("laps") or 0) for r in race) if race else 0,
        "sprintMovement": movement(drivers, "sprintGrid", "sprintFinish", "sprintClassified"),
        "raceMovement": movement(drivers, "raceGrid", "raceFinish", "raceClassified"),
        "rankAgreement": {
            "rho": rho,
            "n": len(both),
            "withheldReason": None if rho is not None else (
                f"only {len(both)} driver(s) were classified in both races; "
                f"a rank correlation is not reported below {MIN_CORRELATION_N}"
            ),
        },
        "sprintPoints": sum((d["sprintPoints"] or 0) for d in drivers),
        "racePoints": sum((d["racePoints"] or 0) for d in drivers),
    }


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def build_season(rounds: list[dict]) -> dict:
    """What holds across the sprint weekends run so far.

    Rho is summarised as the median of the per-round values, not as one
    correlation over every driver-round pooled together. Pooling would
    treat "P3 at one circuit" and "P3 at another" as the same
    observation and would let a round with more classified finishers
    outvote one with fewer; the median says what a typical sprint
    weekend did, which is the question.
    """
    rhos = [r["rankAgreement"]["rho"] for r in rounds if r["rankAgreement"]["rho"] is not None]
    sprint_means = [
        r["sprintMovement"]["meanAbsolute"] for r in rounds
        if r["sprintMovement"]["meanAbsolute"] is not None
    ]
    race_means = [
        r["raceMovement"]["meanAbsolute"] for r in rounds
        if r["raceMovement"]["meanAbsolute"] is not None
    ]

    by_driver: dict[str, dict] = {}
    for round_ in rounds:
        for d in round_["drivers"]:
            row = by_driver.setdefault(d["driverCode"], {
                "driverCode": d["driverCode"],
                "driverName": d["driverName"],
                "team": d["team"],
                "sprintPoints": 0.0,
                "racePoints": 0.0,
            })
            row["driverName"] = row["driverName"] or d["driverName"]
            row["team"] = d["team"] or row["team"]
            row["sprintPoints"] += d["sprintPoints"] or 0
            row["racePoints"] += d["racePoints"] or 0
    for row in by_driver.values():
        weekend = row["sprintPoints"] + row["racePoints"]
        row["weekendPoints"] = weekend
        # Share of the points a driver took from these weekends that came
        # from the sprint. Not a share of their season: this document only
        # sees sprint rounds, and dividing by a total it cannot see would
        # be a number about data that is not here.
        row["sprintShare"] = (row["sprintPoints"] / weekend) if weekend else None

    scorers = sorted(
        (r for r in by_driver.values() if r["weekendPoints"] > 0),
        key=lambda r: (-r["weekendPoints"], r["driverCode"]),
    )

    return {
        "roundsRun": len(rounds),
        "medianRho": _median(rhos) if rhos else None,
        "rhoRoundsCounted": len(rhos),
        "sprintMeanPlacesChanged": (sum(sprint_means) / len(sprint_means)) if sprint_means else None,
        "raceMeanPlacesChanged": (sum(race_means) / len(race_means)) if race_means else None,
        "movementRoundsCounted": min(len(sprint_means), len(race_means)),
        "pointsByDriver": scorers,
    }


LIMITATIONS = [
    "Places changed is |finish - grid|, not a count of overtakes. This "
    "source publishes no overtake feed, so a place taken at a pit stop, "
    "inherited from a retirement ahead, or applied as a penalty after "
    "the flag all count the same as one made on track.",
    "A sprint and a grand prix are different lengths. The lap count of "
    "each is printed beside its movement figure rather than dividing one "
    "by the other: places per lap would imply the two scale together, "
    "and nothing here establishes that they do.",
    "Rho is Spearman's rank correlation between the two finishing "
    f"orders, over drivers classified in both races, withheld below "
    f"{MIN_CORRELATION_N}. It measures agreement between two orders that "
    "already happened. It is not a forecast, and the ordinary reason two "
    "orders agree is that the same cars were quick on both days.",
    "Retirements are excluded from every figure here. A results feed "
    "gives a retired driver a finishing position, but that position is "
    "an ordering of who stopped when, not a racing outcome.",
    "Grid position 0 means a pit-lane start in this feed. Those rows "
    "have no grid slot to measure a change from and are excluded from "
    "the movement means, counted in the excluded column instead.",
    "Points here are the points scored on sprint weekends only. The "
    "sprint share is a share of that, not of a driver's season - this "
    "document does not see the rounds that are not sprint rounds.",
]


def build(year: int, rounds: list[dict], generated_at: str, source: str) -> dict:
    return {
        "year": year,
        "generated_at": generated_at,
        "source": source,
        "rounds": rounds,
        "season": build_season(rounds),
        "limitations": LIMITATIONS,
    }
