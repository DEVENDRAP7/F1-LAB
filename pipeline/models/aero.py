"""Aero Explainer (M8, docs/SPEC.md) — not yet implemented.

Planned derivations, both from real telemetry only:
  - apparent C_dA from a speed-trace fit along a long straight
    (F_drag = 1/2 * rho * v^2 * C_dA)
  - apparent downforce from the slope of a_lat = v^2/r against speed,
    with r fitted from position-trace curvature

2026 active-aero and power-unit figures must be read from
config/regulations_2026.json, verified against the published FIA
technical regulations — not written from memory. That file has not been
populated yet (see README for current status), so this module is
deliberately unimplemented rather than built against placeholder figures.
"""

raise NotImplementedError(
    "aero.py is a placeholder — see the module docstring and docs/SPEC.md M8"
)
