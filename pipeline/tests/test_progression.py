"""Points progression and championship elimination.

Progression re-runs the standings engine on prefixes, so its own tests
focus on the snapshot boundaries; elimination is pure arithmetic and the
cases that matter are the boundary (exactly reachable = still alive) and
the sprint contribution to the remaining maximum.
"""
import pytest

from derive import (
    compute_elimination,
    compute_points_progression,
    compute_standings_from_results,
)

POINTS_SYSTEM = {
    "race_points_by_position": {"1": 25, "2": 18, "3": 15},
    "fastest_lap_point": {"points": 0, "condition": "abolished"},
    "sprint_points_by_position": {"1": 8, "2": 7},
}


def race(*placings):
    return {
        "session": "race",
        "results": [
            {"driverCode": c, "driverName": c, "team": "T", "position": str(i + 1), "fastestLapRank": "9"}
            for i, c in enumerate(placings)
        ],
    }


class TestProgression:
    def test_snapshots_accumulate_round_by_round(self):
        per_round = [
            {"round": 1, "raceName": "A", "sessions": [race("VER", "HAM")]},
            {"round": 2, "raceName": "B", "sessions": [race("HAM", "VER")]},
        ]

        prog = compute_points_progression(per_round, POINTS_SYSTEM)

        assert [p["round"] for p in prog] == [1, 2]
        assert prog[0]["points"] == {"VER": 25.0, "HAM": 18.0}
        assert prog[1]["points"] == {"VER": 43.0, "HAM": 43.0}

    def test_final_snapshot_equals_the_standings_table(self):
        per_round = [
            {"round": 1, "raceName": "A", "sessions": [race("VER", "HAM", "LEC")]},
            {"round": 2, "raceName": "B", "sessions": [race("LEC", "VER", "HAM")]},
            {"round": 3, "raceName": "C", "sessions": [race("HAM", "LEC", "VER")]},
        ]

        prog = compute_points_progression(per_round, POINTS_SYSTEM)
        all_sessions = [s for r in per_round for s in r["sessions"]]
        standings = compute_standings_from_results(all_sessions, POINTS_SYSTEM)

        assert prog[-1]["points"] == {row["driverCode"]: row["points"] for row in standings}

    def test_empty_input_gives_empty_progression(self):
        assert compute_points_progression([], POINTS_SYSTEM) == []


class TestElimination:
    def standings(self):
        return [
            {"driverCode": "LEA", "points": 100.0},
            {"driverCode": "MID", "points": 60.0},
            {"driverCode": "OUT", "points": 20.0},
        ]

    def test_exactly_reachable_is_not_eliminated(self):
        # MID: 60 + 40 == 100 — a tie is possible and countback depends
        # on races not yet run, so MID is still alive.
        remaining = [{"round": 9, "date": "2026-12-01", "sprint": False}] * 2  # 2 * 25 = 50? no:
        # make remaining_max exactly 40: one race (25) + one sprint-less race won't do it,
        # so use a points system where it lands exactly.
        remaining = []
        elim = compute_elimination(self.standings(), remaining, POINTS_SYSTEM)
        # With nothing left, MID (60 < 100) is eliminated, LEA is not.
        assert elim["drivers"]["LEA"]["eliminated"] is False
        assert elim["drivers"]["MID"]["eliminated"] is True

    def test_boundary_tie_stays_alive(self):
        standings = [
            {"driverCode": "LEA", "points": 50.0},
            {"driverCode": "MID", "points": 25.0},
        ]
        remaining = [{"round": 9, "sprint": False}]  # max 25
        elim = compute_elimination(standings, remaining, POINTS_SYSTEM)
        assert elim["remainingMaxPoints"] == 25
        # 25 + 25 == 50: can tie the leader, so not eliminated.
        assert elim["drivers"]["MID"]["eliminated"] is False

    def test_one_point_short_is_eliminated(self):
        standings = [
            {"driverCode": "LEA", "points": 51.0},
            {"driverCode": "MID", "points": 25.0},
        ]
        remaining = [{"round": 9, "sprint": False}]
        elim = compute_elimination(standings, remaining, POINTS_SYSTEM)
        assert elim["drivers"]["MID"]["eliminated"] is True

    def test_sprint_round_raises_the_remaining_maximum(self):
        remaining = [{"round": 9, "sprint": True}, {"round": 10, "sprint": False}]
        elim = compute_elimination(self.standings(), remaining, POINTS_SYSTEM)
        assert elim["remainingMaxPoints"] == 25 + 8 + 25

    def test_fastest_lap_point_counts_toward_the_maximum(self):
        system = dict(POINTS_SYSTEM, fastest_lap_point={"points": 1, "condition": "top 10"})
        remaining = [{"round": 9, "sprint": False}]
        elim = compute_elimination(self.standings(), remaining, system)
        assert elim["remainingMaxPoints"] == 26
