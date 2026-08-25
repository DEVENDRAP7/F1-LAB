"""Attach real tyre compounds to the pit-stop-derived stints.

Every stint this project has published so far carried
`compound: None` with the reason "Jolpica-F1 publishes no tyre compound
data", and the strategy board shaded bars by stint ORDINAL with a note
saying so — because shading by a guessed compound would have been
invented state dressed as a measurement.

OpenF1 publishes the compound per stint, so the colour can now mean what
a reader already assumes it means. The join is deliberately conservative:

  * Identity is matched on the published three-letter code, not on a
    truncated id or a name.
  * Stint boundaries come from two different derivations — ours from
    pit-stop laps, OpenF1's from its own feed — so they do not line up
    exactly. A compound is taken from the OpenF1 stint with the largest
    lap OVERLAP, and only when that overlap is a real majority of our
    stint.
  * Anything that does not clear that bar keeps compound None and its
    stated reason. A wrong compound is worse than no compound: it is a
    confident claim about strategy that never happened.
"""
from __future__ import annotations

# Fraction of our stint's laps that must fall inside a candidate OpenF1
# stint before its compound is adopted. Below this the two derivations
# disagree enough that the match is a guess.
MIN_OVERLAP_SHARE = 0.6

UNAVAILABLE = "unavailable — Jolpica-F1 publishes no tyre compound data"
MATCHED = "OpenF1 stint feed, matched by driver code and lap overlap"
UNMATCHED = "no OpenF1 stint overlapped this one enough to identify the compound"

# The compounds the feed actually publishes, normalised. Anything else is
# carried through as-is rather than coerced into one of these.
KNOWN = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"}


def _overlap(a_start, a_end, b_start, b_end) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start) + 1)


def index_openf1_stints(openf1_stints: list[dict],
                        code_by_number: dict[int, str]) -> dict[str, list[dict]]:
    """Group the OpenF1 stints by driver code."""
    by_code: dict[str, list[dict]] = {}
    for stint in openf1_stints:
        number = stint.get("driverNumber")
        code = code_by_number.get(number)
        if not code:
            continue
        if stint.get("lapStart") is None or stint.get("lapEnd") is None:
            continue
        by_code.setdefault(code, []).append(stint)
    return by_code


def attach_compounds(stints: list[dict], by_code: dict[str, list[dict]],
                     code_by_driver_id) -> dict:
    """Fill in `compound` where a confident match exists.

    Mutates the stints in place and returns a small report, so the
    refresh can log how much of the race actually got identified rather
    than leaving it to be assumed.
    """
    matched = 0
    for stint in stints:
        code = code_by_driver_id(stint.get("driverId"))
        candidates = by_code.get(code, [])
        if not candidates:
            stint["compoundSource"] = UNMATCHED if by_code else UNAVAILABLE
            continue

        start = int(stint["startLap"])
        end = int(stint["endLap"])
        span = max(1, end - start + 1)

        best = None
        best_overlap = 0
        for candidate in candidates:
            overlap = _overlap(start, end,
                               int(candidate["lapStart"]), int(candidate["lapEnd"]))
            if overlap > best_overlap:
                best, best_overlap = candidate, overlap

        if best is None or best_overlap / span < MIN_OVERLAP_SHARE:
            stint["compoundSource"] = UNMATCHED
            continue

        compound = (best.get("compound") or "").upper().strip()
        if not compound:
            stint["compoundSource"] = UNMATCHED
            continue

        stint["compound"] = compound
        stint["compoundSource"] = MATCHED
        stint["tyreAgeAtStart"] = best.get("tyreAgeAtStart")
        matched += 1

    return {
        "stints": len(stints),
        "identified": matched,
        "share": (matched / len(stints)) if stints else 0.0,
        "unknownCompounds": sorted(
            {s["compound"] for s in stints
             if s.get("compound") and s["compound"] not in KNOWN}
        ),
    }
