import numpy as np

from derive import compute_standings_from_results, cross_check_standings, rotate_xy

POINTS_SYSTEM = {
    "race_points_by_position": {"1": 25, "2": 18, "3": 15},
    "fastest_lap_point": {"points": 1, "condition": "classified in the top 10"},
    "sprint_points_by_position": {"1": 8, "2": 7},
}


def test_rotate_xy_90_degrees_swaps_axes():
    x, y = rotate_xy(np.array([1.0]), np.array([0.0]), rotation_deg=90)
    assert np.isclose(x[0], 0.0, atol=1e-9)
    assert np.isclose(y[0], 1.0, atol=1e-9)


def test_rotate_xy_zero_degrees_is_identity():
    x, y = rotate_xy(np.array([3.0, -1.0]), np.array([4.0, 2.0]), rotation_deg=0)
    assert np.allclose(x, [3.0, -1.0])
    assert np.allclose(y, [4.0, 2.0])


def test_cross_check_standings_flags_point_mismatch():
    computed = [{"driverCode": "VER", "position": 1, "points": 25}]
    api = [{"driverCode": "VER", "position": 1, "points": 18}]

    result = cross_check_standings(computed, api)

    assert result["mismatch"] is True
    assert result["details"][0]["driverCode"] == "VER"


def test_cross_check_standings_agrees_when_identical():
    computed = [{"driverCode": "VER", "position": 1, "points": 25}]
    api = [{"driverCode": "VER", "position": 1, "points": 25}]

    result = cross_check_standings(computed, api)

    assert result["mismatch"] is False
    assert result["details"] == []


def test_compute_standings_from_results_accumulates_points_and_fastest_lap():
    results_by_round = [
        {
            "session": "race",
            "results": [
                {"driverCode": "VER", "driverName": "Max Verstappen", "team": "Red Bull", "position": "1", "fastestLapRank": "2"},
                {"driverCode": "HAM", "driverName": "Lewis Hamilton", "team": "Ferrari", "position": "2", "fastestLapRank": "1"},
            ],
        },
        {
            "session": "race",
            "results": [
                {"driverCode": "HAM", "driverName": "Lewis Hamilton", "team": "Ferrari", "position": "1", "fastestLapRank": "3"},
                {"driverCode": "VER", "driverName": "Max Verstappen", "team": "Red Bull", "position": "2", "fastestLapRank": "4"},
            ],
        },
    ]

    standings = compute_standings_from_results(results_by_round, POINTS_SYSTEM)

    by_code = {row["driverCode"]: row for row in standings}
    # VER: 25 (R1 P1) + 18 (R2 P2) = 43; HAM: 18+1 (R1 P2 + fastest lap) + 25 (R2 P1) = 44
    assert by_code["VER"]["points"] == 43
    assert by_code["HAM"]["points"] == 44
    assert standings[0]["driverCode"] == "HAM"
    assert standings[0]["position"] == 1


def test_standings_break_point_ties_by_countback():
    # Both drivers score zero, so ordering must come from countback: the
    # driver with the better best finish (P11 beats P12) ranks higher —
    # the exact case (PER/TSU on 0 points) the first real refresh flagged
    # as a mismatch against the API's ordering.
    results_by_round = [
        {
            "session": "race",
            "results": [
                {"driverCode": "AAA", "driverName": "A Driver", "team": "T1", "position": "12", "fastestLapRank": "5"},
                {"driverCode": "BBB", "driverName": "B Driver", "team": "T2", "position": "11", "fastestLapRank": "6"},
            ],
        },
    ]

    standings = compute_standings_from_results(results_by_round, POINTS_SYSTEM)

    assert standings[0]["driverCode"] == "BBB"
    assert standings[0]["points"] == 0
    assert standings[1]["driverCode"] == "AAA"
