"""Hard validation gate run by .github/workflows/refresh-data.yml right
before the commit step. Every check here must raise/exit non-zero on
failure — since commits land straight on `main` with no review step
(docs/SPEC.md), this script is the only thing standing between a bad
export and a live, broken deploy.
"""
from __future__ import annotations

import json
import sys

from common import CONFIG_DIR, PUBLIC_DATA, BudgetExceeded
import export


def check_budgets() -> list[str]:
    errors = []
    try:
        export.check_site_budget()
    except BudgetExceeded as exc:
        errors.append(str(exc))

    for session_dir in PUBLIC_DATA.glob("*/*/*"):
        if not session_dir.is_dir():
            continue
        try:
            total = sum(f.stat().st_size for f in session_dir.rglob("*") if f.is_file())
            from common import MAX_SESSION_BYTES

            if total > MAX_SESSION_BYTES:
                errors.append(f"{session_dir} totals {total} bytes, over the {MAX_SESSION_BYTES} byte session budget")
        except OSError as exc:
            errors.append(f"{session_dir}: {exc}")

    for bin_file in PUBLIC_DATA.rglob("lines/*.bin"):
        from common import MAX_RACING_LINE_BYTES

        size = bin_file.stat().st_size
        if size > MAX_RACING_LINE_BYTES:
            errors.append(f"{bin_file} is {size} bytes, over the {MAX_RACING_LINE_BYTES} byte racing-line budget")

    return errors


def check_standings_cross_check() -> list[str]:
    """Fail the run on a standings mismatch, per docs/SPEC.md 2.4.

    An earlier version of this check treated a flagged mismatch as a
    benign "warning banner" state and passed it through. That reasoning
    was wrong and it cost a bad deploy: a rate-limited refresh computed
    the table from a subset of rounds, the cross-check flagged all 23
    drivers, and this gate waved it through to the live site anyway.

    A mismatch means the independently computed table and the API
    disagree. One of them is wrong and this process cannot tell which,
    so nothing ships until a human looks. A missing or skipped
    cross-check fails too — not running is not the same as passing.
    """
    standings_path = PUBLIC_DATA / "standings.json"
    if not standings_path.exists():
        return []  # nothing computed yet this run; not an error

    data = json.loads(standings_path.read_text())
    source_check = data.get("source_check")
    if source_check is None:
        return ["standings.json is missing source_check — the cross-check against the API did not run"]

    if source_check.get("mismatch"):
        details = source_check.get("details", [])
        sample = ", ".join(str(d.get("driverCode")) for d in details[:5])
        return [
            f"standings cross-check FAILED for {len(details)} driver(s) [{sample} ...]: the "
            "computed table disagrees with the API's. Inspect source_check in "
            "public/data/standings.json — nothing is published until this is resolved."
        ]

    if source_check.get("note"):
        return [
            f"standings cross-check did not actually run ({source_check['note']}) — "
            "a skipped check is not a passed check, so this run is not publishable."
        ]

    return []


def check_upcoming_brief() -> list[str]:
    """Self-check the Upcoming Race Brief's arithmetic before it ships.

    The brief's numbers are not cross-checkable against a published
    table the way standings are, so the gate checks them against each
    other instead. The failure this is really guarding against already
    happened once in development: classification was keyed off the
    finishing-status text, whose wording changes between seasons, which
    silently reclassified every lapped finisher as a retirement. That
    produces a brief that is internally plausible and wrong — exactly
    the shape of error a reader cannot catch — but it shows up here as
    a finish rate that no longer squares with its own per-edition rows.
    """
    path = PUBLIC_DATA / "upcoming.json"
    if not path.exists():
        return []

    data = json.loads(path.read_text())
    history = data.get("history")
    if history is None:
        return []  # a brief that states why it has no history is valid

    errors = []
    per_edition = history.get("perEdition", [])

    if history.get("editions") != len(per_edition):
        errors.append(
            f"upcoming.json claims {history.get('editions')} editions but carries "
            f"{len(per_edition)} per-edition rows"
        )

    finish = history.get("finishRate", {})
    classified_sum = sum(e.get("classified", 0) for e in per_edition)
    starters_sum = sum(e.get("starters", 0) for e in per_edition)
    if finish.get("classified") != classified_sum or finish.get("starters") != starters_sum:
        errors.append(
            f"upcoming.json finish rate ({finish.get('classified')}/{finish.get('starters')}) "
            f"does not match the sum of its per-edition rows ({classified_sum}/{starters_sum})"
        )

    for edition in per_edition:
        if edition.get("classified", 0) > edition.get("starters", 0):
            errors.append(
                f"upcoming.json {edition.get('year')}: {edition['classified']} cars classified "
                f"out of {edition['starters']} starters — more finishers than starters"
            )

    n = history.get("positionChange", {}).get("n", 0)
    if n > classified_sum:
        errors.append(
            f"upcoming.json position-change sample ({n}) exceeds the number of classified "
            f"finishes ({classified_sum}) it can be drawn from"
        )

    return errors


def main() -> int:
    errors = check_budgets() + check_standings_cross_check() + check_upcoming_brief()

    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print("Validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
