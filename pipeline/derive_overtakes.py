"""Position changes in a race, and how complete that feed actually is.

Five pages on this site carry some version of the sentence "no source
published by this project counts overtakes". It was true when it was
written. Going back through every OpenF1 endpoint the project had never
tried turned up a beta `overtakes` feed, and this is what it supports.

WHAT THE FEED IS

OpenF1's own description: an overtake is one driver exchanging positions
with another, "including both on-track passes and position changes
resulting from pit stops or post-race penalties"; it exists only for
races; and it may be incomplete. Every one of those travels with every
figure here. A position-change feed presented as an overtake feed would
be a worse answer than the honest absence it replaces, so the word
"overtake" is not used for the totals — they are position changes.

MEASURING THE INCOMPLETENESS

"May be incomplete" is not something to repeat and move past; it is
something to measure. Each driver's net position change over a race is
known independently, from the official results: grid position minus
finishing position. The feed implies its own net, from the changes it
recorded for and against that driver. Those two numbers describe the
same quantity and come from different places, so the gap between them is
a measurement of what the feed missed.

That residual is published beside every total. It is the only honest way
to hand a reader a count from a feed its own publisher calls incomplete.
"""
from __future__ import annotations

# A race with fewer recorded changes than this is not a thin race, it is
# a feed that did not cover the session.
MIN_CHANGES = 20


def net_by_driver(overtakes: list[dict]) -> dict[int, dict]:
    """Position changes for and against each driver number."""
    out: dict[int, dict] = {}

    def row(number):
        return out.setdefault(int(number), {"driverNumber": int(number),
                                            "made": 0, "suffered": 0})

    for event in overtakes:
        made_by = event.get("overtakingDriverNumber")
        lost_by = event.get("overtakenDriverNumber")
        if made_by is not None:
            row(made_by)["made"] += 1
        if lost_by is not None:
            row(lost_by)["suffered"] += 1

    for entry in out.values():
        entry["net"] = entry["made"] - entry["suffered"]
    return out


def completeness(net: dict[int, dict], results: list[dict],
                 numbers_by_code: dict[str, int]) -> dict:
    """How far the feed's net change is from the official one.

    The official net is grid minus finish: a driver who started 10th and
    finished 4th moved six places, whatever mixture of passes, stops and
    retirements produced them. The feed's net is what it recorded. They
    describe the same quantity.
    """
    rows = []
    for result in results:
        code = result.get("driverCode")
        number = numbers_by_code.get(code)
        grid = result.get("grid")
        finish = result.get("position")
        if number is None or not grid or not finish:
            continue
        try:
            official = int(grid) - int(finish)
        except (TypeError, ValueError):
            continue
        # A pit-lane start has no grid slot to have moved from.
        if int(grid) == 0:
            continue
        recorded = (net.get(number) or {}).get("net", 0)
        rows.append({
            "driverCode": code,
            "driverNumber": number,
            "officialNet": official,
            "recordedNet": recorded,
            "residual": recorded - official,
        })

    if not rows:
        return {"drivers": 0, "medianAbsResidual": None, "exact": 0}

    absolute = sorted(abs(r["residual"]) for r in rows)
    mid = len(absolute) // 2
    median = absolute[mid] if len(absolute) % 2 else (absolute[mid - 1] + absolute[mid]) / 2
    return {
        "drivers": len(rows),
        "medianAbsResidual": median,
        "exact": sum(1 for r in rows if r["residual"] == 0),
        "rows": sorted(rows, key=lambda r: -abs(r["residual"])),
    }


def assess(overtakes: list[dict], results: list[dict],
           numbers_by_code: dict[str, int], min_changes: int = MIN_CHANGES) -> dict:
    """One race's position-change record, or the reason there is none."""
    if len(overtakes) < min_changes:
        return {
            "published": False,
            "changes": len(overtakes),
            "withheldReason": (
                f"the feed carried {len(overtakes)} position change(s) for this race, "
                f"below the {min_changes} that distinguishes a quiet race from a session "
                "the beta feed did not cover"
            ),
        }

    net = net_by_driver(overtakes)
    check = completeness(net, results, numbers_by_code)
    by_driver = sorted(net.values(), key=lambda r: (-r["made"], r["driverNumber"]))
    return {
        "published": True,
        "changes": len(overtakes),
        "byDriver": by_driver,
        "completeness": check,
    }


LIMITATIONS = [
    "These are position changes, not overtakes. The feed's own "
    "description includes position changes from pit stops and from "
    "penalties applied after the race alongside passes made on track, "
    "and nothing published separates them, so nothing here calls them "
    "overtakes.",
    "The feed is a beta and its publisher says it may be incomplete. "
    "Rather than repeat that, every race carries a measurement of it: "
    "each driver's net change according to the feed, against grid minus "
    "finish from the official results, which is the same quantity from "
    "a different source.",
    "Races only. There is no position-change feed for qualifying or for "
    "a sprint, so the sprint weekends page still compares the two races "
    "by places changed between grid and flag rather than by passes.",
    "A driver who started from the pit lane has no grid slot, so they "
    "are left out of the completeness check rather than counted as "
    "having started last.",
]


def build(year: int, races: list[dict], generated_at: str, source: str) -> dict:
    published = [r for r in races if r["overtakes"]["published"]]
    return {
        "year": year,
        "generated_at": generated_at,
        "source": source,
        "races": races,
        "publishedCount": len(published),
        "withheldCount": len(races) - len(published),
        "limitations": LIMITATIONS,
    }
