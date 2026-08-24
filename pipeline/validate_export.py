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
    """A flagged standings mismatch is not itself a failure — it's a
    legitimate warning banner state per docs/SPEC.md M2 — but a
    standings.json that's missing the source_check field entirely means
    the cross-check never ran, which IS a failure: it means a bad table
    could ship with no safety net at all."""
    standings_path = PUBLIC_DATA / "standings.json"
    if not standings_path.exists():
        return []  # nothing computed yet this run; not an error

    data = json.loads(standings_path.read_text())
    if "source_check" not in data:
        return ["standings.json is missing source_check — the cross-check against the API did not run"]
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
