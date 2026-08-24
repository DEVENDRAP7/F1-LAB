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


def main() -> int:
    errors = check_budgets() + check_standings_cross_check()

    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print("Validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
