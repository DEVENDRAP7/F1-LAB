"""Cover the sprint-weekend derivation.

The tests that matter are about what each number is allowed to include:
who counts as having raced, what a rank correlation refuses to report,
and the arithmetic of the two things that are actually computed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from derive_sprint import (  # noqa: E402
    MIN_CORRELATION_N,
    build,
    build_round,
    build_season,
    classified,
    movement,
    ranks,
    spearman,
)


def result(code, position, grid, status="Finished", points=0.0, laps=19, team="Team"):
    return {
        "position": str(position),
        "grid": grid,
        "driverCode": code,
        "driverName": f"{code} Driver",
        "team": team,
        "status": status,
        "points": points,
        "laps": laps,
    }


ROUND = {"round": 2, "raceName": "Chinese Grand Prix", "circuitId": "shanghai", "date": "2026-03-15"}


class TestClassified:
    def test_finished_counts(self):
        assert classified("Finished")

    def test_lapped_counts(self):
        assert classified("+1 Lap")
        assert classified("+2 Laps")

    def test_a_retirement_does_not(self):
        assert not classified("Engine")
        assert not classified("Accident")
        assert not classified("Did not start")

    def test_a_missing_status_does_not(self):
        assert not classified(None)
        assert not classified("")

    def test_a_status_that_merely_starts_with_a_plus_does_not(self):
        # "+11.234" would be a gap, not a lap count, and must not be
        # read as a classified finish just for the leading character.
        assert not classified("+11.234")


class TestRanks:
    def test_plain_order(self):
        assert ranks([3.0, 1.0, 2.0]) == [3.0, 1.0, 2.0]

    def test_ties_share_the_average(self):
        assert ranks([1.0, 1.0, 3.0]) == [1.5, 1.5, 3.0]

    def test_all_tied(self):
        assert ranks([2.0, 2.0, 2.0]) == [2.0, 2.0, 2.0]


class TestSpearman:
    def test_identical_orders_are_one(self):
        xs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        assert abs(spearman(xs, xs) - 1.0) < 1e-12

    def test_reversed_orders_are_minus_one(self):
        xs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        assert abs(spearman(xs, list(reversed(xs))) + 1.0) < 1e-12

    def test_never_reports_outside_the_range_it_is_defined_on(self):
        xs = [float(i) for i in range(12)]
        assert -1.0 <= spearman(xs, xs) <= 1.0
        assert -1.0 <= spearman(xs, list(reversed(xs))) <= 1.0

    def test_too_few_points_is_none_not_zero(self):
        n = MIN_CORRELATION_N - 1
        xs = [float(i) for i in range(n)]
        assert spearman(xs, xs) is None

    def test_no_spread_is_undefined_not_zero(self):
        # Every driver on the same rank asks no question, and 0.0 would
        # read as "no relationship" rather than "no question".
        xs = [1.0] * MIN_CORRELATION_N
        ys = [float(i) for i in range(MIN_CORRELATION_N)]
        assert spearman(xs, ys) is None

    def test_matches_a_hand_computed_case(self):
        # Ranks are the values themselves here, so rho is Pearson's r on
        # [1..5] against [2,1,4,3,5]: 1 - 6*sum(d^2)/(n(n^2-1))
        # = 1 - 6*4/(5*24) = 0.8.
        xs = [1.0, 2.0, 3.0, 4.0, 5.0]
        ys = [2.0, 1.0, 4.0, 3.0, 5.0]
        assert abs(spearman(xs, ys) - 0.8) < 1e-12


class TestMovement:
    def test_mean_absolute_places(self):
        rows = [
            {"g": 1, "f": 3, "ok": True},   # 2
            {"g": 5, "f": 1, "ok": True},   # 4
        ]
        out = movement(rows, "g", "f", "ok")
        assert out == {"meanAbsolute": 3.0, "sample": 2, "excluded": 0}

    def test_retirements_are_excluded_and_counted(self):
        rows = [
            {"g": 1, "f": 2, "ok": True},
            {"g": 4, "f": 20, "ok": False},
        ]
        out = movement(rows, "g", "f", "ok")
        assert out["meanAbsolute"] == 1.0
        assert out["sample"] == 1
        assert out["excluded"] == 1

    def test_a_pit_lane_start_has_no_grid_slot(self):
        rows = [{"g": 0, "f": 8, "ok": True}]
        out = movement(rows, "g", "f", "ok")
        assert out["meanAbsolute"] is None
        assert out["excluded"] == 1

    def test_nothing_usable_reports_none_rather_than_zero(self):
        assert movement([], "g", "f", "ok")["meanAbsolute"] is None


class TestBuildRound:
    def test_joins_both_races_on_the_driver_code(self):
        sprint = [result("NOR", 1, 2, points=8.0)]
        race = [result("NOR", 3, 1, points=15.0, laps=56)]
        out = build_round(ROUND, sprint, race)
        row = out["drivers"][0]
        assert row["sprintFinish"] == 1
        assert row["sprintGrid"] == 2
        assert row["raceFinish"] == 3
        assert row["raceGrid"] == 1
        assert out["sprintLaps"] == 19
        assert out["raceLaps"] == 56

    def test_a_driver_in_only_one_race_still_appears(self):
        out = build_round(ROUND, [result("NOR", 1, 1)], [result("PIA", 1, 1)])
        codes = [d["driverCode"] for d in out["drivers"]]
        assert codes == ["NOR", "PIA"]
        nor = out["drivers"][0]
        assert nor["raceFinish"] is None
        assert nor["raceClassified"] is False

    def test_rho_is_withheld_with_a_reason_when_the_sample_is_thin(self):
        sprint = [result(c, i + 1, i + 1) for i, c in enumerate(["A", "B", "C"])]
        race = [result(c, i + 1, i + 1) for i, c in enumerate(["A", "B", "C"])]
        out = build_round(ROUND, sprint, race)
        assert out["rankAgreement"]["rho"] is None
        assert str(MIN_CORRELATION_N) in out["rankAgreement"]["withheldReason"]

    def test_rho_counts_only_drivers_classified_in_both(self):
        codes = ["A", "B", "C", "D", "E", "F"]
        sprint = [result(c, i + 1, i + 1) for i, c in enumerate(codes)]
        race = [result(c, i + 1, i + 1) for i, c in enumerate(codes)]
        race[0] = result("A", 6, 1, status="Engine")
        out = build_round(ROUND, sprint, race)
        assert out["rankAgreement"]["n"] == 5
        # The retirement is gone from the sample, so the five that remain
        # are in the same order in both races.
        assert abs(out["rankAgreement"]["rho"] - 1.0) < 1e-12

    def test_points_are_summed_per_session(self):
        sprint = [result("NOR", 1, 1, points=8.0), result("PIA", 2, 2, points=7.0)]
        race = [result("NOR", 1, 1, points=25.0), result("PIA", 2, 2, points=18.0)]
        out = build_round(ROUND, sprint, race)
        assert out["sprintPoints"] == 15.0
        assert out["racePoints"] == 43.0


class TestBuildSeason:
    def _round(self, n, sprint, race):
        info = dict(ROUND, round=n)
        return build_round(info, sprint, race)

    def test_median_rho_over_the_rounds_that_have_one(self):
        codes = ["A", "B", "C", "D", "E", "F"]
        agree = self._round(2, [result(c, i + 1, i + 1) for i, c in enumerate(codes)],
                            [result(c, i + 1, i + 1) for i, c in enumerate(codes)])
        disagree = self._round(4, [result(c, i + 1, i + 1) for i, c in enumerate(codes)],
                               [result(c, 6 - i, i + 1) for i, c in enumerate(codes)])
        out = build_season([agree, disagree])
        assert out["rhoRoundsCounted"] == 2
        assert abs(out["medianRho"]) < 1e-12  # median of 1.0 and -1.0

    def test_a_round_with_no_rho_is_not_counted(self):
        codes = ["A", "B", "C", "D", "E", "F"]
        full = self._round(2, [result(c, i + 1, i + 1) for i, c in enumerate(codes)],
                           [result(c, i + 1, i + 1) for i, c in enumerate(codes)])
        thin = self._round(4, [result("A", 1, 1)], [result("A", 1, 1)])
        out = build_season([full, thin])
        assert out["rhoRoundsCounted"] == 1
        assert abs(out["medianRho"] - 1.0) < 1e-12
        assert out["roundsRun"] == 2

    def test_sprint_share_is_of_the_weekend_not_the_season(self):
        r = self._round(2, [result("NOR", 1, 1, points=8.0)],
                        [result("NOR", 2, 1, points=18.0)])
        out = build_season([r])
        row = out["pointsByDriver"][0]
        assert row["sprintPoints"] == 8.0
        assert row["racePoints"] == 18.0
        assert abs(row["sprintShare"] - 8.0 / 26.0) < 1e-12

    def test_a_driver_who_scored_nothing_is_left_out_of_the_points_table(self):
        r = self._round(2, [result("NOR", 1, 1, points=8.0), result("XXX", 15, 15)],
                        [result("NOR", 1, 1, points=25.0), result("XXX", 16, 15)])
        out = build_season([r])
        assert [row["driverCode"] for row in out["pointsByDriver"]] == ["NOR"]

    def test_empty_season_reports_nothing_rather_than_zero(self):
        out = build_season([])
        assert out["medianRho"] is None
        assert out["sprintMeanPlacesChanged"] is None
        assert out["pointsByDriver"] == []


class TestBuild:
    def test_carries_the_limitations_and_the_season_block(self):
        doc = build(2026, [], "2026-08-28T00:00:00Z", "Jolpica-F1")
        assert doc["year"] == 2026
        assert doc["season"]["roundsRun"] == 0
        assert len(doc["limitations"]) >= 5
        assert all(isinstance(line, str) and line for line in doc["limitations"])
