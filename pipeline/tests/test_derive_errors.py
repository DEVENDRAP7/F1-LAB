"""Cover the Driver Error Review.

The tests that matter most here are about restraint rather than
detection: an incident must never land against the wrong driver, a slow
lap under a safety car must not be attributed to the driver, and a
flagged lap must not be described as a mistake.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_errors import (  # noqa: E402
    attributed_incidents,
    build_error_review,
    flag_slow_laps,
    neutralised_laps,
)

CODES = {1: "VER", 16: "LEC", 44: "HAM"}


def lap(number, driver, duration, pit_out=False):
    return {
        "driverNumber": driver,
        "lapNumber": number,
        "lapDurationS": duration,
        "isPitOutLap": pit_out,
    }


def rc(date, category, message, driver=None, lap_number=None, flag=None):
    return {
        "date": date,
        "category": category,
        "message": message,
        "driverNumber": driver,
        "lapNumber": lap_number,
        "flag": flag,
    }


def test_incident_is_attributed_by_car_number_not_message_text():
    """A mis-parse here files an incident against the wrong named driver,
    so attribution comes from the published field only."""
    rows = [
        rc("2026-08-23T13:10:00", "Other",
           "CAR 16 (LEC) TRACK LIMITS AT TURN 7 LAP 12 - LAP TIME DELETED",
           driver=16, lap_number=12),
    ]
    incidents = attributed_incidents(rows, CODES)
    assert len(incidents) == 1
    assert incidents[0]["driverCode"] == "LEC"


def test_message_is_reported_verbatim():
    """Rewording an official message editorialises it."""
    text = "CAR 44 (HAM) 5 SECOND TIME PENALTY - LEAVING THE TRACK AND GAINING AN ADVANTAGE"
    incidents = attributed_incidents(
        [rc("2026-08-23T13:20:00", "Other", text, driver=44, lap_number=20)], CODES)
    assert incidents[0]["message"] == text


def test_messages_naming_no_car_are_not_attributed():
    rows = [rc("2026-08-23T13:00:00", "Flag", "GREEN LIGHT - PIT EXIT OPEN", flag="GREEN")]
    assert attributed_incidents(rows, CODES) == []


def test_vsc_period_covers_its_own_laps():
    """The real vocabulary, probed from the feed: VSC DEPLOYED / ENDING
    under the SafetyCar category."""
    rows = [
        rc("2026-08-23T13:05:00", "SafetyCar", "VSC DEPLOYED", lap_number=55),
        rc("2026-08-23T13:08:00", "SafetyCar", "VSC ENDING", lap_number=57),
    ]
    assert neutralised_laps(rows) == {55, 56, 57}


def test_safety_car_lights_on_opens_a_bounded_period_not_a_latch():
    """Both extremes have been wrong here. Latching on this message
    swallowed 41 of ~72 Zandvoort laps; ignoring it left that race's real
    start-of-race safety car unexcluded, showing +69s and +86s as 'major'
    flags against a named driver. It opens a bounded period."""
    rows = [
        rc("2026-08-23T13:00:00", "Other", "SAFETY CAR LIGHTS ON", lap_number=1),
        rc("2026-08-23T13:02:00", "Other", "SAFETY CAR LIGHTS ON", lap_number=3),
        rc("2026-08-23T13:30:00", "Flag", "WAVED BLUE FLAG FOR CAR 16 (LEC)",
           driver=16, lap_number=40, flag="BLUE"),
        rc("2026-08-23T13:50:00", "SafetyCar", "VSC DEPLOYED", lap_number=70),
        rc("2026-08-23T13:51:00", "SafetyCar", "VSC ENDING", lap_number=70),
    ]
    laps = neutralised_laps(rows)
    # The real start-of-race neutralisation is covered...
    assert {2, 4, 5} <= laps
    # ...but it does not run away into the middle of the race.
    assert 40 not in laps
    assert 70 in laps


def test_green_pit_exit_message_is_not_a_restart():
    """'GREEN LIGHT - PIT EXIT OPEN' is published on lap 1 and is not a
    race restart, so it must not close a period that is genuinely open."""
    rows = [
        rc("2026-08-23T13:00:00", "SafetyCar", "VSC DEPLOYED", lap_number=5),
        rc("2026-08-23T13:00:30", "Flag", "GREEN LIGHT - PIT EXIT OPEN",
           lap_number=5, flag="GREEN"),
        rc("2026-08-23T13:02:00", "SafetyCar", "VSC ENDING", lap_number=7),
    ]
    assert neutralised_laps(rows) == {5, 6, 7}


def test_unterminated_period_is_bounded_not_left_running():
    """Running an unterminated period to the flag is how it swallowed a
    race once already."""
    rows = [rc("2026-08-23T13:05:00", "SafetyCar", "VSC DEPLOYED", lap_number=10)]
    laps = neutralised_laps(rows)
    assert 10 in laps
    assert max(laps) - 10 <= 5
    assert 60 not in laps


def test_slow_lap_under_safety_car_is_not_flagged():
    """The whole reason the track-status feed was worth having: a slow
    lap behind a safety car is the race, not the driver."""
    laps = [lap(n, 16, 80.0) for n in range(1, 12)]
    laps[10] = lap(11, 16, 110.0)  # 30s slower, but neutralised

    without = flag_slow_laps(laps, CODES, neutralised=set())
    assert any(f["lap"] == 11 for f in without)

    with_sc = flag_slow_laps(laps, CODES, neutralised={11})
    assert not any(f["lap"] == 11 for f in with_sc)


def test_flag_compares_a_driver_against_themselves():
    """A slower car must not be flagged merely for being slower."""
    fast = [lap(n, 16, 80.0) for n in range(1, 11)]
    slow = [lap(n, 44, 95.0) for n in range(1, 11)]
    flagged = flag_slow_laps(fast + slow, CODES)
    assert flagged == []


def test_out_laps_are_excluded():
    laps = [lap(n, 16, 80.0) for n in range(1, 11)]
    laps.append(lap(11, 16, 100.0, pit_out=True))
    assert not any(f["lap"] == 11 for f in flag_slow_laps(laps, CODES))


def test_too_few_green_laps_gives_no_baseline():
    """Four laps is not a norm; flagging against it would be noise."""
    laps = [lap(n, 16, 80.0) for n in range(1, 5)] + [lap(5, 16, 95.0)]
    assert flag_slow_laps(laps, CODES, neutralised={1}) == []


def test_flag_states_loss_and_declines_to_diagnose_a_cause():
    laps = [lap(n, 16, 80.0) for n in range(1, 11)]
    laps.append(lap(11, 16, 86.0))
    flagged = flag_slow_laps(laps, CODES)
    entry = next(f for f in flagged if f["lap"] == 11)

    assert entry["estimatedLossS"] == 6.0
    assert entry["severity"] == "moderate"
    assert "may be traffic" in entry["basis"]
    # Never asserts a mistake.
    assert "error" not in entry["basis"].split("driver error")[0]


def test_review_names_what_it_cannot_detect():
    review = build_error_review([], [], CODES)
    joined = " ".join(review["limitations"])
    assert "lock-up" in joined.lower()
    assert "verbatim" in joined.lower()


def test_review_separates_recorded_from_flagged():
    laps = [lap(n, 16, 80.0) for n in range(1, 11)] + [lap(11, 16, 90.0)]
    rows = [rc("2026-08-23T13:10:00", "Other", "CAR 16 (LEC) UNDER INVESTIGATION",
               driver=16, lap_number=12)]
    review = build_error_review(laps, rows, CODES)

    lec = review["drivers"]["LEC"]
    assert len(lec["recorded"]) == 1
    assert len(lec["flagged"]) == 1
    assert lec["recorded"][0]["kind"] == "recorded"
    assert lec["flagged"][0]["kind"] == "flagged"


def test_lap_one_is_never_flagged():
    """A standing start makes lap 1 slower for everyone. On real data
    this flagged all 22 drivers 'major' on lap 1, which is a race start,
    not twenty-two mistakes."""
    laps = [lap(1, 16, 91.0)] + [lap(n, 16, 80.0) for n in range(2, 12)]
    assert not any(f["lap"] == 1 for f in flag_slow_laps(laps, CODES))


def test_lap_one_does_not_drag_the_baseline():
    """Excluding it from flagging is not enough — it must be out of the
    median too, or every other lap looks fast by comparison."""
    laps = [lap(1, 16, 91.0)] + [lap(n, 16, 80.0) for n in range(2, 12)]
    laps.append(lap(12, 16, 83.0))
    flagged = flag_slow_laps(laps, CODES)
    entry = next(f for f in flagged if f["lap"] == 12)
    assert entry["baselineS"] == 80.0


def test_blue_flag_is_marked_informational():
    """A blue flag is information handed to a driver, not a finding about
    their conduct."""
    rows = [
        rc("2026-07-26T13:15:00", "Flag", "WAVED BLUE FLAG FOR CAR 16 (LEC)",
           driver=16, lap_number=9, flag="BLUE"),
        rc("2026-07-26T13:40:00", "Other", "CAR 16 (LEC) TRACK LIMITS - LAP DELETED",
           driver=16, lap_number=30),
    ]
    incidents = attributed_incidents(rows, CODES)
    by_lap = {i["lap"]: i for i in incidents}
    assert by_lap[9]["nature"] == "informational"
    assert by_lap[30]["nature"] == "noted"
