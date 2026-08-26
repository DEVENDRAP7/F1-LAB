"""Team-mate qualifying head-to-head.

The point of comparing team-mates is that the car is the same. Nothing
else about a qualifying hour is: one driver can be knocked out by a red
flag, held up on an out-lap, or sent out on a track that improved by two
tenths after they crossed the line. So this counts what happened and
states the sample, and never calls the winner faster.

WHAT IS COMPARED

Both drivers' best time in the LAST segment they both reached. Comparing
a Q3 time against a Q2 time compares two different track states and two
different fuel loads, and the driver who reached Q3 would look slower
about as often as they looked faster. Where they were eliminated in
different segments the round is counted as a beat on position — which is
what happened — but contributes no gap.

WHAT IS NOT CLAIMED

Not "faster over one lap". A head-to-head is a count of weekends, and
this project publishes it as a count with the number of weekends beside
it, because 7-5 over twelve rounds and 7-5 over eighty are different
claims and a bare "7-5" hides which one it is.
"""
from __future__ import annotations

SEGMENTS = ("q3S", "q2S", "q1S")


def deepest_shared_segment(a: dict, b: dict) -> str | None:
    """The last segment both drivers set a time in, if there is one."""
    for segment in SEGMENTS:
        if a.get(segment) and b.get(segment):
            return segment
    return None


def _pairs(rows: list[dict]) -> list[tuple[dict, dict]]:
    """Team-mates for one weekend, from the constructor each drove for.

    A team fielding three drivers across a weekend — a reserve stepping
    in — has no unambiguous pairing, so it is skipped rather than paired
    by the order the feed happened to return.
    """
    by_constructor: dict[str, list[dict]] = {}
    for row in rows:
        if not row.get("constructorId") or not row.get("driverId"):
            continue
        by_constructor.setdefault(row["constructorId"], []).append(row)

    pairs = []
    for entries in by_constructor.values():
        if len(entries) != 2:
            continue
        pairs.append((entries[0], entries[1]))
    return pairs


def build_head_to_head(rounds: list[dict]) -> dict:
    """Season-long team-mate record, from per-round qualifying results.

    `rounds` is [{"round": n, "raceName": str, "results": [...]}].
    """
    records: dict[str, dict] = {}

    for entry in rounds:
        for a, b in _pairs(entry.get("results") or []):
            key = a["constructorId"]
            record = records.setdefault(key, {
                "constructorId": key,
                "constructorName": a.get("constructorName") or key,
                "drivers": {},
                "rounds": [],
            })

            ahead, behind = (a, b) if a["position"] < b["position"] else (b, a)
            for row in (a, b):
                driver = record["drivers"].setdefault(row["driverId"], {
                    "driverId": row["driverId"],
                    "code": row.get("code"),
                    "beats": 0,
                })
            record["drivers"][ahead["driverId"]]["beats"] += 1

            segment = deepest_shared_segment(a, b)
            gap = None
            if segment:
                gap = round(abs(a[segment] - b[segment]), 3)

            record["rounds"].append({
                "round": entry["round"],
                "raceName": entry.get("raceName"),
                "ahead": ahead["driverId"],
                "behind": behind["driverId"],
                "positions": {a["driverId"]: a["position"], b["driverId"]: b["position"]},
                # Which segment the gap is measured in, always. A gap with
                # no segment beside it invites a Q3 time and a Q1 time to
                # be read as the same measurement.
                "segment": segment[:2].upper() if segment else None,
                "gapS": gap,
                "aheadBySegment": (
                    None if not segment
                    else (a["driverId"] if a[segment] <= b[segment] else b["driverId"])
                ),
            })

    out = []
    for record in records.values():
        drivers = list(record["drivers"].values())
        if len(drivers) != 2:
            # A team whose line-up changed mid-season has more than two
            # drivers in the record, and no two-way head-to-head to state.
            continue
        gaps = [r["gapS"] for r in record["rounds"] if r["gapS"] is not None]
        median_gap = None
        if gaps:
            ordered = sorted(gaps)
            mid = len(ordered) // 2
            median_gap = (
                ordered[mid] if len(ordered) % 2
                else round((ordered[mid - 1] + ordered[mid]) / 2, 3)
            )
        out.append({
            **{k: v for k, v in record.items() if k != "drivers"},
            "drivers": drivers,
            "rounds_compared": len(record["rounds"]),
            "roundsWithGap": len(gaps),
            "medianGapS": median_gap,
        })

    out.sort(key=lambda r: r["constructorName"])
    return {
        "teams": out,
        "limitations": [
            "A head-to-head counts weekends, not speed. The car is the same; the "
            "session is not — a red flag, an out-lap in traffic or a track that "
            "improved after one driver's run all land in this count.",
            "The gap is measured in the last segment both drivers reached, and the "
            "segment is named beside it. A Q3 time against a Q2 time is two "
            "different track states and two different fuel loads.",
            "Where the two were knocked out in different segments the weekend still "
            "counts as a beat on position, because that is what happened, but it "
            "contributes no gap.",
            "A team that fielded more than two drivers in a weekend is skipped: "
            "there is no unambiguous pairing, and pairing by the order the feed "
            "returned would invent one.",
        ],
    }
