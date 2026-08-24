"""Driver Error Review detectors (M7, docs/SPEC.md) — not yet implemented.

Thresholds will live in config/detectors.json (not written yet). Every
flag must carry lap, corner, estimated time loss, severity, the
triggering telemetry window and a plain-English line, using descriptive
language only ("flagged", "estimated", "deviation from personal norm") —
never an accusation. Detectors must be validated against a hand-labelled
set (precision/recall reported in the README) before shipping; an
unmeasured detector is a random number generator, per docs/SPEC.md.
"""

raise NotImplementedError(
    "detectors.py is a placeholder — see the module docstring and docs/SPEC.md M7"
)
