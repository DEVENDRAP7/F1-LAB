"""Everything this site declined to publish, and the number it declined on.

Every module here refuses something. The what-if engine drops a driver
whose race it cannot reproduce; the atlas drops an elevation channel that
does not vary; four red-flagged races are excluded outright; two circuits
carry a written refusal instead of a racing line; a stint keeps no
compound rather than a likely one; a degradation fit is published as
unusable rather than as a confident slope.

Each of those decisions is recorded in the artifact it belongs to, which
means nobody ever sees them together. This gathers them into one ledger,
because the refusals are the part of this project that is actually
unusual — a dashboard that cannot say "no" will fill every gap with
something plausible, and a reader has no way to tell which numbers those
are.

It reads the published tree only. Nothing is recomputed and nothing is
fetched: if a refusal is not already written down in an artifact, it does
not appear here, which keeps this a report rather than a second opinion.
"""
from __future__ import annotations

import json


def _load(path):
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def collect(public_data, year: int) -> dict:
    """One ledger of refusals across every module, grouped by module."""
    year_dir = public_data / str(year)
    groups: list[dict] = []

    # --- What-If ---------------------------------------------------
    races_skipped = []
    drivers_unvalidated = []
    drivers_validated = 0
    for path in sorted(year_dir.glob("*/R/whatif.json")):
        doc = _load(path)
        if not doc:
            continue
        if doc.get("skipped"):
            races_skipped.append({
                "scope": f"Round {doc.get('round')} · {doc.get('raceName')}",
                "reason": doc["skipped"],
            })
        for driver, entry in (doc.get("drivers") or {}).items():
            validation = entry.get("validation") or {}
            if validation.get("validated"):
                drivers_validated += 1
            else:
                drivers_unvalidated.append({
                    "scope": f"Round {doc.get('round')} · {driver}",
                    "reason": (
                        f"replaying their real strategy missed their real race time by "
                        f"{abs(validation.get('errorPct', 0)):.2f}%, over the "
                        f"{validation.get('thresholdPct', 1):.0f}% bar"
                    ),
                })
    if races_skipped or drivers_unvalidated:
        groups.append({
            "module": "What-If Engine",
            "rule": (
                "A counterfactual is offered only where replaying the real strategy "
                "reproduces the real race time within 1%."
            ),
            "published": drivers_validated,
            "refused": len(races_skipped) + len(drivers_unvalidated),
            "entries": races_skipped + drivers_unvalidated,
        })

    # --- Racing lines and elevation --------------------------------
    lines_refused = []
    elevation_refused = []
    lines_published = 0
    for path in sorted(year_dir.glob("*/*/lines/manifest.json")):
        doc = _load(path)
        if not doc:
            continue
        round_ = path.parent.parent.parent.name
        session = path.parent.parent.name
        scope = f"Round {round_} · {doc.get('sessionLabel') or session}"
        if doc.get("unavailable"):
            per_driver = doc["unavailable"].get("perDriver") or []
            detail = per_driver[0]["reason"] if per_driver else ""
            lines_refused.append({
                "scope": scope,
                "reason": f"{doc['unavailable']['reason']} — {detail}" if detail
                          else doc["unavailable"]["reason"],
            })
            continue
        lines_published += len(doc.get("drivers") or {})
        elevation = doc.get("elevation") or {}
        if elevation and not elevation.get("usable") and elevation.get("reason"):
            elevation_refused.append({"scope": scope, "reason": elevation["reason"]})

    if lines_refused:
        groups.append({
            "module": "Racing Lines",
            "rule": (
                "A line is published only where the position feed carries a lap that "
                "can be drawn. A session it does not gets a written refusal, not an "
                "empty page."
            ),
            "published": lines_published,
            "refused": len(lines_refused),
            "entries": lines_refused,
        })
    if elevation_refused:
        groups.append({
            "module": "Elevation",
            "rule": (
                "A z channel that varies by less than 3 m over a whole lap is a "
                "constant with noise on it, not a profile."
            ),
            "published": None,
            "refused": len(elevation_refused),
            "entries": elevation_refused,
        })

    # --- Compounds and degradation fits ----------------------------
    compound_gaps = []
    stints_identified = 0
    stints_total = 0
    fits_unreliable = 0
    fits_total = 0
    fit_reasons: dict[str, int] = {}
    for path in sorted(year_dir.glob("*/R/laps.json")):
        doc = _load(path)
        if not doc:
            continue
        compounds = doc.get("compounds") or {}
        stints_identified += compounds.get("identified", 0)
        stints_total += compounds.get("stints", 0)
        missing = compounds.get("stints", 0) - compounds.get("identified", 0)
        if missing > 0:
            compound_gaps.append({
                "scope": f"Round {doc.get('round')} · {doc.get('raceName')}",
                "reason": (
                    f"{missing} stint(s) kept no compound: "
                    f"{compounds.get('reason') or 'no confident match in the stint feed'}"
                ),
            })
        for fit in doc.get("degradation") or []:
            fits_total += 1
            if not fit.get("reliable"):
                fits_unreliable += 1
                reason = (fit.get("reliability_reason") or "").split(" —")[0]
                key = "too few usable laps" if "usable laps" in reason else "lap-to-lap scatter dominates the trend"
                fit_reasons[key] = fit_reasons.get(key, 0) + 1

    if compound_gaps:
        groups.append({
            "module": "Tyre compounds",
            "rule": (
                "A stint takes a compound only where the stint feed matches it by "
                "driver and lap overlap. A wrong compound colour is worse than none."
            ),
            "published": stints_identified,
            "refused": stints_total - stints_identified,
            "entries": compound_gaps,
        })
    if fits_unreliable:
        groups.append({
            "module": "Degradation fits",
            "rule": (
                "A fit is published as a trend only with enough laps behind it and "
                "enough explanatory power. Below that it ships with the reason it "
                "failed rather than as a confident slope."
            ),
            "published": fits_total - fits_unreliable,
            "refused": fits_unreliable,
            "entries": [
                {"scope": f"{count} fit(s)", "reason": reason}
                for reason, count in sorted(fit_reasons.items(), key=lambda kv: -kv[1])
            ],
        })

    # --- Upcoming brief --------------------------------------------
    upcoming = _load(public_data / "upcoming.json")
    if upcoming and upcoming.get("history") is None and upcoming.get("reason"):
        groups.append({
            "module": "Upcoming brief",
            "rule": "A brief with no past editions behind it says so rather than guessing.",
            "published": 0,
            "refused": 1,
            "entries": [{
                "scope": upcoming.get("next", {}).get("raceName", "next round"),
                "reason": upcoming["reason"],
            }],
        })

    return {
        "year": year,
        "groups": groups,
        "totalRefused": sum(g["refused"] for g in groups),
        "note": (
            "Read from the published artifacts only. A refusal that is not written "
            "down in the artifact it belongs to does not appear here, which keeps "
            "this a report rather than a second opinion."
        ),
    }
