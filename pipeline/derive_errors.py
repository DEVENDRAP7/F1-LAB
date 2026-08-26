"""Driver Error Review — a flagged timeline, not an accusation.

Two kinds of entry, and the difference between them is the point.

RECORDED events come from race control: published messages, attributed
to a driver by OpenF1's own `driver_number` field. A deleted lap time, an
investigation, a penalty. These are facts about what officials said, and
they are reported verbatim rather than paraphrased, because paraphrasing
an official message is editorialising it.

FLAGGED laps are this pipeline's own observation: a lap materially slower
than the same driver's own green-flag norm in the same race. That is a
deviation, not a mistake — a driver can lose four seconds to a car ahead,
a wet patch, or an instruction from the pit wall, and nothing about the
lap time distinguishes those from a lock-up. So the language stays
descriptive throughout ("flagged", "estimated", "slower than this
driver's own median"), and the UI is expected to keep it that way.

What is deliberately NOT here: lock-ups, mid-corner corrections, poor
exits and the other telemetry-derived flags the spec sketches. Detecting
those honestly needs per-lap car telemetry for every driver across every
lap, which is two orders of magnitude more fetching than this pipeline
does, and at the ~3.7 Hz this source publishes the detections would be
weak enough to be misleading. An absent flag type is a gap; a
badly-detected one is a false accusation about a named person.
"""
from __future__ import annotations

import datetime

# A lap this much slower than the driver's own green-flag median is
# flagged. Chosen well above ordinary lap-to-lap scatter (which runs a
# few tenths) so the flag means "something happened", not "this lap was
# a bit untidy".
SLOW_LAP_THRESHOLD_S = 2.0

# Severity bands, in seconds lost against that same personal median.
SEVERITY_BANDS = ((10.0, "major"), (4.0, "moderate"), (SLOW_LAP_THRESHOLD_S, "minor"))

# Race-control categories that describe something that happened to or
# because of a specific car, as opposed to session bookkeeping.
INCIDENT_CATEGORIES = {"Flag", "Other", "CarEvent", "Drs"}

# A blue flag says a faster car is approaching. It is information handed
# to a driver, not a finding about their conduct, and listing it
# undifferentiated under a heading a reader scans as a fault list
# misrepresents it. Kept — it is a real published message — but marked
# so the UI can separate it from something the driver is answerable for.
INFORMATIONAL_FLAGS = {"BLUE"}

# The first lap starts from a standing start, so it is slower than a
# flying lap for everyone by roughly the time it takes to get off the
# line. On real data every one of 22 drivers was flagged "major" on lap
# 1, which is not 22 mistakes — it is the definition of a race start.
# Excluded for the same reason out-laps are: the slowness has a known
# cause that is not the driver.
FIRST_RACING_LAP = 2

# How far an unterminated neutralisation is allowed to extend. Bounding
# it matters because the alternative — running to the end of the race —
# is exactly how a stuck period once swallowed 41 laps.
MAX_UNTERMINATED_NEUTRAL_LAPS = 5


def _parse(raw: str | None) -> datetime.datetime | None:
    if not raw:
        return None
    try:
        return datetime.datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        return None


def neutralised_laps(race_control: list[dict]) -> set[int]:
    """Laps run under a virtual or full safety car, or a red flag.

    Written against the vocabulary the feed actually publishes, which was
    probed rather than guessed after a guessed version marked 41 of about
    72 laps at Zandvoort as neutralised:

        [SafetyCar] VSC DEPLOYED  /  VSC ENDING      <- explicit pairs
        [Other]     SAFETY CAR LIGHTS ON            <- real, but no "off"
        [Flag]      GREEN LIGHT - PIT EXIT OPEN     <- NOT a restart

    Only the SafetyCar category opens and closes a period. The first
    version also opened one on any message containing "SAFETY CAR", which
    caught "SAFETY CAR LIGHTS ON" — published on laps 1 and 3 as part of
    the start procedure and never followed by an "off" message. The
    period then stayed open, and because a race carries hundreds of
    lap-numbered messages (Zandvoort had 252 blue flags alone), every
    subsequent lap was swept in.

    A period with no end is bounded rather than left open, so the same
    class of mistake cannot silently swallow a race again.
    """
    intervals: list[tuple[int, int]] = []
    open_at: int | None = None

    for row in sorted(race_control, key=lambda r: r.get("date") or ""):
        lap = row.get("lapNumber")
        message = (row.get("message") or "").upper()
        category = row.get("category")

        if category == "SafetyCar":
            if "ENDING" in message or "IN THIS LAP" in message:
                if open_at is not None and lap:
                    intervals.append((open_at, int(lap)))
                    open_at = None
            elif "DEPLOYED" in message and lap:
                open_at = int(lap)
        elif "SAFETY CAR LIGHTS ON" in message and lap:
            # A real safety car, but this message has no published "off"
            # counterpart, so it opens a BOUNDED period rather than a
            # latching one. Ignoring it entirely was the overcorrection
            # after the latch: it left the genuine start-of-race safety
            # car at Zandvoort unexcluded, and laps behind it showed as
            # +69s and +86s "major" flags against a named driver.
            if open_at is None:
                open_at = int(lap)
                intervals.append((open_at, open_at + MAX_UNTERMINATED_NEUTRAL_LAPS))
                open_at = None
        elif row.get("flag") == "RED" and lap:
            # A red flag stops the race; treat the lap it fell on as
            # neutralised and let a later restart close it.
            intervals.append((int(lap), int(lap)))

    if open_at is not None:
        # Never terminated. Bound it instead of running to the flag: a
        # neutralisation that is genuinely this long is rare, and
        # assuming it swallows the rest of the race is the failure this
        # function already had once.
        intervals.append((open_at, open_at + MAX_UNTERMINATED_NEUTRAL_LAPS))

    laps: set[int] = set()
    for start, end in intervals:
        laps.update(range(min(start, end), max(start, end) + 1))
    return laps


# A flag that describes the track rather than a driver. Kept as whatever
# the feed published rather than matched against a fixed vocabulary: an
# unexpected value should show up on the page as itself, not be dropped
# for not being on a list this project wrote.
DRIVER_DIRECTED_FLAGS = {"BLUE", "BLACK AND WHITE", "BLACK", "BLACK AND ORANGE"}
CLEAR_FLAGS = {"GREEN", "CLEAR", "CHEQUERED"}


def track_flags_by_lap(race_control: list[dict]) -> dict[int, list[dict]]:
    """Flags published about the track, indexed by the lap they fell on.

    A flagged lap says only that a driver was slower than their own
    median. If race control had a yellow out on that lap, that is a
    published reason for it which has nothing to do with the driver — and
    it was sitting in the same feed the whole time, unused, because it
    carries no car number and so never reached the attributed list.

    Safety-car and red-flag laps are already excluded from flagging
    entirely; this is for the ones that stay, where a local yellow
    explains a lap that a bare deviation would leave hanging.
    """
    by_lap: dict[int, list[dict]] = {}
    for row in race_control:
        lap = row.get("lapNumber")
        flag = (row.get("flag") or "").upper()
        if not lap or not flag:
            continue
        if row.get("driverNumber"):
            continue  # directed at one car; attributed_incidents has it
        if flag in DRIVER_DIRECTED_FLAGS or flag in CLEAR_FLAGS:
            continue
        entry = {
            "flag": row.get("flag"),
            "message": (row.get("message") or "").strip(),
        }
        if row.get("sector"):
            entry["sector"] = row["sector"]
        by_lap.setdefault(int(lap), []).append(entry)
    return by_lap


def attributed_incidents(race_control: list[dict],
                         code_by_number: dict[int, str]) -> list[dict]:
    """Race-control messages that name a specific car.

    Attribution comes from OpenF1's own `driver_number` field, never from
    reading the message text. Parsing prose for a car number would mean
    guessing a format, and a mis-parse here does not produce a missing
    row — it produces an incident filed against the wrong driver, which
    is the single worst output this module could have.
    """
    incidents = []
    for row in race_control:
        number = row.get("driverNumber")
        if not number:
            continue
        if row.get("category") not in INCIDENT_CATEGORIES:
            continue
        message = (row.get("message") or "").strip()
        if not message:
            continue
        flag = row.get("flag")
        incidents.append({
            "kind": "recorded",
            "nature": "informational" if flag in INFORMATIONAL_FLAGS else "noted",
            "driverCode": code_by_number.get(int(number), str(number)),
            "driverNumber": int(number),
            "lap": row.get("lapNumber"),
            "category": row.get("category"),
            "flag": flag,
            # Verbatim. Rewording an official message editorialises it.
            "message": message,
            "date": row.get("date"),
        })
    incidents.sort(key=lambda i: (i["driverCode"], i.get("lap") or 0))
    return incidents


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _severity(loss: float) -> str:
    for threshold, label in SEVERITY_BANDS:
        if loss >= threshold:
            return label
    return "minor"


def flag_slow_laps(laps: list[dict], code_by_number: dict[int, str],
                   neutralised: set[int] | None = None,
                   track_flags: dict[int, list[dict]] | None = None) -> list[dict]:
    """Laps well off a driver's own green-flag pace, with the loss stated.

    The comparison is always against the same driver in the same race, so
    a slow car is not flagged for being slow — only for being slower than
    itself. Out-laps and in-laps are both excluded because a pit stop is a
    known reason for a slow lap and flagging it would say nothing.
    """
    neutralised = neutralised or set()
    track_flags = track_flags or {}

    # The source flags out-laps but publishes nothing for in-laps, and an
    # in-lap carries the whole pit entry — around twenty seconds. Left in,
    # every pit stop in the race appeared as a "major" flag against the
    # driver who made it. It is derivable rather than guessable: the lap
    # immediately before an out-lap is the lap they came in on.
    out_laps: dict[int, set[int]] = {}
    for lap in laps:
        if lap.get("isPitOutLap") and lap.get("lapNumber"):
            out_laps.setdefault(lap["driverNumber"], set()).add(int(lap["lapNumber"]))

    by_driver: dict[int, list[dict]] = {}
    for lap in laps:
        if not lap.get("lapDurationS") or lap.get("isPitOutLap"):
            continue
        number = int(lap.get("lapNumber") or 0)
        if number < FIRST_RACING_LAP:
            continue  # standing start, see FIRST_RACING_LAP
        if number + 1 in out_laps.get(lap["driverNumber"], ()):
            continue  # in-lap: the pit entry is in this lap time
        by_driver.setdefault(lap["driverNumber"], []).append(lap)

    flagged = []
    for number, driver_laps in by_driver.items():
        green = [l for l in driver_laps if int(l.get("lapNumber") or 0) not in neutralised]
        # A baseline needs enough green laps to be a norm rather than an
        # accident of which laps happened to be clean.
        if len(green) < 5:
            continue
        baseline = _median([float(l["lapDurationS"]) for l in green])
        if baseline is None:
            continue

        for lap in green:
            loss = float(lap["lapDurationS"]) - baseline
            if loss < SLOW_LAP_THRESHOLD_S:
                continue
            flagged.append({
                "kind": "flagged",
                "driverCode": code_by_number.get(number, str(number)),
                "driverNumber": number,
                "lap": int(lap["lapNumber"]),
                "lapTimeS": round(float(lap["lapDurationS"]), 3),
                "baselineS": round(baseline, 3),
                "estimatedLossS": round(loss, 3),
                "severity": _severity(loss),
                # What race control published about the track on this lap.
                # Empty means nothing was published, not that the lap was
                # clean — the feed only carries what officials said.
                "trackFlags": track_flags.get(int(lap["lapNumber"]), []),
                "basis": (
                    "slower than this driver's own median green-flag lap in this race; "
                    "the cause is not identified and may be traffic, conditions or a "
                    "team instruction rather than a driver error"
                ),
            })

    flagged.sort(key=lambda f: (f["driverCode"], f["lap"]))
    return flagged


def build_error_review(laps: list[dict], race_control: list[dict],
                       code_by_number: dict[int, str]) -> dict:
    """The per-round payload: recorded events, flagged laps, and limits."""
    neutralised = neutralised_laps(race_control)
    incidents = attributed_incidents(race_control, code_by_number)
    track_flags = track_flags_by_lap(race_control)
    flagged = flag_slow_laps(laps, code_by_number, neutralised, track_flags)

    by_driver: dict[str, dict] = {}
    for entry in incidents + flagged:
        code = entry["driverCode"]
        bucket = by_driver.setdefault(code, {"recorded": [], "flagged": []})
        bucket["recorded" if entry["kind"] == "recorded" else "flagged"].append(entry)

    return {
        "drivers": by_driver,
        "neutralisedLaps": sorted(neutralised),
        "trackFlagLaps": {str(lap): flags for lap, flags in sorted(track_flags.items())},
        "thresholds": {
            "slowLapS": SLOW_LAP_THRESHOLD_S,
            "severityBands": [{"atLeastS": t, "label": l} for t, l in SEVERITY_BANDS],
        },
        "limitations": [
            "Recorded events are race-control messages, reported verbatim and attributed "
            "by the published car number rather than by reading the message text.",
            "Blue flags are marked informational: they tell a driver a faster car is "
            "approaching and say nothing about that driver's own conduct.",
            "Lap 1 is never flagged. It starts from a standstill, so it is slower than a "
            "flying lap for every driver, and flagging it would mark a normal race start "
            "as an event for the whole field.",
            "Pit in-laps and out-laps are excluded. The source flags out-laps; an in-lap "
            "is identified as the lap before one, since it carries the pit entry and would "
            "otherwise show every stop in the race as a flag against the driver.",
            "A flagged lap is a deviation from this driver's own green-flag median in "
            "this race, not a diagnosed mistake: traffic, conditions and pit-wall "
            "instructions produce the same signature as an error.",
            "A flagged lap shows any flag race control published about the track on "
            "that lap. A yellow is a published reason for a slow lap that has nothing "
            "to do with the driver, and it was in the same feed all along — it simply "
            "carries no car number, so it never reached the attributed list.",
            "Laps run under a safety car or red flag are excluded using the published "
            "track-status messages, so they are excluded because they were neutralised "
            "rather than because they looked slow.",
            "No lock-up, off-track or mid-corner-correction detection. Those need per-lap "
            "telemetry for every driver, which this pipeline does not fetch, and at the "
            "sampling rate available the detections would be too weak to attach to a "
            "named driver.",
        ],
    }
