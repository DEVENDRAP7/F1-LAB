"""What-If Engine (M5, docs/SPEC.md) — not yet implemented.

Build order (docs/SPEC.md) gates this module on M1-M4 shipping first, and
gates its own completion on a specific self-check: re-running this model
with a driver's *actual* strategy must reproduce their actual race time
within ~1% and their actual finishing position. Until that check exists
and passes in CI, this module must not be wired into the site — a
plausible-looking projection that hasn't passed its own validation is
exactly the "fake state" the project's ground rules forbid.

When implemented, this file is the Python reference implementation that
src/workers/whatif.worker.js ports line-for-line; pipeline/tests must
assert both produce identical output on a shared fixture.
"""

raise NotImplementedError(
    "whatif.py is a placeholder — see the module docstring and docs/SPEC.md M5"
)
